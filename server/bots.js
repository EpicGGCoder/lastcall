/* ============================================================================
   LAST CALL — bot seats
   ----------------------------------------------------------------------------
   Bots exist for two reasons:
     1. A room with one human in it should still be a game, not a waiting room.
     2. An empty chair at a 4-player table is a dead evening.

   They are deliberately NOT optimal. A bot that plays perfectly is a bot that
   is boring, and worse, a bot that makes the human feel stupid. These bots:
       - play the odds, but miscalculate under pressure
       - occasionally do something flamboyantly dumb
       - have a tell: they telegraph a sawed-off by hesitating
   ========================================================================== */
'use strict';

const G = require('./game');

/* Personality weights. `nerve` is how willing they are to shoot themselves on
   bad odds; `greed` is how fast they spend items; `sloppy` is error rate. */
const PERSONAS = {
  reckless: { nerve: 0.30, greed: 0.85, sloppy: 0.18, label: 'reckless' },
  careful:  { nerve: 0.62, greed: 0.45, sloppy: 0.08, label: 'careful' },
  gremlin:  { nerve: 0.45, greed: 0.95, sloppy: 0.30, label: 'gremlin' },
  quiet:    { nerve: 0.52, greed: 0.30, sloppy: 0.10, label: 'quiet' }
};

function personaFor(seed) {
  const keys = Object.keys(PERSONAS);
  return keys[Math.abs(Math.floor(seed)) % keys.length];
}

/* Does this player know what is in the chamber right now? */
function knownShell(game, id) {
  const peek = game.peek[id];
  if (!peek) return null;
  if (peek.index !== game.mag.idx) return null;      // stale — the magazine moved on
  return peek.shell;
}

/* Best target: healthy first, then the one holding the most items. */
function threatScore(p) {
  return p.hp * 10 + p.items.length * 3 + (p.sawed ? 4 : 0) + (p.cuffed ? -6 : 0);
}

function pickTarget(me, others) {
  return others.slice().sort((a, b) => threatScore(b) - threatScore(a))[0];
}

/* ---------------------------------------------------------------------------
   chooseAction — returns { action, reason }
   ------------------------------------------------------------------------- */
function chooseAction(game, id, rng, persona) {
  const me = G.byId(game, id);
  const others = G.alive(game).filter((p) => p.id !== id);
  const P = PERSONAS[persona] || PERSONAS.careful;
  const mag = game.mag;
  const left = mag.seq.length - mag.idx;
  const liveLeft = mag.seq.slice(mag.idx).filter((s) => s === 'live').length;
  const blankLeft = left - liveLeft;
  const pLive = left > 0 ? liveLeft / left : 0;
  const target = pickTarget(me, others);
  const has = (it) => me.items.includes(it);

  // Alive-and-well bots do not use items when the magazine is spent; they
  // would be thrown away by the reload.
  const magHasShells = left > 0;

  // --- 1. Emergency healing. Always correct, never clever.
  if (has('puff') && me.hp < me.maxHp && rng() < 0.55 + P.greed * 0.4) {
    return { action: { type: 'item', item: 'puff' }, reason: 'bandage' };
  }

  // --- 2. Look at the shell if we do not already know it.
  const known = knownShell(game, id);
  if (has('glasses') && known === null && magHasShells && rng() < 0.65 + P.greed * 0.3) {
    return { action: { type: 'item', item: 'glasses' }, reason: 'peek' };
  }

  if (!magHasShells) {
    // Dead magazine: only non-wasteful items, then hand over.
    return { action: { type: 'shoot', target: target ? target.id : id }, reason: 'empty-mag' };
  }

  // --- 3. We KNOW what is in the chamber. This is where bots look smart.
  if (known === 'blank') {
    // Free turn. Saw up first if we are greedy, then shoot ourselves.
    if (has('saw') && rng() < 0.25) return { action: { type: 'item', item: 'saw' }, reason: 'saw-cocky' };
    if (has('refund') && rng() < 0.35 * P.greed) {
      // Flip the blank into a live and fire it at somebody. Nasty and correct.
      return { action: { type: 'item', item: 'refund' }, reason: 'flip-attack' };
    }
    return { action: { type: 'shoot', target: id }, reason: 'known-blank' };
  }

  if (known === 'live') {
    if (has('saw') && target && !me.sawed && rng() < 0.8) {
      return { action: { type: 'item', item: 'saw' }, reason: 'saw-live' };
    }
    if (has('ties') && target && !target.cuffed && rng() < 0.5) {
      return { action: { type: 'item', item: 'ties', target: target.id }, reason: 'tie-then-shoot' };
    }
    if (target) return { action: { type: 'shoot', target: target.id }, reason: 'known-live' };
  }

  // --- 4. Phone intel: if the phone says a live round is coming soon we might gamble.
  const phone = game.phone[id];

  // --- 5. No intel. Play the odds, badly.
  if (has('burner') && rng() < 0.5 * P.greed && left > 1) {
    return { action: { type: 'item', item: 'burner' }, reason: 'call' };
  }

  if (has('sticky') && target && target.items.length && me.items.length < G.HAND_LIMIT && rng() < 0.6 * P.greed) {
    return { action: { type: 'item', item: 'sticky', target: target.id }, reason: 'steal' };
  }

  if (has('pill') && me.hp <= 1 && rng() < 0.5) {
    // Last-ditch. At one life the pill is strictly a coin flip in your favour.
    return { action: { type: 'item', item: 'pill' }, reason: 'desperate' };
  }

  if (has('brew') && pLive > 0.6 && left > 1 && rng() < 0.4 * P.greed) {
    // Bad odds coming: dump the top shell rather than eat it.
    return { action: { type: 'item', item: 'brew' }, reason: 'dump' };
  }

  if (has('ties') && target && !target.cuffed && rng() < 0.35 * P.greed && others.length > 1) {
    return { action: { type: 'item', item: 'ties', target: target.id }, reason: 'tie-passive' };
  }

  // --- 6. The actual gamble.
  let nerve = P.nerve;
  // Sawed-off makes a self-shot much worse; be careful.
  if (me.sawed) nerve -= 0.25;
  // Low health makes dying cheap, so take the risk.
  if (me.hp <= 1) nerve -= 0.12;
  // If blanks are plentiful, self-shooting is free tempo.
  nerve += (blankLeft / Math.max(1, left) - 0.5) * 0.5;
  nerve = Math.max(0.05, Math.min(0.95, nerve));

  // Bots misread the room sometimes. That is the sloppy term.
  const misread = rng() < P.sloppy ? 0.22 * (rng() < 0.5 ? -1 : 1) : 0;
  nerve = Math.max(0.02, Math.min(0.98, nerve + misread));

  const guessSelf = rng() < nerve;
  if (guessSelf || !target) {
    return { action: { type: 'shoot', target: id }, reason: guessSelf ? 'nerve' : 'no-target' };
  }
  return { action: { type: 'shoot', target: target.id }, reason: 'aggression' };
}

/* How long a bot "thinks". Long enough to read as deliberation, short enough
   that nobody is waiting on a machine. Bots also take longer when they are
   about to do something dramatic, which is an accidental tell that players
   learn to read — and that is delightful. */
function thinkMs(reason, rng) {
  const base = { 'saw-live': 1500, 'saw-cocky': 1400, 'flip-attack': 1700, 'known-live': 1200, 'tie-then-shoot': 1000 };
  const b = base[reason] || 700;
  return Math.round(b + rng() * 900);
}

/* Which item would this bot rather have? Used only for flavour on the deal. */
module.exports = { chooseAction, thinkMs, personaFor, PERSONAS, knownShell };
