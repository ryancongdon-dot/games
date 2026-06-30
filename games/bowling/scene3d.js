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
  // Real bowling dimensions: lane is ~60ft (18.29m) foul-line to head pin, ~41.5" wide.
  const LANE_LEN = 21.0;      // foul line (z=0) to pit (z=-LANE_LEN)
  const LANE_HW = 0.527;      // lane half-width (41.5" lane)
  const GUTTER_W = 0.24;      // gutter channel width each side
  const GUTTER_DROP = 0.16;   // how far gutters sit below the lane
  const BALL_R = 0.109;       // ~8.6" diameter ball
  const PIN_HW = 0.06;        // pin physics box half width/depth
  const PIN_HH = 0.19;        // pin physics box half height
  const Z_HEAD = -18.29;      // head-pin z (60ft from the foul line)
  const DX = 0.1524;          // half the 12" pin spacing
  const DZ = 0.264;           // row depth spacing
  // Small fixed step prevents the fast ball from tunnelling THROUGH the thin pins
  // (at 1/60 a 22mph ball moves further than a ball+pin radius per step).
  const FIXED = 1 / 120;
  const MAX_SUBSTEPS = 8;

  // ---------- SHOT FEEL (tune these after playing a few frames) ----------
  // Bowling "feel" always needs playtest iteration — these are the main dials.
  // The shot. POWER -> realistic forward speed. CURVE/SPIN shape a KINEMATIC arc:
  // the ball steers along a designed lateral path (a big U) while its forward
  // motion stays physical, so the on-lane path is 100% predictable and the drawn
  // preview line matches it exactly. Steering hands off to pure physics just
  // before the pins so the strike is a real collision.
  const SHOT = {
    speedMin: 4.3, speedMax: 9.8,    // forward m/s (~10–22 mph) from POWER 0..1
    bulge: 0.62,                     // max lateral arc (m) per unit CURVE at full SPIN
    spinBase: 0.30,                  // arc present at SPIN 0 (fraction of bulge)
    humpSkew: 1.18,                  // >1 pushes the arc's apex slightly down-lane
    fwdDecay: 0.04,                  // mild forward slow-down per second
    steerStopZ: 0.7,                 // stop steering this far before the head pin
    spinViz: 9,                      // visual ball spin (rad/s) from curve+spin
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
  let shot = { aimX: 0, power: 0.7, curve: 0, spin: 0.4 };
  let curSpeed = 0;                 // current forward speed during the roll
  let steering = false;            // kinematic lateral control active?
  let hookScale = 1;               // equipped ball's hook multiplier (Pro Shop)
  let rollTime = 0;
  let inGutter = false;
  let settleTimer = 0;
  let onSettled = null;
  let onImpact = null;              // fired when the ball first strikes a pin
  let lastImpactMs = 0;

  // camera rig — raised & tilted down so the ball sits in the UPPER-MIDDLE of
  // the frame (clear of the bottom control panel) with the pins near the top.
  const camHome = new THREE.Vector3(0, 2.6, 4.6);
  const camLookHome = new THREE.Vector3(0, -0.7, -2.6);
  const CAM = { trail: 4.5, lookAhead: 4.2, ease: 3.0 };  // chase-cam feel while rolling
  const camPos = camHome.clone();
  const camLook = camLookHome.clone();
  let aimTarget;              // marker disc at the predicted entry point

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
    world.solver.iterations = 18;
    world.defaultContactMaterial.friction = 0.25;

    const laneMat = new CANNON.Material('lane');
    const ballMat = new CANNON.Material('ball');
    const pinMat = new CANNON.Material('pin');
    // low lane↔ball friction keeps forward speed ~steady; low pin friction +
    // springy ball↔pin / pin↔pin restitution makes struck pins fly & chain.
    world.addContactMaterial(new CANNON.ContactMaterial(laneMat, ballMat, { friction: 0.04, restitution: 0.02 }));
    world.addContactMaterial(new CANNON.ContactMaterial(laneMat, pinMat, { friction: 0.18, restitution: 0.08 }));
    world.addContactMaterial(new CANNON.ContactMaterial(ballMat, pinMat, { friction: 0.16, restitution: 0.5 }));
    world.addContactMaterial(new CANNON.ContactMaterial(pinMat, pinMat, { friction: 0.2, restitution: 0.45 }));

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
    ballBody = new CANNON.Body({ mass: 7.0, material: ballMat, shape: new CANNON.Sphere(BALL_R) });
    ballBody.linearDamping = 0.0;     // forward speed handled by the SHOT model, not damping
    ballBody.angularDamping = 0.02;
    world.addBody(ballBody);

    // fire an impact callback the first time the ball strikes a pin (for SFX)
    ballBody.addEventListener('collide', (e) => {
      const other = e.body;
      if (!other || !other.__isPin) return;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now - lastImpactMs < 120) return;
      lastImpactMs = now;
      if (typeof onImpact === 'function') onImpact();
    });
  }

  // ---------- pins ----------
  function makePinBody(x, z) {
    const b = new CANNON.Body({ mass: 1.5, material: Scene._pinMat,
      shape: new CANNON.Box(new CANNON.Vec3(PIN_HW, PIN_HH, PIN_HW)) });
    b.__isPin = true;
    b.position.set(x, PIN_HH, z);
    b.allowSleep = true;
    b.sleepSpeedLimit = 0.14;
    b.sleepTimeLimit = 0.4;
    b.angularDamping = 0.04;   // let knocked pins tumble & fly
    b.linearDamping = 0.0;
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
    if (typeof ballBody.wakeUp === 'function') ballBody.wakeUp();
    aimLine.visible = true;
    if (aimTarget) aimTarget.visible = true;
  }

  // ---- the kinematic curve ----
  // progress p: 0 at the foul line, 1 at the head pin.
  function progressFromZ(z) { return clamp((0.15 - z) / (0.15 - Z_HEAD), 0, 1); }

  // designed lateral position at progress p — a big U that ends near the middle,
  // straight when curve=0. (Forward speed is separate & physical.)
  function curveTargetX(p, aimX, curve, spin) {
    const mag = Math.abs(curve), dir = Math.sign(curve);
    const endX = aimX * (1 - mag);                       // more curve -> ends nearer middle
    const bulge = mag * SHOT.bulge * hookScale * (SHOT.spinBase + (1 - SHOT.spinBase) * spin);
    const hump = Math.sin(Math.PI * Math.pow(clamp(p, 0, 1), SHOT.humpSkew));
    return lerp(aimX, endX, p) + dir * bulge * hump;
  }

  const GUTTER_LINE = LANE_HW - BALL_R * 0.4;

  // The path is purely geometric in z, so the drawn preview is exactly the lane
  // path the ball will steer along (independent of speed).
  function pathPoints(aimX, curve, spin) {
    const pts = [];
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const z = lerp(0.15, Z_HEAD, i / N);
      const x = curveTargetX(progressFromZ(z), aimX, curve, spin);
      pts.push(new THREE.Vector3(clamp(x, -LANE_HW, LANE_HW), 0.025, z));
      if (Math.abs(x) > GUTTER_LINE) break;              // leaves the lane -> gutter
    }
    return pts;
  }

  // position the ball at the start spot and draw the predicted trajectory
  function previewShot({ aimX, curve, spin }) {
    const x = clamp(aimX, -LANE_HW + BALL_R, LANE_HW - BALL_R);
    ballBody.velocity.set(0, 0, 0);
    ballBody.angularVelocity.set(0, 0, 0);
    ballBody.position.set(x, BALL_R, 0.15);
    const pts = pathPoints(x, curve, spin);
    aimLine.geometry.setFromPoints(pts);
    aimLine.visible = true;
    if (aimTarget) {
      const end = pts[pts.length - 1];
      aimTarget.position.set(end.x, 0.02, end.z);
      aimTarget.visible = true;
    }
  }

  // equip a ball (from the Pro Shop): weight(lb) -> mass (pin carry),
  // hook -> curve multiplier, color -> ball appearance.
  function setBall(opts) {
    opts = opts || {};
    const lb = clamp(opts.weight != null ? opts.weight : 12, 6, 16);
    ballBody.mass = lb * 0.4536;                 // lb -> kg
    if (ballBody.type === CANNON.Body.DYNAMIC) ballBody.updateMassProperties();
    hookScale = (opts.hook != null) ? opts.hook : 1;
    if (opts.color != null && ballMesh) ballMesh.material.color.setHex(opts.color);
  }

  // launch! opts: { power 0..1, curve -1..1, spin 0..1 }
  function roll(opts) {
    const power = clamp(opts.power, 0, 1);
    const curve = clamp(opts.curve, -1, 1);
    const spin = clamp(opts.spin, 0, 1);
    const aimX = ballBody.position.x;
    shot = { aimX, power, curve, spin };

    const speed = lerp(SHOT.speedMin, SHOT.speedMax, power);
    curSpeed = speed;
    // initial lateral velocity = the path tangent at the foul line
    const laneTravel = 0.15 - Z_HEAD;
    const dpdt = speed / laneTravel;
    const dxdp = (curveTargetX(0.004, aimX, curve, spin) - curveTargetX(0, aimX, curve, spin)) / 0.004;

    // glue the ball to the lane during the approach (KINEMATIC = no gravity, so
    // it can't bounce on release); it switches back to DYNAMIC just before the
    // pins so the strike is a real, mass-driven collision.
    ballBody.type = CANNON.Body.KINEMATIC;
    ballBody.updateMassProperties();
    ballBody.position.y = BALL_R;
    ballBody.velocity.set(dxdp * dpdt, 0, -speed);
    ballBody.angularVelocity.set(speed / BALL_R, -Math.sign(curve) * spin * SHOT.spinViz, 0);
    if (ballBody.wakeUp) ballBody.wakeUp();

    // wake every pin so the whole rack reacts (no sleeping pins shrugging off hits)
    for (const p of pins) { if (p.body.wakeUp) p.body.wakeUp(); p.body.sleepState = 0; }

    steering = true;
    rolling = true;
    rollTime = 0;
    settleTimer = 0;
    inGutter = false;
    aimLine.visible = false;
    if (aimTarget) aimTarget.visible = false;
  }

  // ---------- per-frame update ----------
  function stepPhysics(dt) {
    if (rolling) {
      rollTime += dt;
      const b = ballBody;
      curSpeed *= (1 - SHOT.fwdDecay * dt);

      if (!inGutter && Math.abs(b.position.x) > LANE_HW + 0.01) inGutter = true;

      // kinematic lateral steering along the designed arc, until just before the
      // pins — then hand off to pure physics so the strike is a real collision.
      const steerActive = steering && b.position.z > (Z_HEAD + SHOT.steerStopZ) && !inGutter;
      if (steerActive) {
        const tx = curveTargetX(progressFromZ(b.position.z), shot.aimX, shot.curve, shot.spin);
        if (Math.abs(tx) > GUTTER_LINE) {
          steering = false;                          // arc runs off the lane -> gutter
        } else {
          b.velocity.x = (tx - b.position.x) / dt;   // steer sideways toward the path
          b.velocity.z = -curSpeed;                  // hold the forward speed
          b.position.y = BALL_R; b.velocity.y = 0;   // glued to the lane while steering
        }
      } else {
        steering = false;
      }

      // once steering ends, hand back to a dynamic body so the strike is a real,
      // mass-driven collision (heavier ball = more pin carry).
      if (!steerActive && b.type === CANNON.Body.KINEMATIC) {
        b.type = CANNON.Body.DYNAMIC;
        b.updateMassProperties();
        if (b.wakeUp) b.wakeUp();
      }
    }

    world.step(FIXED, dt, MAX_SUBSTEPS);

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
      if (settleTimer > 0.7 || rollTime > 11) {
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
    // Chase cam: while the ball travels, trail behind it and look ahead toward
    // the pins; otherwise sit at the framing "home" pose. Always keeps the ball
    // high in frame and shows the pin impact.
    let posX, posZ, lookX, lookZ;
    const active = rolling || ballBody.position.z < -0.4;
    if (active) {
      posX = ballBody.position.x * 0.4;
      posZ = ballBody.position.z + CAM.trail;
      lookX = ballBody.position.x * 0.5;
      lookZ = ballBody.position.z - CAM.lookAhead;
    } else {
      posX = ballBody.position.x * 0.3;
      posZ = camHome.z;
      lookX = ballBody.position.x * 0.3;
      lookZ = camLookHome.z;
    }
    posZ = Math.max(posZ, -LANE_LEN + 2.2);          // don't dive into the pit
    lookZ = Math.max(lookZ, -LANE_LEN - 1.0);
    const k = Math.min(1, dt * CAM.ease);
    camPos.x += (posX - camPos.x) * k;
    camPos.z += (posZ - camPos.z) * k;
    camLook.x += (lookX - camLook.x) * k;
    camLook.z += (lookZ - camLook.z) * k;
    camera.position.set(camPos.x, camHome.y, camPos.z);
    camera.lookAt(camLook.x, camLookHome.y, camLook.z);
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

    // predicted-entry marker (a small bright ring on the pin deck)
    aimTarget = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.10, 18),
      new THREE.MeshBasicMaterial({ color: 0x8fe1ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    aimTarget.rotation.x = -Math.PI / 2;
    aimTarget.position.set(0, 0.02, Z_HEAD);
    scene.add(aimTarget);

    setRack(null);
    placeBall(0);

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  }

  return {
    init, setRack, placeBall, previewShot, roll, setBall,
    set onSettled(fn) { onSettled = fn; },
    set onImpact(fn) { onImpact = fn; },
    get isRolling() { return rolling; },
    LANE_HW,
    _pinMat: null, _ballMat: null,
  };
})();
