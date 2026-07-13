// main.js — Electron main process for the desktop (Steam) build of Kitchen Kings.
// Wraps the exact same no-build web game in a native window. Gamepads work out of
// the box via Chromium's Gamepad API — the same input.js path used on the web.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// In dev (`npm start`) the game lives one folder up; when packaged, electron-
// builder copies it to resources/game (see extraResources in package.json).
function gameIndex() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'game', 'index.html')
    : path.join(__dirname, '..', 'index.html');
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b1220',
    title: 'Kitchen Kings',
    fullscreen: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // keep the render loop at full speed
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(gameIndex());

  // F11 toggles fullscreen; Esc is handled in-game (pause), so don't intercept it.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
}

// Steam overlay/controller support prefers a single instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
