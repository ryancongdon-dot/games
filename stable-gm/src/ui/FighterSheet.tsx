import type { Fighter, WeightClassId } from '../data/types';
import { weightClass } from '../data/divisions';
import { rate } from '../engine/rating';
import { recordLine, koPct, inchesToFeet, boardRecord, asterisk } from './format';

interface Props {
  fighter: Fighter;
  /** Open slots this fighter may be signed to. */
  eligible: WeightClassId[];
  /** Null when the board is already spent — sheet becomes read-only. */
  onSign: ((slot: WeightClassId) => void) | null;
  onClose: () => void;
  /** Explains why signing is unavailable, when it is. */
  lockedReason?: string;
}

const STANCE_LABEL: Record<string, string> = {
  orthodox: 'Orthodox',
  southpaw: 'Southpaw',
  switch: 'Switch',
};

const STYLE_LABEL: Record<string, string> = {
  swarmer: 'Swarmer',
  boxer: 'Boxer',
  slugger: 'Slugger',
  'boxer-puncher': 'Boxer-puncher',
};

export default function FighterSheet({ fighter, eligible, onSign, onClose, lockedReason }: Props) {
  const { rec, label } = boardRecord(fighter);
  const neutral = rate(fighter);

  return (
    <div className="sheet-scrim" onClick={onClose} role="presentation">
      <div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${fighter.name} tale of the tape`}
      >
        <h2>{fighter.name}</h2>
        <p className="sub">
          {fighter.nick ? `“${fighter.nick}” · ` : ''}
          {fighter.country ? `${fighter.country} · ` : ''}
          {fighter.active[0]}–{fighter.active[1]}
        </p>

        <dl className="tape">
          <div>
            <dt>{label} record</dt>
            <dd>
              {recordLine(rec)}
              {asterisk(fighter)}
            </dd>
          </div>
          <div>
            <dt>KO wins</dt>
            <dd>
              {rec.ko} ({koPct(rec)}%)
            </dd>
          </div>
          <div>
            <dt>Height</dt>
            <dd>{inchesToFeet(fighter.ht)}</dd>
          </div>
          <div>
            <dt>Reach</dt>
            <dd>{fighter.reach}"</dd>
          </div>
          <div>
            <dt>Stance</dt>
            <dd>{STANCE_LABEL[fighter.stance] ?? fighter.stance}</dd>
          </div>
          <div>
            <dt>Style</dt>
            <dd>{STYLE_LABEL[fighter.style] ?? fighter.style}</dd>
          </div>
          <div>
            <dt>Titles</dt>
            <dd>
              {fighter.titleReigns} × {fighter.titleDefenses}d
            </dd>
          </div>
          <div>
            <dt>Rating</dt>
            <dd>{neutral.ovr}</dd>
          </div>
        </dl>

        <p className="footnote">
          {fighter.tierRank ? (
            <>
              <b>Rated #{fighter.tierRank}</b> in {fighter.tierSrc}. That ranking drives most of
              this fighter's {neutral.ovr} rating.
            </>
          ) : (
            <>
              <b>Rating is editorial.</b> This fighter isn't on the published ranking used
              elsewhere, so their quality grade is an uncited judgement call.
            </>
          )}
        </p>

        {fighter.confidence === 'low' && (
          <p className="footnote">
            <b>* Disputed record.</b> {fighter.note ?? 'Sources disagree on this ledger.'}
          </p>
        )}
        {fighter.confidence !== 'low' && fighter.note && <p className="footnote">{fighter.note}</p>}

        <p className="footnote">
          {fighter.src === 'model-recall' ? (
            <>
              <b>Unverified.</b> This record was written from an AI model's recall and has not been
              checked against a source. Treat it as approximate.
            </>
          ) : (
            <>
              <b>Source:</b> {fighter.src}, checked {fighter.verified}.
            </>
          )}
        </p>

        {onSign && eligible.length > 0 ? (
          <div className="sign-list">
            {eligible.map((slot) => {
              const ovrHere = rate(fighter, { slotWc: slot }).ovr;
              const off = ovrHere < neutral.ovr;
              return (
                <button key={slot} className="sign-btn" onClick={() => onSign(slot)}>
                  <span>SIGN → {weightClass(slot).name}</span>
                  <span className="delta">
                    OVR {ovrHere}
                    {off ? ' (off-division)' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="reason">
            {lockedReason ??
              (eligible.length === 0
                ? 'No open weight this fighter campaigned at.'
                : 'Unavailable.')}
          </p>
        )}

        <button className="sheet-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
