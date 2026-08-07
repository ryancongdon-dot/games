import type { Fighter, WeightClassId } from '../data/types';
import { overlaps, weightIndex, WEIGHT_CLASS_IDS } from '../data/divisions';
import { rate, type RatedFighter } from './rating';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Bouts each drafted fighter takes over the simulated year. */
export const BOUTS_PER_FIGHTER = 4;

/**
 * Elo-ish scale. An OVR edge of BOUT_SCALE makes you a 10:1 favourite.
 * Lower = more deterministic, higher = more chaotic.
 */
export const BOUT_SCALE = 22;

/** No bout is ever a lock, in either direction. */
export const UPSET_FLOOR = 0.05;

export const DRAW_BASE = 0.06;
/** Pre-1950 bouts were scored to a draw far more often. */
export const DRAW_ERA_BONUS = 0.05;
export const DRAW_ERA_CUTOFF = 1950;

export const KO_BASE = 0.22;
export const KO_POWER = 0.45;
export const KO_CHIN = 0.3;
export const KO_EDGE = 0.25;
export const KO_MIN = 0.05;
export const KO_MAX = 0.85;

/**
 * Global difficulty anchor for opposition, in OVR.
 *
 * This is deliberately a *constant* rather than the fighter's own division/era
 * median. Anchoring to the local pool would mean a weak fighter from a thin era
 * faced weak opponents and racked up wins, which destroys the one thing the
 * score has to do: stay comparable between two different drafts.
 */
export const OPP_TARGET_BASE = 78;
/** Difficulty multiplier applied to opposition for bouts 1..4. */
export const OPP_LADDER = [0.94, 0.98, 1.02, 1.08] as const;
/** Random OVR noise on generated opposition, +/- this many points. */
export const OPP_JITTER = 6;
/**
 * How far a real fighter's OVR may sit from the target before we use a generic
 * contender instead. Keeps real names in the bout log without letting an era's
 * talent level distort the difficulty.
 */
export const OPP_MAX_DEVIATION = 11;
/**
 * How many of the nearest candidates to choose between. Picking strictly the
 * closest makes a fighter face the same man every bout, which reads as broken
 * even though the arithmetic is fine.
 */
export const OPP_SHORTLIST = 4;

/**
 * Stoppage spread from flyweight to heavyweight. Heavier men stop each other
 * more often at the same relative skill; without this the sim inherits the
 * lighter divisions' inflated historical KO percentages.
 */
export const KO_WEIGHT_SCALE = 0.12;

/** Style triangle: swarmer beats boxer beats slugger beats swarmer. */
export const STYLE_MATRIX: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  swarmer: { boxer: 3, slugger: -3 },
  boxer: { slugger: 3, swarmer: -3 },
  slugger: { swarmer: 3, boxer: -3 },
};

export const REACH_PER_INCH = 0.8;
export const REACH_CAP = 4;

/** Wins needed entering the final bout for it to be a title fight. */
export const TITLE_SHOT_MIN_WINS = 2;

export const SCORE_W = 3;
export const SCORE_D = 1;
export const SCORE_KO = 1;
export const SCORE_BELT = 10;

/**
 * Score bands. Calibrated against the measured distribution: a best-possible
 * stable from the shipped pool averages ~117, a worst-possible legal one ~46.
 * S is deliberately rare — it should mean a great draft that also ran well.
 */
export const GRADE_CUTS: ReadonlyArray<readonly [number, string]> = [
  [132, 'S'],
  [112, 'A'],
  [92, 'B'],
  [70, 'C'],
  [48, 'D'],
  [0, 'F'],
];

// ---------------------------------------------------------------------------
// Seeded RNG — the engine must contain zero Math.random(); a test asserts it.
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** mulberry32: small, fast, good enough, and fully reproducible. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a string, for deriving a numeric seed from roster contents. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Bouts
// ---------------------------------------------------------------------------

export type BoutResult = 'W' | 'L' | 'D';
export type BoutMethod = 'KO' | 'TKO' | 'UD' | 'SD' | 'MD' | 'D';

export interface Opponent {
  /** Fighter id when real, null for a synthesized contender. */
  id: string | null;
  name: string;
  ovr: number;
  power: number;
  chin: number;
  style: string;
  reach: number;
  /** True when drawn from the real fighter pool rather than synthesized. */
  real: boolean;
  titlist: boolean;
}

export interface Bout {
  index: number;
  opp: Opponent;
  result: BoutResult;
  method: BoutMethod;
  /** Round the bout ended; 12 for a decision. */
  round: number;
  isTitleFight: boolean;
}

export interface FighterSeason {
  slotWc: WeightClassId;
  fighter: Fighter;
  rated: RatedFighter;
  bouts: Bout[];
  w: number;
  l: number;
  d: number;
  ko: number;
  belt: boolean;
}

