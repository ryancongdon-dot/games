import type { Fighter, FightRecord } from '../data/types';
import type { Bout } from '../engine/sim';

/** "173-19-6" */
export function recordLine(r: FightRecord): string {
  return `${r.w}-${r.l}${r.d > 0 ? `-${r.d}` : ''}`;
}

/** The ledger shown on the board, and whether it is a peak or career split. */
export function boardRecord(f: Fighter): { rec: FightRecord; label: 'Peak' | 'Career' } {
  return f.peakRecord ? { rec: f.peakRecord, label: 'Peak' } : { rec: f.record, label: 'Career' };
}

export function koPct(r: FightRecord): number {
  const bouts = r.w + r.l + r.d;
  return bouts > 0 ? Math.round((r.ko / bouts) * 100) : 0;
}

/** 71 -> 5'11" */
export function inchesToFeet(n: number): string {
  return `${Math.floor(n / 12)}'${n % 12}"`;
}

/** Disputed ledgers carry their asterisk wherever the number appears. */
export function asterisk(f: Fighter): string {
  return f.confidence === 'low' ? '*' : '';
}

export function boutLine(b: Bout): string {
  if (b.result === 'D') return 'Draw';
  const verb = b.result === 'W' ? '' : 'lost ';
  if (b.method === 'KO' || b.method === 'TKO') return `${verb}${b.method} ${b.round}`;
  return `${verb}${b.method} 12`;
}
