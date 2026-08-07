import { describe, it, expect } from 'vitest';
import { FIGHTERS } from '../data/fighters';
import { WEIGHT_CLASS_IDS, isWeightClassId, ERA_ANCHORS } from '../data/divisions';

/**
 * Data integrity. A typo'd record should fail CI, not silently empty a board.
 * These assertions encode the rules stated in data/SOURCES.md.
 */
describe('fighter data integrity', () => {
  it('has unique ids', () => {
    const ids = FIGHTERS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('references only real weight classes', () => {
    for (const f of FIGHTERS) {
      expect(f.divisions.length, `${f.id} has no divisions`).toBeGreaterThan(0);
      for (const d of f.divisions) {
        expect(isWeightClassId(d.wc), `${f.id}: unknown weight class ${d.wc}`).toBe(true);
      }
    }
  });

  it('never claims more KOs than wins', () => {
    for (const f of FIGHTERS) {
      expect(f.record.ko, `${f.id}: ko > w`).toBeLessThanOrEqual(f.record.w);
      if (f.peakRecord) {
        expect(f.peakRecord.ko).toBeLessThanOrEqual(f.peakRecord.w);
      }
    }
  });

  it('keeps any peak record within the career record', () => {
    for (const f of FIGHTERS) {
      if (!f.peakRecord) continue;
      expect(f.peakRecord.w, `${f.id}`).toBeLessThanOrEqual(f.record.w);
      expect(f.peakRecord.l, `${f.id}`).toBeLessThanOrEqual(f.record.l);
      expect(f.peakRecord.d, `${f.id}`).toBeLessThanOrEqual(f.record.d);
      expect(f.peakRecord.ko, `${f.id}`).toBeLessThanOrEqual(f.record.ko);
    }
  });

  it('keeps division stints inside the career span', () => {
    for (const f of FIGHTERS) {
      const [a0, a1] = f.active;
      expect(a0, `${f.id}: active range inverted`).toBeLessThanOrEqual(a1);
      for (const d of f.divisions) {
        expect(d.years[0], `${f.id}/${d.wc}: stint starts before career`).toBeGreaterThanOrEqual(a0);
        expect(d.years[1], `${f.id}/${d.wc}: stint ends after career`).toBeLessThanOrEqual(a1);
        expect(d.years[0], `${f.id}/${d.wc}: stint inverted`).toBeLessThanOrEqual(d.years[1]);
      }
      if (f.peak) {
        expect(f.peak[0]).toBeGreaterThanOrEqual(a0);
        expect(f.peak[1]).toBeLessThanOrEqual(a1);
      }
    }
  });

  it('has one stint per weight class per fighter', () => {
    for (const f of FIGHTERS) {
      const wcs = f.divisions.map((d) => d.wc);
      expect(new Set(wcs).size, `${f.id} lists a weight class twice`).toBe(wcs.length);
    }
  });

  it('has plausible physicals and tiers', () => {
    for (const f of FIGHTERS) {
      expect(f.ht, `${f.id}: height`).toBeGreaterThanOrEqual(58);
      expect(f.ht, `${f.id}: height`).toBeLessThanOrEqual(84);
      expect(f.reach, `${f.id}: reach`).toBeGreaterThanOrEqual(58);
      expect(f.reach, `${f.id}: reach`).toBeLessThanOrEqual(90);
      expect(f.tier, `${f.id}: tier`).toBeGreaterThanOrEqual(40);
      expect(f.tier, `${f.id}: tier`).toBeLessThanOrEqual(99);
      expect(f.titleReigns, `${f.id}: reigns`).toBeGreaterThanOrEqual(0);
      expect(f.titleDefenses, `${f.id}: defenses`).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps any attribute overrides in range', () => {
    for (const f of FIGHTERS) {
      for (const [k, v] of Object.entries(f.attrs ?? {})) {
        expect(v, `${f.id}.attrs.${k}`).toBeGreaterThanOrEqual(0);
        expect(v, `${f.id}.attrs.${k}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it('carries provenance on every record', () => {
    for (const f of FIGHTERS) {
      expect(f.src, `${f.id}: missing src`).toBeTruthy();
      expect(['high', 'medium', 'low']).toContain(f.confidence);
    }
  });

  it('says where every tier came from', () => {
    // tier is 55% of OVR. It must never be an anonymous number.
    for (const f of FIGHTERS) {
      expect(f.tierSrc, `${f.id}: missing tierSrc`).toBeTruthy();
      if (f.tierSrc === 'editorial') {
        expect(f.tierRank, `${f.id}: editorial tier cannot claim a rank`).toBeUndefined();
      } else {
        expect(f.tierRank, `${f.id}: cites ${f.tierSrc} but no rank`).toBeGreaterThan(0);
      }
    }
  });

  it('derives tier consistently from the Ring ranking', () => {
    // rank 1 -> 99, rank 80 -> 78, linear. Guards against hand-edits drifting.
    for (const f of FIGHTERS) {
      if (f.tierRank === undefined) continue;
      expect(f.tier, `${f.id} rank ${f.tierRank}`).toBe(
        Math.round(99 - (f.tierRank - 1) * (21 / 79)),
      );
    }
  });

  it('grounds most of the pool in a published ranking', () => {
    const ranked = FIGHTERS.filter((f) => f.tierSrc !== 'editorial').length;
    expect(ranked / FIGHTERS.length).toBeGreaterThan(0.6);
  });

  it('never claims a source without an actual verification date', () => {
    // The failure this guards against: labelling a record 'BoxRec' when nobody
    // ever opened BoxRec. Either say where it came from and when it was
    // checked, or admit it is unverified model recall.
    for (const f of FIGHTERS) {
      if (f.src === 'model-recall') {
        expect(f.verified, `${f.id}: model-recall must not claim a check`).toBeUndefined();
      } else {
        expect(f.verified, `${f.id}: cites ${f.src} but no verified date`).toMatch(
          /^\d{4}-\d{2}$/,
        );
      }
    }
  });

  it('explains every low-confidence record', () => {
    // A disputed ledger without a note gives the UI nothing honest to show.
    for (const f of FIGHTERS) {
      if (f.confidence === 'low') {
        expect(f.note, `${f.id}: low confidence needs a note`).toBeTruthy();
      }
    }
  });

  it('covers every weight class', () => {
    for (const wc of WEIGHT_CLASS_IDS) {
      const n = FIGHTERS.filter((f) => f.divisions[0]?.wc === wc).length;
      expect(n, `${wc} has only ${n} primary fighters`).toBeGreaterThanOrEqual(8);
    }
  });

  it('spans the era anchors', () => {
    // Not every decade needs fighters, but a majority should have someone
    // active or the spin table collapses onto a handful of windows.
    const covered = ERA_ANCHORS.filter((a) =>
      FIGHTERS.some((f) => f.active[0] <= a + 9 && f.active[1] >= a),
    );
    expect(covered.length).toBeGreaterThanOrEqual(ERA_ANCHORS.length - 2);
  });
});
