// game.js — Claw Craze logic + UI. Rendering/physics live in scene3d.js (Scene).
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Tunables (grouped for easy balancing)
  // ---------------------------------------------------------------------------
  const AIM_TIME = 20;            // seconds to aim before auto-drop
  // Location-based grab: chance scales with how centered the claw is over a plush.
  const GRAB_MIN = 0.05;          // grab chance at the very edge of reach
  const GRAB_MAX = 0.85;          // grab chance dead-centered on a common prize
  const AIM_SHARPNESS = 1.8;      // higher = must be more precise (faster falloff)
  const CHAOS_DROP_CHANCE = 0.05; // chance to drop the prize mid-carry
  const MOVE_X = 0.46;            // claw horizontal speed (world/sec)
  const MOVE_Z = 0.52;            // claw depth speed (world/sec)
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
    // Real glTF model prize (models/fox.glb). Colors are the pre-load fallback look.
    { id: 'foxy',    name: 'Foxy',       rarity: 'rare',      points: 70,  weight: 6,  body: '#e0712b', belly: '#f3e9da', accent: '#3a2a20', ear: 'pointed', model: 'fox.glb' },
  ];
  const PLUSH_BY_ID = Object.fromEntries(PLUSH_TYPES.map(p => [p.id, p]));
  const RARITY_COLOR = { common: '#9fb2c9', uncommon: '#5ec8e0', rare: '#c08bff', legendary: '#ffcc4d' };
  // Bigger/rarer prizes are harder for the claw to hold on to (like real machines).
  const GRIP_BY_RARITY = { common: 1.0, uncommon: 0.9, rare: 0.65, legendary: 0.45 };

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
    classic: { page: ['#10203f', '#070d1a'], frame: '#34528f', accent: '#ff5d8f', floor: '#33455f' },
    candy:   { page: ['#3a1030', '#1a0512'], frame: '#a23c7d', accent: '#ffd84d', floor: '#6e3a5c' },
    galaxy:  { page: ['#161347', '#05030f'], frame: '#4b41a0', accent: '#5ad2ff', floor: '#2f2a55' },
    golden:  { page: ['#3a2c08', '#140e02'], frame: '#a07c1d', accent: '#ffe27a', floor: '#5a481e' },
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

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  let phase = 'title'; // title|ready|aim|descend|close|ascend|carry|release|result|gameover
  let phaseT = 0;
  let aimTimer = 0;
  const claw = { x: CLAW_HOME.x, z: CLAW_HOME.z, drop: 0, prong: 0 };
  let lastResult = null;   // 'win'|'miss'|'chaos'|'_resolved'
  let resultType = null;   // plush type id of a win (for the banner)
  const press = { left: false, right: false, up: false, down: false };
  let toast = null, toastT = 0;
  const canvas = document.getElementById('game');

  // ---------------------------------------------------------------------------
  // Phase transitions
  // ---------------------------------------------------------------------------
  function setPhase(p) {
    phase = p;
    phaseT = 0;
    Scene.setAimMode(p === 'aim');   // show/hide the aim reticle
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
    const cand = Scene.grabCandidate();      // { item, dist, reach, typeId } or null
    if (!cand) return;                       // nothing under the claw → clean miss
    const align = clamp(1 - cand.dist / cand.reach, 0, 1); // 1 = dead-centered
    const grip = GRIP_BY_RARITY[PLUSH_BY_ID[cand.typeId].rarity] ?? 1;
    const chance = clamp((GRAB_MIN + (GRAB_MAX - GRAB_MIN) * Math.pow(align, AIM_SHARPNESS)) * grip, 0, 0.97);
    if (Math.random() < chance) Scene.attach(cand.item);
  }

  function finishCarryDrop(kind) {
    if (kind === 'win' && Scene.hasHeld()) {
      const id = Scene.heldTypeId();
      const t = PLUSH_BY_ID[id];
      save.points += t.points;
      save.prizes += 1;
      save.counts[id] = (save.counts[id] || 0) + 1;
      resultType = id;
      lastResult = 'win';
      Scene.consumeWin();
      GameAudio.play('win');
      checkUnlocks();
      persist();
    } else if (kind === 'chaos' && Scene.hasHeld()) {
      Scene.release('chaos');
      lastResult = 'chaos';
      GameAudio.play('chaos');
    }
  }

  function endRoundMiss() {
    lastResult = 'miss';
    resultType = null;
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
        claw.drop = Math.min(1, phaseT / 1.2);
        if (claw.drop >= 1) { GameAudio.play('clunk'); setPhase('close'); }
        break;
      }
      case 'close': {
        claw.prong = Math.min(1, phaseT / 0.55);
        if (phaseT >= 0.2 && !Scene.hasHeld() && lastResult !== '_resolved') {
          resolveGrab();
          lastResult = '_resolved';
        }
        if (claw.prong >= 1) setPhase('ascend');
        break;
      }
      case 'ascend': {
        claw.drop = Math.max(0, 1 - phaseT / 1.1);
        if (claw.drop <= 0) {
          if (Scene.hasHeld()) { setPhase('carry'); claw._chaosRolled = false; }
          else { endRoundMiss(); setPhase('result'); }
        }
        break;
      }
      case 'carry': {
        const t = Math.min(1, phaseT / 1.6);
        claw.x += (CLAW_HOME.x - claw.x) * Math.min(1, dt * 3.0);
        claw.z += (CLAW_HOME.z - claw.z) * Math.min(1, dt * 3.0);
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
        if (Scene.hasHeld() && phaseT >= 0.22) finishCarryDrop('win'); // drop into chute
        if (phaseT >= 0.8) setPhase('result');
        break;
      }
      case 'result': {
        if (phaseT >= 1.7) {
          claw.prong = 0; claw.drop = 0;
          lastResult = null; resultType = null;
          if (save.coins <= 0) setPhase('gameover'); else setPhase('ready');
          refreshHud();
        }
        break;
      }
    }
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

  function showOverlay(id) { el(id).classList.remove('hidden'); }
  function hideOverlay(id) { el(id).classList.add('hidden'); }

  function syncBanners() {
    const rb = el('result-banner');
    if (phase === 'result') {
      rb.classList.remove('hidden');
      if (lastResult === 'win' && resultType) {
        const t = PLUSH_BY_ID[resultType];
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

  function applyTheme() {
    const p = THEME_PALETTE[save.theme] || THEME_PALETTE.classic;
    document.body.style.background =
      `radial-gradient(1200px 800px at 50% -10%, ${p.page[0]}, ${p.page[1]})`;
    Scene.applyTheme(p);
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
        hideOverlay('overlay-menu'); Scene.reset();
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

    window.addEventListener('resize', () => Scene.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => Scene.resize(), 200));
  }

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
    Scene.setClaw(claw.x, claw.z, claw.drop, claw.prong);
    Scene.update(dt);
    syncBanners();
    syncToast();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function boot() {
    loadSave();
    if (!save.sound) GameAudio.setEnabled(false);
    el('btn-sound').textContent = save.sound ? '🔊' : '🔈';
    const pal = THEME_PALETTE[save.theme] || THEME_PALETTE.classic;
    Scene.init(canvas, PLUSH_TYPES, pal);
    Scene.fillPile();
    applyTheme();
    refreshHud();
    wireInput();
    showOverlay('overlay-title');
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // Collection thumbnails — compact 2D plush drawer (menu only)
  // ---------------------------------------------------------------------------
  function drawPlushShapeOn(c, t, cx, cy, r) {
    c.save();
    c.translate(cx, cy);
    c.fillStyle = t.body;
    if (t.ear === 'round') {
      mc(c, -r * 0.62, -r * 0.7, r * 0.4); mc(c, r * 0.62, -r * 0.7, r * 0.4);
    } else if (t.ear === 'pointed') {
      mtri(c, -r * 0.78, -r * 0.55, r * 0.5, t.body); mtri(c, r * 0.78, -r * 0.55, r * 0.5, t.body);
    } else if (t.ear === 'long') {
      c.beginPath(); c.ellipse(-r * 0.4, -r * 1.2, r * 0.22, r * 0.7, 0, 0, 7); c.fill();
      c.beginPath(); c.ellipse(r * 0.4, -r * 1.2, r * 0.22, r * 0.7, 0, 0, 7); c.fill();
    }
    c.fillStyle = t.body;
    c.beginPath(); c.ellipse(0, 0, r, r * 1.05, 0, 0, 7); c.fill();
    c.fillStyle = t.belly;
    c.beginPath(); c.ellipse(0, r * 0.28, r * 0.55, r * 0.6, 0, 0, 7); c.fill();
    if (t.horn) mtri(c, 0, -r * 1.05, r * 0.34, '#ffd34d', r * 0.7);
    c.fillStyle = '#23282f'; mc(c, -r * 0.28, -r * 0.12, r * 0.12); mc(c, r * 0.28, -r * 0.12, r * 0.12);
    c.fillStyle = t.accent; c.beginPath(); c.ellipse(0, r * 0.06, r * 0.1, r * 0.08, 0, 0, 7); c.fill();
    c.restore();
  }
  function mc(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); }
  function mtri(c, x, y, s, color, h) { c.fillStyle = color; c.beginPath(); c.moveTo(x, y - (h || s)); c.lineTo(x - s * 0.5, y + s * 0.4); c.lineTo(x + s * 0.5, y + s * 0.4); c.closePath(); c.fill(); }

  boot();
})();
