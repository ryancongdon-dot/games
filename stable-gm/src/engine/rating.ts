import type { Fighter, Style, WeightClassId } from '../data/types';
import { decadeOf } from '../data/divisions';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Weights for the four OVR terms. Should sum to 1. */
export const W_TIER = 0.55;
export const W_QUAL = 0.2;
export const W_TITLE = 0.15;
export const W_PHYS = 0.1;

/**
 * Era adjustment, in OVR points. Reflects depth of competition, not talent:
 * the 1900s had a shallow professional pool, the 1950s-80s a deep one.
 */
export const ERA_STRENGTH: Readonly<Record<number, number>> = {
  1900: -3,
  1910: -2,
  1920: 0,
  1930: 1,
  1940: 2,
  1950: 3,
  1960: 2,
  1970: 3,
  1980: 3,
  1990: 1,
  2000: 0,
  2010: -1,
};

/** OVR cost of slotting a fighter outside their primary division. */
export const OFF_DIVISION_PENALTY = 3;

export const OVR_MIN = 20;
export const OVR_MAX = 99;

// ---------------------------------------------------------------------------

export interface RatedFighter {
  id: string;
  name: string;
  ovr: number;
  power: number;
  chin: number;
  speed: number;
  iq: number;
  stamina: number;
  style: Style;
  ht: number;
  reach: number;
  ref: Fighter;
}

export interface RateContext {
  /** The slot this fighter is being rated for. Omit for a neutral rating. */
  slotWc?: WeightClassId;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Midpoint of the peak window, falling back to the midpoint of the career. */
export function peakYear(f: Fighter): number {
  const [a, b] = f.peak ?? f.active;
  return Math.round((a + b) / 2);
}

/**
 * Derive a rating from a fighter's curated stats.
 *
 * `tier` dominates deliberately: a raw W-L-D carries no opponent-quality
 * signal, so 50-0 against nobody and 50-0 against champions are arithmetically
 * identical. The curated tier is what separates them.
 */
export function rate(f: Fighter, ctx: RateContext = {}): RatedFighter {
  const rec = f.peakRecord ?? f.record;
  const bouts = rec.w + rec.l + rec.d;

  // Win quality, 0..1. A fighter with no recorded bouts scores neutral.
  const qual = bouts > 0 ? (rec.w + 0.5 * rec.d) / bouts : 0.5;
  const koPct = rec.w > 0 ? rec.ko / rec.w : 0;

  // Title record, 0..100. Reigns matter more than defences, but a long reign
  // of defences is what separates a champion from a titleholder.
  const title = Math.min(100, 34 * f.titleReigns + 5 * f.titleDefenses);

  // Reach advantage relative to height. Capped so it never dominates.
  const phys = 50 + clamp(f.reach - f.ht, -4, 8) * 2;

  const era = ERA_STRENGTH[decadeOf(peakYear(f))] ?? 0;
  const offDivision =
    ctx.slotWc && f.divisions[0] && ctx.slotWc !== f.divisions[0].wc ? OFF_DIVISION_PENALTY : 0;

  const raw =
    W_TIER * f.tier + W_QUAL * (100 * qual) + W_TITLE * title + W_PHYS * phys + era - offDivision;

  const a = f.attrs ?? {};
  return {
    id: f.id,
    name: f.name,
    ovr: clamp(Math.round(raw), OVR_MIN, OVR_MAX),
    power: a.power ?? clamp(Math.round(35 + 60 * koPct), 20, 98),
    chin: a.chin ?? clamp(Math.round(0.7 * f.tier + 20), 25, 95),
    speed: a.speed ?? clamp(Math.round(0.8 * f.tier + 12), 25, 97),
    iq: a.iq ?? clamp(Math.round(f.tier), 25, 99),
    stamina: a.stamina ?? clamp(Math.round(0.75 * f.tier + 18), 25, 95),
    style: f.style,
    ht: f.ht,
    reach: f.reach,
    ref: f,
  };
}

/** Convenience: OVR only, for sorting a board without building full ratings. */
export function ovrOf(f: Fighter, ctx: RateContext = {}): number {
  return rate(f, ctx).ovr;
}
