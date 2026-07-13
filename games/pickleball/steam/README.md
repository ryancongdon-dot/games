# Kitchen Kings — Desktop / Steam build

This folder wraps the **same web game** (in `../`) as a native desktop app with
[Electron](https://www.electronjs.org/), so it can ship on Steam (Windows, macOS,
Linux). The game itself stays a no-build web app — it still opens by double-click
and lives in the arcade hub. This wrapper only adds a window, fullscreen, and the
seam for Steamworks.

Gamepads already work: Electron is Chromium, so the game's `input.js` Gamepad API
path runs unchanged. A Steam Controller / Xbox / PlayStation pad is recognized as
a standard gamepad.

## Develop

```bash
cd games/pickleball/steam
npm install
npm start          # launches the game in an Electron window (loads ../index.html)
```

## Package installers

```bash
npm run dist       # build for the current OS -> dist/
npm run dist:win   # Windows NSIS installer
npm run dist:mac   # macOS dmg
npm run dist:linux # Linux AppImage
```

`electron-builder` copies the game folder into the app's resources (`extraResources`
→ `resources/game`), and `main.js` loads it from `process.resourcesPath` when
packaged (and from `../index.html` in dev).

## Steamworks (achievements, overlay, cloud saves)

Not wired up yet — this is the integration seam:

1. Get a Steam **App ID** from Steamworks and add the Steamworks SDK.
2. Add a Node binding, e.g. [`steamworks.js`](https://github.com/ceifa/steamworks.js)
   (modern, prebuilt) or `greenworks`.
3. Initialize it in `main.js` and expose a safe API to the game through
   `preload.js` via `contextBridge` (see the commented example there).
4. Call it from the game — e.g. `window.Steam?.unlock('FIRST_WIN')` when a match
   is won (in `game.js`'s `showResults`).
5. For the Steam **overlay** to draw over the game, launch through Steam and keep
   a single instance (already handled via `requestSingleInstanceLock`).

Suggested first achievements: first match win, win on Champion, win a rally with a
kitchen dink, come back from 0–5.

## Notes
- Pin the `electron` version to a current release before shipping.
- Add real app icons (`build/icon.ico`, `icon.icns`, `icon.png`) and reference
  them under `build` in `package.json`.
- Steam runs the game from its install dir; the file:// load in `main.js` works
  from the packaged resources without a local server.
