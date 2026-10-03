/* ============================================================================
   LAST CALL — rooms, seats, and the passage of time
   ----------------------------------------------------------------------------
   One room = one table. A room owns a game, a seating chart, a chat log, and
   the timers that stop a party game from dying because one person went to get
   a drink.

   Design commitments encoded here:
     - Reconnect. Phones lock, browsers reload, wifi blinks. A player who drops
       keeps their seat and their health and can walk back in with a token.
     - Eliminated players stay. They keep chat and reactions. Watching your
       friends get shot is the retention feature.
     - Nobody waits forever. Every turn has a clock, and the clock is the
       dealer, and the dealer is not patient.
     - Pressing Start alone fills the table with bots. The alternative is a
       person staring at an empty lobby deciding to do something else.
   ========================================================================== */
'use strict';

const G = require('./game');
const Bots = require('./bots');
const { makeDealer, BOT_NAMES, BOT_AVATARS } = require('./lines');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I, O, 0, 1
const COLOURS = ['#ffd23f', '#ff5d73', '#4ecdc4', '#a78bfa', '#ff9f1c', '#7bd389'];
const AVATARS = ['fedora', 'shades', 'moustache', 'cigarette', 'moth', 'cat', 'skull', 'cactus', 'toucan', 'toaster'];

const TURN_CHOICES = [30, 45, 75, 120, 0];   // 0 = the dealer waits forever
const SETTLE_MS = 1500;                       // breathing room between moves
const EMPTY_ROOM_TTL = 1000 * 60 * 30;        // an abandoned table clears itself
const LOBBY_TTL = 1000 * 60 * 90;

