// @ts-check
/* audio.js — a small chiptune engine, synthesised rather than shipped.

   No audio files and no library: DECISIONS D1 keeps this repo free of a build
   step and of dependencies, and a .mp3 loop would be the largest asset in the
   project by an order of magnitude. Web Audio makes the whole soundtrack about
   4KB of source that also works offline by construction.

   SPEC §12: "Audio requires a user gesture; the title screen provides it." The
   AudioContext is therefore created on the first click and never before —
   browsers block it otherwise, and a console full of autoplay warnings is how
   you find out.

   The music is deliberately spare. §1 asks for "dry, respectful, specific", and
   a jaunty arcade loop over a game about eighteen years of waiting for
   permissions would be the wrong joke. */

/** @type {AudioContext|null} */
let ctx = null;
/** @type {GainNode|null} */
let master = null;
/** @type {GainNode|null} */
let musicGain = null;
/** @type {number|undefined} */
let timer;
let step = 0;
let nextNoteTime = 0;
let playing = false;

const MUTE_KEY = 'node_muted';
let muted = (() => {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
})();

/* ---------- notes ---------- */

/** Equal temperament from A4. @param {string} n */
function freq(n) {
  const NAMES = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const m = /^([A-G])([b#]?)(\d)$/.exec(n);
  if (!m) return 0;
  const [, letter, accidental, octave] = m;
  const base = NAMES[/** @type {keyof typeof NAMES} */ (letter)] ?? 0;
  const acc = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return 440 * Math.pow(2, (base + acc + (Number(octave) - 4) * 12) / 12);
}

/* ---------- the tune ----------

   D minor, i - VI - III - VII (Dm - Bb - F - C). Four bars, sixteen 16th-note
   steps each. The melody rests more than it plays: the bar lines are supposed
   to feel like quarters passing rather than like a chase.

   '.' rests, '-' sustains the previous note. */

const MELODY = (
  'D4 .  .  .  F4 .  .  .  A4 .  .  -  .  .  .  . ' +
  '.  .  Bb4 . .  .  A4 .  .  .  F4 .  -  .  .  . ' +
  'C5 .  .  .  A4 .  .  .  F4 .  .  -  .  .  .  . ' +
  '.  .  G4 .  .  .  A4 .  .  .  D4 .  -  .  .  . '
).trim().split(/\s+/);

/* Bass on 8ths — two per bar-half, the second half lifting to the fifth. */
const BASS = (
  'D2 D2 D2 D2 D2 D2 A2 A2 ' +
  'Bb1 Bb1 Bb1 Bb1 Bb1 Bb1 F2 F2 ' +
  'F2 F2 F2 F2 F2 F2 C3 C3 ' +
  'C2 C2 C2 C2 C2 C2 G2 G2 '
).trim().split(/\s+/);

const STEPS = 64;          // 4 bars x 16
const BPM = 92;
const STEP_SECONDS = 60 / BPM / 4;

/* ---------- voices ---------- */

/** @type {AudioBuffer|null} */
let noiseBuffer = null;

function makeNoise() {
  if (!ctx || noiseBuffer) return;
  const n = Math.floor(ctx.sampleRate * 0.2);
  noiseBuffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
}

/**
 * @param {number} f
 * @param {number} at
 * @param {number} dur
 * @param {OscillatorType} type
 * @param {number} vol
 */
function tone(f, at, dur, type, vol) {
  if (!ctx || !musicGain || f <= 0) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = f;
  /* A hard attack and an exponential tail is what makes it read as chip rather
     than as a synth pad. Exponential ramps cannot reach zero, hence the floor. */
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(musicGain);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** @param {number} at @param {number} vol */
function hat(at, vol) {
  if (!ctx || !musicGain || !noiseBuffer) return;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
  s.connect(hp).connect(g).connect(musicGain);
  s.start(at);
  s.stop(at + 0.05);
}

/* ---------- scheduler ---------- */

/* Web Audio needs notes scheduled ahead of time against its own clock; driving
   oscillators straight off setInterval jitters audibly. Look ahead 120ms. */
function schedule() {
  if (!ctx) return;
  while (nextNoteTime < ctx.currentTime + 0.12) {
    const i = step % STEPS;

    const mel = MELODY[i];
    if (mel && mel !== '.' && mel !== '-') {
      // hold through following '-' steps
      let dur = STEP_SECONDS;
      for (let k = i + 1; k < STEPS && MELODY[k] === '-'; k++) dur += STEP_SECONDS;
      tone(freq(mel), nextNoteTime, dur * 0.9, 'square', 0.16);
    }

    if (i % 2 === 0) {
      const b = BASS[i / 2];
      if (b) tone(freq(b), nextNoteTime, STEP_SECONDS * 1.6, 'triangle', 0.22);
    }

    if (i % 4 === 2) hat(nextNoteTime, 0.05);

    nextNoteTime += STEP_SECONDS;
    step++;
  }
}

/* ---------- public ---------- */

/** Create the context. Must be called from inside a user gesture (SPEC §12). */
export function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
  if (!AC) return; // no Web Audio: the game is silent and otherwise identical
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.55;
  musicGain.connect(master);
  makeNoise();
}

export function startMusic() {
  if (!ctx || playing) return;
  playing = true;
  step = 0;
  nextNoteTime = ctx.currentTime + 0.05;
  timer = window.setInterval(schedule, 40);
}

export function stopMusic() {
  playing = false;
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

/** Duck the music without stopping it — used while a card is on screen. */
/** @param {boolean} on */
export function duck(on) {
  if (!ctx || !musicGain) return;
  musicGain.gain.setTargetAtTime(on ? 0.18 : 0.55, ctx.currentTime, 0.2);
}

/**
 * Short interface blips. Kept tiny and quiet: a turn-based game makes a lot of
 * clicks, and anything with a tail becomes a drone.
 * @param {'tap'|'confirm'|'deny'|'good'|'bad'|'turn'} kind
 */
export function sfx(kind) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime;
  const audio = ctx;
  const out = master;
  /**
   * @param {number} f @param {number} at @param {number} dur
   * @param {number} [vol] @param {string} [type]
   */
  const beep = (f, at, dur, vol = 0.12, type = 'square') => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = /** @type {OscillatorType} */ (type);
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.02);
  };
  if (kind === 'tap') beep(660, t, 0.05, 0.07);
  else if (kind === 'confirm') { beep(523.25, t, 0.07); beep(783.99, t + 0.06, 0.1); }
  else if (kind === 'deny') beep(147, t, 0.14, 0.1, 'sawtooth');
  else if (kind === 'good') { beep(523.25, t, 0.07); beep(659.25, t + 0.07, 0.07); beep(783.99, t + 0.14, 0.14); }
  else if (kind === 'bad') { beep(311, t, 0.12, 0.11, 'sawtooth'); beep(233, t + 0.1, 0.2, 0.11, 'sawtooth'); }
  else if (kind === 'turn') beep(392, t, 0.06, 0.08, 'triangle');
}

export const isMuted = () => muted;

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* private mode */ }
  if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
  return muted;
}
