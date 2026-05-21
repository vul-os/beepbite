/**
 * ulid.js — client-side ULID generator (no dependencies).
 *
 * Produces a 26-character Crockford base-32 string that is:
 *   - Lexicographically sortable (timestamp prefix)
 *   - Monotonically increasing within the same millisecond
 *   - Globally unique enough for client-generated IDs
 *
 * Spec: https://github.com/ulid/spec
 *
 * Usage:
 *   import { ulid } from '@/offline/ulid.js';
 *   const id = ulid(); // "01ARZ3NDEKTSV4RRFFQ69G5FAV"
 */

const ENCODING   = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = ENCODING.length; // 32
const TIME_LEN   = 10;
const RANDOM_LEN = 16;

let lastTime = 0;
let lastRandom = new Uint8Array(RANDOM_LEN);

/**
 * Encode an integer into Crockford base-32 using `len` characters.
 * @param {number} value
 * @param {number} len
 * @returns {string}
 */
function encodeTime(value, len) {
  let str = '';
  for (let i = len - 1; i >= 0; i--) {
    str = ENCODING[value % ENCODING_LEN] + str;
    value = Math.floor(value / ENCODING_LEN);
  }
  return str;
}

/**
 * Encode a Uint8Array as Crockford base-32.
 * @param {Uint8Array} random
 * @returns {string}
 */
function encodeRandom(random) {
  // Pack 16 bytes (128 bits) into 16 base-32 characters (80 bits) by treating
  // each byte as a 5-bit value — sufficient for collision avoidance.
  let str = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    str += ENCODING[random[i] & 0x1f];
  }
  return str;
}

/**
 * Increment the random portion so that within the same millisecond each call
 * produces a strictly greater ULID.
 * @param {Uint8Array} random
 * @returns {Uint8Array}
 */
function incrementRandom(random) {
  const next = new Uint8Array(random);
  let carry = 1;
  for (let i = RANDOM_LEN - 1; i >= 0 && carry; i--) {
    const sum = (next[i] & 0x1f) + carry;
    next[i] = sum & 0x1f;
    carry = sum >>> 5;
  }
  // If carry overflows (all bits set) — extremely unlikely — just re-randomise.
  if (carry) {
    crypto.getRandomValues(next);
  }
  return next;
}

/**
 * Generate a ULID string.
 * @returns {string} 26-character ULID
 */
export function ulid() {
  const now = Date.now();

  if (now === lastTime) {
    lastRandom = incrementRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = new Uint8Array(RANDOM_LEN);
    crypto.getRandomValues(lastRandom);
    // Mask to 5 bits per byte so encodeRandom works correctly.
    for (let i = 0; i < RANDOM_LEN; i++) {
      lastRandom[i] &= 0x1f;
    }
  }

  return encodeTime(now, TIME_LEN) + encodeRandom(lastRandom);
}

export default ulid;
