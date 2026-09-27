// @ts-check
/* render.js — phase 2's "buttons and numbers" (SPEC §13). No art, no map, a
   list of parcels. Everything reads through selectors rather than GameState, so
   the hidden-water contract (SPEC §9) holds by construction: this file never
   touches `state.meters.water`.

   Rendering is a full redraw on every dispatch. At this size that is simpler
   and less bug-prone than diffing, and it means the screen cannot drift out of
   step with the reducer. */

import {
  ACTS, BUILDINGS, STUDIES, STAKEHOLDERS, BALANCE, PLAYER,
  buildingDef, studyDef, missionDef, stakeholderDef, cardDef,
} from '../../content/index.js';
import {
  visibleWater, currentAct, gatePassed, isUnlocked, canAfford,
  householdsWithTitle, jobsInCatchment, netOperatingIncome, quarterlyBurn,
} from '../engine/selectors.js';
import { turnsLeft } from '../engine/missions.js';
import { getState, dispatch, restart, hasSavedRun } from './store.js';
import { portrait } from './portrait.js';
import { renderTitle, renderExplainer, hasSeenExplainer } from './title.js';
import { sfx, duck, unlock, startMusic } from './audio.js';

/** @typedef {import('../engine/types.js').GameState} GameState */

const TABS = /** @type {const} */ ([
  ['node', 'Node'],
  ['work', 'Work'],
  ['people', 'People'],
  ['log', 'Log'],
]);

let tab = /** @type {string} */ ('node');

/* Which screen we are on. This is UI state, not game state — it has no place in
   GameState and is deliberately not persisted beyond the "seen the explainer"
   flag, so a reload of a run in progress goes straight back to the run. */
let view = /** @type {'title'|'explainer'|'run'} */ ('title');

/** @param {'title'|'explainer'|'run'} v */
export function setView(v) { view = v; render(); }

/** Skip the title — used by `?seed=`, which means "play this run now". */
export function startAtRun() { view = 'run'; }

/* The event card and the end card are moments; the music should get out of
   their way. Tracked so the duck only fires on the transition. */
let ducked = false;

/* ---------- tiny DOM helpers ---------- */

/**
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {(Node|string|null|false|undefined)[]} [kids]
 */
function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = String(v);
    else if (k === 'text') n.textContent = String(v);
    else if (k === 'html') n.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
}

/** ZAR millions, one decimal — the unit SPEC §5 gives `meters.cash`.
    @param {number} n */
const money = (n) => `R${n.toFixed(1)}m`;

/**
 * @param {string} label
 * @param {() => void} onClick
 * @param {{ disabled?:boolean, primary?:boolean, danger?:boolean, wide?:boolean, title?:string }} [o]
 */
const button = (label, onClick, o = {}) =>
  el('button', {
    class: `btn${o.primary ? ' primary' : ''}${o.danger ? ' danger' : ''}${o.wide ? ' wide' : ''}`,
    disabled: o.disabled ? true : null,
    title: o.title ?? null,
    onclick: () => {
      /* Every click is also a user gesture, which is the only thing a browser
         will start audio from — so a player who reloaded straight into a run
         still gets sound on their first action (SPEC §12). */
      unlock();
      startMusic();
      sfx(o.danger ? 'deny' : o.primary ? 'confirm' : 'tap');
      onClick();
    },
  }, [label]);

/* ---------- top bar ---------- */

