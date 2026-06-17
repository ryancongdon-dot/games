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
  let frameMats = [], neonMats = [], floorMat, glassMat;
  let plushTypes = [];      // injected from game.js (PLUSH_TYPES)
  let palette = null;
  const matCache = {};      // per-type materials

  // claw target (set by game each frame)
  const clawState = { x: 0.05, z: 0.06, drop: 0, prong: 0 };

  // camera orbit
  const orbit = { theta: 0, phi: 1.0, radius: 6.4, tx: 0, ty: 1.05, tz: 0 };
  let dragging = false, lastX = 0, lastY = 0;

  const PLUSH_GEO = {};

  function buildGeometries() {
    PLUSH_GEO.body = new THREE.SphereGeometry(PLUSH_R, 18, 14);
    PLUSH_GEO.belly = new THREE.SphereGeometry(PLUSH_R * 0.66, 14, 12);
    PLUSH_GEO.earRound = new THREE.SphereGeometry(PLUSH_R * 0.42, 12, 10);
    PLUSH_GEO.earLong = new THREE.CapsuleGeometry(PLUSH_R * 0.22, PLUSH_R * 0.85, 4, 8);
    PLUSH_GEO.earPoint = new THREE.ConeGeometry(PLUSH_R * 0.42, PLUSH_R * 0.8, 12);
    PLUSH_GEO.eye = new THREE.SphereGeometry(PLUSH_R * 0.13, 8, 6);
    PLUSH_GEO.nose = new THREE.SphereGeometry(PLUSH_R * 0.14, 8, 6);
    PLUSH_GEO.horn = new THREE.ConeGeometry(PLUSH_R * 0.24, PLUSH_R * 0.7, 10);
    PLUSH_GEO.foot = new THREE.SphereGeometry(PLUSH_R * 0.3, 8, 6);
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

  function makePlushMesh(t) {
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

    // eyes + nose (front = +Z)
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(PLUSH_GEO.eye, M.dark);
      eye.position.set(sx * PLUSH_R * 0.34, PLUSH_R * 0.18, PLUSH_R * 0.9);
      g.add(eye);
    }
    const nose = new THREE.Mesh(PLUSH_GEO.nose, M.accent);
    nose.position.set(0, 0, PLUSH_R * 1.0);
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

    // neon edges (bright, glow-like) — recolored by theme
    const neonMat = new THREE.MeshBasicMaterial({ color: 0xff5d8f });
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
  // Public API
  // ---------------------------------------------------------------------------
  function init(canvasEl, types, pal) {
    canvas = canvasEl;
    plushTypes = types;
    palette = pal;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1424);
    scene.fog = new THREE.Fog(0x0c1424, 6, 11);

    camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);

    // lights
    scene.add(new THREE.AmbientLight(0x556080, 0.85));
    keyLight = new THREE.DirectionalLight(0xffffff, 1.05);
    keyLight.position.set(2.4, 5, 3.4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    const sc = keyLight.shadow.camera;
    sc.left = -2.4; sc.right = 2.4; sc.top = 3; sc.bottom = -1; sc.near = 1; sc.far = 12;
    scene.add(keyLight);
    accentLight = new THREE.PointLight(0xff5d8f, 0.9, 8, 2);
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
    if (pal) applyTheme(pal);
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

  // nearest grabbable plush under the claw (horizontal reach), or null
  function grabCandidate() {
    const wx = toWorldX(clawState.x), wz = toWorldZ(clawState.z);
    let best = null, bestD = GRASP;
    for (const it of pile) {
      const dx = it.body.position.x - wx, dz = it.body.position.z - wz;
      const d = Math.hypot(dx, dz);
      if (d < bestD && it.body.position.y < GRAB_Y + 0.7) { bestD = d; best = it; }
    }
    return best;
  }

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
    for (const m of neonMats) m.color.set(accent);
    accentLight.color.set(accent);
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
    if (aspect < 0.7) { camera.fov = 56; orbit.radius = 6.8; }
    else if (aspect < 1.1) { camera.fov = 50; orbit.radius = 6.2; }
    else { camera.fov = 42; orbit.radius = 5.6; }
    camera.updateProjectionMatrix();
  }

  function update(dt) {
    positionClaw();
    stepPhysics(dt);
    syncMeshes();
    updateCollecting(dt);
    updateCamera();
    renderer.render(scene, camera);
  }

  return {
    init, resize, update, setClaw, fillPile, reset, applyTheme,
    grabCandidate, attach, release, consumeWin, hasHeld, heldTypeId,
  };
})();
