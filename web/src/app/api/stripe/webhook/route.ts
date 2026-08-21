import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMarketplaceWebhookProof, getStripeClient, getStripeWebhookSecret } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getWebhookDatabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: Request) {
  const stripe = getStripeClient();
  const webhookSecret = getStripeWebhookSecret();
  const proof = getMarketplaceWebhookProof();
  const database = getWebhookDatabaseClient();
  const signature = request.headers.get("stripe-signature");
  if (!stripe || !webhookSecret || !proof || !database) return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });

  const payload = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") return NextResponse.json({ received: true });
  const session = event.data.object;
  if (session.payment_status !== "paid") return NextResponse.json({ received: true });
  const paymentId = session.metadata?.marketplace_payment_id;
  if (!paymentId) return NextResponse.json({ received: true });
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (!paymentIntentId) return NextResponse.json({ received: true });

  const { error } = await database.rpc("mark_marketplace_payment_paid", {
    p_payment_id: paymentId,
    p_session_id: session.id,
    p_payment_intent_id: paymentIntentId,
    p_event_id: event.id,
    p_proof: proof,
  });
  if (error) return NextResponse.json({ error: "Marketplace payment could not be recorded." }, { status: 500 });
  return NextResponse.json({ received: true });
}
