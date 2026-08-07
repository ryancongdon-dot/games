import { describe, it, expect } from 'vitest';
import {
  buildSpinTable,
  auditSlices,
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
  BOARD_MIN,
  BOARD_MIN_HARD,
  BOARD_MAX,
  SPIN_BUDGET,
  ERA_MAX_SPAN,
} from './draft';
import { FIGHTERS, fighterById } from '../data/fighters';
import { WEIGHT_CLASS_IDS } from '../data/divisions';

const TABLE = buildSpinTable();

describe('spin table', () => {
  it('never keeps a slice below the hard floor', () => {
    for (const s of TABLE) {
      expect(s.all.length, `${s.wc}/${s.anchor}`).toBeGreaterThanOrEqual(BOARD_MIN_HARD);
    }
  });

  it('gives every weight class somewhere to spin', () => {
    // OPEN_DIVISION_BIAS steers spins toward divisions you still need, so a
    // weight class with no surviving slice would make its slot unfillable.
    for (const wc of WEIGHT_CLASS_IDS) {
      const n = TABLE.filter((s) => s.wc === wc).length;
      expect(n, `${wc} has ${n} surviving slices`).toBeGreaterThanOrEqual(4);
    }
  });

  it('reports coverage without crashing on thin decades', () => {
    const all = auditSlices();
    const surviving = all.filter((s) => s.all.length >= BOARD_MIN_HARD);
    // Documented expectation: thin early decades are a data reality, not a bug.
    expect(surviving.length).toBeGreaterThan(all.length * 0.4);
  });

  it('only backfills across adjacent weights, never into eligibility', () => {
    for (const s of TABLE) {
      for (const f of s.backfill) {
        const campaigned = f.divisions.some((d) => d.wc === s.wc);
        // A backfilled fighter may appear on the board, but if they never
        // fought at this weight they must not be signable to it.
        if (!campaigned) {
          const state = newRun(1);
          expect(eligibleSlots(f, state)).not.toContain(s.wc);
        }
      }
    }
  });
});

describe('boards', () => {
  it('produces a board within size bounds on every spin', () => {
    for (let seed = 0; seed < 200; seed++) {
      const state = newRun(seed);
      const board = spin(state, TABLE);
      expect(board, `seed ${seed}`).not.toBeNull();
      expect(board!.fighterIds.length).toBeGreaterThan(0);
      expect(board!.fighterIds.length).toBeLessThanOrEqual(BOARD_MAX);
    }
  });

  it('has no duplicate fighters on a board', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = newRun(seed);
      const board = spin(state, TABLE)!;
      expect(new Set(board.fighterIds).size).toBe(board.fighterIds.length);
    }
  });

  it('never re-offers a fighter already signed', () => {
    const state = newRun(7);
    spin(state, TABLE);
    const first = state.board!.fighterIds[0]!;
    const slots = eligibleSlots(fighterById(first), state);
    if (slots.length > 0) {
      sign(state, first, slots[0]!);
      for (let i = 0; i < 8 && canSpin(state); i++) {
        spin(state, TABLE);
        expect(state.board!.fighterIds).not.toContain(first);
      }
    }
  });

  it('draws only fighters who belong to the slice window', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = newRun(seed);
      const board = spin(state, TABLE)!;
      const slice = TABLE.find(
        (s) => s.wc === board.wc && s.from === board.from && s.to === board.to,
      )!;
      const allowed = new Set(slice.all.map((f) => f.id));
      for (const id of board.fighterIds) expect(allowed.has(id)).toBe(true);
    }
  });
});

describe('spin budget', () => {
  it('allows passing while there is slack, and blocks at equality', () => {
    const state = newRun(3);
    // 12 spins, 8 slots: 4 discretionary passes before the budget binds.
    let passes = 0;
    while (canSpin(state)) {
      spin(state, TABLE);
      passes++;
      if (passes > SPIN_BUDGET + 2) break;
    }
    // 12 spins against 8 slots buys exactly 4 free passes.
    expect(passes).toBe(SPIN_BUDGET - openSlots(state).length);
    expect(mustSign(state)).toBe(true);
  });

  it('locks the spin exactly when spins left equals open slots', () => {
    const state = newRun(11);
    while (canSpin(state)) spin(state, TABLE);
    expect(spinsLeft(state)).toBe(openSlots(state).length);
  });

  it('always leaves a completable run', () => {
    // Greedy play — always sign the first eligible fighter — must finish.
    for (let seed = 0; seed < 300; seed++) {
      const state = newRun(seed);
      let guard = 0;
      while (!isComplete(state) && guard++ < 50) {
        if (!state.boardPicked && state.board) {
          const pick = state.board.fighterIds
            .map((id) => fighterById(id))
            .find((f) => eligibleSlots(f, state).length > 0);
          if (pick) {
            sign(state, pick.id, eligibleSlots(pick, state)[0]!);
            continue;
          }
        }
        if (!spin(state, TABLE)) break;
      }
      expect(isComplete(state), `seed ${seed} could not be completed`).toBe(true);
      expect(state.spinsUsed).toBeLessThanOrEqual(SPIN_BUDGET);
    }
  });

  it('refuses a second signing from the same board', () => {
    const state = newRun(5);
    spin(state, TABLE);
    const picks = state
      .board!.fighterIds.map((id) => fighterById(id))
      .filter((f) => eligibleSlots(f, state).length > 0);
    if (picks.length >= 2) {
      expect(sign(state, picks[0]!.id, eligibleSlots(picks[0]!, state)[0]!).ok).toBe(true);
      const second = sign(state, picks[1]!.id, eligibleSlots(picks[1]!, state)[0]!);
      expect(second.ok).toBe(false);
    }
  });
});

