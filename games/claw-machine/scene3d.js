// scene3d.js — WebGL 3D claw machine scene + cannon.js physics.
// Exposes a global `Scene` object the game state machine drives.
// Requires THREE (three.min.js) and CANNON (cannon.min.js) loaded first.
const Scene = (() => {
  'use strict';

  // ---- world dimensions (meters) ----
  const HX = 1.18;          // interior half-width (X)
  const HZ = 0.98;          // interior half-depth (Z)
  const WALL_Y = 1.7;       // wall height
  const RAIL_TOP = 2.15;    // claw rail height
  const GRAB_Y = 0.5;       // claw head height when fully dropped
  const INNER_X = 0.96;     // claw X travel limit
  const INNER_Z = 0.76;     // claw Z travel limit
  const PLUSH_R = 0.2;      // physics radius
  const GRASP = 0.42;       // horizontal grab reach (world units)
  const PILE_TARGET = 22;   // plushies kept in the heap

  // chute (front-left corner)
  const CHUTE = { x0: -HX, x1: -HX + 0.62, z0: HZ - 0.62, z1: HZ, lip: 0.46 };

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const toWorldX = (gx) => lerp(-INNER_X, INNER_X, gx);
  const toWorldZ = (gz) => lerp(INNER_Z, -INNER_Z, gz);

  // ---- module state ----
  let renderer, scene, camera, canvas;
  let world, fixedAcc = 0;
  const FIXED = 1 / 60;
  let pile = [];            // { mesh, body, typeId }
  let held = null;
  let collecting = [];      // { item, t }
  let clawGroup, clawHead, trolley, cable, prongs = [];
  let clawBody;
  let keyLight, accentLight;
  let reticle, raycaster, aimMode = false;
  let frameMats = [], neonMats = [], floorMat, glassMat, floorGlow;
  const BASE_TOP = -0.12, BASE_H = 1.4;
  let plushTypes = [];      // injected from game.js (PLUSH_TYPES)
  let palette = null;
  const matCache = {};      // per-type materials
  const modelCache = {};    // per-type loaded glTF templates (id -> Group)
  const MODEL_DIR = 'models/';

  // claw target (set by game each frame)
  const clawState = { x: 0.05, z: 0.06, drop: 0, prong: 0 };

  // camera orbit
  const orbit = { theta: 0, phi: 1.02, radius: 6.8, tx: 0, ty: 0.62, tz: 0 };
  let dragging = false, lastX = 0, lastY = 0;

  const PLUSH_GEO = {};
  let glintMat, cheekMat;

  function buildGeometries() {
    PLUSH_GEO.body = new THREE.SphereGeometry(PLUSH_R, 22, 16);
    PLUSH_GEO.belly = new THREE.SphereGeometry(PLUSH_R * 0.66, 16, 12);
    PLUSH_GEO.earRound = new THREE.SphereGeometry(PLUSH_R * 0.42, 14, 10);
    PLUSH_GEO.earLong = new THREE.CapsuleGeometry(PLUSH_R * 0.22, PLUSH_R * 0.85, 5, 10);
    PLUSH_GEO.earPoint = new THREE.ConeGeometry(PLUSH_R * 0.42, PLUSH_R * 0.8, 14);
    PLUSH_GEO.eye = new THREE.SphereGeometry(PLUSH_R * 0.15, 12, 10);
    PLUSH_GEO.glint = new THREE.SphereGeometry(PLUSH_R * 0.05, 8, 6);
    PLUSH_GEO.cheek = new THREE.SphereGeometry(PLUSH_R * 0.12, 10, 8);
    PLUSH_GEO.nose = new THREE.SphereGeometry(PLUSH_R * 0.14, 10, 8);
    PLUSH_GEO.horn = new THREE.ConeGeometry(PLUSH_R * 0.24, PLUSH_R * 0.7, 12);
    PLUSH_GEO.foot = new THREE.SphereGeometry(PLUSH_R * 0.3, 10, 8);
    glintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.3 });
    cheekMat = new THREE.MeshStandardMaterial({ color: 0xff7da0, roughness: 0.7, transparent: true, opacity: 0.55 });
  }

  function typeMats(t) {
    if (matCache[t.id]) return matCache[t.id];
    const m = {
      body: new THREE.MeshStandardMaterial({ color: t.body, roughness: 0.85, metalness: 0.0 }),
      belly: new THREE.MeshStandardMaterial({ color: t.belly, roughness: 0.9 }),
      accent: new THREE.MeshStandardMaterial({ color: t.accent, roughness: 0.7 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.5 }),
      horn: new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.4, metalness: 0.3 }),
    };
    matCache[t.id] = m;
    return m;
  }

  // ---------------------------------------------------------------------------
  // Optional real glTF models (drop a .glb in models/ and set `model` on a type).
  // Any model is auto-centered and scaled to plush size; falls back to the
  // procedural mesh until/unless the model loads.
  // ---------------------------------------------------------------------------
  function loadModels() {
    if (typeof THREE.GLTFLoader !== 'function') return;
    const loader = new THREE.GLTFLoader();
    for (const t of plushTypes) {
      if (!t.model) continue;
      loader.load(MODEL_DIR + t.model,
        (gltf) => {
          try { modelCache[t.id] = buildModelTemplate(gltf); swapExisting(t.id); }
          catch (e) { console.warn('[scene3d] model build failed:', t.id, e); }
        },
        undefined,
        (err) => console.warn('[scene3d] model load failed (using fallback):', t.id, err));
    }
  }

  function buildModelTemplate(gltf) {
    const group = new THREE.Group();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);   // bake transform; render static (bind pose)
      if (geo.deleteAttribute) { geo.deleteAttribute('skinIndex'); geo.deleteAttribute('skinWeight'); }
      const src = Array.isArray(o.material) ? o.material : [o.material];
      const mats = src.map((m) => { const c = m.clone(); c.skinning = false; return c; });
      const mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
      mesh.castShadow = true;
      group.add(mesh);
    });
    // normalize: center at origin, scale to roughly plush size
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = (PLUSH_R * 2.4) / maxDim;
    for (const m of group.children) {
      m.geometry.translate(-center.x, -center.y, -center.z);
      m.geometry.scale(s, s, s);
    }
    return group;
  }

  function swapExisting(id) {
    const t = plushTypes.find((p) => p.id === id);
    if (!t) return;
    for (const it of pile) {
      if (it.typeId !== id) continue;
      scene.remove(it.mesh);
      it.mesh = makePlushMesh(t);
      scene.add(it.mesh);
    }
  }

  function makePlushMesh(t) {
    if (t.model && modelCache[t.id]) return modelCache[t.id].clone(true);
    const M = typeMats(t);
    const g = new THREE.Group();
    const body = new THREE.Mesh(PLUSH_GEO.body, M.body);
    body.scale.y = 1.04;
    body.castShadow = true;
    g.add(body);

    const belly = new THREE.Mesh(PLUSH_GEO.belly, M.belly);
    belly.position.set(0, -0.03, PLUSH_R * 0.62);
    belly.scale.set(1, 1.1, 0.6);
    g.add(belly);

    // ears
    if (t.ear === 'round') {
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(PLUSH_GEO.earRound, M.body);
        e.position.set(sx * PLUSH_R * 0.66, PLUSH_R * 0.82, 0);
        e.castShadow = true; g.add(e);
      }
    } else if (t.ear === 'long') {
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(PLUSH_GEO.earLong, M.body);
        e.position.set(sx * PLUSH_R * 0.42, PLUSH_R * 1.15, 0);
        e.rotation.z = sx * 0.18;
        e.castShadow = true; g.add(e);
      }
    } else if (t.ear === 'pointed') {
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(PLUSH_GEO.earPoint, M.body);
        e.position.set(sx * PLUSH_R * 0.66, PLUSH_R * 0.95, 0);
        e.rotation.z = sx * -0.35;
        e.castShadow = true; g.add(e);
      }
    }

    // eyes (+ catch-light) and rosy cheeks (front = +Z)
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(PLUSH_GEO.eye, M.dark);
      eye.position.set(sx * PLUSH_R * 0.34, PLUSH_R * 0.18, PLUSH_R * 0.88);
      g.add(eye);
      const glint = new THREE.Mesh(PLUSH_GEO.glint, glintMat);
      glint.position.set(sx * PLUSH_R * 0.30, PLUSH_R * 0.24, PLUSH_R * 0.99);
      g.add(glint);
      const cheek = new THREE.Mesh(PLUSH_GEO.cheek, cheekMat);
      cheek.position.set(sx * PLUSH_R * 0.55, PLUSH_R * 0.0, PLUSH_R * 0.74);
      cheek.scale.set(1, 0.7, 0.5);
      g.add(cheek);
    }
    const nose = new THREE.Mesh(PLUSH_GEO.nose, M.accent);
    nose.position.set(0, PLUSH_R * 0.02, PLUSH_R * 1.0);
    g.add(nose);

    if (t.horn) {
      const horn = new THREE.Mesh(PLUSH_GEO.horn, M.horn);
      horn.position.set(0, PLUSH_R * 1.15, PLUSH_R * 0.15);
      g.add(horn);
    }

    // feet
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(PLUSH_GEO.foot, M.body);
      f.position.set(sx * PLUSH_R * 0.5, -PLUSH_R * 0.9, PLUSH_R * 0.3);
      g.add(f);
    }
    return g;
  }

  function pickType() {
    const total = plushTypes.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of plushTypes) { if ((r -= p.weight) <= 0) return p; }
    return plushTypes[0];
  }

  function plushMaterialContact() {
    const m = new CANNON.Material('plush');
    const c = new CANNON.ContactMaterial(m, m, { friction: 0.55, restitution: 0.05 });
    world.addContactMaterial(c);
    return m;
  }
  let plushPhysMat = null;

  function addPlush(typeArg, dropFromTop) {
    const t = typeArg || pickType();
    const mesh = makePlushMesh(t);
    scene.add(mesh);
    const body = new CANNON.Body({
      mass: 0.6,
      shape: new CANNON.Sphere(PLUSH_R),
      material: plushPhysMat,
      linearDamping: 0.25,
      angularDamping: 0.55,
    });
    // spawn position: random over the heap region (avoid chute corner)
    const x = dropFromTop ? rand(-0.3, 0.9) : rand(-0.3, 0.9);
    const z = rand(-0.65, 0.8);
    const y = dropFromTop ? rand(1.6, 2.2) : rand(0.25, 1.4);
    body.position.set(x, y, z);
    body.quaternion.setFromEuler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.15;
    body.sleepTimeLimit = 0.6;
    world.addBody(body);
    pile.push({ mesh, body, typeId: t.id });
  }

  function removeItem(item) {
    scene.remove(item.mesh);
    item.mesh.traverse((o) => { /* shared geo/mats: do not dispose */ });
    world.removeBody(item.body);
    const i = pile.indexOf(item);
    if (i >= 0) pile.splice(i, 1);
  }

  function fillPile(n) {
    const target = n || PILE_TARGET;
    while (pile.length < target) addPlush(null, true);
  }

  // ---------------------------------------------------------------------------
  // Cabinet construction
  // ---------------------------------------------------------------------------
  function makeTextTexture(text, w, h, bg, fg) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.fillStyle = fg;
    x.font = `800 ${Math.round(h * 0.5)}px system-ui, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = fg; x.shadowBlur = h * 0.18;
    x.fillText(text, w / 2, h * 0.54);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  function makeRadialGlow() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function neonEdge(ax, ay, az, bx, by, bz, colorMat) {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(0.025, 0.025, len, 8);
    const m = new THREE.Mesh(geo, colorMat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize());
    scene.add(m);
    return m;
  }

  function buildCabinet() {
    const fH = WALL_Y;        // visible cabinet height for walls/glass
    // floor
    floorMat = new THREE.MeshStandardMaterial({ color: 0x33455f, roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 + 0.4, 0.2, HZ * 2 + 0.4), floorMat);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    scene.add(floor);

    // back + side walls (semi-opaque dark panels)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x182338, roughness: 0.9, side: THREE.DoubleSide });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, fH + 1.0), wallMat);
    back.position.set(0, (fH + 1.0) / 2, -HZ); back.receiveShadow = true; scene.add(back);
    const leftW = new THREE.Mesh(new THREE.PlaneGeometry(HZ * 2, fH + 1.0), wallMat);
    leftW.rotation.y = Math.PI / 2; leftW.position.set(-HX, (fH + 1.0) / 2, 0); scene.add(leftW);
    const rightW = new THREE.Mesh(new THREE.PlaneGeometry(HZ * 2, fH + 1.0), wallMat);
    rightW.rotation.y = -Math.PI / 2; rightW.position.set(HX, (fH + 1.0) / 2, 0); scene.add(rightW);

    // frame posts (corners) — recolored by theme
    frameMats = [];
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x34528f, roughness: 0.5, metalness: 0.3 });
    frameMats.push(frameMat);
    const postGeo = new THREE.BoxGeometry(0.09, RAIL_TOP + 0.5, 0.09);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.set(sx * HX, (RAIL_TOP + 0.5) / 2 - 0.1, sz * HZ);
      post.castShadow = true; scene.add(post);
    }

    // neon edges — emissive so the bloom pass makes them glow; recolored by theme
    const neonMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xff5d8f, emissiveIntensity: 2.6, roughness: 1, metalness: 0,
    });
    neonMats = [neonMat];
    const topY = RAIL_TOP + 0.42;
    // top rectangle
    neonEdge(-HX, topY, HZ, HX, topY, HZ, neonMat);
    neonEdge(-HX, topY, -HZ, HX, topY, -HZ, neonMat);
    neonEdge(-HX, topY, -HZ, -HX, topY, HZ, neonMat);
    neonEdge(HX, topY, -HZ, HX, topY, HZ, neonMat);
    // front vertical edges
    neonEdge(-HX, -0.1, HZ, -HX, topY, HZ, neonMat);
    neonEdge(HX, -0.1, HZ, HX, topY, HZ, neonMat);

    // glass front (subtle, see-through)
    glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xbfe0ff, transparent: true, opacity: 0.07,
      roughness: 0.05, metalness: 0, transmission: 0, side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, fH + 1.0), glassMat);
    glass.position.set(0, (fH + 1.0) / 2, HZ);
    glass.renderOrder = 2;
    scene.add(glass);

    // marquee
    const marqueeTex = makeTextTexture('CLAW CRAZE', 512, 128, '#1a1030', '#ff8fd0');
    const marquee = new THREE.Mesh(
      new THREE.BoxGeometry(HX * 2, 0.42, 0.12),
      [new THREE.MeshStandardMaterial({ color: 0x222 }), new THREE.MeshStandardMaterial({ color: 0x222 }),
       new THREE.MeshStandardMaterial({ color: 0x222 }), new THREE.MeshStandardMaterial({ color: 0x222 }),
       new THREE.MeshBasicMaterial({ map: marqueeTex }), new THREE.MeshStandardMaterial({ color: 0x222 })]
    );
    marquee.position.set(0, RAIL_TOP + 0.62, HZ);
    scene.add(marquee);

    // number plate ("8") on the back wall
    const numTex = makeTextTexture('8', 128, 128, '#1c7a2e', '#eaffea');
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshBasicMaterial({ map: numTex }));
    plate.position.set(0.55, 1.25, -HZ + 0.02);
    scene.add(plate);

    buildChute();
    buildClaw();
    buildBase();
  }

  // Lower console (pedestal) with control panel, joystick, buttons + coin door,
  // sitting on a glossy reflective arcade floor with a neon puddle of light.
  function buildBase() {
    const bw = HX * 2 + 0.18, bd = HZ * 2 + 0.18;
    const baseY = BASE_TOP - BASE_H / 2;
    const groundY = BASE_TOP - BASE_H;
    const frontZ = HZ + 0.09;

    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a3a5c, roughness: 0.42, metalness: 0.35 });
    frameMats.push(baseMat); // recolored with the cabinet frame per theme
    const base = new THREE.Mesh(new THREE.BoxGeometry(bw, BASE_H, bd), baseMat);
    base.position.set(0, baseY, 0);
    base.castShadow = true; base.receiveShadow = true;
    scene.add(base);

    // angled control panel
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x161f33, roughness: 0.5, metalness: 0.3 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.92, 0.09, 0.46), panelMat);
    panel.position.set(0, BASE_TOP - 0.04, frontZ + 0.04);
    panel.rotation.x = -0.55;
    panel.castShadow = true; scene.add(panel);

    // joystick
    const stickMat = new THREE.MeshStandardMaterial({ color: 0x20262f, roughness: 0.6, metalness: 0.2 });
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.18, 12), stickMat);
    stick.position.set(-0.34, BASE_TOP + 0.07, frontZ + 0.12);
    stick.rotation.x = -0.55; scene.add(stick);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xe23a55, roughness: 0.3, metalness: 0.1 }));
    knob.position.set(-0.34, BASE_TOP + 0.16, frontZ + 0.06); scene.add(knob);

    // two glowing buttons
    const mkBtn = (x, color) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 18),
        new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: color, emissiveIntensity: 1.8, roughness: 0.4 }));
      b.position.set(x, BASE_TOP + 0.06, frontZ + 0.08);
      b.rotation.x = -0.55 + Math.PI / 2; scene.add(b);
    };
    mkBtn(0.18, 0x39ff9a); mkBtn(0.36, 0x39b6ff);

    // coin door on the base front
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x0c1120, roughness: 0.55, metalness: 0.45 }));
    door.position.set(0, BASE_TOP - 0.62, frontZ + 0.02); scene.add(door);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xf2c044, emissive: 0x3a2a00, roughness: 0.4, metalness: 0.6 }));
    slot.position.set(0, BASE_TOP - 0.46, frontZ + 0.05); scene.add(slot);

    // glossy arcade floor (reflects the procedural environment)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(46, 46),
      new THREE.MeshStandardMaterial({ color: 0x090d18, roughness: 0.22, metalness: 0.55, envMapIntensity: 1.1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = groundY;
    ground.receiveShadow = true;
    scene.add(ground);

    // neon puddle under the cabinet (additive, recolored per theme)
    floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2),
      new THREE.MeshBasicMaterial({ map: makeRadialGlow(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
    floorGlow.rotation.x = -Math.PI / 2;
    floorGlow.position.y = groundY + 0.01;
    scene.add(floorGlow);
  }

  function buildChute() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a0e16, roughness: 1 });
    const cx = (CHUTE.x0 + CHUTE.x1) / 2, cz = (CHUTE.z0 + CHUTE.z1) / 2;
    const w = CHUTE.x1 - CHUTE.x0, d = CHUTE.z1 - CHUTE.z0;
    // recessed dark floor of the chute
    const inner = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), dark);
    inner.position.set(cx, 0.005, cz);
    scene.add(inner);
    // chute lip (visible curb) on the two inner sides
    const lipMat = new THREE.MeshStandardMaterial({ color: 0x2b3b5c, roughness: 0.6 });
    const lipA = new THREE.Mesh(new THREE.BoxGeometry(w, CHUTE.lip, 0.06), lipMat);
    lipA.position.set(cx, CHUTE.lip / 2, CHUTE.z0);
    lipA.castShadow = true; scene.add(lipA);
    const lipB = new THREE.Mesh(new THREE.BoxGeometry(0.06, CHUTE.lip, d), lipMat);
    lipB.position.set(CHUTE.x1, CHUTE.lip / 2, cz);
    lipB.castShadow = true; scene.add(lipB);
  }

  // helix curve for the spring cable
  class Helix extends THREE.Curve {
    constructor(len, coils, radius) { super(); this.len = len; this.coils = coils; this.radius = radius; }
    getPoint(t, target = new THREE.Vector3()) {
      const a = this.coils * Math.PI * 2 * t;
      return target.set(this.radius * Math.cos(a), -this.len * t, this.radius * Math.sin(a));
    }
  }
  const CABLE_BASE = 1.4;

  function buildClaw() {
    clawGroup = new THREE.Group();
    scene.add(clawGroup);

    const metal = new THREE.MeshStandardMaterial({ color: 0xcdd4e2, roughness: 0.35, metalness: 0.7 });

    // rail across the top (visual, full width)
    const rail = new THREE.Mesh(new THREE.BoxGeometry(HX * 2, 0.08, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x7d869c, roughness: 0.5, metalness: 0.5 }));
    rail.position.set(0, RAIL_TOP, 0);
    scene.add(rail);

    trolley = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.26), metal);
    trolley.castShadow = true;
    clawGroup.add(trolley);

    // spring cable
    const cableGeo = new THREE.TubeGeometry(new Helix(CABLE_BASE, 14, 0.035), 90, 0.022, 6, false);
    cable = new THREE.Mesh(cableGeo, new THREE.MeshStandardMaterial({ color: 0x9fb0d0, roughness: 0.5, metalness: 0.4 }));
    clawGroup.add(cable);

    clawHead = new THREE.Group();
    clawGroup.add(clawHead);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 14), metal);
    hub.castShadow = true;
    clawHead.add(hub);

    // 3 prongs pivoting at the hub
    prongs = [];
    const prongGeo = new THREE.BoxGeometry(0.05, 0.34, 0.05);
    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / 3) * Math.PI * 2;
      const pr = new THREE.Mesh(prongGeo, metal);
      pr.position.set(0.0, -0.18, 0.1);
      pr.castShadow = true;
      pivot.add(pr);
      pivot.position.y = -0.05;
      clawHead.add(pivot);
      prongs.push(pivot);
    }

    // kinematic physics body for the claw head
    clawBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.22) });
    clawBody.collisionResponse = true;
    world.addBody(clawBody);
  }

  // Aim reticle: a glowing ring projected straight down from the claw onto the
  // top of the heap. Color shifts red→green by how well-centered the claw is over
  // the nearest plush, teaching the location-based grab mechanic.
  function buildReticle() {
    const geo = new THREE.RingGeometry(0.16, 0.235, 40);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x66ff99, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthTest: false,
    });
    reticle = new THREE.Mesh(geo, mat);
    reticle.rotation.x = -Math.PI / 2;
    reticle.renderOrder = 6;
    reticle.visible = false;
    scene.add(reticle);
    raycaster = new THREE.Raycaster();
  }

  function nearestDist(wx, wz) {
    let best = Infinity;
    for (const it of pile) {
      const d = Math.hypot(it.body.position.x - wx, it.body.position.z - wz);
      if (d < best) best = d;
    }
    return best;
  }

  function updateReticle() {
    if (!reticle) return;
    if (!aimMode) { reticle.visible = false; return; }
    const wx = toWorldX(clawState.x), wz = toWorldZ(clawState.z);
    // drop a ray from the rail straight down to find the heap surface
    raycaster.set(new THREE.Vector3(wx, RAIL_TOP, wz), new THREE.Vector3(0, -1, 0));
    const hits = raycaster.intersectObjects(pile.map((p) => p.mesh), true);
    const y = hits.length ? hits[0].point.y + 0.03 : 0.06;
    reticle.position.set(wx, y, wz);
    reticle.visible = true;
    // tint by alignment with the nearest plush (red = poor, green = dead-on)
    const align = clamp(1 - nearestDist(wx, wz) / GRASP, 0, 1);
    reticle.material.color.setHSL(lerp(0.0, 0.33, align), 0.9, 0.55);
    reticle.material.opacity = 0.55 + 0.4 * align;
    const s = 1 + Math.sin(performance.now() * 0.006) * 0.06;
    reticle.scale.set(s, s, s);
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------
  function positionClaw() {
    const wx = toWorldX(clawState.x), wz = toWorldZ(clawState.z);
    clawGroup.position.set(wx, 0, wz);
    const headY = lerp(RAIL_TOP - 0.28, GRAB_Y, clawState.drop);
    clawHead.position.y = headY;
    trolley.position.y = RAIL_TOP - 0.06;
    // cable from trolley down to head
    const cableLen = (RAIL_TOP - 0.06) - (headY + 0.09);
    cable.position.y = RAIL_TOP - 0.06;
    cable.scale.y = Math.max(0.02, cableLen / CABLE_BASE);
    // prongs open(0)->closed(1)
    const open = lerp(0.5, -0.15, clawState.prong);
    for (const p of prongs) p.rotation.x = open;

    // physics: teleport claw body to head world position
    clawBody.position.set(wx, headY - 0.16, wz);
    clawBody.velocity.set(0, 0, 0);

    // held plush hangs under the claw
    if (held) {
      held.body.position.set(wx, headY - 0.3, wz);
      held.body.velocity.set(0, 0, 0);
      held.body.angularVelocity.set(0, 0, 0);
    }
  }

  function stepPhysics(dt) {
    fixedAcc += dt;
    let steps = 0;
    while (fixedAcc >= FIXED && steps < 5) {
      world.step(FIXED);
      fixedAcc -= FIXED;
      steps++;
    }
  }

  function syncMeshes() {
    for (const it of pile) {
      it.mesh.position.copy(it.body.position);
      it.mesh.quaternion.copy(it.body.quaternion);
      // safety: if a body escapes, recycle it into the heap
      if (it.body.position.y < -2 || Math.abs(it.body.position.x) > 4) {
        it.body.position.set(rand(-0.3, 0.8), rand(1.6, 2.1), rand(-0.5, 0.6));
        it.body.velocity.set(0, 0, 0);
      }
    }
  }

  function updateCollecting(dt) {
    for (let i = collecting.length - 1; i >= 0; i--) {
      const c = collecting[i];
      c.t += dt;
      if (c.t > 0.85) {
        removeItem(c.item);
        collecting.splice(i, 1);
        addPlush(null, true); // respawn to keep the heap full
      }
    }
  }

  function updateCamera() {
    const sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
    const st = Math.sin(orbit.theta), ct = Math.cos(orbit.theta);
    camera.position.set(
      orbit.tx + orbit.radius * sp * st,
      orbit.ty + orbit.radius * cp,
      orbit.tz + orbit.radius * sp * ct
    );
    camera.lookAt(orbit.tx, orbit.ty, orbit.tz);
  }

  // ---------------------------------------------------------------------------
  // Environment lighting (procedural PMREM "studio")
  // ---------------------------------------------------------------------------
  function initEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x161c2a);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const panel = (color, x, y, z, sx, sy, sz) => {
      const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color }));
      m.position.set(x, y, z); m.scale.set(sx, sy, sz); envScene.add(m);
    };
    panel(0xffffff, 0, 6, 0, 8, 0.3, 8);      // soft top light
    panel(0x6f88ff, -5, 1.5, 2, 0.3, 5, 6);   // cool rim (left)
    panel(0xff77c2, 5, 1.5, -2, 0.3, 5, 6);   // warm/neon rim (right)
    panel(0x3a4566, 0, 0, -6, 8, 6, 0.3); // back fill
    const envRT = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();
  }

  // ---------------------------------------------------------------------------
  // Post-processing: HDR scene buffer -> bloom -> ACES tone-map composite
  // ---------------------------------------------------------------------------
  let sceneRT, bloomA, bloomB, postType;
  let fsScene, fsCam, fsQuad;
  let brightMat, blurMat, compositeMat;
  const BLOOM = { threshold: 0.85, knee: 0.2, strength: 0.7, iterations: 3 };

  const FS_VERT = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  function initPost() {
    postType = (renderer.capabilities.isWebGL2 ||
      renderer.extensions.has('EXT_color_buffer_half_float'))
      ? THREE.HalfFloatType : THREE.UnsignedByteType;

    fsScene = new THREE.Scene();
    fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    fsQuad.frustumCulled = false;
    fsScene.add(fsQuad);

    brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, threshold: { value: BLOOM.threshold }, knee: { value: BLOOM.knee } },
      vertexShader: FS_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float threshold; uniform float knee;
        varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float k = smoothstep(threshold, threshold + knee, l);
          gl_FragColor = vec4(c * k, 1.0);
        }`,
    });

    blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, direction: { value: new THREE.Vector2(1, 0) }, texel: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 direction; uniform vec2 texel;
        varying vec2 vUv;
        void main(){
          vec2 o1 = texel * direction * 1.3846153846;
          vec2 o2 = texel * direction * 3.2307692308;
          vec3 col = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
          col += texture2D(tDiffuse, vUv + o1).rgb * 0.3162162162;
          col += texture2D(tDiffuse, vUv - o1).rgb * 0.3162162162;
          col += texture2D(tDiffuse, vUv + o2).rgb * 0.0702702703;
          col += texture2D(tDiffuse, vUv - o2).rgb * 0.0702702703;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    compositeMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tBloom: { value: null }, strength: { value: BLOOM.strength }, exposure: { value: 1.2 } },
      vertexShader: FS_VERT,
      fragmentShader: `
        uniform sampler2D tScene; uniform sampler2D tBloom;
        uniform float strength; uniform float exposure;
        varying vec2 vUv;
        void main(){
          // scene is already display-space; add bloom then roll off highlights
          // (exposure tone-map) without re-applying gamma.
          vec3 col = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * strength;
          col = vec3(1.0) - exp(-col * exposure);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }

  function resizePost(w, h) {
    if (!fsScene) return;
    const opt = { type: postType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const hw = Math.max(1, Math.floor(w / 2)), hh = Math.max(1, Math.floor(h / 2));
    if (sceneRT) { sceneRT.dispose(); bloomA.dispose(); bloomB.dispose(); }
    sceneRT = new THREE.WebGLRenderTarget(w, h, opt);
    bloomA = new THREE.WebGLRenderTarget(hw, hh, { type: postType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    bloomB = new THREE.WebGLRenderTarget(hw, hh, { type: postType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }

  function pass(mat, target) {
    fsQuad.material = mat;
    renderer.setRenderTarget(target || null);
    renderer.render(fsScene, fsCam);
  }

  function renderPost() {
    if (!sceneRT) { renderer.render(scene, camera); return; }
    // 1) scene -> HDR buffer
    renderer.setRenderTarget(sceneRT);
    renderer.clear();
    renderer.render(scene, camera);
    // 2) bright pass -> half-res
    brightMat.uniforms.tDiffuse.value = sceneRT.texture;
    pass(brightMat, bloomA);
    // 3) separable gaussian blur (ping-pong)
    const texel = new THREE.Vector2(1 / bloomA.width, 1 / bloomA.height);
    for (let i = 0; i < BLOOM.iterations; i++) {
      blurMat.uniforms.tDiffuse.value = bloomA.texture;
      blurMat.uniforms.texel.value = texel;
      blurMat.uniforms.direction.value.set(1, 0);
      pass(blurMat, bloomB);
      blurMat.uniforms.tDiffuse.value = bloomB.texture;
      blurMat.uniforms.direction.value.set(0, 1);
      pass(blurMat, bloomA);
    }
    // 4) composite + tone-map to screen
    compositeMat.uniforms.tScene.value = sceneRT.texture;
    compositeMat.uniforms.tBloom.value = bloomA.texture;
    pass(compositeMat, null);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function init(canvasEl, types, pal) {
    canvas = canvasEl;
    plushTypes = types;
    palette = pal;

    // This three build is legacy/gamma-space; keep color management off so the
    // composite pass can tone-map in display space without double-gamma.
    if (THREE.ColorManagement) THREE.ColorManagement.enabled = false;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The scene renders linear into an HDR buffer; tone-mapping + sRGB happen in
    // the composite post pass, so keep the renderer itself neutral.
    renderer.toneMapping = THREE.NoToneMapping;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1424);
    scene.fog = new THREE.Fog(0x0c1424, 11, 26);

    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);

    // image-based lighting from a small procedural studio (PMREM) gives the
    // metal/glass realistic reflections; real lights stay subtle on top.
    initEnvironment();
    scene.add(new THREE.AmbientLight(0x46506a, 0.35));
    keyLight = new THREE.DirectionalLight(0xfff2e6, 1.45);
    keyLight.position.set(2.4, 5, 3.4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.radius = 4;
    keyLight.shadow.bias = -0.0008;
    const sc = keyLight.shadow.camera;
    sc.left = -2.6; sc.right = 2.6; sc.top = 3.2; sc.bottom = -1.6; sc.near = 1; sc.far = 13;
    scene.add(keyLight);
    accentLight = new THREE.PointLight(0xff5d8f, 1.1, 9, 2);
    accentLight.position.set(0, RAIL_TOP - 0.2, 0.1);
    scene.add(accentLight);

    // physics
    world = new CANNON.World();
    world.gravity.set(0, -9.2, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 12;
    world.allowSleep = true;
    plushPhysMat = plushMaterialContact();
    buildStaticBodies();

    buildGeometries();
    buildCabinet();
    buildReticle();
    loadModels();           // async; prizes pop in when their .glb loads
    if (pal) applyTheme(pal);
    initPost();
    resize();

    // camera drag-to-orbit (canvas only; buttons are separate DOM)
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      orbit.theta = clamp(orbit.theta - (e.clientX - lastX) * 0.006, -0.7, 0.7);
      orbit.phi = clamp(orbit.phi - (e.clientY - lastY) * 0.005, 0.78, 1.32);
      lastX = e.clientX; lastY = e.clientY;
    });
  }

  function buildStaticBodies() {
    const add = (sx, sy, sz, px, py, pz) => {
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(sx, sy, sz)) });
      b.position.set(px, py, pz);
      world.addBody(b);
    };
    add(HX + 0.3, 0.2, HZ + 0.3, 0, -0.2, 0);          // floor
    add(0.1, WALL_Y, HZ + 0.3, -HX - 0.1, WALL_Y, 0);  // left
    add(0.1, WALL_Y, HZ + 0.3, HX + 0.1, WALL_Y, 0);   // right
    add(HX + 0.3, WALL_Y, 0.1, 0, WALL_Y, -HZ - 0.1);  // back
    add(HX + 0.3, WALL_Y, 0.1, 0, WALL_Y, HZ + 0.1);   // front (invisible)
    // chute curb (keeps the heap out of the chute corner)
    const cx = (CHUTE.x0 + CHUTE.x1) / 2, cz = (CHUTE.z0 + CHUTE.z1) / 2;
    add((CHUTE.x1 - CHUTE.x0) / 2, CHUTE.lip, 0.04, cx, CHUTE.lip, CHUTE.z0); // inner wall (z)
    add(0.04, CHUTE.lip, (CHUTE.z1 - CHUTE.z0) / 2, CHUTE.x1, CHUTE.lip, cz); // inner wall (x)
  }

  function setClaw(x, z, drop, prong) {
    clawState.x = x; clawState.z = z; clawState.drop = drop; clawState.prong = prong;
  }

  // nearest grabbable plush under the claw, with how centered the claw is over it.
  // Returns { item, dist, reach, typeId } or null (nothing within reach).
  function grabCandidate() {
    const wx = toWorldX(clawState.x), wz = toWorldZ(clawState.z);
    let best = null, bestD = GRASP;
    for (const it of pile) {
      const dx = it.body.position.x - wx, dz = it.body.position.z - wz;
      const d = Math.hypot(dx, dz);
      if (d < bestD && it.body.position.y < GRAB_Y + 0.7) { bestD = d; best = it; }
    }
    return best ? { item: best, dist: bestD, reach: GRASP, typeId: best.typeId } : null;
  }

  function setAimMode(b) { aimMode = b; if (reticle) reticle.visible = b; }

  function attach(item) {
    if (!item) return;
    held = item;
    held.body.type = CANNON.Body.KINEMATIC;
    held.body.allowSleep = false;
    held.body.velocity.set(0, 0, 0);
    held.body.angularVelocity.set(0, 0, 0);
    held.body.wakeUp();
  }
  function hasHeld() { return !!held; }
  function heldTypeId() { return held ? held.typeId : null; }

  function release(kind) {
    if (!held) return;
    const b = held.body;
    b.type = CANNON.Body.DYNAMIC;
    b.allowSleep = true;
    b.wakeUp();
    if (kind === 'chaos') b.velocity.set(rand(-1.2, 1.2), -0.5, rand(-1.2, 1.2));
    else b.velocity.set(0, -0.5, 0);
    held = null;
  }

  // win: drop the held plush into the chute, then collect + respawn
  function consumeWin() {
    if (!held) return;
    const item = held;
    held = null;
    item.body.type = CANNON.Body.DYNAMIC;
    item.body.allowSleep = true;
    item.body.wakeUp();
    // nudge toward the chute corner
    item.body.velocity.set(-0.6, -1.0, 0.6);
    collecting.push({ item, t: 0 });
  }

  function reset() {
    for (const it of pile.slice()) removeItem(it);
    pile = []; held = null; collecting = [];
    fillPile();
  }

  function applyTheme(pal) {
    palette = pal;
    const bg = new THREE.Color(pal.page[0]);
    scene.background = bg;
    scene.fog.color = bg;
    const accent = new THREE.Color(pal.accent);
    for (const m of neonMats) (m.emissive || m.color).set(accent);
    accentLight.color.set(accent);
    if (floorGlow) floorGlow.material.color.set(accent);
    for (const m of frameMats) m.color.set(new THREE.Color(pal.frame));
    if (floorMat) floorMat.color.set(new THREE.Color(pal.floor));
  }

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    // Tall (portrait) screens need a wider fov + a bit more distance so the
    // whole cabinet (marquee → claw → heap) stays framed.
    if (aspect < 0.7) { camera.fov = 58; orbit.radius = 6.9; }
    else if (aspect < 1.1) { camera.fov = 52; orbit.radius = 6.4; }
    else { camera.fov = 45; orbit.radius = 5.9; }
    camera.updateProjectionMatrix();
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    resizePost(buf.x, buf.y);
  }

  function update(dt) {
    positionClaw();
    stepPhysics(dt);
    syncMeshes();
    updateCollecting(dt);
    updateReticle();
    updateCamera();
    renderPost();
  }

  return {
    init, resize, update, setClaw, fillPile, reset, applyTheme,
    grabCandidate, attach, release, consumeWin, hasHeld, heldTypeId, setAimMode,
  };
})();
