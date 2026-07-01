// alley.js — the walkable alley: move your character along the counter, walk up
// to Gus / Rosa / the repair bench / the pro shop / the standings board and
// interact. Characters are drawn in code (sprites.js). Launches the existing
// activities; story beats play via story.js.
(() => {
  'use strict';
  const L = window.League, ST = window.Story, SP = window.Sprites;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (id) => document.getElementById(id);

  const cv = $('scene'), ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const WORLD = 1900;
  const SPEED = 4.4;

  function go(url) { window.location.href = url; }
  function bowlNight() {
    if (!L || L.done) { showBoard(); return; }
    const n = L.beginNight();
    if (ST) ST.rivalBanter(n.opp, () => go('lanes.html')); else go('lanes.html');
  }

  const NPCS = [
    { id: 'gus',   x: 260,  name: 'Gus',  label: 'THE LANES', prop: 'lanes',  act: bowlNight },
    { id: 'rosa',  x: 640,  name: 'Rosa', label: 'PIZZA COUNTER', prop: 'pizza', act: () => go('pizza.html'), prompt: 'Help the pizza rush' },
    { id: 'mac',   x: 1010, name: 'Mac',  label: 'REPAIR BAY', prop: 'repair', act: () => go('arcade.html'), prompt: 'Fix the cabinets' },
    { id: 'clerk', x: 1360, name: 'Sal',  label: 'PRO SHOP', prop: 'shop', act: () => go('proshop.html'), prompt: 'Browse the Pro Shop' },
    { id: null,    x: 1680, name: '',     label: 'STANDINGS', prop: 'board', act: () => showBoard(), prompt: 'Check the standings' },
  ];

  const player = { x: 120, y: 0, vx: 0, face: 1, moving: false };
  const keys = {}; let leftHeld = false, rightHeld = false, target = null;
  let camX = 0, near = null, t0 = performance.now();

  // ---------- overlays / prompt ----------
  const dlgOpen = () => { const d = $('dlg'); return d && !d.classList.contains('hidden'); };
  const boardOpen = () => !$('board-ov').classList.contains('hidden');
  const frozen = () => dlgOpen() || boardOpen();

  function showBoard() {
    if (!L) return;
    $('standings').innerHTML = L.standings().map((tm, i) =>
      `<div class="srow${tm.name === L.player ? ' me' : ''}"><span class="t-pos">${i + 1}</span>` +
      `<span class="t-name">${tm.name}</span><span class="t-rec">${tm.w}–${tm.l}</span><span class="t-pf">${tm.pf}</span></div>`
    ).join('');
    $('board-ov').classList.remove('hidden');
  }

  function interact() {
    if (frozen() || !near) return;
    near.act();
  }

  // ---------- drawing ----------
  function drawSign(x, yTop, text) {
    const w = Math.max(90, text.length * 9 + 22);
    ctx.fillStyle = 'rgba(10,14,28,0.92)';
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2;
    roundRect(x - w / 2, yTop, w, 26, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd23f'; ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, yTop + 14);
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawProp(n, groundY, s) {
    const x = n.x, top = groundY - 30 * s;
    ctx.save();
    if (n.prop === 'lanes') {
      // a lane receding to pins
      ctx.fillStyle = '#c98b3e'; ctx.beginPath();
      ctx.moveTo(x - 60, groundY); ctx.lineTo(x + 60, groundY);
      ctx.lineTo(x + 22, groundY - 26 * s); ctx.lineTo(x - 22, groundY - 26 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#eef3ff';
      for (let i = 0; i < 3; i++) ctx.fillRect(x - 10 + i * 9, groundY - 27 * s, 4, 10);
    } else if (n.prop === 'pizza') {
      ctx.fillStyle = '#5a3a2a'; ctx.fillRect(x - 55, groundY - 12 * s, 110, 12 * s);
      ctx.fillStyle = '#8a2f22'; ctx.fillRect(x - 30, top + 8, 60, 34);   // oven
      ctx.fillStyle = '#ffb43f'; ctx.beginPath(); ctx.arc(x, top + 26, 12, 0, Math.PI * 2); ctx.fill();
    } else if (n.prop === 'repair') {
      ctx.fillStyle = '#2b3550'; ctx.fillRect(x - 50, groundY - 11 * s, 100, 11 * s);   // bench
      ctx.fillStyle = '#161226'; ctx.fillRect(x + 20, top, 40, 58); ctx.fillStyle = '#4aa6ff'; ctx.fillRect(x + 26, top + 8, 28, 22); // cabinet
    } else if (n.prop === 'shop') {
      ctx.fillStyle = '#241a0f'; ctx.fillRect(x - 52, top, 104, 64);      // shelf
      const cols = ['#1b9be0', '#ff7d4d', '#b84dff', '#ffd23f'];
      for (let i = 0; i < 4; i++) { ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.arc(x - 34 + i * 22, top + 20, 9, 0, Math.PI * 2); ctx.fill(); }
    } else if (n.prop === 'board') {
      ctx.fillStyle = '#0e1730'; ctx.strokeStyle = '#39406b'; ctx.lineWidth = 3;
      roundRect(x - 46, top, 92, 66, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4a5a8a'; for (let i = 0; i < 4; i++) ctx.fillRect(x - 36, top + 10 + i * 13, 72, 5);
    }
    ctx.restore();
    drawSign(x, top - 34, n.label);
  }

  function render() {
    const now = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const floorTop = H * 0.60, groundY = H * 0.84;
    const s = Math.max(2.4, H / 165);

    // wall
    const wg = ctx.createLinearGradient(0, 0, 0, floorTop);
    wg.addColorStop(0, '#2a1838'); wg.addColorStop(1, '#3a1f2e');
    ctx.fillStyle = wg; ctx.fillRect(0, 0, W, floorTop);
    // floor
    const fg = ctx.createLinearGradient(0, floorTop, 0, H);
    fg.addColorStop(0, '#b9843e'); fg.addColorStop(1, '#7a5423');
    ctx.fillStyle = fg; ctx.fillRect(0, floorTop, W, H - floorTop);

    ctx.save(); ctx.translate(-camX, 0);
    // scrolling floor seams (movement feedback)
    ctx.strokeStyle = 'rgba(60,35,15,0.4)'; ctx.lineWidth = 2;
    for (let wx = 0; wx <= WORLD; wx += 70) { ctx.beginPath(); ctx.moveTo(wx, floorTop); ctx.lineTo(wx, H); ctx.stroke(); }
    // neon
    ctx.fillStyle = '#ff9ec4'; ctx.font = '900 24px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = '#ff5d9e'; ctx.shadowBlur = 16;
    ctx.fillText('STRIKE VALLEY LANES', WORLD / 2, 60); ctx.shadowBlur = 0;

    for (const n of NPCS) drawProp(n, groundY, s);

    // characters (npcs + player), sorted by x-nearness isn't needed; draw npcs then player
    for (const n of NPCS) if (n.id && SP) SP.drawChar(ctx, n.x, groundY, s, n.id, now * 0.3, false, 1);
    if (SP) SP.drawChar(ctx, player.x, groundY, s, 'you', player.moving ? now : 0, player.moving, player.face);

    // interaction chevron
    if (near) { ctx.fillStyle = '#ffd23f'; ctx.font = '900 20px system-ui'; ctx.textAlign = 'center';
      const bob = Math.sin(now * 0.006) * 3;
      ctx.fillText('▼', near.x, groundY - 34 * s + bob); }
    ctx.restore();
  }

  // ---------- update ----------
  function update() {
    if (!frozen()) {
      let dir = 0;
      if (keys['arrowleft'] || keys['a']) dir -= 1;
      if (keys['arrowright'] || keys['d']) dir += 1;
      if (leftHeld) dir -= 1; if (rightHeld) dir += 1;
      if (dir !== 0) target = null;
      if (dir === 0 && target != null) { const d = target - player.x; dir = Math.abs(d) < 5 ? 0 : Math.sign(d); if (dir === 0) target = null; }
      player.vx = dir * SPEED;
      player.x = clamp(player.x + player.vx, 40, WORLD - 40);
      player.moving = Math.abs(player.vx) > 0.1;
      if (dir !== 0) player.face = dir < 0 ? -1 : 1;

      // nearest interactable
      near = null; let best = 80;
      for (const n of NPCS) { const d = Math.abs(n.x - player.x); if (d < best) { best = d; near = n; } }
      updatePrompt();
    }
    // camera
    const tCam = clamp(player.x - W / 2, 0, Math.max(0, WORLD - W));
    camX += (tCam - camX) * 0.15;
  }

  function updatePrompt() {
    const p = $('prompt');
    if (!near) { p.classList.add('hidden'); return; }
    let txt;
    if (near.id === 'gus') {
      if (L && !L.done) { const n = L.activeNight() || L.beginNight(); txt = `Bowl vs <b>${n.opp}</b> · beat ${n.oppScore}`; }
      else txt = 'Season complete — check standings';
    } else txt = near.prompt || ('Talk to ' + near.name);
    p.innerHTML = `● &nbsp;${txt}`;
    p.classList.remove('hidden');
  }

  function loop() { requestAnimationFrame(loop); update(); render(); }

  // ---------- input ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
  }

  function boot() {
    resize(); window.addEventListener('resize', resize);
    player.y = 0;
    if (L && !L.done) L.beginNight();
    // HUD
    if (L) { $('c-week').textContent = L.done ? 'Season over' : 'Week ' + L.week; $('c-rank').textContent = '#' + L.rank(); $('c-money').textContent = '$' + L.money; $('c-ball').textContent = L.equippedBall().name; }

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (dlgOpen()) return;                       // let story.js handle dialogue keys
      keys[k] = true;
      if (k === ' ' || k === 'enter' || k === 'e') { interact(); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

    const hold = (el, set) => {
      const on = (e) => { e.preventDefault(); set(true); }; const off = () => set(false);
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
      el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
    };
    hold($('b-left'), (v) => { leftHeld = v; if (v) target = null; });
    hold($('b-right'), (v) => { rightHeld = v; if (v) target = null; });
    $('b-act').addEventListener('click', interact);
    $('board-close').addEventListener('click', () => $('board-ov').classList.add('hidden'));

    // click / tap floor to walk there
    cv.addEventListener('pointerdown', (e) => { if (frozen()) return; target = clamp(e.clientX + camX, 40, WORLD - 40); });

    if (ST) { ST.init(); ST.onHubLoad(); }
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