describe('eligibility', () => {
  it('only offers weights the fighter actually campaigned at', () => {
    const state = newRun(1);
    for (const f of FIGHTERS) {
      const campaigned = new Set(f.divisions.map((d) => d.wc));
      for (const slot of eligibleSlots(f, state)) {
        expect(campaigned.has(slot), `${f.id} offered ${slot}`).toBe(true);
      }
    }
  });

  it('offers multiple slots for multi-division fighters', () => {
    const state = newRun(1);
    const robinson = fighterById('robinson-sugar-ray');
    expect(eligibleSlots(robinson, state).sort()).toEqual(['middle', 'welter']);
  });

  it('refuses a signing at a weight the fighter never made', () => {
    const state = newRun(2);
    spin(state, TABLE);
    const id = state.board!.fighterIds[0]!;
    const f = fighterById(id);
    const bad = WEIGHT_CLASS_IDS.find((w) => !f.divisions.some((d) => d.wc === w))!;
    expect(sign(state, id, bad).ok).toBe(false);
  });

  it('refuses a fighter not on the current board', () => {
    const state = newRun(2);
    spin(state, TABLE);
    const off = FIGHTERS.find((f) => !state.board!.fighterIds.includes(f.id))!;
    expect(sign(state, off.id, off.divisions[0]!.wc).ok).toBe(false);
  });
});

describe('persistence', () => {
  it('round-trips a run', () => {
    const state = newRun(42);
    spin(state, TABLE);
    const pick = state
      .board!.fighterIds.map((id) => fighterById(id))
      .find((f) => eligibleSlots(f, state).length > 0);
    if (pick) sign(state, pick.id, eligibleSlots(pick, state)[0]!);

    const restored = restore(JSON.parse(JSON.stringify(serialize(state))))!;
    expect(restored.runSeed).toBe(state.runSeed);
    expect(restored.spinsUsed).toBe(state.spinsUsed);
    expect(restored.roster).toEqual(state.roster);
  });

  it('drops roster references to fighters no longer in the dataset', () => {
    const restored = restore({
      runSeed: 1,
      spinsUsed: 1,
      boardPicked: false,
      board: null,
      roster: { heavy: 'not-a-real-fighter' },
      spinLog: [],
    })!;
    expect(restored.roster.heavy).toBeUndefined();
  });

  it('returns null for junk', () => {
    expect(restore(null)).toBeNull();
    expect(restore(undefined)).toBeNull();
  });
});

describe('determinism', () => {
  it('replays an identical board sequence from the same seed', () => {
    const a = newRun(1234);
    const b = newRun(1234);
    for (let i = 0; i < 5; i++) {
      const ba = spin(a, TABLE);
      const bb = spin(b, TABLE);
      expect(ba).toEqual(bb);
    }
  });

  it('produces different sequences for different seeds', () => {
    const seqs = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const s = newRun(seed);
      const labels: string[] = [];
      for (let i = 0; i < 4; i++) labels.push(spin(s, TABLE)?.label ?? '');
      seqs.add(labels.join('|'));
    }
    expect(seqs.size).toBeGreaterThan(20);
  });

  it('never widens a window past the cap', () => {
    for (const s of TABLE) {
      expect(s.to - s.from + 1, `${s.wc}/${s.anchor} spans too many years`).toBeLessThanOrEqual(
        ERA_MAX_SPAN,
      );
    }
  });

  it('reaches BOARD_MIN on most slices', () => {
    const full = TABLE.filter((s) => s.all.length >= BOARD_MIN).length;
    expect(full / TABLE.length).toBeGreaterThanOrEqual(0.8);
  });

  it('puts a signable fighter on every board', () => {
    // The dead-end case: budget binds on a board with nobody you can sign.
    for (let seed = 0; seed < 300; seed++) {
      const state = newRun(seed);
      while (canSpin(state)) {
        const board = spin(state, TABLE)!;
        const signable = board.fighterIds
          .map((id) => fighterById(id))
          .some((f) => eligibleSlots(f, state).length > 0);
        expect(signable, `seed ${seed}: board ${board.label} has nobody signable`).toBe(true);
      }
    }
  });
});
