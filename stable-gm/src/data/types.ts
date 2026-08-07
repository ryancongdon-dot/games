// Shared data types. Nothing in here may reference a roster *slot*, a spin, or
// the DOM — this layer is mode-agnostic so a future Card Promoter mode can
// reuse it untouched. `division` is a data attribute; `slot` is a game rule.

/** Weight-class ids, ordered light -> heavy in WEIGHT_CLASSES. */
export type WeightClassId =
  | 'fly'
  | 'bant'
  | 'feath'
  | 'light'
  | 'welter'
  | 'middle'
  | 'lheavy'
  | 'heavy';

export interface WeightClass {
  id: WeightClassId;
  name: string;
  short: string;
  lbs: number;
}

/** Inclusive year range, [from, to]. */
export type YearRange = [number, number];

export type Stance = 'orthodox' | 'southpaw' | 'switch';

/**
 * Fighting style. Drives the rock-paper-scissors style matchup in the sim:
 * swarmer beats boxer, boxer beats slugger, slugger beats swarmer.
 * 'boxer-puncher' is the neutral hybrid and gives/takes no style edge.
 */
export type Style = 'swarmer' | 'boxer' | 'slugger' | 'boxer-puncher';

/**
 * How much to trust this record. Pre-~1925 ledgers are genuinely disputed
 * between sources (newspaper decisions, unrecorded bouts), so 'low' entries
 * render with an asterisk and a footnote in the UI rather than being presented
 * as settled fact.
 */
export type Confidence = 'high' | 'medium' | 'low';

export interface FightRecord {
  w: number;
  l: number;
  d: number;
  /** Wins by knockout/TKO. Must be <= w. */
  ko: number;
}

/** A weight class the fighter actually campaigned at, and when. */
export interface DivisionStint {
  wc: WeightClassId;
  /** Campaign window at THIS weight — board membership tests against this, not `active`. */
  years: YearRange;
  /** Held a recognised title at this weight. */
  titlist?: boolean;
}

/** Optional 0-100 overrides for the attributes rating.ts otherwise derives. */
export interface FighterAttrs {
  power?: number;
  chin?: number;
  speed?: number;
  iq?: number;
  stamina?: number;
}

export interface Fighter {
  id: string;
  name: string;
  nick?: string;
  country?: string;
  /** Full professional career span. */
  active: YearRange;
  /** Peak window; `peakRecord` is the ledger through it. */
  peak?: YearRange;
  /**
   * Eligibility spine. divisions[0] is the primary division — slotting a
   * fighter anywhere else costs OFF_DIVISION_PENALTY in rating.ts.
   */
  divisions: DivisionStint[];
  /** Full career ledger. */
  record: FightRecord;
  /** Ledger through `peak`. Shown on the board when present. */
  peakRecord?: FightRecord;
  /** Height in inches. */
  ht: number;
  /** Reach in inches. */
  reach: number;
  stance: Stance;
  style: Style;
  titleReigns: number;
  titleDefenses: number;
  /**
   * Curated quality grade, 40-99. The dominant rating term: this is where
   * judgement about *level of opposition* lives, since a raw W-L-D carries no
   * opponent-quality signal at all.
   */
  tier: number;
  attrs?: FighterAttrs;
  /** Card Promoter mode only — namespaced so it can grow without touching this schema. */
  promo?: { draw?: number; drama?: number };

  // --- provenance: these are factual claims about real people ---
  src: string;
  /** YYYY-MM the record was last checked. */
  verified: string;
  confidence: Confidence;
  note?: string;
}
