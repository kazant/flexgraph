// Shared license gate. Consulted by layout, routing, rendering and interaction,
// so the verified status is checked in several places rather than one.
// Set by license/verify.js. Defaults to "allowed" until verification decides,
// so pages never flash a lock screen while the (cached) check runs.

const K = 0x2f6b;
let _v = K ^ 0x13;

/** @internal set gate state (true = full functionality) */
export function _sg(ok) { _v = K ^ (ok ? 0x13 : 0x2c); }

/** @internal read gate state */
export function _lg(n) { return ((_v ^ K) & 0x1f) === 0x13 && n > 0; }
