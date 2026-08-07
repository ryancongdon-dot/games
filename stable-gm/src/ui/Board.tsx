import { useMemo, useState } from 'react';
import type { Fighter, WeightClassId } from '../data/types';
import { weightClass } from '../data/divisions';
import { rate } from '../engine/rating';
import { recordLine, koPct, boardRecord, asterisk } from './format';

export type SortKey = 'ovr' | 'name' | 'record' | 'ko' | 'kopct' | 'ht' | 'reach' | 'titles';

const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'ovr', label: 'OVR' },
  { key: 'name', label: 'Fighter' },
  { key: 'record', label: 'W-L-D' },
  { key: 'ko', label: 'KO' },
  { key: 'kopct', label: 'KO%' },
  { key: 'ht', label: 'Ht' },
  { key: 'reach', label: 'Reach' },
  { key: 'titles', label: 'Titles' },
];

interface Props {
  fighters: Fighter[];
  /** Open slots per fighter id. Empty array = not signable. */
  eligibility: Map<string, WeightClassId[]>;
  signedIds: Set<string>;
  /** Highlight filter from tapping a roster slot. */
  filterSlot: WeightClassId | null;
  onOpen: (f: Fighter) => void;
  emptyMessage: string;
}

function sortValue(f: Fighter, key: SortKey): number | string {
  const { rec } = boardRecord(f);
  switch (key) {
    case 'name':
      return f.name;
    case 'record':
      return rec.w - rec.l;
    case 'ko':
      return rec.ko;
    case 'kopct':
      return koPct(rec);
    case 'ht':
      return f.ht;
    case 'reach':
      return f.reach;
    case 'titles':
      return f.titleReigns * 100 + f.titleDefenses;
    case 'ovr':
    default:
      return rate(f).ovr;
  }
}

export default function Board({
  fighters,
  eligibility,
  signedIds,
  filterSlot,
  onOpen,
  emptyMessage,
}: Props) {
  const [sort, setSort] = useState<SortKey>('ovr');
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const list = filterSlot
      ? fighters.filter((f) => (eligibility.get(f.id) ?? []).includes(filterSlot))
      : fighters;

    return [...list].sort((a, b) => {
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      const cmp =
        typeof va === 'string' || typeof vb === 'string'
          ? String(va).localeCompare(String(vb))
          : va - vb;
      return desc ? -cmp : cmp;
    });
  }, [fighters, eligibility, filterSlot, sort, desc]);

  return (
    <>
      <div className="sort-chips" role="group" aria-label="Sort fighters">
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={`sort-chip${sort === s.key ? ' on' : ''}`}
            aria-pressed={sort === s.key}
            onClick={() => {
              if (sort === s.key) setDesc((d) => !d);
              else {
                setSort(s.key);
                setDesc(s.key !== 'name');
              }
            }}
          >
            {s.label}
            {sort === s.key ? (desc ? ' ↓' : ' ↑') : ''}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="empty">{emptyMessage}</p>
      ) : (
        <div className="rows">
          {rows.map((f) => {
            const slots = eligibility.get(f.id) ?? [];
            const signed = signedIds.has(f.id);
            const locked = !signed && slots.length === 0;
            const { rec, label } = boardRecord(f);
            const r = rate(f);

            return (
              <button
                key={f.id}
                className={`row${locked ? ' locked' : ''}${signed ? ' signed' : ''}`}
                onClick={() => onOpen(f)}
              >
                <div className="row-top">
                  <span className="row-name">{f.name}</span>
                  {f.nick && <span className="row-nick">“{f.nick}”</span>}
                  <span className="row-ovr">{r.ovr}</span>
                </div>

                <div className="row-stats">
                  <span>
                    <b>
                      {recordLine(rec)}
                      {asterisk(f)}
                    </b>{' '}
                    {label.toLowerCase()}
                  </span>
                  <span>
                    <b>{rec.ko}</b> KO ({koPct(rec)}%)
                  </span>
                  <span>
                    <b>{f.reach}"</b> reach
                  </span>
                  {f.titleReigns > 0 && (
                    <span>
                      <b>{f.titleReigns}</b> × champ
                    </span>
                  )}
                </div>

                <div className="badges">
                  {signed ? (
                    <span className="badge elig">IN YOUR STABLE</span>
                  ) : slots.length > 0 ? (
                    slots.map((s) => (
                      <span key={s} className="badge elig">
                        {weightClass(s).short}
                      </span>
                    ))
                  ) : (
                    <span className="badge">
                      {f.divisions.map((d) => weightClass(d.wc).short).join(' / ')} — filled
                    </span>
                  )}
                  {f.confidence === 'low' && <span className="badge warnbadge">DISPUTED*</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