let rngState = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
function rng() {
  // xorshift32 — deterministic given a seed, and we log the seed in the
  // room so a game can be replayed if anyone ever disputes a shot.
  rngState ^= rngState << 13; rngState >>>= 0;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;  rngState >>>= 0;
  return rngState / 0x100000000;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

function makeId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

class Room {
  constructor(code, hub) {
    this.code = code;
    this.hub = hub;
    this.players = [];
    this.game = null;
    this.dealer = makeDealer(rng);
    this.chat = [];
    this.hostId = null;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.settings = { turnSeconds: 75 };
    this.timers = {};
    this.reactionLog = [];
    this.dealerLine = null;   // last narration, for late joiners
    this.botNamePool = shuffle(BOT_NAMES.slice());
    this.botAvatarPool = shuffle(BOT_AVATARS.slice());
  }

  /* ---------------------------------------------------------------- seating */
  freeColour() {
    const used = new Set(this.players.map((p) => p.colour));
    return COLOURS.find((c) => !used.has(c)) || COLOURS[this.players.length % COLOURS.length];
  }

  addPlayer(opts) {
    const isBot = !!opts.isBot;
    const p = {
      id: makeId(isBot ? 'bot' : 'ply'),
      token: makeId('tk'),
      name: (opts.name || 'Someone').slice(0, 16).trim() || 'Someone',
      avatar: AVATARS.includes(opts.avatar) ? opts.avatar : choices(AVATARS, this.players.length),
      colour: this.freeColour(),
      isBot,
      persona: isBot ? Bots.personaFor(Math.floor(rng() * 4)) : null,
      ws: null,
      connected: !isBot,
      joinedAt: Date.now(),
      lastSeen: Date.now()
    };
    this.players.push(p);
    if (!this.hostId && !isBot) this.hostId = p.id;
    // Someone left the lobby by joining; if we were mid-game we must not
    // silently add a spectator into the shooting order.
    return p;
  }

  addBot() {
    const name = this.botNamePool.length ? this.botNamePool.shift() : 'Bot ' + (this.players.length + 1);
    const avatar = this.botAvatarPool.length ? this.botAvatarPool.shift() : choices(AVATARS, this.players.length + 7);
    return this.addPlayer({ isBot: true, name, avatar });
  }

  removePlayer(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i === -1) return null;
    const [p] = this.players.splice(i, 1);
    if (this.hostId === id) {
      const nextHuman = this.players.find((x) => !x.isBot);
      this.hostId = nextHuman ? nextHuman.id : null;
    }
    if (this.game) {
      // Mid-match departure: the seat is abandoned, not resurrected. If they
      // were alive we take them out of the game the only way this game knows.
      const gp = G.byId(this.game, id);
      if (gp && gp.alive) {
        gp.alive = false;
        gp.hp = 0;
        this.pushChat({ system: true, text: p.name + ' left the table. The dealer removed them.' });
        this.checkGameOver();
        if (this.game.phase === 'turn' && G.current(this.game) && !G.current(this.game).alive) this.advance();
        else this.scheduleTick();
      }
    }
    return p;
  }

  humans() { return this.players.filter((p) => !p.isBot); }
  seated() { return this.players; }
  playerById(id) { return this.players.find((p) => p.id === id) || null; }
  host() { return this.playerById(this.hostId); }

  /* --------------------------------------------------------------- messaging */
  send(player, msg) {
    if (!player || !player.ws || player.ws.readyState !== 'open') return false;
    return player.ws.send(msg);
  }
  broadcast(msg, exceptId) {
    let n = 0;
    for (const p of this.players) {
      if (p.isBot || p.id === exceptId) continue;
      if (this.send(p, msg)) n++;
    }
    return n;
  }
  broadcastRaw(text, exceptId) {
    let n = 0;
    for (const p of this.players) {
      if (p.isBot || p.id === exceptId) continue;
      if (p.ws && p.ws.readyState === 'open' && p.ws.send(text)) n++;
    }
    return n;
  }

  pushChat(entry) {
    const e = Object.assign({ ts: Date.now() }, entry);
    this.chat.push(e);
    if (this.chat.length > 60) this.chat.splice(0, this.chat.length - 60);
    this.broadcast({ t: 'chat', entry: e });
    return e;
  }

  /* ------------------------------------------------------------------ state */
  roomView() {
    const game = this.game;
    const view = game ? G.publicView(game) : { phase: 'lobby', round: 0, players: [], order: [], mag: null, turnId: null };
    return {
      code: this.code,
      hostId: this.hostId,
      settings: this.settings,
      players: view.players.length ? view.players : this.players.map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar, colour: p.colour,
        isBot: p.isBot, hp: 1, maxHp: 1, alive: true, items: [],
        cuffed: false, sawed: false, connected: p.connected, stats: null
      })),
      order: view.order,
      turnId: view.turnId,
      phase: view.phase,
      round: view.round,
      winnerId: view.winnerId,
      mag: view.mag,
      lastShot: view.lastShot,
      chat: this.chat.slice(-40),
      reactionLog: this.reactionLog.slice(-12),
      dealer: this.dealerLine,
      seated: this.players.length,
      humans: this.humans().length,
      bots: this.players.filter((p) => p.isBot).length,
      canStart: this.players.length >= G.MIN_PLAYERS && view.phase !== 'turn',
      turnDeadline: game ? (game.turnDeadline || 0) : 0,
      serverNow: Date.now()
    };
  }

  pushRoom() {
    // Lobby updates are small and can be sent to everyone as-is.
    this.broadcast({ t: 'room', room: this.roomView() });
  }

  /* The turn deadline changes a beat after the state that caused it, so it
     travels on its own five-byte message rather than bloating every broadcast. */
  pushClock() {
    if (!this.game) return;
    this.broadcast({ t: 'clock', turnDeadline: this.game.turnDeadline || 0, turnId: this.game.phase === 'turn' ? G.current(this.game) && G.current(this.game).id : null });
  }

  /* ------------------------------------------------------------------ flow */
  startGame(byId) {
    if (this.game && this.game.phase === 'turn') return { ok: false, error: 'Already underway.' };
    if (this.players.length < G.MIN_PLAYERS) return { ok: false, error: 'You need at least two people.' };

    // Starting alone? Fill the table. The alternative is an empty lobby and a
    // person who closes the tab.
    if (this.humans().length === 1 && this.players.filter((p) => p.isBot).length < 2) {
      while (this.players.length < 3) this.addBot();
      this.pushChat({ system: true, text: 'The house sat some regulars down with you. They are not friendly.' });
    }

    const seats = this.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, colour: p.colour, isBot: p.isBot, bot: p.persona }));
    this.game = G.createGame(seats, rng);
    this.game.seedNote = 'room ' + this.code;

    const events = G.startGame(this.game, rng);
    this.dealerLine = this.dealer('start');
    this.pushChat({ system: true, text: this.dealerLine });
    this.emitState(events, true);
    this.scheduleTick();
    return { ok: true };
  }

  rematch() {
    this.game = null;
    this.dealerLine = null;
    this.reactionLog = [];
    this.pushChat({ system: true, text: 'New game. Same bad ideas. Say when.' });
    this.pushRoom();
    return { ok: true };
  }

  /* Apply an action, then tell everyone. */
  handleAction(playerId, action) {
    if (!this.game || this.game.phase !== 'turn') return { ok: false, error: 'Nothing to do right now.' };
    const res = G.act(this.game, playerId, action, rng);
    if (!res.ok) return res;
    this.lastActivity = Date.now();
    this.clearTimer('turn');
    const events = res.events.slice();
    this.emitState(events, false, playerId);
    this.checkGameOver();
    this.scheduleTick();
    return res;
  }

  checkGameOver() {
    if (!this.game || this.game.phase !== 'over' || this.overAnnounced) return;
    this.overAnnounced = true;
    this.clearTimer('turn'); this.clearTimer('bot');
    const winner = G.byId(this.game, this.game.winnerId);
    this.dealerLine = this.dealer('over');
    this.pushChat({ system: true, text: this.dealerLine + (winner ? ' ' + winner.name + ' walks out upright.' : '') });
    this.broadcast({ t: 'gameover', winnerId: this.game.winnerId });
  }

  /* Animation-aware broadcast.
     `events` are the beats the client should play in order. The authoritative
     `view` ships in the same message; the CLIENT delays applying the view until
     its animation queue drains, so a health bar never drops before the bang. */
  emitState(events, isStart, actorId) {
    if (!this.game) return;
    const view = G.publicView(this.game);
    const lines = [];
    for (const ev of events) {
      const line = narrate(this, ev);
      if (line) lines.push({ key: ev.type, text: line });
    }
    if (lines.length) this.dealerLine = lines[lines.length - 1].text;

    const base = {
      t: 'state',
      view: view,
      events: events,
      lines: lines,
      start: !!isStart,
      actor: actorId || null,
      dealerLine: this.dealerLine,
      serverNow: Date.now()
    };

    for (const p of this.players) {
      if (p.isBot || !p.ws || p.ws.readyState !== 'open') continue;
      const priv = G.privateFor(this.game, p.id);
      p.ws.send(JSON.stringify(Object.assign({}, base, { you: p.id, priv: priv })));
    }
  }

  /* Bot moves and turn clocks. One timer, always cancelled before re-set. */
  scheduleTick(delay) {
    this.clearTimer('bot');
    if (!this.game || this.game.phase !== 'turn') return;
    const cur = G.current(this.game);
    if (!cur) return;

    if (cur.isBot) {
      this.game.turnDeadline = 0;
      this.pushClock();
      const t = setTimeout(() => this.botMove(cur.id), delay != null ? delay : thinkFor(this.game, cur.id, rng));
      t.unref && t.unref();
      this.timers.bot = t;
      return;
    }

    // A human's clock. The dealer does not wait forever. The deadline is
    // published so every client can render the same countdown.
    this.clearTimer('turn');
    const secs = this.settings.turnSeconds;
    if (!secs) { this.game.turnDeadline = 0; this.pushClock(); return; }
    this.game.turnDeadline = Date.now() + secs * 1000;
    this.pushClock();
    const t = setTimeout(() => this.timeoutTurn(cur.id), secs * 1000);
    t.unref && t.unref();
    this.timers.turn = t;
  }

  botMove(botId) {
    if (!this.game || this.game.phase !== 'turn') return;
    const cur = G.current(this.game);
    if (!cur || cur.id !== botId || !cur.isBot) return;
    const pick = Bots.chooseAction(this.game, botId, rng, cur.bot);
    // A bot that freezes is worse than a bot that plays badly.
    if (!pick || !pick.action) return this.forceAction(botId);
    const res = G.act(this.game, botId, pick.action, rng);
    if (!res.ok) {
      // The plan went stale between thinking and acting. Just do something legal.
      return this.forceAction(botId);
    }
    this.emitState(res.events, false, botId);
    this.checkGameOver();
    this.scheduleTick(SETTLE_MS);
  }

  /* Fallback: always produces a legal move or ends the game. */
  forceAction(playerId) {
    if (!this.game || this.game.phase !== 'turn') return;
    const cur = G.current(this.game);
    if (!cur || cur.id !== playerId) return;
    const others = G.alive(this.game).filter((p) => p.id !== playerId);
    const target = others.length ? others[Math.floor(rng() * others.length)].id : playerId;
    const res = G.act(this.game, playerId, { type: 'shoot', target }, rng);
    if (res.ok) {
      this.emitState(res.events, false, playerId);
      this.checkGameOver();
    }
    this.scheduleTick(SETTLE_MS);
  }

  timeoutTurn(playerId) {
    const cur = this.game && this.game.phase === 'turn' ? G.current(this.game) : null;
    if (!cur || cur.id !== playerId) return;
    const others = G.alive(this.game).filter((p) => p.id !== playerId);
    const name = cur.name;
    if (!others.length) return this.forceAction(playerId);
    const target = others[Math.floor(rng() * others.length)];
    this.pushChat({ system: true, text: 'Time. The dealer takes ' + name + '\'s turn. He aims at ' + target.name + ' for no reason.' });
    const res = G.act(this.game, playerId, { type: 'shoot', target: target.id }, rng);
    if (res.ok) { this.emitState(res.events, false, playerId); this.checkGameOver(); }
    this.scheduleTick(SETTLE_MS);
  }

  advance() { this.scheduleTick(SETTLE_MS); }

  clearTimer(name) {
    if (this.timers[name]) { clearTimeout(this.timers[name]); delete this.timers[name]; }
    if (name === 'turn' && this.game) this.game.turnDeadline = 0;
  }
  clearAllTimers() { for (const k of Object.keys(this.timers)) this.clearTimer(k); }

  /* Advance the turn if it is somehow sitting on a dead player. Defensive —
     game.js should never do this, but a stuck table is unrecoverable. */
  unstick() {
    if (!this.game || this.game.phase !== 'turn') return;
    let guard = 0;
    while (guard++ < 12) {
      const cur = G.current(this.game);
      if (cur && cur.alive) break;
      this.game.turnIndex = (this.game.turnIndex + 1) % this.game.order.length;
    }
  }
}

