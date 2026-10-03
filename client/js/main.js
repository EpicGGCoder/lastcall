/* ============================================================================
   LAST CALL — main
   ----------------------------------------------------------------------------
   Wire the room, the renderer, the sound and the interface together.

   THE EVENT QUEUE
   ---------------
   The server sends a batch of events AND the resulting game state in the same
   message. The client does not apply the state straight away: it plays the
   events one at a time (bang, flash, camera shove, the dealer's line) and only
   then reveals the new state. Without this, a health bar would drop before the
   gun went off, which would ruin the only thing this game is selling.
   ========================================================================== */
'use strict';

import { Scene } from './scene.js';
import { UI, REACTIONS } from './ui.js';
import { Net, savedSession, clearSession } from './net.js';
import { sound } from './audio.js';

const byId = (id) => document.getElementById(id);

let scene, ui, net;
let stateQueue = [];
let draining = false;
let camMode = 'table';
let camRevert = 0;
let turnDeadline = 0;
let lastTurnId = null;
let gameOverPending = false;
let startTime = 0;

/* ---------------------------------------------------------------------------
   Boot
   ------------------------------------------------------------------------- */
function boot() {
  try {
    scene = new Scene(byId('gl'));
  } catch (e) {
    fatalNoWebGL(e);
    return;
  }

  ui = new UI({
    onCreate: (id) => { sound.ensure(); connect(); net.send({ t: 'create', name: id.name, avatar: id.avatar }); },
    onJoin: (id) => { sound.ensure(); connect(); net.send({ t: 'join', code: id.code, name: id.name, avatar: id.avatar }); },
    onStart: () => net.send({ t: 'start' }),
    onAddBot: () => net.send({ t: 'addBot' }),
    onKick: (id) => net.send({ t: 'kick', id }),
    onAct: (action) => { sound.ensure(); sound.hammer(); net.send({ t: 'act', action }); },
    onChat: (text) => net.send({ t: 'chat', text }),
    onReact: (emoji) => net.send({ t: 'react', emoji }),
    onRematch: () => { clearOver(); net.send({ t: 'rematch' }); },
    onLeave: () => { net.send({ t: 'leave' }); leaveClean(); },
    onSettings: (s) => net.send({ t: 'settings', turnSeconds: s.turnSeconds }),
    onOverShown: () => {}
  });
  ui.init();

  net = new Net({
    onStatus: (s) => ui.setConn(s),
    onHello: () => {},
    onWelcome: (msg) => {
      ui.you = msg.you.id;
      ui.room = msg.room;
      turnDeadline = msg.room.turnDeadline || 0;
      if (msg.room.phase === 'lobby') {
        ui.setGameVisible(false);
        ui.renderLobby(msg.room, msg.you);
        ui.renderLobbyLog(msg.room.chat || []);
        sound.startRoom();
      } else {
        ui.renderLobby(msg.room, msg.you);   // keep the data for the menu
        ui.setGameVisible(true);
        // A reconnecting player gets no event replay, so the room view has to
        // stand in for everything they missed while the page was gone.
        ui.applyState({ view: msg.room, events: [], you: msg.you.id, dealerLine: msg.room.dealer });
        if (msg.room.mag) scene.loadMagazine(msg.room.mag);
        if (msg.room.phase === 'over' && msg.room.winnerId) ui.renderOver(msg.room.winnerId);
        sound.startRoom();
      }
      if (msg.you.returned) ui.toast('Back in your seat.');
      if (msg.you.spectating) ui.toast('The match is underway. You are watching this one.');
    },
    onRoom: (room) => {
      ui.room = room;
      ui.isHost = room.hostId === ui.you;
      turnDeadline = room.turnDeadline || 0;
      if (ui.currentScreen === 'menu' || room.phase === 'lobby') ui.renderLobby(room, { id: ui.you, isHost: ui.isHost });
      if (room.phase === 'lobby') { ui.setGameVisible(false); ui.renderLobby(room, { id: ui.you, isHost: ui.isHost }); }
      else if (room.phase === 'turn' || room.phase === 'over') {
        ui.state = Object.assign({}, ui.state, {
          turnId: room.turnId, phase: room.phase, round: room.round, mag: room.mag
        });
        ui.renderMag(room.mag);
        if (room.players) { ui.state.players = room.players; ui.renderCards(ui.state); ui.renderHand(); }
      }
    },
    onState: (msg) => { enqueue(msg); },
    onPrivate: (priv) => { ui.priv = priv; },
    onChat: (entry) => {
      ui.pushChat(entry, ui.state && ui.state.phase === 'turn' ? 'game' : 'lobby');
      ui.pushChat(entry, ui.state && ui.state.phase === 'turn' ? 'lobby' : 'game');
      if (!entry.system && entry.id !== ui.you) sound.pop();
    },
    onReact: (entry) => {
      const pos = reactionPosition(entry.playerId);
      ui.floatReaction(entry.emoji, pos);
      sound.pop();
    },
    onClock: (msg) => { turnDeadline = msg.turnDeadline || 0; },
    onGameOver: () => { gameOverPending = true; },
    onReject: (msg) => ui.toast(msg.msg, 'bad'),
    onError: (msg) => {
      ui.toast(msg.msg, 'bad');
      if (msg.fatal) { leaveClean(); ui.showScreen('title'); }
    },
    onNotice: (msg) => ui.toast(msg, 'bad'),
    onLeft: () => { leaveClean(); ui.showScreen('title'); }
  });

  // An invite link carries the room code in the hash.
  const hash = (location.hash || '').replace('#', '').toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(hash)) {
    byId('in-code').value = hash;
    byId('join-row').hidden = false;
  }

  // Only auto-reconnect if we were in a room last time.
  const sess = savedSession();
  if (sess && sess.code && sess.token) {
    connect();
    ui.toast('Rejoining table ' + sess.code + '…');
  } else {
    ui.showScreen('title');
  }

  requestAnimationFrame(frame);
  setInterval(tickClock, 200);
}

