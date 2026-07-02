// alley3d.js — the walkable alley in real 3D, using Kenney's CC0 animated
// characters (GLB). Pass 2: full environment — cosmic carpet, lane bank with
// pins, ceiling & lamps, neon sign, real counters/cabinets, tables, wandering
// regulars, and a live standings board. (Movement/interaction unchanged.)
import * as THREE from 'three';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';

const L = window.League, ST = window.Story;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120d1f);
scene.fog = new THREE.Fog(0x120d1f, 26, 46);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

// ---------- lights (few real lights; emissive fakes the rest) ----------
scene.add(new THREE.HemisphereLight(0xbfcdf5, 0x241a33, 0.75));
const key = new THREE.DirectionalLight(0xffe9c8, 1.0);
key.position.set(5, 13, 9); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1; key.shadow.camera.far = 50;
key.shadow.camera.left = -18; key.shadow.camera.right = 18;
key.shadow.camera.top = 14; key.shadow.camera.bottom = -14;
scene.add(key);
const pinkGlow = new THREE.PointLight(0xff5d9e, 0.55, 18); pinkGlow.position.set(0, 4.4, -5.5); scene.add(pinkGlow);
const cyanGlow = new THREE.PointLight(0x4ad2ff, 0.4, 16); cyanGlow.position.set(-9, 3.2, -4.5); scene.add(cyanGlow);

// ---------- canvas textures ----------
function carpetTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1c1440'; g.fillRect(0, 0, 256, 256);
  const cols = ['#ff5d9e', '#4ad2ff', '#ffd23f', '#8a5cff', '#39d98a'];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 46; i++) {
    const col = cols[Math.floor(rnd() * cols.length)];
    g.strokeStyle = col; g.fillStyle = col; g.globalAlpha = 0.5; g.lineWidth = 3;
    const x = rnd() * 256, y = rnd() * 256, k = rnd();
    if (k < 0.34) { g.beginPath(); g.arc(x, y, 4 + rnd() * 6, 0, Math.PI * 1.4); g.stroke(); }
    else if (k < 0.67) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 + rnd() * 8, y + 4); g.lineTo(x + 4, y + 12 + rnd() * 6); g.closePath(); g.fill(); }
    else { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8, y - 8); g.lineTo(x + 16, y); g.lineTo(x + 24, y - 8); g.stroke(); }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 3);
  t.encoding = THREE.sRGBEncoding;
  return t;
}
function woodTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#c98b3e'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#c2853a' : '#d09244';
    g.fillRect(0, i * 16, 128, 16);
    g.fillStyle = 'rgba(120,70,20,0.55)'; g.fillRect(0, i * 16, 128, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 4);
  t.encoding = THREE.sRGBEncoding;
  return t;
}
function neonSignTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#ff2d7e'; g.shadowBlur = 34;
  g.fillStyle = '#ffb3d1'; g.font = '900 92px system-ui, sans-serif';
  g.fillText('STRIKE VALLEY', 512, 92);
  g.shadowColor = '#2da8ff'; g.shadowBlur = 26;
  g.fillStyle = '#bfe6ff'; g.font = '900 64px system-ui, sans-serif';
  g.fillText('L A N E S', 512, 188);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}
function standingsTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 640;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1226'; g.fillRect(0, 0, 512, 640);
  g.strokeStyle = '#3c4a7a'; g.lineWidth = 8; g.strokeRect(8, 8, 496, 624);
  g.fillStyle = '#ffd23f'; g.font = '900 44px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('LEAGUE STANDINGS', 256, 66);
  if (L) {
    const rows = L.standings();
    g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'left';
    rows.forEach((tm, i) => {
      const y = 130 + i * 64;
      const me = tm.name === L.player;
      if (me) { g.fillStyle = 'rgba(255,210,63,0.18)'; g.fillRect(20, y - 34, 472, 50); }
      g.fillStyle = me ? '#ffd23f' : '#dfe8ff';
      g.fillText((i + 1) + '.  ' + tm.name, 36, y);
      g.textAlign = 'right'; g.fillText(tm.w + '–' + tm.l, 476, y); g.textAlign = 'left';
    });
  }
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}

