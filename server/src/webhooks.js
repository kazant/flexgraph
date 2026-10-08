// Payment provider webhooks -> normalized subscription events.
//
//   POST /v1/webhooks/lemonsqueezy   (header X-Signature: hex HMAC-SHA256 of the raw body)
//   POST /v1/webhooks/stripe         (header Stripe-Signature: t=…,v1=…)
//
// Lemon Squeezy / Paddle are merchants of record (they handle VAT/MVA). Stripe is supported for
// teams that want more control (use Stripe Tax). Configure only the one you use.

import { json, error, hmacHex, safeEqual } from './util.js';
import { applySubscriptionEvent } from './subscriptions.js';

export async function handleLemonSqueezy(req, env) {
  if (!env.LEMONSQUEEZY_WEBHOOK_SECRET) return error(501, 'not-configured', 'Lemon Squeezy is not configured.');
  const raw = await req.text();
  const sig = req.headers.get('x-signature') || '';
  if (!safeEqual(await hmacHex(env.LEMONSQUEEZY_WEBHOOK_SECRET, raw), sig)) return error(401, 'bad-signature', 'Invalid signature.');
  let body;
  try { body = JSON.parse(raw); } catch { return error(400, 'bad-json', 'Invalid JSON.'); }
  const ev = normalizeLemonSqueezy(body, env);
  if (!ev) return json({ ignored: true });
  return json(await applySubscriptionEvent(env, ev));
}

const LS_TYPES = {
  subscription_created: 'created',
  subscription_updated: 'updated',
  subscription_resumed: 'updated',
  subscription_unpaused: 'updated',
  subscription_payment_success: 'payment_succeeded',
  subscription_payment_recovered: 'payment_succeeded',
  subscription_payment_failed: 'payment_failed',
  subscription_cancelled: 'canceled',
  subscription_expired: 'expired'
};
const LS_STATUS = { active: 'active', on_trial: 'active', past_due: 'past_due', unpaid: 'past_due', cancelled: 'canceling', expired: 'canceled', paused: 'past_due' };

export function normalizeLemonSqueezy(body, env = {}) {
  const name = body?.meta?.event_name;
  const type = LS_TYPES[name];
  if (!type) return null;
  const a = body.data?.attributes || {};
  const isInvoice = body.data?.type === 'subscription-invoices';
  const variant = String(a.variant_id ?? '');
  return {
    provider: 'lemonsqueezy',
    eventId: (body.meta.webhook_id || '') + ':' + name + ':' + body.data?.id + ':' + (a.updated_at || ''),
    type,
    subscriptionId: isInvoice ? a.subscription_id : body.data?.id,
    customer: { providerId: a.customer_id, email: a.user_email, name: a.user_name },
    status: LS_STATUS[a.status],
    quantity: a.first_subscription_item?.quantity,
    periodEnd: a.renews_at ? Date.parse(a.renews_at) : a.ends_at ? Date.parse(a.ends_at) : undefined,
    plan: env.ANNUAL_VARIANT_IDS && env.ANNUAL_VARIANT_IDS.split(',').includes(variant) ? 'annual' : variant ? 'monthly' : undefined,
    offlineAddon: body.meta?.custom_data?.offline === true || body.meta?.custom_data?.offline === 'true' ? true : undefined,
    portalUrl: a.urls?.customer_portal
  };
}

export async function handleStripe(req, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return error(501, 'not-configured', 'Stripe is not configured.');
  const raw = await req.text();
  const header = req.headers.get('stripe-signature') || '';
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const t = Number(parts.t);
  const now = env.now ? env.now() : Date.now();
  if (!t || Math.abs(now / 1000 - t) > 300) return error(401, 'bad-signature', 'Stale or missing timestamp.');
  if (!safeEqual(await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${raw}`), parts.v1 || '')) return error(401, 'bad-signature', 'Invalid signature.');
  let body;
  try { body = JSON.parse(raw); } catch { return error(400, 'bad-json', 'Invalid JSON.'); }
  const ev = normalizeStripe(body, env);
  if (!ev) return json({ ignored: true });
  return json(await applySubscriptionEvent(env, ev));
}

const STRIPE_STATUS = { active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'canceled', incomplete_expired: 'canceled' };

export function normalizeStripe(body, env = {}) {
  const o = body?.data?.object || {};
  const base = { provider: 'stripe', eventId: body.id };
  switch (body.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const item = o.items?.data?.[0];
      const status = o.cancel_at_period_end && o.status === 'active' ? 'canceling' : STRIPE_STATUS[o.status];
      return {
        ...base, type: body.type.endsWith('created') ? 'created' : 'updated', subscriptionId: o.id,
        customer: { providerId: o.customer, email: o.metadata?.email },
        status, quantity: item?.quantity,
        periodEnd: o.current_period_end ? o.current_period_end * 1000 : undefined,
        plan: item?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly',
        offlineAddon: o.metadata?.offline === 'true' ? true : undefined
      };
    }
    case 'customer.subscription.deleted':
      return { ...base, type: 'expired', subscriptionId: o.id, customer: { providerId: o.customer, email: o.metadata?.email } };
    case 'invoice.paid':
      if (!o.subscription) return null;
      return { ...base, type: 'payment_succeeded', subscriptionId: o.subscription, customer: { providerId: o.customer, email: o.customer_email },
        periodEnd: o.lines?.data?.[0]?.period?.end ? o.lines.data[0].period.end * 1000 : undefined };
    case 'invoice.payment_failed':
      if (!o.subscription) return null;
      return { ...base, type: 'payment_failed', subscriptionId: o.subscription, customer: { providerId: o.customer, email: o.customer_email } };
    default:
      return null;
  }
}
