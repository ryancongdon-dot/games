// physics.js — hand-rolled pickleball ball dynamics + shot solver.
// Deliberately NOT cannon.js: a small custom integrator gives precise, tunable
// arcade feel and cheap landing prediction for the AI and aim reticle.
//
// The ball state is a plain object; court3d renders it from p each frame:
//   { p:{x,y,z}, v:{x,y,z}, spin, r, alive, bounces, lastBounceZ, hitBy }
const Physics = (() => {
  'use strict';

  const D = Court.DIMS;
  const R = Court.BALL_R;

  // ---- tunable feel (tweak these for game feel) ----
  const TUNE = {
    g: 15.5,            // gravity (m/s^2) — punchier than real 9.8 for a small court
    drag: 0.045,        // linear air drag per second
    restY: 0.62,        // ground bounce energy kept (vertical)
    restXZ: 0.72,       // ground bounce energy kept (horizontal)
    netRest: 0.28,      // energy kept when clipping the net
    netGrab: 0.55,      // how much the net kills forward speed on a clip
    spinCurve: 0.9,     // how strongly spin curves flight
    minBounceV: 0.5,    // below this vertical speed at ground, ball settles/rolls
  };

  const netHeightAt = (x) => {
    const t = Math.min(1, Math.abs(x) / D.POST_X);
    return D.NET_H_SIDE - (D.NET_H_SIDE - D.NET_H_MID) * (1 - t * t);
  };

  function make() {
    return { p: { x: 0, y: R, z: D.HALF_L * 0.6 }, v: { x: 0, y: 0, z: 0 },
      spin: 0, r: R, alive: true, bounces: 0, lastBounceZ: 0, hitBy: -1, rolling: false };
  }

  // integrate one step; returns an event string when something notable happens:
  // 'bounce' | 'net' | null
  function step(b, dt) {
    if (!b.alive) return null;
    let event = null;

    // air drag + gravity
    const drag = Math.exp(-TUNE.drag * dt);
    b.v.x *= drag; b.v.z *= drag;
    b.v.y = b.v.y * drag - TUNE.g * dt;
    // spin curves the horizontal path (Magnus-ish, simplified)
    b.v.x += b.spin * TUNE.spinCurve * dt;

    const prevZ = b.p.z, prevY = b.p.y;
    b.p.x += b.v.x * dt;
    b.p.y += b.v.y * dt;
    b.p.z += b.v.z * dt;

    // --- net collision: crossing the z=0 plane within the posts ---
    if ((prevZ > 0) !== (b.p.z > 0)) {
      const t = prevZ / (prevZ - b.p.z);           // frac to crossing
      const xAt = b.p.x - b.v.x * dt * (1 - t);
      const yAt = prevY + (b.p.y - prevY) * t;
      if (Math.abs(xAt) <= D.POST_X && yAt <= netHeightAt(xAt) + b.r) {
        // clipped the net — kill most speed, drop it near the tape
        b.p.z = -b.v.z * 0.0001;                    // nudge just to hit side
        b.p.z = (prevZ > 0 ? 1 : -1) * 0.02;
        b.v.z = -b.v.z * TUNE.netRest * TUNE.netGrab;
        b.v.x *= 0.4; b.v.y *= TUNE.netRest;
        b.spin *= 0.2;
        event = 'net';
      }
    }

    // --- ground bounce ---
    if (b.p.y <= b.r) {
      b.p.y = b.r;
      if (Math.abs(b.v.y) < TUNE.minBounceV && b.bounces > 0) {
        // settle into a roll
        b.v.y = 0; b.rolling = true;
        b.v.x *= 0.96; b.v.z *= 0.96;
      } else {
        b.v.y = Math.abs(b.v.y) * TUNE.restY;
        b.v.x *= TUNE.restXZ; b.v.z *= TUNE.restXZ;
        b.spin *= 0.6;
        b.bounces += 1;
        b.lastBounceZ = b.p.z;
        b.lastBounceX = b.p.x;
        event = 'bounce';
      }
    }
    return event;
  }

  // Predict where the ball next hits the ground (y=r). Non-destructive.
  // Returns { x, z, t, y } of the landing, or null if it never lands in range.
  function predictLanding(b, maxT = 3.0) {
    const s = { p: { ...b.p }, v: { ...b.v }, spin: b.spin, r: b.r };
    const dt = 1 / 120;
    let t = 0;
    let prevY = s.p.y;
    while (t < maxT) {
      const drag = Math.exp(-TUNE.drag * dt);
      s.v.x *= drag; s.v.z *= drag;
      s.v.y = s.v.y * drag - TUNE.g * dt;
      s.v.x += s.spin * TUNE.spinCurve * dt;
      s.p.x += s.v.x * dt; s.p.y += s.v.y * dt; s.p.z += s.v.z * dt;
      t += dt;
      if (s.v.y < 0 && s.p.y <= s.r && prevY > s.r) {
        return { x: s.p.x, z: s.p.z, y: s.r, t };
      }
      prevY = s.p.y;
    }
    return null;
  }

  // Solve a launch velocity that sends the ball from `from` to ground `target`
  // with an arc chosen by shot `type`. Optionally add sidespin.
  // type: 'drive' | 'dink' | 'lob' | 'smash' | 'serve' | 'return'
  const FLIGHT = { drive: 0.62, dink: 0.5, lob: 1.15, smash: 0.42, serve: 0.85, return: 0.72 };
  const APEXBIAS = { drive: 0.35, dink: 0.28, lob: 1.4, smash: 0.1, serve: 0.55, return: 0.5 };

  function launch(b, from, target, type = 'drive', power = 1, spin = 0) {
    const t = (FLIGHT[type] || 0.7) / Math.max(0.5, power);
    b.p.x = from.x; b.p.y = from.y; b.p.z = from.z;
    b.v.x = (target.x - from.x) / t;
    b.v.z = (target.z - from.z) / t;
    // vertical: parabola passing from.y -> r at time t
    b.v.y = (b.r - from.y + 0.5 * TUNE.g * t * t) / t;
    // add apex bias for loft (helps clear the net for lobs/serves)
    b.v.y += APEXBIAS[type] || 0;
    b.spin = spin;
    b.alive = true; b.rolling = false;
    b.bounces = 0;
    return b;
  }

  // Will a ball launched like this clear the net at z=0? (used to auto-loft)
  function clearsNet(b) {
    const l = predictLandingCrossNet(b);
    return l;
  }
  function predictLandingCrossNet(b) {
    const s = { p: { ...b.p }, v: { ...b.v }, spin: b.spin, r: b.r };
    const dt = 1 / 160; let t = 0; let prevZ = s.p.z;
    while (t < 2.5) {
      const drag = Math.exp(-TUNE.drag * dt);
      s.v.x *= drag; s.v.z *= drag; s.v.y = s.v.y * drag - TUNE.g * dt;
      s.p.x += s.v.x * dt; s.p.y += s.v.y * dt; s.p.z += s.v.z * dt; t += dt;
      if ((prevZ > 0) !== (s.p.z > 0)) {
        return s.p.y > netHeightAt(s.p.x) + s.r;
      }
      prevZ = s.p.z;
    }
    return true;
  }

  return { TUNE, make, step, predictLanding, launch, clearsNet, netHeightAt, R };
})();

if (typeof window !== 'undefined') window.Physics = Physics;
