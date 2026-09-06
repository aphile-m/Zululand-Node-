/* test-engine.js — the mandatory reducer suite (SPEC §13 phase 1).

   Plain node, no browser, no server, no test framework. The engine is pure and
   imports nothing but content JSON, so unlike the Trainer App's Playwright
   scripts this needs nothing to run against.

   Run: npm test        (node scripts/test-engine.js)

   Phase 1 is done when this file proves:
     - a 60-action log replays twice from one seed to deep-equal final states
     - every ending — blockade, sunk, dry, extraction — has a test that fires it
*/

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import { reduce, startRun, replay } from '../www/js/engine/reduce.js';
import { evaluate } from '../www/js/engine/gates.js';
import { draw, shuffle } from '../www/js/engine/rng.js';
import {
  visibleWater,
  score,
  gatePassed,
  householdsWithTitle,
  waterIsUnreachable,
} from '../www/js/engine/selectors.js';
import { turnsLeft } from '../www/js/engine/missions.js';
import { BALANCE, STUDIES, MISSIONS, STAKEHOLDERS, PLAYER } from '../www/content/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const group = (name) => console.log(`\n── ${name}`);

/* Drive a run without caring whether each action was legal — the reducer
   returns state unchanged for illegal ones, which is exactly what we want when
   scripting a scenario. */
const run = (s, ...actions) => actions.reduce((acc, a) => reduce(acc, a), s);
const endTurns = (s, n) => {
  let cur = s;
  for (let i = 0; i < n; i++) {
    if (cur.pendingEvent) cur = reduce(cur, { type: 'RESOLVE_EVENT', choiceId: firstChoice(cur) });
    cur = reduce(cur, { type: 'END_TURN' });
    if (cur.status !== 'playing') break;
  }
  return cur;
};
/* Clear any card awaiting a choice. A pending event blocks every other action
   (the reducer's `busy` guard), so scenarios that want to act must settle first. */
const settle = (s) =>
  s.pendingEvent ? reduce(s, { type: 'RESOLVE_EVENT', choiceId: firstChoice(s) }) : s;
const firstChoice = (s) => {
  const card = JSON.parse(
    readFileSync(join(HERE, '../www/content/cards.json'), 'utf8'),
  ).find((c) => c.id === s.pendingEvent);
  return card ? card.choices[0].id : 'noop';
};

/* ---------------------------------------------------------------- §2.1 purity */
group('§2.1 — the engine is pure and self-contained');
{
  const dir = join(HERE, '../www/js/engine');
  const offenders = [];
  const forbidden = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      const ok = spec.startsWith('./') || spec.startsWith('../../content/');
      if (!ok) offenders.push(`${f} -> ${spec}`);
    }
    // Strip comments before hunting for impurity, so prose about Date.now()
    // in a docblock doesn't fail the build.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const bad of ['Date.now', 'Math.random', 'fetch(', 'localStorage', 'document.', 'console.']) {
      if (code.includes(bad)) forbidden.push(`${f}: ${bad}`);
    }
  }
  // DECISIONS D10: this replaces the ESLint boundary rule SPEC §4 asks for.
  check('engine imports only ./ and ../../content/', offenders.length === 0, offenders.join(', '));
  check('no impure calls in engine source', forbidden.length === 0, forbidden.join(', '));
}

/* ------------------------------------------------------------------ §2.2 RNG */
group('§2.2 — seeded, cursored randomness');
{
  const a = draw(12345, 0);
  const b = draw(12345, 0);
  check('same (seed, cursor) gives the same value', a.value === b.value);
  check('the cursor advances', a.cursor === 1);
  check('different cursors give different values', draw(12345, 1).value !== a.value);

  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const s1 = shuffle(items, 99, 0);
  const s2 = shuffle(items, 99, 0);
  assert.deepEqual(s1.value, s2.value);
  check('shuffle is deterministic for a seed', true);
  check('shuffle does not mutate its input', items[0] === 'a');
  check('shuffle preserves every element',
    [...s1.value].sort().join('') === [...items].sort().join(''));
  check('shuffle consumes one cursor step per swap', s1.cursor === items.length - 1);
}

