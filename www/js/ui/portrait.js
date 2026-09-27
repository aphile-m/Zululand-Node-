// @ts-check
/* portrait.js — the character portraits: sprite strips when the art exists,
   code-drawn SVG busts when it does not.

   The Trainer App ships `vic-avatar.js` for exactly this reason, and it matters
   more here: SPEC §12 requires the game to launch and play with the network
   disabled, and §13 puts the UI (phase 2) before the art (phase 4). The drawn
   version is not a grey box — six people need six readable silhouettes at 56px,
   so each gets their own hair, garment and one distinguishing feature. */

/** @typedef {{ skin:string, hair:string, garment:string, feature?:'glasses'|'beard'|'whitebeard'|'hat'|'braids'|'crop' }} Look */

/** @type {Record<string, Look>} */
const LOOKS = {
  sakhile: { skin: '#8A5A34', hair: '#181818', garment: '#7FA8C9', feature: 'crop' },
  mthiyane: { skin: '#6E4526', hair: '#E8E6E0', garment: '#3A3F3C', feature: 'whitebeard' },
  thandeka: { skin: '#9A6640', hair: '#1C1C1C', garment: '#7A2E3A', feature: 'braids' },
  sipho: { skin: '#5F3A20', hair: '#6B6B63', garment: '#5A6B3C', feature: 'hat' },
  renier: { skin: '#C98F6E', hair: '#B39A63', garment: '#2E3A52', feature: 'beard' },
  amara: { skin: '#6B4226', hair: '#141414', garment: '#3A3F45', feature: 'glasses' },
};
const FALLBACK = { skin: '#7A5436', hair: '#1A1A1A', garment: '#3A3F3C' };

/** Written by scripts/make_sprites.py: { key: { fw, fh, frames } }. */
/** @type {Record<string, { fw:number, fh:number, frames:number }>} */
let meta = {};

/**
 * Resolve the sprite metadata once, before the first render, so portraits do
 * not flicker from drawn to sprite on load. Failing is fine and expected —
 * before the sprites workflow has ever run there is no file to read.
 */
export async function loadPortraits() {
  try {
    const res = await fetch('img/ch-meta.json', { cache: 'no-cache' });
    if (res.ok) meta = await res.json();
  } catch {
    meta = {}; // offline first run, or art not generated yet: draw instead
  }
}

/**
 * An SVG bust. Deliberately simple shapes with a heavy outline so it reads at
 * 56px and never pretends to be the finished art.
 * @param {string} key
 * @returns {string} SVG markup
 */
export function drawnPortrait(key) {
  const L = LOOKS[key] ?? FALLBACK;
  const f = /** @type {Look} */ (L).feature;
  const O = '#0C0E0D';

  const hair =
    f === 'hat'
      ? `<path d="M10 24 Q32 6 54 24 L54 27 L10 27 Z" fill="${L.hair}" stroke="${O}" stroke-width="2"/>
         <rect x="6" y="26" width="52" height="5" rx="2.5" fill="${L.hair}" stroke="${O}" stroke-width="2"/>`
      : f === 'braids'
        ? `<path d="M13 30 Q13 12 32 12 Q51 12 51 30 L51 34 L47 34 Q47 19 32 19 Q17 19 17 34 L13 34 Z" fill="${L.hair}" stroke="${O}" stroke-width="2"/>
           <circle cx="32" cy="12" r="7" fill="${L.hair}" stroke="${O}" stroke-width="2"/>`
        : f === 'crop'
          ? `<path d="M15 28 Q15 13 32 13 Q49 13 49 28 L49 30 L15 30 Z" fill="${L.hair}" stroke="${O}" stroke-width="2"/>`
          : `<path d="M14 29 Q14 11 32 11 Q50 11 50 29 L50 32 L14 32 Z" fill="${L.hair}" stroke="${O}" stroke-width="2"/>`;

  const beard =
    f === 'whitebeard'
      ? `<path d="M19 38 Q19 54 32 54 Q45 54 45 38 L45 44 Q45 50 32 50 Q19 50 19 44 Z" fill="${L.hair}" stroke="${O}" stroke-width="2"/>`
      : f === 'beard'
        ? `<path d="M26 42 Q32 46 38 42" fill="none" stroke="${L.hair}" stroke-width="2.5" stroke-linecap="round"/>`
        : '';

  const glasses =
    f === 'glasses'
      ? `<g fill="none" stroke="#D8C271" stroke-width="1.8">
           <rect x="20" y="31" width="10" height="7.5" rx="1.5"/>
           <rect x="34" y="31" width="10" height="7.5" rx="1.5"/>
           <path d="M30 34.5 h4"/>
         </g>`
      : '';

  return `<svg viewBox="0 0 64 64" role="img" aria-label="${key}" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" fill="#1D2320"/>
  <path d="M8 64 Q8 46 32 46 Q56 46 56 64 Z" fill="${L.garment}" stroke="${O}" stroke-width="2"/>
  <rect x="27" y="38" width="10" height="10" fill="${L.skin}" stroke="${O}" stroke-width="2"/>
  <ellipse cx="32" cy="30" rx="15" ry="17" fill="${L.skin}" stroke="${O}" stroke-width="2"/>
  ${hair}
  <circle cx="26" cy="31" r="1.9" fill="${O}"/>
  <circle cx="38" cy="31" r="1.9" fill="${O}"/>
  ${beard}
  ${glasses}
</svg>`;
}