/** @param {GameState} s */
function renderTop(s) {
  const act = currentAct(s);
  const water = visibleWater(s); // the ONLY sanctioned read (SPEC §9)

  /**
   * @param {string} k
   * @param {string} v
   * @param {{ low?:boolean, unknown?:boolean }} [opts]
   */
  const meter = (k, v, opts = {}) =>
    el('div', { class: `meter${opts.low ? ' low' : ''}` }, [
      el('div', { class: 'k', text: k }),
      el('div', { class: `v${opts.unknown ? ' v unknown' : ''}`, text: v }),
    ]);

  const pips = el('div', { class: 'pips' },
    Array.from({ length: BALANCE.actionPointsPerTurn }, (/** @type {unknown} */ _, /** @type {number} */ i) =>
      el('div', { class: `pip${i < s.apRemaining ? ' on' : ''}` })));

  const net = netOperatingIncome(s) - quarterlyBurn(s);

  return el('div', {}, [
    el('div', { class: 'actline' }, [
      el('h1', { text: `Act ${s.act} — ${act?.name ?? ''}` }),
      el('span', { class: 'sub', text: act?.subtitle ?? '' }),
      el('span', { class: 'turn', text: `Q${s.turn + 1}` }),
    ]),
    el('div', { class: 'meters' }, [
      meter('Cash', money(s.meters.cash), { low: s.meters.cash < 5 }),
      meter('Trust', String(Math.round(s.meters.trust)), { low: s.meters.trust < 20 }),
      meter('Paper', String(Math.round(s.meters.paper))),
      water === null
        ? meter('Water', '?', { unknown: true })
        : meter('Water', String(water), { low: water < BALANCE.waterWallThreshold }),
    ]),
    el('div', { class: 'apline' }, [
      pips,
      el('span', { class: 'lbl', text: `${s.apRemaining} action${s.apRemaining === 1 ? '' : 's'} left` }),
      el('span', {
        class: 'lbl grow',
        text: `${net >= 0 ? '+' : ''}${net.toFixed(1)}/quarter`,
      }),
    ]),
  ]);
}

/* ---------- Node: parcels, studies, builds ---------- */

/** @param {GameState} s */
function renderNode(s) {
  const out = [];
  const blocked = s.pendingEvent !== null || s.status !== 'playing';
  const noAp = s.apRemaining <= 0;

  if (gatePassed(s)) {
    out.push(el('div', { class: 'card' }, [
      el('h2', { text: 'The conditions to move on are met' }),
      el('p', { class: 'muted', text: 'Advancing is your decision, and it does not come back.' }),
      button('Advance to the next act', () => dispatch({ type: 'ADVANCE_ACT' }),
        { primary: true, disabled: blocked }),
    ]));
  }

  for (const id of Object.keys(s.parcels)) {
    const p = s.parcels[id];
    if (!p) continue;
    const built = s.buildings.find((b) => b.parcelId === id);
    const builtDef = built ? buildingDef(built.typeId) : null;
    const pendingStudy = s.timers.filter((t) => t.kind === 'study' && t.refId.endsWith(`@${id}`));
    const rows = [];

    rows.push(el('div', { class: 'top' }, [
      el('strong', { text: id }),
      el('span', { class: `status ${p.status}`, text: p.status }),
      el('span', { class: 'muted grow', text: `${p.hectares} ha` }),
    ]));
    rows.push(el('div', { class: 'muted', text: p.currentUse }));

    if (built && builtDef) {
      rows.push(el('div', {
        text: built.operational
          ? `${builtDef.name} — operational`
          : `${builtDef.name} — under construction`,
      }));
    }
    if (pendingStudy.length) {
      rows.push(el('div', {
        class: 'muted',
        text: pendingStudy
          .map((t) => `${studyDef(t.refId.split('@')[0] ?? '')?.name ?? t.refId} (Q${t.resolvesOnTurn + 1})`)
          .join(', '),
      }));
    }

    /* Rights */
    const RANK = ['unknown', 'identified', 'optioned', 'leased', 'owned'];
    const rights = el('div', { class: 'chips' }, /** @type {any[]} */ ([]));
    for (const mode of /** @type {const} */ (['option', 'lease', 'purchase'])) {
      const terms = BALANCE.rights[mode];
      const target = mode === 'option' ? 'optioned' : mode === 'lease' ? 'leased' : 'owned';
      if (p.status === 'frozen' || RANK.indexOf(p.status) >= RANK.indexOf(target)) continue;
      const cash = Math.round(terms.cashPerHectare * p.hectares * 10) / 10;
      const ok = canAfford(s, cash) && s.meters.paper >= terms.paperCost;
      rights.appendChild(button(
        `${mode} · ${money(cash)} · ${terms.paperCost}p`,
        () => dispatch({ type: 'ACQUIRE_RIGHTS', parcelId: id, mode }),
        { disabled: blocked || noAp || !ok,
          title: ok ? '' : `Needs ${money(cash)} and ${terms.paperCost} paper` },
      ));
    }
    if (rights.childNodes.length) rows.push(rights);

    /* Studies available here */
    const studies = el('div', { class: 'chips' }, /** @type {any[]} */ ([]));
    for (const st of STUDIES) {
      if (!isUnlocked(s, st.requiresUnlock)) continue;
      if (p.studiesComplete.includes(st.id)) continue;
      if (s.timers.some((t) => t.kind === 'study' && t.refId === `${st.id}@${id}`)) continue;
      studies.appendChild(button(
        `${st.name} · ${money(st.cost)} · ${st.turns}q`,
        () => dispatch({ type: 'COMMISSION_STUDY', studyId: st.id, parcelId: id }),
        { disabled: blocked || noAp || !canAfford(s, st.cost) },
      ));
    }
    if (studies.childNodes.length) {
      rows.push(el('div', { class: 'muted', text: 'Studies' }), studies);
    }

    /* Mitigation — SPEC §8. The label never explains why. */
    if (p.displacementCost > 0 && s.flags[`replaced:${id}`] !== true) {
      const running = s.timers.some((t) => t.kind === 'application' && t.refId === id);
      rows.push(button(
        running ? `Replacing the ${p.currentUse}…` : `Replace the ${p.currentUse} · ${money(BALANCE.mitigation.cash)} · ${BALANCE.mitigation.turns}q`,
        () => dispatch({ type: 'MITIGATE', parcelId: id }),
        { disabled: blocked || noAp || running || !canAfford(s, BALANCE.mitigation.cash) },
      ));
    }

    /* Builds */
    if (!built && (p.status === 'leased' || p.status === 'owned')) {
      const builds = el('div', { class: 'chips' }, /** @type {any[]} */ ([]));
      for (const b of BUILDINGS) {
        if (!isUnlocked(s, b.requiresUnlock)) continue;
        builds.appendChild(button(
          `${b.name} · ${money(b.buildCost)} · ${b.buildTurns}q`,
          () => dispatch({ type: 'BUILD', buildingTypeId: b.id, parcelId: id }),
          { disabled: blocked || noAp || !canAfford(s, b.buildCost) },
        ));
      }
      if (builds.childNodes.length) {
        rows.push(el('div', { class: 'muted', text: 'Build' }), builds);
      }
    }

    /* Twelve parcels, each with up to seven studies, three rights modes and a
       build list, is an unreadable wall. Collapse them, and open only the ones
       Sakhile actually has a stake in — rights held, something built, or work
       already in flight. */
    const interesting =
      p.status !== 'unknown' || !!built || pendingStudy.length > 0;
    const head = el('summary', { class: 'top' }, [
      el('strong', { text: id }),
      el('span', { class: `status ${p.status}`, text: p.status }),
      el('span', { class: 'muted', text: p.currentUse }),
      el('span', { class: 'muted grow', text: `${p.hectares} ha` }),
    ]);
    out.push(el('details', { class: 'card parcel', open: interesting ? true : null },
      [head, ...rows.slice(1)]));
  }
  return out;
}

