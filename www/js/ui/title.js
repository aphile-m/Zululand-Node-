// @ts-check
/* title.js — the splash screen and the explainer.

   SPEC §14 rules out "a tutorial system". This is not one: there is no
   contextual handholding, no forced first-turn script, nothing watching what
   you do. It is six static panels you can skip, read once, and reach again from
   the title. A game that opens on twelve collapsed parcels and no explanation
   is not respecting the player's time either.

   What the explainer must NOT do is give away §8 or §9. Panel 2 says the water
   number is unknown, which is true and is the hook; it never says what happens
   if you ignore it. The sports field is not mentioned at all — §8 requires that
   the first time is unwarned, and a "careful with displacement!" line here
   would defuse the whole thing. */

import { PLAYER, STAKEHOLDERS, BALANCE } from '../../content/index.js';
import { figure, portrait } from './portrait.js';
import { sfx, unlock, startMusic, isMuted, toggleMute } from './audio.js';

const SEEN_KEY = 'node_seen_explainer';

export const hasSeenExplainer = () => {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
};
export const markExplainerSeen = () => {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
};

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

/** The mark from the app icon: a node with three links leaving it. */
function nodeMark() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'mark');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `
    <g stroke="#C9A227" stroke-width="4" fill="none" stroke-linecap="round">
      <path d="M60 60 L92 82"/><path d="M60 60 L28 82"/><path d="M60 60 L60 22"/>
    </g>
    <circle cx="92" cy="82" r="8" fill="#7FB069"/>
    <circle cx="28" cy="82" r="8" fill="#7FB069"/>
    <circle cx="60" cy="22" r="8" fill="#7FB069"/>
    <circle cx="60" cy="60" r="14" fill="#C9A227"/>`;
  return svg;
}

/* ---------- the explainer panels ---------- */

/** @returns {{ title:string, body:() => (Node|string)[] }[]} */
function panels() {
  /** @param {(Node|string)[]} kids */
  const p = (...kids) => kids;
  return [
    {
      title: 'Eighteen years',
      body: () => p(
        el('div', { class: 'hero' }, [figure('sakhile', 200) ?? portrait('sakhile', 120)]),
        /* The bio already opens with his name; prefixing "You are Sakhile."
           made the panel read "You are Sakhile. Sakhile grew up here." */
        el('p', { class: 'lede', text: `You are ${PLAYER.name}.` }),
        el('p', { text: PLAYER.bio }),
        el('p', { class: 'lede', text: 'The land is bare, and nobody agrees who owns it. You have about eighteen years.' }),
      ),
    },
    {
      title: 'Four things you spend',
      body: () => p(
        el('div', { class: 'keyrow' }, [
          el('div', { class: 'keycell' }, [el('b', { text: 'Cash' }), el('span', { text: 'Rand, in millions. You start with very little.' })]),
          el('div', { class: 'keycell' }, [el('b', { text: 'Trust' }), el('span', { text: 'What people will let you do. It decays in the years when nothing visible is built.' })]),
          el('div', { class: 'keycell' }, [el('b', { text: 'Paper' }), el('span', { text: 'Studies and authorisations. Land rights are bought with it.' })]),
          el('div', { class: 'keycell' }, [el('b', { text: 'Water' }), el('span', { text: 'How much the ground will actually give you. It reads ? because nobody has looked yet.' })]),
        ]),
        el('p', { class: 'muted', text: 'The scarcest of the four is not cash.' }),
      ),
    },
    {
      title: 'Five people',
      body: () => p(
        el('div', { class: 'castrow' }, STAKEHOLDERS.map((s) =>
          /* Last-word-of-name gave "Zyl" for Renier van Zyl, so the short form is
             content rather than string surgery. */
          el('div', { class: 'castcell' }, [portrait(s.portrait || s.id, 52), el('span', { text: s.short })]))),
        el('p', { text: 'Every one of them can help you and every one of them can stop you. They give you work — and doing their work is how a young man with no balance sheet gets funded.' }),
        el('p', { class: 'muted', text: 'Taking a job costs nothing. Doing it is what costs.' }),
      ),
    },
    {
      title: 'A quarter at a time',
      body: () => p(
        el('p', { text: `Each turn is three months. You get ${BALANCE.actionPointsPerTurn} actions: see someone, commission a study, take rights over a parcel, start building.` }),
        el('p', { text: 'Then you end the quarter. Studies and construction take years, not turns — you start them and wait. Something usually happens while you do.' }),
      ),
    },
    {
      title: 'Seven acts',
      body: () => p(
        el('ol', { class: 'acts' }, [
          el('li', { text: 'Fog of ownership' }), el('li', { text: 'The paper years' }),
          el('li', { text: 'Ignition' }), el('li', { text: 'Three engines' }),
          el('li', { text: 'The water wall' }), el('li', { text: 'Erven and title' }),
          el('li', { text: 'Handover' }),
        ]),
        el('p', { text: 'Each act has conditions. Meet them and you may move on — the game never moves you. Moving on raises the cost of everything, so it is a decision, not a reward.' }),
      ),
    },
    {
      title: 'What you are scored on',
      body: () => p(
        el('div', { class: 'scorekey' }, [
          el('div', {}, [el('b', { text: 'Households with title' }), el('span', { text: `x${BALANCE.score.householdWeight}` })]),
          el('div', {}, [el('b', { text: 'Jobs in the catchment' }), el('span', { text: `x${BALANCE.score.jobWeight}` })]),
          el('div', {}, [el('b', { text: 'Trust at handover' }), el('span', { text: `x${BALANCE.score.trustWeight}` })]),
          el('div', { class: 'zero' }, [el('b', { text: 'Cash' }), el('span', { text: 'nothing' })]),
        ]),
        el('p', { class: 'lede', text: 'A run that ends with a profitable asset and a failed town scores badly. That is the whole game.' }),
      ),
    },
  ];
}