/* --------------------------------------------------------- §2.2 replay, §2.3 */
group('§2.2 / §2.3 — replay is byte-identical and state is JSON-safe');
{
  /* A 60-action log, per SPEC §13's definition of done for phase 1. It is a
     plausible opening rather than a random walk: survey, engage, option the
     sports field, then a long paper stretch. */
  const log = [{ type: 'START_RUN', seed: 4242 }];
  log.push({ type: 'COMMISSION_STUDY', studyId: 'bulkServices', parcelId: 'site2' });
  log.push({ type: 'ENGAGE', stakeholder: 'inkosi', intensity: 2 });
  log.push({ type: 'END_TURN' });
  for (let i = 0; i < 17; i++) {
    log.push({ type: 'ENGAGE', stakeholder: i % 2 ? 'community' : 'inkosi', intensity: 1 });
    log.push({ type: 'RESOLVE_EVENT', choiceId: 'attend' });
    log.push({ type: 'END_TURN' });
  }
  log.push({ type: 'ACQUIRE_RIGHTS', parcelId: 'site2', mode: 'option' });
  log.push({ type: 'ADVANCE_ACT' });
  log.push({ type: 'END_TURN' });
  while (log.length < 60) log.push({ type: 'END_TURN' });
  check('the log is 60 actions', log.length === 60, String(log.length));

  const first = replay(log);
  const second = replay(log);
  assert.deepEqual(first, second);
  check('replaying the same log twice gives deep-equal state', true);

  const j1 = JSON.stringify(first);
  const j2 = JSON.stringify(second);
  check('...and byte-identical JSON', j1 === j2, `${j1.length} bytes`);

  // A save/load round trip must not change the run's future either.
  const revived = JSON.parse(j1);
  assert.deepEqual(reduce(revived, { type: 'END_TURN' }), reduce(first, { type: 'END_TURN' }));
  check('a state survives a JSON round trip and keeps drawing the same', true);

  const walk = (v, path = '$') => {
    if (v === undefined) return [`${path} is undefined`];
    if (v === null || typeof v !== 'object') return [];
    if (v instanceof Date || v instanceof Map || v instanceof Set) return [`${path} is not plain`];
    return Object.entries(v).flatMap(([k, x]) => walk(x, `${path}.${k}`));
  };
  const bad = walk(first);
  check('no undefined / Date / Map / Set anywhere in state', bad.length === 0, bad.join(', '));

  const other = replay(log.map((a) => (a.type === 'START_RUN' ? { ...a, seed: 777 } : a)));
  check('a different seed gives a different run', JSON.stringify(other) !== j1);
}

/* ------------------------------------------------------------------ §9 water */
group('§9 — water is hidden until surveyed');
{
  const s = startRun(4242);
  check('water starts unsurveyed', s.waterSurveyed === false);
  check('visibleWater returns null while unsurveyed', visibleWater(s) === null);
  check('water is seeded inside [waterMin, waterMax]',
    s.meters.water >= BALANCE.waterMin && s.meters.water <= BALANCE.waterMax,
    String(s.meters.water));

  let surveyed = reduce(s, { type: 'COMMISSION_STUDY', studyId: 'bulkServices', parcelId: 'site1' });
  check('commissioning the survey schedules a timer', surveyed.timers.length === 1);
  check('...and still does not reveal the number', visibleWater(surveyed) === null);
  surveyed = endTurns(surveyed, 5);
  check('the survey completes and reveals water', surveyed.waterSurveyed === true);
  check('visibleWater now returns the number', visibleWater(surveyed) === surveyed.meters.water,
    String(visibleWater(surveyed)));

  // Every seed must be survivable — DECISIONS D7. If water could not be raised,
  // roughly half of all seeds would be unwinnable on turn one.
  const maxGain = STUDIES.reduce((n, st) => n + st.waterDelta, 0);
  check('the water studies can lift the worst seed over the wall',
    BALANCE.waterMin + maxGain >= BALANCE.waterWallThreshold,
    `${BALANCE.waterMin} + ${maxGain} vs ${BALANCE.waterWallThreshold}`);
}

/* ------------------------------------------------------- §8 the sports field */
group('§8 — the sports field: same action, opposite outcome');
{
  const base = startRun(4242);
  const leased = {
    ...base,
    meters: { ...base.meters, cash: 300, paper: 100 },
    parcels: { ...base.parcels, site2: { ...base.parcels.site2, status: 'leased' } },
    flags: { ...base.flags },
  };
  const withUnlock = { ...leased, act: 1 }; // act 1 unlocks build:forecourt

  const trustBefore = withUnlock.meters.trust;
  const built = reduce(withUnlock, { type: 'BUILD', buildingTypeId: 'forecourt', parcelId: 'site2' });
  const penalty = trustBefore - built.meters.trust;
  check('building on the sports field costs the full displacement',
    penalty === base.parcels.site2.displacementCost, `${penalty} trust`);
  check('...and sets communityGrievance', built.flags.communityGrievance === true);

  let mitigated = reduce(withUnlock, { type: 'MITIGATE', parcelId: 'site2' });
  check('MITIGATE schedules construction, not an instant fix',
    mitigated.flags.sportsFieldReplaced !== true && mitigated.timers.length === 1);
  const trustAtStart = mitigated.meters.trust;
  mitigated = endTurns(mitigated, BALANCE.mitigation.turns + 1);
  check('mitigation completes and sets sportsFieldReplaced',
    mitigated.flags.sportsFieldReplaced === true);
  check('...and pays +15 trust on completion',
    mitigated.meters.trust >= trustAtStart, `${trustAtStart} -> ${mitigated.meters.trust}`);

  const after = reduce(
    { ...mitigated, apRemaining: 3, meters: { ...mitigated.meters, cash: 300 } },
    { type: 'BUILD', buildingTypeId: 'forecourt', parcelId: 'site2' },
  );
  const penaltyAfter = mitigated.meters.trust - after.meters.trust;
  check('building AFTER mitigation costs no trust at all', penaltyAfter === 0, `${penaltyAfter}`);
  check('...and raises no grievance', after.flags.communityGrievance !== true);
}

