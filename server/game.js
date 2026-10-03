/* ============================================================================
   LAST CALL — game logic (pure)
   ----------------------------------------------------------------------------
   No sockets, no timers, no I/O. Everything here takes a game object, mutates
   it, and returns a list of EVENTS that the client turns into explosions.
   The RNG is injected so the whole thing is deterministically testable.

   The golden rule of this file: the server is the only thing that knows the
   shell order. Clients are told the COUNT of live vs blank and nothing else,
   until an item forces a reveal.
   ========================================================================== */
'use strict';

/* ---------------------------------------------------------------------------
   ITEMS
   ---------------------------------------------------------------------------
   Two design rules keep these from becoming noise:
     1. Using an item does NOT end your turn. Items are tempo, not actions.
     2. Hand limit is four. So every pickup is a real trade-off.
   ------------------------------------------------------------------------- */
const ITEMS = {
  puff: {
    name: 'Just One Puff', short: 'Puff', icon: 'puff', kind: 'instant',
    blurb: 'One life back. For the health-conscious.'
  },
  glasses: {
    name: 'Reading Glasses', short: 'Glasses', icon: 'glasses', kind: 'instant',
    blurb: 'Look at the shell in the chamber.'
  },
  brew: {
    name: 'Liquid Courage', short: 'Courage', icon: 'brew', kind: 'instant',
    blurb: 'The chambered shell falls out, unspent. Everyone sees what it was.'
  },
  saw: {
    name: 'Handsaw', short: 'Saw', icon: 'saw', kind: 'buff',
    blurb: 'Your next shot deals 2. Not cleaned between uses.'
  },
  ties: {
    name: 'Zip Ties', short: 'Ties', icon: 'ties', kind: 'target',
    blurb: 'Someone misses their next turn.'
  },
  refund: {
    name: 'Petty Refund', short: 'Refund', icon: 'refund', kind: 'instant',
    blurb: 'Flip the chambered shell. Live becomes blank. Blank becomes live.'
  },
  pill: {
    name: 'Mystery Pill', short: 'Pill', icon: 'pill', kind: 'instant',
    blurb: 'Fifty-fifty: two lives back, or one gone. Expiry illegible.'
  },
  burner: {
    name: 'Burner Phone', short: 'Phone', icon: 'burner', kind: 'instant',
    blurb: 'A stranger tells you one future shell.'
  },
  sticky: {
    name: 'Sticky Fingers', short: 'Sticky', icon: 'sticky', kind: 'target',
    blurb: 'Take a random item off somebody else.'
  }
};

const ITEM_IDS = Object.keys(ITEMS);
const HAND_LIMIT = 4;
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

/* ---------------------------------------------------------------------------
   Setup
   ------------------------------------------------------------------------- */
function magazineSize(playerCount) {
  return Math.min(10, 4 + playerCount);            // 2p -> 6, 6p -> 10
}

function startingLives(playerCount) {
  return playerCount >= 5 ? 2 : 3;                 // big tables need to be quick
}

function itemsPerRound(round) {
  return round === 1 ? 2 : round === 2 ? 3 : 4;
}

function makeMagazine(playerCount, rng) {
  const size = magazineSize(playerCount);
  const min = Math.max(1, Math.ceil(size * 0.34));
  const max = Math.min(size - 1, Math.floor(size * 0.66));
  let live = min + Math.floor(rng() * (max - min + 1));
  live = Math.max(1, Math.min(size - 1, live));

  const seq = [];
  for (let i = 0; i < live; i++) seq.push('live');
  for (let i = 0; i < size - live; i++) seq.push('blank');
  // Fisher-Yates, from the injected RNG
  for (let i = seq.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = seq[i]; seq[i] = seq[j]; seq[j] = t;
  }
  return { seq, idx: 0, size, live, blank: size - live, ejected: [] };
}

function createGame(players, rng) {
  const game = {
    phase: 'lobby',                                 // lobby | turn | over
    round: 0,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || 'blob',
      colour: p.colour || '#ffd23f',
      isBot: !!p.isBot,
      bot: p.bot || null,
      hp: 1, maxHp: 1,
      alive: true,
      items: [],
      cuffed: false,
      sawed: false,
      stats: { shots: 0, selfShots: 0, damageDealt: 0, damageTaken: 0, kills: 0, itemsUsed: 0, survived: 0 }
    })),
    order: players.map((p) => p.id),
    turnIndex: 0,
    mag: null,
    peek: {},                                        // playerId -> shell ('live'|'blank')
    phone: {},                                       // playerId -> {index, shell}
    lastShot: null,
    winnerId: null,
    startedAt: 0,
    turnCount: 0
  };
  return game;
}

