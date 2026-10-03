/* ============================================================================
   LAST CALL — server
   ----------------------------------------------------------------------------
   One command:   node server/index.js
   One port:      8787 (or $PORT)

   Serves the client as static files and speaks WebSocket on /ws. No framework,
   no build step, no node_modules. Everything in this repository is runnable
   with a stock Node install, which is the only way a game like this survives
   being opened by a friend six months from now.
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const WS = require('./ws');
const G = require('./game');
const { Hub, AVATARS, TURN_CHOICES, makeId } = require('./rooms');

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');
const CLIENT_DIR = path.join(ROOT, 'client');
const SINGLE_DIR = path.join(ROOT, 'single');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

const hub = new Hub();
const started = Date.now();

/* ---------------------------------------------------------------------------
   Static
   ------------------------------------------------------------------------- */
function sendFile(res, file, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { return notFound(res); }
    const ext = path.extname(file).toLowerCase();
    const etag = 'W/"' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.png' || ext === '.woff2' ? 'public, max-age=86400' : 'no-cache',
      'ETag': etag,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not here.\n');
}

/* Resolve a URL path inside a directory without ever escaping it. */
function safeJoin(dir, unsafe) {
  const clean = decodeURIComponent(unsafe).replace(/\\/g, '/');
  const p = path.normalize(path.join(dir, clean));
  if (!p.startsWith(dir)) return null;
  return p;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  let pathname = parsed.pathname || '/';

  if (pathname === '/health' || pathname === '/healthz') {
    const body = JSON.stringify({
      ok: true,
      game: 'last-call',
      up: Math.round((Date.now() - started) / 1000) + 's',
      memory: Math.round(process.memoryUsage().heapUsed / 1048576) + 'MB',
      ...hub.stats()
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(body);
  }

  /* A read-only "dumb protocol" git endpoint. Render (and any git client)
     can clone the public copy of this game straight from a running server:
     /git/info/refs, /git/objects/... served as plain files from .gitpub/.
     It exists so the game can be deployed to a persistent host without
     owning a repository account anywhere. */
  if (pathname.startsWith('/git/') || pathname === '/git') {
    const GITPUB = path.join(__dirname, '..', '.gitpub');
    const rel = decodeURIComponent(pathname.slice(5));
    const file = path.join(GITPUB, rel);
    if (!file.startsWith(GITPUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': fs.statSync(file).size
    });
    return fs.createReadStream(file).pipe(res);
  }

  if (pathname === '/api/rooms' && req.method === 'POST') {
    // Headless room creation, so a script or a QR flow can mint a table.
    const room = hub.createRoom();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ code: room.code }));
  }

  if (pathname === '/api/rooms' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ rooms: Array.from(hub.rooms.values()).map((r) => ({
      code: r.code, seated: r.players.length, humans: r.humans().length,
      phase: r.game ? r.game.phase : 'lobby', round: r.game ? r.game.round : 0
    })) }));
  }

  // The single-file build, if it exists, is served straight from /single.
  if (pathname === '/' || pathname === '/index.html') {
    const single = path.join(SINGLE_DIR, 'lastcall.html');
    if (fs.existsSync(single)) return sendFile(res, single, req);
    return sendFile(res, path.join(CLIENT_DIR, 'index.html'), req);
  }

  if (pathname.startsWith('/single/')) {
    const f = safeJoin(SINGLE_DIR, pathname.slice('/single'.length));
    return f ? sendFile(res, f, req) : notFound(res);
  }

  const file = safeJoin(CLIENT_DIR, pathname);
  if (!file) return notFound(res);
  sendFile(res, file, req);
});

/* ---------------------------------------------------------------------------
   WebSocket
   ------------------------------------------------------------------------- */
const sockets = { rooms: hub };

