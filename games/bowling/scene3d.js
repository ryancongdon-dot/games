// scene3d.js — WebGL 3D bowling lane + cannon.js physics.
// Exposes a global `Scene` the game state machine (game.js) drives.
// Requires THREE (three.min.js) and CANNON (cannon.min.js) loaded first.
//
// Look & feel goal: "clear, not jumbled" like Dave the Diver — crisp pixel
// rendering (low-res buffer upscaled nearest-neighbour), distinct depth layers
// (sharp playfield, hazy background), and RESTRAINED lighting (no heavy bloom).
const Scene = (() => {
  'use strict';

  // ---------- tuning / dimensions (metres) ----------
  const PIXEL = 3.0;          // bigger = chunkier pixels (the Dave-the-Diver crunch)
  const LANE_LEN = 16.5;      // foul line (z=0) to pit (z=-LANE_LEN)
  const LANE_HW = 0.53;       // lane half-width
  const GUTTER_W = 0.24;      // gutter channel width each side
  const GUTTER_DROP = 0.16;   // how far gutters sit below the lane
  const BALL_R = 0.108;
  const PIN_HW = 0.06;        // pin physics box half width/depth
  const PIN_HH = 0.19;        // pin physics box half height
  const Z_HEAD = -14.4;       // head-pin z (nearest pin to bowler)
  const DX = 0.1525;          // half the 12" pin spacing
  const DZ = 0.264;           // row depth spacing
  const FIXED = 1 / 60;

  // ---------- SHOT FEEL (tune these after playing a few frames) ----------
  // Bowling "feel" always needs playtest iteration — these are the main dials.
  const SHOT = {
    speedMin: 7.0, speedMax: 12.5,   // forward m/s mapped from POWER 0..1
    drift: 0.10,                     // initial sideways nudge per unit CURVE
    hookMin: 0.15, hookMax: 0.55,    // lateral accel per unit CURVE, scaled by SPIN
    backEnd: 0.40,                   // share of hook that only kicks in as ball slows
    spinViz: 18,                     // visual ball spin (rad/s) at full curve+spin
  };

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // The 10 pin spots, indexed 0..9 (0 = head pin).
  const PIN_SPOTS = [
    [0, Z_HEAD],
    [-DX, Z_HEAD - DZ], [DX, Z_HEAD - DZ],
    [-2 * DX, Z_HEAD - 2 * DZ], [0, Z_HEAD - 2 * DZ], [2 * DX, Z_HEAD - 2 * DZ],
    [-3 * DX, Z_HEAD - 3 * DZ], [-DX, Z_HEAD - 3 * DZ], [DX, Z_HEAD - 3 * DZ], [3 * DX, Z_HEAD - 3 * DZ],
  ];

  // ---------- module state ----------
  let renderer, scene, camera, canvas;
  let world;
  let ballMesh, ballBody;
  let pins = [];              // { mesh, body, spot:[x,z] }
  let arrowsGroup, aimLine;
  let cssW = 1, cssH = 1;

  // rolling state
  let rolling = false;
  let hookDir = 0, hookMag = 0;     // applied as lateral accel while ball travels
  let rollTime = 0;
  let inGutter = false;
  let settleTimer = 0;
  let onSettled = null;

  // camera rig
  const camHome = new THREE.Vector3(0, 1.95, 3.0);
  const camLookHome = new THREE.Vector3(0, 0.45, -6.5);
  const camPos = camHome.clone();
  const camLook = camLookHome.clone();

  // ---------- pin mesh (tapered bowling pin) ----------
  function makePinMesh() {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.5, metalness: 0.0 });
    const red = new THREE.MeshStandardMaterial({ color: 0xe8453c, roughness: 0.5 });
    // body: a lathe-ish profile faked with stacked cylinders for a chunky look
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.20, 12), white);
    lower.position.y = -0.09; g.add(lower);
    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.052, 0.10, 12), white);
    waist.position.y = 0.06; g.add(waist);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.036, 0.06, 12), white);
    neck.position.y = 0.14; g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), white);
    head.position.y = 0.185; g.add(head);
    // two red stripes on the neck
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.018, 12), red);
    s1.position.y = 0.115; g.add(s1);
    const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.0315, 0.0315, 0.016, 12), red);
    s2.position.y = 0.155; g.add(s2);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  function buildLane() {
    // lane surface (warm honey wood, the bright crisp playfield layer)
    const laneMat = new THREE.MeshStandardMaterial({ color: 0xc98b3e, roughness: 0.35, metalness: 0.05 });
    const lane = new THREE.Mesh(new THREE.BoxGeometry(LANE_HW * 2, 0.2, LANE_LEN + 2), laneMat);
    lane.position.set(0, -0.1, -LANE_LEN / 2 + 0.5);
    lane.receiveShadow = true;
    scene.add(lane);

    // subtle board seams (thin dark lines down the lane) for readable depth
    const seamMat = new THREE.MeshStandardMaterial({ color: 0x8a5a23, roughness: 0.6 });
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.205, LANE_LEN + 2), seamMat);
      seam.position.set(i * (LANE_HW / 3.5), -0.097, -LANE_LEN / 2 + 0.5);
      scene.add(seam);
    }

    // gutters (cool blue channels — contrast against the warm lane)
    const gutMat = new THREE.MeshStandardMaterial({ color: 0x2c6db0, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const gut = new THREE.Mesh(new THREE.BoxGeometry(GUTTER_W, 0.2, LANE_LEN + 2), gutMat);
      gut.position.set(s * (LANE_HW + GUTTER_W / 2), -0.1 - GUTTER_DROP, -LANE_LEN / 2 + 0.5);
      gut.receiveShadow = true;
      scene.add(gut);
    }

    // approach floor behind the foul line (darker foreground framing layer)
    const appMat = new THREE.MeshStandardMaterial({ color: 0x3a2f4f, roughness: 0.8 });
    const approach = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 5), appMat);
    approach.position.set(0, -0.11, 3.0);
    approach.receiveShadow = true;
    scene.add(approach);

    // foul line
    const foul = new THREE.Mesh(new THREE.BoxGeometry(LANE_HW * 2 + GUTTER_W * 2, 0.205, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xf2e6c0, roughness: 0.5 }));
    foul.position.set(0, -0.097, 0.2);
    scene.add(foul);

    // pin deck + back wall (the hazy BACKGROUND layer)
    const deck = new THREE.Mesh(new THREE.BoxGeometry(LANE_HW * 2 + GUTTER_W * 2, 0.2, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x232a3d, roughness: 0.7 }));
    deck.position.set(0, -0.1, -LANE_LEN - 0.4);
    deck.receiveShadow = true;
    scene.add(deck);

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(9, 4),
      new THREE.MeshStandardMaterial({ color: 0x39406b, roughness: 0.9 }));
    wall.position.set(0, 1.0, -LANE_LEN - 1.4);
    scene.add(wall);

    // a soft glowing masking strip above the pins (arcade marquee vibe, gentle)
    const mask = new THREE.Mesh(new THREE.PlaneGeometry(LANE_HW * 2 + GUTTER_W * 2 + 0.4, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x2b3566, emissive: 0x3550a8, emissiveIntensity: 0.5, roughness: 1 }));
    mask.position.set(0, 1.4, -LANE_LEN - 1.2);
    scene.add(mask);

    // aiming arrows painted on the lane (real lanes have these — great clarity aid)
    arrowsGroup = new THREE.Group();
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0x6b3f17, roughness: 0.6 });
    for (let i = -3; i <= 3; i++) {
      const a = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.18, 4), arrowMat);
      a.rotation.x = -Math.PI / 2;
      a.rotation.z = Math.PI / 4;
      a.position.set(i * 0.12, -0.094, -4.2 - Math.abs(i) * 0.18);
      arrowsGroup.add(a);
    }
    scene.add(arrowsGroup);

    // aim guide line (shown while aiming, hidden while rolling)
    const lineMat = new THREE.LineBasicMaterial({ color: 0x8fd6ff });
    const lg = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0.02, -6),
    ]);
    aimLine = new THREE.Line(lg, lineMat);
    aimLine.position.y = 0.005;
    scene.add(aimLine);
  }

  // ---------- physics world ----------
  function buildPhysics() {
    world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 12;
    world.defaultContactMaterial.friction = 0.25;

    const laneMat = new CANNON.Material('lane');
    const ballMat = new CANNON.Material('ball');
    const pinMat = new CANNON.Material('pin');
    world.addContactMaterial(new CANNON.ContactMaterial(laneMat, ballMat, { friction: 0.16, restitution: 0.02 }));
    world.addContactMaterial(new CANNON.ContactMaterial(laneMat, pinMat, { friction: 0.4, restitution: 0.05 }));
    world.addContactMaterial(new CANNON.ContactMaterial(ballMat, pinMat, { friction: 0.18, restitution: 0.35 }));
    world.addContactMaterial(new CANNON.ContactMaterial(pinMat, pinMat, { friction: 0.25, restitution: 0.3 }));

    // lane floor (top at y=0)
    const lane = new CANNON.Body({ mass: 0, material: laneMat,
      shape: new CANNON.Box(new CANNON.Vec3(LANE_HW, 0.1, (LANE_LEN + 2) / 2)) });
    lane.position.set(0, -0.1, -LANE_LEN / 2 + 0.5);
    world.addBody(lane);

    // gutters (lower floors) + outer walls so a wide ball drops in and rolls on
    for (const s of [-1, 1]) {
      const gut = new CANNON.Body({ mass: 0, material: laneMat,
        shape: new CANNON.Box(new CANNON.Vec3(GUTTER_W / 2, 0.1, (LANE_LEN + 2) / 2)) });
      gut.position.set(s * (LANE_HW + GUTTER_W / 2), -0.1 - GUTTER_DROP, -LANE_LEN / 2 + 0.5);
      world.addBody(gut);
      const wall = new CANNON.Body({ mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(0.05, 0.3, (LANE_LEN + 2) / 2)) });
      wall.position.set(s * (LANE_HW + GUTTER_W + 0.05), 0.1, -LANE_LEN / 2 + 0.5);
      world.addBody(wall);
    }
    // back wall behind the pins (stops everything in the pit)
    const back = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(3, 1, 0.1)) });
    back.position.set(0, 0.8, -LANE_LEN - 0.5);
    world.addBody(back);

    Scene._pinMat = pinMat;
    Scene._ballMat = ballMat;

    // ball
    ballBody = new CANNON.Body({ mass: 6.4, material: ballMat, shape: new CANNON.Sphere(BALL_R) });
    ballBody.linearDamping = 0.012;
    ballBody.angularDamping = 0.012;
    world.addBody(ballBody);
  }

  // ---------- pins ----------
  function makePinBody(x, z) {
    const b = new CANNON.Body({ mass: 1.5, material: Scene._pinMat,
      shape: new CANNON.Box(new CANNON.Vec3(PIN_HW, PIN_HH, PIN_HW)) });
    b.position.set(x, PIN_HH, z);
    b.allowSleep = true;
    b.sleepSpeedLimit = 0.12;
    b.sleepTimeLimit = 0.4;
    b.angularDamping = 0.2;
    b.linearDamping = 0.05;
    return b;
  }

  // (re)place a rack. `standing` = array of 10 booleans (true = pin present).
  // Pass null for a full fresh rack.
  function setRack(standing) {
    for (const p of pins) { scene.remove(p.mesh); world.removeBody(p.body); }
    pins = [];
    for (let i = 0; i < 10; i++) {
      if (standing && !standing[i]) continue;
      const [x, z] = PIN_SPOTS[i];
      const mesh = makePinMesh();
      mesh.position.set(x, PIN_HH, z);
      scene.add(mesh);
      const body = makePinBody(x, z);
      world.addBody(body);
      pins.push({ mesh, body, spot: [x, z], idx: i, down: false });
    }
  }

  // a pin is down if it tilted a lot or shifted off its spot
  function pinIsDown(p) {
    const up = new CANNON.Vec3(0, 1, 0);
    const local = new CANNON.Vec3(0, 1, 0);
    p.body.quaternion.vmult(local, up);
    const tilt = up.y;                         // 1 = perfectly upright
    const dx = p.body.position.x - p.spot[0];
    const dz = p.body.position.z - p.spot[1];
    const moved = Math.hypot(dx, dz);
    return tilt < 0.72 || moved > 0.08 || p.body.position.y < 0.06;
  }

  function placeBall(x) {
    inGutter = false;
    ballBody.velocity.set(0, 0, 0);
    ballBody.angularVelocity.set(0, 0, 0);
    ballBody.position.set(clamp(x, -LANE_HW + BALL_R, LANE_HW - BALL_R), BALL_R, 0.15);
    ballBody.quaternion.set(0, 0, 0, 1);
    ballBody.sleepState = 0;
    aimLine.visible = true;
    setAim(x, 0);
  }

  // draw the aim guide line from the ball toward target (curve preview = lateral bend)
  function setAim(x, curve) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const z = -6.2 * t;
      const bend = curve * 0.9 * t * t;        // quadratic preview of the hook
      pts.push(new THREE.Vector3(x + bend, 0.02, 0.1 + z));
    }
    aimLine.geometry.setFromPoints(pts);
  }

  // launch! opts: { power 0..1, curve -1..1, spin 0..1 }
  function roll(opts) {
    const power = clamp(opts.power, 0, 1);
    const curve = clamp(opts.curve, -1, 1);
    const spin = clamp(opts.spin, 0, 1);

    const speed = lerp(SHOT.speedMin, SHOT.speedMax, power);   // forward m/s
    ballBody.velocity.set(curve * SHOT.drift, 0, -speed);      // slight initial drift toward hook side
    // visual + physical roll: spin about Y (hook), roll about X (forward)
    ballBody.angularVelocity.set(speed / BALL_R, curve * spin * SHOT.spinViz, 0);

    hookDir = Math.sign(curve) || 0;
    hookMag = Math.abs(curve) * lerp(SHOT.hookMin, SHOT.hookMax, spin); // lateral accel, amplified by spin
    rolling = true;
    rollTime = 0;
    settleTimer = 0;
    aimLine.visible = false;
  }

  // ---------- per-frame update ----------
  function stepPhysics(dt) {
    if (rolling) {
      rollTime += dt;
      const b = ballBody;
      const onLane = b.position.y > -0.02 && Math.abs(b.position.x) < LANE_HW;
      // gutter check
      if (!inGutter && Math.abs(b.position.x) > LANE_HW + 0.01) inGutter = true;

      // hook: lateral accel that grows as the ball slows (classic back-end hook)
      if (onLane && !inGutter && hookMag > 0) {
        const fwd = -b.velocity.z;
        const slow = clamp(1 - fwd / 11, 0, 1);            // 0 fast -> 1 slow
        const accel = hookMag * ((1 - SHOT.backEnd) + SHOT.backEnd * slow);
        b.applyForce(new CANNON.Vec3(hookDir * accel * b.mass, 0, 0), b.position);
      }
    }

    world.step(FIXED, dt, 3);

    if (rolling) {
      const ballStopped = ballBody.velocity.lengthSquared() < 0.04;
      const ballPastPins = ballBody.position.z < Z_HEAD - 4 * DZ - 0.4;
      const ballGuttered = inGutter && ballBody.position.z < -6;
      let pinsCalm = true;
      for (const p of pins) {
        if (p.body.velocity.lengthSquared() > 0.05 || p.body.angularVelocity.lengthSquared() > 0.1) {
          pinsCalm = false; break;
        }
      }
      if ((ballStopped || ballPastPins || ballGuttered) && pinsCalm) settleTimer += dt;
      else settleTimer = Math.max(0, settleTimer - dt * 0.5);

      // hard timeout so a stuck ball never hangs the turn
      if (settleTimer > 0.7 || rollTime > 9) {
        rolling = false;
        finishRoll();
      }
    }
  }

  function finishRoll() {
    const down = [];
    for (const p of pins) {
      const isDown = pinIsDown(p);
      p.down = isDown;
      if (isDown) down.push(p.idx);
    }
    if (typeof onSettled === 'function') {
      onSettled({ down, gutter: inGutter, standing: pins.filter((p) => !p.down).map((p) => p.idx) });
    }
  }

  // sync three meshes from cannon bodies
  function syncMeshes() {
    ballMesh.position.copy(ballBody.position);
    ballMesh.quaternion.copy(ballBody.quaternion);
    for (const p of pins) {
      p.mesh.position.copy(p.body.position);
      p.mesh.quaternion.copy(p.body.quaternion);
    }
  }

  function updateCamera(dt) {
    // gently dolly toward the action while the ball travels, then ease back
    let tz = camHome.z, lookZ = camLookHome.z;
    if (rolling || ballBody.position.z < -0.5) {
      const t = clamp(-ballBody.position.z / LANE_LEN, 0, 1);
      tz = lerp(camHome.z, -3.0, t);
      lookZ = lerp(camLookHome.z, -LANE_LEN + 1.5, t);
    }
    camPos.x += (lerp(0, ballBody.position.x * 0.25, 0.5) - camPos.x) * Math.min(1, dt * 3);
    camPos.z += (tz - camPos.z) * Math.min(1, dt * 2.5);
    camLook.z += (lookZ - camLook.z) * Math.min(1, dt * 2.5);
    camera.position.set(camPos.x, camHome.y, camPos.z);
    camera.lookAt(camLook.x, camLook.y, camLook.z);
  }

  let last = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    const now = t / 1000;
    let dt = last ? now - last : FIXED;
    last = now;
    dt = Math.min(dt, 0.05);
    stepPhysics(dt);
    syncMeshes();
    updateCamera(dt);
    renderer.render(scene, camera);
  }

  // ---------- setup ----------
  function resize() {
    cssW = canvas.clientWidth || window.innerWidth;
    cssH = canvas.clientHeight || window.innerHeight;
    const lowW = Math.max(160, Math.round(cssW / PIXEL));
    const lowH = Math.max(120, Math.round(cssH / PIXEL));
    renderer.setPixelRatio(1);
    renderer.setSize(lowW, lowH, false);   // low-res buffer; CSS upscales (pixelated)
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
  }

  function init(canvasEl) {
    canvas = canvasEl;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141a30);
    scene.fog = new THREE.Fog(0x1b2342, 10, LANE_LEN + 6); // hazy far layer

    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
    camera.position.copy(camHome);
    camera.lookAt(camLookHome);

    // restrained lighting: soft fill + one warm key with gentle shadows
    scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x20283f, 0.85));
    const key = new THREE.DirectionalLight(0xfff0d6, 1.05);
    key.position.set(2.5, 6, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1; key.shadow.camera.far = 30;
    key.shadow.camera.left = -3; key.shadow.camera.right = 3;
    key.shadow.camera.top = 4; key.shadow.camera.bottom = -20;
    key.shadow.bias = -0.0006;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6f8cff, 0.4);
    rim.position.set(-3, 4, -8);
    scene.add(rim);

    buildLane();
    buildPhysics();

    // ball mesh — glossy two-tone with a swirl-ish accent
    const bg = new THREE.SphereGeometry(BALL_R, 24, 18);
    ballMesh = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({
      color: 0x1b9be0, roughness: 0.18, metalness: 0.25, emissive: 0x06202e, emissiveIntensity: 0.4,
    }));
    ballMesh.castShadow = true;
    scene.add(ballMesh);
    // finger holes hint (small dark dots)
    const hole = new THREE.MeshStandardMaterial({ color: 0x06151f, roughness: 0.6 });
    for (const off of [[-0.03, 0.07], [0.03, 0.07], [0, 0.045]]) {
      const h = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8), hole);
      h.position.set(off[0], off[1], BALL_R - 0.002);
      ballMesh.add(h);
    }

    setRack(null);
    placeBall(0);

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  }

  return {
    init, setRack, placeBall, setAim, roll,
    set onSettled(fn) { onSettled = fn; },
    get isRolling() { return rolling; },
    LANE_HW,
    _pinMat: null, _ballMat: null,
  };
})();
