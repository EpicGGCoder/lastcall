/* ============================================================================
   LAST CALL — minimal WebSocket server (RFC 6455)
   ----------------------------------------------------------------------------
   Zero dependencies, ~200 lines, deliberately auditable.

   Why hand-roll it instead of using `ws`? Because this server has to run with
   a single `node server/index.js` on a machine that has never heard of npm.
   The protocol subset a game lobby needs is small: text frames, ping/pong,
   close, and fragmentation. Everything else is rejected on purpose.

   What it handles:
     - the HTTP Upgrade handshake (SHA-1 + magic GUID)
     - text and binary frames, with continuation/fragmentation
     - client masking (mandatory per spec) and unmasked server frames out
     - 7-bit / 16-bit / 64-bit payload lengths
     - ping/pong keepalive and clean close handshakes
     - a hard payload cap so nobody can hand us 4 GB of JSON

   What it deliberately does NOT handle:
     - extensions (permessage-deflate) — we never negotiate any
     - subprotocols — we never negotiate any
   ========================================================================== */
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 256 * 1024;         // a game action is a few hundred bytes

const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

class WebSocket extends EventEmitter {
  constructor(socket, head) {
    super();
    this.socket = socket;
    this.readyState = 'open';
    this._buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this._fragOp = null;
    this._fragParts = [];
    this._fragLen = 0;
    this._closed = false;
    this.isAlive = true;
    this.meta = {};                     // room code, player id — our own scratch space

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', (err) => { this._finish(); this.emit('error', err); });
    socket.on('close', () => { this._finish(); this.emit('close'); });
    socket.on('end', () => this._finish());
    if (this._buf.length) this._drain();
  }

  _finish() {
    if (this._closed) return;
    this._closed = true;
    this.readyState = 'closed';
  }

  _onData(chunk) {
    if (this._closed) return;
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    this._drain();
  }