const wss = WS.attach(server, {
  path: '/ws',
  heartbeatMs: 25000,
  onConnection(ws) {
    ws.meta.session = null;    // { room, playerId }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      try { handle(ws, msg); }
      catch (err) {
        console.error('[msg] ' + msg.t + ' failed:', err && err.message);
        ws.send({ t: 'error', msg: 'The house dropped something. Try that again.' });
      }
    });

    ws.on('close', () => detach(ws));

    ws.send({
      t: 'hello', serverNow: Date.now(),
      turnChoices: TURN_CHOICES, avatars: AVATARS,
      limits: { min: G.MIN_PLAYERS, max: G.MAX_PLAYERS, hand: G.HAND_LIMIT }
    });
  }
});

function attachTo(ws, room, player) {
  detach(ws);
  if (player.ws && player.ws !== ws && player.ws.readyState === 'open') {
    // Same seat, new tab. The old socket is told why it is being evicted.
    player.ws.send({ t: 'evicted', msg: 'This seat was opened somewhere else.' });
    player.ws.close(4000, 'seat taken');
  }
  player.ws = ws;
  player.connected = true;
  player.lastSeen = Date.now();
  ws.meta.session = { room: room.code, playerId: player.id };
  room.lastActivity = Date.now();
  room.clearTimer('turn');
  room.scheduleTick(400);
}

function detach(ws) {
  const s = ws.meta && ws.meta.session;
  if (!s) return;
  ws.meta.session = null;
  const room = hub.get(s.room);
  if (!room) return;
  const p = room.playerById(s.playerId);
  if (!p || p.ws !== ws) return;
  p.ws = null;
  p.connected = false;
  p.lastSeen = Date.now();
  room.lastActivity = Date.now();

  // A dropped human mid-turn: give the seat a grace period before the clock
  // resumes, because reloading a phone should not cost you a turn.
  if (room.game && room.game.phase === 'turn' && G.current(room.game) && G.current(room.game).id === p.id) {
    room.clearTimer('turn');
    const t = setTimeout(() => { if (room.game && room.game.phase === 'turn') room.timeoutTurn(p.id); }, 40000);
    t.unref && t.unref();
    room.timers.turn = t;
  }
  room.pushChat({ system: true, text: p.name + ' lost connection. Their seat is being kept warm.' });
  room.pushRoom();
}

/* Clean up a disconnected human who never comes back. */
setInterval(() => {
  const now = Date.now();
  for (const room of hub.rooms.values()) {
    for (const p of room.players.slice()) {
      if (p.isBot || p.connected) continue;
      if (now - p.lastSeen > 1000 * 60 * 5 && (!room.game || room.game.phase !== 'turn')) {
        room.removePlayer(p.id);
        room.pushRoom();
      }
    }
  }
}, 60000).unref();