function connect() {
  if (!net) return;
  net.connect();
}

function leaveClean() {
  net.leave();
  ui.setGameVisible(false);
  ui.cards.forEach((c) => c.remove());
  ui.cards.clear();
  ui.state = null;
  ui.priv = null;
  ui.roomCode = null;
  stateQueue = [];
  draining = false;
}

function fatalNoWebGL(e) {
  document.body.innerHTML =
    '<div style="position:fixed;inset:0;display:grid;place-items:center;background:#0b0a0c;color:#f4ecdd;font:16px/1.6 system-ui;text-align:center;padding:2rem">' +
    '<div><h1 style="color:#e8b04b;margin:0 0 .6rem">LAST CALL</h1>' +
    '<p style="max-width:26rem;color:#9a8f80">This game needs WebGL, and your browser did not hand it over. ' +
    'Try a different browser, or turn off any setting that blocks hardware acceleration.</p></div></div>';
  console.error(e);
}

/* ---------------------------------------------------------------------------
   The director — turn server events into beats
   ------------------------------------------------------------------------- */
const DURATION = {
  start: 420, reload: 1400, deal: 480, turn: 140, magEmpty: 900,
  shot: 980, keepsTurn: 780, out: 1250, eject: 780, item: 560,
  peek: 820, phone: 900, cuff: 700, skip: 700, steal: 780, flip: 780, over: 1500
};

function enqueue(msg) {
  stateQueue.push(msg);
  if (!draining) drain();
}

