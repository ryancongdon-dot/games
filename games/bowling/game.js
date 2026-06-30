// game.js — Pin Kings: state machine, the power/curve/spin shot, scoring & UI.
// Drives the 3D `Scene`. Loaded after scene3d.js.
//
// THE SHOT (the heart of the game): you DELIBERATELY dial in your shot, then
// throw. Adjust AIM (where you stand), POWER, CURVE (hook side & amount) and
// SPIN (rev rate; amplifies the back-end hook) with the sliders. A live line on
// the lane previews exactly where the ball will go — then hit THROW.
(() => {
  'use strict';

  // ---------- tuning ----------
  const FRAMES = 10;
  const AIM_STEP = 0.04;        // keyboard aim nudge per press
  const L = (typeof window !== 'undefined' && window.League) ? window.League : null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (id) => document.getElementById(id);

  // ---------- game state ----------
  const G = {
    phase: 'title',     // title | setup | rolling | gameover
    frame: 0,           // 0..9
    ball: 1,            // ball number within frame (1 or 2; 3 only in 10th)
    aim: 0,             // lateral start, -1..1 (lane fraction)
    power: 0.7,         // 0..1
    curve: 0,           // -1..1  (negative = hook left, positive = hook right)
    spin: 0.4,          // 0..1
    standing: null,     // 10 booleans, true = pin still up (null = fresh rack)
    frames: [],         // scoring: each = { rolls: [..], score: null }
  };

  // ---------- DOM refs ----------
  let el = {};
  function cacheEl() {
    el = {
      sheet: $('scoresheet'),
      total: $('total'),
      frameLabel: $('frame-label'),
      ballLabel: $('ball-label'),
      leagueLine: $('league-line'),
      phaseHint: $('phase-hint'),
      setup: $('setup'),
      sAim: $('s-aim'), sPower: $('s-power'), sCurve: $('s-curve'), sSpin: $('s-spin'),
      vAim: $('v-aim'), vPower: $('v-power'), vCurve: $('v-curve'), vSpin: $('v-spin'),
      btnThrow: $('btn-throw'),
      toast: $('toast'),
      title: $('overlay-title'),
      results: $('overlay-results'),
      resultTitle: $('result-title'),
      resultBody: $('result-body'),
      btnAgain: $('btn-again'),
      btnHub: $('btn-hub'),
    };
  }

  // ---------- scoring ----------
  function freshFrames() {
    G.frames = [];
    for (let i = 0; i < FRAMES; i++) G.frames.push({ rolls: [], score: null });
  }
  function recordRoll(pinsDown) { G.frames[G.frame].rolls.push(pinsDown); }

  // Standard 10-pin cumulative scoring.
  function computeScores() {
    const f = G.frames;
    let running = 0;
    const flat = [];
    f.forEach((fr, idx) => fr.rolls.forEach((r) => flat.push({ r, idx })));

    for (let i = 0; i < FRAMES; i++) {
      const fr = f[i];
      if (fr.rolls.length === 0) { fr.score = null; continue; }
      const start = flat.findIndex((x) => x.idx === i);
      if (start < 0) { fr.score = null; continue; }
      const r0 = flat[start] ? flat[start].r : 0;

      if (i < 9) {
        if (r0 === 10) {
          const b1 = flat[start + 1] ? flat[start + 1].r : null;
          const b2 = flat[start + 2] ? flat[start + 2].r : null;
          if (b1 == null || b2 == null) { fr.score = null; }
          else running += 10 + b1 + b2, fr.score = running;
        } else {
          const r1 = flat[start + 1] ? flat[start + 1].r : null;
          if (r1 == null) { fr.score = null; }
          else if (r0 + r1 === 10) {
            const b1 = flat[start + 2] ? flat[start + 2].r : null;
            if (b1 == null) { fr.score = null; }
            else running += 10 + b1, fr.score = running;
          } else { running += r0 + r1; fr.score = running; }
        }
      } else {
        const need = (fr.rolls[0] === 10 || (fr.rolls[0] + (fr.rolls[1] || 0) === 10)) ? 3 : 2;
        if (fr.rolls.length >= need) { running += fr.rolls.reduce((a, b) => a + b, 0); fr.score = running; }
        else fr.score = null;
      }
    }
    return running;
  }
  function gameTotal() {
    let last = 0;
    for (const fr of G.frames) if (fr.score != null) last = fr.score;
    return last;
  }

  // ---------- scoresheet ----------
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

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg, ms = 1400) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), ms);
  }

  // ---------- the shot setup (sliders + live preview) ----------
  function aimToWorld(aim) { return aim * (Scene.LANE_HW - 0.12); }

  // push G values into the slider DOM (e.g. on a new turn / keyboard aim)
  function syncSliders() {
    el.sAim.value = Math.round(G.aim * 100);
    el.sPower.value = Math.round(G.power * 100);
    el.sCurve.value = Math.round(G.curve * 100);
    el.sSpin.value = Math.round(G.spin * 100);
    paintValues();
  }
  function paintValues() {
    const a = Math.round(G.aim * 100);
    el.vAim.textContent = a === 0 ? 'center' : (a < 0 ? 'L' + (-a) : 'R' + a);
    el.vPower.textContent = Math.round(G.power * 100);
    const c = Math.round(G.curve * 100);
    el.vCurve.textContent = c === 0 ? 'straight' : (c < 0 ? '◀ ' + (-c) : c + ' ▶');
    el.vSpin.textContent = Math.round(G.spin * 100);
  }
  function updatePreview() {
    if (G.phase !== 'setup') return;
    Scene.previewShot({ aimX: aimToWorld(G.aim), power: G.power, curve: G.curve, spin: G.spin });
  }

  // ---------- phase flow ----------
  function startTurn() {
    if (G.ball === 1) {
      G.standing = [true, true, true, true, true, true, true, true, true, true];
      Scene.setRack(null);
    } else {
      Scene.setRack(G.standing.slice());
    }
    // keep last power/curve/spin (nice for fine-tuning); recentre the aim
    G.aim = 0;
    Scene.placeBall(aimToWorld(G.aim));
    setPhase('setup');
    updateLabels();
    syncSliders();
    updatePreview();
  }

  function setPhase(p) {
    G.phase = p;
    const inSetup = (p === 'setup');
    el.setup.classList.toggle('hidden', !inSetup);
    el.btnThrow.disabled = !inSetup;
    if (inSetup) el.phaseHint.textContent = 'Dial in your shot — the blue line shows where it goes. Then THROW.';
    else if (p === 'rolling') el.phaseHint.textContent = '…';
  }

  function updateLabels() {
    el.frameLabel.textContent = 'Frame ' + (G.frame + 1);
    el.ballLabel.textContent = 'Ball ' + G.ball;
    const n = L && L.activeNight();
    el.leagueLine.textContent = n ? `Wk${n.week} vs ${n.opp} · beat ${n.oppScore}` : 'Practice';
  }

  function throwBall() {
    if (G.phase !== 'setup') return;
    setPhase('rolling');
    if (window.GameAudio) GameAudio.play('roll');
    Scene.roll({ power: G.power, curve: G.curve, spin: G.spin });
  }

  // called by Scene when the ball + pins settle
  function onSettled(res) {
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
    else if (G.ball === 1 && downNow === 10) { toast('STRIKE! 🎳', 1600); if (window.GameAudio) GameAudio.play('strike'); }
    else if (G.ball >= 2 && remaining === 0 && !isTenthExtra()) { toast('SPARE! ✊', 1500); if (window.GameAudio) GameAudio.play('strike'); }
    else if (downNow === 0) toast('No pins.');
    else toast(downNow + (downNow === 1 ? ' pin' : ' pins'));

    setTimeout(advanceAfterRoll, 1200);
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
      if (r[0] === 10) G.standing = new Array(10).fill(true);
      G.ball = 2; startTurn(); return;
    }
    if (G.ball === 2) {
      if (earnedBonus) {
        if ((r[0] === 10 && r[1] === 10) || firstTwo === 10) G.standing = new Array(10).fill(true);
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
    el.setup.classList.add('hidden');
    const total = gameTotal();

    // a league night? record it against this week's opponent and advance the season
    if (L && L.activeNight()) {
      const r = L.recordNight(total);
      el.resultTitle.textContent = r.win ? 'WIN! 🏆' : 'Tough night';
      el.resultBody.innerHTML =
        `<div class="big-score">${r.you} <span class="vs">vs</span> ${r.oppScore}</div>` +
        `<p>${r.win ? 'You beat the ' : 'Lost to the '}<b>${r.opp}</b>.</p>` +
        `<p class="fine">${r.done ? `Season over — you finished #${r.rank}.` :
          `League standing: #${r.rank} · 💵 $${r.money}`}</p>`;
      // after a league night you head back to the alley (the season advances there)
      el.btnAgain.classList.add('hidden');
      el.btnHub.textContent = r.done ? 'See Final Standings' : 'Back to the Alley';
    } else {
      el.resultTitle.textContent = 'Practice Game';
      el.resultBody.innerHTML = `<div class="big-score">${total}</div><p>Nice rolling.</p>`;
      el.btnAgain.classList.remove('hidden');
    }
    el.results.classList.remove('hidden');
    renderSheet();
  }

  function newGame() {
    if (window.GameAudio) GameAudio.resume();   // unlock audio on the PLAY gesture
    G.frame = 0; G.ball = 1; G.phase = 'setup';
    freshFrames();
    el.title.classList.add('hidden');
    el.results.classList.add('hidden');
    startTurn();
    renderSheet();
  }

  // ---------- input ----------
  function bindInput() {
    $('btn-play').addEventListener('click', newGame);
    el.btnAgain.addEventListener('click', newGame);
    if (el.btnHub) el.btnHub.addEventListener('click', () => { window.location.href = 'index.html'; });
    el.btnThrow.addEventListener('click', throwBall);

    const sliderMap = [
      [el.sAim, (v) => { G.aim = clamp(v / 100, -1, 1); }],
      [el.sPower, (v) => { G.power = clamp(v / 100, 0, 1); }],
      [el.sCurve, (v) => { G.curve = clamp(v / 100, -1, 1); }],
      [el.sSpin, (v) => { G.spin = clamp(v / 100, 0, 1); }],
    ];
    for (const [slider, apply] of sliderMap) {
      slider.addEventListener('input', () => {
        apply(parseFloat(slider.value));
        paintValues();
        updatePreview();
      });
    }

    window.addEventListener('keydown', (e) => {
      const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
      if (e.key === 'Enter' || e.key === ' ') {
        if (G.phase === 'title') newGame();
        else if (G.phase === 'gameover') {
          if (el.btnAgain.classList.contains('hidden')) window.location.href = 'index.html';
          else newGame();
        }
        else if (G.phase === 'setup') throwBall();
        e.preventDefault();
        return;
      }
      if (typing) return;   // let a focused slider use its own arrow keys
      if (G.phase === 'setup' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        G.aim = clamp(G.aim + (e.key === 'ArrowLeft' ? -AIM_STEP : AIM_STEP), -1, 1);
        syncSliders();
        updatePreview();
        e.preventDefault();
      }
    });
  }

  // ---------- boot ----------
  function boot() {
    cacheEl();
    Scene.init($('game'));
    Scene.onSettled = onSettled;
    Scene.onImpact = () => { if (window.GameAudio) GameAudio.play('hit'); };
    bindInput();
    freshFrames();
    renderSheet();
    updateLabels();
    syncSliders();
    // equip the ball chosen in the Pro Shop (weight -> pin carry, hook, colour)
    const ball = (L && L.equippedBall()) || { weight: 12, hook: 1, color: 0x1b9be0 };
    Scene.setBall(ball);
    const n = L && L.activeNight();
    const ballNote = ball ? ` · 🎳 ${ball.name} (${ball.weight} lb)` : '';
    $('title-league').textContent = (n
      ? `Week ${n.week} — ${L.player} vs ${n.opp} · beat ${n.oppScore} to win the night`
      : 'Practice game — roll for a high score') + ballNote;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
