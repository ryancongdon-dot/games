// story.js — the cast, dialogue engine, and season beats (the "soul" layer).
// Loaded on the alley hub. Exposes a global `Story`.
//
// Flow it drives: first visit -> intro; clicking BOWL -> that week's rival
// trash-talks; returning after a match -> rival + Gus react to the result;
// plus a midseason turn and a championship finale. Simple systems, real drama.
const Story = (() => {
  'use strict';
  const KEY = 'pinkings_story_v1';
  const L = window.League;

  const CAST = {
    narrator: { name: '', face: '🎳', color: '#9fb4dd' },
    gus:  { name: 'Gus',       face: '🧔', color: '#ffd23f' },
    rosa: { name: 'Rosa',      face: '👩‍🍳', color: '#ff9ec4' },
    you:  { name: 'You',       face: '🙂', color: '#8fe1ff' },
    vince:  { name: 'Vince',   face: '😏', color: '#ff8f8f' },
    doreen: { name: 'Doreen',  face: '😎', color: '#c9a0ff' },
    rex:    { name: 'Rex',     face: '😤', color: '#ff7d4d' },
    mimi:   { name: 'Mimi',    face: '😼', color: '#ffd23f' },
    kap:    { name: 'Sgt. Kap', face: '🫡', color: '#8fe1ff' },
    benny:  { name: 'Benny',   face: '😄', color: '#39d98a' },
  };
  const TEAM_RIVAL = {
    'Gutter Rats': 'vince', 'Split Happens': 'doreen', 'Lane Wolves': 'rex',
    'Alley Cats': 'mimi', 'Strike Force': 'kap', 'Pin Pals': 'benny',
  };

  const line = (who, text) => ({ who, text });

  const INTRO = [
    line('narrator', 'STRIKE VALLEY LANES. Forty years on this corner. Lately it collects more cobwebs than quarters.'),
    line('gus', "You'd be the new blood. Gus. I own this dusty old barn — for now, anyway."),
    line('gus', "Bank's circling. But the league trophy still means something in this town. Win it, and folks remember we exist."),
    line('rosa', "Don't let the grump scare you! I'm Rosa — pizza counter's mine. Get hungry, come find me. 🍕"),
    line('gus', "Six nights. Six teams who think that trophy's already theirs. Lace up, kid — let's prove 'em wrong."),
    line('you', "...Let's roll."),
  ];

  const BANTER = {
    vince:  [line('vince', "Fresh meat. Do me a favor and keep it out of MY gutters, rookie.")],
    doreen: [line('doreen', "Aww, a newbie. Sweetheart, I've got bowling shoes older than you.")],
    rex:    [line('rex', "The Wolves hunt in a pack. You bowl alone. Do the math, pup.")],
    mimi:   [line('mimi', "Mrrow~ hope you brought your A-game. We like to play with our food. 😼")],
    kap:    [line('kap', "Discipline wins games. We drill strikes in our sleep. At ease — you'll need the rest.")],
    benny:  [line('benny', "Hey, no hard feelings whoever wins! ...but, uh, we're totally gonna win.")],
  };
  const REACT = {
    vince:  { win: "Beginner's luck. Savor it.", loss: "Hah! The kid's got teeth. Didn't see that coming." },
    doreen: { win: "Well, butter my roll. Nice game, kid.", loss: "That's how a veteran does it, hon." },
    rex:    { win: "...The pack respects a fighter. Well bowled.", loss: "Awoo! The Wolves eat tonight." },
    mimi:   { win: "Hmph. You got the cream this time. 😾", loss: "Purrfect. Better luck next time~" },
    kap:    { win: "Outstanding form, recruit. Genuinely.", loss: "Textbook. Dismissed." },
    benny:  { win: "Aw man! But hey — great match, seriously!", loss: "We did it, guys! ...sorry! Good game though!" },
  };

  // ---------- flags ----------
  let flags = null;
  function load() {
    if (flags) return flags;
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) flags = s; } catch (e) { /* ignore */ }
    if (!flags) flags = { introSeen: false, beats: [], reactWeek: 0 };
    return flags;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(flags)); } catch (e) { /* ignore */ } }

  // ---------- dialogue overlay ----------
  let el = null;
  function ensureOverlay() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'dlg'; el.className = 'dlg hidden';
    el.innerHTML =
      '<div class="dlg-box" id="dlg-box">' +
        '<div class="dlg-portrait" id="dlg-face">🎳</div>' +
        '<div class="dlg-main"><div class="dlg-name" id="dlg-name"></div>' +
        '<div class="dlg-text" id="dlg-text"></div></div>' +
        '<div class="dlg-next">▶</div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', advance);
  }

  let queue = [], qi = 0, li = 0, done = null;
  function play(lines, onDone) {
    ensureOverlay();
    queue = [lines]; qi = 0; li = 0; done = onDone || null;
    el.classList.remove('hidden');
    showLine();
  }
  function playSeq(scenes, onDone) {         // scenes = array of line-arrays
    ensureOverlay();
    queue = scenes.filter((s) => s && s.length); qi = 0; li = 0; done = onDone || null;
    if (!queue.length) { if (onDone) onDone(); return; }
    el.classList.remove('hidden');
    showLine();
  }
  function showLine() {
    const l = queue[qi][li];
    const c = CAST[l.who] || CAST.narrator;
    document.getElementById('dlg-face').textContent = c.face;
    const nm = document.getElementById('dlg-name');
    nm.textContent = c.name; nm.style.color = c.color;
    document.getElementById('dlg-text').textContent = l.text;
    el.querySelector('#dlg-box').classList.toggle('narrator', l.who === 'narrator');
  }
  function advance() {
    li++;
    if (li >= queue[qi].length) { qi++; li = 0; }
    if (qi >= queue.length) { finish(); return; }
    showLine();
  }
  function finish() {
    el.classList.add('hidden');
    const cb = done; done = null; queue = [];
    if (cb) cb();
  }

  // ---------- public triggers ----------
  function rivalBanter(team, onDone) {
    const r = TEAM_RIVAL[team];
    const lines = r && BANTER[r];
    if (!lines) { if (onDone) onDone(); return; }
    play(lines, onDone);
  }

  // Decide what plays when the hub loads; returns true if a scene ran.
  function onHubLoad(onDone) {
    load();
    const scenes = [];

    if (!flags.introSeen) { scenes.push(INTRO); flags.introSeen = true; }

    // react to a match that just finished (lastResult from League)
    const last = L && L.lastResult;
    if (last && last.week > flags.reactWeek) {
      flags.reactWeek = last.week;
      const r = TEAM_RIVAL[last.opp];
      const rl = r && REACT[r];
      const react = [];
      if (rl) react.push(line(r, last.win ? rl.win : rl.loss));
      react.push(last.win
        ? line('gus', "HA! You see that?! Get outta here, you're really somethin'.")
        : line('gus', "Shake it off. It's a long season — we get 'em next week."));
      scenes.push(react);
    }

    // midseason turn (once, from week 4 on)
    if (L && !L.done && L.week >= 4 && flags.beats.indexOf('mid') < 0) {
      flags.beats.push('mid');
      scenes.push([
        line('rosa', "Have you SEEN the crowd lately? Sold more pizza this week than all of last year!"),
        line('gus', "Word's getting 'round town. Folks are comin' just to watch you bowl. Don't let 'em down now."),
      ]);
    }

    // championship finale (once, when the season ends)
    if (L && L.done && flags.beats.indexOf('end') < 0) {
      flags.beats.push('end');
      const champ = L.rank() === 1;
      scenes.push(champ ? [
        line('gus', "...We did it. Champions. First trophy this place has seen in twenty years."),
        line('rosa', "The bank called. They're backing off — Strike Valley's a landmark again! 🏆"),
        line('gus', "You saved this old barn, kid. Couldn'ta done it without ya. Here's to next season."),
      ] : [
        line('gus', "Came up short. Stings, I won't lie."),
        line('rosa', "But look around — this place is ALIVE again. That's because of you."),
        line('gus', "We regroup. New season, new shot. I'm not done fighting for this place, and neither are you."),
      ]);
    }

    save();
    if (!scenes.length) { if (onDone) onDone(); return false; }
    playSeq(scenes, onDone);
    return true;
  }

  function reset() { flags = { introSeen: false, beats: [], reactWeek: 0 }; save(); }
  // keep the intro seen, but let a fresh season replay its midseason/finale beats
  function newSeason() { load(); flags.beats = []; flags.reactWeek = 0; save(); }

  function init() {
    ensureOverlay();
    window.addEventListener('keydown', (e) => {
      if (el && !el.classList.contains('hidden') && (e.key === ' ' || e.key === 'Enter')) { advance(); e.preventDefault(); }
    });
  }

  return { init, onHubLoad, rivalBanter, reset, newSeason, CAST, TEAM_RIVAL };
})();
if (typeof window !== 'undefined') window.Story = Story;
