// @ts-check
/* reduce.js — the reducer. The only place state changes (SPEC §2.1).

   Rules this file lives under, all from SPEC §2:
     - pure: no Date.now(), no Math.random(), no network, no DOM, no console
     - imports nothing but types and content JSON
     - never mutates its input; every path returns a fresh object
     - all randomness comes from state.seed + state.rngCursor

   Illegal actions return the state unchanged rather than throwing. A reducer
   that throws on a bad action turns a UI bug into a lost run, and the action
   log has to replay cleanly even if it was recorded by an older build. The UI
   asks the selectors what is legal and greys out the rest. */

import { ACTS, PARCELS, BALANCE, buildingDef, studyDef } from '../../content/index.js';
import { drawInt } from './rng.js';
import { drawCard, freshDeck, resolveChoice } from './events.js';
import { evaluate } from './gates.js';
import {
  gatePassed,
  netOperatingIncome,
  quarterlyBurn,
  score,
  waterIsUnreachable,
} from './selectors.js';

export const SCHEMA_VERSION = 1;

/* ---------- small pure helpers ---------- */

/** @param {number} n @param {number} lo @param {number} hi */
const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/** Cash carries one decimal (SPEC §5). Rounding every write keeps replays
    byte-identical instead of accumulating float dust. @param {number} n */
const money = (n) => Math.round(n * 10) / 10;

/**
 * @param {import('./types.js').GameState} s
 * @param {string} text
 * @param {'info'|'good'|'bad'} kind
 * @returns {import('./types.js').LogEntry[]}
 */
function logged(s, text, kind = 'info') {
  const next = [...s.log, { turn: s.turn, text, kind }];
  return next.length > BALANCE.logLimit ? next.slice(next.length - BALANCE.logLimit) : next;
}

/**
 * The one place a timer's resolution turn is computed (see DECISIONS D4 note on
 * the §6.1 boundary). A timer scheduled on turn T with duration D resolves on
 * T+D, and fires during the END_TURN of turn T+D-1 — so the player sees it at
 * the start of turn T+D, having spent exactly D turns waiting.
 *
 * Every caller goes through this. Letting each action compute its own offset is
 * how studies, construction and freezes drift apart by a turn.
 *
 * @param {import('./types.js').GameState} s
 * @param {import('./types.js').TimerKind} kind
 * @param {string} refId
 * @param {number} durationTurns
 * @returns {import('./types.js').Timer}
 */
function scheduleTimer(s, kind, refId, durationTurns) {
  return {
    id: `${kind}:${refId}:${s.turn}`,
    kind,
    refId,
    resolvesOnTurn: s.turn + Math.max(1, durationTurns),
  };
}

/**
 * @param {import('./types.js').GameState} s
 * @param {Partial<import('./types.js').Meters>} delta
 * @returns {import('./types.js').Meters}
 */
function applyMeters(s, delta) {
  return {
    cash: money(s.meters.cash + (delta.cash ?? 0)),
    trust: clamp(s.meters.trust + (delta.trust ?? 0), 0, 100),
    paper: clamp(s.meters.paper + (delta.paper ?? 0), 0, 100),
    water: clamp(s.meters.water + (delta.water ?? 0), 0, 100),
  };
}

/**
 * @param {import('./types.js').Relationships} r
 * @param {Partial<import('./types.js').Relationships>} delta
 * @returns {import('./types.js').Relationships}
 */
function applyRelationships(r, delta) {
  const out = { ...r };
  for (const k of /** @type {import('./types.js').StakeholderId[]} */ (Object.keys(out))) {
    out[k] = clamp(out[k] + (delta[k] ?? 0), 0, 100);
  }
  return out;
}

/** @param {import('./types.js').GameState} s */
const spendAp = (s) => s.apRemaining - 1;

/** @param {import('./types.js').GameState} s */
const busy = (s) => s.status !== 'playing' || s.pendingEvent !== null || s.apRemaining <= 0;

/* ---------- START_RUN ---------- */

/**
 * @param {number} seed
 * @returns {import('./types.js').GameState}
 */
