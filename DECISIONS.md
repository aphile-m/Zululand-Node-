# DECISIONS

`SPEC.md` §1 requires that every choice it does not make explicitly is recorded here.
This file is that record. It is also where deliberate *deviations* from the spec live,
with the reasoning that justified them.

Entries are append-only. If a decision is reversed, add a new entry saying so rather
than editing the old one.

---

## D1 — Stack: vanilla JS ES modules, no build step

**SPEC.md §3 says:** TypeScript (strict), Vite, React 18, Tailwind, Vitest,
Cloudflare Pages.

**We do:** vanilla JavaScript ES modules with JSDoc types, no bundler, no framework,
no CSS kit, plain-node test scripts, GitHub Pages.

**Why.** This project shares a toolchain and a maintainer with the Trainer App
(`aphile-m/Lifestyle-App`), which is built as vanilla ES modules served directly from
`www/` with no build step. That is not incidental — it is the reason that app can
hand-roll OAuth against Entra and Strava, ship a service worker that is genuinely the
file on disk, and deploy by copying a directory. Adopting Vite + React + Tailwind here
would mean maintaining two unrelated toolchains for two apps by one person.

Nothing in SPEC.md §2 — the section that says it is non-negotiable — depends on the §3
choices. All six constraints (pure reducer, seeded RNG, JSON-serializable state,
content JSON in the repo, fully client-side, no signup) are architectural and hold
identically in plain JavaScript. §3 carries no such language, and §1 explicitly
provides this file as the mechanism for choosing otherwise.

**What we keep from §3:** the type discipline. Every engine module is `// @ts-check`
with JSDoc annotations, and `tsconfig.json` sets `strict`, `checkJs`, `noEmit` and
`noUncheckedIndexedAccess` exactly as §3 asks. `npx tsc --noEmit` is a required check.
TypeScript is a devDependency; it never touches the shipped code.

**Cost accepted:** no compile-time exhaustiveness on the `Action` union at build time
for consumers who skip the typecheck. Mitigated by the reducer's `default:` branch,
which throws on an unknown action type, and by the test suite covering every variant.

---

## D2 — Backend: Microsoft 365 / OneDrive app folder, not Supabase

**SPEC.md §3 and §11 say:** Supabase, anonymous auth, a `runs` table with RLS, and a
security-definer leaderboard view.

**We do:** the Trainer App's sync architecture — Entra ID (auth-code + PKCE, hand-rolled)
writing one JSON file per collection into a OneDrive **app folder**.

**Why.** Consistency with the Trainer App, which migrated off Supabase to exactly this
in August 2026, and which already contains a working, tested `msgraph.js` that this
project can adopt rather than reimplement.

**How §2.6 is still satisfied.** §2.6 requires that no signup is needed to play, with
"anonymous auth only, with optional later linking". Microsoft has no anonymous identity,
so the game does not ask for one: **a run is played entirely locally with no auth at
all.** Signing in to Microsoft is an optional action that exists only to sync runs
across devices, and is the "optional later linking" §2.6 describes. §11's "never block
gameplay on auth" is honoured by construction — the engine cannot reach the network,
per §2.1.

**Cost accepted: no leaderboard.** A OneDrive app folder is per-user by construction and
cannot expose one player's score to another. SPEC.md §11's leaderboard view is therefore
**out of scope**, and §15.5 (whether the leaderboard needs replay validation) is moot
for now. This is a real capability loss, taken knowingly.

The door stays open at near-zero cost: the reducer is pure and the action log is
serialized with every run, so a leaderboard can later be added on any backend — Supabase
included — without touching a line of engine code. Revisit once there is a second player.

---

## D3 — Android shell ships `www/` inside the APK

The Trainer App's `capacitor.config.json` sets `server.url` to the live GitHub Pages
site, so its APK is a thin shell around a hosted app and never needs rebuilding.

NODE does **not** do this. SPEC.md §2.5 and §12 require the game to launch and play with
the network disabled, which a remote `server.url` cannot do on a cold start. The Android
build therefore bundles `www/` as `webDir` with no `server.url`, and the web build relies
on the service worker precaching the shell *and* all of `www/content/*.json`.

---

## D4 — Gate predicate language: three additions

SPEC.md §7 lists the supported predicates as `all`, `any`, `not`, `flag`, `meterAtLeast`,
`parcelStatusAtLeast`, `buildingOperational` and `relationshipAtLeast`. Three of the seven
act gates in the §7 table cannot be expressed in that set:

| Act | Gate | Why it does not fit |
|---|---|---|
| 2 | "cash-positive for **4 consecutive turns**" | No predicate expresses duration, and `flags` is `Record<string, boolean>` so it cannot hold a count. |
| 3 | "**Two of** {agri, energy, waste}" | `any` means *at least one*. There is no "at least N of". |
| 5 | "≥ **200 households with title**" | Households are derived from buildings; no predicate reads a derived value. |

Added, all pure and recursive, still no `eval` and no string expressions:

- `counterAtLeast: { counter, value }` — reads `state.counters`.
- `atLeastN: { n, of: [...predicates] }` — generalises `any` (which is `atLeastN` with
  `n: 1`) and `all`.
