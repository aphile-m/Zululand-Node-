// @ts-check
/* index.js — the single place content JSON enters the program.

   SPEC §2.4 requires balance data to live in versioned JSON in the repo, and
   §2.1 allows the reducer to import content JSON. With no build step (DECISIONS
   D1) that means import attributes, which are standard but young: Chrome 123+,
   Safari 17.2+, Firefox 135+, Node 20.10+.

   Funnelling every JSON import through this one module means that if the
   support floor ever bites, exactly one file changes rather than five. */

import actsJson from './acts.json' with { type: 'json' };
import parcelsJson from './parcels.json' with { type: 'json' };
import buildingsJson from './buildings.json' with { type: 'json' };
import studiesJson from './studies.json' with { type: 'json' };
import cardsJson from './cards.json' with { type: 'json' };
import stakeholdersJson from './stakeholders.json' with { type: 'json' };
import balanceJson from './balance.json' with { type: 'json' };

/** @type {import('../js/engine/types.js').ActDef[]} */
export const ACTS = /** @type {any} */ (actsJson);

/** @type {import('../js/engine/types.js').Parcel[]} */
export const PARCELS = /** @type {any} */ (parcelsJson);

/** @type {import('../js/engine/types.js').BuildingDef[]} */
export const BUILDINGS = /** @type {any} */ (buildingsJson);

/** @type {import('../js/engine/types.js').StudyDef[]} */
export const STUDIES = /** @type {any} */ (studiesJson);

/** @type {import('../js/engine/types.js').CardDef[]} */
export const CARDS = /** @type {any} */ (cardsJson);

/** @type {import('../js/engine/types.js').StakeholderDef[]} */
export const STAKEHOLDERS = /** @type {any} */ (stakeholdersJson);

export const BALANCE = /** @type {any} */ (balanceJson);

/** @param {string} id */
export const actDef = (id) => ACTS.find((a) => a.id === Number(id)) ?? null;
/** @param {string} id */
export const buildingDef = (id) => BUILDINGS.find((b) => b.id === id) ?? null;
/** @param {string} id */
export const studyDef = (id) => STUDIES.find((s) => s.id === id) ?? null;
/** @param {string} id */
export const cardDef = (id) => CARDS.find((c) => c.id === id) ?? null;
