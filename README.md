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
still works offline and by double-clicking — no network or npm needed. (One
exception: real `.glb` prize models load over the network, so they only appear
when the game is **served over http(s)** — e.g. GitHub Pages or the command
above — not when opening the file directly. Without them the game falls back to
the built-in shapes.)

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
    models/                # optional .glb prize models (e.g. fox.glb)
    vendor/                # three.min.js + GLTFLoader.js + cannon.min.js
```

## Adding your own 3D prize models
The game can use real modeled prizes (glTF/`.glb`) instead of the built-in
shapes — each model is **auto-centered and auto-scaled** to plush size, so any
reasonably-shaped `.glb` just works:

1. Put the file in `games/claw-machine/models/`, e.g. `models/puppy.glb`.
2. Add (or edit) a prize in `PLUSH_TYPES` at the top of `game.js` and give it a
   `model:` field — the `body`/`belly`/`accent` colors are just the fallback look
   used until the model loads:
   ```js
   { id:'puppy', name:'Puppy', rarity:'uncommon', points:25, weight:14,
     body:'#d9b48c', belly:'#fff', accent:'#7a5a3a', ear:'round', model:'puppy.glb' }
   ```
3. Serve over http(s) (Pages, or `python3 -m http.server`) and it appears in the heap.

Good sources for free models: **poly.pizza**, **Sketchfab** (filter
*Downloadable* + a license you like), **quaternius.com** and **kenney.nl** (both
CC0). Prefer **CC0** (no strings); **CC-BY** is fine but must be credited below.

### Credits
- **Fox** (`models/fox.glb`) — model by *PixelMannen* (CC0 1.0), rig & animation by
  *@tomkranis* (CC BY 4.0), via the Khronos glTF-Sample-Models repository.

## Roadmap → "real app-store game"
Built so it can keep growing:

- **Graphics** — real 3D (Three.js) with a hand-written post pipeline: HDR scene
  buffer → bright-pass → separable Gaussian bloom → exposure tone-map composite,
  plus procedural PMREM environment lighting and a glossy reflective floor.
  **Modeled glTF prizes** are supported now (see "Adding your own 3D prize
  models" above) — drop in `.glb` files for richer art without touching the state
  machine.
- **Physics** — cannon.js drives the plush heap and claw collisions. Tune mass,
  friction, and `GRASP`/the grab curve for feel.
- **Audio** — `audio.js` generates music + SFX procedurally. Replace with licensed
  tracks behind the same `GameAudio.play()` / `startMusic()` API.
- **Monetization** — the "Get Free Coins" button is a stub where a rewarded ad or
  coin-pack IAP would live.
- **Store packaging** — wrap the web build with **Capacitor** (recommended) or
  Cordova to ship the same codebase to the iOS App Store and Google Play.
- **Backend** — add leaderboards / cloud saves (currently localStorage).