function alive(game) { return game.players.filter((p) => p.alive); }
function byId(game, id) { return game.players.find((p) => p.id === id) || null; }
function current(game) { return byId(game, game.order[game.turnIndex]); }

function startGame(game, rng) {
  const lives = startingLives(game.players.length);
  game.players.forEach((p) => { p.hp = lives; p.maxHp = lives; p.alive = true; p.items = []; });
  game.winnerId = null;
  game.round = 1;
  game.phase = 'turn';
  game.turnIndex = 0;
  game.startedAt = Date.now();
  game.peek = {}; game.phone = {};
  const events = [{ type: 'start', lives }];
  loadMagazine(game, rng, events);
  dealItems(game, rng, events);
  events.push({ type: 'turn', who: current(game).id });
  return events;
}

function loadMagazine(game, rng, events) {
  game.mag = makeMagazine(alive(game).length, rng);
  game.peek = {};
  game.phone = {};
  events.push({ type: 'reload', live: game.mag.live, blank: game.mag.blank, size: game.mag.size, round: game.round });
}

function dealItems(game, rng, events) {
  const n = itemsPerRound(game.round);
  alive(game).forEach((p) => {
    for (let i = 0; i < n; i++) {
      if (p.items.length >= HAND_LIMIT) break;
      p.items.push(ITEM_IDS[Math.floor(rng() * ITEM_IDS.length)]);
    }
  });
  events.push({ type: 'deal', count: n });
}

function shellAt(game, index) {
  if (!game.mag || index >= game.mag.seq.length) return null;
  return game.mag.seq[index];
}

function nextAliveIndex(game, from) {
  const n = game.order.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    const p = byId(game, game.order[i]);
    if (p && p.alive) return i;
  }
  return from;
}

/* Advance the turn. Returns events describing anything that happened on the
   way, e.g. somebody being skipped because they are zip-tied. */
function passTurn(game, events) {
  game.turnIndex = nextAliveIndex(game, game.turnIndex);
  game.turnCount++;
  const p = current(game);
  if (p.cuffed) {
    p.cuffed = false;
    events.push({ type: 'uncuff', who: p.id });
    events.push({ type: 'skip', who: p.id });
    game.turnIndex = nextAliveIndex(game, game.turnIndex);   // and keep going
    game.turnCount++;
  }
  events.push({ type: 'turn', who: current(game).id });
}

function checkOver(game, events, rng) {
  const living = alive(game);
  if (living.length <= 1) {
    game.phase = 'over';
    game.winnerId = living.length ? living[0].id : null;
    if (living.length) living[0].stats.survived = 1;
    events.push({ type: 'over', winner: game.winnerId });
    return true;
  }
  return false;
}

/* Reload when the magazine runs dry. Returns true if it reloaded. */
function maybeReload(game, rng, events) {
  if (game.mag.idx < game.mag.seq.length) return false;
  game.round++;
  events.push({ type: 'magEmpty' });
  loadMagazine(game, rng, events);
  dealItems(game, rng, events);
  return true;
}

/* ---------------------------------------------------------------------------
   Actions
   ---------------------------------------------------------------------------
   act(game, playerId, action, rng) -> { ok, error, events }
   ------------------------------------------------------------------------- */
function act(game, playerId, action, rng) {
  const events = [];
  const p = byId(game, playerId);
  if (!p) return fail('You are not at this table.');
  if (game.phase !== 'turn') return fail('Nothing is happening right now.');
  if (!p.alive) return fail('You are out. Enjoy the floor.');
  if (current(game).id !== playerId) return fail('Not your turn. Sit still.');
  if (!action || typeof action !== 'object') return fail('What?');

  if (action.type === 'shoot') return doShoot(game, p, action.target, rng, events);
  if (action.type === 'item') return doItem(game, p, action, rng, events);
  return fail('That is not a thing you can do.');
}

function fail(error) { return { ok: false, error, events: [] }; }