/* ---------------------------------------------------------------------------
   Narration: turn one event into one line from the dealer
   ------------------------------------------------------------------------- */
function narrate(room, ev) {
  switch (ev.type) {
    case 'start': return room.dealer('welcome');
    case 'reload': return room.dealer('reload');
    case 'shot':
      if (ev.self && ev.shell === 'blank') return room.dealer('selfBlank');
      if (ev.self) return room.dealer('selfLive');
      return room.dealer(ev.shell === 'live' ? 'live' : 'blank');
    case 'out': return room.dealer('out');
    case 'item':
      if (ev.item === 'pill') return room.dealer(ev.detail && ev.detail.good ? 'pillGood' : 'pillBad');
      return room.dealer(ev.item);
    case 'eject': return room.dealer('brew');
    case 'cuff': return room.dealer('ties');
    case 'skip': return room.dealer('cuffSkip');
    case 'steal': return room.dealer('sticky');
    case 'peek': return room.dealer('glasses');
    case 'flip': return room.dealer('refund');
    case 'phone': return room.dealer('burner');
    case 'keepsTurn': return room.dealer('keeps');
    case 'over': return room.dealer('over');
    default: return null;
  }
}

function thinkFor(game, botId, r) {
  const cur = G.byId(game, botId);
  return Bots.thinkMs('default', r) + 250;
}

