# 🕹️ Arcade

A small collection of zero-dependency browser games that play well on **phone,
tablet (iPad), and desktop**. No build step, no frameworks — just open the HTML.

## Games

### 🧸 Claw Craze — `games/claw-machine/`
A claw machine where you line up a clumsy claw, drop it, and try to snag a
plushie. Faithful to the real thing: low win rate, a 20-second timer, and the
occasional fumble on the way to the prize chute.

**How to play**
- You start with **3 coins**; insert one to begin a turn.
- You have **20 seconds** to move the claw — `◀ ▶` left/right, `▲ ▼` for depth —
  then hit **DROP** (or let the timer auto-drop it).
- Desktop: **arrow keys** to move, **Space** to drop.
- The claw descends, grabs, and carries the prize to the box — but it only holds
  on ~40% of well-aimed grabs, and there's a **~5% chance it fumbles mid-carry**.
- Win prizes to earn **points**, fill your **collection**, and unlock new
  **machine themes**. Progress saves automatically (localStorage).

**Tuning** — all the knobs live at the top of
[`games/claw-machine/game.js`](games/claw-machine/game.js): `AIM_TIME`,
`GRAB_CHANCE`, `CHAOS_DROP_CHANCE`, `GRAB_RADIUS`, prize point values/weights,
and the unlock thresholds in `THEMES`.

## Run it
Just open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Project layout
```
index.html                 # arcade hub (lists games)
games/
  claw-machine/
    index.html             # game shell
    style.css              # responsive, mobile-first styling
    game.js                # render loop + state machine + mechanics
    audio.js               # generated chiptune music + SFX (Web Audio)
```

## Roadmap → "real app-store game"
This v1 is intentionally built so it can grow:

- **Graphics** — prizes and the cabinet are drawn with canvas vector shapes
  (`drawPlushShape` in `game.js`). Swap these for sprite sheets / Spine / Rive
  without touching the state machine.
- **Audio** — `audio.js` generates music + SFX procedurally. Replace with
  licensed tracks behind the same `GameAudio.play()` / `startMusic()` API.
- **Monetization** — the "Get Free Coins" button is a stub where a rewarded ad
  or coin-pack IAP would live.
- **Store packaging** — wrap the web build with **Capacitor** (recommended) or
  Cordova to ship the same codebase to the iOS App Store and Google Play.
- **Backend** — add leaderboards / cloud saves (currently localStorage).