/**
 * The portrait element for a character key. Always returns something.
 *
 * The sprite path shows the HEAD of the first frame rather than the whole
 * figure: a full body scaled into 56px is an unreadable smudge, whereas the
 * head at the same size is unmistakably one of six people. Frame width comes
 * from ch-meta.json because it differs per character — the sheets were cropped
 * to their own figures, not to a common cell.
 *
 * @param {string} key
 * @param {number} [size]
 * @returns {HTMLElement}
 */
export function portrait(key, size = 56) {
  const box = document.createElement('div');
  box.className = 'portrait';
  box.style.width = `${size}px`;
  box.style.height = `${size}px`;

  const m = meta[key];
  if (m && m.fw > 0) {
    /* Scale so the frame's head (roughly the top quarter of a standing figure)
       fills the box, then centre frame 0 horizontally. */
    const scale = (size * 4) / m.fh;
    const inner = document.createElement('div');
    inner.className = 'sprite-head';
    inner.style.backgroundImage = `url(img/ch-${key}.webp)`;
    inner.style.backgroundSize = `${m.fw * m.frames * scale}px ${m.fh * scale}px`;
    inner.style.backgroundPositionX = `${(size - m.fw * scale) / 2}px`;
    inner.style.backgroundPositionY = '0px';
    box.appendChild(inner);
  } else {
    box.innerHTML = drawnPortrait(key);
  }
  return box;
}

/**
 * The full standing figure, animated, for the title and the explainer. Falls
 * back to nothing rather than to a giant bust — the drawn portrait is a 56px
 * device and does not survive being blown up.
 *
 * The strip is one row of frames, so the idle loop is `background-position-x`
 * stepped across it. `steps(n)` is what makes it read as sprite animation
 * rather than as a slide: without it the browser tweens between frames and the
 * figure smears. The travel distance differs per character (each sheet was
 * cropped to its own figure), so it rides in a custom property that the shared
 * keyframe reads.
 *
 * @param {string} key
 * @param {number} height
 * @returns {HTMLElement|null}
 */
export function figure(key, height = 180) {
  const m = meta[key];
  if (!m || !m.fw) return null;
  const scale = height / m.fh;
  const frameW = m.fw * scale;
  const d = document.createElement('div');
  d.className = 'sprite-figure';
  d.style.width = `${frameW}px`;
  d.style.height = `${height}px`;
  d.style.backgroundImage = `url(img/ch-${key}.webp)`;
  d.style.backgroundSize = `${frameW * m.frames}px ${height}px`;
  if (m.frames > 1) {
    d.style.setProperty('--travel', `-${frameW * m.frames}px`);
    // ~7fps, the rate the Trainer App settled on for Vic's idle
    d.style.animation = `spritewalk ${(m.frames / 7).toFixed(2)}s steps(${m.frames}) infinite`;
  }
  d.setAttribute('role', 'img');
  d.setAttribute('aria-label', key);
  return d;
}
