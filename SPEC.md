# NODE — build handover

A turn-based rural development strategy game. Web + Android from one codebase.

This document is the specification. Read it fully before writing code. Where it is
explicit, follow it exactly. Where it is silent, choose the simplest option that does
not violate the constraints in section 2, and record the choice in `DECISIONS.md`.

---

## 1. What the game is

The player develops a rural node in KwaZulu-Natal from bare land into a functioning
neighbourhood over roughly 18 in-game years. Unlike a conventional city-builder, the
player does not begin owning the land or holding the right to build on it.

The tension is that progress requires four resources that trade against each other,
and the scarcest is not money. Trust must be spent to acquire rights, rights take years
to convert into buildings, and trust decays during the years when nothing visible is
being built. A player who optimises purely for cash reaches the end with a profitable
asset and a failed town, which scores badly.

Tone: dry, respectful, specific. Not a satire of development, and not a brochure for it.
The failure modes should feel earned and recognisable, not arbitrary.

---

## 2. Non-negotiable constraints

These exist because the whole architecture depends on them. Do not work around them.

1. **The game is a pure reducer.** `reduce(state: GameState, action: Action): GameState`.
   No mutation outside the reducer. No side effects inside it. No `Date.now()`, no
   `Math.random()`, no network calls, no DOM access, no imports of anything except types
   and content JSON.
2. **All randomness is seeded and cursored.** The reducer derives its RNG from
   `state.seed` and `state.rngCursor`, and increments the cursor for every draw. Given the
   same seed and the same action log, the reducer must produce a byte-identical final state.
3. **State is JSON-serializable.** No class instances, no `Map`, no `Set`, no `Date` objects
   (use epoch integers or turn indices), no functions, no `undefined` values in stored state.
4. **Balance data lives in versioned JSON in the repo**, never in the database. The reducer
   reads content from typed JSON modules under `src/content/`.
5. **The game runs fully client-side.** The backend stores and syncs; it never adjudicates
   gameplay during a run. The game must be completely playable with the network off.
6. **No player signup is required to play.** Anonymous auth only, with optional later linking.

---

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript, strict mode | `noUncheckedIndexedAccess` on |
| Build | Vite | |
| UI | React 18 + Tailwind | Function components, hooks |
| Map | Inline SVG | ~12 parcels. No game engine, no canvas, no Pixi |
| State | The reducer + `useReducer`, wrapped in a context | No Redux, no Zustand |
| Persistence | localStorage every turn | Sync layer separate and optional |
| Backend | Supabase (already provisioned) | Anonymous auth, one table, RLS |
| Web hosting | Cloudflare Pages | Static build output |
| Android | Capacitor | Wraps the same `dist/` |
| Tests | Vitest | Reducer tests are mandatory, UI tests optional |

Do not add dependencies beyond these without recording the reason in `DECISIONS.md`.
Specifically: no animation library, no date library, no state library, no UI component kit.

---

## 4. Repository layout

```
src/
  engine/
    types.ts          state, action, content types
    reduce.ts         the reducer — the only place state changes
    rng.ts            mulberry32 + cursored draw helpers
    selectors.ts      pure derived reads (canAfford, gatePassed, score)
    gates.ts          gate predicate evaluation
    events.ts         deck shuffle, draw, resolution
  content/
    acts.json
    parcels.json
    buildings.json
    studies.json
    cards.json
    stakeholders.json
    balance.json
  ui/
    App.tsx
    screens/          Title, Run, Endcard
    panels/           Meters, Map, Hand, ActionBar, Log
    components/
  sync/
    supabase.ts       client
    persistence.ts    localStorage read/write
    sync.ts           opportunistic push, conflict = latest turn wins
tests/
  engine/
```

The `engine/` directory must have zero imports from `ui/` or `sync/`. Enforce with an
ESLint boundary rule.

---

## 5. Core types

Implement these in `src/engine/types.ts`. Adjust field names only if you find a genuine
conflict; keep the shape.

