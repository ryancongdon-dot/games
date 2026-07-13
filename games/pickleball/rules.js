// rules.js — pickleball referee: traditional SIDE-OUT doubles scoring, serve
// legality, the two-bounce rule, and the kitchen (non-volley zone).
//
// Pure logic, no THREE/DOM — unit-testable in node. game.js feeds it events:
//   serveHit(), hit(globalIdx, pos), bounce({x,z}), net(), cross()
// and reads: info(), positions(dims), callout(), and consumeResult().
//
// Player model: global indices 0,1 = team 0 (near, +z); 2,3 = team 1 (far, -z).
// Each team has an "even starter" and "odd starter". A player stands in the
// RIGHT court when (team score is even) == (player is the even starter); they
// swap after every point their team scores while serving — exactly the real
// rule, which also gives the "even score => even starter on the right" invariant.
const Rules = (() => {
  'use strict';

  const FT = 0.3048;
  const HALF_W = 10 * FT, HALF_L = 22 * FT, KITCHEN = 7 * FT;
  const TOL = 0.06;   // generous line call (ball radius-ish); on the line is IN

  // team 0's RIGHT (even) court is +x; team 1's RIGHT (even) court is -x.
  const rightSign = (team) => (team === 0 ? +1 : -1);
  const teamOf = (g) => (g < 2 ? 0 : 1);
  const evenStarter = (team) => (team === 0 ? 0 : 2);
  const oddStarter = (team) => (team === 0 ? 1 : 3);
  const partnerOf = (g) => (g === 0 ? 1 : g === 1 ? 0 : g === 2 ? 3 : 2);

  const cfg = { target: 11, winBy: 2 };
  let S = null;

  function reset(startingTeam = 0, opts = {}) {
    if (opts.target) cfg.target = opts.target;
    S = {
      scores: [0, 0],
      servingTeam: startingTeam,
      serverNumber: 2,             // game opens on "second server" (one fault = side-out)
      server: evenStarter(startingTeam),
      phase: 'serve',              // serve | rally | dead
      rally: null,
      result: null,                // last rally outcome for game.js to consume
      matchOver: false,
      winner: -1,
    };
    return info();
  }

  // Is a player currently in the RIGHT court? Depends on their team's score.
  function inRightCourt(g) {
    const team = teamOf(g);
    const even = S.scores[team] % 2 === 0;
    const isEven = (g === evenStarter(team));
    return even === isEven;
  }
  // World x of a player's court centre (right/left), for their team.
  function courtX(g) {
    const team = teamOf(g);
    const side = inRightCourt(g) ? rightSign(team) : -rightSign(team);
    return side * (HALF_W * 0.5);
  }

  function receiver() {
    // diagonal receiver: the receiving-team player in the court crosscourt to
    // the server — i.e. same world-x SIGN as the serve target box.
    const rt = S.servingTeam ^ 1;
    const targetSign = -Math.sign(courtX(S.server)) || rightSign(rt);
    const a = evenStarter(rt), b = oddStarter(rt);
    return Math.sign(courtX(a)) === targetSign ? a : b;
  }

  // Serve target box (diagonal, beyond the kitchen) in world coords.
  function serveBox() {
    const rt = S.servingTeam ^ 1;
    const zSign = (rt === 0 ? +1 : -1);       // receiving side
    const xSign = -Math.sign(courtX(S.server)) || 1;
    return {
      x0: Math.min(0, xSign * HALF_W), x1: Math.max(0, xSign * HALF_W),
      z0: zSign * KITCHEN, z1: zSign * HALF_L,
      xSign, zSign,
    };
  }

  function info() {
    return {
      server: S.server, servingTeam: S.servingTeam, serverNumber: S.serverNumber,
      receiver: receiver(), scores: S.scores.slice(), phase: S.phase,
      serveBox: serveBox(), serverRight: inRightCourt(S.server),
      matchOver: S.matchOver, winner: S.winner,
    };
  }

  // Where everyone stands for the serve. dims = Court.DIMS (meters).
  function positions(dims) {
    const HL = dims.HALF_L, K = dims.KITCHEN;
    const out = {};
    const sv = S.server, svTeam = S.servingTeam, rt = svTeam ^ 1;
    const svBaseZ = (svTeam === 0 ? HL + 0.5 : -HL - 0.5);
    const kZ = (t) => (t === 0 ? K + 0.5 : -K - 0.5);
    // server behind baseline in their court
    out[sv] = { x: courtX(sv), z: svBaseZ };
    // server partner at their kitchen line, their own court
    const svp = partnerOf(sv);
    out[svp] = { x: courtX(svp), z: kZ(svTeam) };
    // receiver deep to return; partner at kitchen
    const rc = receiver(), rcp = partnerOf(rc);
    const rcBaseZ = (rt === 0 ? HL - 1.6 : -HL + 1.6);
    out[rc] = { x: courtX(rc), z: rcBaseZ };
    out[rcp] = { x: courtX(rcp), z: kZ(rt) };
    return out;
  }

  const inCourt = (x, z) => Math.abs(x) <= HALF_W + TOL && Math.abs(z) <= HALF_L + TOL;
  const inBox = (x, z, b) =>
    x >= Math.min(b.x0, b.x1) - TOL && x <= Math.max(b.x0, b.x1) + TOL &&
    Math.abs(z) >= KITCHEN - TOL && Math.abs(z) <= HALF_L + TOL &&
    Math.sign(z) === b.zSign;

  // ---- rally lifecycle ----
  function serveHit() {
    S.phase = 'rally';
    S.rally = {
      shots: 1,                 // serve counts as shot 1
      lastHitter: S.server, lastTeam: S.servingTeam,
      side: S.servingTeam,      // which side the ball is currently on (team whose half)
      bouncedSinceCross: false, // has it bounced since entering this side?
      bouncesThisSide: 0,
      serveValidated: false,
      box: serveBox(),
      over: false,
    };
  }

  function endRally(faultTeam, reason) {
    if (!S.rally || S.rally.over) return;
    S.rally.over = true;
    const winner = faultTeam ^ 1;
    const wasServe = winner === S.servingTeam;
    let event; // 'point' | 'server2' | 'sideout'
    if (winner === S.servingTeam) {
      S.scores[S.servingTeam] += 1;           // players auto-reposition via score parity
      event = 'point';
    } else if (S.serverNumber === 1) {
      S.serverNumber = 2; S.server = partnerOf(S.server);
      event = 'server2';
    } else {
      S.servingTeam = winner; S.serverNumber = 1;
      S.server = inRightCourtForServe(winner);
      event = 'sideout';
    }
    // match end?
    const sc = S.scores;
    for (let t = 0; t < 2; t++) {
      if (sc[t] >= cfg.target && sc[t] - sc[t ^ 1] >= cfg.winBy) { S.matchOver = true; S.winner = t; }
    }
    S.phase = 'dead';
    S.result = { faultTeam, winner, reason, event, scores: sc.slice(),
      servingTeam: S.servingTeam, serverNumber: S.serverNumber, server: S.server,
      pointFor: winner === undefined ? -1 : (event === 'point' ? winner : -1),
      matchOver: S.matchOver, matchWinner: S.winner };
    return S.result;
  }

  // the right-court player of a team given current score (used on side-out)
  function inRightCourtForServe(team) {
    const even = S.scores[team] % 2 === 0;
    return even ? evenStarter(team) : oddStarter(team);
  }

  // A player strikes the ball. pos = { x, z } of that player. Returns result or null.
  function hit(g, pos) {
    if (!S.rally || S.rally.over) return null;
    const team = teamOf(g);
    const r = S.rally;
    const isVolley = !r.bouncedSinceCross;   // hit before it bounced on this side

    // wrong side hitting? (ball not on this team's side) — ignore / illegal reach
    // two-bounce rule: shots 2 (return) and 3 (third) must be off a bounce
    const shotNo = r.shots + 1;
    if ((shotNo === 2 || shotNo === 3) && isVolley) {
      return endRally(team, 'two-bounce: must let it bounce');
    }
    // kitchen: volleying while in the non-volley zone is a fault
    if (isVolley) {
      const zAbs = Math.abs(pos.z);
      const onOwnSide = Math.sign(pos.z) === (team === 0 ? 1 : -1);
      if (onOwnSide && zAbs <= KITCHEN + TOL) {
        return endRally(team, 'kitchen volley');
      }
    }
    // legal strike — advance rally
    r.shots += 1;
    r.lastHitter = g; r.lastTeam = team;
    r.bouncedSinceCross = false;   // will re-evaluate after it crosses
    r.bouncesThisSide = 0;
    return null;
  }

  function cross() {
    if (!S.rally || S.rally.over) return;
    const r = S.rally;
    r.side ^= 1;
    r.bouncedSinceCross = false;
    r.bouncesThisSide = 0;
  }

  function bounce(pos) {
    if (!S.rally || S.rally.over) return null;
    const r = S.rally;
    r.bouncedSinceCross = true;
    r.bouncesThisSide += 1;

    // serve must land in the diagonal service box (first bounce of the serve)
    if (r.shots === 1 && !r.serveValidated) {
      r.serveValidated = true;
      if (!inBox(pos.x, pos.z, r.box)) {
        return endRally(S.servingTeam, 'serve out / wrong court');
      }
      return null; // good serve, awaiting return
    }
    // second bounce on a side without a return = that side failed (double bounce).
    // Must be checked BEFORE out-of-bounds: once a good ball bounces twice, where
    // the 2nd bounce lands is irrelevant — the returner simply didn't get to it.
    if (r.bouncesThisSide >= 2) {
      return endRally(r.side, 'double bounce');
    }
    // first bounce of a groundstroke: must land in-bounds, else the hitter faulted
    if (!inCourt(pos.x, pos.z)) {
      return endRally(r.lastTeam, 'out of bounds');
    }
    return null;
  }

  function net() {
    if (!S.rally || S.rally.over) return null;
    return endRally(S.rally.lastTeam, 'into the net');
  }

  function consumeResult() { const r = S.result; S.result = null; return r; }

  function nextServe() { S.phase = 'serve'; S.rally = null; return info(); }

  // live rally snapshot for the AI (so it respects two-bounce + kitchen)
  function rallyInfo() {
    if (!S.rally || S.rally.over) return null;
    const r = S.rally;
    return {
      shots: r.shots,
      bounced: r.bouncedSinceCross,
      side: r.side,                    // team whose half the ball is on
      mustBounce: r.shots < 3,         // next shot (serve return / 3rd) must be off a bounce
    };
  }

  function callout() {
    // serving team score – receiving team score – server number
    const st = S.servingTeam, rt = st ^ 1;
    return `${S.scores[st]} – ${S.scores[rt]} – ${S.serverNumber}`;
  }

  return {
    reset, info, positions, serveHit, hit, bounce, net, cross,
    consumeResult, nextServe, callout, rallyInfo,
    get cfg() { return cfg; },
    // exposed for tests
    _state: () => S, teamOf, partnerOf, serveBox, receiver,
  };
})();

if (typeof window !== 'undefined') window.Rules = Rules;
if (typeof module !== 'undefined') module.exports = Rules;