- `derivedAtLeast: { metric, value }` — reads a whitelisted derived value
  (`householdsWithTitle`, `jobsInCatchment`) from `selectors.js`.

---

## D5 — State fields the turn loop needs that §5 omits

SPEC.md §6 describes a turn loop that reads and writes four pieces of state which the
§5 `GameState` type does not declare. Without them the reducer cannot implement §6, and
— more seriously — they would fall outside the replayed state, breaking the byte-identical
replay guarantee in §2.2. Added to `GameState`:

| Field | Required by | Note |
|---|---|---|
| `apRemaining: number` | §6, "action-point budget" | Reset to `balance.actionPointsPerTurn` at step 9. Without it the reducer cannot reject a 4th action. |
| `counters: Record<string, number>` | §7 act 2 gate (see D4) | Also holds `cashPositiveStreak`. |
| `engagedThisTurn: string[]` | §6.5, "unless engaged this turn" | Cleared at step 9. |
| `lastProgressTurn: number` | §6.4, "in the last `trustDecayGraceTurns`" | Set when a building becomes operational or a mitigation completes. |

---

## D6 — `lossReason` becomes `endingKind`, and extraction is a win

SPEC.md §10 lists `extraction` among the `LossReason` values, but also says an extraction
run "**Scores**, but the end card treats it as a hollow ending" — while §10's `Score` is
computed only at handover, i.e. on a run that reached the end. A run cannot be both
`status: 'lost'` and scored at handover.

Resolved: extraction is `status: 'won'` with `endingKind: 'extraction'`. The field is
renamed from `lossReason` to `endingKind` because it now describes how any run ended, not
only a failure. `blockade`, `sunk` and `dry` remain `status: 'lost'`. The end card branches
on `endingKind`, and treats `extraction` as hollow exactly as §10 asks.

---

## D7 — Water can be raised; `dry` is a choice, not a seed

SPEC.md §9 makes act 4 a hard wall at `water >= 60`, initialises water from the seed in
`[20, 90]`, and loses the run when there is "no remaining means to raise it". But no
action, building, study or card anywhere in the spec ever raises `meters.water` —
`study:bulkServices` only *reveals* it.

As literally written, roughly 45% of seeds are an unavoidable loss no matter how well the
player plays, which turns the intended lesson ("you skipped the survey") into "the seed
killed you" — precisely the arbitrary failure §1 warns against.

Resolved without widening the `Action` union: studies may carry a `waterDelta`, and
`studies.json` gains two that raise supply — `bulkWaterContract` (+25, 6 turns, expensive)
and `boreholeField` (+15, 4 turns, cheaper and weaker). Both are commissioned through the
existing `COMMISSION_STUDY` action and resolve through the existing timer machinery.

`dry` now fires only when act ≥ 4, water is below threshold, no water-raising timer is
pending, and every remaining option is either already complete or unaffordable. That is a
loss the player walked into — which is what §9 wanted.

---

## D8 — `meters.paper` is spent on rights, earned by studies

§5 declares `paper` as "progress toward current act's rights package" and §7 never
references it. Left undefined it is a meter the UI shows and nothing moves.

Resolved: completing a study adds its `paperGain`; `ACQUIRE_RIGHTS` requires and consumes
`paperCost` for the chosen mode. Gates may require it via the existing `meterAtLeast`.
This makes the §1 tension concrete — rights cost paperwork, paperwork costs years, and
trust decays across those years.

---

## D9 — `hand` is retained but unused in v1

§5 declares both `hand: string[]` and `pendingEvent: string | null`, but the `Action`
union has no action that plays a card from hand, and §6.6 draws exactly one card per turn
into a slot the player must resolve. `hand` therefore has no reachable use in v1.

It is kept in `GameState` (always `[]`) so the schema does not need a version bump when
player-held cards arrive. §6.6 draws into `pendingEvent`.

---

## D10 — The §4 engine/UI boundary is a test, not ESLint

SPEC.md §4 asks for an ESLint boundary rule preventing `engine/` importing from `ui/` or
`sync/`. Adding ESLint for a single rule to a repo with no build step is disproportionate.

`scripts/test-engine.js` asserts it directly by reading every file under `www/js/engine/`
and failing on any import outside `engine/` or `../../content/`. Same guarantee, same CI
failure, no toolchain.

---

## D12 — The player is Sakhile, and he is local

SPEC.md never says who the player is. It describes "the player" moving meters, which is
enough to build a reducer and not enough to write a line of dialogue.

**Sakhile.** A young local businessman — spaza, then bakkie hire, then a small logistics
outfit that does well enough that people have started asking him for things. Resourceful,
impatient, and genuinely convinced this place works if enough people pull the same way.

The load-bearing detail is that **he is from here**, and it is mechanical in four places:

1. **Opening relationships** (D14). High with the people who knew his grandfather,
   low with the institutions that lend money. An outside developer would have exactly
   the inverse problem and a much larger cheque.
2. **Opening cash.** He is not a fund. The first act is about getting funded, and the two
   routes — Renier fast and expensive, Amara slow and cheap — are the first real choice
   in the game.
