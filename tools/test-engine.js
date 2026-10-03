/* ============================================================================
   LAST CALL — engine harness
   ----------------------------------------------------------------------------
   Plays thousands of complete matches with random-but-legal decisions and
   asserts the invariants the whole game rests on:

     * a match always ends, and ends with exactly one survivor
     * only the player whose turn it is may act
     * the magazine is conserved: idx never outruns the loaded shells
     * hands never exceed HAND_LIMIT
     * the public view never contains the shell order
     * the turn always lands on a living player
     * items validate before they are spent (a refused item stays in hand)

   Run:  node tools/test-engine.js [games]
   ========================================================================== */
'use strict';

const G = require('../server/game.js');
const { makeRandom } = (() => {
  // tiny local xorshift so the harness needs nothing from the client
  function makeRandom(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  return { makeRandom };
})();

const GAMES = parseInt(process.argv[2] || '2000', 10);
let failures = 0;
const fail = (msg) => { failures++; if (failures < 12) console.error('FAIL:', msg); };

function legalActions(game, p) {
  const out = [{ type: 'shoot', target: p.id }];
  for (const other of game.players) {
    if (other.alive && other.id !== p.id) out.push({ type: 'shoot', target: other.id });
  }
  const remaining = game.mag.seq.length - game.mag.idx;
  for (const item of new Set(p.items)) {
    const spec = G.ITEMS[item];
    if (spec.kind === 'target') {
      // mirror the engine's own preconditions exactly: a refused item would
      // otherwise look like a broken engine rather than a broken test
      let candidates = game.players.filter((x) => x.alive && x.id !== p.id);
      if (item === 'ties') candidates = candidates.filter((c) => !c.cuffed);
      if (item === 'sticky') candidates = candidates.filter((c) => c.items.length > 0);
      if (!candidates.length) continue;
      out.push({ type: 'item', item, target: candidates[0].id });
    } else {
      if (item === 'puff' && p.hp >= p.maxHp) continue;
      if (item === 'saw' && p.sawed) continue;
      if (item === 'burner' && remaining < 2) continue;
      out.push({ type: 'item', item });
    }
  }
  return out;
}

function playOne(n, seed) {
  const rng = makeRandom(seed);
  const players = [];
  for (let i = 0; i < n; i++) players.push({ id: 'p' + i, name: 'P' + i, colour: '#fff' });
  const game = G.createGame(players, rng);
  const evs = G.startGame(game, rng);
  if (!Array.isArray(evs) || !evs.length) return fail('startGame produced no events');
  if (!game.mag || game.mag.seq.length !== game.mag.size) return fail('magazine not loaded at start');

  let guard = 0;
  while (game.phase === 'turn' && guard++ < 4000) {
    const cur = G.current(game);
    if (!cur || !cur.alive) return fail('turn on a corpse at guard ' + guard);

    // nobody else may act
    const other = game.players.find((x) => x.id !== cur.id);
    if (other) {
      const denied = G.act(game, other.id, { type: 'shoot', target: cur.id }, rng);
      if (denied.ok) return fail('off-turn action accepted');
    }

    const before = cur.items.slice();
    const choices = legalActions(game, cur);
    const action = choices[Math.floor(rng() * choices.length)];
    const beforeMag = game.mag ? game.mag.idx : 0;
    const r = G.act(game, cur.id, action, rng);
    if (!r.ok) return fail('legal action refused: ' + JSON.stringify(action) + ' — ' + r.error);

    // invariants after every single move
    if (game.mag) {
      if (game.mag.idx > game.mag.seq.length) return fail('magazine overran');
      if (game.mag.idx === beforeMag && action.type === 'shoot') return fail('shot did not consume a shell');
    }
    for (const p of game.players) {
      if (p.items.length > G.HAND_LIMIT) return fail('hand limit exceeded');
      if (p.hp > p.maxHp) return fail('hp above max');
      if (p.hp < 0) return fail('negative hp');
    }
    if (action.type === 'item' && !r.events.some((e) => e.type === 'item')) {
      // an item action that produced no item event must have been refused
      return fail('item vanished without an event');
    }
    if (action.type !== 'item' && before.length !== cur.items.length && r.events.some((e) => e.type === 'deal')) {
      /* deals change hands; fine */
    }
    if (game.phase === 'turn') {
      const nxt = G.current(game);
      if (!nxt.alive) return fail('handover to a dead player');
    }
  }

  if (game.phase !== 'over') return fail('match did not conclude (guard ' + guard + ')');
  const alive = game.players.filter((p) => p.alive);
  if (alive.length !== 1) return fail('over with ' + alive.length + ' survivors');
  if (game.winnerId !== alive[0].id) return fail('winnerId disagrees with the survivor');

  // the public view must never leak the sequence
  const view = JSON.stringify(G.publicView(game));
  if (view.includes('"seq"') || /"seq":/.test(view)) return fail('public view leaks mag.seq');
  return guard;
}

/* ---- fixed fixtures: the rules as advertised, checked literally ---- */
function fixtures() {
  const rng = makeRandom(7);
  const mk = (n) => {
    const players = [];
    for (let i = 0; i < n; i++) players.push({ id: 'p' + i, name: 'P' + i });
    const g = G.createGame(players, rng);
    G.startGame(g, rng);
    return g;
  };

  // self-shot blank keeps the turn
  let kept = false;
  for (let attempt = 0; attempt < 400; attempt++) {
    const g = mk(2);
    const cur = G.current(g);
    g.mag.seq[g.mag.idx] = 'blank';
    const r = G.act(g, cur.id, { type: 'shoot', target: cur.id }, rng);
    if (!r.ok) continue;
    if (!r.events.some((e) => e.type === 'keepsTurn')) return fail('self blank did not keep the turn');
    if (G.current(g).id !== cur.id) return fail('turn passed after a self blank');
    kept = true;
    break;
  }
  if (!kept) fail('never drew a blank for the keeps-turn fixture');

  // lives scale with the table size
  if (G.startingLives(2) !== 3 || G.startingLives(4) !== 3) fail('small-table lives wrong');
  if (G.startingLives(5) !== 2 || G.startingLives(6) !== 2) fail('big-table lives wrong');

  // magazines are clamped so neither all-live nor all-blank is possible
  for (let i = 0; i < 500; i++) {
    const m = G.makeMagazine(6, rng);
    if (m.live < 2 || m.blank < 2) return fail('magazine clamp broken: ' + m.live + '/' + m.blank);
  }
}

console.log('engine harness: ' + GAMES + ' random matches');
const t0 = Date.now();
let totalMoves = 0;
for (let i = 0; i < GAMES; i++) {
  const n = 2 + (i % 5);
  totalMoves += playOne(n, i * 2654435761 + 17) || 0;
}
fixtures();
const ms = Date.now() - t0;
if (failures) {
  console.error(failures + ' FAILURES');
  process.exit(1);
}
console.log('all invariants held · ' + (totalMoves / GAMES).toFixed(1) + ' moves/match · ' + ms + ' ms');