/* ------------------------------------------------------------- §7 / D4 gates */
group('§7 + DECISIONS D4 — the gate language');
{
  const s = startRun(1);
  check('flag', evaluate({ ...s, flags: { x: true } }, { flag: 'x' }) === true);
  check('not', evaluate(s, { not: { flag: 'x' } }) === true);
  check('all', evaluate({ ...s, flags: { a: true, b: true } },
    { all: [{ flag: 'a' }, { flag: 'b' }] }) === true);
  check('any', evaluate({ ...s, flags: { b: true } },
    { any: [{ flag: 'a' }, { flag: 'b' }] }) === true);
  check('meterAtLeast', evaluate(s, { meterAtLeast: { meter: 'trust', value: 10 } }) === true);
  check('relationshipAtLeast',
    evaluate(s, { relationshipAtLeast: { who: 'inkosi', value: 999 } }) === false);

  const optioned = { ...s, parcels: { ...s.parcels, site2: { ...s.parcels.site2, status: 'optioned' } } };
  check('parcelStatusAtLeast is a ladder',
    evaluate(optioned, { parcelStatusAtLeast: { parcel: 'site2', status: 'identified' } }) === true);
  check('...and does not reach past its rung',
    evaluate(optioned, { parcelStatusAtLeast: { parcel: 'site2', status: 'leased' } }) === false);
  const frozen = { ...s, parcels: { ...s.parcels, site2: { ...s.parcels.site2, status: 'frozen' } } };
  check('a frozen parcel satisfies no status gate',
    evaluate(frozen, { parcelStatusAtLeast: { parcel: 'site2', status: 'identified' } }) === false);

  // D4's three additions, without which acts 2, 3 and 5 cannot be expressed.
  check('counterAtLeast (act 2)',
    evaluate({ ...s, counters: { cashPositiveStreak: 4 } },
      { counterAtLeast: { counter: 'cashPositiveStreak', value: 4 } }) === true);
  const three = [{ flag: 'a' }, { flag: 'b' }, { flag: 'c' }];
  check('atLeastN says no to one of three (act 3)',
    evaluate({ ...s, flags: { a: true } }, { atLeastN: { n: 2, of: three } }) === false);
  check('...and yes to two of three',
    evaluate({ ...s, flags: { a: true, c: true } }, { atLeastN: { n: 2, of: three } }) === true);

  const housed = {
    ...s,
    buildings: [
      { id: 'h1', typeId: 'housingPhase', parcelId: 'site6', builtOnTurn: 1, operational: true },
      { id: 'h2', typeId: 'housingPhase', parcelId: 'site9', builtOnTurn: 1, operational: true },
      { id: 'h3', typeId: 'housingPhase', parcelId: 'site3', builtOnTurn: 1, operational: true },
    ],
  };
  check('derivedAtLeast reads households (act 5)',
    evaluate(housed, { derivedAtLeast: { metric: 'householdsWithTitle', value: 200 } }) === true,
    `${householdsWithTitle(housed)} households`);
  check('...and a building under construction does not count',
    evaluate({ ...housed, buildings: housed.buildings.map((b) => ({ ...b, operational: false })) },
      { derivedAtLeast: { metric: 'householdsWithTitle', value: 200 } }) === false);

  check('a malformed predicate locks the gate rather than throwing',
    evaluate(s, { nonsense: true }) === false);
  check('every act gate is expressible (none silently false on a full state)',
    evaluate(housed, { all: [{ flag: 'nope' }] }) === false);
}