function choices(arr, i) { return arr[i % arr.length]; }

/* ===========================================================================
   HUB — every room the server knows about
   =========================================================================== */
class Hub {
  constructor() {
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 60000);
    this.sweeper.unref && this.sweeper.unref();
  }

  createRoom() {
    let code = null;
    for (let i = 0; i < 200; i++) {
      let c = '';
      for (let k = 0; k < 4; k++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) { code = c; break; }
    }
    if (!code) throw new Error('No room codes left. Impressive.');
    const room = new Room(code, this);
    this.rooms.set(code, room);
    return room;
  }

  get(code) { return this.rooms.get(String(code || '').toUpperCase().trim()) || null; }

  destroy(room) {
    room.clearAllTimers();
    for (const p of room.players) {
      if (p.ws && p.ws.readyState === 'open') p.ws.close(1001, 'table closed');
    }
    this.rooms.delete(room.code);
  }

  sweep() {
    const now = Date.now();
    for (const room of Array.from(this.rooms.values())) {
      const humans = room.players.filter((p) => !p.isBot);
      const live = humans.filter((p) => p.connected);
      if (live.length === 0) {
        const ttl = room.game && room.game.phase === 'turn' ? EMPTY_ROOM_TTL : LOBBY_TTL;
        if (now - room.lastActivity > ttl) {
          room.clearAllTimers();
          this.rooms.delete(room.code);
        }
      }
    }
  }

  stats() {
    let humans = 0, bots = 0, playing = 0;
    for (const r of this.rooms.values()) {
      humans += r.humans().length;
      bots += r.players.filter((p) => p.isBot).length;
      if (r.game && r.game.phase === 'turn') playing++;
    }
    return { rooms: this.rooms.size, humans, bots, playing };
  }
}

module.exports = { Hub, Room, AVATARS, COLOURS, TURN_CHOICES, rng, narrate, makeId };