export function startRun(seed) {
  /** @type {Record<string, import('./types.js').Parcel>} */
  const parcels = {};
  for (const p of PARCELS) parcels[p.id] = { ...p, studiesComplete: [...p.studiesComplete] };

  // SPEC §9: water is drawn from the seed and hidden. Two cursor steps are
  // consumed before the deck is shuffled, so both are replayable.
  const w = drawInt(seed, 0, BALANCE.waterMin, BALANCE.waterMax);
  const d = freshDeck(seed, w.cursor);

  return {
    schemaVersion: SCHEMA_VERSION,
    seed,
    rngCursor: d.cursor,
    turn: 0,
    act: 0,
    apRemaining: BALANCE.actionPointsPerTurn,
    meters: {
      cash: money(BALANCE.start.cash),
      trust: BALANCE.start.trust,
      paper: BALANCE.start.paper,
      water: w.value,
    },
    waterSurveyed: false,
    parcels,
    buildings: [],
    timers: [],
    relationships: { ...BALANCE.start.relationships },
    counters: { cashPositiveStreak: 0 },
    engagedThisTurn: [],
    lastProgressTurn: 0,
    hand: [],
    deck: d.deck,
    discard: [],
    pendingEvent: null,
    flags: {},
    log: [{ turn: 0, text: 'Bare land, and nobody agrees who owns it.', kind: 'info' }],
    status: 'playing',
  };
}

/* ---------- player actions ---------- */

/**
 * @param {import('./types.js').GameState} s
 * @param {import('./types.js').EngageAction} a
 */
function engage(s, a) {
  if (busy(s)) return s;
  const tier = BALANCE.engage[String(a.intensity)];
  if (!tier || s.meters.cash < tier.cash) return s;
  if (s.engagedThisTurn.includes(a.stakeholder)) return s; // one engagement each per turn

  const meters = applyMeters(s, { cash: -tier.cash, trust: tier.trust });
  const relationships = applyRelationships(s.relationships, { [a.stakeholder]: tier.relationship });
  return {
    ...s,
    apRemaining: spendAp(s),
    meters,
    relationships,
    engagedThisTurn: [...s.engagedThisTurn, a.stakeholder],
    log: logged(s, `Engaged ${a.stakeholder} (level ${a.intensity}).`, 'good'),
  };
}

/**
 * @param {import('./types.js').GameState} s
 * @param {import('./types.js').CommissionStudyAction} a
 */
function commissionStudy(s, a) {
  if (busy(s)) return s;
  const def = studyDef(a.studyId);
  const parcel = s.parcels[a.parcelId];
  if (!def || !parcel) return s;
  if (def.requiresUnlock !== '' && !unlockedIn(s, def.requiresUnlock)) return s;
  if (s.meters.cash < def.cost) return s;
  if (parcel.studiesComplete.includes(def.id)) return s;
  if (s.timers.some((t) => t.kind === 'study' && t.refId === def.id)) return s;

  return {
    ...s,
    apRemaining: spendAp(s),
    meters: applyMeters(s, { cash: -def.cost }),
    timers: [...s.timers, scheduleTimer(s, 'study', def.id, def.turns)],
    log: logged(s, `Commissioned ${def.name} on ${a.parcelId}.`, 'info'),
  };
}

/**
 * @param {import('./types.js').GameState} s
 * @param {import('./types.js').AcquireRightsAction} a
 */
function acquireRights(s, a) {
  if (busy(s)) return s;
  const parcel = s.parcels[a.parcelId];
  const terms = BALANCE.rights[a.mode];
  if (!parcel || !terms) return s;
  if (parcel.status === 'frozen') return s;

  // Rights are a ladder: you cannot option what you already lease.
  const RANK = ['unknown', 'identified', 'optioned', 'leased', 'owned'];
  const target = a.mode === 'option' ? 'optioned' : a.mode === 'lease' ? 'leased' : 'owned';
  if (RANK.indexOf(parcel.status) >= RANK.indexOf(target)) return s;

  const cash = money(terms.cashPerHectare * parcel.hectares);
  if (s.meters.cash < cash) return s;
  if (s.meters.paper < terms.paperCost) return s; // DECISIONS D8

  /** @type {import('./types.js').Parcel} */
  const next = { ...parcel, status: /** @type {any} */ (target) };
  return {
    ...s,
    apRemaining: spendAp(s),
    meters: applyMeters(s, { cash: -cash, paper: -terms.paperCost, trust: -terms.trustCost }),
    parcels: { ...s.parcels, [a.parcelId]: next },
    log: logged(s, `${a.parcelId}: ${target} (R${cash}m).`, 'good'),
  };
}

/**
 * SPEC §8 — the sports field. The penalty is applied here, at BUILD time, and
 * the UI must not warn about it the first time.
 * @param {import('./types.js').GameState} s
 * @param {import('./types.js').BuildAction} a
 */
