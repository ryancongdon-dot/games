// game.js — Kitchen Kings match loop.
// M2: one movable player, a served ball with real physics, swing to strike.
// (Rules, scoring, AI, and the full input manager arrive in later milestones.)
(() => {
  'use strict';

  const el = (id) => document.getElementById(id);
  const canvas = el('scene');
  const D = () => Court.DIMS;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const G = {
    started: false, last: 0,
    ball: null,
    player: -1,            // court player index we control
    pos: { x: 0, z: 0 },   // controlled player position
    hold: true,            // ball is in hand (pre-serve)
    keys: {},
    aim: { x: 0, z: -4 },  // where shots are aimed (far court)
    feedTimer: 0,
  };

  const MOVE_SPEED = 4.2;
  const REACH = 0.95;      // horizontal strike radius
  const REACH_Y = 1.7;     // max ball height a player can strike

  function boot() {
    try { Court.init(canvas); }
    catch (e) { console.error('[game] Court init failed:', e); el('loading').textContent = 'WebGL failed to start.'; return; }
    G.last = performance.now();
    requestAnimationFrame(frame);
    el('loading').textContent = '';
  }

  function startMatch() {
    if (G.started) return;
    G.started = true;
    el('menu').classList.add('hidden');
    el('hud').classList.remove('hidden');
    GameAudio.unlock(); GameAudio.startMusic();

    // spawn the near player behind the baseline to serve
    G.player = Court.makePlayer(0, 0);
    G.pos.x = -1.5; G.pos.z = D().HALF_L - 0.5;
    Court.setControlled(G.player, true);

    G.ball = Physics.make();
    G.hold = true;
    setBallToHand();
  }

  function setBallToHand() {
    // ball rests at the near player's paddle contact point, ready to serve
    G.ball.p.x = G.pos.x + 0.25;
    G.ball.p.y = 0.9;
    G.ball.p.z = G.pos.z - 0.1;
    G.ball.v.x = G.ball.v.y = G.ball.v.z = 0;
    G.ball.alive = true; G.ball.rolling = false; G.ball.bounces = 0;
  }

  function panForX(x) { return clamp(x / (D().HALF_W + 1), -1, 1); }

  function swing() {
    const b = G.ball;
    if (G.hold) {
      // serve: launch diagonally into the far court
      Court.triggerSwing(G.player);
      const from = { x: G.pos.x + 0.2, y: 0.35, z: G.pos.z - 0.15 };
      const target = { x: G.aim.x, z: G.aim.z };
      Physics.launch(b, from, target, 'serve', 1, 0);
      b.hitBy = G.player;
      G.hold = false;
      GameAudio.play('serve');
      GameAudio.play('hit', { vel: 0.8, pan: panForX(G.pos.x) });
      Court.shake(0.05);
      return;
    }
    // rally strike if the ball is in reach on our side
    if (!b.alive) return;
    const dx = b.p.x - G.pos.x, dz = b.p.z - G.pos.z;
    const dist = Math.hypot(dx, dz);
    if (b.p.z > 0 && dist < REACH && b.p.y < REACH_Y) {
      Court.triggerSwing(G.player);
      const from = { x: b.p.x, y: b.p.y, z: b.p.z };
      const high = b.p.y > 0.9;
      const type = high ? 'smash' : (G.keys['ShiftLeft'] || G.keys['ShiftRight'] ? 'dink' : 'drive');
      const target = { x: G.aim.x, z: type === 'dink' ? -1.4 : G.aim.z };
      Physics.launch(b, from, target, type, 1, 0);
      b.hitBy = G.player;
      GameAudio.play(type === 'smash' ? 'smash' : type === 'dink' ? 'dink' : 'hit', { vel: 1, pan: panForX(b.p.x) });
      Court.shake(type === 'smash' ? 0.12 : 0.05);
    }
  }

  function updateInput(dt) {
    let mx = 0, mz = 0;
    if (G.keys['KeyA'] || G.keys['ArrowLeft']) mx -= 1;
    if (G.keys['KeyD'] || G.keys['ArrowRight']) mx += 1;
    if (G.keys['KeyW'] || G.keys['ArrowUp']) mz -= 1;
    if (G.keys['KeyS'] || G.keys['ArrowDown']) mz += 1;
    if (mx || mz) {
      const l = Math.hypot(mx, mz) || 1;
      G.pos.x = clamp(G.pos.x + (mx / l) * MOVE_SPEED * dt, -D().HALF_W - 1.2, D().HALF_W + 1.2);
      G.pos.z = clamp(G.pos.z + (mz / l) * MOVE_SPEED * dt, 0.3, D().HALF_L + 1.2);
    }
  }

  function step(dt) {
    if (!G.started) return;
    updateInput(dt);

    // keep player synced (face the net)
    Court.setPlayer(G.player, G.pos.x, G.pos.z, Math.PI);

    const b = G.ball;
    if (G.hold) {
      setBallToHand();
    } else if (b.alive) {
      const ev = Physics.step(b, dt);
      if (ev === 'bounce') {
        GameAudio.play('bounce', { vel: clamp(Math.abs(b.v.y) + 0.3, 0.3, 1.2), pan: panForX(b.p.x) });
        // dead after the 2nd bounce or if it leaves the play area (M2: just re-feed)
        const outX = Math.abs(b.p.x) > D().HALF_W + 2.5;
        const outZ = Math.abs(b.p.z) > D().HALF_L + 2.5;
        if (b.bounces >= 2 || outX || outZ) { b.alive = false; G.feedTimer = 1.1; }
      } else if (ev === 'net') {
        GameAudio.play('net', { pan: panForX(b.p.x) });
      }
    } else {
      // re-serve after a short beat
      G.feedTimer -= dt;
      if (G.feedTimer <= 0) { G.hold = true; setBallToHand(); }
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

  // ---- temporary M2 input (replaced by the input manager in M3) ----
  function wireInput() {
    window.addEventListener('keydown', (e) => {
      G.keys[e.code] = true;
      if (e.code === 'Space') { e.preventDefault(); swing(); }
    });
    window.addEventListener('keyup', (e) => { G.keys[e.code] = false; });
    // mouse aim: map screen X to far-court X, screen Y to depth
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;   // 0..1
      const ny = (e.clientY - r.top) / r.height;
      G.aim.x = clamp((nx - 0.5) * 2 * (D().HALF_W - 0.4), -D().HALF_W + 0.3, D().HALF_W - 0.3);
      G.aim.z = clamp(-1.5 - ny * (D().HALF_L - 2), -D().HALF_L + 0.4, -1.2);
    });
    canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); swing(); });
  }

  window.addEventListener('DOMContentLoaded', () => {
    boot();
    wireInput();
    el('btnPlay').addEventListener('click', startMatch);
  });

  window.PB = { G, start: startMatch };
})();