function doShoot(game, p, targetId, rng, events) {
  const target = byId(game, targetId);
  if (!target || !target.alive) return fail('That person is already on the floor.');

  const isSelf = target.id === p.id;
  const shell = shellAt(game, game.mag.idx);
  if (shell === null) return fail('The magazine is empty. That should not be possible.');

  game.mag.idx++;
  const damage = shell === 'live' ? (p.sawed ? 2 : 1) : 0;
  const sawWasSet = p.sawed;
  p.sawed = false;
  p.stats.shots++;
  if (isSelf) p.stats.selfShots++;

  if (damage > 0) {
    target.hp -= damage;
    target.stats.damageTaken += damage;
    p.stats.damageDealt += damage;
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      p.stats.kills++;
      events.push({ type: 'out', who: target.id, by: p.id });
    }
  }

  game.lastShot = { shooter: p.id, target: target.id, shell, damage, self: isSelf, at: Date.now() };
  events.push({
    type: 'shot', shooter: p.id, target: target.id, shell, damage,
    self: isSelf, saw: sawWasSet, killed: !target.alive, hp: target.hp
  });

  // A blank fired at yourself is the whole point: you keep the turn.
  const keepsTurn = isSelf && shell === 'blank';
  if (keepsTurn) {
    events.push({ type: 'keepsTurn', who: p.id });
  }

  if (checkOver(game, events, rng)) return { ok: true, events };
  maybeReload(game, rng, events);
  if (!keepsTurn) passTurn(game, events);
  else events.push({ type: 'turn', who: p.id });
  return { ok: true, events };
}

function doItem(game, p, action, rng, events) {
  const item = action.item;
  if (!ITEMS[item]) return fail('There is no such item.');
  const slot = p.items.indexOf(item);
  if (slot === -1) return fail('You do not have that.');
  if (game.mag.idx >= game.mag.seq.length) return fail('The magazine is empty.');

  const spec = ITEMS[item];
  let target = null;
  if (spec.kind === 'target') {
    target = byId(game, action.target);
    if (!target || !target.alive) return fail('Pick somebody who is still breathing.');
    if (target.id === p.id) return fail('You cannot do that to yourself.');
  }

  // Every branch below either succeeds and consumes the item, or returns fail
  // BEFORE consuming it. Validate first, spend second.
  switch (item) {
    case 'puff': {
      if (p.hp >= p.maxHp) return fail('You are already at full health. Sadly.');
      p.items.splice(slot, 1);
      p.hp = Math.min(p.maxHp, p.hp + 1);
      events.push({ type: 'item', who: p.id, item, detail: { hp: p.hp } });
      break;
    }
    case 'glasses': {
      p.items.splice(slot, 1);
      const shell = shellAt(game, game.mag.idx);
      game.peek[p.id] = { index: game.mag.idx, shell };
      events.push({ type: 'item', who: p.id, item });
      events.push({ type: 'peek', who: p.id, index: game.mag.idx, shell, private: true });
      break;
    }
    case 'brew': {
      p.items.splice(slot, 1);
      const shell = shellAt(game, game.mag.idx);
      game.mag.idx++;
      game.mag.ejected.push(shell);
      delete game.peek[p.id];
      events.push({ type: 'item', who: p.id, item });
      // Public on purpose — that is the tension of the beer.
      events.push({ type: 'eject', who: p.id, shell, remaining: game.mag.seq.length - game.mag.idx });
      maybeReload(game, rng, events);
      break;
    }
    case 'saw': {
      if (p.sawed) return fail('It is already sawed.');
      p.items.splice(slot, 1);
      p.sawed = true;
      events.push({ type: 'item', who: p.id, item });
      break;
    }
    case 'ties': {
      if (target.cuffed) return fail('They are already tied up.');
      p.items.splice(slot, 1);
      target.cuffed = true;
      events.push({ type: 'item', who: p.id, item, target: target.id });
      events.push({ type: 'cuff', who: p.id, target: target.id });
      break;
    }
    case 'refund': {
      p.items.splice(slot, 1);
      const before = game.mag.seq[game.mag.idx];
      const after = before === 'live' ? 'blank' : 'live';
      game.mag.seq[game.mag.idx] = after;
      if (after === 'live') { game.mag.live++; game.mag.blank--; }
      else { game.mag.live--; game.mag.blank++; }
      if (game.peek[p.id]) delete game.peek[p.id];
      events.push({ type: 'item', who: p.id, item });
      events.push({ type: 'flip', who: p.id, live: game.mag.live, blank: game.mag.blank });
      break;
    }
    case 'pill': {
      p.items.splice(slot, 1);
      const good = rng() < 0.5;
      if (good) {
        p.maxHp = Math.max(p.maxHp, p.hp + 2);   // the pill can push you above your usual ceiling
        p.hp = p.hp + 2;
      } else {
        p.hp -= 1;
        if (p.hp <= 0) { p.hp = 0; p.alive = false; }
      }
      events.push({ type: 'item', who: p.id, item, detail: { good, hp: p.hp } });
      if (!p.alive) events.push({ type: 'out', who: p.id, by: p.id, self: true });
      break;
    }
    case 'burner': {
      const remaining = [];
      for (let i = game.mag.idx + 1; i < game.mag.seq.length; i++) remaining.push(i);
      if (!remaining.length) return fail('Nobody is going to call you back. The magazine ends here.');
      p.items.splice(slot, 1);
      const index = remaining[Math.floor(rng() * remaining.length)];
      const shell = game.mag.seq[index];
      game.phone[p.id] = { index, shell };
      events.push({ type: 'item', who: p.id, item });
      events.push({ type: 'phone', who: p.id, index, shellFrom: game.mag.idx, shell, private: true });
      break;
    }
    case 'sticky': {
      if (target.items.length === 0) return fail('Their pockets are empty.');
      // No full-hand check here: sticky frees its own slot before it takes,
      // so the swap can never overflow the hand.
      p.items.splice(slot, 1);
      const takeIdx = Math.floor(rng() * target.items.length);
      const stolen = target.items.splice(takeIdx, 1)[0];
      p.items.push(stolen);
      events.push({ type: 'item', who: p.id, item });
      events.push({ type: 'steal', who: p.id, target: target.id, stolen });
      break;
    }
    default:
      return fail('That item is not wired up.');
  }

  p.stats.itemsUsed++;
  if (checkOver(game, events, rng)) return { ok: true, events };

  // The Mystery Pill is the one item that can kill the person holding it. If
  // the current player is now face-down on the felt, the turn has to move on —
  // otherwise the pointer is left on a corpse and the game deadlocks waiting
  // for a dead person to act.
  if (!p.alive) {
    maybeReload(game, rng, events);
    passTurn(game, events);
  }
  return { ok: true, events };
}