// ---------- environment ----------
const FLOOR = { x0: -14, x1: 14, z0: -7, z1: 7 };
function box(w, h, d, color, x, y, z, opts) {
  opts = opts || {};
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: opts.rough == null ? 0.85 : opts.rough,
    metalness: opts.metal || 0,
    map: opts.map || null,
    emissive: opts.emissive || 0x000000, emissiveIntensity: opts.emissiveI == null ? 1 : opts.emissiveI,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = !opts.noShadow; m.receiveShadow = true; scene.add(m); return m;
}

// carpet floor + wood strip along the stations
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(FLOOR.x1 - FLOOR.x0, 0.4, FLOOR.z1 - FLOOR.z0),
  new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95 }));
floor.position.set(0, -0.2, 0); floor.receiveShadow = true; scene.add(floor);
const woodStrip = new THREE.Mesh(new THREE.BoxGeometry(FLOOR.x1 - FLOOR.x0, 0.42, 3.2),
  new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 }));
woodStrip.position.set(0, -0.19, -4.6); woodStrip.receiveShadow = true; scene.add(woodStrip);

// walls + wainscot + ceiling (walls run tall so the camera never sees black past them)
box(FLOOR.x1 - FLOOR.x0, 10, 0.4, 0x2c1f3a, 0, 5, FLOOR.z0 - 0.2, { noShadow: true });
box(0.4, 10, FLOOR.z1 - FLOOR.z0, 0x241a30, FLOOR.x0 - 0.2, 5, 0, { noShadow: true });
box(0.4, 10, FLOOR.z1 - FLOOR.z0, 0x241a30, FLOOR.x1 + 0.2, 5, 0, { noShadow: true });
box(FLOOR.x1 - FLOOR.x0, 1.0, 0.14, 0x1a1226, 0, 0.5, FLOOR.z0 + 0.08, { noShadow: true });   // wainscot
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.x1 - FLOOR.x0, FLOOR.z1 - FLOOR.z0),
  new THREE.MeshStandardMaterial({ color: 0x191227, roughness: 1 }));
ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 5.4, 0); scene.add(ceil);

// hanging pendant lamps over the stations (emissive bulbs, no extra real lights)
for (const lx of [-9, -4.5, 0, 4.5, 9]) {
  box(0.05, 1.6, 0.05, 0x222, lx, 4.6, -2.2, { noShadow: true });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffdf9e, emissiveIntensity: 1.6 }));
  bulb.position.set(lx, 3.8, -2.2); scene.add(bulb);
  box(0.5, 0.22, 0.5, 0x33241a, lx, 4.0, -2.2, { noShadow: true });
}

// neon sign on the back wall
const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2),
  new THREE.MeshBasicMaterial({ map: neonSignTexture(), transparent: true }));
sign.position.set(0, 4.35, FLOOR.z0 + 0.02); scene.add(sign);

// labels above stations
function label(text, x, y, z, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,14,28,0.92)'; roundRect(g, 4, 8, 248, 48, 12); g.fill();
  g.strokeStyle = color || '#ffd23f'; g.lineWidth = 3; g.stroke();
  g.fillStyle = color || '#ffd23f'; g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  spr.scale.set(3.0, 0.75, 1); spr.position.set(x, y, z); scene.add(spr); return spr;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

