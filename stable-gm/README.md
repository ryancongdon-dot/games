# 🥊 Stable GM

**Spin a division and an era. Sign eight real fighters. Simulate a year of title fights.**

A boxing draft simulator, in the spirit of [Stat GM](https://statgm.com)'s baseball
*spin → pick → sim → compare* loop — translated to a sport with no teams and no rosters.

| Stat GM | Stable GM |
| --- | --- |
| Spin a real MLB team-season | Spin a **division + era window** — "Welterweight · 1946–1955" |
| Draft from that roster | Sign from every fighter who **campaigned there** |
| 10 position slots | The **8 classic weight classes**, flyweight → heavyweight |
| Position eligibility (5+ games) | A fighter fills only a weight they **actually fought at** |
| 162-game projected record | A **stable record + belts** — "24-8, 9 KO · 2 🏆" |

## How to play

1. **SPIN** a board. A random weight class and era appears; every fighter in the pool who campaigned
   at that weight during those years is on it.
2. **SIGN** one of them into an open weight class. Multi-division fighters (Robinson at welter *or*
   middle, Durán at light, welter *or* middle) let you choose the slot — but signing someone outside
   their primary division costs them a few rating points, shown on the button.
3. **12 spins, 8 weights.** You may pass on a board you don't like, but only while you have spins to
   spare. The moment `spins left == weights open`, SPIN locks and reads **MUST SIGN**. That is the
   whole game: four discretionary passes, spent well or wasted.
4. **SIMULATE.** Each fighter takes four bouts up a difficulty ladder against era-appropriate
   opposition. Win the last one having earned the shot undefeated and you take a belt. You get a
   combined record, a belt count, a score and a grade.

## Run it

```bash
npm install
npm run dev        # dev server
npm test           # 66 tests
npm run build      # typecheck + production build
```

Deployed to GitHub Pages from `main` by `.github/workflows/deploy.yml`. Pages must be set to
**Settings → Pages → Source: GitHub Actions** for the deploy step to publish.

## Layout

```
src/
  data/divisions.ts   # 8 weight classes, decade anchors, era names
  data/fighters.ts    # the curated fighter pool
  data/SOURCES.md     # provenance, counting conventions, editing rules
  engine/rating.ts    # curated stats -> OVR + combat attributes
  engine/sim.ts       # seeded RNG, bout resolution, season, belts
  engine/draft.ts     # spin table, boards, eligibility, spin budget
  engine/*.test.ts    # the test suite
  ui/                 # Board, FighterSheet, Results
```

`data → rating → sim` never references a roster *slot*, a spin, or the DOM. That separation is
deliberate: a future **Card Promoter** mode (book a five-bout card, scored on gate and drama instead
of W-L) drops in its own rules and screens and reuses the data and bout maths untouched.

## Tuning

Gameplay constants live in a banner-commented block at the top of each engine file.

**`engine/draft.ts`** — `SPIN_BUDGET` (12) against 8 slots is the slack that makes passing a real
decision. `ERA_SPAN`/`ERA_WIDEN_STEP`/`ERA_MAX_SPAN` control how far a thin decade's window stretches
before it gives up; `BOARD_MIN`/`BOARD_MIN_HARD`/`SLICE_MIN_NATIVE` decide which slices are playable
at all; `OPEN_DIVISION_BIAS` (0.8) steers spins toward weights you still need, and the remaining 20%
is what keeps "a welterweight board hands you a middleweight" alive.

**`engine/rating.ts`** — `W_TIER` (0.55) dominates on purpose. A raw W-L-D carries no opponent-quality
signal at all: 50-0 against nobody and 50-0 against champions are arithmetically identical, so the
curated `tier` is what separates them. `ERA_STRENGTH` adjusts for depth of competition, not talent.
`OFF_DIVISION_PENALTY` prices the slot choice.

**`engine/sim.ts`** — `BOUT_SCALE` (22) sets how deterministic a rating edge is; `UPSET_FLOOR` (0.05)
guarantees nothing is ever a lock. `OPP_TARGET_BASE` (78) is a *global* difficulty anchor rather than
the fighter's own era median — anchoring locally would let a weak stable from a thin era farm wins
and would destroy the one thing the score has to do, stay comparable between drafts. `GRADE_CUTS` is
calibrated against the measured distribution below.

### Measured balance

Over 3000 seeded seasons, best- and worst-possible stables from the shipped pool:

| Stable | Avg OVR | Record | KO | Belts | Score | Grades |
| --- | --- | --- | --- | --- | --- | --- |
| Best possible | 94.3 | 24.3–6.9–0.8 | 8.4 | 2.9 | 111 | S 15% · A 33% · B 34% · C 16% |
| Worst legal | 77.1 | 11.3–18.7–2.0 | 2.8 | 0.3 | 41 | D 24% · F 74% |

Stoppages land at ~32% of bouts, higher at heavyweight than flyweight; ~78% of opponents are real
named fighters rather than generic contenders. A perfect 32-0 season has never occurred in testing.

If you change the tunables, `npm test` will tell you if you've broken the separation: the suite
asserts a better draft wins, that it isn't a foregone conclusion, and that real variance survives.

## About the data

The fighter records are **real and cited**. Every entry carries its source, the month it was
verified, and a confidence level. Boxing ledgers from before roughly 1925 are genuinely disputed —
the no-decision era means different sources count the same careers differently — and those records
are marked `confidence: 'low'`, rendered with an asterisk, and carry a footnote explaining why.

**Ratings are editorial judgement, not history.** The `tier` field and the bout simulation are an
opinion about how good fighters were, presented as a game, not as a claim of fact.

Read [`src/data/SOURCES.md`](src/data/SOURCES.md) before adding or editing a fighter. The short
version: never invent a record to fill a gap — omit the fighter and let the board generator handle
the thin decade.

The pool currently holds 80 fighters, 10 per weight class, spread across every era. It's sized to
prove the mechanics; growing it to ~300 mostly means more entries in the same shape, and
`fighters.test.ts` will reject a malformed one before it reaches a board.
