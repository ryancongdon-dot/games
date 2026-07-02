// audio.js — procedural sound (Web Audio, no asset files). Exposes `GameAudio`.
// Created lazily on the first user gesture (PLAY / THROW) to satisfy autoplay
// policy. Swap these out later for licensed samples behind the same play() API.
const GameAudio = (() => {
  'use strict';
  let ctx = null, master = null, enabled = true;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.45;
        master.connect(ctx.destination);
      } catch (e) { ctx = null; return; }
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function noiseBuffer(dur) {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // ball rolling on wood: filtered noise that swells then fades
  function roll() {
    const dur = 1.5, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.25);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur);
  }

  // pins struck: a short impact burst + a few wooden clacks
  function hit() {
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.18);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + 0.18);

    const clacks = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < clacks; i++) {
      const t = t0 + Math.random() * 0.22;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 220 + Math.random() * 320;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(cg); cg.connect(master);
      o.start(t); o.stop(t + 0.13);
    }
  }

  // strike: quick bright arpeggio
  function strike() {
    const t0 = ctx.currentTime;
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      const t = t0 + i * 0.08;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.24);
    });
  }

  function play(name) {
    if (!enabled) return;
    ensure();
    if (!ctx) return;
    if (name === 'roll') roll();
    else if (name === 'hit') hit();
    else if (name === 'strike') strike();
  }

  // ---- chill lo-fi background loop (procedural, quiet) ----
  let musicOn = false, musicTimer = null, musicGain = null;
  const BPM = 84, BEAT = 60 / BPM;
  // Dm pentatonic-ish plucks over a two-bar D–Bb bass; sparse & mellow
  const BASS = [73.42, 73.42, 58.27, 58.27];                       // per half-bar
  const LEAD = [293.66, 349.23, 440.0, 392.0, 349.23, 293.66, 261.63, 293.66];
  function scheduleBar(t0, bar) {
    const swing = BEAT * 0.08;
    // bass: one warm note per half-bar
    for (let h = 0; h < 2; h++) {
      const f = BASS[(bar * 2 + h) % BASS.length];
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      const t = t0 + h * 2 * BEAT;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2 * BEAT * 0.9);
      o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + 2 * BEAT);
    }
    // plucks: airy triangle melody, skips beats for space
    for (let s = 0; s < 8; s++) {
      if ((bar + s) % 3 === 1) continue;
      const f = LEAD[(bar * 3 + s) % LEAD.length];
      const t = t0 + s * (BEAT / 2) + (s % 2 ? swing : 0);
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + 0.55);
    }
    // soft hats
    for (let s = 0; s < 4; s++) {
      const t = t0 + s * BEAT + BEAT / 2;
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(0.05);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(hp); hp.connect(g); g.connect(musicGain);
      src.start(t); src.stop(t + 0.06);
    }
  }
  function startMusic() {
    if (!enabled) return;
    ensure();
    if (!ctx || musicOn) return;
    musicOn = true;
    if (!musicGain) { musicGain = ctx.createGain(); musicGain.gain.value = 0.5; musicGain.connect(master); }
    let bar = 0;
    let nextT = ctx.currentTime + 0.1;
    const barLen = 4 * BEAT;
    const tick = () => {
      if (!musicOn) return;
      while (nextT < ctx.currentTime + barLen * 1.5) { scheduleBar(nextT, bar); bar = (bar + 1) % 64; nextT += barLen; }
      musicTimer = setTimeout(tick, barLen * 500);
    };
    tick();
  }
  function stopMusic() { musicOn = false; clearTimeout(musicTimer); }

  return {
    play, startMusic, stopMusic,
    resume: ensure,
    toggle() { enabled = !enabled; if (!enabled) stopMusic(); return enabled; },
    get enabled() { return enabled; },
  };
})();

// expose on window so `window.GameAudio` guards work (top-level const isn't global)
if (typeof window !== 'undefined') window.GameAudio = GameAudio;