/* ---------- Work: the mission board ---------- */

/** @param {GameState} s */
function renderWork(s) {
  const out = [];
  const blocked = s.pendingEvent !== null || s.status !== 'playing';

  /**
   * @param {string} id
   * @param {'offered'|'accepted'} kind
   * @returns {HTMLElement|null}
   */
  const missionCard = (id, kind) => {
    const def = missionDef(id);
    if (!def) return null;
    const giver = stakeholderDef(def.giver);
    const left = turnsLeft(s, id);
    const rows = [
      el('div', { class: 'person' }, [
        portrait(giver?.portrait || def.giver),
        el('div', { class: 'who' }, [
          el('h3', { text: def.title }),
          el('div', { class: 'role', text: giver?.name ?? def.giver }),
        ]),
      ]),
      el('p', { text: `“${def.brief}”` }),
    ];
    if (kind === 'offered') {
      rows.push(el('div', { class: 'chips' }, [
        button('Take it', () => dispatch({ type: 'ACCEPT_MISSION', missionId: id }),
          { primary: true, disabled: blocked }),
        button('Turn it down', () => dispatch({ type: 'DECLINE_MISSION', missionId: id }),
          { danger: true, disabled: blocked }),
      ]));
    } else if (kind === 'accepted') {
      rows.push(el('div', {
        class: 'muted',
        text: left === null ? 'No deadline.' : `${left} quarter${left === 1 ? '' : 's'} left.`,
      }));
    }
    return el('div', { class: 'card' }, rows);
  };

  if (s.missions.offered.length) {
    out.push(el('div', { class: 'card' }, [el('h2', { text: 'Asked of you' })]));
    for (const id of s.missions.offered) { const c = missionCard(id, 'offered'); if (c) out.push(c); }
  }
  if (s.missions.accepted.length) {
    out.push(el('div', { class: 'card' }, [el('h2', { text: 'Running' })]));
    for (const a of s.missions.accepted) { const c = missionCard(a.id, 'accepted'); if (c) out.push(c); }
  }
  if (!s.missions.offered.length && !s.missions.accepted.length) {
    out.push(el('div', { class: 'card' }, [
      el('p', { class: 'muted', text: 'Nobody is asking you for anything yet. Go and see people.' }),
    ]));
  }
  if (s.missions.completed.length || s.missions.failed.length) {
    out.push(el('div', { class: 'card' }, [
      el('h2', { text: 'Behind you' }),
      el('div', { class: 'muted', text:
        `${s.missions.completed.length} done · ${s.missions.failed.length} not done` }),
      ...s.missions.completed.map((id) =>
        el('div', { class: 'muted', text: `✓ ${missionDef(id)?.title ?? id}` })),
      ...s.missions.failed.map((id) =>
        el('div', { class: 'muted', text: `✕ ${missionDef(id)?.title ?? id}` })),
    ]));
  }
  return out;
}

