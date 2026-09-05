// @ts-check
/* selectors.js — pure derived reads (SPEC §4). No state changes here, ever.

   The UI must go through this module rather than reaching into GameState, for
   one reason above all: visibleWater. */

import { ACTS, BUILDINGS, STUDIES, BALANCE, buildingDef, studyDef } from '../../content/index.js';
import { evaluate } from './gates.js';

/**
 * The ONLY sanctioned read of meters.water (SPEC §9).
 *
 * Worth being precise about what this does and does not do. `meters.water` is a
 * field of GameState, which is serialized to localStorage and synced — a player
 * with devtools can read the number in ten seconds. This is not, and cannot be,
 * concealment. It is a UI contract: while the survey is uncommissioned the game
 * does not tell you, so the decision to skip the survey is a decision made
 * without the number. That is the whole mechanic, and it survives the fact that
 * a determined player could cheat it.
 *
 * @param {import('./types.js').GameState} state
 * @returns {number|null} null while unsurveyed — render as "?"
 */
export function visibleWater(state) {
  return state.waterSurveyed ? state.meters.water : null;
}

/**
 * @param {import('./types.js').GameState} state
 * @param {number} cost
 */
export function canAfford(state, cost) {
  return state.meters.cash >= cost;
}

/** @param {import('./types.js').GameState} state */
export function currentAct(state) {
  return ACTS.find((a) => a.id === state.act) ?? null;
}

/**
 * Everything unlocked by every act up to and including the current one. Acts
 * are cumulative — reaching act 3 does not withdraw act 1's forecourt.
 * @param {import('./types.js').GameState} state
 * @returns {string[]}
 */
export function unlocks(state) {
  /** @type {string[]} */
  const out = [];
  for (const a of ACTS) {
    if (a.id <= state.act) out.push(...a.unlocks);
  }
  return out;
}

/**
 * @param {import('./types.js').GameState} state
 * @param {string} key  e.g. 'build:forecourt'; '' always passes
 */
export function isUnlocked(state, key) {
  return key === '' || unlocks(state).includes(key);
}

/**
 * Has the current act's gate been satisfied? SPEC §6.7 — this only makes
 * ADVANCE_ACT legal; it never advances the act by itself.
 * @param {import('./types.js').GameState} state
 */
export function gatePassed(state) {
  const act = currentAct(state);
  if (!act || act.gate === null) return false;
  return evaluate(state, act.gate);
}

/** @param {import('./types.js').GameState} state */
export function householdsWithTitle(state) {
  return state.buildings.reduce(
    (n, b) => n + (b.operational ? (buildingDef(b.typeId)?.households ?? 0) : 0),
    0,
  );
}

/** @param {import('./types.js').GameState} state */
export function jobsInCatchment(state) {
  return state.buildings.reduce(
    (n, b) => n + (b.operational ? (buildingDef(b.typeId)?.jobs ?? 0) : 0),
    0,
  );
}

/**
 * SPEC §10. Cash contributes nothing, deliberately — a run that ends rich and
 * empty scores below one that ends broke and inhabited.
 * @param {import('./types.js').GameState} state
 * @returns {import('./types.js').Score}
 */
export function score(state) {
  const w = BALANCE.score;
  const households = householdsWithTitle(state);
  const jobs = jobsInCatchment(state);
  const trust = Math.round(state.meters.trust);
  return {
    householdsWithTitle: households,
    jobsInCatchment: jobs,
    trustAtHandover: trust,
    total: households * w.householdWeight + jobs * w.jobWeight + trust * w.trustWeight,
  };
}

/**
 * Net quarterly cash from operational buildings (SPEC §6.2).
 * @param {import('./types.js').GameState} state
 */
export function netOperatingIncome(state) {
  return state.buildings.reduce((sum, b) => {
    if (!b.operational) return sum;
    const def = buildingDef(b.typeId);
    return def ? sum + def.quarterlyRevenue - def.quarterlyOpex : sum;
  }, 0);
}

/** @param {import('./types.js').GameState} state */
export function quarterlyBurn(state) {
  return BALANCE.quarterlyBurn * (currentAct(state)?.burnMultiplier ?? 1);
}

/**
 * Studies that would raise bulk water and have not been done (DECISIONS D7).
 * The `dry` loss check asks this whether any route out remains.
 * @param {import('./types.js').GameState} state
 */
export function remainingWaterOptions(state) {
  return STUDIES.filter(
    (s) =>
      s.waterDelta > 0 &&
      s.setsFlag !== '' &&
      state.flags[s.setsFlag] !== true &&
      !state.timers.some((t) => t.kind === 'study' && t.refId === s.id),
  );
}

/**
 * True when act 4's wall is unreachable: below threshold, nothing in flight,
 * and nothing affordable left to try. SPEC §9's "no remaining means to raise it",
 * made concrete by D7.
 * @param {import('./types.js').GameState} state
 */
export function waterIsUnreachable(state) {
  if (state.meters.water >= BALANCE.waterWallThreshold) return false;
  const pending = state.timers.some(
    (t) => t.kind === 'study' && (studyDef(t.refId)?.waterDelta ?? 0) > 0,
  );
  if (pending) return false;
  const options = remainingWaterOptions(state);
  if (options.length === 0) return true;
  // Could any single remaining option, if affordable, clear the wall?
  const best = Math.max(...options.map((s) => s.waterDelta));
  const cheapest = Math.min(...options.map((s) => s.cost));
  if (state.meters.water + best < BALANCE.waterWallThreshold) return true;
  return !canAfford(state, cheapest);
}

/** @param {import('./types.js').GameState} state */
export function operationalTags(state) {
  const tags = state.buildings
    .filter((b) => b.operational)
    .map((b) => BUILDINGS.find((d) => d.id === b.typeId)?.tag)
    .filter((t) => typeof t === 'string');
  return [...new Set(tags)];
}