export interface SeasonResult {
  fighters: FighterSeason[];
  w: number;
  l: number;
  d: number;
  ko: number;
  belts: number;
  score: number;
  grade: string;
  seed: number;
}

/**
 * Build an opponent for a given bout. Prefers a real fighter from the same
 * division and era (so the bout log carries real names), and only synthesizes
 * a generic contender when the historical pool is too thin.
 */
export function makeOpponent(
  r: Rng,
  self: RatedFighter,
  slotWc: WeightClassId,
  boutIndex: number,
  pool: readonly Fighter[],
  excludeIds: ReadonlySet<string>,
  facedIds: ReadonlySet<string> = new Set(),
): Opponent {
  const ladder = OPP_LADDER[boutIndex] ?? 1;
  const window = self.ref.peak ?? self.ref.active;

  const target = OPP_TARGET_BASE * ladder;

  const candidates = pool.filter(
    (f) =>
      !excludeIds.has(f.id) &&
      f.id !== self.id &&
      f.divisions.some((d) => d.wc === slotWc && overlaps(d.years, window)),
  );

  // Rank by closeness to the global target, ties broken by id for stability.
  const ranked = candidates
    .map((f) => rate(f, { slotWc }))
    .map((cand) => ({ cand, dist: Math.abs(cand.ovr - target) }))
    .sort((a, b) => a.dist - b.dist || (a.cand.id < b.cand.id ? -1 : 1));

  // Both branches consume exactly two draws, so the stream stays aligned.
  const pickRoll = r();
  const jitter = (r() * 2 - 1) * OPP_JITTER;

  // Prefer someone this fighter hasn't already met this year.
  const fresh = ranked.filter((x) => !facedIds.has(x.cand.id));
  const shortlist = (fresh.length > 0 ? fresh : ranked).slice(0, OPP_SHORTLIST);
  const chosen = shortlist[Math.min(shortlist.length - 1, Math.floor(pickRoll * shortlist.length))];

  const best = chosen?.cand ?? null;
  const bestDist = chosen?.dist ?? Infinity;

  if (!best || bestDist > OPP_MAX_DEVIATION) {
    return {
      id: null,
      name: 'Ranked contender',
      ovr: clamp(Math.round(target + jitter), 20, 99),
      power: 55,
      chin: 55,
      style: 'boxer-puncher',
      reach: self.reach,
      real: false,
      titlist: boutIndex === BOUTS_PER_FIGHTER - 1,
    };
  }

  return {
    id: best.id,
    name: best.name,
    ovr: clamp(Math.round(best.ovr + jitter), 20, 99),
    power: best.power,
    chin: best.chin,
    style: best.style,
    reach: best.reach,
    real: true,
    titlist: best.ref.divisions.some((d) => d.wc === slotWc && d.titlist),
  };
}

function styleEdge(a: string, b: string): number {
  return STYLE_MATRIX[a]?.[b] ?? 0;
}

function decisionMethod(r: Rng, absEdge: number): BoutMethod {
  if (absEdge >= 12) return 'UD';
  const roll = r();
  if (absEdge >= 6) return roll < 0.7 ? 'UD' : 'MD';
  return roll < 0.4 ? 'SD' : roll < 0.75 ? 'MD' : 'UD';
}

/**
 * Resolve one bout from the perspective of `a`.
 *
 * Consumes rng draws in a fixed order — outcome, then finish, then round or
 * decision flavour — so the stream stays reproducible.
 */
