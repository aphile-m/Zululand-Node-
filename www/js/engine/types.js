// @ts-check
/* types.js — the shape of the world. JSDoc typedefs only; this file emits no
   runtime code and exists so `tsc --noEmit` can check the engine (DECISIONS D1).

   Mirrors SPEC.md §5 with the additions recorded in DECISIONS.md D4-D9. Where a
   field is not in §5, the deviation is named in the comment beside it.

   SPEC §2.3: everything here must be JSON-serializable. No Map, no Set, no Date,
   no class instances, no functions, and no `undefined` in stored state — an
   absent optional field is simply absent. */

/** @typedef {0|1|2|3|4|5|6} ActId */

/**
 * SPEC §5. `water` is hidden until surveyed — see selectors.visibleWater, which
 * is the only sanctioned read (SPEC §9).
 * @typedef {object} Meters
 * @property {number} cash   ZAR millions, one decimal
 * @property {number} trust  0-100
 * @property {number} paper  0-100, progress toward the current act's rights package (D8)
 * @property {number} water  0-100 available bulk capacity, HIDDEN until surveyed
 */

/** @typedef {'unknown'|'identified'|'optioned'|'leased'|'owned'|'frozen'} ParcelStatus */

/**
 * @typedef {object} Parcel
 * @property {string} id
 * @property {ParcelStatus} status
 * @property {'municipal'|'trust'|'private'|'unknown'} ownerType
 * @property {number} hectares
 * @property {string} currentUse
 * @property {number} displacementCost  trust hit if built on without mitigation
 * @property {string[]} studiesComplete
 * @property {number} [frozenUntilTurn]
 */

/**
 * @typedef {object} Building
 * @property {string} id
 * @property {string} typeId    key into buildings.json
 * @property {string} parcelId
 * @property {number} builtOnTurn
 * @property {boolean} operational
 */

/** @typedef {'study'|'licence'|'construction'|'freeze'|'application'} TimerKind */

/**
 * @typedef {object} Timer
 * @property {string} id
 * @property {TimerKind} kind
 * @property {string} refId          study id, building id, parcel id
 * @property {number} resolvesOnTurn
 */

/** @typedef {'inkosi'|'municipality'|'community'|'oilCo'|'dfi'} StakeholderId */

/**
 * @typedef {object} Relationships
 * @property {number} inkosi        all 0-100
 * @property {number} municipality
 * @property {number} community
 * @property {number} oilCo
 * @property {number} dfi
 */

/**
 * How a run ended. SPEC §10 called this `LossReason`, but `extraction` is a
 * scored completion rather than a loss — see DECISIONS D6.
 * @typedef {'blockade'|'sunk'|'dry'|'extraction'|'handover'} EndingKind
 */

/**
 * @typedef {object} LogEntry
 * @property {number} turn
 * @property {string} text
 * @property {'info'|'good'|'bad'} kind
 */

/**
 * @typedef {object} Score
 * @property {number} householdsWithTitle
 * @property {number} jobsInCatchment
 * @property {number} trustAtHandover
 * @property {number} total
 */

/**
 * SPEC §5, plus the four fields §6's turn loop needs but §5 omits (DECISIONS D5)
 * and the D6 rename of `lossReason`.
 *
 * @typedef {object} GameState
 * @property {number} schemaVersion
 * @property {number} seed
 * @property {number} rngCursor
 * @property {number} turn                    0-indexed quarters
 * @property {ActId} act
 * @property {number} apRemaining             D5 — action points left this turn
 * @property {Meters} meters
 * @property {boolean} waterSurveyed          when false the UI must render water as "?"
 * @property {Record<string, Parcel>} parcels
 * @property {Building[]} buildings
 * @property {Timer[]} timers
 * @property {Relationships} relationships
 * @property {Record<string, number>} counters      D5 — e.g. cashPositiveStreak
 * @property {StakeholderId[]} engagedThisTurn      D5 — suppresses §6.5 drift
 * @property {number} lastProgressTurn              D5 — gates §6.4 trust decay
 * @property {string[]} hand                  retained, always [] in v1 (D9)
 * @property {string[]} deck
 * @property {string[]} discard
 * @property {string|null} pendingEvent       card id awaiting a player choice
 * @property {Record<string, boolean>} flags
 * @property {LogEntry[]} log                 last 200 entries only
 * @property {'playing'|'won'|'lost'} status
 * @property {EndingKind} [endingKind]
 * @property {Score} [score]
 */

