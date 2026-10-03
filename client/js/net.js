/* ============================================================================
   LAST CALL — the wire
   ----------------------------------------------------------------------------
   A socket that refuses to stay dead. Phones sleep, lifts remove signal, and
   somebody always has one bar at a party. The server keeps your seat; this
   keeps trying to get back to it.

   Reconnect uses an exponential backoff with jitter, and the token from the
   server is what claims the seat back, so a reload is invisible to everyone
   else at the table.
   ========================================================================== */
'use strict';

const STORE_KEY = 'lastcall.session';

export function wsUrl() {
  const params = new URLSearchParams(location.search);
  const override = params.get('server');
  if (override) return override.replace(/\/$/, '');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return proto + '//' + location.host + '/ws';
}

export function savedSession() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

export function saveSession(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
}

export function clearSession() {
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
}

export class Net {
  constructor(handlers) {
    this.h = handlers || {};
    this.ws = null;
    this.attempt = 0;
    this.queue = [];
    this.closedByUs = false;
    this.latency = 0;
    this.status = 'offline';
    this.lastPing = 0;
    this._pingTimer = null;
  }

  connect() {
    this.closedByUs = false;
    this.status = 'connecting';
    this.h.onStatus && this.h.onStatus(this.status);
    let ws;
    try { ws = new WebSocket(wsUrl()); }
    catch (e) { return this.retry(); }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.status = 'online';
      this.h.onStatus && this.h.onStatus('online');
      // Re-authenticate before flushing anything else.
      const s = savedSession();
      if (s && s.code && s.token) this.send({ t: 'reconnect', code: s.code, token: s.token });
      for (const m of this.queue.splice(0)) this.send(m);
      this.startPing();
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === 'pong') {
        if (msg.clientNow) this.latency = Math.max(1, Date.now() - msg.clientNow);
        return;
      }
      if (msg.t === 'hello') this.h.onHello && this.h.onHello(msg);
      else if (msg.t === 'welcome') {
        if (msg.you && msg.you.token) saveSession({ code: msg.room.code, token: msg.you.token });
        this.h.onWelcome && this.h.onWelcome(msg);
      }
      else if (msg.t === 'room') this.h.onRoom && this.h.onRoom(msg.room);
      else if (msg.t === 'state') this.h.onState && this.h.onState(msg);
      else if (msg.t === 'private') this.h.onPrivate && this.h.onPrivate(msg.priv);
      else if (msg.t === 'chat') this.h.onChat && this.h.onChat(msg.entry);
      else if (msg.t === 'react') this.h.onReact && this.h.onReact(msg.entry);
      else if (msg.t === 'clock') this.h.onClock && this.h.onClock(msg);
      else if (msg.t === 'gameover') this.h.onGameOver && this.h.onGameOver(msg);
      else if (msg.t === 'reject') this.h.onReject && this.h.onReject(msg);
      else if (msg.t === 'error') {
        if (msg.fatal) clearSession();
        this.h.onError && this.h.onError(msg);
      }
      else if (msg.t === 'kicked' || msg.t === 'evicted') {
        clearSession();
        this.h.onNotice && this.h.onNotice(msg.msg);
      }
      else if (msg.t === 'left') this.h.onLeft && this.h.onLeft();
    };

    ws.onclose = () => {
      this.stopPing();
      if (this.closedByUs) return;
      this.status = 'reconnecting';
      this.h.onStatus && this.h.onStatus('reconnecting');
      this.retry();
    };
    ws.onerror = () => {};
    return this;
  }

  retry() {
    this.attempt++;
    const base = Math.min(8000, 400 * Math.pow(1.7, Math.min(this.attempt, 8)));
    const wait = base * (0.7 + Math.random() * 0.6);
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this.connect(), wait);
  }

  startPing() {
    this.stopPing();
    this._pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) this.send({ t: 'ping', clientNow: Date.now() });
    }, 12000);
  }
  stopPing() { if (this._pingTimer) clearInterval(this._pingTimer); }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    // Buffer play actions; drop pure chatter so the queue cannot grow forever.
    if (obj.t !== 'chat' && obj.t !== 'react' && this.queue.length < 40) this.queue.push(obj);
    return false;
  }

  leave() {
    this.closedByUs = true;
    this.queue = [];
    clearSession();
    try { this.ws && this.ws.close(); } catch (e) {}
    this.status = 'offline';
  }
}
