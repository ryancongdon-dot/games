// game.js — Kitchen Kings match state machine.
// M1: boot the 3D court, run the render loop, wire the Play button.
(() => {
  'use strict';

  const el = (id) => document.getElementById(id);
  const canvas = el('scene');

  const G = {
    started: false,
    last: 0,
  };

  function frame(now) {
    const dt = Math.min(0.05, (now - G.last) / 1000 || 0);
    G.last = now;
    Court.update(dt);
    requestAnimationFrame(frame);
  }

  function boot() {
    try {
      Court.init(canvas);
    } catch (e) {
      console.error('[game] Court init failed:', e);
      el('loading').textContent = 'WebGL failed to start.';
      return;
    }
    // start render loop immediately so the menu sits over a live court
    G.last = performance.now();
    requestAnimationFrame(frame);
    el('loading').textContent = '';
  }

  function startMatch() {
    if (G.started) return;
    G.started = true;
    el('menu').classList.add('hidden');
    el('hud').classList.remove('hidden');
    // (match logic arrives in later milestones)
  }

  window.addEventListener('DOMContentLoaded', () => {
    boot();
    el('btnPlay').addEventListener('click', startMatch);
  });

  window.PB = { G, start: startMatch };
})();
