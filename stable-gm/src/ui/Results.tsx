import { useState } from 'react';
import { weightClass } from '../data/divisions';
import type { SeasonResult } from '../engine/sim';
import { boutLine } from './format';

interface Props {
  season: SeasonResult;
  best: { score: number; record: string; belts: number } | null;
  onNewRun: () => void;
  onCopy: () => void;
}

export default function Results({ season, best, onNewRun, onCopy }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const isBest = best !== null && season.score >= best.score;

  return (
    <div className="results">
      <div className="result-hero">
        <div className="eyebrow">Your stable, one year on</div>
        <div className="result-record">
          {season.w}–{season.l}
          {season.d > 0 ? `–${season.d}` : ''}
        </div>
        <div className="result-sub">
          {season.ko} by knockout · {season.fighters.length * 4} bouts
        </div>

        <div className="belts" aria-label={`${season.belts} titles won`}>
          {season.belts > 0 ? '🏆'.repeat(season.belts) : '—'}
        </div>
        <div className="result-sub">
          {season.belts === 0
            ? 'No titles'
            : `${season.belts} world title${season.belts > 1 ? 's' : ''}`}
        </div>

        <div className="grade-row">
          <div>
            <div className="grade">{season.grade}</div>
            <div className="grade-label">Grade</div>
          </div>
          <div>
            <div className="score">{season.score}</div>
            <div className="score-label">Score</div>
          </div>
        </div>

        {best && (
          <p className="pb">
            {isBest ? (
              <>
                🎉 <b>New personal best!</b>
              </>
            ) : (
              <>
                Personal best: <b>{best.score}</b> ({best.record}, {best.belts} 🏆)
              </>
            )}
          </p>
        )}
      </div>

      <div className="fighter-results">
        {season.fighters.map((f) => {
          const isOpen = open === f.fighter.id;
          return (
            <div className="fr" key={f.fighter.id}>
              <button
                className="fr-head"
                onClick={() => setOpen(isOpen ? null : f.fighter.id)}
                aria-expanded={isOpen}
              >
                <span className="fr-wc">{weightClass(f.slotWc).short}</span>
                <span className="fr-name">{f.fighter.name}</span>
                {f.belt && <span className="title-tag">🏆</span>}
                <span className="fr-rec">
                  {f.w}-{f.l}
                  {f.d > 0 ? `-${f.d}` : ''}
                </span>
                <span aria-hidden="true" style={{ color: 'var(--muted)' }}>
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>

              {isOpen && (
                <div className="fr-bouts">
                  {f.bouts.map((b) => (
                    <div className="bout" key={b.index}>
                      <span className={`res ${b.result}`}>{b.result}</span>
                      <span className="method">{boutLine(b)}</span>
                      <span className={`opp${b.opp.real ? '' : ' generic'}`}>
                        vs {b.opp.name}
                      </span>
                      {b.isTitleFight && <span className="title-tag">TITLE</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="actions">
        <button className="btn primary" onClick={onNewRun}>
          NEW RUN
        </button>
        <button className="btn" onClick={onCopy}>
          COPY RESULT
        </button>
      </div>
    </div>
  );
}
