// arcade.js — Repair Bay side job. Broken cabinets come in; rewire each one by
// connecting every wire to its matching colour (mismatches spark & cost time),
// then it powers back on. Fix as many as you can in the shift. Money -> league.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const L = window.League;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const COLORS = ['#ff5d5d', '#4aa6ff', '#39d98a', '#ffd23f', '#b06bff', '#ff8f3f', '#37e0e0'];
  const FAULTS = ['⚡ Short circuit', '🔌 Loose harness', '📺 Dead monitor', '🕹️ No controls',
    '🔊 Silent speakers', '🪙 Coin jam', '💡 Marquee out', '🎛️ Scrambled board'];
  const SHIFT_MS = 75000;
  const SVGNS = 'http://www.w3.org/2000/svg';

  const S = {
    earned: 0, fixed: 0, combo: 0, clock: SHIFT_MS, running: true, last: 0,
    cab: null,            // { n, leftColors, rightColors, doneL, doneR, start, flawed }
    sel: null,            // { side, idx }
  };

  const yFor = (k, n) => (n <= 1 ? 50 : 14 + k * (72 / (n - 1)));

  function newCabinet() {
    const n = clamp(3 + Math.floor(S.fixed / 2), 3, 6);
    const cols = shuffle(COLORS.slice()).slice(0, n);
    S.cab = { n, leftColors: cols.slice(), rightColors: shuffle(cols.slice()),
      doneL: new Array(n).fill(false), doneR: new Array(n).fill(false), start: performance.now(), flawed: false };
    S.sel = null;
    $('fault').textContent = FAULTS[Math.floor(Math.random() * FAULTS.length)];
    $('cabinet').className = 'cabinet';
    $('cab-screen').textContent = '⚡';
    setHint('Connect each wire to the matching colour on the other side.', '');
    renderCabinet();
  }

  function renderCabinet() {
    const c = S.cab, svg = $('wire-svg');
    svg.innerHTML = '';
    let html = '';
    for (let i = 0; i < c.n; i++) {
      html += end('left', i, c.leftColors[i], 10, yFor(i, c.n), c.doneL[i]);
      html += end('right', i, c.rightColors[i], 90, yFor(i, c.n), c.doneR[i]);
    }
    $('ends').innerHTML = html;
    $('ends').querySelectorAll('.end').forEach((el) =>
      el.addEventListener('click', () => pick(el.getAttribute('data-side'), +el.getAttribute('data-idx'))));
    // redraw any existing connections
    for (let i = 0; i < c.n; i++) if (c.doneL[i]) {
      const j = c.rightColors.indexOf(c.leftColors[i]);
      drawWire(yFor(i, c.n), yFor(j, c.n), c.leftColors[i]);
    }
  }
  function end(side, idx, color, x, y, done) {
    return `<div class="end${done ? ' done' : ''}" data-side="${side}" data-idx="${idx}" ` +
      `style="left:${x}%;top:${y}%;background:${color}"></div>`;
  }
  function drawWire(yL, yR, color) {
    const ln = document.createElementNS(SVGNS, 'line');
    ln.setAttribute('x1', 10); ln.setAttribute('y1', yL);
    ln.setAttribute('x2', 90); ln.setAttribute('y2', yR);
    ln.setAttribute('stroke', color);
    $('wire-svg').appendChild(ln);
  }

  function pick(side, idx) {
    if (!S.running || !S.cab) return;
    const c = S.cab;
    if ((side === 'left' && c.doneL[idx]) || (side === 'right' && c.doneR[idx])) return;
    if (!S.sel) { setSel(side, idx); return; }
    if (S.sel.side === side) { setSel(side, idx); return; }        // reselect same side
    const leftIdx = side === 'left' ? idx : S.sel.idx;
    const rightIdx = side === 'right' ? idx : S.sel.idx;
    if (c.leftColors[leftIdx] === c.rightColors[rightIdx]) connect(leftIdx, rightIdx);
    else misWire();
  }

  function setSel(side, idx) {
    S.sel = { side, idx };
    $('ends').querySelectorAll('.end').forEach((el) =>
      el.classList.toggle('sel', el.getAttribute('data-side') === side && +el.getAttribute('data-idx') === idx));
  }
  function clearSel() { S.sel = null; $('ends').querySelectorAll('.end.sel').forEach((el) => el.classList.remove('sel')); }

  function connect(leftIdx, rightIdx) {
    const c = S.cab;
    c.doneL[leftIdx] = true; c.doneR[rightIdx] = true;
    drawWire(yFor(leftIdx, c.n), yFor(rightIdx, c.n), c.leftColors[leftIdx]);
    markDone('left', leftIdx); markDone('right', rightIdx);
    clearSel();
    if (c.doneL.every(Boolean)) cabinetFixed();
  }
  function markDone(side, idx) {
    const el = $('ends').querySelector(`.end[data-side="${side}"][data-idx="${idx}"]`);
    if (el) { el.classList.add('done'); el.classList.remove('sel'); }
  }

  function misWire() {
    const c = S.cab; c.flawed = true; S.combo = 0; S.clock -= 1500;
    clearSel();
    const sp = $('spark'); sp.classList.remove('hidden'); sp.style.animation = 'none';
    void sp.offsetWidth; sp.style.animation = '';
    $('cabinet').classList.add('sparking');
    setHint('Wrong wire — that sparked! (−1.5s)', 'bad');
    setTimeout(() => { sp.classList.add('hidden'); $('cabinet').classList.remove('sparking'); }, 350);
    updateHud();
  }

  function cabinetFixed() {
    const secs = (performance.now() - S.cab.start) / 1000;
    const speed = clamp(Math.round(6 - secs), 0, 6);
    if (!S.cab.flawed) S.combo++;
    const pay = 4 + speed + S.combo * 2;
    S.earned += pay; S.fixed++;
    $('cabinet').className = 'cabinet fixed';
    $('cab-screen').textContent = '🕹️';
    setHint(`Powered on! +$${pay}`, 'good');
    updateHud();
    setTimeout(() => { if (S.running) newCabinet(); }, 950);
  }

  function setHint(msg, cls) { const h = $('hint'); h.textContent = msg; h.className = 'repair-hint' + (cls ? ' ' + cls : ''); }
  function updateHud() {
    $('c-earned').textContent = `$${S.earned}`;
    $('c-fixed').textContent = S.fixed;
    $('c-combo').textContent = `x${S.combo}`;
  }
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = S.last ? now - S.last : 16; S.last = now;
    if (!S.running) return;
    S.clock -= dt;
    $('c-clock').textContent = fmt(S.clock);
    if (S.clock <= 0) endShift();
  }

  function endShift() {
    S.running = false;
    if (L) L.addMoney(S.earned);
    $('sum-title').textContent = S.fixed >= 6 ? 'Ace mechanic! 🔧' : "Shift's over";
    $('sum-body').innerHTML =
      `<div class="big-score">$${S.earned}</div>` +
      `<p>Fixed <b>${S.fixed}</b> cabinets.${L ? ` League funds: <b>$${L.money}</b>.` : ''}</p>` +
      `<p class="fine">Match wires fast and clean (no sparks) to keep your combo — bowling nights still pay best.</p>`;
    $('overlay').classList.remove('hidden');
  }
  function newShift() {
    S.earned = 0; S.fixed = 0; S.combo = 0; S.clock = SHIFT_MS; S.running = true; S.last = 0;
    $('overlay').classList.add('hidden');
    newCabinet(); updateHud();
  }

  function boot() {
    $('btn-again').addEventListener('click', newShift);
    $('btn-hub').addEventListener('click', () => { window.location.href = 'index.html'; });
    updateHud(); newCabinet();
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