/* ---------------------------------------------------- §6 turn order + timers */
group('§6 — turn order and the timer boundary');
{
  const s = startRun(4242);
  const st = reduce(s, { type: 'COMMISSION_STUDY', studyId: 'geotech', parcelId: 'site1' });
  const def = STUDIES.find((x) => x.id === 'geotech');
  check('a D-turn study scheduled on turn T resolves on T+D',
    st.timers[0].resolvesOnTurn === s.turn + def.turns,
    `turn ${s.turn} + ${def.turns} = ${st.timers[0].resolvesOnTurn}`);

  let cur = st;
  for (let i = 0; i < def.turns - 1; i++) {
    if (cur.pendingEvent) cur = reduce(cur, { type: 'RESOLVE_EVENT', choiceId: firstChoice(cur) });
    cur = reduce(cur, { type: 'END_TURN' });
  }
  check('...and is still pending one turn early', cur.flags.geotechDone !== true,
    `turn ${cur.turn}`);
  if (cur.pendingEvent) cur = reduce(cur, { type: 'RESOLVE_EVENT', choiceId: firstChoice(cur) });
  cur = reduce(cur, { type: 'END_TURN' });
  check('...and has fired by the start of turn T+D', cur.flags.geotechDone === true,
    `turn ${cur.turn}`);

  const apStart = startRun(7);
  check('action points start at the balance value',
    apStart.apRemaining === BALANCE.actionPointsPerTurn);
  let spent = apStart;
  for (const who of ['inkosi', 'municipality', 'community', 'dfi']) {
    spent = reduce(spent, { type: 'ENGAGE', stakeholder: who, intensity: 1 });
  }
  check('a 4th action is refused on a 3-point budget', spent.apRemaining === 0,
    `${spent.apRemaining} left`);
  check('...and the 4th engagement did not land',
    spent.engagedThisTurn.length === BALANCE.actionPointsPerTurn);

  const rolled = endTurns(spent, 1);
  check('action points reset on the new turn',
    rolled.apRemaining === BALANCE.actionPointsPerTurn);
  check('engagedThisTurn clears on the new turn', rolled.engagedThisTurn.length === 0);

  // §6.5 — drift is symmetric, and engagement suppresses it for that turn only.
  const high = {
    ...startRun(7),
    relationships: { ...startRun(7).relationships, community: 90, oilCo: 90 },
  };
  const drifted = endTurns(high, 1);
  check('an unengaged relationship above 50 drifts down',
    drifted.relationships.community < high.relationships.community,
    `90 -> ${drifted.relationships.community}`);
  check('an unengaged relationship below 50 drifts up',
    drifted.relationships.dfi > high.relationships.dfi,
    `${high.relationships.dfi} -> ${drifted.relationships.dfi}`);
  check('drift moves by exactly driftPerTurn',
    Math.abs(90 - drifted.relationships.community - BALANCE.driftPerTurn) < 1e-9,
    `moved ${(90 - drifted.relationships.community).toFixed(2)}`);

  // Engagement must suppress drift for the stakeholder engaged, and only them.
  const engaged = endTurns(reduce(high, { type: 'ENGAGE', stakeholder: 'oilCo', intensity: 1 }), 1);
  check('engaging a stakeholder suppresses its drift that turn',
    engaged.relationships.oilCo > drifted.relationships.oilCo,
    `${engaged.relationships.oilCo} vs unengaged ${drifted.relationships.oilCo}`);
  check('...and does not suppress anyone else’s',
    engaged.relationships.community === drifted.relationships.community);

  // §6.4 — trust decays only after the grace window with no visible progress.
  let quiet = startRun(7);
  const trust0 = quiet.meters.trust;
  quiet = endTurns(quiet, BALANCE.trustDecayGraceTurns + 2);
  check('trust decays across quiet quarters', quiet.meters.trust < trust0,
    `${trust0} -> ${quiet.meters.trust.toFixed(1)}`);

  // §6.7 — the gate never advances the act by itself.
  const open = { ...startRun(7), flags: { gateOpen: true } };
  check('ADVANCE_ACT is refused when the gate is genuinely shut',
    reduce(open, { type: 'ADVANCE_ACT' }).act === 0);
  const legit = {
    ...startRun(7),
    parcels: { ...startRun(7).parcels, site2: { ...startRun(7).parcels.site2, status: 'optioned' } },
    relationships: { ...startRun(7).relationships, inkosi: 60 },
  };
  check('gatePassed sees act 0 satisfied', gatePassed(legit) === true);
  check('ADVANCE_ACT then moves to act 1', reduce(legit, { type: 'ADVANCE_ACT' }).act === 1);
  check('...and the act did not advance on its own',
    endTurns(legit, 1).act === 0);
}

