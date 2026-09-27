// @ts-check
/* store.js — the state container. SPEC §3 asks for `useReducer` wrapped in a
   context; without React that is this: one state, one dispatch, one subscriber
   list, and localStorage underneath.

   Everything impure lives on this side of the line. The engine cannot read the
   clock or storage (SPEC §2.1), so the seed is chosen here and handed in.

   The action log is kept alongside the state. It is not needed to play — the
   state alone is enough to resume — but it is what makes SPEC §2.2's replay
   guarantee useful in practice, and it is what a leaderboard would validate
   against later (DECISIONS D2). */

import { reduce, startRun, SCHEMA_VERSION } from '../engine/reduce.js';

const KEY = 'node_run';

/** @typedef {import('../engine/types.js').GameState} GameState */
/** @typedef {import('../engine/types.js').Action} Action */

/** @type {GameState} */
let state;
/** @type {Action[]} */
let actionLog = [];
/** @type {(() => void)[]} */
const listeners = [];

/** @returns {{ state: GameState, log: Action[] } | null} */
function loadSaved() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // A schema bump means the shape changed under an old save; start fresh
    // rather than feed the reducer something it no longer understands.
    if (!saved?.state || saved.state.schemaVersion !== SCHEMA_VERSION) return null;
    return { state: saved.state, log: Array.isArray(saved.log) ? saved.log : [] };
  } catch {
    return null; // private mode, cleared storage, corrupt JSON — all the same
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ state, log: actionLog }));
  } catch {
    /* Storage full or blocked. The run continues in memory — losing the save is
       bad, losing the turn the player just took is worse. */
  }
}

/** A seed the engine could never produce for itself (SPEC §2.1). */
const freshSeed = () => (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;

/**
 * Resume the saved run, or start a new one.
 *
 * A `?seed=` in the URL means "play this run", not "restart it every time the
 * page loads" — so a save is resumed whenever it IS that run. Without this,
 * refreshing a seeded URL silently threw the run away.
 *
 * @param {number} [seed]
 */
export function init(seed) {
  const found = loadSaved();
  const saved = found && (seed === undefined || found.state.seed === seed) ? found : null;
  if (saved) {
    state = saved.state;
    actionLog = saved.log;
  } else {
    const s = seed ?? freshSeed();
    actionLog = [{ type: 'START_RUN', seed: s }];
    state = startRun(s);
    save();
  }
  return state;
}

export const getState = () => state;
export const getLog = () => actionLog;

/** @param {Action} action */
export function dispatch(action) {
  const next = reduce(state, action);
  if (next === state) return state; // illegal; the UI should have greyed it out
  state = next;
  actionLog.push(action);
  save();
  for (const fn of listeners) fn();
  return state;
}

/** @param {() => void} fn */
export function subscribe(fn) {
  listeners.push(fn);
}

/** Start over. Keeps the seed when one is given, so a run can be retried
    exactly — which is what SPEC §9's end card offers after a dry ending. */
/** @param {number} [seed] */
export function restart(seed) {
  try {
    localStorage.removeItem(KEY);
  } catch { /* nothing to clean up */ }
  init(seed);
  for (const fn of listeners) fn();
}
