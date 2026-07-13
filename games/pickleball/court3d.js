// court3d.js — WebGL 3D pickleball court, players, ball, lighting + bloom post.
// Exposes a global `Court` object the game state machine drives.
// Requires THREE (vendor/three.min.js) loaded first.
//
// Coordinate system (meters, real pickleball scaled 1ft = 0.3048m):
//   X = court width  (-HALF_W .. +HALF_W), left/right from the near player's view
//   Z = court length (net at z=0). NEAR team plays +Z, FAR team plays -Z.
//   Y = up.
const Court = (() => {
  'use strict';

  const FT = 0.3048;

  // ---- court dimensions ----
  const HALF_W = 10 * FT;       // 10 ft each side  -> 20 ft wide
  const HALF_L = 22 * FT;       // 22 ft each side  -> 44 ft long
  const KITCHEN = 7 * FT;       // non-volley zone depth from net
  const NET_H_SIDE = 0.914;     // 36" at posts
  const NET_H_MID = 0.864;      // 34" at center
  const LINE = 0.05;            // line half-width-ish (~2")
  const POST_X = HALF_W + 0.30; // net posts sit just outside sidelines

  const DIMS = { FT, HALF_W, HALF_L, KITCHEN, NET_H_SIDE, NET_H_MID, POST_X, LINE };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---- module state ----
  let renderer, scene, camera, canvas;
  let sun, hemi;
  let netMesh, netTape;
  const players = [];   // { group, team, mesh, paddle, ring, shadow }
  let ball = null;      // { group, mesh, trail }
  let ballTrail = null;
  const clock = { t: 0 };

  // broadcast camera (behind near baseline, elevated)
  const cam = {
    pos: new THREE.Vector3(0, 7.0, HALF_L + 7.4),
    look: new THREE.Vector3(0, 0.5, -1.2),
    fov: 40,
    shake: 0,
  };

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------
  const M = {};
  function buildMaterials() {
    M.courtBlue = new THREE.MeshStandardMaterial({ color: 0x2a6db0, roughness: 0.75, metalness: 0.02 });
    M.kitchen   = new THREE.MeshStandardMaterial({ color: 0xb44a3a, roughness: 0.8, metalness: 0.02 });
    M.surround  = new THREE.MeshStandardMaterial({ color: 0x1f6f4a, roughness: 0.95 });
    M.line      = new THREE.MeshStandardMaterial({ color: 0xf3f6ff, roughness: 0.6, emissive: 0x222833, emissiveIntensity: 0.15 });
    M.post      = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.4, metalness: 0.6 });
    M.tape      = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0x556, emissiveIntensity: 0.2 });
    M.fence     = new THREE.MeshStandardMaterial({ color: 0x9fb0bf, roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
    M.fencePost = new THREE.MeshStandardMaterial({ color: 0x545b66, roughness: 0.5, metalness: 0.5 });
    M.trunk     = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
    M.leaf      = new THREE.MeshStandardMaterial({ color: 0x2f8f4e, roughness: 0.85 });
    M.leaf2     = new THREE.MeshStandardMaterial({ color: 0x3aa85e, roughness: 0.85 });
    M.bleacher  = new THREE.MeshStandardMaterial({ color: 0x3b4658, roughness: 0.7, metalness: 0.2 });
    M.ball      = new THREE.MeshStandardMaterial({ color: 0xe8e24a, roughness: 0.5, emissive: 0x3a3a12, emissiveIntensity: 0.15 });
  }

  // ---------------------------------------------------------------------------
  // Court surface + lines
  // ---------------------------------------------------------------------------
  function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }

  function addLine(x, z, w, d) {
    const m = box(w, 0.02, d, M.line);
    m.position.set(x, 0.012, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  function buildCourt() {
    // green surround (large ground)
    const ground = box(60, 0.1, 60, M.surround);
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);

    // playing surface (blue), slightly proud of ground
    const surf = box(HALF_W * 2 + 1.4, 0.06, HALF_L * 2 + 1.4, M.courtBlue);
    surf.position.y = -0.005;
    surf.receiveShadow = true;
    scene.add(surf);

    // kitchen zones (both sides of net) in contrasting color
    for (const s of [1, -1]) {
      const k = box(HALF_W * 2, 0.062, KITCHEN, M.kitchen);
      k.position.set(0, -0.002, s * (KITCHEN / 2));
      k.receiveShadow = true;
      scene.add(k);
    }

    // boundary lines
    addLine(0, HALF_L, HALF_W * 2 + LINE * 2, LINE);     // near baseline
    addLine(0, -HALF_L, HALF_W * 2 + LINE * 2, LINE);    // far baseline
    addLine(HALF_W, 0, LINE, HALF_L * 2);                // right sideline
    addLine(-HALF_W, 0, LINE, HALF_L * 2);               // left sideline
    // kitchen lines (7 ft from net each side)
    addLine(0, KITCHEN, HALF_W * 2, LINE);
    addLine(0, -KITCHEN, HALF_W * 2, LINE);
    // centerline — only in the service area (baseline to kitchen), not through kitchen
    const midLen = (HALF_L - KITCHEN);
    addLine(0, (HALF_L + KITCHEN) / 2, LINE, midLen);
    addLine(0, -(HALF_L + KITCHEN) / 2, LINE, midLen);
  }

  // ---------------------------------------------------------------------------
  // Net
  // ---------------------------------------------------------------------------
  function buildNet() {
    const g = new THREE.Group();
    // posts
    for (const s of [1, -1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, NET_H_SIDE + 0.08, 12), M.post);
      post.position.set(s * POST_X, (NET_H_SIDE + 0.08) / 2, 0);
      post.castShadow = true;
      g.add(post);
    }
    // net mesh — a slightly sagging sheet approximated by a subdivided plane
    const segX = 40, segY = 8;
    const width = POST_X * 2;
    const geo = new THREE.PlaneGeometry(width, NET_H_SIDE, segX, segY);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const yN = (pos.getY(i) + NET_H_SIDE / 2) / NET_H_SIDE; // 0 bottom .. 1 top
      // sag: center dips to NET_H_MID
      const sag = (NET_H_SIDE - NET_H_MID) * (1 - Math.pow(Math.abs(x) / POST_X, 2));
      const h = lerp(0, NET_H_SIDE - sag, yN);
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    const netTex = makeNetTexture();
    const netMat = new THREE.MeshStandardMaterial({
      map: netTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide,
      color: 0x11151c, roughness: 0.8,
    });
    netMesh = new THREE.Mesh(geo, netMat);
    netMesh.position.y = 0;
    netMesh.castShadow = false;
    g.add(netMesh);

    // white tape along the top (follows the sag)
    const tapeGeo = new THREE.PlaneGeometry(width, 0.04, segX, 1);
    const tp = tapeGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i);
      const sag = (NET_H_SIDE - NET_H_MID) * (1 - Math.pow(Math.abs(x) / POST_X, 2));
      tp.setY(i, tp.getY(i) + (NET_H_SIDE - sag));
    }
    tapeGeo.computeVertexNormals();
    netTape = new THREE.Mesh(tapeGeo, M.tape);
    netTape.side = THREE.DoubleSide;
    g.add(netTape);

    scene.add(g);
  }

  function makeNetTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 64, 64);
    x.strokeStyle = 'rgba(240,245,255,0.9)';
    x.lineWidth = 3;
    for (let i = 0; i <= 64; i += 8) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 64); x.stroke();
      x.beginPath(); x.moveTo(0, i); x.lineTo(64, i); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(48, 6);
    return t;
  }

  // ---------------------------------------------------------------------------
  // Surroundings: fence, trees, bleachers, sky
  // ---------------------------------------------------------------------------
  function buildSurroundings() {
    // perimeter fence (translucent chain-link suggestion + posts)
    const fenceW = HALF_W * 2 + 6, fenceL = HALF_L * 2 + 6, fenceH = 3.0;
    const mkFence = (w, d, x, z) => {
      const panel = box(w, fenceH, d, M.fence);
      panel.position.set(x, fenceH / 2, z);
      scene.add(panel);
    };
    mkFence(fenceW, 0.05, 0, -fenceL / 2);
    mkFence(fenceW, 0.05, 0, fenceL / 2);
    mkFence(0.05, fenceL, -fenceW / 2, 0);
    mkFence(0.05, fenceL, fenceW / 2, 0);
    // fence posts
    for (let i = -3; i <= 3; i++) {
      for (const z of [-fenceL / 2, fenceL / 2]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, fenceH, 8), M.fencePost);
        p.position.set(i * (fenceW / 6), fenceH / 2, z);
        p.castShadow = true; scene.add(p);
      }
    }

    // low-poly trees behind the far baseline
    const treeAt = (x, z, s) => {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.6 * s, 8), M.trunk);
      trunk.position.y = 0.8 * s; trunk.castShadow = true; g.add(trunk);
      for (let i = 0; i < 3; i++) {
        const r = (0.9 - i * 0.18) * s;
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), i % 2 ? M.leaf2 : M.leaf);
        blob.position.y = (1.6 + i * 0.6) * s;
        blob.rotation.y = i * 1.1;
        blob.castShadow = true; g.add(blob);
      }
      g.position.set(x, 0, z);
      scene.add(g);
    };
    for (let i = 0; i < 6; i++) {
      treeAt(-fenceW / 2 - 2 - Math.random() * 3, -fenceL / 2 + i * (fenceL / 5), 0.9 + Math.random() * 0.5);
      treeAt(fenceW / 2 + 2 + Math.random() * 3, -fenceL / 2 + i * (fenceL / 5) + 1, 0.9 + Math.random() * 0.5);
    }

    // small bleachers on the right side
    const stand = new THREE.Group();
    for (let r = 0; r < 4; r++) {
      const bench = box(HALF_L * 1.4, 0.12, 0.55, M.bleacher);
      bench.position.set(0, 0.35 + r * 0.42, r * 0.55);
      bench.castShadow = true; bench.receiveShadow = true;
      stand.add(bench);
      const riser = box(HALF_L * 1.4, r * 0.42 + 0.3, 0.5, M.bleacher);
      riser.position.set(0, (r * 0.42 + 0.3) / 2, r * 0.55 - 0.02);
      stand.add(riser);
    }
    stand.position.set(HALF_W + 3.4, 0, -1.0);
    stand.rotation.y = -Math.PI / 2;
    scene.add(stand);

    buildSky();
  }

  function buildSky() {
    // gradient sky dome
    const skyGeo = new THREE.SphereGeometry(120, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x2f6fd0) },
        bottom: { value: new THREE.Color(0xcfe4ff) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform vec3 top; uniform vec3 bottom;
        void main(){
          float h = clamp((normalize(vP).y + 0.1) / 0.9, 0.0, 1.0);
          gl_FragColor = vec4(mix(bottom, top, h), 1.0);
        }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);
  }

  // ---------------------------------------------------------------------------
  // Lighting + environment
  // ---------------------------------------------------------------------------
  function buildLights() {
    hemi = new THREE.HemisphereLight(0xbfe0ff, 0x30604a, 0.75);
    scene.add(hemi);

    sun = new THREE.DirectionalLight(0xfff2d8, 2.1);
    sun.position.set(-9, 14, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 12;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 45;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 3;
    scene.add(sun);
    scene.add(sun.target);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.3);
    fill.position.set(8, 6, -6);
    scene.add(fill);
  }

  function initEnvironment() {
    // cheap procedural sky env for PBR reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x9fc4f0);
    const rt = pmrem.fromScene(envScene, 0.0);
    scene.environment = rt.texture;
    pmrem.dispose();
  }

  // ===========================================================================
  // Post-processing: HDR scene buffer -> bloom -> exposure tone-map composite
  // (adapted from the arcade's claw-machine pipeline)
  // ===========================================================================
  let sceneRT, bloomA, bloomB, postType;
  let fsScene, fsCam, fsQuad, brightMat, blurMat, compositeMat;
  const BLOOM = { threshold: 0.82, knee: 0.25, strength: 0.45, iterations: 3 };
  const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }`;

  function initPost() {
    postType = (renderer.capabilities.isWebGL2 ||
      renderer.extensions.has('EXT_color_buffer_half_float')) ? THREE.HalfFloatType : THREE.UnsignedByteType;
    fsScene = new THREE.Scene();
    fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    fsQuad.frustumCulled = false; fsScene.add(fsQuad);

    brightMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, threshold: { value: BLOOM.threshold }, knee: { value: BLOOM.knee } },
      vertexShader: FS_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float threshold; uniform float knee; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.2126,0.7152,0.0722));
          float k = smoothstep(threshold, threshold+knee, l);
          gl_FragColor = vec4(c*k, 1.0); }`,
    });
    blurMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, direction: { value: new THREE.Vector2(1, 0) }, texel: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 direction; uniform vec2 texel; varying vec2 vUv;
        void main(){ vec2 o1 = texel*direction*1.3846153846; vec2 o2 = texel*direction*3.2307692308;
          vec3 col = texture2D(tDiffuse, vUv).rgb*0.2270270270;
          col += texture2D(tDiffuse, vUv+o1).rgb*0.3162162162;
          col += texture2D(tDiffuse, vUv-o1).rgb*0.3162162162;
          col += texture2D(tDiffuse, vUv+o2).rgb*0.0702702703;
          col += texture2D(tDiffuse, vUv-o2).rgb*0.0702702703;
          gl_FragColor = vec4(col,1.0); }`,
    });
    compositeMat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tBloom: { value: null }, strength: { value: BLOOM.strength }, exposure: { value: 1.05 } },
      vertexShader: FS_VERT,
      fragmentShader: `
        uniform sampler2D tScene; uniform sampler2D tBloom; uniform float strength; uniform float exposure; varying vec2 vUv;
        void main(){ vec3 col = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb*strength;
          col = vec3(1.0) - exp(-col*exposure);
          gl_FragColor = vec4(col, 1.0); }`,
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

  function pass(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target || null); renderer.render(fsScene, fsCam); }

  function renderPost() {
    if (!sceneRT) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(sceneRT); renderer.clear(); renderer.render(scene, camera);
    brightMat.uniforms.tDiffuse.value = sceneRT.texture; pass(brightMat, bloomA);
    const texel = new THREE.Vector2(1 / bloomA.width, 1 / bloomA.height);
    for (let i = 0; i < BLOOM.iterations; i++) {
      blurMat.uniforms.tDiffuse.value = bloomA.texture; blurMat.uniforms.texel.value = texel;
      blurMat.uniforms.direction.value.set(1, 0); pass(blurMat, bloomB);
      blurMat.uniforms.tDiffuse.value = bloomB.texture; blurMat.uniforms.direction.value.set(0, 1); pass(blurMat, bloomA);
    }
    compositeMat.uniforms.tScene.value = sceneRT.texture; compositeMat.uniforms.tBloom.value = bloomA.texture;
    pass(compositeMat, null);
  }

  // ---------------------------------------------------------------------------
  // Ball (with motion trail)
  // ---------------------------------------------------------------------------
  const BALL_R = 0.055;
  const TRAIL_N = 16;
  let trailPos, trailGeo, trailLine;

  function buildBall() {
    const g = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 16), M.ball);
    g.castShadow = true;
    g.position.set(0, BALL_R, HALF_L * 0.6);
    scene.add(g);

    // contact shadow blob (readability against the surface)
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_R * 1.6, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.015;
    scene.add(blob);

    // trail
    trailPos = new Float32Array(TRAIL_N * 3);
    trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
      color: 0xfff2a8, transparent: true, opacity: 0.5 }));
    trailLine.frustumCulled = false;
    scene.add(trailLine);

    ball = { mesh: g, blob, hist: [] };
    for (let i = 0; i < TRAIL_N; i++) ball.hist.push(new THREE.Vector3(0, BALL_R, HALF_L * 0.6));
  }

  function setBall(x, y, z) {
    if (!ball) return;
    ball.mesh.position.set(x, y, z);
    ball.blob.position.set(x, 0.015, z);
    const sc = clamp(1 - y * 0.16, 0.4, 1);      // shadow shrinks as ball rises
    ball.blob.scale.setScalar(sc);
    ball.blob.material.opacity = 0.3 * sc;
    // push history
    ball.hist.pop();
    ball.hist.unshift(new THREE.Vector3(x, y, z));
    for (let i = 0; i < TRAIL_N; i++) {
      trailPos[i * 3] = ball.hist[i].x;
      trailPos[i * 3 + 1] = ball.hist[i].y;
      trailPos[i * 3 + 2] = ball.hist[i].z;
    }
    trailGeo.attributes.position.needsUpdate = true;
  }

  function ballVisible(v) { if (ball) { ball.mesh.visible = v; ball.blob.visible = v; trailLine.visible = v; } }

  // ---------------------------------------------------------------------------
  // Players (stylized low-poly figures with paddles)
  // ---------------------------------------------------------------------------
  const TEAM_COL = {
    0: [0x2f6fd0, 0x1f4e94],   // near team — blues
    1: [0xe0552f, 0xb23a20],   // far team — reds
  };
  const PARTNER_TINT = 0x38b6ff;

  function makePlayer(team, idx) {
    const g = new THREE.Group();
    const [jersey, short] = TEAM_COL[team];
    const skin = 0xe8b48a;
    const jerseyMat = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.7 });
    const shortMat = new THREE.MeshStandardMaterial({ color: short, roughness: 0.75 });
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });

    // Chibi / toy-diorama proportions (Link's Awakening vibe): big rounded head,
    // short stubby body, smooth glossy forms.
    jerseyMat.roughness = 0.55; shortMat.roughness = 0.6; skinMat.roughness = 0.6;
    // torso
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.2, 6, 14), jerseyMat);
    torso.position.y = 0.72; torso.castShadow = true; g.add(torso);
    // hips/shorts
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.1, 5, 14), shortMat);
    hips.position.y = 0.52; hips.castShadow = true; g.add(hips);
    // legs (short + stubby)
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.26, 4, 8), skinMat);
      leg.position.set(s * 0.1, 0.24, 0); leg.castShadow = true; g.add(leg);
      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf4f6fb, roughness: 0.5 }));
      shoe.scale.set(1, 0.7, 1.3); shoe.position.set(s * 0.1, 0.08, 0.03); shoe.castShadow = true; g.add(shoe);
    }
    // big head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 18), skinMat);
    head.position.y = 1.06; head.castShadow = true; g.add(head);
    // cap crown + brim
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.205, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), jerseyMat);
    cap.position.y = 1.09; cap.castShadow = true; g.add(cap);
    const brim = new THREE.Mesh(new THREE.CircleGeometry(0.19, 18, 0, Math.PI), jerseyMat);
    brim.rotation.x = -Math.PI / 2; brim.position.set(0, 1.05, 0.16); g.add(brim);
    // simple face dots (eyes) so they read facing forward
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), eyeMat);
      eye.position.set(s * 0.07, 1.05, 0.185); g.add(eye);
    }

    // arm + paddle (right side), pivots so we can animate a swing
    const armPivot = new THREE.Group();
    armPivot.position.set(0.2, 0.82, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 4, 8), skinMat);
    arm.position.set(0.0, -0.12, 0.08); arm.rotation.x = 0.6; arm.castShadow = true; armPivot.add(arm);
    const paddle = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 20),
      new THREE.MeshStandardMaterial({ color: team ? 0x222833 : 0x14324f, roughness: 0.5, metalness: 0.2 }));
    face.rotation.z = Math.PI / 2; face.castShadow = true; paddle.add(face);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 }));
    handle.position.set(0, -0.16, 0); paddle.add(handle);
    paddle.position.set(0.02, -0.28, 0.16);
    paddle.rotation.x = 0.5;
    armPivot.add(paddle);
    g.add(armPivot);

    // control highlight ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.visible = false; g.add(ring);

    // contact shadow blob
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.014; g.add(blob);

    if (team === 0 && idx === 1) { jerseyMat.color.setHex(PARTNER_TINT); }

    scene.add(g);
    const P = { group: g, team, idx, ring, armPivot, swingT: 0, facing: team === 0 ? Math.PI : 0 };
    players.push(P);
    return players.length - 1;
  }

  function setPlayer(i, x, z, facing) {
    const P = players[i]; if (!P) return;
    P.group.position.set(x, 0, z);
    if (facing != null) { P.facing = facing; }
    P.group.rotation.y = P.facing;
  }
  function setControlled(i, on) { const P = players[i]; if (P) P.ring.visible = on; }
  function triggerSwing(i) { const P = players[i]; if (P) P.swingT = 1; }
  function playerCount() { return players.length; }

  function updatePlayers(dt) {
    for (const P of players) {
      // swing animation: sweep the arm/paddle forward then ease back
      if (P.swingT > 0) {
        P.swingT = Math.max(0, P.swingT - dt * 4.5);
        const s = P.swingT;
        P.armPivot.rotation.y = -Math.sin((1 - s) * Math.PI) * 1.9;
        P.armPivot.rotation.x = -Math.sin((1 - s) * Math.PI) * 0.5;
      }
      // pulse the control ring
      if (P.ring.visible) {
        P.ring.material.opacity = 0.55 + 0.35 * Math.sin(clock.t * 6);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------
  function updateCamera(dt) {
    camera.fov = cam.fov;
    camera.position.copy(cam.pos);
    if (cam.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * cam.shake;
      camera.position.y += (Math.random() - 0.5) * cam.shake;
      cam.shake = Math.max(0, cam.shake - dt * 0.6);
    }
    camera.lookAt(cam.look);
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function init(canvasEl) {
    canvas = canvasEl;
    if (THREE.ColorManagement) THREE.ColorManagement.enabled = false;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NoToneMapping;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fc4f0);
    scene.fog = new THREE.Fog(0xbfd8f4, 40, 90);

    camera = new THREE.PerspectiveCamera(cam.fov, 1, 0.1, 300);

    buildMaterials();
    buildLights();
    buildCourt();
    buildNet();
    buildSurroundings();
    buildBall();
    initEnvironment();
    initPost();

    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const px = renderer.getPixelRatio();
    resizePost(Math.floor(w * px), Math.floor(h * px));
  }

  function update(dt) {
    clock.t += dt;
    updatePlayers(dt);
    updateCamera(dt);
    renderPost();
  }

  function shake(amt) { cam.shake = Math.max(cam.shake, amt); }

  return {
    init, resize, update, shake,
    DIMS, BALL_R,
    setBall, ballVisible,
    makePlayer, setPlayer, setControlled, triggerSwing, playerCount,
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
  };
})();

if (typeof window !== 'undefined') window.Court = Court;
