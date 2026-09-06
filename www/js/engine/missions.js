// @ts-check
/* missions.js — jobs the five characters give Sakhile (DECISIONS D13).

   Almost all of the work here is done by gates.js. A mission is a predicate
   that offers it, a predicate that completes it, a deadline and a payout, so
   the evaluator written for act gates does the evaluating and this module only
   moves ids between four buckets.

   Nothing here draws from the RNG. Missions are entirely a function of state,
   which keeps the replay guarantee (SPEC §2.2) trivially intact — a mission
   cannot desynchronise a replay because there is nothing to desynchronise.

   Like events.js, this module decides WHAT happens and returns deltas.
   reduce.js owns all state assembly (SPEC §2.1). */

import { MISSIONS, missionDef, stakeholderDef } from '../../content/index.js';
import { evaluate } from './gates.js';

/**
 * Has this mission been seen at all — offered, running, done or blown?
 * @param {import('./types.js').MissionState} m
 * @param {string} id
 */
export function known(m, id) {
  return (
    m.offered.includes(id) ||
    m.accepted.some((a) => a.id === id) ||
    m.completed.includes(id) ||
    m.failed.includes(id)
  );
}

/** @param {import('./types.js').GameState} s @param {string} id */
export function isOffered(s, id) {
  return s.missions.offered.includes(id);
}

/** @param {import('./types.js').GameState} s @param {string} id */
export function isAccepted(s, id) {
  return s.missions.accepted.some((a) => a.id === id);
}

/**
 * Turns left before an accepted mission expires, or null when it never does.
 * @param {import('./types.js').GameState} s
 * @param {string} id
 * @returns {number|null}
 */
export function turnsLeft(s, id) {
  const a = s.missions.accepted.find((x) => x.id === id);
  const def = missionDef(id);
  if (!a || !def || def.expiresAfter <= 0) return null;
  return a.acceptedOnTurn + def.expiresAfter - s.turn;
}

/**
 * Merge one MissionReward into running delta accumulators. Mutates the
 * accumulators, which are local to the caller — nothing in state is touched.
 *
 * @param {import('./types.js').MissionReward} r
 * @param {Record<string, number>} meters
 * @param {Record<string, number>} rel
 * @param {Record<string, boolean>} flags
 */
function accumulate(r, meters, rel, flags) {
  for (const [k, v] of Object.entries(r.meters ?? {})) meters[k] = (meters[k] ?? 0) + v;
  for (const [k, v] of Object.entries(r.relationships ?? {})) rel[k] = (rel[k] ?? 0) + v;
  for (const [k, v] of Object.entries(r.flags ?? {})) flags[k] = v;
}

/** @param {string} giver */
function who(giver) {
  return stakeholderDef(giver)?.name ?? giver;
}

/**
 * One turn of mission housekeeping, run from END_TURN.
 *
 * Order inside the tick matters: completions are settled BEFORE expiries, so a
 * mission finished on its very last turn pays out rather than blowing up. New
 * offers come last, so a mission cannot be offered and expire in one turn.
 *
 * @param {import('./types.js').GameState} s
 * @returns {{
 *   missions: import('./types.js').MissionState,
 *   meters: Record<string, number>,
 *   relationships: Record<string, number>,
 *   flags: Record<string, boolean>,
 *   entries: { text:string, kind:'info'|'good'|'bad' }[],
 * }}
 */
export function tick(s) {
  /** @type {Record<string, number>} */ const meters = {};
  /** @type {Record<string, number>} */ const relationships = {};
  /** @type {Record<string, boolean>} */ const flags = {};
  /** @type {{ text:string, kind:'info'|'good'|'bad' }[]} */ const entries = [];

  const offered = [...s.missions.offered];
  const completed = [...s.missions.completed];
  const failed = [...s.missions.failed];
  /** @type {import('./types.js').AcceptedMission[]} */
  let accepted = [];

  /* 1. Completions. */
  for (const a of s.missions.accepted) {
    const def = missionDef(a.id);
    if (!def) continue; // content changed under an old save: drop it quietly
    if (evaluate(s, def.completeWhen)) {
      accumulate(def.reward, meters, relationships, flags);
      completed.push(a.id);
      entries.push({ text: `${who(def.giver)}: “${def.title}” — done.`, kind: 'good' });
    } else {
      accepted.push(a);
    }
  }

  /* 2. Expiries, on what did not complete. */
  const stillRunning = [];
  for (const a of accepted) {
    const def = missionDef(a.id);
    if (!def) continue;
    const expired = def.expiresAfter > 0 && s.turn + 1 - a.acceptedOnTurn >= def.expiresAfter;
    if (expired) {
      accumulate(def.failure, meters, relationships, flags);
      failed.push(a.id);
      entries.push({ text: `${who(def.giver)} stopped waiting on “${def.title}”.`, kind: 'bad' });
    } else {
      stillRunning.push(a);
    }
  }
  accepted = stillRunning;

  /* 3. New offers. Content order is the tiebreak, so this stays deterministic
     without touching the RNG. */
  const next = { offered, accepted, completed, failed };
  for (const def of MISSIONS) {
    if (known(next, def.id)) continue;
    if (evaluate(s, def.offeredWhen)) {
      offered.push(def.id);
      entries.push({ text: `${who(def.giver)} has something to ask: “${def.title}”.`, kind: 'info' });
    }
  }

  return { missions: next, meters, relationships, flags, entries };
}

/**
 * Accept an offered mission. Free in action points — taking the job is not the
 * work, and charging for it would just tax the player for engaging with the
 * story.
 *
 * @param {import('./types.js').GameState} s
 * @param {string} id
 * @returns {import('./types.js').MissionState|null} null when illegal
 */
export function accept(s, id) {
  if (!s.missions.offered.includes(id)) return null;
  if (!missionDef(id)) return null;
  return {
    ...s.missions,
    offered: s.missions.offered.filter((x) => x !== id),
    accepted: [...s.missions.accepted, { id, acceptedOnTurn: s.turn }],
  };
}

/**
 * Decline an offered mission. It goes to `failed` rather than back on the
 * table: saying no to Bra Sipho is an answer, not a deferral, and he does not
 * ask twice.
 *
 * @param {import('./types.js').GameState} s
 * @param {string} id
 * @returns {{ missions: import('./types.js').MissionState,
 *             cost: import('./types.js').MissionReward, title: string }|null}
 */
export function decline(s, id) {
  if (!s.missions.offered.includes(id)) return null;
  const def = missionDef(id);
  if (!def) return null;
  return {
    missions: {
      ...s.missions,
      offered: s.missions.offered.filter((x) => x !== id),
      failed: [...s.missions.failed, id],
    },
    cost: def.declineCost ?? {},
    title: def.title,
  };
}

/** @returns {import('./types.js').MissionState} */
export function emptyMissions() {
  return { offered: [], accepted: [], completed: [], failed: [] };
}