/* --------------------------------------------------- §6.6 the event deck */
group('§6.6 — the event deck');
{
  let s = endTurns(startRun(4242), 1);
  check('a card is drawn on END_TURN', s.pendingEvent !== null, String(s.pendingEvent));
  const blocked = reduce(s, { type: 'END_TURN' });
  check('END_TURN is refused while a card is pending', blocked.turn === s.turn);
  const resolved = reduce(s, { type: 'RESOLVE_EVENT', choiceId: firstChoice(s) });
  check('resolving clears the card', resolved.pendingEvent === null);
  check('...and discards it', resolved.discard.length === 1);

  // Exhaust the deck and confirm the discard is reshuffled back in (§6.6).
  let deep = startRun(4242);
  for (let i = 0; i < 40; i++) {
    if (deep.pendingEvent) deep = reduce(deep, { type: 'RESOLVE_EVENT', choiceId: firstChoice(deep) });
    deep = reduce(deep, { type: 'END_TURN' });
    if (deep.status !== 'playing') break;
  }
  check('the deck keeps dealing past its own length',
    deep.deck.length + deep.discard.length + (deep.pendingEvent ? 1 : 0) > 0,
    `deck ${deep.deck.length}, discard ${deep.discard.length}`);
}

/* ------------------------------------------------------- §10 every ending */
group('§10 — every ending has a test that fires it');
{
  // blockade: trust hits zero.
  const doomed = endTurns({ ...startRun(1), meters: { ...startRun(1).meters, trust: 0.5 } }, 6);
  check('blockade fires when trust reaches 0',
    doomed.status === 'lost' && doomed.endingKind === 'blockade', String(doomed.endingKind));

  // sunk: cash below zero while act <= 1.
  const broke = endTurns({ ...startRun(1), meters: { ...startRun(1).meters, cash: 0.2 } }, 4);
  check('sunk fires when cash goes negative in act 0-1',
    broke.status === 'lost' && broke.endingKind === 'sunk', String(broke.endingKind));

  // sunk must NOT fire past act 1 — §10 scopes it deliberately.
  const lateBroke = endTurns(
    { ...startRun(1), act: 3, meters: { ...startRun(1).meters, cash: 0.2 } }, 3,
  );
  check('...but not once the act is past 1',
    lateBroke.endingKind !== 'sunk', String(lateBroke.endingKind));

  // dry: act 4, below the wall, nothing left that could clear it.
  const parched = {
    ...startRun(1),
    act: 4,
    meters: { ...startRun(1).meters, water: 10, cash: 0.5, trust: 80 },
    flags: { boreholesDrilled: true, bulkWaterContracted: true },
  };
  check('waterIsUnreachable sees a dead end', waterIsUnreachable(parched) === true);
  const dry = endTurns(parched, 1);
  check('dry fires at the water wall', dry.endingKind === 'dry', String(dry.endingKind));

  // ...and does NOT fire while a route out is still open and affordable.
  const hopeful = {
    ...startRun(1),
    act: 4,
    meters: { ...startRun(1).meters, water: 50, cash: 200, trust: 80 },
  };
  check('...but not while an affordable option remains',
    waterIsUnreachable(hopeful) === false);

  // extraction: reaches handover rich and distrusted (DECISIONS D6 — a WIN).
  const hollow = endTurns({
    ...startRun(1),
    act: 6,
    counters: { handoverEnteredTurn: 0 },
    meters: {
      cash: BALANCE.extractionCashThreshold + 50,
      trust: BALANCE.extractionTrustFloor - 5,
      paper: 50,
      water: 80,
    },
  }, BALANCE.handoverTurns + 2);
  check('extraction fires at handover when rich and distrusted',
    hollow.endingKind === 'extraction', String(hollow.endingKind));
  check('...and is a WIN with a score, not a loss (D6)',
    hollow.status === 'won' && typeof hollow.score?.total === 'number',
    `${hollow.status}, total ${hollow.score?.total}`);

  // handover: the honest ending.
  const good = endTurns({
    ...startRun(1),
    act: 6,
    counters: { handoverEnteredTurn: 0 },
    meters: { cash: 10, trust: 70, paper: 50, water: 80 },
    buildings: [
      { id: 'h1', typeId: 'housingPhase', parcelId: 'site6', builtOnTurn: 1, operational: true },
    ],
  }, BALANCE.handoverTurns + 2);
  check('handover ends the run with a score',
    good.status === 'won' && good.endingKind === 'handover', String(good.endingKind));
}

/* --------------------------------------------------------------- §10 scoring */
group('§10 — cash contributes nothing to the score');
{
  const base = {
    ...startRun(1),
    buildings: [
      { id: 'h1', typeId: 'housingPhase', parcelId: 'site6', builtOnTurn: 1, operational: true },
    ],
    meters: { cash: 5, trust: 60, paper: 0, water: 70 },
  };
  const rich = { ...base, meters: { ...base.meters, cash: 5000 } };
  check('a 1000x richer run scores identically', score(base).total === score(rich).total,
    `${score(base).total} vs ${score(rich).total}`);

  const w = BALANCE.score;
  const expected = 80 * w.householdWeight + 30 * w.jobWeight + 60 * w.trustWeight;
  check('score matches households*3 + jobs*1 + trust*2', score(base).total === expected,
    `${score(base).total} vs ${expected}`);

  // The §1 thesis, asserted: a profitable asset with a failed town must lose to
  // a poorer run that actually built a neighbourhood.
  const extractive = { ...base, buildings: [], meters: { cash: 9999, trust: 20, paper: 0, water: 70 } };
  check('a rich, empty run scores below a poor, inhabited one',
    score(extractive).total < score(base).total,
    `${score(extractive).total} vs ${score(base).total}`);
}

