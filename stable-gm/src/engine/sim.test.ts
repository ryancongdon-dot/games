import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  simSeason,
  seasonSeed,
  rng,
  hashSeed,
  gradeFor,
  BOUTS_PER_FIGHTER,
  type RosterEntry,
} from './sim';
import { rate } from './rating';
import { FIGHTERS } from '../data/fighters';
import { WEIGHT_CLASS_IDS, overlaps } from '../data/divisions';
import type { WeightClassId } from '../data/types';

/** Best or worst legal stable: highest/lowest OVR fighter available per slot. */
function extremeRoster(pick: 'best' | 'worst'): RosterEntry[] {
  const used = new Set<string>();
  const out: RosterEntry[] = [];
  for (const wc of WEIGHT_CLASS_IDS) {
    const candidates = FIGHTERS.filter(
      (f) => !used.has(f.id) && f.divisions.some((d) => d.wc === wc),
    ).sort((a, b) => rate(a, { slotWc: wc }).ovr - rate(b, { slotWc: wc }).ovr);
    const f = pick === 'best' ? candidates[candidates.length - 1] : candidates[0];
    if (f) {
      used.add(f.id);
      out.push({ slotWc: wc, fighter: f });
    }
  }
  return out;
}

const BEST = extremeRoster('best');
const WORST = extremeRoster('worst');

/**
 * Synthetic fighters for the balance tests only — never shipped as data.
 *
 * The curated pool is 80 all-time greats, so its "worst" stable is still
 * excellent (OVR ~75+). Testing that a good draft beats a bad one needs an
 * actually bad draft, which means fabricating one. Fabricated records are fine
 * here precisely because they are not presented as history.
 */
function syntheticRoster(
  tier: number,
  titles: { reigns: number; defenses: number } = { reigns: 1, defenses: 4 },
): RosterEntry[] {
  return WEIGHT_CLASS_IDS.map((wc, i) => ({
    slotWc: wc,
    fighter: {
      id: `synthetic-${tier}-${titles.reigns}-${wc}`,
      name: `Test Fighter ${tier} ${wc}`,
      active: [1970, 1980] as [number, number],
      divisions: [{ wc, years: [1970, 1980] as [number, number] }],
      record: { w: 20, l: 10, d: 0, ko: 10 },
      ht: 64 + i * 2,
      reach: 66 + i * 2,
      stance: 'orthodox' as const,
      style: 'boxer-puncher' as const,
      titleReigns: titles.reigns,
      titleDefenses: titles.defenses,
      tier,
      tierSrc: 'editorial',
      src: 'synthetic',
      verified: '2026-08',
      confidence: 'high' as const,
    },
  }));
}

/** Far apart: an outright blowout is the correct outcome here. */
const STRONG = syntheticRoster(95, { reigns: 2, defenses: 8 });
const WEAK = syntheticRoster(48, { reigns: 0, defenses: 0 });

/**
 * Close but clearly separated, holding titles equal so the only difference is
 * tier. This is the pair that has to be dominant *without* being a lock — the
 * band where the game is actually played.
 */
const GOOD = syntheticRoster(90);
const MEDIOCRE = syntheticRoster(76);

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

describe('rng', () => {
  it('is reproducible', () => {
    const a = rng(99);
    const b = rng(99);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });

  it('stays in [0,1) and is roughly uniform', () => {
    const r = rng(7);
    const xs = Array.from({ length: 20000 }, () => r());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(mean(xs)).toBeGreaterThan(0.48);
    expect(mean(xs)).toBeLessThan(0.52);
  });

  it('hashes distinct strings distinctly', () => {
    const seen = new Set(FIGHTERS.map((f) => hashSeed(f.id)));
    expect(seen.size).toBe(FIGHTERS.length);
  });
});

