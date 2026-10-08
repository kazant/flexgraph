// Fallback ECDSA P-256 / SHA-256 signature verification in pure JS (BigInt).
// Used only where Web Crypto is unavailable (pages served over plain http, which are not
// "secure contexts"), so license tokens are still verified there.

const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const A = P - 3n;
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

const mod = (a, m) => { const r = a % m; return r >= 0n ? r : r + m; };
function inv(a, m) {
  let [lo, hi, x0, x1] = [mod(a, m), m, 1n, 0n];
  while (lo > 1n) { const q = hi / lo; [lo, hi] = [hi - q * lo, lo]; [x0, x1] = [x1 - q * x0, x0]; }
  return mod(x0, m);
}

// Jacobian coordinates [X, Y, Z]; Z = 0 is the point at infinity
function dbl([X, Y, Z]) {
  if (Z === 0n || Y === 0n) return [0n, 1n, 0n];
  const YY = mod(Y * Y, P), S = mod(4n * X * YY, P), ZZ = mod(Z * Z, P);
  const M = mod(3n * X * X + A * ZZ * ZZ, P);
  const X3 = mod(M * M - 2n * S, P);
  return [X3, mod(M * (S - X3) - 8n * YY * YY, P), mod(2n * Y * Z, P)];
}
function add(p, q) {
  if (p[2] === 0n) return q;
  if (q[2] === 0n) return p;
  const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q;
  const Z1Z1 = mod(Z1 * Z1, P), Z2Z2 = mod(Z2 * Z2, P);
  const U1 = mod(X1 * Z2Z2, P), U2 = mod(X2 * Z1Z1, P);
  const S1 = mod(Y1 * Z2 * Z2Z2, P), S2 = mod(Y2 * Z1 * Z1Z1, P);
  if (U1 === U2) return S1 === S2 ? dbl(p) : [0n, 1n, 0n];
  const H = mod(U2 - U1, P), R = mod(S2 - S1, P), HH = mod(H * H, P), HHH = mod(H * HH, P);
  const X3 = mod(R * R - HHH - 2n * U1 * HH, P);
  return [X3, mod(R * (U1 * HH - X3) - S1 * HHH, P), mod(H * Z1 * Z2, P)];
}
function mulAdd(u1, u2, Q) {
  // Shamir's trick: u1*G + u2*Q
  const G = [GX, GY, 1n], GQ = add(G, Q);
  let R = [0n, 1n, 0n];
  for (let i = 255; i >= 0; i--) {
    R = dbl(R);
    const b1 = (u1 >> BigInt(i)) & 1n, b2 = (u2 >> BigInt(i)) & 1n;
    if (b1 && b2) R = add(R, GQ); else if (b1) R = add(R, G); else if (b2) R = add(R, Q);
  }
  return R;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

export function sha256(bytes) {
  const l = bytes.length, nBlocks = ((l + 9 + 63) >> 6);
  const m = new Uint8Array(nBlocks * 64);
  m.set(bytes); m[l] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(m.length - 4, l * 8); dv.setUint32(m.length - 8, Math.floor(l / 0x20000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  H.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

const toBig = (bytes) => bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
const b64uToBig = (s, decode) => toBig(decode(s));

/**
 * Verify an IEEE-P1363 (r||s) ECDSA P-256 signature over `data`.
 * @param {{x:string,y:string}} jwk public key (base64url coordinates)
 * @param {Uint8Array} sig 64 bytes
 * @param {Uint8Array} data
 * @param {(s:string)=>Uint8Array} decode base64url decoder
 */
export function verifyP256(jwk, sig, data, decode) {
  if (!sig || sig.length !== 64) return false;
  const r = toBig(sig.slice(0, 32)), s = toBig(sig.slice(32));
  if (r <= 0n || r >= N || s <= 0n || s >= N) return false;
  const qx = b64uToBig(jwk.x, decode), qy = b64uToBig(jwk.y, decode);
  if (mod(qy * qy - qx * qx * qx - A * qx - 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn, P) !== 0n) return false;
  const e = toBig(sha256(data));
  const w = inv(s, N);
  const R = mulAdd(mod(e * w, N), mod(r * w, N), [qx, qy, 1n]);
  if (R[2] === 0n) return false;
  const zi = inv(R[2], P);
  const x = mod(R[0] * zi * zi, P);
  return mod(x, N) === r;
}