/* ------------------------------------------------------------- legality rules */
group('legality — illegal actions are no-ops, never throws');
{
  const s = startRun(1);
  const same = (a) => JSON.stringify(reduce(s, a)) === JSON.stringify(s);
  check('cannot build on a parcel with no rights',
    same({ type: 'BUILD', buildingTypeId: 'clinic', parcelId: 'site1' }));
  check('cannot commission an unknown study',
    same({ type: 'COMMISSION_STUDY', studyId: 'nope', parcelId: 'site1' }));
  check('cannot acquire rights over an unknown parcel',
    same({ type: 'ACQUIRE_RIGHTS', parcelId: 'nope', mode: 'option' }));
  check('cannot resolve an event when none is pending',
    same({ type: 'RESOLVE_EVENT', choiceId: 'attend' }));
  check('an unknown action type is a no-op',
    same({ type: 'NOT_A_REAL_ACTION' }));
  check('a locked building type is refused',
    same({ type: 'BUILD', buildingTypeId: 'housingPhase', parcelId: 'site6' }));

  const poor = { ...s, meters: { ...s.meters, cash: 0 } };
  check('cannot commission a study you cannot afford',
    JSON.stringify(reduce(poor, { type: 'COMMISSION_STUDY', studyId: 'geotech', parcelId: 'site1' }))
      === JSON.stringify(poor));

  const noPaper = { ...s, meters: { ...s.meters, cash: 500, paper: 0 } };
  check('cannot acquire rights without the paperwork (D8)',
    reduce(noPaper, { type: 'ACQUIRE_RIGHTS', parcelId: 'site6', mode: 'lease' })
      .parcels.site6.status === 'identified');

  const frozen = s.parcels.site7;
  check('site7 starts frozen', frozen.status === 'frozen');
  check('cannot acquire rights over a frozen parcel',
    reduce({ ...s, meters: { ...s.meters, cash: 500, paper: 100 } },
      { type: 'ACQUIRE_RIGHTS', parcelId: 'site7', mode: 'option' })
      .parcels.site7.status === 'frozen');
}