const arcadeScreens = [];
function buildProps() {
  const wood = woodTexture();

  // --- THE LANES: a bank of 3 mini-lanes with pins + masking unit ---
  for (let i = 0; i < 3; i++) {
    const lx = -11.4 + i * 2.0;
    const lane = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 4.6),
      new THREE.MeshStandardMaterial({ map: wood, roughness: 0.45 }));
    lane.position.set(lx, 0.07, -4.6); lane.receiveShadow = true; scene.add(lane);
    box(0.14, 0.1, 4.6, 0x14101f, lx - 0.92, 0.05, -4.6, { noShadow: true });
    box(0.14, 0.1, 4.6, 0x14101f, lx + 0.92, 0.05, -4.6, { noShadow: true });
    for (let p = 0; p < 4; p++) {
      const pin = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.4 }));
      pin.position.set(lx - 0.36 + p * 0.24, 0.36, -6.4); pin.castShadow = true; scene.add(pin);
    }
  }
  // masking unit above the pins with glowing dots
  box(6.4, 1.15, 0.5, 0x1b1430, -9.4, 2.35, -6.5, { noShadow: true });
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xff5d9e, emissive: 0xff2d7e, emissiveIntensity: 1.4 }));
    d.position.set(-11.9 + i, 2.35, -6.22); scene.add(d);
  }

  // --- PIZZA COUNTER: counter + top, oven with glowing mouth, pizza boxes ---
  box(3.0, 1.0, 1.0, 0x6a3b28, -4.5, 0.5, -3.2, { map: wood });
  box(3.2, 0.12, 1.15, 0xd9a05f, -4.5, 1.06, -3.2, { rough: 0.4 });
  box(1.5, 1.5, 0.9, 0x8a2f22, -4.5, 0.75, -4.6);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x2a0d06, emissive: 0xff7a26, emissiveIntensity: 1.5 }));
  mouth.position.set(-4.5, 0.8, -4.14); scene.add(mouth);
  box(1.7, 0.3, 0.9, 0x772619, -4.5, 1.65, -4.6);                       // oven crown
  for (let i = 0; i < 3; i++) box(0.62, 0.09, 0.62, 0xf2ead8, -5.6, 1.16 + i * 0.1, -3.2, { rough: 0.7 }); // box stack

  // --- REPAIR BAY: bench + two arcade cabinets with animated screens ---
  box(3.0, 0.95, 1.0, 0x2b3550, 0, 0.48, -3.2);
  box(3.2, 0.1, 1.15, 0x44557e, 0, 1.0, -3.2, { rough: 0.35 });
  box(0.5, 0.5, 0.3, 0xd9a05f, 0.8, 1.28, -3.2);                        // toolbox
  for (const [cx, rot] of [[-0.85, 0.12], [1.0, -0.08]]) {
    const cab = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x1d1533, roughness: 0.7 }));
    body.position.y = 0.95; body.castShadow = true; cab.add(body);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x2fd0ff, emissiveIntensity: 1.4 }));
    scr.position.set(0, 1.35, 0.44); cab.add(scr); arcadeScreens.push(scr.material);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x3a2a5e, roughness: 0.6 }));
    panel.position.set(0, 0.95, 0.5); panel.rotation.x = -0.35; cab.add(panel);
    cab.position.set(cx, 0, -4.55); cab.rotation.y = rot; scene.add(cab);
  }

  // --- PRO SHOP: shelf with two rows of balls + counter ---
  box(3.0, 2.0, 0.55, 0x241a0f, 4.5, 1.0, -4.5, { map: wood });
  const cols = [0x1b9be0, 0xff7d4d, 0xb84dff, 0xffd23f, 0x39d98a, 0xff5d8f, 0x4ad2ff, 0xf2f2f2];
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12),
      new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.22, metalness: 0.15 }));
    b.position.set(3.45 + (i % 4) * 0.7, i < 4 ? 1.62 : 0.92, -4.42); b.castShadow = true; scene.add(b);
  }
  box(2.6, 0.95, 0.9, 0x3a2a18, 4.5, 0.48, -3.2, { map: wood });
  box(2.8, 0.1, 1.05, 0xd9a05f, 4.5, 0.98, -3.2, { rough: 0.4 });

  // --- STANDINGS: framed live board ---
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.5),
    new THREE.MeshBasicMaterial({ map: standingsTexture() }));
  board.position.set(9, 2.1, FLOOR.z0 + 0.05); scene.add(board);
  box(2.2, 2.7, 0.12, 0x3c4a7a, 9, 2.1, FLOOR.z0 + 0.02, { noShadow: true });

  // --- posters between stations ---
  for (const [px, col, txt] of [[-6.8, '#ff5d9e', 'LEAGUE NIGHT!'], [2.2, '#4ad2ff', 'PIZZA · REPAIR'], [11.8, '#ffd23f', 'EST. 1986']]) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 320;
    const g = c.getContext('2d');
    g.fillStyle = '#171233'; g.fillRect(0, 0, 256, 320);
    g.strokeStyle = col; g.lineWidth = 10; g.strokeRect(10, 10, 236, 300);
    g.fillStyle = col; g.font = '900 34px system-ui'; g.textAlign = 'center';
    const words = txt.split(' ');
    words.forEach((w, i) => g.fillText(w, 128, 130 + i * 44));
    g.beginPath(); g.arc(128, 70, 30, 0, Math.PI * 2); g.fillStyle = col; g.globalAlpha = 0.9; g.fill(); g.globalAlpha = 1;
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.6),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.9 }));
    poster.position.set(px, 2.5, FLOOR.z0 + 0.03); scene.add(poster);
  }

  // --- tables & stools on the open floor ---
  for (const t of TABLES) {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 20),
      new THREE.MeshStandardMaterial({ color: 0x7a4423, roughness: 0.5 }));
    top.position.set(t.x, 0.86, t.z); top.castShadow = true; scene.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.86, 10),
      new THREE.MeshStandardMaterial({ color: 0x33241a }));
    leg.position.set(t.x, 0.43, t.z); scene.add(leg);
    for (const a of [0.7, 2.6, 4.6]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.5, 12),
        new THREE.MeshStandardMaterial({ color: 0xb0303e, roughness: 0.6 }));
      st.position.set(t.x + Math.cos(a) * 1.05, 0.25, t.z + Math.sin(a) * 1.05);
      st.castShadow = true; scene.add(st);
    }
  }

  label('THE LANES', -9, 3.2, -5.9);
  label('PIZZA', -4.5, 2.6, -4.2);
  label('REPAIR', 0, 2.6, -4.4);
  label('PRO SHOP', 4.5, 2.9, -4.2);
  label('STANDINGS', 9, 3.6, -5.5, '#8fe1ff');
}
const TABLES = [{ x: -10.5, z: 3.8 }, { x: -2.4, z: 4.5 }, { x: 7.2, z: 3.9 }];
buildProps();