3. **The sports field (SPEC §8) cuts deeper.** Sakhile played on that field. Taking it is
   not an outsider's oversight, it is a local man's decision about people he knows. The
   mechanic is unchanged; what it *means* is not.
4. **The extraction ending (SPEC §10) cuts deeper.** Ending rich with a failed town is
   hollow for anyone. For the man who still lives there, it is a betrayal — and he is
   the only developer in the story who will still be there in eighteen years.

The five stakeholders stop being institutions and become the people who run them:
Inkosi Mthiyane, Thandeka Nxumalo, Bra Sipho Zulu, Renier van Zyl, Dr Amara Okonkwo.
`stakeholders.json` gains `role` (the institution) and `portrait` (sprite key) alongside
the person's name.

---

## D13 — Missions

SPEC.md has no mission system. Added, because `ENGAGE` on its own is a slider you drag to
make a number go up, and the game is supposed to be about people.

A mission is **a predicate that offers it, a predicate that completes it, a deadline and a
payout** — so `gates.js`, written for act gates, does all the evaluation and `missions.js`
only moves ids between four buckets. Content lives in `missions.json`.

What it costs against the spec:

- **`GameState.missions`** — `{ offered, accepted: [{id, acceptedOnTurn}], completed, failed }`.
  A mission id is in exactly one bucket, asserted by test.
- **Two new actions** — `ACCEPT_MISSION`, `DECLINE_MISSION`. The only widening of §5's
  `Action` union in this repo. Both cost **zero action points**: taking a job is not the
  work, and charging to hear the ask would tax the player for talking to people.
- **One new step in §6's turn loop**, as **5b**, between relationship drift and the event
  draw. Steps 1-9 keep their order and meaning — nothing is reordered. It sits there
  rather than at the end so that a mission payout lands *before* step 7's gate check (a
  flag a mission sets can open a gate the same turn) and *before* step 8's loss check (a
  reward can pull Sakhile back from a blockade, and a mission he blew can be what pushes
  him into one).
- **No RNG.** Missions are a pure function of state, so they cannot desynchronise a
  replay. Offer order is content order.

Inside one tick: completions settle **before** expiries, so a mission finished on its
deadline turn pays out rather than blowing up. New offers come last, so nothing can be
offered and expire in the same turn. Declining sends a mission to `failed`, not back to
the table — saying no to Bra Sipho is an answer, and he does not ask twice.

**The §8 hazard, and why it is a test.** `mission:the-field` has Bra Sipho ask whether
Sakhile will replace the sports field. That is one careless sentence away from breaking
the game's signature mechanic: SPEC §8 requires that the UI **must not warn the player the
first time**. A brief that said "build the replacement first or you'll lose trust" would
defuse the entire teaching moment. So the brief asks and never explains — no mention of
trust, cost, penalty or grievance — and a test greps the brief for exactly those words and
fails if they appear. The mission makes the choice *legible as a choice*; it never tells
you which way is which.

---

## D14 — Opening balance encodes D12

`balance.json` start values are no longer generic. Relationships open at
inkosi 58 / community 65 (he is known here) against oilCo 25 / dfi 20 (he is not known
there). Cash opens low and `quarterlyBurn` drops to 1.0 — Sakhile runs lean because he is
local: no Sandton office, no consultants on retainer.

Low capital plus low overhead makes the paper years survivable *only if he gets funded
before they end*, which is the intended shape of act 0-1.

Two tests guard it, both written against the shape rather than the numbers so they survive
phase 3's rewrite:

- Runway (`cash / quarterlyBurn`) must sit in [15, 40] turns. Shorter and act 0-1 is
  unwinnable; longer and getting funded stops being the early game.
- A scripted competent opening must survive the paper years, be squeezed below a third of
  its starting cash on the way, and be funded off the back of a mission it completed.
  The seed-4242 trace: R28m down to R4.5m by turn 9, then Dr Okonkwo's committee lands
  R28m on turn 10.

The inverse is also asserted, because SPEC §10 names it: a run that does the paperwork and
never builds anything **must** still reach `sunk`. That failure mode is the point of the
act, not a bug to balance away.

---

## D15 — Answers to SPEC.md §15 (open decisions)

1. **Action points per turn — 3.** Kept as the spec's placeholder, but read from
   `balance.json` and never hardcoded, since §13's phase 3 expects to retune it.
2. **Act 6 handover — fixed number of turns** (`balance.handoverTurns`). Player-triggered
   handover lets a player bank cash and exit before trust decays, which defeats §10's
   deliberate choice that cash scores nothing.
3. **Act 3 engines — any two of three**, as the §7 table already states. All three plus
   act 4's water wall is two hard gates back to back.
4. **Place names — fictionalised, real geography.** §1 asks for "dry, respectful,
   specific". A real named community losing a real named sports field is a claim about
   real people; the mechanic does not need it to land.
5. **Leaderboard replay validation — moot for now.** See D2: there is no leaderboard.
   When one arrives, trust the client first; the pure reducer makes validation cheap to
   add later.