/**
 * @param {HTMLElement} root
 * @param {() => void} onDone
 */
export function renderExplainer(root, onDone) {
  let i = 0;
  const all = panels();

  const draw = () => {
    const pan = all[i];
    if (!pan) return;
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'explainer' }, [
      el('div', { class: 'dots' }, all.map((_, k) => el('span', { class: k === i ? 'on' : '' }))),
      el('h2', { text: pan.title }),
      el('div', { class: 'panelbody' }, pan.body()),
      el('div', { class: 'navrow' }, [
        i > 0 && el('button', {
          class: 'btn', text: 'Back',
          onclick: () => { sfx('tap'); i--; draw(); },
        }),
        el('button', {
          class: 'btn primary grow-btn',
          text: i === all.length - 1 ? 'Begin' : 'Next',
          onclick: () => {
            sfx(i === all.length - 1 ? 'confirm' : 'tap');
            if (i === all.length - 1) { markExplainerSeen(); onDone(); } else { i++; draw(); }
          },
        }),
      ]),
      el('button', {
        class: 'linkish', text: 'Skip',
        onclick: () => { sfx('tap'); markExplainerSeen(); onDone(); },
      }),
    ]));
  };
  draw();
}

/**
 * @param {HTMLElement} root
 * @param {{ hasSave:boolean, onNew:() => void, onContinue:() => void, onExplain:() => void }} o
 */
export function renderTitle(root, o) {
  root.innerHTML = '';

  /* Every button here is a user gesture, which is the only moment a browser
     will let an AudioContext start (SPEC §12). */
  /** @param {() => void} fn @param {string} [cue] */
  const withSound = (fn, cue = 'tap') => () => {
    unlock();
    startMusic();
    sfx(/** @type {any} */ (cue));
    fn();
  };

  const soundBtn = el('button', {
    class: 'linkish sound',
    text: isMuted() ? '♪ sound off' : '♪ sound on',
    onclick: () => {
      unlock();
      startMusic();
      const m = toggleMute();
      soundBtn.textContent = m ? '♪ sound off' : '♪ sound on';
      if (!m) sfx('tap');
    },
  });

  root.appendChild(el('div', { class: 'title' }, [
    nodeMark(),
    el('h1', { class: 'wordmark', text: 'NODE' }),
    el('p', { class: 'tagline', text: 'A rural development game. Trust is the scarce resource.' }),
    figure('sakhile', 190),
    el('div', { class: 'titlebtns' }, [
      o.hasSave && el('button', { class: 'btn primary wide', text: 'Continue', onclick: withSound(o.onContinue, 'confirm') }),
      el('button', {
        class: `btn ${o.hasSave ? '' : 'primary'} wide`,
        text: o.hasSave ? 'Start a new node' : 'Begin',
        onclick: withSound(o.onNew, 'confirm'),
      }),
      el('button', { class: 'btn wide', text: 'How it works', onclick: withSound(o.onExplain) }),
    ]),
    soundBtn,
    el('p', { class: 'credit', text: 'KwaZulu-Natal. Eighteen years. One quarter at a time.' }),
  ]));
}
