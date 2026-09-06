/* test-fullrun.js — SPEC §13's definition of done for phase 2:
   "a full run from act 0 to handover is completable in one sitting".

   That is a property of the ENGINE, not of the UI. If the acts cannot be
   cleared in sequence with the content as balanced, no amount of buttons will
   make the game finishable — so this proves it headlessly first, and the UI
   only has to expose actions this script already knows are legal.

   It is deliberately a fixed strategy rather than a search: it plays like a
   competent person who understands the gates, and it must WIN. When a phase-3
   rebalance makes the game unwinnable, this fails loudly.

   Run: npm run test:fullrun
*/

import { reduce, startRun } from '../www/js/engine/reduce.js';
import { gatePassed, householdsWithTitle, currentAct, unlocks } from '../www/js/engine/selectors.js';
import { BALANCE, CARDS, STUDIES, BUILDINGS } from '../www/content/index.js';

const argv = new Set(process.argv.slice(2));
const VERBOSE = argv.has('-v') || argv.has('--verbose');

const firstChoice = (s) => CARDS.find((c) => c.id === s.pendingEvent)?.choices[0]?.id ?? 'x';
const settle = (s) => (s.pendingEvent ? reduce(s, { type: 'RESOLVE_EVENT', choiceId: firstChoice(s) }) : s);

/* Parcels earmarked per job, so the strategy never double-books one. */
const PLAN = {
  forecourt: 'site2',
  agriHub: 'site3',
  solarPlant: 'site6',
  reticulation: 'site1',
  housing: ['site9', 'site4', 'site10'],
};

/* A competent operator keeps a few quarters of burn in the bank rather than
   spending to zero — without this the bot papers itself to 100 by turn 6 and
   sinks, which says nothing about whether the GAME is winnable. */
const RESERVE = 12;
const PAPER_CAP = 82; // paper clamps at 100; studying past this wastes cash

/* The reserve is not constant: act 1 must END holding enough to build the
   forecourt, because act 2 has no income until that forecourt opens and the
   `sunk` ending does not apply past act 1 — so arriving in act 2 broke is not
   a loss, it is a run that can never recover and never ends. Saving through
   the paper years is the whole discipline the act is testing. */
const FORECOURT_COST = 12;
const reserveFor = (s) => (s.act === 1 ? FORECOURT_COST + RESERVE / 2 : RESERVE);

/* A stakeholder can only be engaged once a turn (the reducer's engagedThisTurn
   guard). Without checking that here the strategy re-proposes the same blocked
   engagement, the reducer returns the state unchanged, and the action-point
   loop reads that as "nothing legal left" and stops — spending one point a turn
   instead of three. */
const canEngage = (s, who) => !s.engagedThisTurn.includes(who) && s.meters.cash > reserveFor(s);

const has = (s, typeId) => s.buildings.some((b) => b.typeId === typeId);
const live = (s, typeId) => s.buildings.some((b) => b.typeId === typeId && b.operational);
const canBuildOn = (s, id) => {
  const p = s.parcels[id];
  return p && (p.status === 'leased' || p.status === 'owned') && !s.buildings.some((b) => b.parcelId === id);
};

/** Lease a parcel if we can afford the cash and the paperwork. */
function tryLease(s, id) {
  const p = s.parcels[id];
  if (!p || p.status === 'leased' || p.status === 'owned' || p.status === 'frozen') return s;
  return reduce(s, { type: 'ACQUIRE_RIGHTS', parcelId: id, mode: 'lease' });
}

/** Commission the cheapest study not yet done on some parcel — this is how
    paper is earned, and paper is what rights cost. */
