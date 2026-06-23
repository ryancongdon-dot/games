// game.js — Pin Kings: state machine, the power/curve/spin shot, scoring & UI.
// Drives the 3D `Scene`. Loaded after scene3d.js.
//
// THE SHOT (the heart of the game): four quick beats —
//   1) AIM   — slide your start spot left/right
//   2) POWER — lock the moving bar (how hard you throw)
//   3) CURVE — lock the bar (which way & how much it hooks: left<->right)
//   4) SPIN  — lock the bar (rev rate; amplifies the back-end hook + pin action)
// Then the ball rolls with real physics.
(() => {
  'use strict';

  // ---------- tuning ----------
  const FRAMES = 10;
  const METER_SPEED = { power: 1.7, curve: 1.45, spin: 1.9 }; // oscillations/sec-ish
  const SAVE_KEY = 'pinkings_v1';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (id) => document.getElementById(id);

  // ---------- game state ----------
  const G = {
    phase: 'title',     // title | aim | power | curve | spin | rolling | resolve | gameover
    frame: 0,           // 0..9
    ball: 1,            // ball number within frame (1 or 2; 3 only in 10th)
    aim: 0,             // lateral start, -1..1 (lane fraction)
    power: 0, curve: 0, spin: 0,   // locked shot values
    meterT: 0,          // oscillator phase 0..1 (ping-pong)
    standing: null,     // 10 booleans, true = pin still up (null = fresh rack)
    frames: [],         // scoring: each = { rolls: [..], score: null }
    pinsThisFrameStart: 10,
    league: loadLeague(),
  };

  // ---------- DOM refs ----------
  let el = {};
  function cacheEl() {
    el = {
      sheet: $('scoresheet'),
      total: $('total'),
      frameLabel: $('frame-label'),
      ballLabel: $('ball-label'),
      phaseHint: $('phase-hint'),
      meterWrap: $('meter-wrap'),
      meterFill: $('meter-fill'),
      meterTick: $('meter-tick'),
      meterLabel: $('meter-label'),
      meterCenter: $('meter-center'),
      shotReadout: $('shot-readout'),
      roPower: $('ro-power'),
      roCurve: $('ro-curve'),
      roSpin: $('ro-spin'),
      action: $('btn-action'),
      toast: $('toast'),
      title: $('overlay-title'),
      results: $('overlay-results'),
      resultBody: $('result-body'),
      leagueLine: $('league-line'),
    };
  }

  // ---------- league (light meta layer; the season wrapper) ----------
  function loadLeague() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s.week === 'number') return s;
    } catch (e) { /* ignore */ }
    return { week: 1, wins: 0, losses: 0, best: 0 };
  }
  function saveLeague() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.league)); } catch (e) { /* ignore */ }
  }

  // ---------- scoring ----------
  function freshFrames() {
    G.frames = [];
    for (let i = 0; i < FRAMES; i++) G.frames.push({ rolls: [], score: null });
  }

  function recordRoll(pinsDown) {
    G.frames[G.frame].rolls.push(pinsDown);
  }

  // Standard 10-pin cumulative scoring.
  function computeScores() {
    const f = G.frames;
    let running = 0;
    // flat list of every roll tagged with its frame, for strike/spare lookahead
    const flat = [];
    f.forEach((fr, idx) => fr.rolls.forEach((r) => flat.push({ r, idx })));

    for (let i = 0; i < FRAMES; i++) {
      const fr = f[i];
      if (fr.rolls.length === 0) { fr.score = null; continue; }
      // find start index of this frame in flat
      let start = flat.findIndex((x) => x.idx === i);
      if (start < 0) { fr.score = null; continue; }
      const r0 = flat[start] ? flat[start].r : 0;

      if (i < 9) {
        if (r0 === 10) {
          // strike: 10 + next two rolls
          const b1 = flat[start + 1] ? flat[start + 1].r : null;
          const b2 = flat[start + 2] ? flat[start + 2].r : null;
          if (b1 == null || b2 == null) { fr.score = null; }
          else running += 10 + b1 + b2, fr.score = running;
        } else {
          const r1 = flat[start + 1] ? flat[start + 1].r : null;
          if (r1 == null) { fr.score = null; }
          else if (r0 + r1 === 10) {
            // spare: 10 + next one
            const b1 = flat[start + 2] ? flat[start + 2].r : null;
            if (b1 == null) { fr.score = null; }
            else running += 10 + b1, fr.score = running;
          } else {
            running += r0 + r1; fr.score = running;
          }
        }
      } else {
        // 10th frame: sum its (up to 3) rolls when complete
        const need = (fr.rolls[0] === 10 || (fr.rolls[0] + (fr.rolls[1] || 0) === 10)) ? 3 : 2;
        if (fr.rolls.length >= need) {
          running += fr.rolls.reduce((a, b) => a + b, 0);
          fr.score = running;
        } else fr.score = null;
      }
    }
    return running;
  }

  function gameTotal() {
    let last = 0;
    for (const fr of G.frames) if (fr.score != null) last = fr.score;
    return last;
  }

  // ---------- rendering the scoresheet ----------
  function renderSheet() {
    if (!el.sheet) return;
    let html = '';
    for (let i = 0; i < FRAMES; i++) {
      const fr = G.frames[i];
      const cur = (i === G.frame && G.phase !== 'gameover');
      html += `<div class="fr${cur ? ' cur' : ''}">`;
      html += `<div class="fr-no">${i + 1}</div>`;
      html += `<div class="fr-rolls">${rollMarks(fr, i)}</div>`;
      html += `<div class="fr-score">${fr.score != null ? fr.score : ''}</div>`;
      html += `</div>`;
    }
    el.sheet.innerHTML = html;
    if (el.total) el.total.textContent = gameTotal();
  }

  function rollMarks(fr, frameIdx) {
    const cells = [];
    const max = frameIdx === 9 ? 3 : 2;
    for (let j = 0; j < max; j++) {
      const v = fr.rolls[j];
      if (v == null) { cells.push('<span class="rc"></span>'); continue; }
      const prev = j > 0 ? fr.rolls[j - 1] : null;
      let m;
      if (v === 10) m = 'X';
      else if (prev != null && prev !== 10 && prev + v === 10) m = '/';
      else if (v === 0) m = '–';
      else m = String(v);
      cells.push(`<span class="rc">${m}</span>`);
    }
    return cells.join('');
  }

  // ---------- UI helpers ----------
  let toastTimer = null;
  function toast(msg, ms = 1400) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), ms);
  }

  function setActionLabel(txt) { if (el.action) el.action.textContent = txt; }

  function showMeter(kind) {
    el.meterWrap.classList.remove('hidden', 'bidir');
    el.meterCenter.classList.add('hidden');
    if (kind === 'curve') {
      el.meterWrap.classList.add('bidir');
      el.meterCenter.classList.remove('hidden');
      el.meterLabel.textContent = 'CURVE  ◀ hook ▶';
    } else if (kind === 'power') {
      el.meterLabel.textContent = 'POWER';
    } else {
      el.meterLabel.textContent = 'SPIN';
    }
  }
  function hideMeter() { el.meterWrap.classList.add('hidden'); }

  // ---------- phase flow ----------
  function startTurn() {
    // figure standing pins for this ball
    if (G.ball === 1) {
      G.standing = [true, true, true, true, true, true, true, true, true, true];
      Scene.setRack(null);
    } else {
      Scene.setRack(G.standing.slice());
    }
    G.aim = 0; G.power = 0; G.curve = 0; G.spin = 0;
    Scene.placeBall(aimToWorld(G.aim));
    setPhase('aim');
    updateLabels();
  }

  function aimToWorld(aim) { return aim * (Scene.LANE_HW - 0.12); }

  function setPhase(p) {
    G.phase = p;
    G.meterT = 0; G._dir = 1;
    el.action.disabled = (p === 'rolling');   // only the roll locks the button
    el.shotReadout.classList.toggle('hidden', !(p === 'aim' || p === 'power' || p === 'curve' || p === 'spin'));
    if (p === 'aim') {
      hideMeter();
      el.phaseHint.textContent = 'AIM — ◀ ▶ to move your start, then LOCK';
      setActionLabel('LOCK AIM');
      Scene.setAim(aimToWorld(G.aim), 0);
    } else if (p === 'power') {
      showMeter('power'); el.phaseHint.textContent = 'POWER — LOCK on the bar';
      setActionLabel('LOCK POWER');
    } else if (p === 'curve') {
      showMeter('curve'); el.phaseHint.textContent = 'CURVE — LOCK to set hook side & amount';
      setActionLabel('LOCK CURVE');
    } else if (p === 'spin') {
      showMeter('spin'); el.phaseHint.textContent = 'SPIN — LOCK to throw!';
      setActionLabel('THROW');
    } else if (p === 'rolling') {
      hideMeter(); el.phaseHint.textContent = '…';
      setActionLabel('ROLLING…'); el.action.disabled = true;
    }
    renderReadout();
  }

  function renderReadout() {
    el.roPower.textContent = Math.round(G.power * 100);
    const c = Math.round(G.curve * 100);
    el.roCurve.textContent = (c > 0 ? '▶' + c : c < 0 ? '◀' + (-c) : '0');
    el.roSpin.textContent = Math.round(G.spin * 100);
  }

  function updateLabels() {
    el.frameLabel.textContent = 'Frame ' + (G.frame + 1);
    el.ballLabel.textContent = 'Ball ' + G.ball;
    el.leagueLine.textContent = `Week ${G.league.week} · ${G.league.wins}–${G.league.losses}`;
  }

  // primary action — advances the shot beats
  function action() {
    if (G.phase === 'aim') { setPhase('power'); }
    else if (G.phase === 'power') { G.power = meterValue(); setPhase('curve'); }
    else if (G.phase === 'curve') { G.curve = meterValueBidir(); setPhase('spin'); }
    else if (G.phase === 'spin') { G.spin = meterValue(); throwBall(); }
  }

  function meterValue() {
    // ping-pong 0..1 -> reads current fill
    return clamp(G.meterT, 0, 1);
  }
  function meterValueBidir() {
    // map 0..1 ping-pong to -1..1
    return clamp(G.meterT * 2 - 1, -1, 1);
  }

  function throwBall() {
    setPhase('rolling');
    Scene.roll({ power: G.power, curve: G.curve, spin: G.spin });
  }

  // called by Scene when the ball + pins settle
  function onSettled(res) {
    el.action.disabled = false;
    // how many pins fell THIS ball
    let downNow = 0;
    const newStanding = G.standing.slice();
    for (const idx of res.down) {
      if (newStanding[idx]) { newStanding[idx] = false; downNow++; }
    }
    G.standing = newStanding;
    recordRoll(downNow);
    computeScores();
    renderSheet();

    const remaining = G.standing.filter(Boolean).length;
    if (res.gutter && downNow === 0) toast('Gutter ball 😬');
    else if (G.ball === 1 && downNow === 10) toast('STRIKE! 🎳', 1600);
    else if (G.ball >= 2 && remaining === 0 && !isTenthExtra()) toast('SPARE! ✊', 1500);
    else if (downNow === 0) toast('No pins.');
    else toast(downNow + (downNow === 1 ? ' pin' : ' pins'));

    setTimeout(advanceAfterRoll, 1100);
  }

  function isTenthExtra() { return G.frame === 9 && G.ball >= 2; }

  function advanceAfterRoll() {
    const fr = G.frames[G.frame];
    const remaining = G.standing.filter(Boolean).length;

    if (G.frame < 9) {
      const strike = (G.ball === 1 && remaining === 0);
      if (strike || G.ball === 2) { nextFrame(); }
      else { G.ball = 2; startTurn(); }
      return;
    }

    // 10th frame: up to 3 balls, bonus on strike/spare
    const r = fr.rolls;
    const firstTwo = (r[0] || 0) + (r[1] || 0);
    const earnedBonus = r[0] === 10 || firstTwo === 10;
    if (G.ball === 1) {
      if (r[0] === 10) { G.standing = [true, true, true, true, true, true, true, true, true, true]; }
      G.ball = 2; startTurn(); return;
    }
    if (G.ball === 2) {
      if (earnedBonus) {
        // fresh rack if both down (strike+strike) or spare
        if (r[0] === 10 && r[1] === 10) G.standing = new Array(10).fill(true);
        else if (firstTwo === 10) G.standing = new Array(10).fill(true);
        G.ball = 3; startTurn(); return;
      }
      endGame(); return;
    }
    endGame();
  }

  function nextFrame() {
    G.frame++;
    G.ball = 1;
    if (G.frame >= FRAMES) { endGame(); return; }
    startTurn();
  }

  function endGame() {
    G.phase = 'gameover';
    hideMeter();
    el.shotReadout.classList.add('hidden');
    const total = gameTotal();
    // simple league: beat 140 = win the night, else loss; advance a week
    const won = total >= 140;
    if (won) G.league.wins++; else G.league.losses++;
    if (total > (G.league.best || 0)) G.league.best = total;
    G.league.week++;
    saveLeague();
    updateLabels();

    el.resultBody.innerHTML =
      `<div class="big-score">${total}</div>` +
      `<p>${won ? 'You won the league night! 🏆' : 'Tough night — the team dropped this one.'}</p>` +
      `<p class="fine">Personal best: ${G.league.best} · Record ${G.league.wins}–${G.league.losses}` +
      ` · Next: Week ${G.league.week}</p>`;
    el.results.classList.remove('hidden');
    renderSheet();
  }

  function newGame() {
    G.frame = 0; G.ball = 1; G.phase = 'aim';
    freshFrames();
    el.title.classList.add('hidden');
    el.results.classList.add('hidden');
    startTurn();
    renderSheet();
  }

  // ---------- input ----------
  function bindInput() {
    el.action.addEventListener('click', () => { if (!el.action.disabled) action(); });
    $('btn-play').addEventListener('click', newGame);
    $('btn-again').addEventListener('click', newGame);
    $('btn-left').addEventListener('click', () => nudgeAim(-1));
    $('btn-right').addEventListener('click', () => nudgeAim(1));

    window.addEventListener('keydown', (e) => {
      if (e.repeat && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.key === 'ArrowLeft') { nudgeAim(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { nudgeAim(1); e.preventDefault(); }
      else if (e.key === ' ' || e.key === 'Enter') {
        if (G.phase === 'title') newGame();
        else if (G.phase === 'gameover') newGame();
        else if (!el.action.disabled) action();
        e.preventDefault();
      }
    });
  }

  function nudgeAim(dir) {
    if (G.phase !== 'aim') return;
    G.aim = clamp(G.aim + dir * 0.06, -1, 1);
    Scene.placeBall(aimToWorld(G.aim));
    Scene.setAim(aimToWorld(G.aim), 0);
  }

  // ---------- meter oscillation (drives the moving bar) ----------
  let lastT = 0;
  function tickMeter(now) {
    requestAnimationFrame(tickMeter);
    const dt = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;
    if (G.phase === 'power' || G.phase === 'curve' || G.phase === 'spin') {
      const sp = METER_SPEED[G.phase];
      G.meterT += (G._dir || 1) * sp * dt;
      if (G.meterT >= 1) { G.meterT = 1; G._dir = -1; }
      else if (G.meterT <= 0) { G.meterT = 0; G._dir = 1; }
      paintMeter();
      // live preview of curve on the lane
      if (G.phase === 'curve') Scene.setAim(aimToWorld(G.aim), meterValueBidir() * 1.2);
    }
  }

  function paintMeter() {
    const pct = Math.round(G.meterT * 100);
    if (G.phase === 'curve') {
      // bidirectional: fill grows from center
      const v = meterValueBidir(); // -1..1
      const half = Math.abs(v) * 50;
      el.meterFill.style.left = v < 0 ? (50 - half) + '%' : '50%';
      el.meterFill.style.width = half + '%';
    } else {
      el.meterFill.style.left = '0%';
      el.meterFill.style.width = pct + '%';
    }
  }

  // ---------- boot ----------
  function boot() {
    cacheEl();
    Scene.init($('game'));
    Scene.onSettled = onSettled;
    bindInput();
    freshFrames();
    renderSheet();
    updateLabels();
    requestAnimationFrame(tickMeter);
    // show title; league line on title too
    $('title-league').textContent =
      `League · Week ${G.league.week} · Record ${G.league.wins}–${G.league.losses}` +
      (G.league.best ? ` · Best ${G.league.best}` : '');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
