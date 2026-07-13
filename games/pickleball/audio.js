// audio.js — procedural pickleball SFX + ambient bed via Web Audio (no assets).
// Same API shape as the arcade's GameAudio: unlock/startMusic/stopMusic/play/
// setEnabled/isEnabled. play(name, opts) accepts an optional { vel, pan }.
const GameAudio = (() => {
  let ctx = null, master = null, sfxBus = null, ambBus = null;
  let enabled = true, ambientOn = false;
  let ambNodes = null, birdTimer = null;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = enabled ? 0.9 : 0; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.7; sfxBus.connect(master);
    ambBus = ctx.createGain(); ambBus.gain.value = 0.0; ambBus.connect(master);
  }
  function unlock() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function panner() { const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null; return p; }
  function route(node, pan) {
    if (pan != null && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); p.connect(sfxBus); }
    else node.connect(sfxBus);
  }

  function tone(freq, start, dur, type, peak, pan) {
    if (!ctx || !freq) return;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type || 'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g); route(g, pan); osc.start(start); osc.stop(start + dur + 0.02);
  }

  function noiseBurst(start, dur, peak, filterHz, q, pan) {
    if (!ctx) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = peak;
    if (filterHz) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filterHz; f.Q.value = q || 1; src.connect(f); f.connect(g); }
    else src.connect(g);
    route(g, pan); src.start(start);
  }

  // ---- SFX ----
  const sfx = {
    // the signature paddle "pock" — sharp resonant click + short tonal ping
    hit(o = {}) {
      const t = ctx.currentTime, v = o.vel != null ? o.vel : 1, pan = o.pan;
      noiseBurst(t, 0.03, 0.5 * v, 1400 + 500 * v, 6, pan);
      tone(520 + 260 * v, t, 0.06, 'triangle', 0.35 * v, pan);
      tone(880 + 200 * v, t, 0.035, 'sine', 0.18 * v, pan);
    },
    dink(o = {}) { const t = ctx.currentTime, pan = o.pan; noiseBurst(t, 0.02, 0.25, 1100, 5, pan); tone(600, t, 0.04, 'sine', 0.16, pan); },
    smash(o = {}) { const t = ctx.currentTime, pan = o.pan; noiseBurst(t, 0.04, 0.7, 2200, 4, pan); tone(760, t, 0.07, 'sawtooth', 0.4, pan); },
    bounce(o = {}) { const t = ctx.currentTime, v = o.vel != null ? o.vel : 1, pan = o.pan; noiseBurst(t, 0.035, 0.3 * v, 300, 2, pan); tone(150, t, 0.08, 'sine', 0.3 * v, pan); },
    net(o = {}) { const t = ctx.currentTime, pan = o.pan; noiseBurst(t, 0.12, 0.35, 800, 1.5, pan); },
    whistle() {
      if (!ctx) return; const t = ctx.currentTime;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(1900, t);
      osc.frequency.setValueAtTime(1900, t + 0.14);
      // trill
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 22; lg.gain.value = 60; lfo.connect(lg); lg.connect(osc.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.setValueAtTime(0.3, t + 0.18); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(g); g.connect(sfxBus); lfo.start(t); osc.start(t); osc.stop(t + 0.26); lfo.stop(t + 0.26);
    },
    point() { if (!ctx) return; const t = ctx.currentTime; [523.25, 659.25, 783.99].forEach((f, i) => tone(f, t + i * 0.08, 0.18, 'triangle', 0.4)); cheer(0.5); },
    win() { if (!ctx) return; const t = ctx.currentTime; [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, t + i * 0.1, 0.24, 'triangle', 0.45)); cheer(1); },
    lose() { if (!ctx) return; const t = ctx.currentTime; [392, 329.63, 261.63].forEach((f, i) => tone(f, t + i * 0.13, 0.24, 'sine', 0.4)); },
    ui() { if (ctx) tone(720, ctx.currentTime, 0.05, 'triangle', 0.25); },
    serve() { if (ctx) { const t = ctx.currentTime; tone(400, t, 0.05, 'sine', 0.2); } },
  };

  function cheer(amt) {
    if (!ctx) return; const t = ctx.currentTime, dur = 0.9 + amt;
    const len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) { const env = Math.sin(Math.PI * i / len); d[i] = (Math.random() * 2 - 1) * env; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.25 * amt;
    src.connect(f); f.connect(g); g.connect(master); src.start(t);
  }

  // ---- ambient park bed (soft crowd murmur + occasional birds) ----
  function startMusic() {
    init(); if (!ctx || ambientOn) return; ambientOn = true;
    // pink-ish murmur loop
    const len = Math.floor(ctx.sampleRate * 2), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = (Math.random() * 2 - 1); last = last * 0.97 + w * 0.03; d[i] = last * 3; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    src.connect(f); f.connect(ambBus); src.start();
    ambBus.gain.setTargetAtTime(0.5, ctx.currentTime, 1.5);
    ambNodes = { src, f };
    // birds
    birdTimer = setInterval(() => {
      if (!ctx || Math.random() > 0.4) return;
      const t = ctx.currentTime, base = 2200 + Math.random() * 1400;
      for (let i = 0; i < 3; i++) tone(base + i * 120 * (Math.random() > 0.5 ? 1 : -1), t + i * 0.06, 0.05, 'sine', 0.05);
    }, 4000);
  }
  function stopMusic() {
    ambientOn = false;
    if (ambBus && ctx) ambBus.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
    if (birdTimer) { clearInterval(birdTimer); birdTimer = null; }
  }

  function play(name, opts) { if (!enabled || !ctx) return; if (sfx[name]) sfx[name](opts || {}); }
  function setEnabled(v) { enabled = v; init(); if (master) master.gain.value = v ? 0.9 : 0; if (v) { unlock(); } }
  function isEnabled() { return enabled; }

  return { unlock, startMusic, stopMusic, play, setEnabled, isEnabled };
})();

if (typeof window !== 'undefined') window.GameAudio = GameAudio;