function tryStudy(s, { waterOnly = false, prefer = [], only = false } = {}) {
  /* A study is commissioned for one of two reasons: the flag it sets (an
     authorisation a gate needs) or the paper it pays. Only the second is
     capped — blocking a flag-setting study because paper happens to be full is
     how the strategy sat in act 1 with paper 100 and never commissioned the
     environmental authorisation the gate was waiting for. */
  const needed = (st) =>
    (st.setsFlag !== '' && s.flags[st.setsFlag] !== true) ||
    (st.revealsWater && !s.waterSurveyed);

  /* `prefer` is what the CURRENT act's gate is waiting on. Without it the
     strategy works through flag-setting studies cheapest-first, spends its act
     1 budget on the heritage and geotech surveys that no gate wants, and is
     broke by the time it reaches the R3.5m environmental authorisation the
     gate has been waiting for the whole act. */
  const rank = (st) => {
    const i = prefer.indexOf(st.id);
    return i < 0 ? prefer.length : i;
  };
  const wanted = STUDIES
    .filter((st) => (waterOnly ? st.waterDelta > 0 : true))
    // `only` means buy the gate's studies or nothing. Without it, act 1 spends
    // the wait for the environmental authorisation on surveys no gate wants,
    // which is exactly the forecourt capital going out the door again.
    .filter((st) => (only ? prefer.includes(st.id) : true))
    .sort((a, b) => rank(a) - rank(b) || Number(needed(b)) - Number(needed(a)) || a.cost - b.cost);

  for (const st of wanted) {
    if (st.requiresUnlock !== '' && !unlocks(s).includes(st.requiresUnlock)) continue;
    if (s.meters.cash - st.cost < reserveFor(s)) continue;
    if (!waterOnly && !needed(st) && s.meters.paper >= PAPER_CAP) continue;
    /* You need ONE environmental authorisation, not one per parcel. A study is
       per-parcel for paper, but the flag it sets is global and only lands when
       the first instance completes — so while one is in flight, commissioning
       the same study on another site buys nothing but a second invoice. This
       was quietly eating R3.5m a turn, three parcels at a time, and it looked
       exactly like a balance problem. */
    if (needed(st) && s.timers.some((t) => t.kind === 'study' && t.refId.startsWith(`${st.id}@`))) {
      continue;
    }
    for (const pid of Object.keys(s.parcels)) {
      const p = s.parcels[pid];
      if (p.studiesComplete.includes(st.id)) continue;
      if (s.timers.some((t) => t.kind === 'study' && t.refId === `${st.id}@${pid}`)) continue;
      const next = reduce(s, { type: 'COMMISSION_STUDY', studyId: st.id, parcelId: pid });
      if (next !== s) return next;
    }
  }
  return s;
}

function tryBuild(s, typeId, parcelId) {
  /* No buffer on a build. The reducer already refuses one that cannot be
     afforded, and holding a reserve back from the forecourt is self-defeating:
     it is the thing that STARTS the income, so every quarter spent saving for
     a cushion is a quarter of burn against nothing. */
  if (!canBuildOn(s, parcelId)) return s;
  return reduce(s, { type: 'BUILD', buildingTypeId: typeId, parcelId });
}

let s = startRun(4242);
const trace = [];
let lastAct = -1;
/* SPEC §8 is about site2 specifically. `communityGrievance` is raised by ANY
   displacement build, so asserting on the flag alone conflates the sports field
   with the maize and the grazing — record the site2 build directly instead. */
let site2BuiltUnreplaced = null;

