// @ts-check
/* rng.js — seeded, cursored randomness (SPEC §2.2).

   Every draw is a pure function of (seed, cursor) and returns the next cursor
   alongside the value. Nothing here holds state, so replaying an action log
   against a seed reproduces the run exactly.

   The cursor — not a mutable generator — is what makes that true. A stateful
   PRNG would be equally deterministic in isolation, but its position would live
   outside GameState and so would not survive a save/load round trip. Threading
   the cursor through state means a run resumed from localStorage draws exactly
   what an uninterrupted run would have drawn. */

/**
 * mulberry32. Chosen for being 12 lines and having no dependencies; the game
 * needs a fair shuffle and a starting water level, not cryptographic quality.
 * @param {number} a
 * @returns {() => number}
 */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One draw in [0, 1). Never mutates its inputs — the caller stores `cursor`.
 * @param {number} seed
 * @param {number} cursor
 * @returns {{ value:number, cursor:number }}
 */
export function draw(seed, cursor) {
  // Mixing the cursor with the golden-ratio constant before seeding keeps
  // successive draws from correlating, which they do if you simply add 1.
  const rand = mulberry32((seed + Math.imul(cursor, 0x9e3779b9)) | 0);
  rand(); // discard the first output: mulberry32's first value tracks its seed
  return { value: rand(), cursor: cursor + 1 };
}

/**
 * Integer in [min, max] inclusive.
 * @param {number} seed
 * @param {number} cursor
 * @param {number} min
 * @param {number} max
 * @returns {{ value:number, cursor:number }}
 */
export function drawInt(seed, cursor, min, max) {
  const r = draw(seed, cursor);
  return { value: min + Math.floor(r.value * (max - min + 1)), cursor: r.cursor };
}

/**
 * Fisher-Yates over a copy, consuming one cursor step per swap. Used for the
 * event deck (SPEC §6.6).
 * @template T
 * @param {readonly T[]} items
 * @param {number} seed
 * @param {number} cursor
 * @returns {{ value:T[], cursor:number }}
 */
export function shuffle(items, seed, cursor) {
  const out = items.slice();
  let c = cursor;
  for (let i = out.length - 1; i > 0; i--) {
    const r = drawInt(seed, c, 0, i);
    c = r.cursor;
    const a = out[i];
    const b = out[r.value];
    // noUncheckedIndexedAccess: both indices are in range, but prove it anyway
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[r.value] = a;
    }
  }
  return { value: out, cursor: c };
}