// ---------- characters ----------
const loader = new GLTFLoader();
function loadChar(file, x, z, rotY) {
  return new Promise((resolve) => {
    loader.load('assets/characters/' + file + '.glb', (g) => {
      const root = g.scene;
      const b = new THREE.Box3().setFromObject(root);
      const h = (b.max.y - b.min.y) || 1.7;
      const s = 1.75 / h; root.scale.setScalar(s);
      root.position.set(x, -b.min.y * s, z);
      root.rotation.y = rotY || 0;
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      scene.add(root);
      const mixer = new THREE.AnimationMixer(root);
      const actions = {};
      for (const clip of g.animations) actions[clip.name] = mixer.clipAction(clip);
      const ch = { root, mixer, actions, cur: null };
      setAction(ch, actions['idle'] ? 'idle' : 'static', 0);
      resolve(ch);
    }, undefined, (err) => { console.error('char load failed', file, err); resolve(placeholder(x, z)); });
  });
}
function placeholder(x, z) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x8fe1ff }));
  m.position.set(x, 0.9, z); m.castShadow = true; scene.add(m);
  return { root: m, mixer: null, actions: {}, cur: null };
}
function setAction(ch, name, fade = 0.2) {
  if (!ch.actions[name] || ch.cur === name) return;
  const next = ch.actions[name];
  next.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (ch.cur && ch.actions[ch.cur]) ch.actions[ch.cur].fadeOut(fade);
  ch.cur = name;
}

function go(url) { window.location.href = url; }
function bowlNight() {
  if (!L || L.done) { showBoard(); return; }
  const n = L.beginNight();
  if (ST) ST.rivalBanter(n.opp, () => go('lanes.html')); else go('lanes.html');
}
// shopkeepers stand BEHIND their counters (nz); Gus greets out front
const STATIONS = [
  { file: 'character-male-e',   x: -9,   name: 'Gus',  act: bowlNight, promptFor: 'gus' },
  { file: 'character-female-b', x: -4.9, nz: -4.0, name: 'Rosa', act: () => go('pizza.html'),  prompt: 'Help the pizza rush' },
  { file: 'character-male-c',   x: 0,    nz: -4.0, name: 'Mac',  act: () => go('arcade.html'), prompt: 'Fix the cabinets' },
  { file: 'character-female-d', x: 4.5,  nz: -4.0, name: 'Sal',  act: () => go('proshop.html'), prompt: 'Browse the Pro Shop' },
  { file: null,                 x: 9,    name: '',     act: () => showBoard(), prompt: 'Check the standings' },
];
const npcZ = -2.2;
const npcs = [];
let player = null;
let coin = null;             // spinning coin over the pro shop (Starter Kit prop)

// wandering regulars: spare character models pacing the open floor
const WANDER_FILES = ['character-female-a', 'character-female-f', 'character-male-b'];
const wanderers = [];

function loadProp(file, x, y, z, scale) {
  loader.load('assets/props/' + file + '.glb', (g) => {
    const root = g.scene;
    root.scale.setScalar(scale || 1);
    root.position.set(x, y, z);
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(root);
    if (file === 'coin') coin = root;
  }, undefined, () => {});
}

