import Stripe from "stripe";

export function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

export function getStripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}

export function getMarketplaceWebhookProof(): string | null {
  return process.env.FRAMR_MARKETPLACE_WEBHOOK_TOKEN?.trim() || null;
}
