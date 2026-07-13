// preload.js — runs before the game page loads, with contextIsolation on.
// Currently minimal. This is the seam where Steamworks (achievements, rich
// presence, cloud saves) would be bridged to the renderer via contextBridge.
//
// Example (once you add a Steamworks binding such as `steamworks.js`):
//
//   const { contextBridge } = require('electron');
//   const steam = require('steamworks.js').init(YOUR_APP_ID);
//   contextBridge.exposeInMainWorld('Steam', {
//     unlock: (name) => steam.achievement.activate(name),
//   });
//
// Then in game.js you could call `window.Steam?.unlock('FIRST_WIN')` on a win.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('KKDesktop', { isDesktop: true, platform: process.platform });
