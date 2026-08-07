# Fighter data — provenance and editing rules

The records in `fighters.ts` are factual claims about real people. Treat them as data with a
citation, not as game balance knobs.

## ⚠️ Most of this data is unverified

**77 of the 80 records carry `src: 'model-recall'`.** That means the numbers were written from an
AI model's training knowledge and have never been checked against a source. They are plausible and
mostly correct, but they are not citations.

This file originally labelled every record `src: 'BoxRec', verified: '2026-08'`, which was false —
BoxRec was never consulted. That has been corrected. A spot check of three fighters found:

| Fighter | Model recall | Actual | |
| --- | --- | --- | --- |
| Éder Jofre | 72-2-4 (50 KO) | 72-2-4 (50 KO) | ✅ |
| Carlos Zárate | 66-4 (63 KO) | 66-4 (63 KO) | ✅ |
| Jimmy Wilde | 132-3-2 (99 KO) | 132-4-1 (98 KO) per BoxRec | ❌ corrected |

So: roughly right, individually unreliable. **Verifying records one at a time — replacing
`'model-recall'` with a real source and a `verified` date — is the highest-value work on this file.**
`fighters.test.ts` enforces that a record naming a source must also carry a verification date, so
the label can't drift back into fiction.

Note that `confidence` is a *different* axis. It describes whether sources agree with each other,
not whether we checked one. A record can be verified and still `confidence: 'low'` (Jimmy Wilde), or
unverified and `confidence: 'high'`.

## Counting conventions

Boxing ledgers differ between sources mainly because of how they count edge cases. This dataset
picks one convention and applies it everywhere:

- **No-contests are excluded** from W-L-D. A fighter with two NCs shows only their W-L-D, with the
  NCs mentioned in `note` if they are historically significant.
- **Newspaper decisions are not counted as wins.** In the no-decision era (roughly 1900–1925) bouts
  that went the distance were officially "no decision" and the result was reported by ringside
  press. Sources that fold those into the win column produce much larger totals. Where a fighter's
  commonly cited record clearly includes them, the record is marked `confidence: 'low'`.
- **`record` is the full career ledger**, not a peak-window split.
- **`ko` counts wins by knockout and technical knockout together**, and must never exceed `w`.

## `peakRecord` is deliberately absent

The schema supports a `peakRecord` (the ledger through the `peak` window), and the UI will show it
and label the column "Peak" when present. **No fighter in v1 has one**, because reliable peak-window
splits are not published for most of this pool and inventing them would be fabrication. The board
therefore shows career records labelled "Career".

Add a `peakRecord` only when you can cite the split for that specific fighter.

## Confidence levels

| Level | Meaning |
| --- | --- |
| `high` | Modern, well-documented ledger. Sources agree. |
| `medium` | Broadly agreed but with minor discrepancies between sources, or an active fighter whose totals move. |
| `low` | Genuinely disputed. Pre-~1925 no-decision era, or a ledger that varies materially between sources. |

`low` records render with a trailing asterisk on the board and a footnote in the tale-of-the-tape
sheet. This is not decoration — it is the honest presentation of contested history, and it should
stay attached to the number wherever the number is shown.

## Fields that are estimates, not records

- **`ht` / `reach`** are published tale-of-the-tape figures. For pre-1930 fighters these were
  measured inconsistently and should be read as approximate.
- **`tier` (40–99)** is *editorial judgement*, not a source claim. It is where an assessment of
  level of opposition lives, since a raw W-L-D carries no opponent-quality signal at all — a 50-0
  record against nobody and a 50-0 record against champions look identical to the arithmetic. It is
  the dominant term in the rating, so it is also the main balance lever.
- **`style`** is a categorisation for the sim's style-matchup triangle, not a formal designation.
- **`attrs`** are optional 0–100 overrides used only where the derived defaults misrepresent a
  fighter (Miguel Canto's power, Willie Pep's speed, Kid Gavilán's chin).

## Adding a fighter

1. Fill every required field: `id, name, active, divisions, record, ht, reach, stance, style,
   titleReigns, titleDefenses, tier, src, verified, confidence`.
2. `divisions[]` is the eligibility spine. `divisions[0]` is the primary division; slotting a
   fighter anywhere else costs `OFF_DIVISION_PENALTY` in `rating.ts`. Each stint's `years` must sit
   inside `active`, and describe the campaign **at that weight** — the board tests against this, not
   against `active`.
3. Put the record under the right `// ==== DIVISION ====` banner (primary division), sorted by
   career start.
4. Run `npm test`. `fighters.test.ts` will reject duplicate ids, unknown weight classes, `ko > w`,
   stints outside `active`, implausible height/reach, and out-of-range tiers.

**Never invent a record to fill a gap.** If you cannot verify a fighter, leave them out — a thin
decade is handled by the board generator's era-widening and cross-division backfill, not by
guesswork.

## Known limitations of this pool

- **Eight weight classes.** Modern boxing has seventeen. Fighters whose real division has no slot
  here (strawweight, junior flyweight, junior featherweight, cruiserweight) are grouped into the
  nearest of the eight, with a `note` saying so.
- **Multi-division careers are simplified.** Manny Pacquiao won titles across a far wider span than
  the three stints modelled here; the entries capture the divisions that matter for the draft.
- **Coverage is uneven by era.** The 1900s–1910s are thin at the lighter weights, which is a
  documentation problem, not an oversight. `draft.test.ts` asserts the board generator still
  produces playable boards everywhere.