/* ---------- People: relationships and engagement ---------- */

/** @param {GameState} s */
function renderPeople(s) {
  const blocked = s.pendingEvent !== null || s.status !== 'playing';
  const noAp = s.apRemaining <= 0;

  return STAKEHOLDERS.map((who) => {
    const value = s.relationships[who.id];
    const engaged = s.engagedThisTurn.includes(who.id);
    const chips = el('div', { class: 'chips' }, /** @type {any[]} */ ([]));
    for (const level of /** @type {const} */ ([1, 2, 3])) {
      const tier = BALANCE.engage[String(level)];
      chips.appendChild(button(
        `${'·'.repeat(level)} ${money(tier.cash)}`,
        () => dispatch({ type: 'ENGAGE', stakeholder: who.id, intensity: level }),
        { disabled: blocked || noAp || engaged || !canAfford(s, tier.cash),
          title: engaged ? 'Already seen this quarter' : `+${tier.relationship}` },
      ));
    }
    return el('div', { class: 'card' }, [
      el('div', { class: 'person' }, [
        portrait(who.portrait || who.id),
        el('div', { class: 'who' }, [
          el('h3', { text: who.name }),
          el('div', { class: 'role', text: who.role }),
          el('div', { class: 'bar' }, [el('span', { style: `width:${value}%` })]),
          el('div', { class: 'muted', text: `${Math.round(value)}${engaged ? ' · seen this quarter' : ''}` }),
        ]),
      ]),
      el('p', { class: 'muted', text: who.note }),
      chips,
    ]);
  });
}

/* ---------- Log ---------- */

/** @param {GameState} s */
function renderLog(s) {
  return [el('div', { class: 'card' }, [
    el('h2', { text: 'What happened' }),
    el('div', { class: 'log' }, [...s.log].reverse().map((e) =>
      el('div', { class: 'e' }, [
        el('span', { class: 't', text: `Q${e.turn + 1}` }),
        el('span', { class: e.kind, text: e.text }),
      ]))),
  ])];
}

/* ---------- overlays: event card, end card ---------- */

