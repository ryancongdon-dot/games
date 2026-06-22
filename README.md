# 🕹️ Arcade

A small collection of browser games that play well on **phone, tablet (iPad),
and desktop**. No build step and no install — just open the HTML.

## Games

### 🧸 Claw Craze — `games/claw-machine/`
A **real 3D** claw machine (WebGL) with neon-bloom glow, environment-lit
reflections, and a full arcade cabinet (marquee, control panel, coin door, glossy
floor). You line up a clumsy claw over a **physics-driven heap** of plushies and
try to snag one. Grabbing is **skill-based**: the better you center the claw
(watch the aim ring go green), the higher your odds — and rare prizes are
slippery. Plus a 20-second timer and the occasional fumble on the way to the chute.

**How to play**
- You start with **3 coins**; insert one to begin a turn.
- You have **20 seconds** to move the claw — `◀ ▶` left/right, `▲ ▼` for depth —
  then hit **DROP** (or let the timer auto-drop it).
- **Drag the cabinet** to look around and enjoy the 3D depth.
- Desktop: **arrow keys** to move, **Space** to drop.
- The claw physically shoves the heap, grabs, and carries the prize to the chute
  — but it only holds on ~40% of well-aimed grabs, and there's a **~5% chance it
  fumbles mid-carry**, for a real ~20-40% win rate.
- Win prizes to earn **points**, fill your **collection**, and unlock new
  **machine themes**. Progress saves automatically (localStorage).

**Tuning** — gameplay knobs live at the top of
[`games/claw-machine/game.js`](games/claw-machine/game.js): `AIM_TIME`,
`GRAB_MIN`/`GRAB_MAX`/`AIM_SHARPNESS` (the skill curve), `GRIP_BY_RARITY` (how
slippery rare prizes are), `CHAOS_DROP_CHANCE`, prize values/weights, and the
unlock thresholds in `THEMES`. Scene/physics/render knobs (cabinet size, grab
reach `GRASP`, heap size `PILE_TARGET`, and the `BLOOM` settings) live in
[`scene3d.js`](games/claw-machine/scene3d.js).

## Run it
Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

The 3D libraries are vendored locally (`games/claw-machine/vendor/`), so the game
still works offline and by double-clicking — no network or npm needed.

## Project layout
```
index.html                 # arcade hub (lists games)
games/
  claw-machine/
    index.html             # game shell (loads the scripts below)
    style.css              # responsive, mobile-first styling
    game.js                # state machine, scoring, UI, controls
    scene3d.js             # WebGL 3D scene + cannon.js physics (Three.js)
    audio.js               # generated chiptune music + SFX (Web Audio)
    vendor/                # three.min.js (r0.149 UMD) + cannon.min.js (vendored)
```

## Roadmap → "real app-store game"
Built so it can keep growing:

- **Graphics** — real 3D (Three.js) with a hand-written post pipeline: HDR scene
  buffer → bright-pass → separable Gaussian bloom → exposure tone-map composite,
  plus procedural PMREM environment lighting and a glossy reflective floor. The
  next jump is **modeled glTF plushies/props** — they drop into `makePlushMesh`
  (scene3d.js) without touching the state machine. (Fetching CC0 models needs a
  network the build env may block; supply `.glb` files in the repo to wire them in.)
- **Physics** — cannon.js drives the plush heap and claw collisions. Tune mass,
  friction, and `GRASP`/`GRAB_CHANCE` for feel.
- **Audio** — `audio.js` generates music + SFX procedurally. Replace with licensed
  tracks behind the same `GameAudio.play()` / `startMusic()` API.
- **Monetization** — the "Get Free Coins" button is a stub where a rewarded ad or
  coin-pack IAP would live.
- **Store packaging** — wrap the web build with **Capacitor** (recommended) or
  Cordova to ship the same codebase to the iOS App Store and Google Play.
- **Backend** — add leaderboards / cloud saves (currently localStorage).
