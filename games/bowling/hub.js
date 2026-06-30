// hub.js — the alley home screen. Renders the season state and wires the spots.
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

  function lastResultLine() {
    const r = L.lastResult;
    if (!r) return '';
    return `<div class="m-last">Last night: ${r.win ? 'beat' : 'lost to'} the <b>${r.opp}</b> ${r.you}–${r.oppScore}</div>`;
  }

  function renderMatchup() {
    const m = $('matchup');
    if (L.done) {
      const rank = L.rank();
      const champ = rank === 1;
      m.innerHTML =
        `<div class="m-head">SEASON COMPLETE</div>` +
        `<div class="m-vs">${champ ? '🏆 LEAGUE CHAMPIONS! 🏆' : `You finished #${rank}`}</div>` +
        `<div class="m-target">${champ ? 'Strike Valley takes the title.' : 'There\'s always next season.'}</div>` +
        `<button id="btn-newseason" class="bowl">Start New Season</button>` +
        lastResultLine();
      $('btn-newseason').addEventListener('click', () => { L.startSeason(); render(); toast('New season! Week 1 is on.'); });
      return;
    }
    // lock this week's opponent + target so what we show is what you'll face
    const n = L.beginNight();
    m.innerHTML =
      `<div class="m-head">WEEK ${n.week} · LEAGUE NIGHT</div>` +
      `<div class="m-vs"><span class="me">${L.player}</span><span class="x">vs</span><span class="opp">${n.opp}</span></div>` +
      `<div class="m-target">Beat their <b>${n.oppScore}</b> to win the night</div>` +
      `<button id="btn-bowl" class="bowl">🎳 BOWL LEAGUE NIGHT</button>` +
      lastResultLine();
    $('btn-bowl').addEventListener('click', () => { window.location.href = 'lanes.html'; });
  }

  function renderStandings() {
    const rows = L.standings();
    const me = L.player;
    $('standings').innerHTML = rows.map((t, i) =>
      `<div class="srow${t.name === me ? ' me' : ''}">` +
      `<span class="t-pos">${i + 1}</span>` +
      `<span class="t-name">${t.name}</span>` +
      `<span class="t-rec">${t.w}–${t.l}</span>` +
      `<span class="t-pf">${t.pf}</span></div>`
    ).join('');
  }

  function render() {
    $('c-week').textContent = L.done ? 'Season over' : `Week ${L.week} / ${L.weeks}`;
    $('c-rank').textContent = `#${L.rank()}`;
    $('c-money').textContent = `$${L.money}`;
    $('c-ball').textContent = L.equippedBall().name;
    renderMatchup();
    renderStandings();
  }

  function boot() {
    // "The Lanes" tile launches the same league night as the matchup button
    $('spot-lanes').addEventListener('click', (e) => { e.preventDefault(); if (!L.done) { L.beginNight(); window.location.href = 'lanes.html'; } else toast('Season\'s done — start a new one!'); });
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
