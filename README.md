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

### 🎳 Pin Kings — `games/bowling/`
A **real 3D** league-bowling game (WebGL + cannon.js physics) wrapped in a cozy
**alley hub** (*Dave the Diver*-style framing). `index.html` is the **hub**: a home
screen for *Strike Valley Lanes* with a living **league standings board**, a season
schedule (play 6 rival teams once each — beat their score to win the night), money you
earn, and clickable spots (the Lanes, the Arcade → Claw Craze, a **Pro Shop**, and the
**Pizza Counter** side job). Bowling a league night launches the game (`lanes.html`); the
result records back into the season and advances the week. Top of the table at season's
end = **league champions**. (Open `lanes.html` directly for a no-stakes practice game.)

The **Pro Shop** (`proshop.html`) sells bowling balls you buy with your winnings and
equip for matches. A ball's **weight (6–16 lb)** sets the physics ball mass — heavier =
more **pin carry** (momentum through the rack); lighter deflects more. Its **hook** stat
scales how far the curve arcs. On the approach the ball is held to the lane (it can't
bounce on release) and switches to a real mass-driven body just before the pins.

The **Pizza Counter** (`pizza.html`) is a *Dave-the-Diver*-style dinner-rush side job:
customers walk in and sit at the counter, each with an order bubble and a patience bar.
Tap a customer to take their order, build their pizza from the topping palette (toppings
fill the whole pie), bake into the golden zone with a timing meter, and serve before they
walk out — juggling the rush as more arrive. Perfect, speedy pies build a combo for bigger
tips; you keep a small **cut (25%)** of the night's sales as pocket money. Winning **league
nights** ($80/win) is the real bankroll — pizza is a way to mix it up between matches.

The bowling itself has a deliberately **clean, "not jumbled" look** inspired by *Dave the Diver*: the scene renders to a
low-resolution buffer and is upscaled **nearest-neighbour** for crisp chunky pixels,
with distinct depth layers (sharp warm lane up front, hazy cool background) and
**restrained lighting** — no heavy bloom. The 3D canvas is pixelated; the flat,
high-contrast HUD sits crisply on top in the corners.

The heart of it is a **deliberate, WYSIWYG shot**: you dial in **AIM** (where you
stand), **POWER**, **CURVE** (which way & how much it hooks), and **SPIN** (rev rate,
which amplifies the back-end hook) with sliders, and a **live blue line on the lane
previews exactly where the ball will travel** — then you **THROW** and the ball rolls
with real physics into a 10-pin rack. The preview is faithful because the lane uses
low friction so the ball holds its forward speed (the same model the preview draws).

**How to play**
- Drag the **AIM / POWER / CURVE / SPIN** sliders to shape the shot (desktop:
  **arrow keys** nudge aim; focus a slider and use its own arrows).
- The **blue line + ring** show the predicted path and entry point — then **THROW**
  (or **Space/Enter**). The camera follows the ball down the lane into the pins.
- Note: **lower power hooks more** than high power (slower ball = more break) — a real
  bowling skill dimension.
- Full standard **10-frame scoring** (strikes, spares, 10th-frame bonus balls).
- Beat **140** to win the **league night**; your week record & best save locally.
- Sound is procedural (Web Audio) — a rolling rumble, a pin crash on impact, and a
  strike/spare chime.

**Tuning** — shot feel lives in the `SHOT` block at the top of
[`games/bowling/scene3d.js`](games/bowling/scene3d.js): `speedMin/Max` (POWER → ~10–22
mph), `bulge` (how far the CURVE arcs across the lane), `spinBase` (arc at zero SPIN),
`humpSkew` (where the arc peaks), `steerStopZ` (handoff to physics before the pins).
The curve is **kinematic** — the ball steers along a designed arc while forward motion
stays physical — so the drawn preview line is exactly the lane path. Lane uses real
dimensions (60 ft, 41.5″ wide); physics runs at a small fixed step (`FIXED`, `MAX_SUBSTEPS`)
to stop the fast ball tunnelling through the pins. Pin liveliness is the pin/ball
`ContactMaterial` restitution + pin damping. Camera framing is `camHome`/`camLookHome`/`CAM`;
pixel crunch is `PIXEL`; the 140 win line is at the top of [`game.js`](games/bowling/game.js).

> **Roadmap toward the bigger game** (*Dave the Diver*-style story + side quests
> around the alley — cooking pizza, fixing arcade machines — wrapped in a league
> season): this build is the playable **bowling core**. A hub/world, characters,
> dialogue, and the side-quest mini-games layer on top of this same engine. A PS5 /
> Switch 2 release would be a later port to Unity/Unreal (which need licensed
> console devkits); the design and feel here carry over directly.

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
  bowling/
    index.html             # the ALLEY HUB (home screen / entry point)
    hub.css, hub.js        # hub styling + logic (matchup, standings, spots)
    league.js              # season model + Pro Shop balls, shared everywhere
    proshop.html, proshop.js # buy & equip bowling balls (weight = pin carry, hook)
    pizza.html, pizza.js, pizza.css # Pizza Counter side job (earn league money)
    lanes.html             # the bowling game shell
    style.css              # flat, high-contrast corner HUD (crisp over pixelated 3D)
    game.js                # shot state machine (aim/power/curve/spin), 10-pin scoring
    scene3d.js             # WebGL 3D lane + cannon.js physics, pixelated render, SHOT tuning
    audio.js               # procedural Web Audio SFX (roll / pin crash / strike)
    vendor/                # three.min.js + cannon.min.js (vendored, self-contained)
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
