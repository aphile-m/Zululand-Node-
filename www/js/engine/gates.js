// @ts-check
/* gates.js — the act gate predicate evaluator (SPEC §7).

   A small recursive walk over a plain-JSON predicate tree. No eval, no string
   expressions, no dynamic property access outside the whitelists below — a gate
   is data, and data cannot become code.

   The predicate set is SPEC §7's plus the three additions in DECISIONS D4
   (`atLeastN`, `counterAtLeast`, `derivedAtLeast`), without which three of the
   seven act gates cannot be expressed at all. */

import { BUILDINGS } from '../../content/index.js';

/** Rank order for parcelStatusAtLeast. Index is the comparison key. */
const STATUS_RANK = ['unknown', 'identified', 'optioned', 'leased', 'owned'];

/**
 * `frozen` is deliberately absent from STATUS_RANK: it is not a point on the
 * road from unknown to owned, it is a stop sign. A frozen parcel never
 * satisfies parcelStatusAtLeast, whatever rights were held before the freeze.
 * @param {import('./types.js').ParcelStatus} status
 */
function statusRank(status) {
  return STATUS_RANK.indexOf(status);
}

/**
 * Derived metrics a gate may read (DECISIONS D4). Whitelisted by name so a
 * content file cannot reach arbitrary state.
 * @param {import('./types.js').GameState} state
 * @param {'householdsWithTitle'|'jobsInCatchment'} metric
 */
function derived(state, metric) {
  let total = 0;
  for (const b of state.buildings) {
    if (!b.operational) continue;
    const def = BUILDINGS.find((d) => d.id === b.typeId);
    if (!def) continue;
    total += metric === 'householdsWithTitle' ? def.households : def.jobs;
  }
  return total;
}

/**
 * @param {import('./types.js').GameState} state
 * @param {{ typeId?:string, tag?:string }} spec
 */
function hasOperational(state, spec) {
  return state.buildings.some((b) => {
    if (!b.operational) return false;
    if (spec.typeId !== undefined) return b.typeId === spec.typeId;
    if (spec.tag !== undefined) {
      const def = BUILDINGS.find((d) => d.id === b.typeId);
      return def?.tag === spec.tag;
    }
    return false;
  });
}

/**
 * Evaluate a predicate against a state. Pure and total: an unrecognised
 * predicate shape returns false rather than throwing, so a malformed content
 * file locks a gate instead of crashing a run in progress.
 *
 * @param {import('./types.js').GameState} state
 * @param {import('./types.js').Predicate|null} pred
 * @returns {boolean}
 */
export function evaluate(state, pred) {
  if (pred === null || typeof pred !== 'object') return false;

  if ('all' in pred) return pred.all.every((p) => evaluate(state, p));
  if ('any' in pred) return pred.any.some((p) => evaluate(state, p));
  if ('not' in pred) return !evaluate(state, pred.not);

  if ('atLeastN' in pred) {
    const { n, of } = pred.atLeastN;
    let hits = 0;
    for (const p of of) {
      if (evaluate(state, p)) hits++;
      if (hits >= n) return true; // short-circuit; `of` is small but this is free
    }
    return false;
  }

  if ('flag' in pred) return state.flags[pred.flag] === true;

  if ('meterAtLeast' in pred) {
    const { meter, value } = pred.meterAtLeast;
    return state.meters[meter] >= value;
  }

  if ('parcelStatusAtLeast' in pred) {
    const { parcel, status } = pred.parcelStatusAtLeast;
    const p = state.parcels[parcel];
    if (!p) return false;
    const have = statusRank(p.status);
    const want = statusRank(status);
    return have >= 0 && want >= 0 && have >= want;
  }

  if ('buildingOperational' in pred) return hasOperational(state, pred.buildingOperational);

  if ('relationshipAtLeast' in pred) {
    const { who, value } = pred.relationshipAtLeast;
    return state.relationships[who] >= value;
  }

  if ('counterAtLeast' in pred) {
    const { counter, value } = pred.counterAtLeast;
    return (state.counters[counter] ?? 0) >= value;
  }

  if ('derivedAtLeast' in pred) {
    const { metric, value } = pred.derivedAtLeast;
    return derived(state, metric) >= value;
  }

  return false;
}
