# NODE

A turn-based rural development strategy game. You develop a node in KwaZulu-Natal from
bare land into a functioning neighbourhood over roughly eighteen in-game years — starting
without owning the land or holding the right to build on it.

Four resources trade against each other, and the scarcest is not money. Trust buys rights,
rights take years to become buildings, and trust decays across the years when nothing
visible is being built. A run that optimises purely for cash ends with a profitable asset
and a failed town, and scores badly for it.

Full specification: [SPEC.md](SPEC.md). Deviations from it, with reasons:
[DECISIONS.md](DECISIONS.md).

## Status — phase 1 (engine) complete

Per SPEC §13 the phases are strictly ordered, and phase 1 is done when the reducer
replays deterministically and every ending has a test that fires it. Both hold. There is
deliberately **no UI yet**.

| Phase | | |
|---|---|---|
| 1 | Engine — types, RNG, reducer, gates, missions, content, tests | **done** |
| 2 | Ugly playable — buttons and numbers, no art, no map | next |
| 3 | Balance — hand back to a human; expect `content/` to be rewritten | |
| 4 | UI — SVG map, card presentation, end card | |
| 5 | Backend — sync and resume | |
| 6 | Packaging — PWA, then Capacitor | |

## Stack

Vanilla JavaScript ES modules, **no build step**, served straight out of `www/` — the same
architecture as the [Trainer App](https://github.com/aphile-m/Lifestyle-App). SPEC §3 asks
for TypeScript, Vite, React and Tailwind; [DECISIONS.md D1](DECISIONS.md) records why this
repo does not, and how the type discipline is kept anyway.

Types are JSDoc with `// @ts-check`, verified by `tsc --noEmit` under `strict` and
`noUncheckedIndexedAccess`. TypeScript is a devDependency and never touches shipped code.

## Layout

```
www/
  js/engine/      the game. Pure, imports nothing but types and content
    types.js      JSDoc typedefs; emits no runtime code
    rng.js        mulberry32, cursored — every draw is a function of (seed, cursor)
    reduce.js     the reducer: the only place state changes
    gates.js      recursive act-gate predicate evaluator
    selectors.js  pure derived reads, incl. the one sanctioned read of hidden water
    events.js     deck shuffle, draw, resolution
    missions.js   jobs the five characters give Sakhile
  js/ui/          phase 2
  js/sync/        phase 5
  content/        balance data as versioned JSON (SPEC §2.4)
scripts/
  test-engine.js  the mandatory reducer suite
```

`www/js/engine/` must not import from `ui/` or `sync/`. SPEC §4 asks for an ESLint rule;
`test-engine.js` asserts it directly instead ([D10](DECISIONS.md)).

## Run it

```bash
npm install
npm run check     # tsc --noEmit, then the reducer suite
npm test          # the reducer suite alone — no browser, no server needed
npm run serve     # http://localhost:8124 (nothing to see until phase 2)
```

The engine is pure and has no dependencies, so the test suite needs neither a browser nor
a running server — unlike the Trainer App's Playwright scripts.

## Who you are

**Sakhile.** Local, young, in a hurry. He ran a spaza, then bakkie hire, then a small
logistics outfit that does well enough that people have started asking him for things.

Being local is mechanical, not decorative — it sets his opening relationships (high with
the people who knew his grandfather, low with the institutions that lend money), it sets
his low opening cash, and it is why both the sports field and the extraction ending cut
deeper for him than they would for an outside developer. He is the only person in this
story who will still be living here in eighteen years.

## Who you are dealing with

| | |
|---|---|
| **Inkosi Mthiyane** | Traditional council, holds the trust land. Knew Sakhile's grandfather, which opens the door and raises the standard. |
| **Thandeka Nxumalo** | Acting municipal manager — four years acting. The only reason anything gets signed. |
| **Bra Sipho Zulu** | Chairs the community forum. Former shop steward. Speaks for people who disagree with each other, and says so. |
| **Renier van Zyl** | Fuel wholesaler. The easiest money in the game, and the most expensive. |
| **Dr Amara Okonkwo** | DFI investment officer. Cheapest capital available, and the slowest. |

Each of them gives Sakhile work. A mission is a predicate that offers it, a predicate that
completes it, a deadline and a payout — so the act-gate evaluator does the evaluating.
Accepting and declining are free; the work is what costs.

## The two mechanics worth knowing about

**The sports field.** Building on `site2` before replacing the field it sits on costs the
full displacement in trust and raises a lasting grievance. Building after the replacement
costs nothing. Same action, opposite outcome, purely ordering — and the game does not warn
you the first time (SPEC §8).

**Hidden water.** Bulk water capacity is seeded per run and rendered as `?` until you
commission the survey. Reach act 4 below the threshold with no way left to raise it and
the run ends dry. Water can be raised — see [D7](DECISIONS.md) — so a dry ending is a
choice you walked into, not a seed you were dealt.