describe('season shape', () => {
  const season = simSeason(BEST, FIGHTERS);

  it('runs exactly four bouts per fighter', () => {
    for (const f of season.fighters) expect(f.bouts.length).toBe(BOUTS_PER_FIGHTER);
  });

  it('totals a full slate', () => {
    const total = BEST.length * BOUTS_PER_FIGHTER;
    expect(season.w + season.l + season.d).toBe(total);
  });

  it('never records more KOs than wins', () => {
    expect(season.ko).toBeLessThanOrEqual(season.w);
    for (const f of season.fighters) expect(f.ko).toBeLessThanOrEqual(f.w);
  });

  it('keeps belts within the roster size', () => {
    expect(season.belts).toBeGreaterThanOrEqual(0);
    expect(season.belts).toBeLessThanOrEqual(BEST.length);
  });

  it('only awards a belt for winning a title fight', () => {
    for (const f of season.fighters) {
      if (!f.belt) continue;
      const last = f.bouts[f.bouts.length - 1]!;
      expect(last.isTitleFight).toBe(true);
      expect(last.result).toBe('W');
    }
  });

  it('only stages a title fight for an earned shot', () => {
    for (const f of season.fighters) {
      const last = f.bouts[f.bouts.length - 1]!;
      if (!last.isTitleFight) continue;
      const before = f.bouts.slice(0, -1);
      expect(before.filter((b) => b.result === 'L').length).toBe(0);
      expect(before.filter((b) => b.result === 'W').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('never matches a fighter against their own stablemate', () => {
    const ids = new Set(BEST.map((e) => e.fighter.id));
    for (const f of season.fighters) {
      for (const b of f.bouts) {
        if (b.opp.id) expect(ids.has(b.opp.id), `${f.fighter.id} vs ${b.opp.id}`).toBe(false);
      }
    }
  });

  it('does not feed a fighter the same opponent twice while fresh ones exist', () => {
    // Picking strictly the nearest-to-target made every bout the same man.
    // A repeat is only acceptable when the division's historical pool is
    // genuinely too small to field four distinct opponents.
    for (let seed = 0; seed < 200; seed++) {
      const s = simSeason(BEST, FIGHTERS, { seed });
      for (const f of s.fighters) {
        const realOpps = f.bouts.map((b) => b.opp.id).filter((x): x is string => x !== null);
        const distinct = new Set(realOpps).size;
        if (distinct === realOpps.length) continue;

        const window = f.fighter.peak ?? f.fighter.active;
        const poolSize = FIGHTERS.filter(
          (x) =>
            x.id !== f.fighter.id &&
            x.divisions.some((d) => d.wc === f.slotWc && overlaps(d.years, window)),
        ).length;
        expect(
          poolSize,
          `${f.fighter.id} repeated an opponent with ${poolSize} available at ${f.slotWc}`,
        ).toBeLessThan(BOUTS_PER_FIGHTER);
      }
    }
  });

  it('uses a variety of opponents across seeds', () => {
    const names = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      for (const f of simSeason(BEST, FIGHTERS, { seed }).fighters) {
        for (const b of f.bouts) names.add(b.opp.name);
      }
    }
    expect(names.size).toBeGreaterThan(12);
  });

  it('gives decisions a full twelve rounds and stoppages fewer', () => {
    for (const f of season.fighters) {
      for (const b of f.bouts) {
        expect(b.round).toBeGreaterThanOrEqual(1);
        expect(b.round).toBeLessThanOrEqual(12);
        if (b.method === 'KO') expect(b.round).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('determinism', () => {
  it('sims the same roster identically twice', () => {
    expect(simSeason(BEST, FIGHTERS)).toEqual(simSeason(BEST, FIGHTERS));
  });

  it('derives a stable seed from roster contents', () => {
    expect(seasonSeed(BEST)).toBe(seasonSeed([...BEST]));
    expect(seasonSeed(BEST)).not.toBe(seasonSeed(WORST));
  });

  it('changes the result when the seed changes', () => {
    const a = simSeason(BEST, FIGHTERS, { seed: 1 });
    const b = simSeason(BEST, FIGHTERS, { seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('contains no Math.random anywhere in the engine', () => {
    // The whole reproducibility guarantee rests on this.
    const dir = new URL('.', import.meta.url).pathname;
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = stripComments(readFileSync(join(dir, file), 'utf8'));
      expect(src.includes('Math.random'), `${file} uses Math.random`).toBe(false);
    }
  });
});

describe('balance', () => {
  const N = 2000;
  const strong = Array.from({ length: N }, (_, i) => simSeason(STRONG, FIGHTERS, { seed: i }));
  const weak = Array.from({ length: N }, (_, i) => simSeason(WEAK, FIGHTERS, { seed: i }));

  const sW = strong.map((s) => s.w);
  const wW = weak.map((s) => s.w);

  it('rewards a better draft', () => {
    expect(mean(sW) - mean(wW)).toBeGreaterThanOrEqual(6);
  });

  it('makes a lopsided mismatch a blowout', () => {
    let wins = 0;
    for (let i = 0; i < N; i++) if (strong[i]!.score > weak[i]!.score) wins++;
    expect(wins / N).toBeGreaterThanOrEqual(0.98);
  });

  it('is dominant but not a foregone conclusion between close stables', () => {
    // The band the game is actually played in: a clearly better draft should
    // usually win, but "usually" has to leave room for an upset.
    const good = Array.from({ length: N }, (_, i) => simSeason(GOOD, FIGHTERS, { seed: i }));
    const mid = Array.from({ length: N }, (_, i) => simSeason(MEDIOCRE, FIGHTERS, { seed: i }));
    let wins = 0;
    for (let i = 0; i < N; i++) if (good[i]!.score > mid[i]!.score) wins++;
    const p = wins / N;
    expect(p).toBeGreaterThanOrEqual(0.85);
    expect(p).toBeLessThanOrEqual(0.995);
  });

  it('leaves real variance in a strong stable', () => {
    expect(stdev(sW)).toBeGreaterThanOrEqual(1.5);
  });

  it('rarely produces a perfect season', () => {
    const total = STRONG.length * BOUTS_PER_FIGHTER;
    const perfect = strong.filter((s) => s.w === total).length / N;
    expect(perfect).toBeLessThanOrEqual(0.05);
  });

  it('separates the two on belts', () => {
    expect(mean(strong.map((s) => s.belts))).toBeGreaterThan(mean(weak.map((s) => s.belts)) + 1);
  });

  it('ranks the curated pool between the synthetic extremes', () => {
    // The shipped dataset is all-time greats, so even its weakest legal stable
    // should land well above a genuinely bad one.
    const best = mean(
      Array.from({ length: 400 }, (_, i) => simSeason(BEST, FIGHTERS, { seed: i }).w),
    );
    const worst = mean(
      Array.from({ length: 400 }, (_, i) => simSeason(WORST, FIGHTERS, { seed: i }).w),
    );
    expect(best).toBeGreaterThan(worst);
    expect(worst).toBeGreaterThan(mean(wW));
  });

  it('keeps opposition difficulty independent of the drafted fighter’s era', () => {
    // Anchoring opposition to a fighter's own era pool would let a weak stable
    // from a thin era farm wins. Same tier, different eras, similar results.
    const eraRoster = (from: number, to: number): RosterEntry[] =>
      WEIGHT_CLASS_IDS.map((wc, i) => ({
        slotWc: wc,
        fighter: {
          ...syntheticRoster(70)[i]!.fighter!,
          id: `era-${from}-${wc}`,
          active: [from, to] as [number, number],
          divisions: [{ wc, years: [from, to] as [number, number] }],
        },
      }));
    const old = mean(
      Array.from({ length: 400 }, (_, i) => simSeason(eraRoster(1900, 1910), FIGHTERS, { seed: i }).w),
    );
    const modern = mean(
      Array.from({ length: 400 }, (_, i) => simSeason(eraRoster(2000, 2010), FIGHTERS, { seed: i }).w),
    );
    expect(Math.abs(old - modern)).toBeLessThan(5);
  });

  it('grades monotonically', () => {
    expect(gradeFor(200)).toBe('S');
    expect(gradeFor(0)).toBe('F');
    const grades = [0, 50, 70, 85, 100, 130].map(gradeFor);
    expect(new Set(grades).size).toBeGreaterThan(3);
  });
});

describe('bout distribution', () => {
  const seasons = Array.from({ length: 600 }, (_, i) => simSeason(BEST, FIGHTERS, { seed: i }));
  const allBouts = seasons.flatMap((s) => s.fighters.flatMap((f) => f.bouts));

  /**
   * Calibration reference — Neurology 2019, doi:10.1212/01.wnl.0000580936.14660.4e,
   * a retrospective analysis of 1,690 US professional bouts:
   *   KO 18.1% + TKO 35.1% = 53.2% stoppages, 46.5% decisions.
   *
   * We target ~40%, deliberately below that, because the study's population is
   * all US professional boxing — dominated by club-show mismatches that end
   * early — whereas this sim models champions against credible ranked
   * opposition, which goes to the cards far more often. The deviation is a
   * judgement call, but an argued one anchored to a real figure.
   */
  const STOPPAGE_TARGET = 0.4;
  const STOPPAGE_TOLERANCE = 0.06;

  it('stops bouts at the calibrated elite-level rate', () => {
    const stops = allBouts.filter((b) => b.method === 'KO' || b.method === 'TKO').length;
    const rate = stops / allBouts.length;
    expect(rate).toBeGreaterThan(STOPPAGE_TARGET - STOPPAGE_TOLERANCE);
    expect(rate).toBeLessThan(STOPPAGE_TARGET + STOPPAGE_TOLERANCE);
  });

  it('stays below the all-boxing stoppage rate, as intended', () => {
    // If this ever fails we have drifted into modelling club shows.
    const rate =
      allBouts.filter((b) => b.method === 'KO' || b.method === 'TKO').length / allBouts.length;
    expect(rate).toBeLessThan(0.532);
  });

  it('draws at roughly the published professional rate', () => {
    // Published figure is ~2-3% of professional bouts, higher in title fights.
    const draws = allBouts.filter((b) => b.result === 'D').length / allBouts.length;
    expect(draws).toBeGreaterThan(0.015);
    expect(draws).toBeLessThan(0.06);
  });

  it('stops more often at heavyweight than at flyweight', () => {
    const rateFor = (wc: WeightClassId) => {
      const bouts = seasons
        .flatMap((s) => s.fighters.filter((f) => f.slotWc === wc))
        .flatMap((f) => f.bouts);
      if (bouts.length === 0) return 0;
      return bouts.filter((b) => b.method === 'KO' || b.method === 'TKO').length / bouts.length;
    };
    expect(rateFor('heavy')).toBeGreaterThan(rateFor('fly'));
  });

  it('draws more often in the pre-1950 era', () => {
    // Draw rate is era-weighted, so a roster of old fighters should draw more.
    const oldRoster: RosterEntry[] = FIGHTERS.filter((f) => (f.peak ?? f.active)[1] < 1950)
      .slice(0, 8)
      .map((f) => ({ slotWc: f.divisions[0]!.wc, fighter: f }));
    const modernRoster: RosterEntry[] = FIGHTERS.filter((f) => (f.peak ?? f.active)[1] >= 1990)
      .slice(0, 8)
      .map((f) => ({ slotWc: f.divisions[0]!.wc, fighter: f }));

    const drawRate = (roster: RosterEntry[]) => {
      const bouts = Array.from({ length: 400 }, (_, i) =>
        simSeason(roster, FIGHTERS, { seed: i }),
      ).flatMap((s) => s.fighters.flatMap((f) => f.bouts));
      return bouts.filter((b) => b.result === 'D').length / bouts.length;
    };

    expect(drawRate(oldRoster)).toBeGreaterThan(drawRate(modernRoster));
  });
});
