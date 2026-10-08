// Transactional email via Resend (https://resend.com). Swap for any provider with an HTTP API.
// Without RESEND_API_KEY, emails are logged (and collected in env.__outbox for tests).

export async function sendEmail(env, { to, subject, text }) {
  if (env.__outbox) env.__outbox.push({ to, subject, text });
  if (!env.RESEND_API_KEY) {
    if (!env.__outbox) console.log(`[email] to=${to} subject=${subject}`);
    return { skipped: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'FlexGraph <licenses@flexgraph.example>', to: [to], subject, text })
  });
  if (!res.ok) console.error('[email] failed', res.status, await res.text().catch(() => ''));
  return { ok: res.ok };
}
