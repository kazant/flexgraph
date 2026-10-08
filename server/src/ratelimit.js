// Rate limiting. Uses the Workers Rate Limiting binding when configured (RATE_LIMITER),
// otherwise a per-isolate fixed window. IPs are only held in memory for the window (GDPR).

const windows = new Map();

export async function rateLimit(env, key, limit, windowMs, now = Date.now()) {
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
    const { success } = await env.RATE_LIMITER.limit({ key });
    return success;
  }
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 50_000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    return true;
  }
  w.count++;
  return w.count <= limit;
}

export function _resetRateLimits() { windows.clear(); }
