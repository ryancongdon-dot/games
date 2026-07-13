// game.js — Kitchen Kings match loop.
// M3: doubles (4 players), unified input manager, control auto-switch.
// (Rules/scoring in M4, AI in M5.)
(() => {
  'use strict';

  const el = (id) => document.getElementById(id);
  const canvas = el('scene');
  const D = () => Court.DIMS;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const MOVE_SPEED = 4.4;
  const REACH = 0.98;
  const REACH_Y = 1.8;

  const G = {
    started: false, last: 0,
    ball: null,
    players: [],        // { ci, team, pos:{x,z}, home:{x,z} }
    control: 0,         // index into G.players (near team) the human drives
    hold: true,
    server: 0,          // who holds/serves (near team for M3)
    aim: { x: 0, z: -4 },
    feedTimer: 0,
    switchLock: 0,
  };

  // near team = players[0],[1]; far team = players[2],[3]
  const NEAR = [0, 1], FAR = [2, 3];

  function boot() {
    try { Court.init(canvas); }
    catch (e) { console.error('[game] Court init failed:', e); el('loading').textContent = 'WebGL failed to start.'; return; }
    Input.init(canvas);
    G.last = performance.now();
    requestAnimationFrame(frame);
    el('loading').textContent = '';
  }

  function spawnPlayer(team, x, z) {
    const ci = Court.makePlayer(team, G.players.filter(p => p.team === team).length);
    const p = { ci, team, pos: { x, z }, home: { x, z } };
    G.players.push(p);
    return G.players.length - 1;
  }

  function startMatch() {
    if (G.started) return;
    G.started = true;
    el('menu').classList.add('hidden');
    el('hud').classList.remove('hidden');
    GameAudio.unlock(); GameAudio.startMusic();

    const HL = D().HALF_L, K = D().KITCHEN;
    // near team ready near their kitchen line; server starts at baseline
    spawnPlayer(0, -1.5, HL - 0.6);   // 0: near-left (starts as server)
    spawnPlayer(0,  1.5, K + 0.4);    // 1: near-right partner at kitchen
    spawnPlayer(1, -1.5, -(K + 0.4)); // 2: far-left at kitchen
    spawnPlayer(1,  1.5, -(K + 0.4)); // 3: far-right at kitchen

    G.control = 0; G.server = 0;
    setControlHighlight();

    G.ball = Physics.make();
    G.hold = true;
    holdBallAtServer();
  }

  function setControlHighlight() {
    for (const p of G.players) Court.setControlled(p.ci, false);
    Court.setControlled(G.players[G.control].ci, true);
  }

  function holdBallAtServer() {
    const s = G.players[G.server];
    G.ball.p.x = s.pos.x + 0.25; G.ball.p.y = 0.9; G.ball.p.z = s.pos.z - 0.1;
    G.ball.v.x = G.ball.v.y = G.ball.v.z = 0;
    G.ball.alive = true; G.ball.rolling = false; G.ball.bounces = 0;
  }

  const panForX = (x) => clamp(x / (D().HALF_W + 1), -1, 1);

  // ---- aim resolution: mouse -> court point, or stick -> biased target ----
  function resolveAim() {
    const ptr = Input.pointer();
    if (ptr.active && !Input.usingPad()) {
      G.aim.x = clamp((ptr.x - 0.5) * 2 * (D().HALF_W - 0.4), -D().HALF_W + 0.3, D().HALF_W - 0.3);
      G.aim.z = clamp(-1.5 - ptr.y * (D().HALF_L - 2), -D().HALF_L + 0.4, -1.2);
      return;
    }
    const a = Input.aimStick();
    if (a.mag > 0.2) {
      G.aim.x = clamp(a.x * (D().HALF_W - 0.4), -D().HALF_W + 0.3, D().HALF_W - 0.3);
      G.aim.z = clamp(-4 + a.y * -2.5, -D().HALF_L + 0.4, -1.2);
    }
  }

  function requestedType() {
    if (Input.pressed('smash')) return 'smash';
    if (Input.pressed('lob')) return 'lob';
    if (Input.pressed('dink')) return 'dink';
    if (Input.pressed('drive')) return 'drive';
    if (Input.pressed('serve') || Input.pressed('swing')) return 'auto';
    return null;
  }

  function doSwing(type) {
    const b = G.ball, c = G.players[G.control];
    if (G.hold) {
      Court.triggerSwing(c.ci);
      const from = { x: c.pos.x + 0.2, y: 0.35, z: c.pos.z - 0.15 };
      Physics.launch(b, from, { x: G.aim.x, z: G.aim.z }, 'serve', 1, 0);
      b.hitBy = c.ci; G.hold = false;
      GameAudio.play('serve'); GameAudio.play('hit', { vel: 0.8, pan: panForX(c.pos.x) });
      Court.shake(0.05);
      return;
    }
    if (!b.alive) return;
    const dx = b.p.x - c.pos.x, dz = b.p.z - c.pos.z;
    if (b.p.z > 0 && Math.hypot(dx, dz) < REACH && b.p.y < REACH_Y) {
      const high = b.p.y > 0.95;
      let t = type;
      if (t === 'auto') t = high ? 'smash' : 'drive';
      const target = { x: G.aim.x, z: t === 'dink' ? -1.4 : G.aim.z };
      Court.triggerSwing(c.ci);
      Physics.launch(b, { x: b.p.x, y: b.p.y, z: b.p.z }, target, t, 1, 0);
      b.hitBy = c.ci;
      GameAudio.play(t === 'smash' ? 'smash' : t === 'dink' ? 'dink' : 'hit', { vel: 1, pan: panForX(b.p.x) });
      Court.shake(t === 'smash' ? 0.12 : 0.05);
    }
  }

  // ---- control: auto-switch to the near player better positioned for the ball ----
  function updateControl(dt) {
    G.switchLock = Math.max(0, G.switchLock - dt);
    if (Input.pressed('switch')) {
      G.control = G.control === NEAR[0] ? NEAR[1] : NEAR[0];
      setControlHighlight(); G.switchLock = 0.4; GameAudio.play('ui');
      return;
    }
    if (G.hold) { G.control = G.server; setControlHighlight(); return; }
    const b = G.ball;
    if (!b.alive || b.p.z <= 0 || b.v.z < 0 || G.switchLock > 0) return;
    // ball heading toward near team — pick the closer near player to its landing
    const land = Physics.predictLanding(b) || { x: b.p.x, z: b.p.z };
    if (land.z <= 0) return;
    let best = G.control, bestD = Infinity;
    for (const i of NEAR) {
      const p = G.players[i];
      const d = Math.hypot(p.pos.x - land.x, p.pos.z - land.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    // hysteresis: only switch if the candidate is clearly better
    if (best !== G.control) {
      const cur = G.players[G.control];
      const curD = Math.hypot(cur.pos.x - land.x, cur.pos.z - land.z);
      if (curD - bestD > 0.7) { G.control = best; setControlHighlight(); G.switchLock = 0.5; }
    }
  }

  function moveControlled(dt) {
    const m = Input.move(), c = G.players[G.control];
    if (m.x || m.y) {
      c.pos.x = clamp(c.pos.x + m.x * MOVE_SPEED * dt, -D().HALF_W - 1.2, D().HALF_W + 1.2);
      c.pos.z = clamp(c.pos.z - m.y * MOVE_SPEED * dt, 0.3, D().HALF_L + 1.2);  // forward = toward net (-z)
    }
  }

  function step(dt) {
    Input.beginFrame();
    updateControl(dt);
    resolveAim();
    moveControlled(dt);

    const type = requestedType();
    if (type) doSwing(type);

    // sync all player meshes (near face -z, far face +z)
    for (const p of G.players) {
      Court.setPlayer(p.ci, p.pos.x, p.pos.z, p.team === 0 ? Math.PI : 0);
    }

    const b = G.ball;
    if (G.hold) {
      holdBallAtServer();
    } else if (b.alive) {
      const ev = Physics.step(b, dt);
      if (ev === 'bounce') {
        GameAudio.play('bounce', { vel: clamp(Math.abs(b.v.y) + 0.3, 0.3, 1.2), pan: panForX(b.p.x) });
        const outX = Math.abs(b.p.x) > D().HALF_W + 2.5;
        const outZ = Math.abs(b.p.z) > D().HALF_L + 2.5;
        if (b.bounces >= 2 || outX || outZ) { b.alive = false; G.feedTimer = 1.2; }
      } else if (ev === 'net') {
        GameAudio.play('net', { pan: panForX(b.p.x) });
      }
    } else {
      G.feedTimer -= dt;
      if (G.feedTimer <= 0) { G.hold = true; holdBallAtServer(); }
    }

    Court.setBall(b.p.x, b.p.y, b.p.z);
    Court.update(dt);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - G.last) / 1000 || 0);
    G.last = now;
    if (G.started) step(dt); else Court.update(dt);
    requestAnimationFrame(frame);
  }

  window.addEventListener('DOMContentLoaded', () => {
    boot();
    el('btnPlay').addEventListener('click', startMatch);
  });

  window.PB = { G, start: startMatch };
})();