```ts
export type ActId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Meters = {
  cash: number;      // ZAR millions, one decimal
  trust: number;     // 0-100
  paper: number;     // 0-100, progress toward current act's rights package
  water: number;     // 0-100 available bulk capacity, HIDDEN until surveyed
};

export type ParcelStatus =
  | 'unknown'        // ownership not yet established
  | 'identified'     // owner known, no rights
  | 'optioned'       // option or MoU held
  | 'leased'         // long lease or notarial right registered
  | 'owned'
  | 'frozen';        // land claim or heritage freeze

export type Parcel = {
  id: string;
  status: ParcelStatus;
  ownerType: 'municipal' | 'trust' | 'private' | 'unknown';
  hectares: number;
  currentUse: string;          // e.g. "sports field"
  displacementCost: number;    // trust hit if built on without mitigation
  frozenUntilTurn?: number;
  studiesComplete: string[];   // study ids
};

export type Building = {
  id: string;
  typeId: string;              // key into buildings.json
  parcelId: string;
  builtOnTurn: number;
  operational: boolean;
};

export type Timer = {
  id: string;
  kind: 'study' | 'licence' | 'construction' | 'freeze' | 'application';
  refId: string;               // study id, building id, etc.
  resolvesOnTurn: number;
};

export type Relationships = {
  inkosi: number;              // all 0-100
  municipality: number;
  community: number;
  oilCo: number;
  dfi: number;
};

export type LossReason = 'blockade' | 'sunk' | 'dry' | 'extraction';

export type GameState = {
  schemaVersion: number;
  seed: number;
  rngCursor: number;
  turn: number;                // 0-indexed quarters
  act: ActId;
  meters: Meters;
  waterSurveyed: boolean;      // when false, UI must render water as "?"
  parcels: Record<string, Parcel>;
  buildings: Building[];
  timers: Timer[];
  relationships: Relationships;
  hand: string[];              // card ids
  deck: string[];
  discard: string[];
  pendingEvent: string | null; // card id awaiting a player choice
  flags: Record<string, boolean>;
  log: LogEntry[];
  status: 'playing' | 'won' | 'lost';
  lossReason?: LossReason;
  score?: Score;
};

export type Score = {
  householdsWithTitle: number;
  jobsInCatchment: number;
  trustAtHandover: number;
  total: number;
};

export type Action =
  | { type: 'START_RUN'; seed: number }
  | { type: 'ENGAGE'; stakeholder: keyof Relationships; intensity: 1 | 2 | 3 }
  | { type: 'COMMISSION_STUDY'; studyId: string; parcelId: string }
  | { type: 'ACQUIRE_RIGHTS'; parcelId: string; mode: 'option' | 'lease' | 'purchase' }
  | { type: 'BUILD'; buildingTypeId: string; parcelId: string }
  | { type: 'MITIGATE'; parcelId: string }        // e.g. build replacement sports field
  | { type: 'RESOLVE_EVENT'; choiceId: string }
  | { type: 'ADVANCE_ACT' }
  | { type: 'END_TURN' };
```

`LogEntry` is `{ turn: number; text: string; kind: 'info'|'good'|'bad' }`. Keep the last
200 entries only.

---

## 6. Turn structure

One turn is one quarter. A full run is 60–80 turns.

`END_TURN` resolves in exactly this order. The order is load-bearing — do not reorder.

1. **Timers tick.** Any timer with `resolvesOnTurn === state.turn + 1` fires: studies
   complete, licences grant, construction finishes, freezes lift.
2. **Income.** Each operational building contributes its `quarterlyRevenue` minus
   `quarterlyOpex` to cash.
3. **Burn.** Fixed overhead from `balance.json`, scaled by act.
4. **Trust decay.** Applied only if no building became operational and no mitigation
   completed in the last `trustDecayGraceTurns` (default 3). This is the Act 1 pressure.
   Decay rate is `balance.trustDecayPerTurn` modified by `relationships.community`.
5. **Relationship drift.** All relationships drift toward 50 by `driftPerTurn` unless
   engaged this turn. Neglect is punished symmetrically to effort.
6. **Event draw.** Draw one card if `deck.length > 0` and `pendingEvent === null`.
   Reshuffle discard into deck when empty, using the cursored RNG.
7. **Gate check.** Evaluate the current act's gate predicate. If satisfied, set a flag
   making `ADVANCE_ACT` legal. Do not auto-advance — advancing is a player decision.
8. **Loss check.** Evaluate in order: blockade, sunk, dry.
9. **Increment turn.**

A player may take any number of legal actions before `END_TURN` within their cash and
action-point budget (`balance.actionPointsPerTurn`, default 3).

---

## 7. Acts and gates

Content lives in `acts.json`. Each act is:

```json
{
  "id": 1,
  "name": "The paper years",
  "subtitle": "All cost, no buildings",
  "gate": { "all": [
    { "flag": "environmentalAuthorisation" },
    { "flag": "roadAccessPermission" },
    { "parcelStatusAtLeast": { "parcel": "site2", "status": "leased" } }
  ]},
  "unlocks": ["build:forecourt", "study:trafficCount"],
  "burnMultiplier": 1.4
}
```

Gate predicates support `all`, `any`, `not`, `flag`, `meterAtLeast`,
`parcelStatusAtLeast`, `buildingOperational`, and `relationshipAtLeast`. Implement them
as a small recursive evaluator in `gates.ts`. No `eval`, no string expressions.

The seven acts, with their gates:

| Act | Name | Gate to advance |
|---|---|---|
| 0 | Fog of ownership | Option or MoU held over site 2, `inkosi >= 60` |
| 1 | The paper years | Environmental authorisation, road access permission, site 2 leased |
| 2 | Ignition | Forecourt operational and cash-positive for 4 consecutive turns |
| 3 | Three engines | Two of {agri, energy, waste} operational; bulk water contracted |
| 4 | The water wall | `water >= 60` and reticulation built |
| 5 | Erven and title | ≥ 200 households with title |
| 6 | Handover | Terminal act; run ends after `handoverTurns` |

---

## 8. The sports field mechanic

This is the signature teaching moment and must work precisely.

