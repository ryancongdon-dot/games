// audio.js — generated chiptune music + SFX via Web Audio API (no asset files).
// Exposes a small global `GameAudio` API used by game.js.
const GameAudio = (() => {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let enabled = true;      // user toggle
  let musicPlaying = false;
  let schedulerId = null;
  let nextNoteTime = 0;
  let step = 0;

  const LOOKAHEAD = 0.1;   // seconds of audio scheduled ahead
  const TICK = 25;         // ms between scheduler runs
  const BPM = 112;
  const STEP_DUR = 60 / BPM / 2; // eighth notes

  // C major pentatonic-ish cheerful melody (Hz; 0 = rest)
  const N = { C4:261.63, D4:293.66, E4:329.63, G4:392.0, A4:440.0, C5:523.25, D5:587.33, E5:659.25 };
  const MELODY = [
    N.C5, N.G4, N.A4, N.G4, N.E4, N.G4, N.C5, 0,
    N.D5, N.C5, N.A4, N.G4, N.E4, 0, N.G4, 0,
  ];
  const BASS = { 0: 65.41, 4: 110.0, 8: 87.31, 12: 98.0 }; // C2 A2 F2 G2 (I-vi-IV-V)

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.9 : 0.0;
    master.connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.16;
    musicBus.connect(master);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.55;
    sfxBus.connect(master);
  }

  // Resume on a user gesture (mobile autoplay policy).
  function unlock() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, start, dur, type, peak, bus) {
    if (!ctx || !freq) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(bus || sfxBus);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  function noise(start, dur, peak, bus) {
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = peak;
    src.connect(g);
    g.connect(bus || sfxBus);
    src.start(start);
  }

  function scheduleStep(s, t) {
    // melody
    tone(MELODY[s % MELODY.length], t, STEP_DUR * 0.9, 'square', 0.5, musicBus);
    // bass on quarter beats
    if (BASS[s % 16] !== undefined) tone(BASS[s % 16], t, STEP_DUR * 1.8, 'triangle', 0.9, musicBus);
    // kick on beats
    if (s % 4 === 0) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g); g.connect(musicBus);
      osc.start(t); osc.stop(t + 0.18);
    }
    // soft hat on offbeats
    if (s % 2 === 1) noise(t, 0.03, 0.06, musicBus);
  }

  function scheduler() {
    if (!ctx) return;
    while (nextNoteTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextNoteTime);
      nextNoteTime += STEP_DUR;
      step = (step + 1) % MELODY.length;
    }
  }

  function startMusic() {
    init();
    if (!ctx || musicPlaying) return;
    musicPlaying = true;
    step = 0;
    nextNoteTime = ctx.currentTime + 0.08;
    schedulerId = setInterval(scheduler, TICK);
  }

  function stopMusic() {
    musicPlaying = false;
    if (schedulerId) { clearInterval(schedulerId); schedulerId = null; }
  }

  // ---- SFX ----
  const sfx = {
    coin() {
      const t = ctx ? ctx.currentTime : 0;
      tone(987.77, t, 0.08, 'square', 0.5);
      tone(1318.5, t + 0.08, 0.12, 'square', 0.5);
    },
    move() { if (ctx) tone(660, ctx.currentTime, 0.04, 'square', 0.18); },
    descend() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.5);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(g); g.connect(sfxBus);
      osc.start(t); osc.stop(t + 0.52);
    },
    clunk() { if (ctx) { noise(ctx.currentTime, 0.09, 0.35); tone(180, ctx.currentTime, 0.1, 'square', 0.35); } },
    win() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.09, 0.18, 'square', 0.5));
    },
    lose() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [392, 329.63, 261.63].forEach((f, i) => tone(f, t + i * 0.12, 0.22, 'triangle', 0.45));
    },
    chaos() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(500, t);
      osc.frequency.linearRampToValueAtTime(110, t + 0.45);
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(g); g.connect(sfxBus);
      osc.start(t); osc.stop(t + 0.47);
    },
    unlock() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [659.25, 880, 1318.5].forEach((f, i) => tone(f, t + i * 0.1, 0.25, 'square', 0.5));
    },
  };

  function play(name) {
    if (!enabled || !ctx) return;
    if (sfx[name]) sfx[name]();
  }

  function setEnabled(v) {
    enabled = v;
    init();
    if (master) master.gain.value = v ? 0.9 : 0.0;
    if (v) { unlock(); startMusic(); } else { stopMusic(); }
  }

  function isEnabled() { return enabled; }

  return { unlock, startMusic, stopMusic, play, setEnabled, isEnabled };
})();