function handle(ws, msg) {
  const session = ws.meta.session;

  switch (msg.t) {
    /* ------------------------------------------------------------- create */
    case 'create': {
      const room = hub.createRoom();
      const p = room.addPlayer({ name: msg.name, avatar: msg.avatar });
      attachTo(ws, room, p);
      ws.send({ t: 'welcome', you: { id: p.id, token: p.token, isHost: p.id === room.hostId }, room: room.roomView() });
      room.pushChat({ system: true, text: room.dealer('welcome') });
      room.pushRoom();
      console.log('[room ' + room.code + '] created by ' + p.name);
      return;
    }

    /* --------------------------------------------------------------- join */
    case 'join': {
      const room = hub.get(msg.code);
      if (!room) return ws.send({ t: 'error', msg: 'No table with that code. Check the letters.', fatal: true });
      if (room.game && room.game.phase === 'turn') {
        // Mid-match: become a spectator-ish late arrival. We do NOT insert a
        // new player into a running shooting order — that would change every
        // shell count mid-round. They wait for the next match.
        const p = room.addPlayer({ name: msg.name, avatar: msg.avatar });
        attachTo(ws, room, p);
        const gp = G.byId(room.game, p.id);
        if (gp) { gp.alive = false; gp.hp = 0; gp.spectating = true; }
        ws.send({ t: 'welcome', you: { id: p.id, token: p.token, isHost: false, spectating: true }, room: room.roomView() });
        room.pushChat({ system: true, text: p.name + ' arrived late and is watching. They get the next one.' });
        room.pushRoom();
        return;
      }
      if (room.players.length >= G.MAX_PLAYERS) {
        return ws.send({ t: 'error', msg: 'That table is full. Six is the legal maximum.', fatal: true });
      }
      const p = room.addPlayer({ name: msg.name, avatar: msg.avatar });
      attachTo(ws, room, p);
      ws.send({ t: 'welcome', you: { id: p.id, token: p.token, isHost: p.id === room.hostId }, room: room.roomView() });
      room.pushChat({ system: true, text: p.name + ' sits down.' });
      room.pushRoom();
      console.log('[room ' + room.code + '] ' + p.name + ' joined (' + room.players.length + ' seated)');
      return;
    }

    /* ---------------------------------------------------------- reconnect */
    case 'reconnect': {
      const room = hub.get(msg.code);
      if (!room) return ws.send({ t: 'error', msg: 'That table has been cleared away.', fatal: true });
      const p = room.players.find((x) => x.token === msg.token);
      if (!p) return ws.send({ t: 'error', msg: 'Your seat at that table is gone.', fatal: true });
      attachTo(ws, room, p);
      ws.send({
        t: 'welcome',
        you: { id: p.id, token: p.token, isHost: p.id === room.hostId, returned: true },
        room: room.roomView()
      });
      // Re-send the private intel they had earned.
      if (room.game) ws.send({ t: 'private', priv: G.privateFor(room.game, p.id) });
      room.pushChat({ system: true, text: p.name + ' is back.' });
      room.pushRoom();
      return;
    }

    /* ------------------------------------------------------------- in-room */
    case 'start': {
      const room = requireSession(ws, hub); if (!room) return;
      const p = room.playerById(session.playerId);
      if (room.hostId !== p.id) return ws.send({ t: 'error', msg: 'Only the host deals.' });
      const res = room.startGame();
      if (!res.ok) return ws.send({ t: 'error', msg: res.error });
      console.log('[room ' + room.code + '] game started with ' + room.players.length);
      return;
    }

    case 'rematch': {
      const room = requireSession(ws, hub); if (!room) return;
      const p = room.playerById(session.playerId);
      if (room.hostId !== p.id) return ws.send({ t: 'error', msg: 'Only the host calls a rematch.' });
      room.overAnnounced = false;
      room.rematch();
      return;
    }

    case 'addBot': {
      const room = requireSession(ws, hub); if (!room) return;
      const p = room.playerById(session.playerId);
      if (room.hostId !== p.id) return ws.send({ t: 'error', msg: 'Only the host seats the regulars.' });
      if (room.players.length >= G.MAX_PLAYERS) return ws.send({ t: 'error', msg: 'Table is full.' });
      const bot = room.addBot();
      room.pushChat({ system: true, text: bot.name + ' sits down. They do not introduce themselves.' });
      room.pushRoom();
      return;
    }

    case 'kick': {
      const room = requireSession(ws, hub); if (!room) return;
      const p = room.playerById(session.playerId);
      if (room.hostId !== p.id) return ws.send({ t: 'error', msg: 'Only the host throws people out.' });
      const victim = room.playerById(msg.id);
      if (!victim) return;
      if (!victim.isBot) {
        room.send(victim, { t: 'kicked', msg: 'The host asked you to leave.' });
        if (victim.ws) victim.ws.close(4003, 'kicked');
      }
      room.removePlayer(victim.id);
      room.pushChat({ system: true, text: victim.name + ' has been removed from the table.' });
      room.pushRoom();
      return;
    }

    case 'settings': {
      const room = requireSession(ws, hub); if (!room) return;
      const p = room.playerById(session.playerId);
      if (room.hostId !== p.id) return;
      const { MAPS, WEAPONS, CHAOS } = require('./rooms.js');
      if (TURN_CHOICES.includes(msg.turnSeconds)) room.settings.turnSeconds = msg.turnSeconds;
      if (typeof msg.seats === 'number' && msg.seats >= 2 && msg.seats <= 6) room.settings.seats = Math.round(msg.seats);
      if (MAPS.includes(msg.map)) room.settings.map = msg.map;
      if (WEAPONS.includes(msg.weapon)) room.settings.weapon = msg.weapon;
      if (CHAOS.includes(msg.chaos)) room.settings.chaos = msg.chaos;
      room.pushRoom();
      return;
    }

    /* ---------------------------------------------------------------- play */
    case 'act': {
      const room = requireSession(ws, hub); if (!room) return;
      const res = room.handleAction(session.playerId, msg.action);
      if (!res.ok) ws.send({ t: 'reject', msg: res.error, action: msg.action });
      return;
    }

    /* -------------------------------------------------------------- social */
    case 'chat': {
      const room = requireSession(ws, hub); if (!room) return;
      const p = room.playerById(session.playerId);
      const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      if (!text) return;
      const now = Date.now();
      if (p.lastChat && now - p.lastChat < 350) return;    // no flooding
      p.lastChat = now;
      room.pushChat({ name: p.name, id: p.id, colour: p.colour, text });
      return;
    }

    case 'react': {
      const room = requireSession(ws, hub); if (!room) return;
      const p = room.playerById(session.playerId);
      const emoji = String(msg.emoji || '').slice(0, 8);
      const allowed = ['💀', '😂', '🔥', '😱', '🫡', '🤡', '🍺', '🤞'];
      if (!allowed.includes(emoji)) return ws.send({ t: 'reject', msg: 'That one is not in the box.', action: 'react' });
      const now = Date.now();
      if (p.lastReact && now - p.lastReact < 250) return;
      p.lastReact = now;
      const entry = { id: makeId('rx'), playerId: p.id, name: p.name, emoji, ts: now };
      room.reactionLog.push(entry);
      if (room.reactionLog.length > 40) room.reactionLog.shift();
      room.broadcast({ t: 'react', entry });
      return;
    }

    case 'leave': {
      const room = requireSession(ws, hub); if (!room) return;
      const p = room.playerById(session.playerId);
      detach(ws);
      if (p) {
        room.removePlayer(p.id);
        room.pushChat({ system: true, text: p.name + ' stood up and left. Rude.' });
        room.pushRoom();
      }
      ws.send({ t: 'left' });
      return;
    }

    case 'ping':
      ws.send({ t: 'pong', serverNow: Date.now(), clientNow: msg.clientNow || null });
      return;

    default:
      ws.send({ t: 'error', msg: 'Unknown message type: ' + msg.t });
  }
}

function requireSession(ws, hub) {
  const s = ws.meta.session;
  if (!s) { ws.send({ t: 'error', msg: 'You are not at a table.', fatal: true }); return null; }
  const room = hub.get(s.room);
  if (!room) { ws.send({ t: 'error', msg: 'That table no longer exists.', fatal: true }); return null; }
  if (!room.playerById(s.playerId)) { ws.send({ t: 'error', msg: 'You are no longer seated.', fatal: true }); return null; }
  return room;
}

/* ---------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  🎰  LAST CALL');
  console.log('  ────────────────────────────────────────────');
  console.log('  listening   http://' + HOST + ':' + PORT);
  console.log('  health      http://' + HOST + ':' + PORT + '/health');
  console.log('  websocket   ws://' + HOST + ':' + PORT + '/ws');
  console.log('  client      ' + (fs.existsSync(path.join(SINGLE_DIR, 'lastcall.html')) ? 'single/lastcall.html' : 'client/'));
  console.log('');
});

function shutdown(sig) {
  console.log('\n  ' + sig + ' — closing the bar.');
  wss.closeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => console.error('uncaught:', e));
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));