export function bout(
  r: Rng,
  a: RatedFighter,
  b: Opponent,
  opts: { year: number; index: number; isTitleFight: boolean; slotWc: WeightClassId },
): Bout {
  const edge =
    a.ovr - b.ovr + styleEdge(a.style, b.style) + clamp((a.reach - b.reach) * REACH_PER_INCH, -REACH_CAP, REACH_CAP);

  const pWin = clamp(1 / (1 + Math.pow(10, -edge / BOUT_SCALE)), UPSET_FLOOR, 1 - UPSET_FLOOR);

  // Draws are likeliest in even bouts and rarer as the gap widens.
  const evenness = 1 - Math.abs(pWin - 0.5) * 2;
  const pDraw = (DRAW_BASE + (opts.year < DRAW_ERA_CUTOFF ? DRAW_ERA_BONUS : 0)) * evenness;

  const outcomeRoll = r();
  let result: BoutResult;
  if (outcomeRoll < pDraw) {
    result = 'D';
  } else {
    // Rescale the remaining probability mass over win/loss.
    const rescaled = (outcomeRoll - pDraw) / (1 - pDraw);
    result = rescaled < pWin ? 'W' : 'L';
  }

  if (result === 'D') {
    // Keep the draw branch consuming the same number of draws as a decision.
    r();
    return { index: opts.index, opp: b, result, method: 'D', round: 12, isTitleFight: opts.isTitleFight };
  }

  const winnerPower = result === 'W' ? a.power : b.power;
  const loserChin = result === 'W' ? b.chin : a.chin;
  const edgeForWinner = result === 'W' ? Math.max(0, edge) : Math.max(0, -edge);

  // -KO_WEIGHT_SCALE/2 at flyweight, +KO_WEIGHT_SCALE/2 at heavyweight.
  const weightFactor =
    (weightIndex(opts.slotWc) / (WEIGHT_CLASS_IDS.length - 1) - 0.5) * KO_WEIGHT_SCALE;

  const pKO = clamp(
    KO_BASE +
      KO_POWER * (winnerPower / 100) -
      KO_CHIN * (loserChin / 100) +
      (KO_EDGE * edgeForWinner) / 100 +
      weightFactor,
    KO_MIN,
    KO_MAX,
  );

  const finishRoll = r();
  if (finishRoll < pKO) {
    // Rounds skew early with power: a big puncher ends it sooner.
    const skew = 0.35 + 0.5 * (1 - winnerPower / 100);
    const round = clamp(1 + Math.floor(Math.pow(r(), skew) * 12), 1, 12);
    return {
      index: opts.index,
      opp: b,
      result,
      method: round <= 6 ? 'KO' : 'TKO',
      round,
      isTitleFight: opts.isTitleFight,
    };
  }

  return {
    index: opts.index,
    opp: b,
    result,
    method: decisionMethod(r, Math.abs(edge)),
    round: 12,
    isTitleFight: opts.isTitleFight,
  };
}

// ---------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------

export interface RosterEntry {
  slotWc: WeightClassId;
  fighter: Fighter;
}

/** Deterministic seed derived from the roster itself. */
export function seasonSeed(roster: readonly RosterEntry[]): number {
  return hashSeed(roster.map((e) => `${e.slotWc}:${e.fighter.id}`).join('|'));
}

export function gradeFor(score: number): string {
  for (const [cut, g] of GRADE_CUTS) if (score >= cut) return g;
  return 'F';
}

/**
 * Simulate a year for a completed roster.
 *
 * Each fighter climbs a four-bout ladder of increasing difficulty. Win the
 * final bout having entered it undefeated with at least TITLE_SHOT_MIN_WINS
 * wins, and that final bout was a title fight you took and won — a belt.
 */
export function simSeason(
  roster: readonly RosterEntry[],
  pool: readonly Fighter[],
  opts: { seed?: number } = {},
): SeasonResult {
  const seed = opts.seed ?? seasonSeed(roster);
  const r = rng(seed);
  const rosterIds = new Set(roster.map((e) => e.fighter.id));

  const fighters: FighterSeason[] = [];
  let W = 0;
  let L = 0;
  let D = 0;
  let KO = 0;
  let belts = 0;

  for (const entry of roster) {
    const rated = rate(entry.fighter, { slotWc: entry.slotWc });
    const year = (entry.fighter.peak ?? entry.fighter.active)[1];

    const bouts: Bout[] = [];
    const faced = new Set<string>();
    let w = 0;
    let l = 0;
    let d = 0;
    let ko = 0;

    for (let i = 0; i < BOUTS_PER_FIGHTER; i++) {
      const isFinal = i === BOUTS_PER_FIGHTER - 1;
      const earnedShot = w >= TITLE_SHOT_MIN_WINS && l === 0;
      const opp = makeOpponent(r, rated, entry.slotWc, i, pool, rosterIds, faced);
      if (opp.id) faced.add(opp.id);
      const isTitleFight = isFinal && earnedShot;

      const b = bout(r, rated, opp, { year, index: i, isTitleFight, slotWc: entry.slotWc });
      bouts.push(b);

      if (b.result === 'W') {
        w++;
        if (b.method === 'KO' || b.method === 'TKO') ko++;
      } else if (b.result === 'L') {
        l++;
      } else {
        d++;
      }
    }

    const last = bouts[bouts.length - 1]!;
    const belt = last.isTitleFight && last.result === 'W';
    if (belt) belts++;

    W += w;
    L += l;
    D += d;
    KO += ko;

    fighters.push({ slotWc: entry.slotWc, fighter: entry.fighter, rated, bouts, w, l, d, ko, belt });
  }

  const score = W * SCORE_W + D * SCORE_D + KO * SCORE_KO + belts * SCORE_BELT;

  return { fighters, w: W, l: L, d: D, ko: KO, belts, score, grade: gradeFor(score), seed };
}