  /* Pull as many complete frames out of the buffer as we can. */
  _drain() {
    for (;;) {
      const b = this._buf;
      if (b.length < 2) return;

      const fin = (b[0] & 0x80) !== 0;
      const rsv = b[0] & 0x70;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;

      if (rsv !== 0) return this._fail('RSV bits set but no extension negotiated');
      if (!masked) return this._fail('client frames must be masked');

      if (len === 126) {
        if (b.length < off + 2) return;
        len = b.readUInt16BE(off); off += 2;
      } else if (len === 127) {
        if (b.length < off + 8) return;
        const big = b.readBigUInt64BE(off); off += 8;
        if (big > BigInt(MAX_PAYLOAD)) return this._fail('payload too large');
        len = Number(big);
      }
      if (len > MAX_PAYLOAD) return this._fail('payload too large');

      if (b.length < off + 4 + len) return;      // wait for the rest
      const mask = b.subarray(off, off + 4); off += 4;
      const payload = b.subarray(off, off + len);
      this._buf = b.subarray(off + len);

      // unmask in place (we own this buffer slice)
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];

      if (opcode === OP.CLOSE) return this._onClose(out);
      if (opcode === OP.PING) { this._send(OP.PONG, out); continue; }
      if (opcode === OP.PONG) { this.isAlive = true; this.emit('pong'); continue; }

      const isControl = opcode >= 0x8;
      if (isControl) {
        if (!fin) return this._fail('fragmented control frame');
        continue;                                 // unknown control opcode: ignore
      }

      if (opcode === OP.CONT) {
        if (this._fragOp === null) return this._fail('continuation with nothing to continue');
        this._fragParts.push(out);
        this._fragLen += out.length;
        if (this._fragLen > MAX_PAYLOAD) return this._fail('fragmented payload too large');
        if (fin) {
          const whole = Buffer.concat(this._fragParts, this._fragLen);
          const op = this._fragOp;
          this._fragOp = null; this._fragParts = []; this._fragLen = 0;
          this._deliver(op, whole);
        }
        continue;
      }

      // TEXT or BIN
      if (this._fragOp !== null) return this._fail('new data frame while fragments pending');
      if (fin) {
        this._deliver(opcode, out);
      } else {
        this._fragOp = opcode;
        this._fragParts = [out];
        this._fragLen = out.length;
      }
    }
  }

  _deliver(opcode, buf) {
    this.isAlive = true;
    if (opcode === OP.TEXT) {
      this.emit('message', buf.toString('utf8'));
    } else {
      this.emit('binary', buf);
    }
  }

  _onClose(buf) {
    let code = 1000, reason = '';
    if (buf.length >= 2) { code = buf.readUInt16BE(0); reason = buf.subarray(2).toString('utf8'); }
    if (!this._closeSent) {
      const body = Buffer.allocUnsafe(2);
      body.writeUInt16BE(code === 1005 ? 1000 : code, 0);
      this._send(OP.CLOSE, body);
    }
    this._finish();
    try { this.socket.end(); } catch (e) {}
    this.emit('close', code, reason);
  }

  _fail(reason) {
    this.emit('error', new Error('websocket protocol error: ' + reason));
    this.close(1002, reason.slice(0, 100));
  }

  _send(opcode, payload) {
    if (this.readyState !== 'open' || this.socket.destroyed) return false;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    let head;
    if (body.length < 126) {
      head = Buffer.allocUnsafe(2);
      head[1] = body.length;
    } else if (body.length < 65536) {
      head = Buffer.allocUnsafe(4);
      head[1] = 126;
      head.writeUInt16BE(body.length, 2);
    } else {
      head = Buffer.allocUnsafe(10);
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(body.length), 2);
    }
    head[0] = 0x80 | opcode;                       // FIN set, server frames unmasked
    try { this.socket.write(Buffer.concat([head, body])); return true; }
    catch (e) { this._finish(); return false; }
  }

  send(data) {
    if (typeof data !== 'string') data = JSON.stringify(data);
    return this._send(OP.TEXT, data);
  }

  ping() { return this._send(OP.PING, Buffer.alloc(0)); }

  close(code, reason) {
    if (this.readyState !== 'open') return;
    const r = Buffer.from(reason || '', 'utf8').subarray(0, 120);
    const body = Buffer.allocUnsafe(2 + r.length);
    body.writeUInt16BE(code || 1000, 0);
    r.copy(body, 2);
    this._closeSent = true;
    this._send(OP.CLOSE, body);
    this.readyState = 'closing';
    setTimeout(() => { try { this.socket.end(); } catch (e) {} }, 60);
  }

  terminate() {
    this._finish();
    try { this.socket.destroy(); } catch (e) {}
  }
}

/* ---------------------------------------------------------------------------
   Attach to an existing http server. `onConnection(ws, req, url)` is called for
   every successful upgrade on `path`.
   ------------------------------------------------------------------------- */
function attach(server, options) {
  const opts = options || {};
  const path = opts.path || '/ws';
  const onConnection = opts.onConnection || (() => {});
  const clients = new Set();

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return destroy(socket, 400); }
    if (url.pathname !== path) return destroy(socket, 404);

    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();

    if (req.method !== 'GET' || upgrade !== 'websocket' || !key || version !== '13') {
      return destroy(socket, 400);
    }

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n' +
      '\r\n'
    );

    const ws = new WebSocket(socket, head);
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    try { onConnection(ws, req, url); }
    catch (err) { try { ws.close(1011, 'server error'); } catch (e) {} }
  });

  /* Keepalive: anything that misses two cycles gets dropped. Mobile browsers
     routinely vanish without a close frame, and dead sockets would otherwise
     hold a seat in a room forever. */
  const interval = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, opts.heartbeatMs || 25000);
  interval.unref();

  server.on('close', () => clearInterval(interval));

  return {
    clients,
    broadcast(list, data) {
      const text = typeof data === 'string' ? data : JSON.stringify(data);
      let n = 0;
      for (const ws of list || clients) if (ws.send(text)) n++;
      return n;
    },
    closeAll() { for (const ws of clients) ws.terminate(); clients.clear(); }
  };
}

function destroy(socket, code) {
  try {
    socket.write('HTTP/1.1 ' + code + ' Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
  } catch (e) {}
}

module.exports = { attach, WebSocket, acceptKey, OP, MAX_PAYLOAD };