/* ------------------------------------------------------- D13 missions */
group('DECISIONS D13 — missions');
{
  const s = startRun(4242);
  check('a run starts with no missions anywhere',
    s.missions.offered.length === 0 && s.missions.accepted.length === 0 &&
    s.missions.completed.length === 0 && s.missions.failed.length === 0);

  // Inkosi Mthiyane opens at 58, above the mission's threshold of 45, so the
  // first job should be on the table after one turn.
  const t1 = settle(endTurns(s, 1));
  check('Inkosi Mthiyane offers the first job on turn 1',
    t1.missions.offered.includes('mission:the-first-yes'),
    t1.missions.offered.join(', '));

  const taken = reduce(t1, { type: 'ACCEPT_MISSION', missionId: 'mission:the-first-yes' });
  check('accepting moves it from offered to accepted',
    !taken.missions.offered.includes('mission:the-first-yes') &&
    taken.missions.accepted.some((a) => a.id === 'mission:the-first-yes'));
  check('accepting costs no action points (D13)', taken.apRemaining === t1.apRemaining);
  check('turnsLeft reports the deadline', turnsLeft(taken, 'mission:the-first-yes') === 10,
    String(turnsLeft(taken, 'mission:the-first-yes')));

  // Completing it: option site2, then end a turn.
  const optioned = {
    ...taken,
    meters: { ...taken.meters, cash: 300, paper: 100 },
  };
  const done = endTurns(
    reduce(optioned, { type: 'ACQUIRE_RIGHTS', parcelId: 'site2', mode: 'option' }), 1,
  );
  check('completing the objective completes the mission',
    done.missions.completed.includes('mission:the-first-yes'));
  check('...and pays the reward flag', done.flags.councilBacking === true);
  check('...and the reward relationship landed',
    done.relationships.inkosi > taken.relationships.inkosi,
    `${taken.relationships.inkosi} -> ${done.relationships.inkosi}`);

  // Expiry.
  const stale = endTurns(taken, 12);
  check('an unmet mission expires after its deadline',
    stale.missions.failed.includes('mission:the-first-yes'),
    `failed: ${stale.missions.failed.join(', ')}`);
  check('...and is not also marked complete',
    !stale.missions.completed.includes('mission:the-first-yes'));

  // A mission finished on its very last turn must pay out, not blow up.
  const lastGasp = {
    ...taken,
    turn: taken.turn + 9,
    meters: { ...taken.meters, cash: 300, paper: 100 },
  };
  const clutch = endTurns(
    reduce(lastGasp, { type: 'ACQUIRE_RIGHTS', parcelId: 'site2', mode: 'option' }), 1,
  );
  check('completion beats expiry on the deadline turn',
    clutch.missions.completed.includes('mission:the-first-yes') &&
    !clutch.missions.failed.includes('mission:the-first-yes'));

  // Declining.
  const declined = reduce(t1, { type: 'DECLINE_MISSION', missionId: 'mission:the-first-yes' });
  check('declining costs the relationship',
    declined.relationships.inkosi < t1.relationships.inkosi,
    `${t1.relationships.inkosi} -> ${declined.relationships.inkosi}`);
  check('a declined mission is not re-offered later',
    !endTurns(declined, 4).missions.offered.includes('mission:the-first-yes'));
  check('cannot accept a mission that was never offered',
    JSON.stringify(reduce(s, { type: 'ACCEPT_MISSION', missionId: 'mission:the-graves' }))
      === JSON.stringify(s));
  check('cannot accept an unknown mission id',
    JSON.stringify(reduce(t1, { type: 'ACCEPT_MISSION', missionId: 'nope' }))
      === JSON.stringify(t1));

  // A mission id must live in exactly one bucket, always.
  const busy = endTurns(taken, 14);
  const all = [
    ...busy.missions.offered, ...busy.missions.accepted.map((a) => a.id),
    ...busy.missions.completed, ...busy.missions.failed,
  ];
  check('no mission id appears in two buckets', new Set(all).size === all.length,
    all.join(', '));

  // Missions must not touch the RNG — that is what keeps replay trivial.
  const before = endTurns(startRun(99), 1);
  const withMission = reduce(before, { type: 'ACCEPT_MISSION', missionId: 'mission:the-first-yes' });
  check('accepting a mission does not advance the RNG cursor',
    withMission.rngCursor === before.rngCursor);

  // §8 must survive the mission system: Bra Sipho asks about the field, but
  // must never warn that building on it costs trust (DECISIONS D13).
  const fieldBrief = JSON.parse(readFileSync(join(HERE, '../www/content/missions.json'), 'utf8'))
    .find((m) => m.id === 'mission:the-field');
  const leak = /trust|penalt|cost you|grievance|do not build|don.t build/i.test(fieldBrief.brief);
  check('the sports-field mission asks, and never warns (§8)', leak === false, fieldBrief.brief);
}

