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
    };
  }

  let save = null;
  function load() {
    if (save) return save;
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.schedule) save = s; } catch (e) { /* ignore */ }
    if (!save) save = fresh();
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

  // call before launching a league night; locks this week's opponent + their score
  function beginNight() {
    const s = load();
    if (s.done) return null;
    if (!s.activeNight) { s.activeNight = { week: s.week, opp: currentOpp(), oppScore: oppTarget(s.week) }; persist(); }
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
    s.money += win ? 60 : 25;
    s.best = Math.max(s.best || 0, playerScore);
    s.activeNight = null;
    s.week++;
    if (s.week > WEEKS) s.done = true;
    persist();
    return { win, you: playerScore, oppScore: n.oppScore, opp: n.opp, done: s.done, rank: rank(), money: s.money };
  }

  function addMoney(n) { load().money += n; persist(); }

  return {
    load, startSeason, standings, rank, currentOpp, beginNight, hasActiveNight, activeNight, recordNight, addMoney,
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
