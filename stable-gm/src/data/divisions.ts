import type { WeightClass, WeightClassId } from './types';

/**
 * The eight traditional weight classes, ordered light -> heavy.
 * This order IS the roster slot order in the draft.
 */
export const WEIGHT_CLASSES: readonly WeightClass[] = [
  { id: 'fly', name: 'Flyweight', short: 'FLY', lbs: 112 },
  { id: 'bant', name: 'Bantamweight', short: 'BANT', lbs: 118 },
  { id: 'feath', name: 'Featherweight', short: 'FEATH', lbs: 126 },
  { id: 'light', name: 'Lightweight', short: 'LIGHT', lbs: 135 },
  { id: 'welter', name: 'Welterweight', short: 'WELT', lbs: 147 },
  { id: 'middle', name: 'Middleweight', short: 'MID', lbs: 160 },
  { id: 'lheavy', name: 'Light Heavyweight', short: 'LHW', lbs: 175 },
  { id: 'heavy', name: 'Heavyweight', short: 'HVY', lbs: 200 },
] as const;

export const WEIGHT_CLASS_IDS: readonly WeightClassId[] = WEIGHT_CLASSES.map((w) => w.id);

const BY_ID = new Map<WeightClassId, WeightClass>(WEIGHT_CLASSES.map((w) => [w.id, w]));

export function weightClass(id: WeightClassId): WeightClass {
  const wc = BY_ID.get(id);
  if (!wc) throw new Error(`Unknown weight class: ${id}`);
  return wc;
}

export function isWeightClassId(id: string): id is WeightClassId {
  return BY_ID.has(id as WeightClassId);
}

/** Index in the light -> heavy ordering. */
export function weightIndex(id: WeightClassId): number {
  return WEIGHT_CLASS_IDS.indexOf(id);
}

/**
 * Neighbouring weight classes, used to backfill thin spin slices. A fighter
 * pulled in this way still can't be *slotted* at a weight they never
 * campaigned at — they just appear on the board, reading as "here's someone
 * who moved up/down".
 */
export function adjacent(id: WeightClassId): WeightClassId[] {
  const i = weightIndex(id);
  const out: WeightClassId[] = [];
  const prev = WEIGHT_CLASS_IDS[i - 1];
  const next = WEIGHT_CLASS_IDS[i + 1];
  if (prev) out.push(prev);
  if (next) out.push(next);
  return out;
}

/** Decade anchors a spin window can start from. */
export const ERA_ANCHORS: readonly number[] = [
  1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010,
];

/** Flavour names shown as a chip on the board header. */
export const ERA_NAME: Readonly<Record<number, string>> = {
  1900: 'No-Decision Era',
  1910: 'The Barnstormers',
  1920: 'Golden Age',
  1930: 'Depression Era',
  1940: 'Wartime',
  1950: 'Television Era',
  1960: 'The New Breed',
  1970: 'The Big Four',
  1980: 'The Four Kings',
  1990: 'Alphabet Era',
  2000: 'Pay-Per-View Era',
  2010: 'Modern',
};

export function eraName(anchor: number): string {
  return ERA_NAME[anchor] ?? `${anchor}s`;
}

/** Decade anchor containing a given year, clamped to the anchor range. */
export function decadeOf(year: number): number {
  const first = ERA_ANCHORS[0]!;
  const last = ERA_ANCHORS[ERA_ANCHORS.length - 1]!;
  const d = Math.floor(year / 10) * 10;
  return Math.min(last, Math.max(first, d));
}

/** Do two inclusive ranges overlap? */
export function overlaps(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}
