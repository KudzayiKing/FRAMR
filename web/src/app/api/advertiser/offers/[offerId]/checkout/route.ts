import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase-server";
import { getMarketplaceWebhookProof, getStripeClient } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ offerId: string }> };

async function requireAdvertiser() {
  const client = await getServerClient();
  if (!client) return { error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) } as const;
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { error: NextResponse.json({ error: "You must be signed in to fund an offer." }, { status: 401 }) } as const;
  const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "advertiser") return { error: NextResponse.json({ error: "Only advertiser accounts can fund marketplace offers." }, { status: 403 }) } as const;
  return { client, user } as const;
}

export async function POST(request: Request, { params }: Context) {
  const auth = await requireAdvertiser();
  if ("error" in auth) return auth.error;
  const { offerId } = await params;
  if (!UUID.test(offerId)) return NextResponse.json({ error: "The offer is invalid." }, { status: 400 });
  const stripe = getStripeClient();
  const proof = getMarketplaceWebhookProof();
  if (!stripe || !proof) return NextResponse.json({ error: "Stripe test checkout is not configured yet." }, { status: 503 });

  const { data: offer, error: offerError } = await auth.client
    .from("campaign_placements")
    .select("id,campaign_id,product_id,status,funding_status,price_cents,currency")
    .eq("id", offerId)
    .maybeSingle();
  if (offerError || !offer) return NextResponse.json({ error: "The approved offer is unavailable." }, { status: 404 });
  if (offer.status !== "creator_approved") return NextResponse.json({ error: "Only creator-approved offers can be funded." }, { status: 409 });
  if (offer.funding_status === "funded") return NextResponse.json({ error: "This offer is already funded and ready for preview." }, { status: 409 });

  const [{ data: campaign }, { data: product }] = await Promise.all([
    auth.client.from("campaigns").select("id,name,advertiser_id").eq("id", offer.campaign_id).maybeSingle(),
    offer.product_id ? auth.client.from("products").select("id,name,brand").eq("id", offer.product_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!campaign || campaign.advertiser_id !== auth.user.id || !product) return NextResponse.json({ error: "The campaign or product is unavailable for payment." }, { status: 409 });

  const { data: paymentRows, error: paymentError } = await auth.client.rpc("create_marketplace_payment_attempt", {
    p_offer_id: offerId,
    p_proof: proof,
  });
  const payment = Array.isArray(paymentRows) ? paymentRows[0] : null;
  if (paymentError || !payment) return NextResponse.json({ error: "The payment record could not be prepared." }, { status: 500 });

  const origin = new URL(request.url).origin;
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      submit_type: "book",
      payment_method_types: ["card"],
      client_reference_id: payment.payment_id,
      success_url: `${origin}/workspace?role=advertiser&payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/workspace?role=advertiser&payment=cancel`,
      metadata: { marketplace_payment_id: payment.payment_id, marketplace_offer_id: offerId },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: payment.currency,
          unit_amount: payment.amount_cents,
          product_data: { name: `${product.brand ? `${product.brand} ` : ""}${product.name} placement in ${campaign.name}`.slice(0, 250) },
        },
      }],
    });
  } catch {
    return NextResponse.json({ error: "Stripe could not start checkout. Please try again." }, { status: 502 });
  }
  if (!session.url) return NextResponse.json({ error: "Stripe did not provide a checkout link." }, { status: 502 });

  const expiresAt = session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null;
  const { error: attachError } = await auth.client.rpc("attach_marketplace_checkout_session", {
    p_payment_id: payment.payment_id,
    p_session_id: session.id,
    p_expires_at: expiresAt,
    p_proof: proof,
  });
  if (attachError) return NextResponse.json({ error: "The Stripe checkout link could not be linked safely." }, { status: 500 });
  return NextResponse.json({ checkoutUrl: session.url });
}
