// league.js — the season model, shared by the alley hub (index.html) and the
// bowling game (lanes.html). Plain global `League` (also on window).
//
// A season = play each of 6 rival teams once. Each league night you bowl a full
// game; beat your opponent's score to win the night. The other teams' results
// are simulated so the standings board feels alive. Top of the table at season
// end = league champions. Winning earns money (for the future pro shop / quests).
const League = (() => {
  'use strict';
  const KEY = 'pinkings_save_v2';
  const PLAYER = 'Pin Kings';
  const OPPONENTS = ['Gutter Rats', 'Split Happens', 'Lane Wolves', 'Alley Cats', 'Strike Force', 'Pin Pals'];
  const WEEKS = OPPONENTS.length;

  // Pro Shop catalog. weight(lb) drives pin carry (mass); hook scales the curve.
  const BALLS = [
    { id: 'house',  name: 'House Ball',      weight: 12, hook: 1.00, price: 0,   color: 0x1b9be0, desc: 'The free rental. Middle-weight, dependable.' },
    { id: 'rookie', name: 'Rookie 8',        weight: 8,  hook: 0.90, price: 70,  color: 0x39d98a, desc: 'Light & easy to throw — but light on pin carry.' },
    { id: 'pro14',  name: 'Pro Line 14',     weight: 14, hook: 1.10, price: 190, color: 0xff7d4d, desc: 'League standard: heavier hit, a touch more hook.' },
    { id: 'hammer', name: 'The Hammer 16',   weight: 16, hook: 0.95, price: 360, color: 0xb84dff, desc: 'Max weight, max carry — but tough to curve.' },
    { id: 'hook',   name: 'Hook Monster 15', weight: 15, hook: 1.50, price: 470, color: 0xffd23f, desc: 'Reactive shell: huge hook & heavy hit. Wild.' },
  ];
  function ballById(id) { return BALLS.find((b) => b.id === id) || BALLS[0]; }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function fresh() {
    return {
      player: PLAYER,
      week: 1,
      money: 0,
      best: 0,
      schedule: shuffle(OPPONENTS.slice()),
      results: [],                                   // {week, you, opp, oppScore, win}
      standings: [PLAYER, ...OPPONENTS].map((name) => ({ name, w: 0, l: 0, pf: 0 })),
      activeNight: null,                             // {week, opp, oppScore}
      done: false,
      owned: ['house'],                              // Pro Shop: ball ids owned
      equipped: 'house',                             // ...and the one in hand
    };
  }

  let save = null;
  function load() {
    if (save) return save;
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.schedule) save = s; } catch (e) { /* ignore */ }
    if (!save) save = fresh();
    if (!save.owned) { save.owned = ['house']; save.equipped = 'house'; }   // migrate older saves
    return save;
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
  function startSeason() { save = fresh(); persist(); return save; }

  function find(name) { return load().standings.find((t) => t.name === name); }
  function standings() {
    return load().standings.slice().sort((a, b) => b.w - a.w || b.pf - a.pf || a.name.localeCompare(b.name));
  }
  function rank() { return standings().findIndex((t) => t.name === load().player) + 1; }

  function currentOpp() { const s = load(); return s.done ? null : s.schedule[s.week - 1]; }
  function oppTarget(week) {
    const avg = lerp(125, 165, (week - 1) / Math.max(1, WEEKS - 1));   // tougher later
    return clamp(Math.round(avg + ri(-22, 22)), 90, 235);
  }

  // ---- simulate a full opponent game (10 frames of real rolls) ----
  function scoreGame(frames) {
    const flat = [];
    frames.forEach((rolls, idx) => rolls.forEach((r) => flat.push({ r, idx })));
    let running = 0;
    const cum = [];
    for (let i = 0; i < 10; i++) {
      const start = flat.findIndex((x) => x.idx === i);
      const r0 = start >= 0 ? flat[start].r : 0;
      if (i < 9) {
        if (r0 === 10) running += 10 + (flat[start + 1] ? flat[start + 1].r : 0) + (flat[start + 2] ? flat[start + 2].r : 0);
        else {
          const r1 = flat[start + 1] ? flat[start + 1].r : 0;
          if (r0 + r1 === 10) running += 10 + (flat[start + 2] ? flat[start + 2].r : 0);
          else running += r0 + r1;
        }
      } else running += frames[9].reduce((a, b) => a + b, 0);
      cum.push(running);
    }
    return cum;
  }
  function simFrames(skill) {
    const strikeP = 0.10 + skill * 0.30;
    const spareP = 0.28 + skill * 0.25;
    const frames = [];
    const firstRoll = () => (Math.random() < strikeP ? 10 : ri(3, 9));
    const secondRoll = (first) => (Math.random() < spareP ? 10 - first : ri(0, Math.max(0, 9 - first)));
    for (let f = 0; f < 9; f++) {
      const a = firstRoll();
      frames.push(a === 10 ? [10] : [a, secondRoll(a)]);
    }
    const tenth = [];
    let a = firstRoll(); tenth.push(a);
    if (a === 10) { const b = firstRoll(); tenth.push(b); tenth.push(b === 10 ? firstRoll() : secondRoll(b)); }
    else { const b = secondRoll(a); tenth.push(b); if (a + b === 10) tenth.push(firstRoll()); }
    frames.push(tenth);
    return frames;
  }
  // pick the simulated game closest to the week's target, so difficulty ramps
  function simOpponentGame(week) {
    const target = oppTarget(week);
    const skill = (week - 1) / Math.max(1, WEEKS - 1);
    let best = null, bestD = 1e9;
    for (let i = 0; i < 18; i++) {
      const frames = simFrames(skill);
      const cum = scoreGame(frames);
      const d = Math.abs(cum[9] - target);
      if (d < bestD) { bestD = d; best = { frames, cum }; }
    }
    return best;
  }

  // call before launching a league night; locks this week's opponent and
  // pre-simulates their full game so it can be revealed frame-by-frame.
  function beginNight() {
    const s = load();
    if (s.done) return null;
    if (!s.activeNight) {
      const sim = simOpponentGame(s.week);
      s.activeNight = { week: s.week, opp: currentOpp(), oppScore: sim.cum[9], oppFrames: sim.frames, oppCum: sim.cum };
      persist();
    } else if (!s.activeNight.oppCum) {
      // migrate an older locked night (fixed score, no frames)
      const sim = simOpponentGame(s.activeNight.week);
      s.activeNight.oppFrames = sim.frames; s.activeNight.oppCum = sim.cum; s.activeNight.oppScore = sim.cum[9];
      persist();
    }
    return s.activeNight;
  }
  function hasActiveNight() { return !!load().activeNight; }
  function activeNight() { return load().activeNight; }

  // call when a league-night game ends; records the result and advances the season
  function recordNight(playerScore) {
    const s = load();
    const n = s.activeNight;
    if (!n) return null;
    const win = playerScore >= n.oppScore;          // ties go to the player
    const ps = find(s.player), os = find(n.opp);
    ps.pf += playerScore; if (win) ps.w++; else ps.l++;
    os.pf += n.oppScore; if (win) os.l++; else os.w++;
    // simulate the rest of the league this week
    for (const t of s.standings) {
      if (t.name === s.player || t.name === n.opp) continue;
      if (Math.random() < 0.5) t.w++; else t.l++;
      t.pf += ri(120, 185);
    }
    s.results.push({ week: n.week, you: playerScore, opp: n.opp, oppScore: n.oppScore, win });
    s.money += win ? 80 : 35;            // bowling is the main income
    s.best = Math.max(s.best || 0, playerScore);
    s.activeNight = null;
    s.week++;
    if (s.week > WEEKS) s.done = true;
    persist();
    return { win, you: playerScore, oppScore: n.oppScore, opp: n.opp, done: s.done, rank: rank(), money: s.money };
  }

  function addMoney(n) { load().money += n; persist(); }

  // ---- Pro Shop ----
  function ballCatalog() { return BALLS.slice(); }
  function owned() { return load().owned.slice(); }
  function isOwned(id) { return load().owned.indexOf(id) >= 0; }
  function equippedId() { return load().equipped; }
  function equippedBall() { return ballById(load().equipped); }
  function buyBall(id) {
    const s = load(); const b = ballById(id);
    if (isOwned(id)) return { ok: false, reason: 'owned' };
    if (s.money < b.price) return { ok: false, reason: 'money' };
    s.money -= b.price; s.owned.push(id); s.equipped = id; persist();
    return { ok: true };
  }
  function equipBall(id) { const s = load(); if (isOwned(id)) { s.equipped = id; persist(); return true; } return false; }

  return {
    load, startSeason, standings, rank, currentOpp, beginNight, hasActiveNight, activeNight, recordNight, addMoney,
    ballCatalog, owned, isOwned, equippedId, equippedBall, buyBall, equipBall,
    get money() { return load().money; },
    get week() { return load().week; },
    get weeks() { return WEEKS; },
    get done() { return load().done; },
    get player() { return load().player; },
    get best() { return load().best; },
    get lastResult() { const r = load().results; return r.length ? r[r.length - 1] : null; },
  };
})();
if (typeof window !== 'undefined') window.League = League;
