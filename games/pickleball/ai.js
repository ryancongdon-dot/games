// ai.js — opponent + partner AI for doubles.
// Controls every player the human is NOT currently driving:
//   * far team (2,3): full play — chase, choose a shot, hit, and cover the kitchen
//   * near partner: positional cover (advance to the kitchen line, mirror depth)
// It plays the ball OFF THE BOUNCE by default (always legal re: two-bounce and the
// kitchen); higher tiers add legal volleys. Faults come from real positioning/aim
// error, never from cheating.
const AI = (() => {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

  const TIERS = {
    rookie:   { speed: 3.0, react: 0.34, aimErr: 1.15, miss: 0.14, volley: false, dinkBias: 0.3 },
    pro:      { speed: 4.1, react: 0.18, aimErr: 0.55, miss: 0.05, volley: true,  dinkBias: 0.5 },
    champion: { speed: 4.9, react: 0.09, aimErr: 0.28, miss: 0.015, volley: true, dinkBias: 0.62 },
  };

  let diff = TIERS.pro;
  const st = {};        // per-player transient state (reaction timers etc.)
  let prevBallTeamSide = null;

  function setDifficulty(name) { diff = TIERS[name] || TIERS.pro; }

  const sideOfTeam = (team) => (team === 0 ? 1 : -1);   // sign of z for a team's half
  const teamOf = (i) => (i < 2 ? 0 : 1);

  // choose an x on the target side that is far from the given defenders
  function openX(dims, defenders, biasErr) {
    let bestX = 0, bestGap = -1;
    for (let k = 0; k < 5; k++) {
      const cx = rand(-dims.HALF_W + 0.5, dims.HALF_W - 0.5);
      let gap = Infinity;
      for (const d of defenders) gap = Math.min(gap, Math.abs(cx - d.x));
      if (gap > bestGap) { bestGap = gap; bestX = cx; }
    }
    return clamp(bestX + gauss() * biasErr, -dims.HALF_W + 0.35, dims.HALF_W - 0.35);
  }

  // decide a shot (type + world target) for a far-team player striking to near side
  function chooseShot(ctx, p) {
    const { dims, ball } = ctx;
    const defenders = [ctx.players[0].pos, ctx.players[1].pos];
    const nearZ = +1;    // hitting toward near team (z > 0)
    const K = dims.KITCHEN, HL = dims.HALF_L;
    const atKitchen = Math.abs(p.pos.z) <= K + 0.7;
    const high = ball.p.y > 1.0 && Math.abs(ball.p.z) < K + 1.2;

    let type, tx, tz;
    if (high) {                         // put-away
      type = 'smash'; tx = openX(dims, defenders, diff.aimErr); tz = nearZ * (HL * rand(0.4, 0.7));
    } else if (atKitchen && Math.random() < diff.dinkBias) {
      type = 'dink'; tx = openX(dims, defenders, diff.aimErr * 0.7); tz = nearZ * (K * rand(0.4, 0.85));
    } else if (Math.random() < 0.16) {  // occasional lob over the net players
      type = 'lob'; tx = openX(dims, defenders, diff.aimErr); tz = nearZ * (HL * rand(0.7, 0.9));
    } else {                            // drive / drop deep
      type = 'drive'; tx = openX(dims, defenders, diff.aimErr); tz = nearZ * (HL * rand(0.55, 0.82));
    }
    return { type, target: { x: tx, z: tz } };
  }

  function ensure(i) { if (!st[i]) st[i] = { react: 0 }; return st[i]; }

  function moveToward(p, tx, tz, dims, dt, spd) {
    const dx = tx - p.pos.x, dz = tz - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.02) return;
    const s = Math.min(spd * dt, d);
    p.pos.x = clamp(p.pos.x + (dx / d) * s, -dims.HALF_W - 1.2, dims.HALF_W + 1.2);
    p.pos.z += (dz / d) * s;   // movement target is already clamped to this player's half
  }

  // main entry — called once per frame from game.js
  function update(dt, ctx) {
    const { ball, players, dims, control } = ctx;
    const HL = dims.HALF_L, K = dims.KITCHEN;
    const rally = ctx.rules.rallyInfo();

    // reaction timing: when the ball newly enters a team's half, delay pursuit
    const landing = ctx.predict(ball);
    const ballTeamSide = ball.p.z >= 0 ? 0 : 1;
    if (ballTeamSide !== prevBallTeamSide) {
      for (const i of [0, 1, 2, 3]) ensure(i).react = diff.react;
      prevBallTeamSide = ballTeamSide;
    }
    for (const i of [0, 1, 2, 3]) { const s = ensure(i); s.react = Math.max(0, s.react - dt); }

    // ----- per team, pick the taker (closest to predicted landing) -----
    for (const team of [0, 1]) {
      const idxs = team === 0 ? [0, 1] : [2, 3];
      const sideSign = sideOfTeam(team);
      const land = landing && Math.sign(landing.z) === sideSign ? landing : null;
      const target = land || { x: ball.p.x, z: sideSign * (HL * 0.5) };

      // taker = closest to target; but never override the human-controlled player
      let taker = idxs[0], td = Infinity;
      for (const i of idxs) {
        const d = Math.hypot(players[i].pos.x - target.x, players[i].pos.z - target.z);
        if (d < td) { td = d; taker = i; }
      }

      for (const i of idxs) {
        const p = players[i];
        p.idx = i;
        if (i === control) continue;              // human drives this one
        const s = ensure(i);
        const isTaker = (i === taker);

        // ----- movement target -----
        let mx, mz;
        if (isTaker && land && s.react <= 0) {
          mx = land.x; mz = clamp(land.z, sideSign > 0 ? 0.4 : -HL - 0.5, sideSign > 0 ? HL + 0.5 : -0.4);
        } else {
          // cover: sit at the kitchen line in this player's x lane
          const laneX = (i % 2 === 0) ? -1.4 : 1.4;
          mx = laneX; mz = sideSign * (K + 0.35);
        }
        moveToward(p, mx, mz, dims, dt, diff.speed);

        // ----- striking (far team only; near partner just positions) -----
        if (team === 1 && i === taker && rally) {
          const onOwnSide = Math.sign(ball.p.z) === sideSign;
          const reach = Math.hypot(ball.p.x - p.pos.x, ball.p.z - p.pos.z);
          const inReach = reach < 1.05 && ball.p.y < 1.85;
          const canOffBounce = rally.bounced;                 // played off a bounce = always legal
          const inKitchen = Math.abs(p.pos.z) <= K + 0.05;
          const canVolley = diff.volley && !rally.mustBounce && !inKitchen;
          if (onOwnSide && inReach && s.react <= 0 && (canOffBounce || canVolley)) {
            if (Math.random() < diff.miss) { s.react = 0.25; continue; } // shanked read
            const shot = chooseShot(ctx, p);
            ctx.strike(i, shot.type, shot.target);
          }
        }
      }
    }
  }

  function serveTargetJitter() { return diff.aimErr * 0.6; }

  return { setDifficulty, update, serveTargetJitter, get tier() { return diff; } };
})();

if (typeof window !== 'undefined') window.AI = AI;
