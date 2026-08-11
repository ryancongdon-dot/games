import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Fighter, WeightClassId } from './data/types';
import { WEIGHT_CLASSES, weightClass } from './data/divisions';
import { FIGHTERS, fighterById } from './data/fighters';
import {
  buildSpinTable,
  newRun,
  spin,
  sign,
  canSpin,
  mustSign,
  openSlots,
  isComplete,
  eligibleSlots,
  serialize,
  restore,
  spinsLeft,
  SPIN_BUDGET,
  type DraftState,
} from './engine/draft';
import { simSeason, type SeasonResult, type RosterEntry } from './engine/sim';
import Board from './ui/Board';
import FighterSheet from './ui/FighterSheet';
import Results from './ui/Results';

const SAVE_KEY = 'stablegm.save.v1';
const TABLE = buildSpinTable();

type Screen = 'title' | 'draft' | 'results';
type Tab = 'board' | 'eligible' | 'stable';

interface Best {
  score: number;
  record: string;
  belts: number;
}

interface Save {
  run?: ReturnType<typeof serialize> | null;
  best?: Best | null;
}

function loadSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as Save) : {};
  } catch {
    return {};
  }
}

function persist(save: Save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* storage unavailable (private mode, quota) — the run just won't resume */
  }
}

function rosterEntries(state: DraftState): RosterEntry[] {
  return WEIGHT_CLASSES.filter((w) => state.roster[w.id]).map((w) => ({
    slotWc: w.id,
    fighter: fighterById(state.roster[w.id]!),
  }));
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('title');
  const [state, setState] = useState<DraftState>(() => newRun());
  const [tab, setTab] = useState<Tab>('board');
  const [sheet, setSheet] = useState<Fighter | null>(null);
  const [filterSlot, setFilterSlot] = useState<WeightClassId | null>(null);
  const [season, setSeason] = useState<SeasonResult | null>(null);
  const [best, setBest] = useState<Best | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resumable, setResumable] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  // Load save once on mount.
  useEffect(() => {
    const save = loadSave();
    if (save.best) setBest(save.best);
    const restored = restore(save.run);
    if (restored && (restored.spinsUsed > 0 || Object.keys(restored.roster).length > 0)) {
      setState(restored);
      setResumable(true);
    }
  }, []);

  // Persist the in-progress run — mobile tabs get evicted mid-draft.
  useEffect(() => {
    if (screen === 'draft') persist({ run: serialize(state), best });
  }, [state, screen, best]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const boardFighters = useMemo(
    () => (state.board ? state.board.fighterIds.map((id) => fighterById(id)) : []),
    [state.board],
  );

  const eligibility = useMemo(() => {
    const m = new Map<string, WeightClassId[]>();
    for (const f of boardFighters) m.set(f.id, eligibleSlots(f, state));
    return m;
  }, [boardFighters, state]);

  const signedIds = useMemo(
    () => new Set(Object.values(state.roster).filter(Boolean) as string[]),
    [state.roster],
  );

  const open = openSlots(state);
  const complete = isComplete(state);
  const left = spinsLeft(state);
  const locked = mustSign(state);

  const doSpin = () => {
    setState((prev) => {
      const next: DraftState = { ...prev, roster: { ...prev.roster }, spinLog: [...prev.spinLog] };
      if (!spin(next, TABLE)) return prev;
      return next;
    });
    setFilterSlot(null);
    setTab('board');
  };

  const doSign = (fighter: Fighter, slot: WeightClassId) => {
    setState((prev) => {
      const next: DraftState = { ...prev, roster: { ...prev.roster }, spinLog: [...prev.spinLog] };
      const res = sign(next, fighter.id, slot);
      if (!res.ok) {
        showToast(res.reason);
        return prev;
      }
      return next;
    });
    setSheet(null);
    setFilterSlot(null);
    showToast(`${fighter.name} → ${weightClass(slot).name}`);
  };

  const startRun = (resume: boolean) => {
    if (!resume) {
      setState(newRun());
      setResumable(false);
    }
    setScreen('draft');
    setTab('board');
    setFilterSlot(null);
  };

  const runSim = () => {
    const result = simSeason(rosterEntries(state), FIGHTERS);
    setSeason(result);
    setScreen('results');

    const record = `${result.w}-${result.l}${result.d > 0 ? `-${result.d}` : ''}`;
    setBest((prev) => {
      const next =
        prev && prev.score >= result.score
          ? prev
          : { score: result.score, record, belts: result.belts };
      persist({ run: null, best: next });
      return next;
    });
  };

  const copyResult = async () => {
    if (!season) return;
    const lines = [
      'STABLE GM 🥊',
      `${season.w}-${season.l}${season.d > 0 ? `-${season.d}` : ''} · ${season.ko} KO · ${season.belts} 🏆`,
      `Grade ${season.grade} · ${season.score} pts`,
      '',
      ...season.fighters.map(
        (f) =>
          `${weightClass(f.slotWc).short.padEnd(6)} ${f.fighter.name} ${f.w}-${f.l}${
            f.d > 0 ? `-${f.d}` : ''
          }${f.belt ? ' 🏆' : ''}`,
      ),
    ];
    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Result copied');
    } catch {
      showToast('Copy failed — select and copy manually');
    }
  };

  // ---------------------------------------------------------------- title --

  if (screen === 'title') {
    return (
      <div className="app">
        <div className="title-screen">
          <h1>
            STABLE
            <br />
            GM
          </h1>
          <p className="tagline">Draft eight real fighters. Simulate a year. Count the belts.</p>

          <ul className="how">
            <li>
              <b>Spin</b> a division and an era — every fighter who campaigned there becomes your
              board.
            </li>
            <li>
              <b>Sign</b> one of them into an open weight class. They can only fill a weight they
              actually fought at.
            </li>
            <li>
              <b>{SPIN_BUDGET} spins, 8 weights.</b> You may pass on a board, but only while you
              have spins to spare.
            </li>
            <li>
              <b>Simulate</b> a year of four bouts each, and see what your stable is worth.
            </li>
          </ul>

          {best && (
            <p className="best-line">
              Personal best: <b>{best.score}</b> ({best.record}, {best.belts} 🏆)
            </p>
          )}

          <button className="btn primary" onClick={() => startRun(false)}>
            {resumable ? 'NEW RUN' : 'START DRAFTING'}
          </button>
          {resumable && (
            <button className="btn ghost" onClick={() => startRun(true)}>
              Resume run ({state.spinsUsed}/{SPIN_BUDGET} spins used)
            </button>
          )}

          <p className="disclaimer">
            Every fighter record here has been checked against a source, cited on the fighter's card.
            Ledgers from before about 1925 are genuinely disputed even between real sources and are
            marked with an asterisk. Ratings and the bout simulation are judgement, not history.
          </p>
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  // -------------------------------------------------------------- results --

  if (screen === 'results' && season) {
    return (
      <div className="app">
        <Results
          season={season}
          best={best}
          onNewRun={() => {
            setState(newRun());
            setSeason(null);
            setResumable(false);
            setScreen('draft');
            setTab('board');
          }}
          onCopy={copyResult}
        />
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  // ---------------------------------------------------------------- draft --

  const tabFighters =
    tab === 'stable'
      ? (Object.values(state.roster).filter(Boolean) as string[]).map((id) => fighterById(id))
      : tab === 'eligible'
        ? boardFighters.filter((f) => (eligibility.get(f.id) ?? []).length > 0)
        : boardFighters;

  const emptyMessage =
    tab === 'stable'
      ? 'No fighters signed yet.'
      : tab === 'eligible'
        ? 'Nobody on this board fits an open weight. Spin again.'
        : 'Spin to draw a board.';

  return (
    <div className="app">
      <div className="board-head">
        <div className="who">
          <div className="eyebrow">{state.board ? 'Current board' : 'Ready'}</div>
          <h1 className="board-title">
            {state.board ? state.board.label : 'Spin to begin'}
          </h1>
          <div className="chips">
            {state.board && <span className="chip">{state.board.eraLabel}</span>}
            {state.board && (
              <span className="chip muted">{state.board.fighterIds.length} fighters</span>
            )}
            <span className="chip muted">
              {open.length} weight{open.length === 1 ? '' : 's'} open
            </span>
          </div>
        </div>

        {complete ? (
          <button className="spin-btn" onClick={runSim}>
            SIMULATE ⟶
          </button>
        ) : (
          <button className="spin-btn" onClick={doSpin} disabled={!canSpin(state)}>
            {locked ? 'MUST SIGN' : state.board ? 'SPIN' : 'SPIN'}
          </button>
        )}
      </div>

      <div className={`spinbar${locked ? ' warn' : ''}`}>
        <div className="spinbar-top">
          <span>
            SPINS {state.spinsUsed} / {SPIN_BUDGET}
          </span>
          <span>
            {locked
              ? 'No spins to spare — sign from this board'
              : complete
                ? 'Stable complete'
                : `${left} left · ${open.length} to fill`}
          </span>
        </div>
        <div className="pips">
          {Array.from({ length: SPIN_BUDGET }, (_, i) => (
            <span
              key={i}
              className={`pip${i < state.spinsUsed - 1 ? ' used' : i === state.spinsUsed - 1 ? ' current' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="main-grid">
        <div>
          <div className="tabs">
            {(
              [
                ['board', 'BOARD'],
                ['eligible', 'ELIGIBLE'],
                ['stable', `MY STABLE ${8 - open.length}/8`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={`tab${tab === k ? ' on' : ''}`}
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
              >
                {label}
              </button>
            ))}
          </div>

          {complete && (
            <p className="empty">
              Every weight is filled. Hit <b>SIMULATE</b> to run the year.
            </p>
          )}

          <Board
            fighters={tabFighters}
            eligibility={tab === 'stable' ? new Map() : eligibility}
            signedIds={signedIds}
            filterSlot={tab === 'stable' ? null : filterSlot}
            onOpen={setSheet}
            emptyMessage={emptyMessage}
          />
        </div>

        <div className="roster" aria-label="Your stable">
          {WEIGHT_CLASSES.map((w) => {
            const id = state.roster[w.id];
            const f = id ? fighterById(id) : null;
            return (
              <button
                key={w.id}
                className={`slot ${f ? 'filled' : 'open'}${filterSlot === w.id ? ' active' : ''}`}
                onClick={() => {
                  if (f) setSheet(f);
                  else {
                    setFilterSlot((cur) => (cur === w.id ? null : w.id));
                    setTab('board');
                  }
                }}
              >
                <div className="slot-name">{w.short}</div>
                <div className="slot-val">{f ? f.name.split(' ').slice(-1)[0] : 'Open'}</div>
              </button>
            );
          })}
        </div>
      </div>

      {sheet && (
        <FighterSheet
          fighter={sheet}
          eligible={eligibility.get(sheet.id) ?? []}
          onSign={
            state.boardPicked || signedIds.has(sheet.id) || tab === 'stable'
              ? null
              : (slot) => doSign(sheet, slot)
          }
          lockedReason={
            signedIds.has(sheet.id)
              ? 'Already in your stable.'
              : state.boardPicked
                ? 'You have already signed from this board. Spin again.'
                : undefined
          }
          onClose={() => setSheet(null)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
