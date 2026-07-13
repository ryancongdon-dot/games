// game.js — Kitchen Kings match loop.
// M4: serve -> rally -> point flow driven by the Rules referee (side-out
// scoring, two-bounce, kitchen), live scoreboard + fault banners.
// A minimal CPU auto-serve keeps the match moving until real AI lands in M5.
(() => {
  'use strict';

  const el = (id) => document.getElementById(id);
  const canvas = el('scene');
  const D = () => Court.DIMS;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const MOVE_SPEED = 4.4;
  const REACH = 1.0;
  const REACH_Y = 1.85;

  const G = {
    started: false, last: 0,
    ball: null,
    players: [],        // { ci, team, pos, home }
    control: 0,
    phase: 'serve',     // serve | rally | dead
    hold: true,
    aim: { x: 0, z: -4 },
    prevZSign: 1,
    deadTimer: 0,
    cpuServeTimer: 0,
    switchLock: 0,
  };

  const NEAR = [0, 1];

  function boot() {
    try { Court.init(canvas); }
    catch (e) { console.error('[game] Court init failed:', e); el('loading').textContent = 'WebGL failed to start.'; return; }
    Input.init(canvas);
    G.last = performance.now();
    requestAnimationFrame(frame);
    el('loading').textContent = '';
  }

  function spawnPlayer(team) {
    const ci = Court.makePlayer(team, G.players.filter(p => p.team === team).length);
    const p = { ci, team, pos: { x: 0, z: 0 }, home: { x: 0, z: 0 } };
    G.players.push(p);
    return G.players.length - 1;
  }

  function startMatch() {
    el('menu').classList.add('hidden');
    el('results').classList.add('hidden');
    el('hud').classList.remove('hidden');
    if (!G.audioUnlocked) { GameAudio.unlock(); GameAudio.startMusic(); G.audioUnlocked = true; }
    beginMatch();
    G.started = true;
  }

  function beginMatch() {
    Court.clearPlayers();
    G.players = [];
    spawnPlayer(0); spawnPlayer(0); spawnPlayer(1); spawnPlayer(1);
    if (!G.ball) G.ball = Physics.make();
    AI.setDifficulty(G.difficulty || 'pro');
    Rules.reset(0);
    G.paused = false; setPauseUI(false);
    setupServe();
  }

  function setPaused(p) { if (!G.started || G.phase === 'over') return; G.paused = p; setPauseUI(p); }
  function setPauseUI(p) { el('pause').classList.toggle('hidden', !p); }
  function quitToTitle() {
    G.started = false; G.paused = false;
    setPauseUI(false); el('results').classList.add('hidden');
    el('hud').classList.add('hidden'); el('menu').classList.remove('hidden');
    Court.ballVisible(false);
  }
  function showResults(win, scores) {
    el('resultTitle').textContent = win ? 'You win! 🏆' : 'CPU wins';
    el('resultScore').textContent = `Final: ${scores[0]} – ${scores[1]}`;
    el('results').classList.remove('hidden');
  }

  // ---- sound + difficulty persistence ----
  function loadPrefs() {
    G.difficulty = localStorage.getItem('kk_diff') || 'pro';
    const snd = localStorage.getItem('kk_sound');
    G.sound = snd === null ? true : snd === '1';
    GameAudio.setEnabled(G.sound);
    reflectSoundUI();
    document.querySelectorAll('.segbtn').forEach(b => b.classList.toggle('on', b.dataset.diff === G.difficulty));
  }
  function setDifficulty(name) { G.difficulty = name; localStorage.setItem('kk_diff', name); AI.setDifficulty(name); }
  function toggleSound() {
    G.sound = !G.sound; localStorage.setItem('kk_sound', G.sound ? '1' : '0');
    GameAudio.setEnabled(G.sound);
    if (G.sound && G.audioUnlocked) GameAudio.startMusic();
    reflectSoundUI();
  }
  function reflectSoundUI() {
    el('btnSound').textContent = G.sound ? '🔊' : '🔇';
    if (el('btnSound2')) el('btnSound2').textContent = 'Sound: ' + (G.sound ? 'On' : 'Off');
  }

  let hintTimer = null;
  function showHint(text, ms = 2600) {
    const h = el('hint'); h.textContent = text; h.classList.add('show');
    clearTimeout(hintTimer); hintTimer = setTimeout(() => h.classList.remove('show'), ms);
  }

  // ---- HUD ----
  function updateHUD() {
    const inf = Rules.info();
    el('scoreHome').textContent = inf.scores[0];
    el('scoreAway').textContent = inf.scores[1];
    el('callout').textContent = Rules.callout();
  }
  let bannerTimer = null;
  function banner(text, ms = 1400) {
    const b = el('banner');
    b.textContent = text; b.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), ms);
  }

  // ---- serve setup ----
  function setupServe() {
    const inf = Rules.info();
    const pos = Rules.positions(D());
    for (let i = 0; i < 4; i++) if (pos[i]) { G.players[i].pos.x = pos[i].x; G.players[i].pos.z = pos[i].z; }
    G.server = inf.server;
    G.phase = 'serve'; G.hold = true;
    // control: if our team serves, control the server; else control our near receiver
    G.control = (inf.servingTeam === 0) ? inf.server : nearestNearPlayerToBall();
    setControlHighlight();
    holdBallAtServer();
    updateHUD();
    G.cpuServeTimer = (inf.servingTeam === 1) ? 0.9 : 0;
    Court.ballVisible(true);
    if (inf.servingTeam === 0) {
      banner('Your serve', 900);
      showHint(Input.usingPad() ? 'Press A to serve' : 'Press Space to serve', 2400);
    }
  }

  function nearestNearPlayerToBall() {
    let best = 0, bd = Infinity;
    for (const i of NEAR) { const p = G.players[i]; const d = Math.hypot(p.pos.x - G.ball.p.x, p.pos.z - G.ball.p.z); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function setControlHighlight() {
    for (const p of G.players) Court.setControlled(p.ci, false);
    if (G.players[G.control]) Court.setControlled(G.players[G.control].ci, true);
  }
  function holdBallAtServer() {
    const s = G.players[G.server];
    const face = s.team === 0 ? -1 : 1;
    G.ball.p.x = s.pos.x + 0.2; G.ball.p.y = 0.9; G.ball.p.z = s.pos.z + 0.1 * face;
    G.ball.v.x = G.ball.v.y = G.ball.v.z = 0;
    G.ball.alive = true; G.ball.rolling = false; G.ball.bounces = 0;
    G.prevZSign = Math.sign(G.ball.p.z) || 1;
  }

  const panForX = (x) => clamp(x / (D().HALF_W + 1), -1, 1);

  function serveTargetCenter() {
    const b = Rules.info().serveBox;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    return { cx, cz, b };
  }

  function doServe(byCpu) {
    const inf = Rules.info();
    const s = G.players[G.server];
    const { cx, cz, b } = serveTargetCenter();
    // human can nudge serve placement within the box; cpu aims center-ish
    let tx = cx, tz = cz;
    if (!byCpu) {
      if (Input.pointer().active && !Input.usingPad()) tx = clamp(G.aim.x, Math.min(b.x0, b.x1) + 0.3, Math.max(b.x0, b.x1) - 0.3);
      else { const a = Input.aimStick(); if (a.mag > 0.2) tx = clamp(cx + a.x * (D().HALF_W * 0.4), Math.min(b.x0, b.x1) + 0.3, Math.max(b.x0, b.x1) - 0.3); }
    } else { tx += (Math.random() - 0.5) * 0.8; }
    Rules.serveHit();
    Court.triggerSwing(s.ci);
    const from = { x: s.pos.x + 0.2, y: 0.35, z: s.pos.z + (s.team === 0 ? -0.15 : 0.15) };
    Physics.launch(G.ball, from, { x: tx, z: tz }, 'serve', 1, 0);
    G.ball.hitBy = s.ci;
    G.hold = false; G.phase = 'rally';
    G.prevZSign = Math.sign(G.ball.p.z) || 1;
    GameAudio.play('serve'); GameAudio.play('hit', { vel: 0.8, pan: panForX(s.pos.x) });
    Court.shake(0.05);
  }

  // ---- shared strike used by both the human and the AI ----
  function strikeBall(pIdx, type, target, spin = 0) {
    const b = G.ball, p = G.players[pIdx];
    let t = type; if (t === 'auto') t = b.p.y > 0.95 ? 'smash' : 'drive';
    const res = Rules.hit(p.ci, { x: p.pos.x, z: p.pos.z });
    Court.triggerSwing(p.ci);
    if (res) { onRallyResult(res); return; }            // illegal strike (kitchen / two-bounce)
    Physics.launch(b, { x: b.p.x, y: b.p.y, z: b.p.z }, target, t, 1, spin);
    b.hitBy = p.ci;
    GameAudio.play(t === 'smash' ? 'smash' : t === 'dink' ? 'dink' : 'hit', { vel: 1, pan: panForX(b.p.x) });
    Court.shake(t === 'smash' ? 0.12 : 0.05);
  }

  // human strike: near team, ball on near side, within reach
  function tryRallyStrike(type) {
    const b = G.ball, c = G.players[G.control];
    if (!b.alive || c.team !== 0 || b.p.z <= 0) return;
    if (Math.hypot(b.p.x - c.pos.x, b.p.z - c.pos.z) > REACH || b.p.y > REACH_Y) return;
    let t = type; if (t === 'auto') t = b.p.y > 0.95 ? 'smash' : 'drive';
    const target = { x: G.aim.x, z: t === 'dink' ? -1.4 : G.aim.z };
    strikeBall(G.control, t, target);
  }

  const aiCtx = () => ({
    ball: G.ball, players: G.players, dims: D(), control: G.control,
    rules: Rules, predict: (b) => Physics.predictLanding(b),
    strike: (i, type, target) => strikeBall(i, type, target),
  });

  function requestedType() {
    if (Input.pressed('smash')) return 'smash';
    if (Input.pressed('lob')) return 'lob';
    if (Input.pressed('dink')) return 'dink';
    if (Input.pressed('drive')) return 'drive';
    if (Input.pressed('serve') || Input.pressed('swing')) return 'auto';
    return null;
  }

  // ---- rally outcome ----
  function onRallyResult(res) {
    G.phase = 'dead'; G.deadTimer = 1.5;
    GameAudio.play('whistle');
    updateHUD();
    if (res.matchOver) {
      const win = res.matchWinner === 0;
      banner(win ? 'YOU WIN! 🏆' : 'CPU WINS', 2600);
      GameAudio.play(win ? 'win' : 'lose');
      G.phase = 'over';
      setTimeout(() => showResults(win, res.scores), 1900);
      return;
    }
    let msg;
    if (res.event === 'point') { msg = res.winner === 0 ? 'Point — You' : 'Point — CPU'; GameAudio.play('point'); }
    else if (res.event === 'server2') msg = 'Second server';
    else if (res.event === 'sideout') msg = 'Side out';
    banner(msg + (res.reason ? `\n${cap(res.reason)}` : ''), 1600);
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---- control auto-switch (near team) ----
  function updateControl(dt) {
    G.switchLock = Math.max(0, G.switchLock - dt);
    if (Input.pressed('switch')) {
      G.control = G.control === NEAR[0] ? NEAR[1] : NEAR[0];
      setControlHighlight(); G.switchLock = 0.4; GameAudio.play('ui'); return;
    }
    if (G.phase !== 'rally') return;
    const b = G.ball;
    if (!b.alive || b.p.z <= 0 || b.v.z < 0 || G.switchLock > 0) return;
    const land = Physics.predictLanding(b) || { x: b.p.x, z: b.p.z };
    if (land.z <= 0) return;
    let best = G.control, bestD = Infinity;
    for (const i of NEAR) { const p = G.players[i]; const d = Math.hypot(p.pos.x - land.x, p.pos.z - land.z); if (d < bestD) { bestD = d; best = i; } }
    if (best !== G.control) {
      const cur = G.players[G.control];
      const curD = Math.hypot(cur.pos.x - land.x, cur.pos.z - land.z);
      if (curD - bestD > 0.7) { G.control = best; setControlHighlight(); G.switchLock = 0.5; }
    }
  }

  function resolveAim() {
    const ptr = Input.pointer();
    if (ptr.active && !Input.usingPad()) {
      G.aim.x = clamp((ptr.x - 0.5) * 2 * (D().HALF_W - 0.4), -D().HALF_W + 0.3, D().HALF_W - 0.3);
      G.aim.z = clamp(-1.5 - ptr.y * (D().HALF_L - 2), -D().HALF_L + 0.4, -1.2);
      return;
    }
    const a = Input.aimStick();
    if (a.mag > 0.2) { G.aim.x = clamp(a.x * (D().HALF_W - 0.4), -D().HALF_W + 0.3, D().HALF_W - 0.3); G.aim.z = clamp(-4 + a.y * -2.5, -D().HALF_L + 0.4, -1.2); }
  }

  function moveControlled(dt) {
    const m = Input.move(), c = G.players[G.control];
    if (c && (m.x || m.y)) {
      c.pos.x = clamp(c.pos.x + m.x * MOVE_SPEED * dt, -D().HALF_W - 1.2, D().HALF_W + 1.2);
      c.pos.z = clamp(c.pos.z - m.y * MOVE_SPEED * dt, 0.3, D().HALF_L + 1.2);
    }
  }

  // reticle: show the human's aim target
  function updateReticle() {
    if (G.phase === 'serve' && Rules.info().servingTeam === 0) {
      const { cx, cz, b } = serveTargetCenter();
      let tx = cx;
      if (Input.pointer().active && !Input.usingPad()) tx = clamp(G.aim.x, Math.min(b.x0, b.x1) + 0.3, Math.max(b.x0, b.x1) - 0.3);
      else { const a = Input.aimStick(); if (a.mag > 0.2) tx = clamp(cx + a.x * (D().HALF_W * 0.4), Math.min(b.x0, b.x1) + 0.3, Math.max(b.x0, b.x1) - 0.3); }
      Court.setReticle(tx, cz, true);
    } else if (G.phase === 'rally') {
      Court.setReticle(G.aim.x, G.aim.z, true);
    } else {
      Court.setReticle(0, 0, false);
    }
  }

  // ---- main step ----
  function step(dt) {
    updateControl(dt);
    resolveAim();
    moveControlled(dt);

    if (G.phase === 'serve') {
      const inf = Rules.info();
      if (inf.servingTeam === 0) { if (requestedType()) doServe(false); }
      else { G.cpuServeTimer -= dt; if (G.cpuServeTimer <= 0) doServe(true); }
    } else if (G.phase === 'rally') {
      AI.update(dt, aiCtx());
      const type = requestedType();
      if (type) tryRallyStrike(type);
    } else if (G.phase === 'dead') {
      G.deadTimer -= dt;
      if (G.deadTimer <= 0) { Rules.nextServe(); setupServe(); }
    }

    // sync player meshes
    for (const p of G.players) Court.setPlayer(p.ci, p.pos.x, p.pos.z, p.team === 0 ? Math.PI : 0);

    const b = G.ball;
    if (G.hold) {
      holdBallAtServer();
    } else if (b.alive && (G.phase === 'rally')) {
      const ev = Physics.step(b, dt);
      // net-crossing detection (clean pass only)
      const zs = Math.sign(b.p.z) || G.prevZSign;
      if (ev === 'net') {
        GameAudio.play('net', { pan: panForX(b.p.x) });
        feed(Rules.net());
      } else {
        if (zs !== G.prevZSign) { Rules.cross(); G.prevZSign = zs; }
        if (ev === 'bounce') {
          GameAudio.play('bounce', { vel: clamp(Math.abs(b.v.y) + 0.3, 0.3, 1.2), pan: panForX(b.p.x) });
          feed(Rules.bounce({ x: b.p.x, z: b.p.z }));
        }
      }
    }

    updateReticle();
    Court.setBall(b.p.x, b.p.y, b.p.z);
  }

  function feed(res) { if (res) { const r = Rules.consumeResult() || res; onRallyResult(r); } }

  function frame(now) {
    const dt = Math.min(0.05, (now - G.last) / 1000 || 0);
    G.last = now;
    Input.beginFrame();
    if (G.started && Input.pressed('pause')) setPaused(!G.paused);
    if (G.started && !G.paused && G.phase !== 'over') step(dt);
    Court.update(dt);
    requestAnimationFrame(frame);
  }

  // headless/testing: advance game logic without waiting on the render loop
  function fastForward(sec) { const n = Math.round(sec * 60); for (let i = 0; i < n && G.phase !== 'over'; i++) { Input.beginFrame(); step(1 / 60); } }

  function wireUI() {
    el('btnPlay').addEventListener('click', startMatch);
    document.querySelectorAll('.segbtn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.segbtn').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); setDifficulty(b.dataset.diff); GameAudio.play('ui');
    }));
    el('btnSound').addEventListener('click', toggleSound);
    el('btnSound2').addEventListener('click', toggleSound);
    el('btnPause').addEventListener('click', () => setPaused(true));
    el('btnResume').addEventListener('click', () => setPaused(false));
    el('btnQuit').addEventListener('click', quitToTitle);
    el('btnRematch').addEventListener('click', startMatch);
    el('btnMenu').addEventListener('click', quitToTitle);
  }

  window.addEventListener('DOMContentLoaded', () => { boot(); loadPrefs(); wireUI(); });
  window.PB = { G, start: startMatch, Rules, fastForward, setPaused };
})();