/**
 * SPEC §5. Unchanged — no action was added or removed. D7's water-raising route
 * deliberately reuses COMMISSION_STUDY rather than widening this union.
 *
 * @typedef {{ type:'START_RUN', seed:number }} StartRunAction
 * @typedef {{ type:'ENGAGE', stakeholder:StakeholderId, intensity:1|2|3 }} EngageAction
 * @typedef {{ type:'COMMISSION_STUDY', studyId:string, parcelId:string }} CommissionStudyAction
 * @typedef {{ type:'ACQUIRE_RIGHTS', parcelId:string, mode:'option'|'lease'|'purchase' }} AcquireRightsAction
 * @typedef {{ type:'BUILD', buildingTypeId:string, parcelId:string }} BuildAction
 * @typedef {{ type:'MITIGATE', parcelId:string }} MitigateAction
 * @typedef {{ type:'RESOLVE_EVENT', choiceId:string }} ResolveEventAction
 * @typedef {{ type:'ADVANCE_ACT' }} AdvanceActAction
 * @typedef {{ type:'END_TURN' }} EndTurnAction
 *
 * @typedef {StartRunAction|EngageAction|CommissionStudyAction|AcquireRightsAction
 *   |BuildAction|MitigateAction|ResolveEventAction|AdvanceActAction|EndTurnAction} Action
 */

/* ---------- content types (www/content/*.json, SPEC §2.4) ---------- */

/**
 * The recursive gate predicate language, SPEC §7 plus the three additions in
 * DECISIONS D4. Evaluated by gates.js — no eval, no string expressions.
 *
 * @typedef {{ all: Predicate[] }
 *   | { any: Predicate[] }
 *   | { not: Predicate }
 *   | { atLeastN: { n:number, of:Predicate[] } }
 *   | { flag: string }
 *   | { meterAtLeast: { meter:keyof Meters, value:number } }
 *   | { parcelStatusAtLeast: { parcel:string, status:ParcelStatus } }
 *   | { buildingOperational: { typeId?:string, tag?:string } }
 *   | { relationshipAtLeast: { who:StakeholderId, value:number } }
 *   | { counterAtLeast: { counter:string, value:number } }
 *   | { derivedAtLeast: { metric:'householdsWithTitle'|'jobsInCatchment', value:number } }
 * } Predicate
 */

/**
 * @typedef {object} ActDef
 * @property {ActId} id
 * @property {string} name
 * @property {string} subtitle
 * @property {Predicate|null} gate   null on the terminal act
 * @property {string[]} unlocks
 * @property {number} burnMultiplier
 */

/**
 * @typedef {object} BuildingDef
 * @property {string} id
 * @property {string} name
 * @property {string} tag             'agri' | 'energy' | 'waste' | 'services' | ...
 * @property {number} buildCost
 * @property {number} buildTurns
 * @property {number} quarterlyRevenue
 * @property {number} quarterlyOpex
 * @property {number} jobs
 * @property {number} households      erven with title delivered on completion
 * @property {number} trustOnComplete
 * @property {string} requiresUnlock  '' when available from act 0
 */

/**
 * D7 gives studies a `waterDelta`; D8 gives them a `paperGain`.
 * @typedef {object} StudyDef
 * @property {string} id
 * @property {string} name
 * @property {number} cost
 * @property {number} turns
 * @property {number} paperGain
 * @property {number} waterDelta      D7 — raises bulk supply on completion
 * @property {boolean} revealsWater
 * @property {string} setsFlag        '' when it sets none
 * @property {string} requiresUnlock  '' when available from act 0
 */

/**
 * @typedef {object} CardChoice
 * @property {string} id
 * @property {string} text
 * @property {Partial<Meters>} meters
 * @property {Partial<Relationships>} relationships
 * @property {Record<string, boolean>} [flags]
 */

/**
 * @typedef {object} CardDef
 * @property {string} id
 * @property {string} title
 * @property {string} body
 * @property {CardChoice[]} choices
 */

/**
 * @typedef {object} StakeholderDef
 * @property {StakeholderId} id
 * @property {string} name
 * @property {string} note
 */

export {};