/** @param {GameState} s */
function renderOverlay(s) {
  const root = document.getElementById('overlay');
  if (!root) return;
  root.innerHTML = '';

  const wantDuck = s.pendingEvent !== null || s.status !== 'playing';
  if (wantDuck !== ducked) { duck(wantDuck); ducked = wantDuck; }

  if (s.status !== 'playing') {
    const won = s.status === 'won';
    const kind = s.endingKind ?? 'handover';
    /** @type {Record<string, string>} */
    const TITLE = {
      handover: 'Handover',
      extraction: 'A profitable asset',
      blockade: 'The road is blocked',
      sunk: 'The money ran out',
      dry: 'There is not enough water',
    };
    /** @type {Record<string, string>} */
    const BODY = {
      handover: 'The node is somebody else’s to run now. Sakhile still lives here.',
      extraction: 'You leave with a profitable asset and a town that never became one. It scores. It is not what you came to do.',
      blockade: 'Nobody is coming back to the table. Trust was the scarce resource all along.',
      sunk: 'The paper years ended before anything was built.',
      dry: 'The bulk services survey was never commissioned, and by the time the number mattered there was no way left to raise it. Try the same seed again.',
    };
    const kids = [
      el('h2', { text: TITLE[kind] ?? 'The run is over' }),
      el('p', { class: 'body', text: BODY[kind] ?? '' }),
    ];
    if (s.score) {
      kids.push(el('div', { class: 'score' }, [
        el('div', { class: 'total', text: String(s.score.total) }),
        el('div', { class: 'muted', text: `${s.score.householdsWithTitle} households with title × ${BALANCE.score.householdWeight}` }),
        el('div', { class: 'muted', text: `${s.score.jobsInCatchment} jobs × ${BALANCE.score.jobWeight}` }),
        el('div', { class: 'muted', text: `${s.score.trustAtHandover} trust × ${BALANCE.score.trustWeight}` }),
        el('div', { class: 'muted', text: `${money(s.meters.cash)} cash — worth nothing here, deliberately` }),
      ]));
    }
    kids.push(el('div', { class: 'chips' }, [
      button('Same seed again', () => restart(s.seed), { primary: true }),
      button('A different node', () => restart(), {}),
    ]));
    root.appendChild(el('div', { class: 'sheet' }, kids));
    root.hidden = false;
    if (!endToneDone) { endToneDone = true; sfx(won && kind !== 'extraction' ? 'good' : 'bad'); }
    return;
  }

  if (s.pendingEvent) {
    const card = cardDef(s.pendingEvent);
    if (card) {
      root.appendChild(el('div', { class: 'sheet' }, [
        el('h2', { text: card.title }),
        el('p', { class: 'body', text: card.body }),
        el('div', { class: 'choices' }, card.choices.map((c) =>
          button(c.text, () => dispatch({ type: 'RESOLVE_EVENT', choiceId: c.id }), { wide: true }))),
      ]));
      root.hidden = false;
      return;
    }
  }
  root.hidden = true;
}

/* One-shot so the ending stinger does not retrigger on every redraw. */
let endToneDone = false;

/* ---------- the whole screen ---------- */

export function render() {
  const s = getState();

  const topEl = document.getElementById('topbar');
  const screenEl = document.getElementById('screen');
  const barEl = document.getElementById('tabbar');
  const overlayEl = document.getElementById('overlay');

  /* Title and explainer own the whole viewport: no meters, no tabs, no card. */
  if (view !== 'run') {
    if (topEl) topEl.innerHTML = '';
    if (barEl) barEl.innerHTML = '';
    if (overlayEl) overlayEl.hidden = true;
    if (!screenEl) return;
    screenEl.className = 'screen full';
    if (view === 'explainer') {
      renderExplainer(screenEl, () => { view = 'run'; render(); });
    } else {
      renderTitle(screenEl, {
        hasSave: hasSavedRun(),
        onContinue: () => { view = 'run'; render(); },
        onNew: () => {
          restart();
          endToneDone = false;
          view = hasSeenExplainer() ? 'run' : 'explainer';
          render();
        },
        onExplain: () => { view = 'explainer'; render(); },
      });
    }
    return;
  }
  if (screenEl) screenEl.className = 'screen';

  const top = document.getElementById('topbar');
  if (top) { top.innerHTML = ''; top.appendChild(renderTop(s)); }

  const screen = document.getElementById('screen');
  if (screen) {
    screen.innerHTML = '';
    const parts =
      tab === 'node' ? renderNode(s)
      : tab === 'work' ? renderWork(s)
      : tab === 'people' ? renderPeople(s)
      : renderLog(s);
    for (const p of parts) screen.appendChild(p);

    if (tab === 'node' && s.status === 'playing') {
      screen.appendChild(button(
        'End the quarter',
        () => dispatch({ type: 'END_TURN' }),
        { primary: true, disabled: s.pendingEvent !== null },
      ));
      const last = screen.lastElementChild;
      if (last) last.classList.add('wide');
    }
  }

  const bar = document.getElementById('tabbar');
  if (bar) {
    bar.innerHTML = '';
    for (const [id, label] of TABS) {
      const n = s.missions.offered.length;
      const tabId = /** @type {string} */ (id);
      bar.appendChild(el('button', {
        role: 'tab',
        'aria-selected': String(tab === tabId),
        onclick: () => { tab = tabId; render(); },
      }, [
        label,
        id === 'work' && n > 0 ? el('span', { class: 'badge', text: String(n) }) : null,
      ]));
    }
  }

  renderOverlay(s);
}

/** Exposed for the dev console and for tests. @param {string} id */
export function setTab(id) { tab = id; render(); }