function build(s, a) {
  if (busy(s)) return s;
  const def = buildingDef(a.buildingTypeId);
  const parcel = s.parcels[a.parcelId];
  if (!def || !parcel) return s;
  if (def.requiresUnlock !== '' && !unlockedIn(s, def.requiresUnlock)) return s;
  if (s.meters.cash < def.buildCost) return s;
  if (parcel.status !== 'leased' && parcel.status !== 'owned') return s;
  if (s.buildings.some((b) => b.parcelId === a.parcelId)) return s;

  /* The signature mechanic (SPEC §8): displacement is charged in full unless
     the replacement was built first. Same action, opposite outcome, purely
     ordering. `sportsFieldReplaced` is set by MITIGATE on completion. */
  const mitigated = s.flags[`replaced:${a.parcelId}`] === true;
  const displacement = mitigated ? 0 : parcel.displacementCost;

  const id = `${def.id}@${a.parcelId}`;
  /** @type {Record<string, boolean>} */
  const flags = { ...s.flags };
  if (displacement > 0) flags.communityGrievance = true;

  return {
    ...s,
    apRemaining: spendAp(s),
    meters: applyMeters(s, { cash: -def.buildCost, trust: -displacement }),
    buildings: [
      ...s.buildings,
      { id, typeId: def.id, parcelId: a.parcelId, builtOnTurn: s.turn, operational: false },
    ],
    timers: [...s.timers, scheduleTimer(s, 'construction', id, def.buildTurns)],
    flags,
    log: logged(
      s,
      displacement > 0
        ? `Started ${def.name} on ${a.parcelId}, over the ${parcel.currentUse}.`
        : `Started ${def.name} on ${a.parcelId}.`,
      displacement > 0 ? 'bad' : 'info',
    ),
  };
}

/**
 * SPEC §8 — build the replacement first. Costs cash and three turns, and pays
 * +15 trust on completion rather than now.
 * @param {import('./types.js').GameState} s
 * @param {import('./types.js').MitigateAction} a
 */
function mitigate(s, a) {
  if (busy(s)) return s;
  const parcel = s.parcels[a.parcelId];
  const m = BALANCE.mitigation;
  if (!parcel || parcel.displacementCost <= 0) return s;
  if (s.flags[`replaced:${a.parcelId}`] === true) return s;
  if (s.meters.cash < m.cash) return s;
  if (s.timers.some((t) => t.kind === 'application' && t.refId === a.parcelId)) return s;

  return {
    ...s,
    apRemaining: spendAp(s),
    meters: applyMeters(s, { cash: -m.cash }),
    timers: [...s.timers, scheduleTimer(s, 'application', a.parcelId, m.turns)],
    log: logged(s, `Started a replacement for the ${parcel.currentUse} at ${a.parcelId}.`, 'good'),
  };
}

/**
 * @param {import('./types.js').GameState} s
 * @param {import('./types.js').ResolveEventAction} a
 */
function resolveEvent(s, a) {
  if (s.status !== 'playing' || s.pendingEvent === null) return s;
  const outcome = resolveChoice(s.pendingEvent, a.choiceId);
  if (!outcome) return s;

  return {
    ...s,
    meters: applyMeters(s, outcome.meters),
    relationships: applyRelationships(s.relationships, outcome.relationships),
    flags: { ...s.flags, ...outcome.flags },
    discard: [...s.discard, s.pendingEvent],
    pendingEvent: null,
    log: logged(s, outcome.text, 'info'),
  };
}

/**
 * SPEC §6.7 — advancing is a player decision, never automatic.
 * @param {import('./types.js').GameState} s
 */
function advanceAct(s) {
  if (s.status !== 'playing' || s.pendingEvent !== null) return s;
  if (!gatePassed(s)) return s;
  const next = /** @type {import('./types.js').ActId} */ (s.act + 1);
  const def = ACTS.find((x) => x.id === next);
  if (!def) return s;

  const counters = { ...s.counters };
  if (next === 6) counters.handoverEnteredTurn = s.turn;

  return {
    ...s,
    act: next,
    counters,
    log: logged(s, `Act ${next}: ${def.name}. ${def.subtitle}.`, 'good'),
  };
}

/** @param {import('./types.js').GameState} s @param {string} key */
function unlockedIn(s, key) {
  for (const a of ACTS) {
    if (a.id <= s.act && a.unlocks.includes(key)) return true;
  }
  return false;
}

/* ---------- END_TURN ---------- */

/**
 * SPEC §6. The nine steps run in exactly this order; the order is load-bearing
 * and the numbered comments below are the spec's own numbering. Do not reorder.
 *
 * @param {import('./types.js').GameState} state
 * @returns {import('./types.js').GameState}
 */
