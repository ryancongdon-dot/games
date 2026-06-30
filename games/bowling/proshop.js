// proshop.js — buy & equip bowling balls. Weight drives pin carry; hook scales
// the curve. Uses League for money + ownership.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const L = window.League;

  let toastTimer = null;
  function toast(msg, ms = 1800) {
    const t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  const carryBars = (weight) => bars(Math.max(1, Math.min(5, Math.round((weight - 6) / 10 * 5))));
  const hookLabel = (h) => h < 1.0 ? 'Low' : h < 1.15 ? 'Medium' : h < 1.3 ? 'High' : 'Huge';
  function bars(n) { return '●'.repeat(n) + '○'.repeat(5 - n); }
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');

  function render() {
    $('c-money').textContent = `$${L.money}`;
    $('c-ball').textContent = L.equippedBall().name;

    $('ball-list').innerHTML = L.ballCatalog().map((b) => {
      const owned = L.isOwned(b.id);
      const equipped = L.equippedId() === b.id;
      const afford = L.money >= b.price;
      let btn;
      if (equipped) btn = `<button class="ball-btn equipped" disabled>✓ Equipped</button>`;
      else if (owned) btn = `<button class="ball-btn equip" data-equip="${b.id}">Equip</button>`;
      else btn = `<button class="ball-btn buy" data-buy="${b.id}"${afford ? '' : ' disabled'}>${afford ? 'Buy' : 'Need'} $${b.price}</button>`;
      return `
        <div class="ball-card${equipped ? ' on' : ''}">
          <div class="ball-orb" style="background:radial-gradient(circle at 35% 30%, #fff6, ${hex(b.color)} 55%, #0007)"></div>
          <div class="ball-info">
            <div class="ball-name">${b.name}${b.price === 0 ? ' <span class="free">free</span>' : ''}</div>
            <div class="ball-stats">⚖ ${b.weight} lb · Carry ${carryBars(b.weight)} · Hook ${hookLabel(b.hook)}</div>
            <div class="ball-desc">${b.desc}</div>
          </div>
          <div class="ball-action">${btn}</div>
        </div>`;
    }).join('');

    $('ball-list').querySelectorAll('[data-buy]').forEach((el) =>
      el.addEventListener('click', () => {
        const r = L.buyBall(el.getAttribute('data-buy'));
        if (r.ok) { toast('Bought & equipped! 🎳'); render(); }
        else toast(r.reason === 'money' ? 'Not enough money.' : 'Already owned.');
      }));
    $('ball-list').querySelectorAll('[data-equip]').forEach((el) =>
      el.addEventListener('click', () => { L.equipBall(el.getAttribute('data-equip')); toast('Equipped.'); render(); }));
  }

  function boot() { render(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
