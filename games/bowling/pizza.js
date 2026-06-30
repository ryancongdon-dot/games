// pizza.js — the Pizza Counter side job. Build each order's pizza, bake it to the
// golden zone, and serve before the customer's patience runs out. Earnings go to
// your league money (League.addMoney) for the Pro Shop.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const L = window.League;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ri = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

  const TOPPINGS = [
    { id: 'mush', icon: '🍄' }, { id: 'pep', icon: '🫑' }, { id: 'cheese', icon: '🧀' },
    { id: 'olive', icon: '🫒' }, { id: 'bacon', icon: '🥓' }, { id: 'pine', icon: '🍍' },
  ];
  const iconOf = (id) => (TOPPINGS.find((t) => t.id === id) || {}).icon || '?';

  const ORDERS = 8;
  const PATIENCE_MS = 15000;        // base patience; shrinks a little each order
  const BAKE_GOOD = [60, 82];       // golden-zone doneness window
  const BAKE_OK = [46, 92];         // edible (lower pay) window

  const S = {
    phase: 'build',                 // build | bake | feedback | done
    idx: 0,                         // order number 0..ORDERS-1
    earned: 0, combo: 0,
    need: [],                       // required topping ids
    on: new Set(),                  // toppings currently on the pizza
    patience: PATIENCE_MS, patienceMax: PATIENCE_MS,
    doneness: 0, dir: 1,
    last: 0,
  };

  // ---- toppings palette ----
  function renderToppingButtons() {
    $('toppings').innerHTML = TOPPINGS.map((t) =>
      `<button class="top-btn" data-top="${t.id}">${t.icon}</button>`).join('');
    $('toppings').querySelectorAll('[data-top]').forEach((el) =>
      el.addEventListener('click', () => toggleTopping(el.getAttribute('data-top'))));
  }
  function toggleTopping(id) {
    if (S.phase !== 'build') return;
    if (S.on.has(id)) S.on.delete(id); else S.on.add(id);
    paintPizza();
    syncButtons();
  }
  function syncButtons() {
    $('toppings').querySelectorAll('[data-top]').forEach((el) =>
      el.classList.toggle('on', S.on.has(el.getAttribute('data-top'))));
  }

  // scatter active toppings on the pie (stable positions per topping)
  function paintPizza() {
    const spots = [[28, 30], [62, 26], [44, 48], [26, 62], [64, 60], [46, 74], [38, 40], [58, 44]];
    let html = '', i = 0;
    for (const id of S.on) {
      for (let k = 0; k < 3; k++) {
        const s = spots[(i * 3 + k) % spots.length];
        const jx = ((i * 7 + k * 13) % 9) - 4, jy = ((i * 5 + k * 11) % 9) - 4;
        html += `<span class="ptop" style="left:${s[0] + jx}%;top:${s[1] + jy}%">${iconOf(id)}</span>`;
      }
      i++;
    }
    $('pizza-tops').innerHTML = html;
  }

  // ---- order flow ----
  function startOrder() {
    S.phase = 'build';
    S.on = new Set();
    const count = clamp(1 + Math.floor(S.idx / 2), 1, 3);   // ramps 1 -> 3 toppings
    const pool = TOPPINGS.map((t) => t.id).sort(() => Math.random() - 0.5);
    S.need = pool.slice(0, count);
    S.patienceMax = PATIENCE_MS - S.idx * 700;
    S.patience = S.patienceMax;
    S.doneness = 0; S.dir = 1;
    $('cust').textContent = '🙂';
    $('order-toppings').innerHTML = S.need.map((id) => `<span class="want-ic">${iconOf(id)}</span>`).join('');
    $('bake-glow').style.opacity = 0;
    $('bakebar').classList.add('hidden');
    $('feedback').textContent = '';
    $('feedback').className = 'feedback';
    setMain('BAKE 🔥', false);
    paintPizza(); syncButtons(); updateChips();
  }

  function setMain(label, disabled) {
    const b = $('btn-main'); b.textContent = label; b.disabled = !!disabled; b.classList.remove('hidden');
  }

  function onMain() {
    if (S.phase === 'build') startBake();
    else if (S.phase === 'bake') stopBake();
  }

  function startBake() {
    S.phase = 'bake';
    S.doneness = 0; S.dir = 1;
    $('bakebar').classList.remove('hidden');
    setMain('STOP! ✋', false);
  }

  function stopBake() {
    S.phase = 'feedback';
    $('btn-main').classList.add('hidden');
    serve();
  }

  function bakeQuality() {
    const d = S.doneness;
    if (d >= BAKE_GOOD[0] && d <= BAKE_GOOD[1]) return 'perfect';
    if (d >= BAKE_OK[0] && d <= BAKE_OK[1]) return 'ok';
    return d < BAKE_OK[0] ? 'raw' : 'burnt';
  }

  function serve() {
    const want = new Set(S.need);
    const match = want.size === S.on.size && [...want].every((id) => S.on.has(id));
    const q = bakeQuality();
    const speedBonus = Math.round((S.patience / S.patienceMax) * 6);
    let pay = 0, msg = '', cls = 'bad';

    if (!match) { pay = 3; msg = 'Wrong toppings! 😠'; cls = 'bad'; S.combo = 0; $('cust').textContent = '😠'; }
    else if (q === 'perfect') {
      pay = 12 + 8 + speedBonus + S.combo * 2; S.combo++;
      msg = `Perfect pie! 🤩 +$${pay}`; cls = 'great'; $('cust').textContent = '😍';
    } else if (q === 'ok') {
      pay = 12 + speedBonus; S.combo = 0;
      msg = `Good enough. +$${pay}`; cls = 'ok'; $('cust').textContent = '🙂';
    } else { // raw / burnt
      pay = 6; S.combo = 0;
      msg = q === 'burnt' ? `Burnt! 🔥 +$${pay}` : `Too raw! 🥶 +$${pay}`; cls = 'bad'; $('cust').textContent = '😕';
    }
    if (match && q !== 'perfect') { /* shows pie done */ }
    $('bake-glow').style.opacity = (q === 'burnt') ? 0.55 : (match ? 0.3 : 0);
    $('bake-glow').style.background = q === 'burnt'
      ? 'radial-gradient(circle, rgba(40,20,0,0.7), transparent 70%)'
      : 'radial-gradient(circle, rgba(255,180,60,0.5), transparent 70%)';

    S.earned += pay;
    flash(msg, cls);
    updateChips();
    setTimeout(nextOrder, 1500);
  }

  function customerLeft() {
    S.phase = 'feedback';
    $('btn-main').classList.add('hidden');
    $('bakebar').classList.add('hidden');
    S.combo = 0; $('cust').textContent = '😤';
    flash('Customer left! 😤 +$0', 'bad');
    updateChips();
    setTimeout(nextOrder, 1400);
  }

  function flash(msg, cls) { const f = $('feedback'); f.textContent = msg; f.className = 'feedback show ' + cls; }

  function nextOrder() {
    S.idx++;
    if (S.idx >= ORDERS) return endShift();
    startOrder();
  }

  function updateChips() {
    $('c-order').textContent = `Order ${Math.min(S.idx + 1, ORDERS)} / ${ORDERS}`;
    $('c-earned').textContent = `$${S.earned}`;
    $('c-combo').textContent = `x${S.combo}`;
  }

  // ---- shift end ----
  function endShift() {
    S.phase = 'done';
    if (L) L.addMoney(S.earned);
    $('sum-title').textContent = S.earned >= 120 ? 'Great shift! 🍕' : 'Shift Over';
    $('sum-body').innerHTML =
      `<div class="big-score">$${S.earned}</div>` +
      `<p>Tips &amp; pay added to your league funds${L ? ` — now <b>$${L.money}</b>.` : '.'}</p>` +
      `<p class="fine">Bake into the golden zone, match the order, and serve fast for combo bonuses.</p>`;
    $('overlay').classList.remove('hidden');
  }

  function newShift() {
    S.idx = 0; S.earned = 0; S.combo = 0;
    $('overlay').classList.add('hidden');
    startOrder();
  }

  // ---- main loop (patience countdown + bake sweep) ----
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = S.last ? now - S.last : 16; S.last = now;
    if (S.phase === 'build') {
      S.patience -= dt;
      const f = clamp(S.patience / S.patienceMax, 0, 1);
      const fill = $('patience-fill');
      fill.style.width = (f * 100) + '%';
      fill.style.background = f > 0.5 ? '#36d07a' : f > 0.25 ? '#ffd23f' : '#ff5d5d';
      if (S.patience <= 0) customerLeft();
    } else if (S.phase === 'bake') {
      S.doneness += S.dir * (dt / 1000) * 95;       // sweep speed
      if (S.doneness >= 100) { S.doneness = 100; S.dir = -1; }
      else if (S.doneness <= 0) { S.doneness = 0; S.dir = 1; }
      $('bake-needle').style.left = S.doneness + '%';
      $('bake-glow').style.opacity = Math.min(0.5, S.doneness / 200);
    }
  }

  function boot() {
    renderToppingButtons();
    $('btn-main').addEventListener('click', onMain);
    $('btn-again').addEventListener('click', newShift);
    $('btn-hub').addEventListener('click', () => { window.location.href = 'index.html'; });
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        if (S.phase === 'build' || S.phase === 'bake') onMain();
        e.preventDefault();
      }
    });
    startOrder();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