for (let turn = 0; turn < 220 && s.status === 'playing'; turn++) {
  const prevCash = s.meters.cash;
  s = settle(s);

  // Always take the work on offer — it is free and it is the funding.
  for (const id of [...s.missions.offered]) {
    s = reduce(s, { type: 'ACCEPT_MISSION', missionId: id });
  }

  /* Advance when the gate opens — but not INTO the paper years broke. Act 1 is
     "all cost, no buildings": it needs roughly R29m of studies, rights,
     mitigation and burn, and there is no income until the forecourt opens in
     act 2. Walking through that door with R6m is simply a slower `sunk`.
     Acts 2+ carry their own income, so from there advancing is free. */
  /* The bar applies to ENTERING the paper years, not leaving them. Sitting in
     act 1 with the gate open, burning 1.4 a quarter against no income, is
     strictly worse than moving on — the strategy did exactly that and died
     waiting for a number act 1 cannot produce. */
  /* Only act 0 holds the door. From act 1 on, an open gate should be walked
     through immediately: waiting cannot earn anything and burn is monotonic, so
     holding out for a bigger balance just arrives later with less. The saving
     for act 2's forecourt is done by reserveFor() DURING act 1, not by
     loitering at the end of it. */
  const fundedForNextAct = s.act !== 0 || s.meters.cash >= 25;
  if (gatePassed(s) && fundedForNextAct) s = reduce(s, { type: 'ADVANCE_ACT' });

  /* Act-specific priorities, spending up to the action-point budget. */
  for (let ap = 0; ap < BALANCE.actionPointsPerTurn && s.apRemaining > 0; ap++) {
    const before = s;

    if (s.act === 0) {
      /* Two jobs at once: clear the gate (site2 optioned, Inkosi at 60) and
         court Dr Okonkwo, because her committee is the only money in the game
         before the forecourt opens and her mission is not even OFFERED below
         dfi 45. Doing only the gate work clears act 0 and loses the run. */
      if (s.parcels.site2.status === 'unknown' && s.meters.paper >= BALANCE.rights.option.paperCost) {
        s = reduce(s, { type: 'ACQUIRE_RIGHTS', parcelId: 'site2', mode: 'option' });
      } else if (s.relationships.dfi < 52 && canEngage(s, 'dfi')) {
        s = reduce(s, { type: 'ENGAGE', stakeholder: 'dfi', intensity: 1 });
      } else if (s.relationships.inkosi < 62 && canEngage(s, 'inkosi')) {
        s = reduce(s, { type: 'ENGAGE', stakeholder: 'inkosi', intensity: 1 });
      } else {
        s = tryStudy(s);
      }
    } else if (s.act === 1) {
      // Replace the sports field BEFORE building on it (SPEC §8), get the two
      // authorisations, lease site2.
      if (!s.flags.sportsFieldReplaced && !s.timers.some((t) => t.kind === 'application')
          && s.meters.cash > BALANCE.mitigation.cash + RESERVE) {
        s = reduce(s, { type: 'MITIGATE', parcelId: 'site2' });
      } else if (s.parcels.site2.status !== 'leased' && s.meters.paper >= BALANCE.rights.lease.paperCost) {
        s = tryLease(s, 'site2');
      } else if (!s.flags.environmentalAuthorisation || !s.flags.roadAccessPermission) {
        s = tryStudy(s, { prefer: ['environmental', 'trafficCount'], only: true });
      } else {
        /* Gate met, field replaced, site2 leased: STOP SPENDING. Act 1 has no
           income, and every further survey is Renier's forecourt capital going
           into paperwork nobody asked for. Banking here is not passivity, it is
           the discipline the act is testing — and leaving act 1 unable to build
           the forecourt is how a run quietly becomes unwinnable. */
      }
    } else if (s.act === 2) {
      /* Never build on site2 before the field is replaced — that is SPEC §8's
         whole lesson, and the act-1 branch does not always get there before the
         gate opens. */
      if (!s.flags.sportsFieldReplaced && !s.timers.some((t) => t.kind === 'application')
          && s.meters.cash > BALANCE.mitigation.cash + RESERVE) {
        s = reduce(s, { type: 'MITIGATE', parcelId: 'site2' });
      } else if (!s.flags.sportsFieldReplaced) {
        /* wait for the replacement rather than take the displacement hit */
      } else if (!has(s, 'forecourt')) s = tryBuild(s, 'forecourt', PLAN.forecourt);
      else if (s.relationships.oilCo < 60 && canEngage(s, 'oilCo')) {
        s = reduce(s, { type: 'ENGAGE', stakeholder: 'oilCo', intensity: 1 });
      } else s = tryStudy(s);
    } else if (s.act === 3) {
      if (!s.flags.bulkWaterContracted) s = tryStudy(s, { waterOnly: true });
      else if (!has(s, 'agriHub')) {
        s = canBuildOn(s, PLAN.agriHub) ? tryBuild(s, 'agriHub', PLAN.agriHub) : tryLease(s, PLAN.agriHub);
      } else if (!has(s, 'solarPlant')) {
        s = canBuildOn(s, PLAN.solarPlant) ? tryBuild(s, 'solarPlant', PLAN.solarPlant) : tryLease(s, PLAN.solarPlant);
      } else s = tryStudy(s);
    } else if (s.act === 4) {
      if (s.meters.water < BALANCE.waterWallThreshold) s = tryStudy(s, { waterOnly: true });
      else if (!has(s, 'reticulation')) {
        s = canBuildOn(s, PLAN.reticulation)
          ? tryBuild(s, 'reticulation', PLAN.reticulation)
          : tryLease(s, PLAN.reticulation);
      } else s = tryStudy(s);
    } else if (s.act === 5) {
      const next = PLAN.housing.find((id) => !s.buildings.some((b) => b.parcelId === id));
      if (next) {
        s = canBuildOn(s, next) ? tryBuild(s, 'housingPhase', next) : tryLease(s, next);
      } else s = tryStudy(s);
    } else {
      // Act 6: keep the lights on and the community close until handover.
      if (canEngage(s, 'community')) s = reduce(s, { type: 'ENGAGE', stakeholder: 'community', intensity: 1 });
      else s = tryStudy(s);
    }

    if (s.buildings.some((b) => b.parcelId === 'site2') && site2BuiltUnreplaced === null) {
      site2BuiltUnreplaced = s.flags.sportsFieldReplaced !== true;
    }
    if (s === before) break; // nothing legal left this turn
  }

  if (s.act !== lastAct) {
    trace.push(`act ${s.act} (${currentAct(s)?.name}) at turn ${s.turn}, cash R${s.meters.cash.toFixed(1)}m, trust ${s.meters.trust.toFixed(0)}, water ${s.waterSurveyed ? s.meters.water : '?'}`);
    lastAct = s.act;
  }
  if (VERBOSE && s.act <= 2) {
    const spent = (prevCash - s.meters.cash);
    if (Math.abs(spent) > 0.01) {
      const acts = s.log.filter((l) => l.turn === s.turn).map((l) => l.text).join(' | ');
      console.log(`      spent ${spent.toFixed(1)} :: ${acts.slice(0, 160)}`);
    }
  }
  if (VERBOSE) {
    console.log(`t${String(s.turn).padStart(3)} act${s.act} cash ${s.meters.cash.toFixed(1).padStart(7)} paper ${String(s.meters.paper).padStart(3)} trust ${s.meters.trust.toFixed(0).padStart(3)} water ${String(s.meters.water).padStart(3)} hh ${householdsWithTitle(s)} | ${s.buildings.filter((b) => b.operational).map((b) => b.typeId).join(',')}`);
  }

  s = reduce(s, { type: 'END_TURN' });
}

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