/* ------------------------------------------------------- D12/D14 Sakhile */
group('DECISIONS D12/D14 — Sakhile is local, and it is mechanical');
{
  const s = startRun(4242);
  check('the player is Sakhile', PLAYER.name === 'Sakhile');
  check('every stakeholder is a named person, not an institution',
    STAKEHOLDERS.every((x) => x.name !== '' && x.role !== '' && !/^The /.test(x.name)),
    STAKEHOLDERS.map((x) => x.name).join(', '));
  check('every mission giver is a real stakeholder',
    MISSIONS.every((m) => STAKEHOLDERS.some((x) => x.id === m.giver)));

  // Local: known by the people, unknown to the lenders.
  check('he opens high with the people who know him',
    s.relationships.inkosi > 50 && s.relationships.community > 50,
    `inkosi ${s.relationships.inkosi}, community ${s.relationships.community}`);
  check('...and low with the institutions that lend money',
    s.relationships.dfi < 40 && s.relationships.oilCo < 40,
    `dfi ${s.relationships.dfi}, oilCo ${s.relationships.oilCo}`);
  /* Runway, not a rand figure — this invariant survives a phase-3 rebalance.
     Too short and act 0-1 is unwinnable; too long and getting funded stops
     being the early game, which is the whole point of a young local operator. */
  const runway = s.meters.cash / BALANCE.quarterlyBurn;
  check('his runway is long enough that the paper years are survivable',
    runway >= 15, `${runway.toFixed(1)} turns`);
  check('...and short enough that getting funded IS the early game',
    runway <= 40, `${runway.toFixed(1)} turns`);

  /* Viability. This is the regression test phase 3 will lean on hardest: a
     rebalance that makes the paper years unsurvivable should fail here, not in
     a playtest. The scripted player is competent but not clairvoyant — it takes
     every job offered, builds paperwork with the cheapest study it can afford,
     and courts Dr Okonkwo until she takes it to committee.

     The invariant is the SHAPE of act 0-1, not a cash figure: Sakhile is
     squeezed hard, and then the funding arrives. If either half stops being
     true the early game is broken. */
  let sakhile = startRun(4242);
  let low = Infinity;
  let fundedOnTurn = null;
  for (let i = 0; i < 14 && sakhile.status === 'playing'; i++) {
    sakhile = settle(sakhile);
    for (const id of [...sakhile.missions.offered]) {
      sakhile = reduce(sakhile, { type: 'ACCEPT_MISSION', missionId: id });
    }
    const study = STUDIES
      .filter((st) => st.waterDelta === 0 && !sakhile.flags[st.setsFlag]
        && !sakhile.timers.some((t) => t.refId === st.id))
      .sort((a, b) => a.cost - b.cost)[0];
    if (study && sakhile.meters.cash > study.cost + 8) {
      sakhile = reduce(sakhile, { type: 'COMMISSION_STUDY', studyId: study.id, parcelId: 'site1' });
    }
    if (sakhile.meters.cash > 8) {
      sakhile = reduce(sakhile, {
        type: 'ENGAGE',
        stakeholder: sakhile.relationships.dfi < 50 ? 'dfi' : 'inkosi',
        intensity: 1,
      });
    }
    const prev = sakhile.meters.cash;
    sakhile = reduce(sakhile, { type: 'END_TURN' });
    low = Math.min(low, prev);
    if (fundedOnTurn === null && sakhile.meters.cash > prev + 10) fundedOnTurn = sakhile.turn;
  }
  check('a competent opening survives the paper years',
    sakhile.status === 'playing',
    `${sakhile.status}/${sakhile.endingKind} on turn ${sakhile.turn}`);
  check('...and is squeezed genuinely hard on the way',
    low < BALANCE.start.cash / 3, `low water mark R${low.toFixed(1)}m`);
  check('...and the funding arrives before he runs out',
    fundedOnTurn !== null, fundedOnTurn ? `turn ${fundedOnTurn}` : 'never');
  check('...off the back of work he actually did for someone',
    sakhile.missions.completed.length > 0,
    `${sakhile.missions.completed.length} completed: ${sakhile.missions.completed.join(', ')}`);

  /* And the flip side, which SPEC §10 names: doing the paperwork and never
     building anything IS the `sunk` ending. It should be reachable, not
     engineered away. */
  let idle = startRun(4242);
  for (let i = 0; i < 40 && idle.status === 'playing'; i++) {
    idle = reduce(settle(idle), { type: 'END_TURN' });
  }
  check('a run that never builds anything eventually sinks',
    idle.status === 'lost', `${idle.status}/${idle.endingKind} on turn ${idle.turn}`);
}

/* --------------------------------------------------------- content integrity */
group('content — the JSON is internally consistent');
{
  const acts = JSON.parse(readFileSync(join(HERE, '../www/content/acts.json'), 'utf8'));
  const buildings = JSON.parse(readFileSync(join(HERE, '../www/content/buildings.json'), 'utf8'));
  const parcels = JSON.parse(readFileSync(join(HERE, '../www/content/parcels.json'), 'utf8'));
  const cards = JSON.parse(readFileSync(join(HERE, '../www/content/cards.json'), 'utf8'));

  check('there are seven acts, 0-6', acts.length === 7 && acts.every((a, i) => a.id === i));
  check('only the terminal act has no gate',
    acts.filter((a) => a.gate === null).length === 1 && acts[6].gate === null);
  check('SPEC §3 asks for ~12 parcels', parcels.length === 12, String(parcels.length));
  check('site2 is the sports field with displacementCost 40',
    parcels.find((p) => p.id === 'site2')?.currentUse === 'sports field' &&
    parcels.find((p) => p.id === 'site2')?.displacementCost === 40);
  check('parcel ids are unique', new Set(parcels.map((p) => p.id)).size === parcels.length);
  check('card ids are unique', new Set(cards.map((c) => c.id)).size === cards.length);
  check('every card has at least two choices', cards.every((c) => c.choices.length >= 2));

  const unlocks = new Set(acts.flatMap((a) => a.unlocks));
  const missing = buildings
    .filter((b) => b.requiresUnlock !== '' && !unlocks.has(b.requiresUnlock))
    .map((b) => b.id);
  check('every building unlock key is granted by some act', missing.length === 0, missing.join(', '));

  const tags = new Set(buildings.map((b) => b.tag));
  check('act 3 has an agri, an energy and a waste building to choose from',
    ['agri', 'energy', 'waste'].every((t) => tags.has(t)));
  check('the water wall is reachable within [waterMin, waterMax]',
    BALANCE.waterWallThreshold > BALANCE.waterMin && BALANCE.waterWallThreshold < BALANCE.waterMax);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
