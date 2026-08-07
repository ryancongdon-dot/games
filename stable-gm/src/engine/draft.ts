import type { Fighter, WeightClassId } from '../data/types';
import {
  WEIGHT_CLASSES,
  WEIGHT_CLASS_IDS,
  ERA_ANCHORS,
  eraName,
  adjacent,
  overlaps,
} from '../data/divisions';
import { FIGHTERS, fighterById } from '../data/fighters';
import { rng, hashSeed, type Rng } from './sim';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Spins available to fill 8 slots. The slack is the whole game. */
export const SPIN_BUDGET = 12;
/** Signings allowed per board. One, then you must spin again. */
export const PICKS_PER_BOARD = 1;

/** Years in a spin window before any widening. */
export const ERA_SPAN = 10;
/** Years added per side when a slice is too thin. */
export const ERA_WIDEN_STEP = 2;
export const ERA_MAX_SPAN = 20;

/** Target board size. */
export const BOARD_MIN = 8;
/** Below this, the slice is dropped from the spin table entirely. */
export const BOARD_MIN_HARD = 5;
/**
 * Minimum fighters who actually campaigned at the slice's weight. Backfilled
 * fighters pad a board but can't be signed to it, so a slice with too few
 * natives is unplayable.
 */
export const SLICE_MIN_NATIVE = 3;
export const BOARD_MAX = 22;
/** Top-N by tier always appear; the rest are sampled. */
export const BOARD_TIER_TOP = 6;

/** Chance the spun division is one you still need to fill. */
export const OPEN_DIVISION_BIAS = 0.8;
/** Pad thin slices from neighbouring weight classes. */
export const CROSSOVER_BACKFILL = true;

// ---------------------------------------------------------------------------
// Spin table
// ---------------------------------------------------------------------------

export interface Slice {
  wc: WeightClassId;
  anchor: number;
  from: number;
  to: number;
  /** Fighters who actually campaigned at `wc` in the window. */
  native: Fighter[];
  /** Extra fighters pulled from adjacent weights to pad a thin board. */
  backfill: Fighter[];
  /** native + backfill. */
  all: Fighter[];
  widened: boolean;
  backfilled: boolean;
}

function campaignedAt(f: Fighter, wc: WeightClassId, from: number, to: number): boolean {
  return f.divisions.some((d) => d.wc === wc && overlaps(d.years, [from, to]));
}

/** Fighters active at any weight in the window (used for backfill). */
function activeInWindow(f: Fighter, from: number, to: number): boolean {
  return f.divisions.some((d) => overlaps(d.years, [from, to]));
}

function buildSlice(wc: WeightClassId, anchor: number, pool: readonly Fighter[]): Slice {
  let span = ERA_SPAN;
  let from = anchor;
  let to = anchor + span - 1;
  let native = pool.filter((f) => campaignedAt(f, wc, from, to));
  let widened = false;

  // Widen symmetrically until the slice is big enough or we hit the cap.
  while (native.length < BOARD_MIN && span < ERA_MAX_SPAN) {
    span = Math.min(ERA_MAX_SPAN, span + ERA_WIDEN_STEP * 2);
    const half = Math.floor((span - ERA_SPAN) / 2);
    from = anchor - half;
    to = anchor + ERA_SPAN - 1 + half;
    native = pool.filter((f) => campaignedAt(f, wc, from, to));
    widened = true;
  }

  const backfill: Fighter[] = [];
  if (CROSSOVER_BACKFILL && native.length < BOARD_MIN) {
    const nativeIds = new Set(native.map((f) => f.id));
    for (const nb of adjacent(wc)) {
      for (const f of pool) {
        if (nativeIds.has(f.id) || backfill.some((x) => x.id === f.id)) continue;
        if (campaignedAt(f, nb, from, to) && activeInWindow(f, from, to)) backfill.push(f);
        if (native.length + backfill.length >= BOARD_MIN) break;
      }
      if (native.length + backfill.length >= BOARD_MIN) break;
    }
  }

  return {
    wc,
    anchor,
    from,
    to,
    native,
    backfill,
    all: [...native, ...backfill],
    widened,
    backfilled: backfill.length > 0,
  };
}

/**
 * Precompute every (weight class x decade) slice. Only slices that clear
 * BOARD_MIN_HARD survive, so `spin()` can never produce an empty board.
 */
