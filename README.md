# 🕹️ Arcade

A small collection of browser games that play well on **phone, tablet (iPad),
and desktop**. No build step and no install — just open the HTML.

## Games

### 🧸 Claw Craze — `games/claw-machine/`
A **real 3D** claw machine (WebGL) where you line up a clumsy claw, drop it, and
try to snag a plushie out of a physics-driven heap. Faithful to the real thing:
low win rate, a 20-second timer, and the occasional fumble on the way to the
prize chute.

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
`GRAB_CHANCE`, `CHAOS_DROP_CHANCE`, prize point values/weights, and the unlock
thresholds in `THEMES`. Scene/physics knobs (cabinet size, grab reach `GRASP`,
heap size `PILE_TARGET`) live at the top of
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

- **Graphics** — real 3D now (Three.js). Plushies/cabinet are built from
  primitives + `MeshStandardMaterial`; swap in modeled/sculpted assets (glTF) for
  richer art without touching the state machine. Neon **bloom** post-processing is
  a natural next step (needs the ES-module Three build).
- **Physics** — cannon.js drives the plush heap and claw collisions. Tune mass,
  friction, and `GRASP`/`GRAB_CHANCE` for feel.
- **Audio** — `audio.js` generates music + SFX procedurally. Replace with licensed
  tracks behind the same `GameAudio.play()` / `startMusic()` API.
- **Monetization** — the "Get Free Coins" button is a stub where a rewarded ad or
  coin-pack IAP would live.
- **Store packaging** — wrap the web build with **Capacitor** (recommended) or
  Cordova to ship the same codebase to the iOS App Store and Google Play.
- **Backend** — add leaderboards / cloud saves (currently localStorage).
