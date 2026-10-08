// Daily maintenance (Cron Trigger): grace-period expiry, reminder emails,
// key-sharing / unregistered-domain alerts, offline key renewal, data retention.

import { DAY, dayOf } from './util.js';
import { effectiveStatus } from './validate.js';
import { revokeRegistryIfNoActive } from './subscriptions.js';
import { issueOfflineKey } from './tokens.js';
import { sendEmail } from './email.js';

export const REMINDER_DAYS = [1, 7, 13];
export const KEY_SHARING_THRESHOLD = 5; // distinct unregistered hostnames per 7 days

export async function runDaily(env) {
  const now = env.now ? env.now() : Date.now();
  const db = env.DB;
  const report = { canceled: 0, reminders: 0, alerts: 0, offlineKeys: 0 };

  const projects = (await db.prepare(
    `SELECT p.*, c.email, s.billing_portal_url, s.offline_addon, s.status AS sub_status
     FROM projects p JOIN customers c ON c.id = p.customer_id JOIN subscriptions s ON s.id = p.subscription_id
     WHERE p.status != 'canceled'`
  ).all()).results || [];

  for (const p of projects) {
    const eff = effectiveStatus(p, now);
    // 1. grace period over -> canceled (+ registry token revoked if nothing is left)
    if (eff.status === 'canceled') {
      await db.prepare("UPDATE projects SET status = 'canceled' WHERE id = ?").bind(p.id).run();
      await revokeRegistryIfNoActive(env, p.customer_id);
      report.canceled++;
      continue;
    }
    // 2. reminders on day 1, 7 and 13 of the grace period (not for deliberate cancellations)
    if (eff.status === 'past_due' && p.sub_status !== 'canceling') {
      const day = Math.floor((now - (eff.graceUntil - 14 * DAY)) / DAY) + 1;
      for (const d of REMINDER_DAYS) {
        if (day < d) continue;
        const kind = `grace-d${d}:${eff.graceUntil}`;
        const sent = await db.prepare('SELECT 1 AS x FROM reminders WHERE project_id = ? AND kind = ?').bind(p.id, kind).first();
        if (sent) continue;
        const left = Math.max(0, Math.ceil((eff.graceUntil - now) / DAY));
        await sendEmail(env, {
          to: p.email,
          subject: `FlexGraph: payment needed — ${left} day(s) until "${p.name}" is locked`,
          text: `Your payment for FlexGraph is past due. In ${left} day(s) graphs in "${p.name}" will show a "License inactive" overlay to your users.\n\nUpdate your payment method: ${p.billing_portal_url || env.PORTAL_ORIGIN + '/portal/'}`
        });
        await db.prepare('INSERT INTO reminders (project_id, kind, sent_at) VALUES (?, ?, ?)').bind(p.id, kind, now).run();
        report.reminders++;
        break; // one email per day at most
      }
    }
    // 3. offline add-on: send a fresh key whenever the paid period was extended
    if (p.offline_addon && eff.status === 'active') {
      const kind = `offline:${p.paid_until}`;
      const sent = await db.prepare('SELECT 1 AS x FROM reminders WHERE project_id = ? AND kind = ?').bind(p.id, kind).first();
      if (!sent) {
        const domains = (await db.prepare('SELECT hostname FROM domains WHERE project_id = ?').bind(p.id).all()).results || [];
        if (domains.length) {
          const keys = [];
          for (const d of domains) keys.push(`${d.hostname}: ${await issueOfflineKey(env, { projectId: p.id, domain: d.hostname, paidUntil: p.paid_until, graceUntil: eff.graceUntil, now })}`);
          await sendEmail(env, { to: p.email, subject: `FlexGraph offline license keys for "${p.name}"`, text: `New offline keys (valid until ${new Date(eff.graceUntil).toISOString().slice(0, 10)}). Replace the key in your project:\n\n${keys.join('\n\n')}` });
          await db.prepare('INSERT INTO reminders (project_id, kind, sent_at) VALUES (?, ?, ?)').bind(p.id, kind, now).run();
          report.offlineKeys++;
        }
      }
    }
  }

  // 4. monitoring: key sharing + repeated unregistered domains
  const since = dayOf(now - 7 * DAY);
  const suspicious = (await db.prepare(
    `SELECT project_id, COUNT(DISTINCT hostname) AS hosts, SUM(count) AS requests, GROUP_CONCAT(DISTINCT hostname) AS list
     FROM validations WHERE registered = 0 AND day >= ? GROUP BY project_id`
  ).bind(since).all()).results || [];
  for (const s of suspicious) {
    const kind = s.hosts >= KEY_SHARING_THRESHOLD ? 'key-sharing' : s.requests >= 50 ? 'unregistered-domain' : null;
    if (!kind) continue;
    const res = await db.prepare('INSERT OR IGNORE INTO alerts (project_id, kind, detail, day, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(s.project_id, kind, `${s.hosts} unregistered host(s), ${s.requests} request(s): ${String(s.list).slice(0, 500)}`, dayOf(now), now).run();
    if (res.meta?.changes && env.ADMIN_EMAIL) {
      await sendEmail(env, { to: env.ADMIN_EMAIL, subject: `FlexGraph alert: ${kind} on ${s.project_id}`, text: `${s.hosts} unregistered host(s) in the last 7 days:\n${s.list}` });
    }
    report.alerts++;
  }

  // 5. retention: aggregated validation logs are kept for 90 days
  await db.prepare('DELETE FROM validations WHERE day < ?').bind(dayOf(now - 90 * DAY)).run();
  return report;
}
