// Key id: a short, stable, non-secret fingerprint of a license key.
// Binds a cached token to the key it was issued for. Shared with the license server.

function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function keyId(key) {
  const k = String(key);
  return fnv1a(k, 0x811c9dc5) + fnv1a(k.split('').reverse().join(''), 0x9747b28c);
}
