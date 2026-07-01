// sprites.js — procedural characters drawn in code (no emoji, no image files).
// Cute chunky humanoids with a walk cycle, plus a face-crop for dialogue
// portraits. Swap for real sprite sheets later behind the same draw calls.
const Sprites = (() => {
  'use strict';

  // palettes for the cast (skin / hair / shirt / pants / shoe + flags)
  const CHARS = {
    you:   { skin: '#e8b088', hair: '#6b4529', shirt: '#4aa6ff', pants: '#2a3556', shoe: '#20242e' },
    gus:   { skin: '#d69a72', hair: '#cfcfcf', shirt: '#c26a2f', pants: '#3a3320', shoe: '#201a14', stache: true },
    rosa:  { skin: '#e0a878', hair: '#2a1a12', shirt: '#ff7db0', pants: '#33263a', shoe: '#f2f2f2', apron: true, longhair: true },
    mac:   { skin: '#c98a5c', hair: '#3a2a1a', shirt: '#4a6f9a', pants: '#2b3550', shoe: '#20242e', cap: '#e8453c' },
    clerk: { skin: '#eabf95', hair: '#8a5a2a', shirt: '#39d98a', pants: '#2a2f3f', shoe: '#20242e' },
    vince: { skin: '#d8a070', hair: '#1a1a1a', shirt: '#e8453c', pants: '#222', shoe: '#111' },
    doreen:{ skin: '#e6b48a', hair: '#b06bff', shirt: '#7a4fd0', pants: '#33263a', shoe: '#fff', longhair: true },
    rex:   { skin: '#c98a5c', hair: '#4a2a10', shirt: '#ff8f3f', pants: '#2b2820', shoe: '#20242e' },
    mimi:  { skin: '#eabf95', hair: '#ffcf4d', shirt: '#ffd23f', pants: '#3a2f10', shoe: '#fff', longhair: true },
    kap:   { skin: '#d69a72', hair: '#2a2a2a', shirt: '#5b7a4a', pants: '#3a4030', shoe: '#20242e', cap: '#3a4030' },
    benny: { skin: '#e8b088', hair: '#6b4529', shirt: '#39d98a', pants: '#2a3556', shoe: '#20242e' },
  };
  const pal = (id) => CHARS[id] || CHARS.you;

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function part(ctx, x, y, w, h, r, fill, ow) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = fill; ctx.fill();
    if (ow > 0) { ctx.lineWidth = ow; ctx.strokeStyle = 'rgba(18,14,26,0.85)'; ctx.stroke(); }
  }

  // Draw a character standing with feet at (cx, feetY). s = unit size (px).
  // t = time ms (walk animation), moving = bool, face = -1 left / 1 right.
  function drawChar(ctx, cx, feetY, s, id, t, moving, face) {
    const p = pal(id);
    const ow = Math.max(1, s * 0.85);
    const phase = t * 0.011;
    const sw = moving ? Math.sin(phase) : 0;             // limb swing
    const bob = moving ? Math.abs(Math.sin(phase)) * 0.5 * s : 0;
    face = face || 1;

    const hipY = feetY - 6.2 * s;
    const shoulderY = hipY - 6.6 * s - bob;
    const headCy = shoulderY - 3.0 * s;
    const headR = 3.4 * s;

    ctx.save();
    // shadow
    ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cx, feetY + 0.4 * s, 5 * s, 1.5 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // legs (front-facing, alternating stride)
    const stride = 1.4 * s * sw;
    part(ctx, cx - 2.7 * s + stride, hipY - 0.3 * s, 2.5 * s, 6.6 * s, 1.1 * s, p.pants, ow);   // left leg
    part(ctx, cx + 0.2 * s - stride, hipY - 0.3 * s, 2.5 * s, 6.6 * s, 1.1 * s, p.pants, ow);   // right leg
    part(ctx, cx - 2.9 * s + stride, feetY - 1.2 * s, 3.0 * s, 1.6 * s, 0.7 * s, p.shoe, ow);   // left shoe
    part(ctx, cx + 0.0 * s - stride, feetY - 1.2 * s, 3.0 * s, 1.6 * s, 0.7 * s, p.shoe, ow);   // right shoe

    // torso
    part(ctx, cx - 3.6 * s, shoulderY, 7.2 * s, 7.2 * s, 1.8 * s, p.shirt, ow);
    if (p.apron) { ctx.globalAlpha = 0.85; part(ctx, cx - 2.4 * s, shoulderY + 1.6 * s, 4.8 * s, 5.4 * s, 0.8 * s, '#fff5e0', 0); ctx.globalAlpha = 1; }

    // arms (swing opposite legs)
    part(ctx, cx - 4.9 * s - stride * 0.6, shoulderY + 0.4 * s, 2.1 * s, 6.2 * s, 1.0 * s, p.shirt, ow);
    part(ctx, cx + 2.8 * s + stride * 0.6, shoulderY + 0.4 * s, 2.1 * s, 6.2 * s, 1.0 * s, p.shirt, ow);
    // hands
    part(ctx, cx - 4.8 * s - stride * 0.6, shoulderY + 5.6 * s, 2.0 * s, 2.0 * s, 1.0 * s, p.skin, ow);
    part(ctx, cx + 2.9 * s + stride * 0.6, shoulderY + 5.6 * s, 2.0 * s, 2.0 * s, 1.0 * s, p.skin, ow);

    // head
    drawHead(ctx, cx, headCy, headR, p, ow, face);
    ctx.restore();
  }

  function drawHead(ctx, cx, cy, r, p, ow, face) {
    // long hair behind
    if (p.longhair) { part(ctx, cx - r * 1.05, cy - r * 0.6, r * 2.1, r * 2.4, r * 0.9, p.hair, 0); }
    // face
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = p.skin; ctx.fill();
    ctx.lineWidth = ow; ctx.strokeStyle = 'rgba(18,14,26,0.85)'; ctx.stroke();
    // hair (top cap)
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.05, Math.PI * 1.95, false);
    ctx.lineTo(cx + r * 0.4, cy - r * 0.2); ctx.closePath();
    ctx.fillStyle = p.hair; ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.55, r * 0.95, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = p.hair; ctx.fill();
    ctx.restore();
    if (p.cap) { part(ctx, cx - r * 1.05, cy - r * 1.15, r * 2.1, r * 0.9, r * 0.4, p.cap, ow); part(ctx, cx + r * 0.2 * face, cy - r * 0.75, r * 1.1, r * 0.4, r * 0.2, p.cap, 0); }
    // eyes
    const ex = r * 0.42, ey = cy + r * 0.05;
    ctx.fillStyle = '#20242e';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * ex, ey, r * 0.16, 0, Math.PI * 2); ctx.fill(); }
    // mustache
    if (p.stache) { ctx.fillStyle = p.hair; part(ctx, cx - r * 0.55, cy + r * 0.4, r * 1.1, r * 0.35, r * 0.15, p.hair, 0); }
    // smile
    ctx.strokeStyle = 'rgba(40,20,20,0.6)'; ctx.lineWidth = Math.max(1, ow * 0.7);
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.25, r * 0.35, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
  }

  // Portrait: a head drawn into a square (for dialogue). Returns a canvas.
  function facePortrait(id, px) {
    const cv = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!cv) return null;
    cv.width = px; cv.height = px;
    const ctx = cv.getContext('2d');
    const r = px * 0.34;
    drawHead(ctx, px / 2, px * 0.52, r, pal(id), Math.max(1, px * 0.03), 1);
    return cv;
  }

  return { drawChar, facePortrait, CHARS };
})();
if (typeof window !== 'undefined') window.Sprites = Sprites;
