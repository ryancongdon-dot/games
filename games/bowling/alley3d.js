// alley3d.js — the walkable alley in real 3D, using Kenney's CC0 animated
// characters (GLB). Your character walks the alley (arrow keys / WASD / on-screen
// pad / tap-to-walk), up to Gus, Rosa, the repair bench, the pro shop or the
// standings board; press the action button to bowl, take a job, or talk.
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
scene.background = new THREE.Color(0x241a33);
scene.fog = new THREE.Fog(0x241a33, 22, 42);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2038, 0.9));
const key = new THREE.DirectionalLight(0xfff2d8, 1.15);
key.position.set(6, 14, 8); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1; key.shadow.camera.far = 50;
key.shadow.camera.left = -18; key.shadow.camera.right = 18;
key.shadow.camera.top = 14; key.shadow.camera.bottom = -14;
scene.add(key);

// ---------- environment ----------
const FLOOR = { x0: -14, x1: 14, z0: -7, z1: 7 };
function box(w, h, d, color, x, y, z, rough) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: rough == null ? 0.85 : rough }));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m;
}
// floor + back/side walls
const floor = box(FLOOR.x1 - FLOOR.x0, 0.4, FLOOR.z1 - FLOOR.z0, 0xb9843e, 0, -0.2, 0, 0.9);
box(FLOOR.x1 - FLOOR.x0, 6, 0.4, 0x3a1f2e, 0, 2.8, FLOOR.z0 - 0.2);          // back wall
box(0.4, 6, FLOOR.z1 - FLOOR.z0, 0x2e1826, FLOOR.x0 - 0.2, 2.8, 0);          // left wall
box(0.4, 6, FLOOR.z1 - FLOOR.z0, 0x2e1826, FLOOR.x1 + 0.2, 2.8, 0);          // right wall

function label(text, x, y, z, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,14,28,0.92)'; roundRect(g, 4, 8, 248, 48, 12); g.fill();
  g.strokeStyle = color || '#ffd23f'; g.lineWidth = 3; g.stroke();
  g.fillStyle = color || '#ffd23f'; g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  spr.scale.set(3.4, 0.85, 1); spr.position.set(x, y, z); scene.add(spr); return spr;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// station props (simple shapes) at each spot
function buildProps() {
  // lanes (left)
  box(2.2, 0.15, 6, 0xc98b3e, -9, 0.08, -3.4);
  for (let i = 0; i < 3; i++) box(0.18, 0.5, 0.18, 0xeef3ff, -9.4 + i * 0.4, 0.35, -6);
  // pizza counter
  box(3, 1.1, 1.1, 0x6a3b28, -4.5, 0.55, -3.2); box(1, 0.9, 0.9, 0x8a2f22, -4.5, 1.4, -3.2);
  // repair bench + cabinet
  box(3, 1.0, 1.0, 0x2b3550, 0, 0.5, -3.2); box(1.1, 1.6, 0.8, 0x161226, 0.9, 0.8, -4.4);
  // pro shop shelf + balls
  box(3, 1.8, 0.6, 0x241a0f, 4.5, 0.9, -4.2);
  const cols = [0x1b9be0, 0xff7d4d, 0xb84dff, 0xffd23f];
  for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.25 })); s.position.set(3.9 + i * 0.45, 1.2, -4.0); s.castShadow = true; scene.add(s); }
  // standings board
  box(2.2, 2.6, 0.3, 0x0e1730, 9, 1.4, -5.6);
  label('THE LANES', -9, 3.4, -5.9);
  label('PIZZA', -4.5, 3.0, -4.2);
  label('REPAIR', 0, 3.0, -4.4);
  label('PRO SHOP', 4.5, 3.4, -4.2);
  label('STANDINGS', 9, 3.4, -5.5, '#8fe1ff');
}
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

// cast: which model + station action
function go(url) { window.location.href = url; }
function bowlNight() {
  if (!L || L.done) { showBoard(); return; }
  const n = L.beginNight();
  if (ST) ST.rivalBanter(n.opp, () => go('lanes.html')); else go('lanes.html');
}
const STATIONS = [
  { file: 'character-male-e',   x: -9,   name: 'Gus',  act: bowlNight, promptFor: 'gus' },
  { file: 'character-female-b', x: -4.5, name: 'Rosa', act: () => go('pizza.html'),  prompt: 'Help the pizza rush' },
  { file: 'character-male-c',   x: 0,    name: 'Mac',  act: () => go('arcade.html'), prompt: 'Fix the cabinets' },
  { file: 'character-female-d', x: 4.5,  name: 'Sal',  act: () => go('proshop.html'), prompt: 'Browse the Pro Shop' },
  { file: null,                 x: 9,    name: '',     act: () => showBoard(), prompt: 'Check the standings' },
];
const npcZ = -2.2;
const npcs = [];
let player = null;

async function loadCast() {
  player = await loadChar('character-male-a', 0, 3, Math.PI);
  $('loading').classList.add('hidden');
  for (const s of STATIONS) {
    if (!s.file) { npcs.push({ station: s, root: { position: new THREE.Vector3(s.x, 0, npcZ) } }); continue; }
    const ch = await loadChar(s.file, s.x, npcZ, 0);
    setAction(ch, ch.actions['idle'] ? 'idle' : 'static', 0);
    npcs.push({ station: s, char: ch, root: ch.root });
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
      player.root.rotation.y = Math.atan2(dx, dz);
      setAction(player, player.actions['walk'] ? 'walk' : 'idle');
    } else setAction(player, player.actions['idle'] ? 'idle' : 'static');

    // nearest station
    near = null; let best = 2.6;
    for (const n of npcs) { const d = Math.hypot(n.root.position.x - player.root.position.x, n.root.position.z - player.root.position.z); if (d < best) { best = d; near = n; } }
    updatePrompt();
  }

  // camera follows the player
  if (player) {
    const px = player.root.position.x, pz = player.root.position.z;
    camera.position.lerp(new THREE.Vector3(px * 0.7, 8.5, pz + 9.5), 0.12);
    camera.lookAt(px * 0.7, 1.4, pz - 3.5);
  }
  for (const n of npcs) if (n.char && n.char.mixer) n.char.mixer.update(dt);
  if (player && player.mixer) player.mixer.update(dt);
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

  // tap the floor to walk there
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => {
    if (frozen() || !player) return;
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1; ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(floor, false);
    if (hit.length) target = { x: hit[0].point.x, z: hit[0].point.z };
  });

  if (ST) { ST.init(); ST.onHubLoad(); }
  loadCast();
  animate();
}
boot();