/* ---------------------------------------------------------------------------
   Views
   ---------------------------------------------------------------------------
   publicView() is everything the table can see. `privateFor` layers on the
   things only one player is allowed to know.
   ------------------------------------------------------------------------- */
function publicView(game) {
  return {
    phase: game.phase,
    round: game.round,
    turnId: game.phase === 'turn' ? game.order[game.turnIndex] : null,
    order: game.order,
    winnerId: game.winnerId,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      colour: p.colour,
      isBot: p.isBot,
      hp: p.hp,
      maxHp: p.maxHp,
      alive: p.alive,
      items: p.items,
      cuffed: p.cuffed,
      sawed: p.sawed,
      connected: p.connected !== false,
      stats: p.stats
    })),
    mag: game.mag ? {
      live: game.mag.live,
      blank: game.mag.blank,
      size: game.mag.size,
      remaining: game.mag.seq.length - game.mag.idx,
      spent: game.mag.idx,
      ejected: game.mag.ejected
    } : null,
    lastShot: game.lastShot
  };
}

function privateFor(game, playerId) {
  const out = {};
  if (game.peek[playerId]) out.peek = game.peek[playerId];
  if (game.phone[playerId]) out.phone = game.phone[playerId];
  if (game.mag) {
    // The odds you are allowed to compute yourself.
    const left = game.mag.seq.slice(game.mag.idx);
    out.remainingLive = left.filter((s) => s === 'live').length;
    out.remainingBlank = left.filter((s) => s === 'blank').length;
  }
  return out;
}

module.exports = {
  ITEMS, ITEM_IDS, HAND_LIMIT, MAX_PLAYERS, MIN_PLAYERS,
  magazineSize, startingLives, itemsPerRound, makeMagazine,
  createGame, startGame, act, publicView, privateFor,
  alive, byId, current, loadMagazine, dealItems, shellAt
};