function endTurn(state) {
  if (state.status !== 'playing' || state.pendingEvent !== null) return state;

  let s = { ...state };
  let log = s.log;
  /** @param {string} t @param {'info'|'good'|'bad'} k */
  const say = (t, k = 'info') => {
    log = [...log, { turn: s.turn, text: t, kind: k }];
    if (log.length > BALANCE.logLimit) log = log.slice(log.length - BALANCE.logLimit);
  };

  /* --- 1. Timers tick. --- */
  /** @type {import('./types.js').Timer[]} */
  const remaining = [];
  let meters = { ...s.meters };
  let flags = { ...s.flags };
  let parcels = { ...s.parcels };
  let buildings = [...s.buildings];
  let waterSurveyed = s.waterSurveyed;
  let lastProgressTurn = s.lastProgressTurn;

  for (const t of s.timers) {
    if (t.resolvesOnTurn > s.turn + 1) {
      remaining.push(t);
      continue;
    }

    if (t.kind === 'study') {
      const def = studyDef(t.refId);
      if (def) {
        meters = {
          ...meters,
          paper: clamp(meters.paper + def.paperGain, 0, 100),
          water: clamp(meters.water + def.waterDelta, 0, 100),
        };
        if (def.revealsWater) waterSurveyed = true;
        if (def.setsFlag !== '') flags = { ...flags, [def.setsFlag]: true };
        say(`${def.name} complete.`, 'good');
        if (def.revealsWater) say(`Bulk water capacity reads ${meters.water}.`, 'info');
      }
    } else if (t.kind === 'construction') {
      const b = buildings.find((x) => x.id === t.refId);
      const def = b ? buildingDef(b.typeId) : null;
      if (b && def) {
        buildings = buildings.map((x) => (x.id === b.id ? { ...x, operational: true } : x));
        meters = { ...meters, trust: clamp(meters.trust + def.trustOnComplete, 0, 100) };
        lastProgressTurn = s.turn + 1; // SPEC §6.4 grace resets on visible progress
        say(`${def.name} is operational.`, 'good');
      }
    } else if (t.kind === 'application') {
      // Mitigation completed (SPEC §8): +15 trust and the parcel is cleared.
      flags = { ...flags, [`replaced:${t.refId}`]: true };
      if (t.refId === 'site2') flags = { ...flags, sportsFieldReplaced: true };
      meters = { ...meters, trust: clamp(meters.trust + BALANCE.mitigation.trustOnComplete, 0, 100) };
      lastProgressTurn = s.turn + 1;
      say(`The replacement at ${t.refId} is finished and handed over.`, 'good');
    } else if (t.kind === 'freeze') {
      const p = parcels[t.refId];
      if (p && p.status === 'frozen') {
        const { frozenUntilTurn: _drop, ...rest } = p;
        parcels = { ...parcels, [t.refId]: { ...rest, status: 'identified' } };
        say(`The freeze on ${t.refId} lifts.`, 'good');
      }
    } else if (t.kind === 'licence') {
      flags = { ...flags, [t.refId]: true };
      say(`${t.refId} granted.`, 'good');
    }
  }

  s = { ...s, timers: remaining, meters, flags, parcels, buildings, waterSurveyed, lastProgressTurn };

  /* --- 2. Income. --- */
  const noi = netOperatingIncome(s);
  if (noi !== 0) s = { ...s, meters: applyMeters(s, { cash: noi }) };

  /* --- 3. Burn. --- */
  const burn = quarterlyBurn(s);
  s = { ...s, meters: applyMeters(s, { cash: -burn }) };

  /* --- 4. Trust decay. SPEC §6.4 — the Act 1 pressure. --- */
  const sinceProgress = s.turn - s.lastProgressTurn;
  if (sinceProgress >= BALANCE.trustDecayGraceTurns) {
    const relief = BALANCE.trustDecayCommunityRelief * (s.relationships.community / 100);
    const decay = BALANCE.trustDecayPerTurn * (1 - relief);
    s = { ...s, meters: applyMeters(s, { trust: -decay }) };
    say('Another quarter with nothing to show for it.', 'bad');
  }

  /* --- 5. Relationship drift. SPEC §6.5 — neglect punished symmetrically. --- */
  {
    const r = { ...s.relationships };
    for (const k of /** @type {import('./types.js').StakeholderId[]} */ (Object.keys(r))) {
      if (s.engagedThisTurn.includes(k)) continue;
      const target = BALANCE.driftTarget;
      const step = BALANCE.driftPerTurn;
      r[k] = r[k] > target ? Math.max(target, r[k] - step) : Math.min(target, r[k] + step);
    }
    s = { ...s, relationships: r };
  }

  /* --- 6. Event draw. --- */
  if (s.pendingEvent === null && (s.deck.length > 0 || s.discard.length > 0)) {
    const d = drawCard(s.deck, s.discard, s.seed, s.rngCursor);
    s = { ...s, deck: d.deck, discard: d.discard, rngCursor: d.cursor, pendingEvent: d.card };
  }

  /* --- 7. Gate check. Sets a flag; never auto-advances (SPEC §6.7). --- */
  {
    const act = ACTS.find((a) => a.id === s.act);
    const open = act && act.gate !== null ? evaluate(s, act.gate) : false;
    if (open !== (s.flags.gateOpen === true)) {
      s = { ...s, flags: { ...s.flags, gateOpen: open } };
      if (open) say('The conditions to move on are met.', 'good');
    }
  }

  /* Cash-positive streak, for act 2's gate (DECISIONS D4). Counted here so it
     reflects the turn's completed cash position, not a mid-turn snapshot. */
  {
    const positive = s.meters.cash > 0 && noi - burn > 0;
    s = {
      ...s,
      counters: {
        ...s.counters,
        cashPositiveStreak: positive ? (s.counters.cashPositiveStreak ?? 0) + 1 : 0,
      },
    };
  }

  /* --- 8. Loss check, in order: blockade, sunk, dry (SPEC §6.8, §10). --- */
  if (s.meters.trust <= 0) {
    return {
      ...s,
      log: [...log, { turn: s.turn, text: 'The road is blocked. Nobody is coming back to the table.', kind: 'bad' }],
      status: 'lost',
      endingKind: 'blockade',
    };
  }
  if (s.meters.cash < 0 && s.act <= 1) {
    return {
      ...s,
      log: [...log, { turn: s.turn, text: 'The money ran out before anything was built.', kind: 'bad' }],
      status: 'lost',
      endingKind: 'sunk',
    };
  }
  if (s.act >= 4 && waterIsUnreachable(s)) {
    return {
      ...s,
      log: [...log, { turn: s.turn, text: 'There is not enough water, and no way left to find any.', kind: 'bad' }],
      status: 'lost',
      endingKind: 'dry',
    };
  }

  /* Handover terminates the run after a fixed number of turns (DECISIONS D11.2). */
  if (s.act === 6) {
    const entered = s.counters.handoverEnteredTurn ?? s.turn;
    if (s.turn + 1 - entered >= BALANCE.handoverTurns) {
      const final = score(s);
      const hollow =
        s.meters.cash > BALANCE.extractionCashThreshold &&
        s.meters.trust < BALANCE.extractionTrustFloor;
      return {
        ...s,
        turn: s.turn + 1,
        log: [
          ...log,
          {
            turn: s.turn + 1,
            text: hollow
              ? 'You leave with a profitable asset and a town that never became one.'
              : 'Handover. The node is somebody else’s to run now.',
            kind: hollow ? 'bad' : 'good',
          },
        ],
        status: 'won',
        endingKind: hollow ? 'extraction' : 'handover',
        score: final,
      };
    }
  }

  /* --- 9. Increment turn. --- */
  return {
    ...s,
    turn: s.turn + 1,
    apRemaining: BALANCE.actionPointsPerTurn,
    engagedThisTurn: [],
    log,
  };
}

