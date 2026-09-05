// @ts-check
/* events.js — the event deck (SPEC §6.6).

   Shuffle, draw, reshuffle. Every function is pure and threads the RNG cursor,
   so the deck order is a function of the seed and the number of draws taken —
   which is what makes a replayed run draw the same cards in the same order. */

import { CARDS, cardDef } from '../../content/index.js';
import { shuffle } from './rng.js';

/**
 * @param {number} seed
 * @param {number} cursor
 * @returns {{ deck:string[], cursor:number }}
 */
export function freshDeck(seed, cursor) {
  const r = shuffle(
    CARDS.map((c) => c.id),
    seed,
    cursor,
  );
  return { deck: r.value, cursor: r.cursor };
}

/**
 * Draw the top card. When the deck is empty the discard is reshuffled back in
 * first (SPEC §6.6) — using the cursored RNG, so the reshuffle is replayable.
 *
 * Returns `card: null` only when deck and discard are both empty, which cannot
 * happen with a non-empty cards.json but is handled rather than assumed.
 *
 * @param {string[]} deck
 * @param {string[]} discard
 * @param {number} seed
 * @param {number} cursor
 * @returns {{ card:string|null, deck:string[], discard:string[], cursor:number }}
 */
export function drawCard(deck, discard, seed, cursor) {
  let d = deck;
  let disc = discard;
  let c = cursor;

  if (d.length === 0) {
    if (disc.length === 0) return { card: null, deck: d, discard: disc, cursor: c };
    const r = shuffle(disc, seed, c);
    d = r.value;
    disc = [];
    c = r.cursor;
  }

  const [card, ...rest] = d;
  return { card: card ?? null, deck: rest, discard: disc, cursor: c };
}

/**
 * Apply one choice from the pending card. Returns the deltas to merge rather
 * than a new state — reduce.js owns all state assembly (SPEC §2.1).
 *
 * @param {string} cardId
 * @param {string} choiceId
 * @returns {{ meters:Partial<import('./types.js').Meters>,
 *             relationships:Partial<import('./types.js').Relationships>,
 *             flags:Record<string, boolean>,
 *             text:string } | null}
 */
export function resolveChoice(cardId, choiceId) {
  const card = cardDef(cardId);
  if (!card) return null;
  const choice = card.choices.find((ch) => ch.id === choiceId);
  if (!choice) return null;
  return {
    meters: choice.meters ?? {},
    relationships: choice.relationships ?? {},
    flags: choice.flags ?? {},
    text: `${card.title} — ${choice.text}`,
  };
}
