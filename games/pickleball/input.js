// input.js — unified input manager: keyboard + mouse + Gamepad API -> intents.
// game.js calls Input.beginFrame() once per frame, then reads:
//   Input.move()      -> { x, y }  analog, x=right+, y=forward+ (toward net)
//   Input.pointer()   -> { x, y, active }  normalized screen 0..1 (mouse aim)
//   Input.aimStick()  -> { x, y, mag }     right-stick vector (-1..1)
//   Input.pressed(a)  -> edge this frame (a: drive|dink|lob|smash|serve|
//                        swing|pause|switch|confirm)
//   Input.held(a)     -> currently held
//   Input.usingPad()  -> a gamepad has been used recently
const Input = (() => {
  'use strict';
  const DEAD = 0.2;

  const keys = {};             // keyboard code -> bool
  let mouseDown = false;
  const ptr = { x: 0.5, y: 0.6, active: false, lastMove: 0 };
  let padIndex = null, padUsed = 0;

  let cur = {}, prev = {};
  const move = { x: 0, y: 0 };
  const aimStick = { x: 0, y: 0, mag: 0 };

  const ACTIONS = ['drive', 'dink', 'lob', 'smash', 'serve', 'swing', 'pause', 'switch', 'confirm'];

  function init(canvas) {
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      // stop the page from scrolling on gameplay keys
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    }, { passive: false });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    const setPtr = (e) => {
      const r = canvas.getBoundingClientRect();
      ptr.x = (e.clientX - r.left) / r.width;
      ptr.y = (e.clientY - r.top) / r.height;
      ptr.active = true; ptr.lastMove = performance.now();
    };
    canvas.addEventListener('pointermove', setPtr);
    canvas.addEventListener('pointerdown', (e) => { setPtr(e); mouseDown = true; });
    window.addEventListener('pointerup', () => { mouseDown = false; });
    window.addEventListener('gamepadconnected', (e) => { padIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { padIndex = null; });
  }

  function pad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (padIndex != null && pads[padIndex]) return pads[padIndex];
    for (const p of pads) if (p) { padIndex = p.index; return p; }
    return null;
  }

  function dz(v) { return Math.abs(v) < DEAD ? 0 : v; }

  function beginFrame() {
    prev = cur; cur = {};
    for (const a of ACTIONS) cur[a] = false;

    // ---- analog move ----
    let mx = 0, my = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
    if (keys['KeyW'] || keys['ArrowUp']) my += 1;   // forward (toward net)
    if (keys['KeyS'] || keys['ArrowDown']) my -= 1;

    const gp = pad();
    if (gp) {
      const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
      if (lx || ly) { mx += lx; my += -ly; padUsed = performance.now(); }
      const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
      aimStick.x = rx; aimStick.y = -ry; aimStick.mag = Math.hypot(rx, ry);
      if (aimStick.mag) padUsed = performance.now();
      const b = gp.buttons;
      const B = (i) => b[i] && b[i].pressed;
      if (B(0)) { cur.drive = true; cur.serve = true; cur.swing = true; cur.confirm = true; padUsed = performance.now(); }
      if (B(1)) { cur.dink = true; cur.swing = true; }
      if (B(3)) { cur.lob = true; cur.swing = true; }
      if (B(2)) { cur.smash = true; cur.swing = true; }
      if (B(9)) cur.pause = true;
      if (B(4) || B(5)) cur.switch = true;
    } else {
      aimStick.x = aimStick.y = aimStick.mag = 0;
    }
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    move.x = mx; move.y = my;

    // ---- keyboard/mouse action edges ----
    if (keys['KeyJ'] || mouseDown) { cur.drive = true; cur.swing = true; cur.confirm = true; }
    if (keys['KeyK']) { cur.dink = true; cur.swing = true; }
    if (keys['KeyL']) { cur.lob = true; cur.swing = true; }
    if (keys['KeyI']) { cur.smash = true; cur.swing = true; }
    if (keys['Space']) { cur.serve = true; cur.swing = true; cur.confirm = true; }
    if (keys['Escape'] || keys['KeyP']) cur.pause = true;
    if (keys['KeyE'] || keys['Tab'] || keys['ShiftLeft']) cur.switch = true;
    if (keys['Enter']) cur.confirm = true;

    // pointer active decays if the mouse hasn't moved recently and a pad is in use
    if (performance.now() - padUsed < 1500) ptr.active = false;
    else if (performance.now() - ptr.lastMove < 4000) ptr.active = true;
  }

  function pressed(a) { return !!cur[a] && !prev[a]; }
  function held(a) { return !!cur[a]; }
  function usingPad() { return performance.now() - padUsed < 2000; }

  return {
    init, beginFrame, pressed, held, usingPad,
    move: () => move,
    pointer: () => ptr,
    aimStick: () => aimStick,
  };
})();

if (typeof window !== 'undefined') window.Input = Input;