Parcel `site2` has `currentUse: "sports field"` and `displacementCost: 40`.

- `BUILD` on `site2` while `flags.sportsFieldReplaced !== true` applies the full
  `displacementCost` as an immediate trust penalty and sets `flags.communityGrievance`.
- `MITIGATE` on `site2` costs cash and 3 turns of construction. On completion it sets
  `flags.sportsFieldReplaced = true` and grants **+15 trust**.
- Building after mitigation applies no penalty.

Same action, opposite outcome, purely ordering. The UI must not warn the player the first
time. It may show a subtle hint only after a loss.

---

## 9. Hidden water

`meters.water` is initialised from the seed to a value in `[20, 90]` and `waterSurveyed`
starts `false`.

While `waterSurveyed === false` the UI renders water as `?` and no selector may leak the
value. Commissioning `study:bulkServices` sets it true and reveals the number.

If the player reaches act 4 with `water < balance.waterWallThreshold` (default 60) and no
remaining means to raise it, the run enters `lost` with `lossReason: 'dry'`. This is a
soft loss: the end card should explicitly name the survey they skipped and offer a rerun
on the same seed.

---

## 10. Loss and score

- **blockade** — `trust <= 0`. Immediate.
- **sunk** — `cash < 0` while `act <= 1`. Immediate.
- **dry** — as section 9.
- **extraction** — evaluated only at handover: run completes with `cash` above the
  `extractionCashThreshold` and `trust` below `extractionTrustFloor`. Scores, but the end
  card treats it as a hollow ending.

Score, computed only at handover:

```
total = householdsWithTitle * 3 + jobsInCatchment * 1 + trustAtHandover * 2
```

Cash contributes nothing to the score. This is deliberate and must not be softened.

---

## 11. Supabase

Anonymous sign-in on first launch. Never block gameplay on auth succeeding — if it fails,
play locally and retry sync later.

```sql
create table runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seed bigint not null,
  turn int not null default 0,
  state jsonb not null,
  action_log jsonb not null default '[]'::jsonb,
  score int,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index runs_user_idx on runs(user_id, updated_at desc);
create index runs_score_idx on runs(score desc) where finished_at is not null;

alter table runs enable row level security;

create policy "own runs read"   on runs for select using (auth.uid() = user_id);
create policy "own runs write"  on runs for insert with check (auth.uid() = user_id);
create policy "own runs update" on runs for update using (auth.uid() = user_id);
```

Leaderboard is a security-definer view exposing only `score`, `finished_at` and a
display handle — never `user_id` or `state`.

Sync policy: push on `END_TURN`, debounced to at most one write per 10 seconds and one on
page hide. Conflict resolution is highest `turn` wins. Never block the UI on a write.

Write the migration as a file under `supabase/migrations/`, do not apply schema changes
by hand.

---

## 12. Packaging

**PWA**: manifest with maskable icons, service worker precaching the full app shell and
all content JSON and images. The game must launch and play with the network disabled.

**Capacitor**: wraps `dist/`. Required handling:
- Android hardware back button — intercept and map to in-game back / confirm-exit. Without
  this the app closes mid-run.
- Safe area insets — the meter bar must not sit under the notch.
- Audio requires a user gesture; the title screen provides it.
- Lock to portrait.

---

## 13. Build phases

Do not proceed to the next phase until the definition of done is met.

**Phase 1 — engine.** Types, RNG, reducer, gates, content JSON with placeholder numbers,
full test suite. No UI at all. *Done when:* a test replays a 60-action log twice from the
same seed and asserts deep-equal final states, and every loss reason has a test that
triggers it.

**Phase 2 — ugly playable.** Buttons and numbers. No art, no styling beyond legibility,
no map — a list of parcels is fine. *Done when:* a full run from act 0 to handover is
completable in one sitting.

**Phase 3 — balance.** Hand back to the human. Expect the content JSON to be rewritten.
Build a dev-only panel exposing all meters, forced act advance, and seed entry.

**Phase 4 — UI.** SVG map, meter animations, card presentation, end card. Follow
`DESIGN.md` (to be written after phase 3).

**Phase 5 — backend.** Anon auth, save, resume, leaderboard.

**Phase 6 — packaging.** PWA, then Capacitor, then store assets.

---

## 14. Explicit non-goals

Do not build: multiplayer, real-time anything, procedural map generation, a tutorial
system, monetisation, ads, analytics beyond anonymous run outcomes, accounts with
passwords, an in-game economy simulation deeper than the reducer above, or a 3D view.

Do not generate art at runtime. Illustrations are static assets produced separately and
committed to the repo.

---

## 15. Open decisions for the human

Flag these rather than guessing:

1. Action point budget per turn — 3 is a placeholder and materially changes pacing.
2. Whether act 6 handover is a fixed number of turns or player-triggered.
3. Whether the three engines in act 3 are all required or any two.
4. Real place names versus fictionalised ones in shipped content.
5. Whether the leaderboard needs replay validation at launch or can trust the client
   initially. The reducer being pure makes adding validation later cheap.
