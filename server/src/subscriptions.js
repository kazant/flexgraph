// Provider-agnostic subscription state machine.
//
// Normalized event:
// { provider, eventId, type: 'created'|'updated'|'payment_succeeded'|'payment_failed'|'canceled'|'expired',
//   subscriptionId, customer: { providerId, email, name }, status, quantity, periodEnd, plan, offlineAddon, portalUrl }

import { uid, newLicenseKey, GRACE_MS, DAY } from './util.js';
import { sendEmail } from './email.js';

export async function applySubscriptionEvent(env, ev) {
  const now = env.now ? env.now() : Date.now();
  const db = env.DB;

  // idempotency: providers retry webhooks
  if (ev.eventId) {
    const seen = await db.prepare('SELECT id FROM webhook_events WHERE id = ?').bind(ev.provider + ':' + ev.eventId).first();
    if (seen) return { duplicate: true };
  }

  let sub = await db.prepare('SELECT * FROM subscriptions WHERE provider_subscription_id = ?').bind(String(ev.subscriptionId)).first();

  // customer
  let customer = null;
  if (sub) customer = await db.prepare('SELECT * FROM customers WHERE id = ?').bind(sub.customer_id).first();
  if (!customer && ev.customer?.email) {
    const email = ev.customer.email.toLowerCase();
    customer = await db.prepare('SELECT * FROM customers WHERE email = ?').bind(email).first();
    if (!customer) {
      customer = { id: uid('cus'), email, company: ev.customer.name || null, provider_customer_id: ev.customer.providerId ? String(ev.customer.providerId) : null, created_at: now };
      await db.prepare('INSERT INTO customers (id, email, company, provider_customer_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(customer.id, customer.email, customer.company, customer.provider_customer_id, now).run();
    }
  }
  if (!customer) throw new Error('Cannot resolve customer for subscription ' + ev.subscriptionId);

  const periodMs = (ev.plan || sub?.plan) === 'annual' ? 366 * DAY : 31 * DAY;

  if (!sub) {
    sub = {
      id: uid('sub'), customer_id: customer.id, provider: ev.provider, provider_subscription_id: String(ev.subscriptionId),
      plan: ev.plan || 'monthly', status: 'active', quantity: Math.max(1, ev.quantity || 1), offline_addon: ev.offlineAddon ? 1 : 0,
      current_period_end: ev.periodEnd || now + periodMs, billing_portal_url: ev.portalUrl || null, updated_at: now
    };
    await db.prepare(`INSERT INTO subscriptions (id, customer_id, provider, provider_subscription_id, plan, status, quantity, offline_addon, current_period_end, billing_portal_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(sub.id, sub.customer_id, sub.provider, sub.provider_subscription_id, sub.plan, sub.status, sub.quantity, sub.offline_addon, sub.current_period_end, sub.billing_portal_url, now).run();
  }

  // apply the event
  const patch = {};
  if (ev.quantity) patch.quantity = Math.max(0, ev.quantity);
  if (ev.plan) patch.plan = ev.plan;
  if (ev.offlineAddon !== undefined) patch.offline_addon = ev.offlineAddon ? 1 : 0;
  if (ev.portalUrl) patch.billing_portal_url = ev.portalUrl;

  let projectUpdate = null; // SQL fragment + binds applied to all non-canceled projects of the subscription
  switch (ev.type) {
    case 'created':
    case 'updated': {
      if (ev.periodEnd) patch.current_period_end = ev.periodEnd;
      if (ev.status === 'active') {
        patch.status = 'active';
        const until = ev.periodEnd || sub.current_period_end;
        projectUpdate = ["status = 'active', paid_until = ?, grace_until = NULL", [until]];
      } else if (ev.status === 'past_due') {
        patch.status = 'past_due';
        projectUpdate = pastDue(sub, now);
      } else if (ev.status === 'canceling') {
        patch.status = 'canceling';
        projectUpdate = ['grace_until = paid_until', []]; // no grace after a deliberate cancellation
      } else if (ev.status === 'canceled') {
        return cancel(env, sub, customer, ev, now);
      }
      break;
    }
    case 'payment_succeeded': {
      const until = Math.max(ev.periodEnd || 0, sub.current_period_end || 0, now + periodMs);
      patch.status = 'active';
      patch.current_period_end = until;
      projectUpdate = ["status = 'active', paid_until = ?, grace_until = NULL", [until]];
      break;
    }
    case 'payment_failed': {
      patch.status = 'past_due';
      projectUpdate = pastDue(sub, now);
      break;
    }
    case 'canceled': {
      // Cancelled at period end: keep working until paid_until, no grace afterwards.
      patch.status = 'canceling';
      projectUpdate = ['grace_until = paid_until', []];
      break;
    }
    case 'expired':
      return cancel(env, sub, customer, ev, now);
    default:
      break;
  }

  await updateSub(db, sub.id, patch, now);
  sub = { ...sub, ...patch };
  await syncProjectCount(env, sub, customer, now);
  if (projectUpdate) {
    await db.prepare(`UPDATE projects SET ${projectUpdate[0]} WHERE subscription_id = ? AND status != 'canceled'`).bind(...projectUpdate[1], sub.id).run();
  }
  if (ev.type === 'payment_failed') {
    await sendEmail(env, {
      to: customer.email,
      subject: 'FlexGraph: payment failed — 14-day grace period started',
      text: `We could not collect the payment for your FlexGraph subscription.\n\nYour graphs keep working for 14 days. After that they show a "License inactive" overlay.\nUpdate your payment method: ${sub.billing_portal_url || env.PORTAL_ORIGIN + '/portal/'}`
    });
  }
  await markEvent(db, ev, now);
  return { ok: true, subscriptionId: sub.id };
}

function pastDue(sub, now) {
  // grace starts at the later of failure time and the end of the paid period
  return ["status = CASE WHEN status = 'active' THEN 'past_due' ELSE status END, grace_until = COALESCE(grace_until, MAX(COALESCE(paid_until, 0), ?) + ?)", [now, GRACE_MS]];
}

async function cancel(env, sub, customer, ev, now) {
  const db = env.DB;
  await updateSub(db, sub.id, { status: 'canceled' }, now);
  await db.prepare("UPDATE projects SET status = 'canceled' WHERE subscription_id = ?").bind(sub.id).run();
  await revokeRegistryIfNoActive(env, customer.id);
  await markEvent(db, ev, now);
  return { ok: true, canceled: true };
}

/** Revoke a customer's registry tokens when none of their projects is usable any more. */
export async function revokeRegistryIfNoActive(env, customerId) {
  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE customer_id = ? AND status != 'canceled'").bind(customerId).first();
  if (!live || !live.n) {
    await env.DB.prepare('UPDATE registry_tokens SET revoked = 1 WHERE customer_id = ? AND revoked = 0').bind(customerId).run();
    return true;
  }
  return false;
}

async function updateSub(db, id, patch, now) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  await db.prepare(`UPDATE subscriptions SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => patch[k]), now, id).run();
}

async function markEvent(db, ev, now) {
  if (!ev.eventId) return;
  await db.prepare('INSERT OR IGNORE INTO webhook_events (id, provider, type, received_at) VALUES (?, ?, ?, ?)')
    .bind(ev.provider + ':' + ev.eventId, ev.provider, ev.type, now).run();
}

/** Make the number of live projects match the subscription quantity. */
async function syncProjectCount(env, sub, customer, now) {
  const db = env.DB;
  const projects = (await db.prepare(
    `SELECT p.*, (SELECT COUNT(*) FROM domains d WHERE d.project_id = p.id) AS domain_count
     FROM projects p WHERE subscription_id = ? AND status != 'canceled' ORDER BY created_at ASC`
  ).bind(sub.id).all()).results || [];
  const want = sub.quantity ?? 1;
  if (projects.length < want) {
    const created = [];
    for (let i = projects.length; i < want; i++) {
      const id = uid('prj'), key = newLicenseKey();
      await db.prepare(`INSERT INTO projects (id, customer_id, subscription_id, name, license_key, status, paid_until, grace_until, wildcard, created_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, 0, ?)`)
        .bind(id, customer.id, sub.id, 'Project ' + (i + 1), key, sub.current_period_end || now, now).run();
      created.push(key);
    }
    await sendEmail(env, {
      to: customer.email,
      subject: created.length === 1 ? 'Your FlexGraph license key' : `Your ${created.length} new FlexGraph license keys`,
      text: `Thanks for subscribing to FlexGraph.\n\n${created.map((k) => '  ' + k).join('\n')}\n\nRegister your domains and get your npm registry token in the customer portal: ${env.PORTAL_ORIGIN}/portal/`
    });
  } else if (projects.length > want) {
    // remove licenses: prefer the newest projects without domains
    const victims = projects.slice().sort((a, b) => (a.domain_count - b.domain_count) || (b.created_at - a.created_at)).slice(0, projects.length - want);
    for (const p of victims) await db.prepare("UPDATE projects SET status = 'canceled' WHERE id = ?").bind(p.id).run();
  }
}