/* ---------- the reducer ---------- */

/**
 * @param {import('./types.js').GameState} state
 * @param {import('./types.js').Action} action
 * @returns {import('./types.js').GameState}
 */
export function reduce(state, action) {
  switch (action.type) {
    case 'START_RUN':
      return startRun(action.seed);
    case 'ENGAGE':
      return engage(state, action);
    case 'COMMISSION_STUDY':
      return commissionStudy(state, action);
    case 'ACQUIRE_RIGHTS':
      return acquireRights(state, action);
    case 'BUILD':
      return build(state, action);
    case 'MITIGATE':
      return mitigate(state, action);
    case 'RESOLVE_EVENT':
      return resolveEvent(state, action);
    case 'ADVANCE_ACT':
      return advanceAct(state);
    case 'END_TURN':
      return endTurn(state);
    default: {
      /* Exhaustiveness: if a variant is added to the Action union without a case
         here, `never` fails the typecheck. At runtime an unknown action is a
         no-op, so an old save's action log still replays. */
      /** @type {never} */
      const _exhaustive = action;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Replay an action log from scratch. SPEC §2.2's guarantee lives or dies here.
 * @param {import('./types.js').Action[]} actions
 * @param {import('./types.js').GameState} [initial]
 * @returns {import('./types.js').GameState}
 */
export function replay(actions, initial) {
  let s = initial ?? startRun(0);
  for (const a of actions) s = reduce(s, a);
  return s;
}