console.log('\n── act progression');
for (const line of trace) console.log('   ' + line);
console.log('');

check('the run reached a terminal state', s.status !== 'playing', s.status);
check('a full run from act 0 to handover is completable (SPEC §13 phase 2)',
  s.status === 'won', `${s.status} / ${s.endingKind} on turn ${s.turn}`);
check('it reached act 6', s.act === 6, `act ${s.act}`);
check('it is an honest handover, not extraction',
  s.endingKind === 'handover', String(s.endingKind));
check('it delivered the households act 5 demanded',
  householdsWithTitle(s) >= 200, `${householdsWithTitle(s)} households`);
check('it scored', typeof s.score?.total === 'number', `total ${s.score?.total}`);
check('the sports field was replaced before it was built on (SPEC §8)',
  s.flags.sportsFieldReplaced === true && site2BuiltUnreplaced === false,
  `replaced=${s.flags.sportsFieldReplaced}, built-while-unreplaced=${site2BuiltUnreplaced}`);
check('the run finishes in a plausible number of turns', s.turn <= 110, `${s.turn} turns`);
if (s.turn < 60 || s.turn > 80) {
  console.log(`NOTE  ${s.turn} turns is outside SPEC §6's stated 60-80 — a phase-3 pacing lever, not a failure.`);
}

if (s.score) {
  console.log(`\n   score ${s.score.total} = ${s.score.householdsWithTitle} households x${BALANCE.score.householdWeight}`
    + ` + ${s.score.jobsInCatchment} jobs x${BALANCE.score.jobWeight}`
    + ` + ${s.score.trustAtHandover} trust x${BALANCE.score.trustWeight}`);
  console.log(`   cash at handover R${s.meters.cash.toFixed(1)}m — contributes nothing, by design`);
}

/* Post-mortem, printed only on failure — says which gate condition was open. */
if (failures) {
  const act = currentAct(s);
  console.log('\n── post-mortem');
  console.log('   act', s.act, JSON.stringify(act?.gate));
  console.log('   flags', JSON.stringify(s.flags));
  console.log('   site2', JSON.stringify(s.parcels.site2));
  console.log('   cash', s.meters.cash, 'paper', s.meters.paper, 'water', s.meters.water);
  console.log('   buildings', JSON.stringify(s.buildings));
  console.log('   timers', JSON.stringify(s.timers));
  console.log('   missions', JSON.stringify(s.missions));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
