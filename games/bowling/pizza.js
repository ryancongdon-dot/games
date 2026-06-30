// pizza.js — Pizza Counter "dinner rush". Customers sit at the counter with an
// order bubble; tap one to take their order, build & bake their pizza, and serve
// before their patience runs out. Serve as many as you can before close.
// Earnings go to your league money (League.addMoney) for the Pro Shop.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const L = window.League;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const TOPPINGS = [
    { id: 'mush', icon: '🍄' }, { id: 'pep', icon: '🫑' }, { id: 'cheese', icon: '🧀' },
    { id: 'olive', icon: '🫒' }, { id: 'bacon', icon: '🥓' }, { id: 'pine', icon: '🍍' },
  ];
  const iconOf = (id) => (TOPPINGS.find((t) => t.id === id) || {}).icon || '?';
  const FACES = ['🧑', '👩', '👨', '🧓', '👵', '🧔', '👱‍♀️', '👨‍🦰', '👩‍🦱', '🧑‍🦲', '👲', '🧕', '👳', '👩‍🦰'];

  // slots that cover the pie so a topping looks like a full layer, not 3 floaters
  const SLOTS = (() => {
    const s = [[50, 50]];
    const ring = (r, n, off) => {
      for (let i = 0; i < n; i++) { const a = (off + i * 360 / n) * Math.PI / 180; s.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]); }
    };
    ring(17, 6, 0);
    ring(31, 8, 23);
    return s;                                  // 15 evenly-spread slots
  })();

  const SEATS = 5;
  const DAY_MS = 90000;
  const PATIENCE_BASE = 20000;

  const S = {
    seats: new Array(SEATS).fill(null),        // {face, order:[ids], patience, patienceMax, state, say, fill}
    active: -1,
    prep: { phase: 'idle', on: new Set(), doneness: 0, dir: 1 },
    earned: 0, served: 0, combo: 0,
    clock: DAY_MS, spawnTimer: 1400, last: 0, running: true,
  };

  // ---------- customers ----------
  function spawnCustomer() {
    const empty = [];
    S.seats.forEach((s, i) => { if (!s) empty.push(i); });
    if (!empty.length) return;
    const i = empty[Math.floor(Math.random() * empty.length)];
    const count = clamp(1 + Math.floor(S.served / 4), 1, 3);
    const pool = TOPPINGS.map((t) => t.id).sort(() => Math.random() - 0.5);
    const pat = Math.max(11000, PATIENCE_BASE - S.served * 300);
    S.seats[i] = { face: FACES[Math.floor(Math.random() * FACES.length)], order: pool.slice(0, count), patience: pat, patienceMax: pat, state: 'wait', say: '' };
    renderSeats();
  }

  function renderSeats() {
    $('seats').innerHTML = S.seats.map((s, i) => {
      if (!s) return `<div class="seat" data-seat="${i}"><div class="stool"></div></div>`;
      const patPct = Math.round(clamp(s.patience / s.patienceMax, 0, 1) * 100);
      const bubble = (s.state === 'served' || s.state === 'leaving')
        ? `<div class="bubble say">${s.say}</div>`
        : `<div class="bubble"><span class="b-tops">${s.order.map(iconOf).join('')}</span><div class="b-pat"><i style="width:${patPct}%"></i></div></div>`;
      const cls = 'seat occupied' + (i === S.active ? ' active' : '') + (s.state === 'served' ? ' served' : '');
      return `<div class="${cls}" data-seat="${i}">${bubble}<div class="person">${s.face}</div></div>`;
    }).join('');
    // cache patience fills + bind taps
    $('seats').querySelectorAll('.seat').forEach((el) => {
      const i = +el.getAttribute('data-seat');
      const s = S.seats[i];
      if (s) { s.fill = el.querySelector('.b-pat > i') || null; }
      if (s && s.state === 'wait') el.addEventListener('click', () => selectSeat(i));
    });
  }

  // ---------- prep ----------
  function renderToppingButtons() {
    $('toppings').innerHTML = TOPPINGS.map((t) => `<button class="top-btn" data-top="${t.id}">${t.icon}</button>`).join('');
    $('toppings').querySelectorAll('[data-top]').forEach((el) => el.addEventListener('click', () => toggleTopping(el.getAttribute('data-top'))));
  }
  function syncButtons() {
    const dim = S.prep.phase !== 'build';
    $('toppings').querySelectorAll('[data-top]').forEach((el) => {
      el.classList.toggle('on', S.prep.on.has(el.getAttribute('data-top')));
      el.disabled = dim;
    });
  }
  function paintPizza() {
    const arr = [...S.prep.on];
    if (!arr.length) { $('pizza-tops').innerHTML = ''; return; }
    $('pizza-tops').innerHTML = SLOTS.map((p, i) =>
      `<span class="ptop" style="left:${p[0]}%;top:${p[1]}%;--r:${(i * 47) % 360}deg">${iconOf(arr[i % arr.length])}</span>`
    ).join('');
  }

  function selectSeat(i) {
    if (!S.running || S.prep.phase === 'bake') return;
    const s = S.seats[i];
    if (!s || s.state !== 'wait') return;
    S.active = i;
    S.prep.phase = 'build';
    S.prep.on = new Set();
    renderPrep(); paintPizza(); renderSeats();
  }

  function renderPrep() {
    const s = S.active >= 0 ? S.seats[S.active] : null;
    if (!s) {
      $('prep-info').innerHTML = 'Tap a customer to take their order';
      $('btn-main').classList.add('hidden');
      $('bakebar').classList.add('hidden');
    } else {
      $('prep-info').innerHTML = `Order: <span class="needs">${s.order.map(iconOf).join('')}</span> — add toppings &amp; bake`;
      $('btn-main').classList.remove('hidden');
      $('btn-main').textContent = S.prep.phase === 'bake' ? 'STOP! ✋' : 'BAKE 🔥';
      $('btn-main').disabled = false;
      $('bakebar').classList.toggle('hidden', S.prep.phase !== 'bake');
    }
    syncButtons();
  }

  function toggleTopping(id) {
    if (S.prep.phase !== 'build') return;
    if (S.prep.on.has(id)) S.prep.on.delete(id); else S.prep.on.add(id);
    paintPizza(); syncButtons();
  }

  function onMain() {
    if (S.active < 0) return;
    if (S.prep.phase === 'build') { S.prep.phase = 'bake'; S.prep.doneness = 0; S.prep.dir = 1; renderPrep(); }
    else if (S.prep.phase === 'bake') serve();
  }

  function bakeQuality(d) {
    if (d >= 60 && d <= 82) return 'perfect';
    if (d >= 46 && d <= 92) return 'ok';
    return d < 46 ? 'raw' : 'burnt';
  }

  function serve() {
    const i = S.active, s = S.seats[i];
    if (!s) { resetPrep(); return; }
    const want = new Set(s.order);
    const match = want.size === S.prep.on.size && [...want].every((id) => S.prep.on.has(id));
    const q = bakeQuality(S.prep.doneness);
    const speed = Math.round((s.patience / s.patienceMax) * 6);
    let pay = 0, say = '';

    if (!match) { pay = 3; say = 'Not what I ordered 😠'; S.combo = 0; }
    else if (q === 'perfect') { pay = 12 + 8 + speed + S.combo * 2; S.combo++; say = 'This is perfect! 🤩'; }
    else if (q === 'ok') { pay = 12 + speed; S.combo = 0; say = 'This looks good! 😋'; }
    else { pay = 6; S.combo = 0; say = q === 'burnt' ? 'A little burnt… 😕' : 'Kinda raw… 😬'; }

    S.earned += pay; S.served += (match ? 1 : 0);
    s.state = 'served'; s.say = `${say} +$${pay}`;
    S.active = -1; resetPrep(); renderSeats(); updateHud();
    const seatIdx = i;
    setTimeout(() => { if (S.seats[seatIdx] && S.seats[seatIdx].state === 'served') { S.seats[seatIdx] = null; renderSeats(); } }, 1500);
  }

  function resetPrep() {
    S.prep.phase = 'idle'; S.prep.on = new Set(); paintPizza(); renderPrep();
  }

  function customerLeaves(i) {
    const s = S.seats[i]; if (!s) return;
    s.state = 'leaving'; s.say = 'Forget it! 😤'; S.combo = 0;
    if (S.active === i) { S.active = -1; resetPrep(); }
    renderSeats(); updateHud();
    setTimeout(() => { if (S.seats[i] && S.seats[i].state === 'leaving') { S.seats[i] = null; renderSeats(); } }, 1300);
  }

  function updateHud() {
    $('c-earned').textContent = `$${S.earned}`;
    $('c-served').textContent = S.served;
    $('c-combo').textContent = `x${S.combo}`;
  }
  function fmtClock(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  // ---------- main loop ----------
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = S.last ? now - S.last : 16; S.last = now;
    if (!S.running) return;

    S.clock -= dt;
    $('c-clock').textContent = fmtClock(S.clock);
    if (S.clock <= 0) { endShift(); return; }

    // spawn customers (faster as the rush builds)
    S.spawnTimer -= dt;
    if (S.spawnTimer <= 0) {
      spawnCustomer();
      S.spawnTimer = Math.max(2600, 5200 - (DAY_MS - S.clock) / 20);
    }

    // patience ticks for waiting customers (NOT the one you're serving)
    for (let i = 0; i < SEATS; i++) {
      const s = S.seats[i];
      if (!s || s.state !== 'wait' || i === S.active) continue;
      s.patience -= dt;
      if (s.fill) {
        const f = clamp(s.patience / s.patienceMax, 0, 1);
        s.fill.style.width = (f * 100) + '%';
        s.fill.style.background = f > 0.5 ? '#36d07a' : f > 0.25 ? '#ffd23f' : '#ff5d5d';
      }
      if (s.patience <= 0) customerLeaves(i);
    }

    // bake sweep
    if (S.prep.phase === 'bake') {
      S.prep.doneness += S.prep.dir * (dt / 1000) * 95;
      if (S.prep.doneness >= 100) { S.prep.doneness = 100; S.prep.dir = -1; }
      else if (S.prep.doneness <= 0) { S.prep.doneness = 0; S.prep.dir = 1; }
      $('bake-needle').style.left = S.prep.doneness + '%';
    }
  }

  // ---------- shift end ----------
  function endShift() {
    S.running = false;
    if (L) L.addMoney(S.earned);
    $('sum-title').textContent = S.earned >= 150 ? 'Great shift! 🍕' : "That's a wrap";
    $('sum-body').innerHTML =
      `<div class="big-score">$${S.earned}</div>` +
      `<p>Served <b>${S.served}</b> happy customers.${L ? ` League funds: <b>$${L.money}</b>.` : ''}</p>` +
      `<p class="fine">Tip: serve fresh customers fast and bake into the golden zone for combo bonuses.</p>`;
    $('overlay').classList.remove('hidden');
  }
  function newShift() {
    S.seats = new Array(SEATS).fill(null);
    S.active = -1; S.earned = 0; S.served = 0; S.combo = 0;
    S.clock = DAY_MS; S.spawnTimer = 1000; S.running = true;
    resetPrep(); renderSeats(); updateHud();
    $('overlay').classList.add('hidden');
  }

  function boot() {
    renderToppingButtons();
    renderSeats(); updateHud(); renderPrep();
    $('btn-main').addEventListener('click', onMain);
    $('btn-again').addEventListener('click', newShift);
    $('btn-hub').addEventListener('click', () => { window.location.href = 'index.html'; });
    window.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && S.active >= 0) { onMain(); e.preventDefault(); }
    });
    spawnCustomer();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