async function drain() {
  draining = true;
  while (stateQueue.length) {
    const msg = stateQueue.shift();
    const events = msg.events || [];
    for (const ev of events) {
      playEvent(ev, msg);
      await wait(DURATION[ev.type] || 260);
    }
    // Now — and only now — reveal what actually happened.
    ui.applyState(msg);
    ui.renderHand();
    checkStartCamera();
  }
  draining = false;
  if (gameOverPending) {
    gameOverPending = false;
    const v = ui.state;
    if (v) {
      const won = v.winnerId === ui.you;
      if (won) sound.victory(); else sound.defeat();
      scene.setCamera('wide');
      camMode = 'wide';
      await wait(1100);
      ui.renderOver(v.winnerId);
    }
  }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function playEvent(ev, msg) {
  const v = ui.state || { players: [] };
  const nameOf = (id) => {
    const p = (msg.view.players || []).find((x) => x.id === id);
    return p ? p.name : 'Somebody';
  };
  const isMe = (id) => id === ui.you;

  switch (ev.type) {
    case 'start':
      sound.reload();
      ui.banner('SHELLS LOADED', 'good');
      break;

    case 'reload':
      scene.loadMagazine({ live: ev.live, blank: ev.blank, size: ev.size });
      sound.reload();
      ui.banner('ROUND ' + ev.round, 'good');
      for (let i = 0; i < ev.size; i++) {
        setTimeout(() => sound.click(1200 + i * 90), i * 60);
      }
      break;

    case 'deal':
      sound.item();
      break;

    case 'shot': {
      scene.consumeShell(ev.shell);
      scene.addCasing(ev.shell);
      scene.fire({ shell: ev.shell, self: ev.self });
      if (ev.shell === 'live') { sound.gunshot(ev.self); if (ev.killed) sound.hurt(); }
      else sound.blank();
      scene.setCamera('barrel');
      camMode = 'barrel';
      camRevert = Date.now() + 900;
      if (ev.self && ev.shell === 'blank') ui.banner('CLICK. AGAIN.', 'good');
      else if (ev.self) ui.banner('YOU SHOT YOURSELF', 'bad');
      else if (ev.shell === 'live') ui.banner(ev.damage > 1 ? 'DOUBLE DAMAGE' : 'BANG', 'bad');
      else ui.banner('CLICK', '');
      break;
    }

    case 'keepsTurn':
      ui.banner((isMe(ev.who) ? 'YOU KEEP' : nameOf(ev.who).toUpperCase() + ' KEEPS') + ' THE TURN', 'good');
      break;

    case 'out':
      sound.bad();
      ui.banner(nameOf(ev.who).toUpperCase() + ' IS OUT', 'bad');
      break;

    case 'item':
      sound.item();
      break;

    case 'peek':
      if (isMe(ev.who)) {
        ui.toast(ev.shell === 'live'
          ? 'Reading glasses: the chamber holds a LIVE round.'
          : 'Reading glasses: the chamber holds a BLANK.', ev.shell === 'live' ? 'bad' : '');
        scene.flashColour = ev.shell === 'live' ? [1, 0.6, 0.5] : [0.7, 1, 0.8];
        scene.flash = 0.5;
      }
      break;

    case 'phone':
      if (isMe(ev.who)) {
        const away = ev.index - ev.shellFrom;
        ui.toast('Burner phone: shell ' + away + ' from now is ' + (ev.shell === 'live' ? 'LIVE.' : 'BLANK.'), ev.shell === 'live' ? 'bad' : '');
      }
      break;

    case 'eject':
      scene.spendOne();
      if (ev.shell === 'live') scene.addCasing(ev.shell);
      sound.eject();
      ui.banner('THE SHELL WAS ' + ev.shell.toUpperCase(), ev.shell === 'live' ? 'bad' : 'good');
      break;

    case 'flip':
      sound.item();
      ui.banner('FLIPPED', 'good');
      break;

    case 'cuff':
      sound.item();
      if (!isMe(ev.target)) ui.toast(nameOf(ev.target) + ' is tied up for their next turn.');
      break;

    case 'skip':
      ui.banner(nameOf(ev.who).toUpperCase() + ' MISSES A TURN', '');
      break;

    case 'steal':
      sound.pop();
      if (isMe(ev.who)) ui.toast('You lifted their ' + prettyItem(ev.stolen) + '.');
      else if (isMe(ev.target)) ui.toast(nameOf(ev.who) + ' took your ' + prettyItem(ev.stolen) + '.', 'bad');
      break;

    case 'uncuff':
      break;

    case 'turn':
      if (ev.who !== lastTurnId) {
        lastTurnId = ev.who;
        if (isMe(ev.who)) { sound.tick(); }
        camMode = isMe(ev.who) ? 'lean' : 'table';
        scene.setCamera(camMode);
        camRevert = 0;
      }
      break;

    case 'over':
      sound.victory();
      break;

    case 'magEmpty':
      sound.eject();
      break;
  }

  // Dealer lines arrive with the batch; show the newest as they play.
  if (msg.lines && msg.lines.length) {
    const idx = (msg.events || []).indexOf(ev);
    const line = msg.lines[Math.min(idx, msg.lines.length - 1)];
    if (line && line.key === ev.type) ui.setDealerLine(line.text);
  }
}

function prettyItem(id) {
  return ({ puff: 'Just One Puff', glasses: 'Reading Glasses', brew: 'Liquid Courage',
    saw: 'Handsaw', ties: 'Zip Ties', refund: 'Petty Refund', pill: 'Mystery Pill',
    burner: 'Burner Phone', sticky: 'Sticky Fingers' })[id] || id;
}

function checkStartCamera() {
  const v = ui.state;
  if (!v) return;
  if (v.phase === 'turn') {
    ui.setGameVisible(true);
    if (!startTime) startTime = Date.now();
  }
}

function clearOver() { gameOverPending = false; }

/* ---------------------------------------------------------------------------
   Clock
   ------------------------------------------------------------------------- */
function tickClock() {
  const v = ui.state;
  const room = ui.room;
  if (!v || v.phase !== 'turn' || !room) { ui.setTurnClock(null); return; }
  const secs = room.settings ? room.settings.turnSeconds : 0;
  if (!secs) { ui.setTurnClock(null); return; }
  if (!turnDeadline) { ui.setTurnClock(null); return; }
  const left = (turnDeadline - Date.now()) / 1000;
  ui.setTurnClock(Math.max(0, left));
}

/* ---------------------------------------------------------------------------
   Frame
   ------------------------------------------------------------------------- */
let lastFrame = 0;
let fpsAccum = 0, fpsCount = 0, fpsLow = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 0.016);
  lastFrame = now;

  if (camRevert && Date.now() > camRevert) {
    camRevert = 0;
    const v = ui && ui.state;
    const myTurn = v && v.turnId === ui.you && v.phase === 'turn';
    camMode = myTurn ? 'lean' : 'table';
    scene.setCamera(camMode);
  }

  scene.update(dt, ui.state);
  scene.render(ui.state);

  // Anchor the DOM cards to their projected seats once per frame.
  if (ui.cards.size) {
    const w = window.innerWidth, h = window.innerHeight;
    ui.layout((index, count) => scene.cardScreenPos(index, count, w, h, 1));
  }

  // Adaptive quality: if the frame time creeps up on a phone, drop the dust.
  fpsAccum += dt; fpsCount++;
  if (fpsAccum > 1.5) {
    const fps = fpsCount / fpsAccum;
    if (fps < 34) { fpsLow++; if (fpsLow >= 2) scene.renderer.setResolutionScale(0.78); }
    else fpsLow = 0;
    fpsAccum = 0; fpsCount = 0;
  }
}

function reactionPosition(playerId) {
  const card = ui.cards.get(playerId);
  if (card) {
    const r = card.getBoundingClientRect();
    return { x: ((r.left + r.width / 2) / window.innerWidth) * 100, y: (r.top / window.innerHeight) * 100 };
  }
  return {};
}

/* A rude surprise for anyone who leaves the room: the table keeps playing. */
window.addEventListener('beforeunload', () => {
  if (net && net.ws && net.ws.readyState === 1) net.send({ t: 'ping', clientNow: Date.now() });
});

window.addEventListener('error', (e) => {
  console.error('client error:', e.message);
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export { boot, scene, ui, net };