export function buildSpinTable(pool: readonly Fighter[] = FIGHTERS): Slice[] {
  const out: Slice[] = [];
  for (const wc of WEIGHT_CLASS_IDS) {
    for (const anchor of ERA_ANCHORS) {
      const slice = buildSlice(wc, anchor, pool);
      // A slice needs real natives, not just backfill: backfilled fighters are
      // not eligible at this weight, so an all-backfill board would be unsignable.
      if (slice.all.length >= BOARD_MIN_HARD && slice.native.length >= SLICE_MIN_NATIVE) {
        out.push(slice);
      }
    }
  }
  return out;
}

/** Every slice including the rejects — for the coverage audit in tests. */
export function auditSlices(pool: readonly Fighter[] = FIGHTERS): Slice[] {
  const out: Slice[] = [];
  for (const wc of WEIGHT_CLASS_IDS) {
    for (const anchor of ERA_ANCHORS) out.push(buildSlice(wc, anchor, pool));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Draft state
// ---------------------------------------------------------------------------

export type Roster = Partial<Record<WeightClassId, string>>;

export interface Board {
  wc: WeightClassId;
  from: number;
  to: number;
  anchor: number;
  label: string;
  eraLabel: string;
  fighterIds: string[];
}

export interface DraftState {
  runSeed: number;
  spinsUsed: number;
  /** Set once a signing has been made from the current board. */
  boardPicked: boolean;
  board: Board | null;
  roster: Roster;
  /** Slices spun so far, for replay/debug. */
  spinLog: Array<{ wc: WeightClassId; from: number; to: number }>;
}

export function newRun(seed?: number): DraftState {
  return {
    runSeed: seed ?? hashSeed(`run:${Date.now()}:${SPIN_BUDGET}`),
    spinsUsed: 0,
    boardPicked: false,
    board: null,
    roster: {},
    spinLog: [],
  };
}

export function openSlots(state: DraftState): WeightClassId[] {
  return WEIGHT_CLASS_IDS.filter((id) => !state.roster[id]);
}

export function isComplete(state: DraftState): boolean {
  return openSlots(state).length === 0;
}

export function spinsLeft(state: DraftState): number {
  return SPIN_BUDGET - state.spinsUsed;
}

/**
 * The rule that makes passing on a board a real decision: after this spin you
 * must still have at least one spin per still-open slot.
 *
 * Passing is allowed while `spinsLeft > openSlots`; at equality the spin locks
 * and you have to sign from what is in front of you.
 */
export function canSpin(state: DraftState): boolean {
  if (isComplete(state)) return false;
  const left = spinsLeft(state);
  const open = openSlots(state).length;
  if (left <= 0) return false;
  // A board you've already signed from is spent, so it costs nothing to leave.
  return state.boardPicked ? left >= open : left - 1 >= open;
}

/** True when the player is out of slack and must sign from the current board. */
export function mustSign(state: DraftState): boolean {
  return state.board !== null && !state.boardPicked && !canSpin(state);
}

function pickWeighted(r: Rng, items: Fighter[], n: number): Fighter[] {
  const pool = [...items];
  const out: Fighter[] = [];
  while (out.length < n && pool.length > 0) {
    const total = pool.reduce((s, f) => s + f.tier, 0);
    let roll = r() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i]!.tier;
      if (roll <= 0) {
        idx = i;
        break;
      }
      idx = i;
    }
    out.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return out;
}

/**
 * Spin a new board. Biased toward divisions you still need, but not exclusively
 * — the 20% of spins that land on a filled division are what keep "sign a
 * welterweight and slot him at middleweight" alive as a play.
 */
export function spin(state: DraftState, table: Slice[]): Board | null {
  if (!canSpin(state)) return null;

  const r = rng(state.runSeed ^ (state.spinsUsed * 0x9e3779b9));
  const open = new Set(openSlots(state));
  const taken = new Set(Object.values(state.roster).filter(Boolean) as string[]);

  // A slice is only useful if it still has a signable fighter for an open slot.
  const usable = table.filter((s) =>
    s.all.some((f) => !taken.has(f.id) && f.divisions.some((d) => open.has(d.wc))),
  );
  const pickFrom = usable.length > 0 ? usable : table;

  const openSlices = pickFrom.filter((s) => open.has(s.wc));
  // Once the budget binds there is no slack left to waste on a division you've
  // already filled, so the open-division bias becomes mandatory.
  const tight = spinsLeft(state) - 1 <= open.size;
  const useOpen = openSlices.length > 0 && (tight || r() < OPEN_DIVISION_BIAS);
  const candidates = useOpen ? openSlices : pickFrom;
  const slice = candidates[Math.min(candidates.length - 1, Math.floor(r() * candidates.length))]!;

  const available = slice.all.filter((f) => !taken.has(f.id));

  const byTier = [...available].sort((a, b) => b.tier - a.tier || (a.id < b.id ? -1 : 1));
  const top = byTier.slice(0, BOARD_TIER_TOP);
  const rest = byTier.slice(BOARD_TIER_TOP);
  const sampled = pickWeighted(r, rest, Math.max(0, BOARD_MAX - top.length));

  const fighters = [...top, ...sampled];

  // Guarantee at least one fighter signable to an open slot, so a board can
  // never be a dead end when the player has no spins left to escape it.
  if (!fighters.some((f) => f.divisions.some((d) => open.has(d.wc)))) {
    const rescue = available.find((f) => f.divisions.some((d) => open.has(d.wc)));
    if (rescue) fighters[fighters.length - 1] = rescue;
  }

  const board: Board = {
    wc: slice.wc,
    from: slice.from,
    to: slice.to,
    anchor: slice.anchor,
    label: `${WEIGHT_CLASSES.find((w) => w.id === slice.wc)!.name} · ${slice.from}–${slice.to}`,
    eraLabel: eraName(slice.anchor),
    fighterIds: fighters.map((f) => f.id),
  };

  state.spinsUsed++;
  state.boardPicked = false;
  state.board = board;
  state.spinLog.push({ wc: slice.wc, from: slice.from, to: slice.to });

  return board;
}

/**
 * Open slots this fighter is eligible for — i.e. weights they actually
 * campaigned at. A fighter pulled onto a board by crossover backfill is not
 * eligible at the board's own weight unless they really fought there.
 */
export function eligibleSlots(f: Fighter, state: DraftState): WeightClassId[] {
  const open = openSlots(state);
  return open.filter((slot) => f.divisions.some((d) => d.wc === slot));
}

export type SignResult = { ok: true } | { ok: false; reason: string };

export function sign(state: DraftState, fighterId: string, slot: WeightClassId): SignResult {
  if (state.boardPicked) return { ok: false, reason: 'Already signed from this board.' };
  if (state.roster[slot]) return { ok: false, reason: 'That weight is already filled.' };
  if (!state.board?.fighterIds.includes(fighterId)) {
    return { ok: false, reason: 'That fighter is not on the current board.' };
  }
  const f = fighterById(fighterId);
  if (!f.divisions.some((d) => d.wc === slot)) {
    return { ok: false, reason: 'That fighter never campaigned at that weight.' };
  }
  if (Object.values(state.roster).includes(fighterId)) {
    return { ok: false, reason: 'Already in your stable.' };
  }

  state.roster[slot] = fighterId;
  state.boardPicked = true;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface SavedRun {
  runSeed: number;
  spinsUsed: number;
  boardPicked: boolean;
  board: Board | null;
  roster: Roster;
  spinLog: DraftState['spinLog'];
}

export function serialize(state: DraftState): SavedRun {
  return {
    runSeed: state.runSeed,
    spinsUsed: state.spinsUsed,
    boardPicked: state.boardPicked,
    board: state.board,
    roster: state.roster,
    spinLog: state.spinLog,
  };
}

export function restore(saved: SavedRun | null | undefined): DraftState | null {
  if (!saved || typeof saved.runSeed !== 'number') return null;
  const roster: Roster = {};
  for (const [k, v] of Object.entries(saved.roster ?? {})) {
    if (typeof v === 'string' && WEIGHT_CLASS_IDS.includes(k as WeightClassId)) {
      // Drop references to fighters that no longer exist in the dataset.
      if (FIGHTERS.some((f) => f.id === v)) roster[k as WeightClassId] = v;
    }
  }
  return {
    runSeed: saved.runSeed,
    spinsUsed: saved.spinsUsed ?? 0,
    boardPicked: saved.boardPicked ?? false,
    board: saved.board ?? null,
    roster,
    spinLog: saved.spinLog ?? [],
  };
}
