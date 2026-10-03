/* ============================================================================
   LAST CALL — wire harness
   ----------------------------------------------------------------------------
   Speaks the raw WebSocket protocol through tools/wsclient.js, which is a
   deliberately independent implementation: if the server's RFC 6455 framing
   and this client's framing disagree, everything here fails at once.

   Covers: create / join / bad code / start / a complete match played over the
   wire / chat / reaction validation / ping / reconnect with a session token.

   Run:  node tools/test-wire.js            (against localhost:8787)
         WS_URL=ws://host:port/ws node tools/test-wire.js
   ========================================================================== */
'use strict';

const { Client } = require('./wsclient.js');

const URL = process.env.WS_URL || 'ws://127.0.0.1:8787/ws';
const ok = (m) => console.log('  ✓ ' + m);
let failures = 0;
const fail = (m) => { failures++; console.error('  ✗ ' + m); };

function pump(c, state) {
  c.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    state.last[m.t] = m;
    if (m.t === 'state') {
      state.states.push(m);
      const v = m.view;
      if (v.phase === 'turn' && v.turnId === state.id && !state.acted.has(m.serverNow + ':' + v.turnId + ':' + (m.priv ? 1 : 0) + ':' + v.mag.remaining)) {
        // one action per state batch
        const others = v.players.filter((p) => p.alive && p.id !== state.id);
        const target = others.length ? others[0].id : state.id;
        state.acted.add(m.serverNow + ':' + v.turnId + ':' + (m.priv ? 1 : 0) + ':' + v.mag.remaining);
        c.send({ t: 'act', action: { type: 'shoot', target } });
      }
      if (v.phase === 'over') state.over = true;
    }
    if (m.t === 'welcome') { state.id = m.you.id; state.token = m.you.token; state.welcomed = true; }
    if (m.t === 'gameover') state.over = true;
  });
}

const newState = () => ({ last: {}, states: [], acted: new Set(), over: false, id: null, token: null });

(async () => {
  console.log('wire harness → ' + URL);

  /* ── create + join ─────────────────────────────────────────────────── */
  const A = new Client(URL); const sa = newState(); pump(A, sa);
  await A.connect();
  await A.waitType('hello', 4000);
  A.send({ t: 'create', name: 'Wire', avatar: 'fedora' });
  await A.wait((m) => m.t === 'welcome', 4000, 'welcome A');
  const code = sa.last.welcome.room.code;
  ok('created room ' + code);

  const B = new Client(URL); const sb = newState(); pump(B, sb);
  await B.connect();
  await B.waitType('hello', 4000);
  B.send({ t: 'join', code, name: 'Probe', avatar: 'skull' });
  await B.wait((m) => m.t === 'welcome', 4000, 'welcome B');
  ok('joined by code');

  await A.wait((m) => m.t === 'room' && m.room.players.length === 2, 4000, 'room update');
  ok('host saw the second seat');

  /* ── a stranger with a wrong code is turned away ───────────────────── */
  const C = new Client(URL); const sc = newState(); pump(C, sc);
  await C.connect();
  await C.waitType('hello', 4000);
  C.send({ t: 'join', code: 'ZZZZ', name: 'Ghost', avatar: 'cat' });
  const turned = await C.wait((m) => m.t === 'error' || m.t === 'reject', 4000, 'rejection').catch(() => null);
  if (turned) ok('bad code rejected: ' + turned.msg);
  else fail('bad code was not rejected');
  C.close();

  /* ── chat + reaction validation ────────────────────────────────────── */
  A.send({ t: 'chat', text: 'wire check' });
  const chat = await B.wait((m) => m.t === 'chat' && m.entry && m.entry.text === 'wire check', 4000, 'chat').catch(() => null);
  if (chat) ok('chat delivered');
  else fail('chat did not arrive');

  A.send({ t: 'react', emoji: '🚀' });
  const bad = await A.wait((m) => m.t === 'reject' || m.t === 'error', 3000, 'bad react').catch(() => null);
  if (bad) ok('unlisted emoji refused');
  else fail('unlisted emoji was accepted');
  A.send({ t: 'react', emoji: '💀' });
  const good = await B.wait((m) => m.t === 'react', 3000, 'good react').catch(() => null);
  if (good) ok('listed emoji broadcast');
  else fail('listed emoji did not broadcast');

  /* ── ping ──────────────────────────────────────────────────────────── */
  A.send({ t: 'ping', clientNow: Date.now() });
  if (await A.waitType('pong', 3000).catch(() => null)) ok('ping/pong');
  else fail('no pong');

  /* ── the match ─────────────────────────────────────────────────────── */
  A.send({ t: 'start' });
  const started = await A.wait((m) => m.t === 'state' && m.view.phase === 'turn', 6000, 'first state').catch(() => null);
  if (!started) { fail('match never entered play'); }
  else ok('match in play');

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && !(sa.over && sb.over)) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (sa.over && sb.over) ok('match concluded on both sockets');
  else fail('match did not conclude (A over=' + sa.over + ' B over=' + sb.over + ')');

  const winner = sa.last.state ? sa.last.state.view.winnerId : null;
  if (winner && [sa.id, sb.id].includes(winner)) ok('winner is a seated player');
  else fail('winner id not at the table: ' + winner);

  /* ── the public view never carries the shell order ─────────────────── */
  const leak = sa.states.some((m) => JSON.stringify(m.view).includes('"seq"'));
  if (!leak) ok('no state message leaked mag.seq');
  else fail('a state message leaked mag.seq');

  /* ── reconnect with the session token ──────────────────────────────── */
  const token = sb.token;
  B.close();
  await new Promise((r) => setTimeout(r, 300));
  const D = new Client(URL); const sd = newState(); pump(D, sd);
  await D.connect();
  await D.waitType('hello', 4000);
  D.send({ t: 'reconnect', code, token });
  const back = await D.wait((m) => m.t === 'welcome' && m.you.returned === true, 5000, 'reconnect welcome').catch(() => null);
  if (back && sd.id === sb.id) ok('reconnected to the same seat');
  else fail('reconnect failed');

  /* ── a stolen token gets nothing ───────────────────────────────────── */
  const E = new Client(URL); const se = newState(); pump(E, se);
  await E.connect();
  await E.waitType('hello', 4000);
  E.send({ t: 'reconnect', code, token: 'not-a-real-token' });
  const denied = await E.wait((m) => m.t === 'error', 4000, 'token denial').catch(() => null);
  if (denied) ok('bad token denied');
  else fail('bad token was accepted');

  for (const c of [A, D, E]) c.close();
  await new Promise((r) => setTimeout(r, 200));

  if (failures) { console.error('WIRE TESTS FAILED: ' + failures); process.exit(1); }
  console.log('ALL WIRE TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('WIRE HARNESS CRASH', e); process.exit(1); });
