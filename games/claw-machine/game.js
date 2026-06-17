// game.js — Claw Machine (pseudo-3D canvas 2D). Vanilla JS, no dependencies.
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Tunables (grouped for easy balancing)
  // ---------------------------------------------------------------------------
  const AIM_TIME = 20;            // seconds to aim before auto-drop
  const GRAB_CHANCE = 0.40;       // chance the claw holds a well-aimed prize
  const CHAOS_DROP_CHANCE = 0.05; // chance to drop the prize mid-carry
  const GRAB_RADIUS = 0.11;       // world-units; how close the claw must be
  const MOVE_X = 0.46;            // claw horizontal speed (world/sec)
  const MOVE_Z = 0.52;            // claw depth speed (world/sec)
  const FIELD_MIN = 9;            // prizes kept on the field
  const FREE_COIN_COOLDOWN = 60;  // seconds between free-coin claims
  const CLAW_HOME = { x: 0.05, z: 0.06 }; // chute corner (front-left)

  // ---------------------------------------------------------------------------
  // Prize catalog: rarity -> points + spawn weight + look
  // ---------------------------------------------------------------------------
  const PLUSH_TYPES = [
    { id: 'bear',    name: 'Teddy Bear', rarity: 'common',    points: 10,  weight: 30, body: '#bb7d43', belly: '#eccea6', accent: '#7d4f24', ear: 'round'   },
    { id: 'bunny',   name: 'Bunny',      rarity: 'common',    points: 10,  weight: 26, body: '#f2c9d8', belly: '#ffffff', accent: '#e08bab', ear: 'long'    },
    { id: 'cat',     name: 'Kitty',      rarity: 'uncommon',  points: 25,  weight: 16, body: '#f6a85a', belly: '#ffe4c4', accent: '#d9842f', ear: 'pointed' },
    { id: 'penguin', name: 'Penguin',    rarity: 'uncommon',  points: 25,  weight: 13, body: '#3a4a63', belly: '#fdfdfd', accent: '#f2b134', ear: 'none'    },
    { id: 'unicorn', name: 'Unicorn',    rarity: 'rare',      points: 60,  weight: 7,  body: '#e7d7ff', belly: '#ffffff', accent: '#b98cff', ear: 'pointed', horn: true },
    { id: 'dragon',  name: 'Dragon',     rarity: 'legendary', points: 150, weight: 3,  body: '#7ad17a', belly: '#dff5cf', accent: '#3f9b54', ear: 'pointed', horn: true },
  ];
  const PLUSH_BY_ID = Object.fromEntries(PLUSH_TYPES.map(p => [p.id, p]));
  const RARITY_COLOR = { common: '#9fb2c9', uncommon: '#5ec8e0', rare: '#c08bff', legendary: '#ffcc4d' };

  // ---------------------------------------------------------------------------
  // Unlockable themes (recolor cabinet + page) gated by total points
  // ---------------------------------------------------------------------------
  const THEMES = {
    classic: { name: 'Classic', threshold: 0 },
    candy:   { name: 'Candy',   threshold: 100 },
    galaxy:  { name: 'Galaxy',  threshold: 300 },
    golden:  { name: 'Golden',  threshold: 1000 },
  };
  const THEME_PALETTE = {
    classic: { page: ['#10203f', '#070d1a'], cab: '#24386b', frame: '#34528f', accent: '#ff5d8f', marquee: '#ff5d8f', glass: 'rgba(170,205,255,0.10)', floor: '#33455f' },
    candy:   { page: ['#3a1030', '#1a0512'], cab: '#7b2a5c', frame: '#a23c7d', accent: '#ffd84d', marquee: '#ffd84d', glass: 'rgba(255,210,235,0.10)', floor: '#6e3a5c' },
    galaxy:  { page: ['#161347', '#05030f'], cab: '#2a2660', frame: '#4b41a0', accent: '#5ad2ff', marquee: '#a98bff', glass: 'rgba(180,180,255,0.10)', floor: '#2f2a55' },
    golden:  { page: ['#3a2c08', '#140e02'], cab: '#6e5314', frame: '#a07c1d', accent: '#fff0a8', marquee: '#ffe27a', glass: 'rgba(255,240,190,0.12)', floor: '#5a481e' },
  };

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  const SAVE_KEY = 'clawmachine.save.v1';
  const defaultSave = () => ({
    coins: 3, points: 0, prizes: 0, counts: {},
    themes: ['classic'], theme: 'classic', sound: true, lastFree: 0,
  });
  let save = defaultSave();

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) save = Object.assign(defaultSave(), JSON.parse(raw));
    } catch (e) { /* storage unavailable; use defaults */ }
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Canvas + projection
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let geo = null; // cached projection geometry

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeGeo();
  }

  function computeGeo() {
    const marqueeH = Math.max(40, H * 0.12);
    const pad = Math.min(W, H) * 0.045;
    const interiorTop = marqueeH + pad;
    const interiorBottom = H - pad;
    // floor trapezoid
    const floorFarY = interiorTop + (interiorBottom - interiorTop) * 0.20;
    const floorNearY = interiorBottom - (interiorBottom - interiorTop) * 0.06;
    geo = {
      marqueeH, pad, interiorTop, interiorBottom,
      floorFarY, floorNearY,
      nearLeft: W * 0.10, nearRight: W * 0.90,
      farLeft: W * 0.30, farRight: W * 0.70,
      railY: interiorTop + 10,
      farScale: 0.60,
    };
  }

  // world (x:0..1 left→right, z:0..1 near→far) → screen
  function project(x, z) {
    const t = z;
    const leftX = lerp(geo.nearLeft, geo.farLeft, t);
    const rightX = lerp(geo.nearRight, geo.farRight, t);
    return {
      sx: lerp(leftX, rightX, x),
      sy: lerp(geo.floorNearY, geo.floorFarY, t),
      scale: lerp(1, geo.farScale, t),
    };
  }

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  let phase = 'title'; // title|ready|aim|descend|close|ascend|carry|release|result|gameover
  let phaseT = 0;
  let aimTimer = 0;
  const claw = { x: CLAW_HOME.x, z: CLAW_HOME.z, drop: 0, prong: 0 }; // drop 0..1, prong 0(open)..1(closed)
  let held = null;          // plush currently held
  let plushies = [];
  let lastResult = null;    // 'win'|'miss'|'chaos'
  let resultPlush = null;
  const press = { left: false, right: false, up: false, down: false };
  let boxBounce = 0;
  let toast = null, toastT = 0;

  function pickType() {
    const total = PLUSH_TYPES.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of PLUSH_TYPES) { if ((r -= p.weight) <= 0) return p; }
    return PLUSH_TYPES[0];
  }

  function spawnPlush() {
    // avoid the chute corner (front-left)
    let x, z, tries = 0;
    do {
      x = rand(0.18, 0.9);
      z = rand(0.12, 0.92);
      tries++;
    } while (tries < 30 && plushies.some(p => Math.hypot(p.x - x, p.z - z) < 0.14));
    const t = pickType();
    plushies.push({ type: t.id, x, z, rot: rand(-0.3, 0.3), vy: 0, fall: 0 });
  }

  function fillField() {
    while (plushies.length < FIELD_MIN) spawnPlush();
  }

  function nearestPlush(x, z) {
    let best = null, bestD = Infinity;
    for (const p of plushies) {
      if (p === held) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return { plush: best, dist: bestD };
  }

  // ---------------------------------------------------------------------------
  // Phase transitions
  // ---------------------------------------------------------------------------
  function setPhase(p) {
    phase = p;
    phaseT = 0;
    updateActionBtn();
    updateTimerBar();
  }

  function insertCoin() {
    if (phase !== 'ready' || save.coins <= 0) return;
    save.coins--;
    persist();
    GameAudio.unlock();
    GameAudio.play('coin');
    claw.x = CLAW_HOME.x; claw.z = CLAW_HOME.z; claw.drop = 0; claw.prong = 0;
    held = null;
    aimTimer = AIM_TIME;
    setPhase('aim');
    refreshHud();
  }

  function dropClaw() {
    if (phase !== 'aim') return;
    GameAudio.play('descend');
    setPhase('descend');
  }

  function resolveGrab() {
    const { plush, dist } = nearestPlush(claw.x, claw.z);
    if (plush && dist <= GRAB_RADIUS && Math.random() < GRAB_CHANCE) {
      held = plush;
    } else {
      held = null;
    }
  }

  function finishCarryDrop(kind) {
    // kind: 'win' | 'chaos'
    if (kind === 'win' && held) {
      const t = PLUSH_BY_ID[held.type];
      save.points += t.points;
      save.prizes += 1;
      save.counts[held.type] = (save.counts[held.type] || 0) + 1;
      plushies = plushies.filter(p => p !== held); // collected
      resultPlush = held;
      held = null;
      lastResult = 'win';
      boxBounce = 1;
      GameAudio.play('win');
      checkUnlocks();
      fillField();
      persist();
    } else if (kind === 'chaos' && held) {
      // plush slips back onto the floor
      held.x = clamp(claw.x, 0.16, 0.92);
      held.z = clamp(claw.z, 0.1, 0.92);
      held.fall = 1;
      resultPlush = held;
      held = null;
      lastResult = 'chaos';
      GameAudio.play('chaos');
    }
  }

  function endRoundMiss() {
    lastResult = 'miss';
    resultPlush = null;
    GameAudio.play('lose');
  }

  function checkUnlocks() {
    for (const id in THEMES) {
      if (!save.themes.includes(id) && save.points >= THEMES[id].threshold && THEMES[id].threshold > 0) {
        save.themes.push(id);
        showToast(`Unlocked theme: ${THEMES[id].name}!`);
        GameAudio.play('unlock');
      }
    }
  }

  function showToast(msg) { toast = msg; toastT = 3.2; }

  // ---------------------------------------------------------------------------
  // Update loop (state machine)
  // ---------------------------------------------------------------------------
  function update(dt) {
    phaseT += dt;
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) toast = null; }
    if (boxBounce > 0) boxBounce = Math.max(0, boxBounce - dt * 2.5);

    // settle falling plushies (chaos / spawn)
    for (const p of plushies) if (p.fall > 0) p.fall = Math.max(0, p.fall - dt * 3);

    switch (phase) {
      case 'aim': {
        let moved = false;
        if (press.left)  { claw.x = clamp(claw.x - MOVE_X * dt, 0.06, 0.94); moved = true; }
        if (press.right) { claw.x = clamp(claw.x + MOVE_X * dt, 0.06, 0.94); moved = true; }
        if (press.up)    { claw.z = clamp(claw.z + MOVE_Z * dt, 0.05, 0.95); moved = true; }
        if (press.down)  { claw.z = clamp(claw.z - MOVE_Z * dt, 0.05, 0.95); moved = true; }
        if (moved && Math.random() < 0.15) GameAudio.play('move');
        aimTimer -= dt;
        updateTimerBar();
        if (aimTimer <= 0) { aimTimer = 0; updateTimerBar(); dropClaw(); }
        break;
      }
      case 'descend': {
        claw.drop = Math.min(1, phaseT / 1.1);
        if (claw.drop >= 1) { GameAudio.play('clunk'); setPhase('close'); }
        break;
      }
      case 'close': {
        claw.prong = Math.min(1, phaseT / 0.5);
        if (phaseT >= 0.18 && held === null && lastResult !== '_resolved') {
          resolveGrab();
          lastResult = '_resolved';
        }
        if (claw.prong >= 1) setPhase('ascend');
        break;
      }
      case 'ascend': {
        claw.drop = Math.max(0, 1 - phaseT / 1.0);
        if (claw.drop <= 0) {
          if (held) { setPhase('carry'); claw._chaosRolled = false; }
          else { endRoundMiss(); setPhase('result'); }
        }
        break;
      }
      case 'carry': {
        const t = Math.min(1, phaseT / 1.5);
        // smooth eased approach toward the chute
        claw.x += (CLAW_HOME.x - claw.x) * Math.min(1, dt * 3.2);
        claw.z += (CLAW_HOME.z - claw.z) * Math.min(1, dt * 3.2);
        if (!claw._chaosRolled && t >= 0.45) {
          claw._chaosRolled = true;
          if (Math.random() < CHAOS_DROP_CHANCE) {
            finishCarryDrop('chaos');
            setPhase('result');
            break;
          }
        }
        if (t >= 1) { claw.x = CLAW_HOME.x; claw.z = CLAW_HOME.z; setPhase('release'); }
        break;
      }
      case 'release': {
        claw.prong = Math.max(0, 1 - phaseT / 0.45);
        if (held && phaseT > 0.15) { held.fall = Math.min(1.6, (held.fall || 0) + dt * 2.5); }
        if (phaseT >= 0.5) {
          if (lastResult !== 'win') finishCarryDrop('win'); // award now (drop into box)
          setPhase('result');
        }
        break;
      }
      case 'result': {
        if (phaseT >= 1.7) {
          // reset claw state for next round
          claw.prong = 0; claw.drop = 0;
          lastResult = null; resultPlush = null;
          if (save.coins <= 0) setPhase('gameover'); else setPhase('ready');
          refreshHud();
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function pal() { return THEME_PALETTE[save.theme] || THEME_PALETTE.classic; }

  function render() {
    const p = pal();
    ctx.clearRect(0, 0, W, H);

    // backdrop behind machine
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, p.page[0]);
    bg.addColorStop(1, p.page[1]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawCabinetBack(p);
    drawFloor(p);

    // draw prizes + claw with painter's algorithm (far first)
    const drawables = [];
    for (const pl of plushies) if (pl !== held) drawables.push({ kind: 'plush', z: pl.z, obj: pl });
    drawables.push({ kind: 'claw', z: claw.z });
    drawables.sort((a, b) => b.z - a.z);
    for (const d of drawables) {
      if (d.kind === 'plush') drawFieldPlush(d.obj);
      else drawClaw(p);
    }

    drawChute(p);
    drawCabinetFront(p);
    drawMarquee(p);
  }

  function drawCabinetBack(p) {
    const g = geo;
    // back wall of interior
    ctx.fillStyle = shade(p.cab, -18);
    ctx.fillRect(g.farLeft - 6, g.interiorTop, (g.farRight - g.farLeft) + 12, g.floorFarY - g.interiorTop + 4);
    // side walls (trapezoids) for depth
    ctx.fillStyle = shade(p.cab, -34);
    ctx.beginPath();
    ctx.moveTo(g.nearLeft, g.interiorTop);
    ctx.lineTo(g.farLeft, g.interiorTop);
    ctx.lineTo(g.farLeft, g.floorFarY);
    ctx.lineTo(g.nearLeft, g.floorNearY);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(g.nearRight, g.interiorTop);
    ctx.lineTo(g.farRight, g.interiorTop);
    ctx.lineTo(g.farRight, g.floorFarY);
    ctx.lineTo(g.nearRight, g.floorNearY);
    ctx.closePath(); ctx.fill();
  }

  function drawFloor(p) {
    const g = geo;
    const grd = ctx.createLinearGradient(0, g.floorFarY, 0, g.floorNearY);
    grd.addColorStop(0, shade(p.floor, -22));
    grd.addColorStop(1, shade(p.floor, 8));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(g.farLeft, g.floorFarY);
    ctx.lineTo(g.farRight, g.floorFarY);
    ctx.lineTo(g.nearRight, g.floorNearY);
    ctx.lineTo(g.nearLeft, g.floorNearY);
    ctx.closePath(); ctx.fill();
  }

  function drawMarquee(p) {
    const g = geo;
    const grd = ctx.createLinearGradient(0, 0, 0, g.marqueeH);
    grd.addColorStop(0, shade(p.frame, 14));
    grd.addColorStop(1, shade(p.frame, -16));
    ctx.fillStyle = grd;
    roundRect(0, 0, W, g.marqueeH, 0);
    ctx.fill();
    // title text
    ctx.fillStyle = p.marquee;
    ctx.shadowColor = p.marquee;
    ctx.shadowBlur = 18;
    ctx.font = `800 ${Math.round(g.marqueeH * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CLAW CRAZE', W / 2, g.marqueeH * 0.52);
    ctx.shadowBlur = 0;
    // bulbs
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const n = Math.floor(W / 38);
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.arc((i + 0.5) * (W / (n + 1)), g.marqueeH - 5, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCabinetFront(p) {
    const g = geo;
    // frame (left/right/bottom posts) over the interior
    ctx.fillStyle = p.frame;
    const fw = g.pad * 0.7;
    ctx.fillRect(0, g.marqueeH, fw, H - g.marqueeH);
    ctx.fillRect(W - fw, g.marqueeH, fw, H - g.marqueeH);
    ctx.fillRect(0, H - g.pad * 0.7, W, g.pad * 0.7);
    // glass sheen
    const sheen = ctx.createLinearGradient(0, g.interiorTop, W, g.interiorBottom);
    sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    sheen.addColorStop(1, p.glass);
    ctx.fillStyle = sheen;
    ctx.fillRect(fw, g.marqueeH, W - 2 * fw, H - g.marqueeH - g.pad * 0.7);
    // diagonal glare
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.moveTo(W * 0.18, g.marqueeH);
    ctx.lineTo(W * 0.46, g.interiorBottom);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  function drawChute(p) {
    const g = geo;
    const c = project(CLAW_HOME.x, CLAW_HOME.z);
    const w = W * 0.20, h = w * 0.42;
    const bx = c.sx - w * 0.5;
    const by = g.floorNearY - h * 0.35 - boxBounce * 8;
    // opening shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(bx, by - h * 0.2, w, h, 8); ctx.fill();
    // box
    const bg = ctx.createLinearGradient(0, by, 0, by + h);
    bg.addColorStop(0, shade(p.accent, 6));
    bg.addColorStop(1, shade(p.accent, -28));
    ctx.fillStyle = bg;
    roundRect(bx, by, w, h, 8); ctx.fill();
    // label
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `800 ${Math.round(h * 0.34)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('PRIZES', c.sx, by + h * 0.55);
  }

  function drawClaw(p) {
    const g = geo;
    const fp = project(claw.x, claw.z);
    const s = fp.scale;
    const railY = g.railY;
    const targetY = fp.sy - 34 * s;          // grab height (just above floor)
    const clawY = lerp(railY, targetY, claw.drop);
    const cx = fp.sx;

    // rail + trolley
    ctx.strokeStyle = shade(p.frame, 22);
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(g.nearLeft, railY); ctx.lineTo(g.nearRight, railY); ctx.stroke();
    ctx.fillStyle = shade(p.frame, 30);
    roundRect(cx - 18, railY - 8, 36, 14, 4); ctx.fill();
    // cable
    ctx.strokeStyle = '#cfd6e2';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, railY); ctx.lineTo(cx, clawY - 18 * s); ctx.stroke();

    // held plush hangs below prongs
    if (held) {
      const ph = PLUSH_BY_ID[held.type];
      const hy = clawY + 26 * s + (held.fall || 0) * 30;
      drawPlushShape(ph, cx, hy, 26 * s);
    }

    // claw head
    ctx.save();
    ctx.translate(cx, clawY);
    ctx.scale(s, s);
    // hub
    const hub = ctx.createLinearGradient(0, -20, 0, 6);
    hub.addColorStop(0, '#eef2f8'); hub.addColorStop(1, '#8a93a6');
    ctx.fillStyle = hub;
    roundRect(-16, -20, 32, 22, 6); ctx.fill();
    ctx.strokeStyle = '#5b6273'; ctx.lineWidth = 1.5; roundRect(-16, -20, 32, 22, 6); ctx.stroke();
    // three prongs; spread depends on prong (1=closed)
    const spread = lerp(20, 5, claw.prong);
    drawProng(-spread, -1);
    drawProng(spread, 1);
    drawProng(0, 0, true);
    ctx.restore();
  }

  function drawProng(offset, dir, center) {
    ctx.save();
    ctx.strokeStyle = '#aeb6c6';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    if (center) {
      ctx.lineTo(0, 26);
    } else {
      ctx.quadraticCurveTo(offset, 16, offset * 0.6, 28);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawFieldPlush(pl) {
    const fp = project(pl.x, pl.z);
    const t = PLUSH_BY_ID[pl.type];
    const size = 30 * fp.scale;
    const y = fp.sy - size * 0.6 + (pl.fall || 0) * 6;
    // soft shadow on floor
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(fp.sx, fp.sy, size * 0.7, size * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    drawPlushShape(t, fp.sx, y, size, pl.rot);
  }

  // Cute chibi plush: one big round head/body + ears + face (+ optional horn).
  function drawPlushShape(t, cx, cy, r, rot = 0) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot * 0.4);

    // ears (behind body)
    ctx.fillStyle = t.body;
    if (t.ear === 'round') {
      circle(-r * 0.62, -r * 0.7, r * 0.4); ctx.fill();
      circle(r * 0.62, -r * 0.7, r * 0.4); ctx.fill();
      ctx.fillStyle = shade(t.body, 24);
      circle(-r * 0.62, -r * 0.7, r * 0.22); ctx.fill();
      circle(r * 0.62, -r * 0.7, r * 0.22); ctx.fill();
    } else if (t.ear === 'long') {
      ear(-r * 0.45, -r * 1.25, r * 0.26, r * 0.75, t, -0.12);
      ear(r * 0.45, -r * 1.25, r * 0.26, r * 0.75, t, 0.12);
    } else if (t.ear === 'pointed') {
      tri(-r * 0.78, -r * 0.55, r * 0.5, t.body);
      tri(r * 0.78, -r * 0.55, r * 0.5, t.body);
    }

    // body (radial gradient)
    const bg = ctx.createRadialGradient(-r * 0.25, -r * 0.35, r * 0.2, 0, 0, r * 1.15);
    bg.addColorStop(0, shade(t.body, 26));
    bg.addColorStop(1, shade(t.body, -10));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();

    // belly
    ctx.fillStyle = t.belly;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.28, r * 0.55, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // horn
    if (t.horn) tri(0, -r * 1.05, r * 0.34, '#ffd34d', r * 0.7);

    // eyes
    ctx.fillStyle = '#23282f';
    circle(-r * 0.28, -r * 0.12, r * 0.12); ctx.fill();
    circle(r * 0.28, -r * 0.12, r * 0.12); ctx.fill();
    ctx.fillStyle = '#fff';
    circle(-r * 0.24, -r * 0.16, r * 0.04); ctx.fill();
    circle(r * 0.32, -r * 0.16, r * 0.04); ctx.fill();

    // nose / muzzle
    ctx.fillStyle = t.accent;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.06, r * 0.1, r * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();

    // cheeks
    ctx.fillStyle = 'rgba(255,120,150,0.35)';
    circle(-r * 0.5, r * 0.08, r * 0.12); ctx.fill();
    circle(r * 0.5, r * 0.08, r * 0.12); ctx.fill();

    // feet
    ctx.fillStyle = shade(t.body, -8);
    ctx.beginPath(); ctx.ellipse(-r * 0.4, r * 0.92, r * 0.26, r * 0.18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.4, r * 0.92, r * 0.26, r * 0.18, 0, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  function ear(x, y, w, h, t, tilt) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.fillStyle = t.body;
    ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(t.body, 26);
    ctx.beginPath(); ctx.ellipse(0, h * 0.1, w * 0.5, h * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function tri(x, y, s, color, h) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - (h || s));
    ctx.lineTo(x - s * 0.5, y + s * 0.4);
    ctx.lineTo(x + s * 0.5, y + s * 0.4);
    ctx.closePath(); ctx.fill();
  }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

  // ---------------------------------------------------------------------------
  // Canvas helpers
  // ---------------------------------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function shade(hex, amt) {
    const c = hexToRgb(hex);
    if (!c) return hex;
    const f = (v) => clamp(Math.round(v + amt * 2.55), 0, 255);
    return `rgb(${f(c.r)},${f(c.g)},${f(c.b)})`;
  }
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }

  // ---------------------------------------------------------------------------
  // DOM / HUD / overlays
  // ---------------------------------------------------------------------------
  const el = (id) => document.getElementById(id);
  const hudCoins = el('hud-coins'), hudPoints = el('hud-points'), hudPrizes = el('hud-prizes');
  const timerFill = el('timerfill'), timerWrap = el('timerbar');
  const actionBtn = el('btn-action');
  const dpad = el('dpad');

  function refreshHud() {
    hudCoins.textContent = save.coins;
    hudPoints.textContent = save.points;
    hudPrizes.textContent = save.prizes;
    updateActionBtn();
  }
  function updateTimerBar() {
    const show = phase === 'aim';
    timerWrap.classList.toggle('hidden', !show);
    if (show) {
      const pct = clamp(aimTimer / AIM_TIME, 0, 1) * 100;
      timerFill.style.width = pct + '%';
      timerFill.classList.toggle('low', aimTimer < 6);
    }
  }
  function updateActionBtn() {
    dpad.classList.toggle('disabled', phase !== 'aim');
    if (phase === 'ready') {
      actionBtn.textContent = save.coins > 0 ? 'INSERT COIN' : 'OUT OF COINS';
      actionBtn.disabled = save.coins <= 0;
      actionBtn.dataset.role = 'insert';
    } else if (phase === 'aim') {
      actionBtn.textContent = 'DROP!';
      actionBtn.disabled = false;
      actionBtn.dataset.role = 'drop';
    } else {
      actionBtn.textContent = '…';
      actionBtn.disabled = true;
      actionBtn.dataset.role = 'none';
    }
  }

  // overlays
  function showOverlay(id) { el(id).classList.remove('hidden'); }
  function hideOverlay(id) { el(id).classList.add('hidden'); }

  // result + gameover are rendered as transient banners driven by phase
  function syncBanners() {
    const rb = el('result-banner');
    if (phase === 'result') {
      rb.classList.remove('hidden');
      if (lastResult === 'win' && resultPlush) {
        const t = PLUSH_BY_ID[resultPlush.type];
        rb.className = 'banner win';
        rb.innerHTML = `<div class="big">PRIZE!</div><div>${t.name} <span class="pts">+${t.points}</span></div>`;
      } else if (lastResult === 'chaos') {
        rb.className = 'banner chaos';
        rb.innerHTML = `<div class="big">OH NO!</div><div>The claw dropped it! 🫣</div>`;
      } else {
        rb.className = 'banner miss';
        rb.innerHTML = `<div class="big">SO CLOSE!</div><div>Try again 🎯</div>`;
      }
    } else {
      rb.classList.add('hidden');
    }
    el('overlay-gameover').classList.toggle('hidden', phase !== 'gameover');
    if (phase === 'gameover') updateFreeCoin();
  }

  // free coins (rewarded-bonus stub)
  function freeCoinRemaining() {
    const now = Date.now() / 1000;
    return Math.max(0, FREE_COIN_COOLDOWN - (now - save.lastFree));
  }
  function updateFreeCoin() {
    const btn = el('btn-freecoin');
    const r = freeCoinRemaining();
    if (r > 0) { btn.disabled = true; btn.textContent = `Free coins in ${Math.ceil(r)}s`; }
    else { btn.disabled = false; btn.textContent = '🎁 Get 3 Free Coins'; }
  }
  function claimFreeCoins() {
    if (freeCoinRemaining() > 0) return;
    save.coins += 3; save.lastFree = Date.now() / 1000; persist();
    GameAudio.play('coin');
    hideOverlay('overlay-gameover');
    setPhase('ready'); refreshHud();
  }

  // menu (themes + collection)
  function openMenu() {
    buildThemeList();
    buildCollection();
    el('menu-sound').textContent = save.sound ? '🔊 Sound: On' : '🔈 Sound: Off';
    showOverlay('overlay-menu');
  }
  function buildThemeList() {
    const wrap = el('theme-list');
    wrap.innerHTML = '';
    for (const id in THEMES) {
      const th = THEMES[id];
      const unlocked = save.themes.includes(id);
      const div = document.createElement('button');
      div.className = 'theme-chip' + (save.theme === id ? ' active' : '') + (unlocked ? '' : ' locked');
      const sw = THEME_PALETTE[id];
      div.innerHTML = `<span class="sw" style="background:linear-gradient(135deg,${sw.frame},${sw.accent})"></span>` +
        `<span>${th.name}</span>` + (unlocked ? '' : `<span class="lock">🔒 ${th.threshold}pts</span>`);
      div.onclick = () => {
        if (!unlocked) { showToast(`Reach ${th.threshold} points to unlock ${th.name}`); return; }
        save.theme = id; persist(); applyTheme(); buildThemeList();
      };
      wrap.appendChild(div);
    }
  }
  function buildCollection() {
    const wrap = el('collection');
    wrap.innerHTML = '';
    for (const t of PLUSH_TYPES) {
      const n = save.counts[t.id] || 0;
      const div = document.createElement('div');
      div.className = 'coll-item' + (n === 0 ? ' empty' : '');
      div.innerHTML =
        `<canvas width="80" height="80"></canvas>` +
        `<div class="cname" style="color:${RARITY_COLOR[t.rarity]}">${t.name}</div>` +
        `<div class="ccount">${n > 0 ? '×' + n : '— locked —'}</div>`;
      wrap.appendChild(div);
      const c2 = div.querySelector('canvas').getContext('2d');
      c2.clearRect(0, 0, 80, 80);
      if (n === 0) c2.globalAlpha = 0.18;
      drawPlushShapeOn(c2, t, 40, 42, 24);
    }
  }

  // applyTheme: set body bg to match canvas page palette
  function applyTheme() {
    const p = pal();
    document.body.style.background =
      `radial-gradient(1200px 800px at 50% -10%, ${p.page[0]}, ${p.page[1]})`;
  }

  // ---------------------------------------------------------------------------
  // Input wiring
  // ---------------------------------------------------------------------------
  function holdButton(id, dir) {
    const b = el(id);
    const on = (e) => { e.preventDefault(); press[dir] = true; };
    const off = (e) => { e.preventDefault(); press[dir] = false; };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('pointercancel', off);
  }

  function wireInput() {
    holdButton('btn-left', 'left');
    holdButton('btn-right', 'right');
    holdButton('btn-up', 'up');
    holdButton('btn-down', 'down');

    actionBtn.addEventListener('click', () => {
      GameAudio.unlock();
      if (actionBtn.dataset.role === 'insert') insertCoin();
      else if (actionBtn.dataset.role === 'drop') dropClaw();
    });

    el('btn-play').addEventListener('click', () => {
      GameAudio.unlock();
      if (save.sound) GameAudio.startMusic();
      hideOverlay('overlay-title');
      setPhase(save.coins > 0 ? 'ready' : 'gameover');
      refreshHud();
    });

    el('btn-freecoin').addEventListener('click', claimFreeCoins);
    el('btn-menu').addEventListener('click', openMenu);
    el('btn-menu-close').addEventListener('click', () => hideOverlay('overlay-menu'));
    el('menu-sound').addEventListener('click', () => {
      save.sound = !save.sound; persist();
      GameAudio.setEnabled(save.sound);
      el('menu-sound').textContent = save.sound ? '🔊 Sound: On' : '🔈 Sound: Off';
      el('btn-sound').textContent = save.sound ? '🔊' : '🔈';
    });
    el('btn-sound').addEventListener('click', () => {
      save.sound = !save.sound; persist();
      GameAudio.setEnabled(save.sound);
      el('btn-sound').textContent = save.sound ? '🔊' : '🔈';
    });
    el('menu-reset').addEventListener('click', () => {
      if (confirm('Reset all progress, coins, points and prizes?')) {
        save = defaultSave(); persist(); applyTheme(); refreshHud();
        hideOverlay('overlay-menu'); plushies = []; fillField();
        setPhase('ready');
      }
    });

    // keyboard (desktop)
    window.addEventListener('keydown', (e) => {
      if (phase === 'aim') {
        if (e.key === 'ArrowLeft') press.left = true;
        else if (e.key === 'ArrowRight') press.right = true;
        else if (e.key === 'ArrowUp') press.up = true;
        else if (e.key === 'ArrowDown') press.down = true;
        else if (e.key === ' ') { e.preventDefault(); dropClaw(); }
      } else if (e.key === ' ' && phase === 'ready') {
        e.preventDefault(); insertCoin();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft') press.left = false;
      else if (e.key === 'ArrowRight') press.right = false;
      else if (e.key === 'ArrowUp') press.up = false;
      else if (e.key === 'ArrowDown') press.down = false;
    });

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  }

  // ---------------------------------------------------------------------------
  // Toast renderer (DOM)
  // ---------------------------------------------------------------------------
  function syncToast() {
    const t = el('toast');
    if (toast) { t.textContent = toast; t.classList.remove('hidden'); }
    else t.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  let last = 0;
  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    update(dt);
    render();
    syncBanners();
    syncToast();
    if (phase === 'gameover') updateFreeCoin();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function boot() {
    loadSave();
    // Honor the saved mute state, but don't start music until the first
    // user gesture (Play), per mobile autoplay rules.
    if (!save.sound) GameAudio.setEnabled(false);
    el('btn-sound').textContent = save.sound ? '🔊' : '🔈';
    resize();
    fillField();
    applyTheme();
    refreshHud();
    wireInput();
    showOverlay('overlay-title');
    requestAnimationFrame(frame);
  }

  // Compact, context-agnostic plush drawer used for the collection thumbnails.
  function drawPlushShapeOn(c, t, cx, cy, r) {
    c.save();
    c.translate(cx, cy);
    // ears
    c.fillStyle = t.body;
    if (t.ear === 'round') {
      mc(c, -r*0.62,-r*0.7,r*0.4); mc(c, r*0.62,-r*0.7,r*0.4);
    } else if (t.ear === 'pointed') {
      mtri(c,-r*0.78,-r*0.55,r*0.5,t.body); mtri(c,r*0.78,-r*0.55,r*0.5,t.body);
    } else if (t.ear === 'long') {
      c.beginPath(); c.ellipse(-r*0.4,-r*1.2,r*0.22,r*0.7,0,0,7); c.fill();
      c.beginPath(); c.ellipse(r*0.4,-r*1.2,r*0.22,r*0.7,0,0,7); c.fill();
    }
    // body
    c.fillStyle = t.body;
    c.beginPath(); c.ellipse(0,0,r,r*1.05,0,0,7); c.fill();
    // belly
    c.fillStyle = t.belly;
    c.beginPath(); c.ellipse(0,r*0.28,r*0.55,r*0.6,0,0,7); c.fill();
    if (t.horn) mtri(c,0,-r*1.05,r*0.34,'#ffd34d',r*0.7);
    // eyes
    c.fillStyle='#23282f'; mc(c,-r*0.28,-r*0.12,r*0.12); mc(c,r*0.28,-r*0.12,r*0.12);
    // nose
    c.fillStyle=t.accent; c.beginPath(); c.ellipse(0,r*0.06,r*0.1,r*0.08,0,0,7); c.fill();
    c.restore();
  }
  function mc(c,x,y,r){ c.beginPath(); c.arc(x,y,r,0,7); c.fill(); }
  function mtri(c,x,y,s,color,h){ c.fillStyle=color; c.beginPath(); c.moveTo(x,y-(h||s)); c.lineTo(x-s*0.5,y+s*0.4); c.lineTo(x+s*0.5,y+s*0.4); c.closePath(); c.fill(); }

  boot();
})();