async function loadCast() {
  player = await loadChar('character-male-a', 0, 3, Math.PI);
  $('loading').classList.add('hidden');
  for (const s of STATIONS) {
    if (!s.file) { npcs.push({ station: s, root: { position: new THREE.Vector3(s.x, 0, npcZ) } }); continue; }
    const ch = await loadChar(s.file, s.x, s.nz != null ? s.nz : npcZ, 0);
    setAction(ch, ch.actions['idle'] ? 'idle' : 'static', 0);
    npcs.push({ station: s, char: ch, root: ch.root });
  }
  // wandering regulars
  for (let i = 0; i < WANDER_FILES.length; i++) {
    const ch = await loadChar(WANDER_FILES[i], -8 + i * 7, 2.5 + i, Math.PI);
    wanderers.push({ char: ch, state: 'idle', t: 1 + i, tx: 0, tz: 0 });
  }
  // props from the Starter Kit (MIT): coin over the pro-shop counter; champion flag
  loadProp('coin', 5.6, 1.7, -3.2, 1.1);
  if (L && L.done && L.rank() === 1) loadProp('flag', 9.9, 0, -5.2, 1.4);
}

// keep walkers out of the tables
function pushOut(pos) {
  for (const t of TABLES) {
    const dx = pos.x - t.x, dz = pos.z - t.z;
    const d = Math.hypot(dx, dz), R = 1.35;
    if (d > 0.001 && d < R) { pos.x = t.x + (dx / d) * R; pos.z = t.z + (dz / d) * R; }
  }
}
// …and out of each other (wanderers vs wanderers vs player)
function separateWalkers() {
  const bodies = wanderers.map((w) => w.char.root && w.char.root.position).filter(Boolean);
  if (player && player.root) bodies.push(player.root.position);
  const R = 0.95;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < R) {
        const push = (R - d) / 2, nx = dx / d, nz = dz / d;
        // never shove the player — move the wanderers around them instead
        if (b === (player && player.root.position)) { a.x -= nx * push * 2; a.z -= nz * push * 2; }
        else { a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push; }
      }
    }
  }
}

// ---------- input ----------
const keys = {}; let leftH = false, rightH = false, upH = false, downH = false, target = null;
const dlgOpen = () => { const d = $('dlg'); return d && !d.classList.contains('hidden'); };
const boardOpen = () => !$('board-ov').classList.contains('hidden');
const frozen = () => dlgOpen() || boardOpen();
let near = null;

function showBoard() {
  if (!L) return;
  $('standings').innerHTML = L.standings().map((tm, i) =>
    `<div class="srow${tm.name === L.player ? ' me' : ''}"><span class="t-pos">${i + 1}</span>` +
    `<span class="t-name">${tm.name}</span><span class="t-rec">${tm.w}–${tm.l}</span><span class="t-pf">${tm.pf}</span></div>`
  ).join('');
  $('board-ov').classList.remove('hidden');
}
function interact() { if (!frozen() && near) near.station.act(); }

function updatePrompt() {
  const p = $('prompt');
  if (!near) { p.classList.add('hidden'); return; }
  const s = near.station; let txt;
  if (s.promptFor === 'gus') {
    if (L && !L.done) { const n = L.activeNight() || L.beginNight(); txt = `Bowl vs <b>${n.opp}</b> · beat ${n.oppScore}`; }
    else txt = 'Season complete — check standings';
  } else txt = s.prompt || ('Talk to ' + s.name);
  p.innerHTML = `● &nbsp;${txt}`; p.classList.remove('hidden');
}

// ---------- loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (player && !frozen()) {
    let dx = 0, dz = 0;
    if (keys['arrowleft'] || keys['a'] || leftH) dx -= 1;
    if (keys['arrowright'] || keys['d'] || rightH) dx += 1;
    if (keys['arrowup'] || keys['w'] || upH) dz -= 1;
    if (keys['arrowdown'] || keys['s'] || downH) dz += 1;
    if (dx || dz) target = null;
    if (!dx && !dz && target) {
      const tx = target.x - player.root.position.x, tz = target.z - player.root.position.z;
      if (Math.hypot(tx, tz) > 0.2) { dx = tx; dz = tz; } else target = null;
    }
    const len = Math.hypot(dx, dz);
    const moving = len > 0.01;
    if (moving) {
      dx /= len; dz /= len;
      const sp = 5.0 * dt;
      player.root.position.x = clamp(player.root.position.x + dx * sp, FLOOR.x0 + 1, FLOOR.x1 - 1);
      player.root.position.z = clamp(player.root.position.z + dz * sp, npcZ + 1.2, FLOOR.z1 - 1);
      pushOut(player.root.position);
      player.root.rotation.y = Math.atan2(dx, dz);
      setAction(player, player.actions['walk'] ? 'walk' : 'idle');
    } else setAction(player, player.actions['idle'] ? 'idle' : 'static');

    near = null; let best = 3.4;   // shopkeepers stand behind counters, so reach further
    for (const n of npcs) { const d = Math.hypot(n.root.position.x - player.root.position.x, n.root.position.z - player.root.position.z); if (d < best) { best = d; near = n; } }
    updatePrompt();
  }

  // wandering regulars
  for (const w of wanderers) {
    if (!w.char.root) continue;
    w.t -= dt;
    if (w.state === 'idle') {
      setAction(w.char, w.char.actions['idle'] ? 'idle' : 'static');
      if (w.t <= 0) {
        w.tx = FLOOR.x0 + 2 + Math.random() * (FLOOR.x1 - FLOOR.x0 - 4);
        w.tz = 0.2 + Math.random() * 5.6;
        w.state = 'walk';
      }
    } else {
      const dx = w.tx - w.char.root.position.x, dz = w.tz - w.char.root.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) { w.state = 'idle'; w.t = 1.5 + Math.random() * 3.5; }
      else {
        const sp = 1.6 * dt;
        w.char.root.position.x += (dx / d) * sp;
        w.char.root.position.z += (dz / d) * sp;
        pushOut(w.char.root.position);
        w.char.root.rotation.y = Math.atan2(dx, dz);
        setAction(w.char, w.char.actions['walk'] ? 'walk' : 'idle');
      }
    }
    if (w.char.mixer) w.char.mixer.update(dt);
  }
  separateWalkers();

  // camera follows the player
  if (player) {
    const px = player.root.position.x, pz = player.root.position.z;
    camera.position.lerp(new THREE.Vector3(px * 0.7, 8.5, pz + 9.5), 0.12);
    camera.lookAt(px * 0.7, 1.4, pz - 3.5);
  }
  for (const n of npcs) if (n.char && n.char.mixer) n.char.mixer.update(dt);
  if (player && player.mixer) player.mixer.update(dt);
  if (coin) { coin.rotation.y += dt * 2.2; coin.position.y = 1.7 + Math.sin(clock.elapsedTime * 2) * 0.08; }
  // arcade screens flicker through hues
  for (let i = 0; i < arcadeScreens.length; i++) {
    arcadeScreens[i].emissive.setHSL((clock.elapsedTime * 0.15 + i * 0.4) % 1, 0.85, 0.55);
  }
  renderer.render(scene, camera);
}

// ---------- setup ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function boot() {
  resize();
  if (L && !L.done) L.beginNight();
  if (L) { $('c-week').textContent = L.done ? 'Season over' : 'Week ' + L.week; $('c-rank').textContent = '#' + L.rank(); $('c-money').textContent = '$' + L.money; $('c-ball').textContent = L.equippedBall().name; }

  window.addEventListener('keydown', (e) => { if (dlgOpen()) return; const k = e.key.toLowerCase(); keys[k] = true; if (k === ' ' || k === 'enter' || k === 'e') { interact(); e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  const hold = (id, set) => { const el = $(id); const on = (e) => { e.preventDefault(); set(true); target = null; }; const off = () => set(false); el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off); };
  hold('b-left', (v) => leftH = v); hold('b-right', (v) => rightH = v); hold('b-up', (v) => upH = v); hold('b-down', (v) => downH = v);
  $('b-act').addEventListener('click', interact);
  $('board-close').addEventListener('click', () => $('board-ov').classList.add('hidden'));

  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => {
    if (frozen() || !player) return;
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1; ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(floor, false);
    if (hit.length) target = { x: hit[0].point.x, z: hit[0].point.z };
  });

  // lo-fi house music on the first tap/keypress (browser autoplay rules)
  const startTunes = () => { if (window.GameAudio) { GameAudio.resume(); GameAudio.startMusic(); } };
  window.addEventListener('pointerdown', startTunes, { once: true });
  window.addEventListener('keydown', startTunes, { once: true });

  if (ST) { ST.init(); ST.onHubLoad(); }
  loadCast();
  animate();
}
boot();
