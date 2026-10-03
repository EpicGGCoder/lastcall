/* ============================================================================
   A tiny WebSocket client, for tests only.
   Written independently of server/ws.js (opposite direction, so it masks) so
   that the two implementations have to agree with each other rather than with
   themselves.
   ========================================================================== */
'use strict';
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class Client extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.buf = Buffer.alloc(0);
    this.readyState = 'connecting';
    this._frag = [];
    this.messages = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const u = new URL(this.url);
      const secure = u.protocol === 'wss:';
      const port = parseInt(u.port, 10) || (secure ? 443 : 80);
      const key = crypto.randomBytes(16).toString('base64');
      this.expect = crypto.createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      const onConnect = () => {
        this.sock.write(
          'GET ' + (u.pathname || '/') + ' HTTP/1.1\r\n' +
          'Host: ' + u.host + '\r\n' +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n'
        );
      };
      this.sock = secure
        ? tls.connect({ host: u.hostname, port, servername: u.hostname }, onConnect)
        : net.connect({ host: u.hostname, port }, onConnect);
      this.sock.on('data', (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        if (this.readyState === 'connecting') {
          const s = this.buf.toString('latin1');
          const end = s.indexOf('\r\n\r\n');
          if (end === -1) return;
          const head = s.slice(0, end);
          if (!/^HTTP\/1\.1 101/.test(head)) return reject(new Error('bad handshake: ' + head.split('\r\n')[0]));
          const m = /sec-websocket-accept:\s*(\S+)/i.exec(head);
          if (!m || m[1] !== this.expect) return reject(new Error('accept mismatch'));
          this.readyState = 'open';
          this.buf = this.buf.subarray(end + 4);
          resolve(this);
          this.emit('open');
        }
        this._drain();
      });
      this.sock.on('error', (e) => { if (this.readyState === 'connecting') reject(e); else this.emit('error', e); });
      this.sock.on('close', () => { this.readyState = 'closed'; this.emit('close'); });
    });
  }

  _drain() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      let mask = null;
      if (masked) { if (b.length < off + 4) return; mask = b.subarray(off, off + 4); off += 4; }
      if (b.length < off + len) return;
      let payload = Buffer.from(b.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + len);

      if (op === 0x9) { this._send(0xa, payload); continue; }
      if (op === 0xa) { this.emit('pong'); continue; }
      if (op === 0x8) { this.readyState = 'closed'; try { this.sock.end(); } catch (e) {} continue; }
      if (op === 0x0) { this._frag.push(payload); }
      else { this._frag = [payload]; }
      if (b[0] & 0x80) {
        const text = Buffer.concat(this._frag).toString('utf8');
        this._frag = [];
        let msg = null;
        try { msg = JSON.parse(text); } catch (e) {}
        this.messages.push(msg || text);
        this.emit('message', msg || text);
      }
    }
  }

  _send(op, payload) {
    if (this.readyState !== 'open') return false;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const mask = crypto.randomBytes(4);
    let head;
    if (body.length < 126) { head = Buffer.allocUnsafe(2); head[1] = 0x80 | body.length; }
    else if (body.length < 65536) { head = Buffer.allocUnsafe(4); head[1] = 0x80 | 126; head.writeUInt16BE(body.length, 2); }
    else { head = Buffer.allocUnsafe(10); head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(body.length), 2); }
    head[0] = 0x80 | op;
    const masked = Buffer.allocUnsafe(body.length);
    for (let i = 0; i < body.length; i++) masked[i] = body[i] ^ mask[i & 3];
    this.sock.write(Buffer.concat([head, mask, masked]));
    return true;
  }

  send(obj) { return this._send(0x1, typeof obj === 'string' ? obj : JSON.stringify(obj)); }
  close() { this._send(0x8, Buffer.alloc(0)); setTimeout(() => { try { this.sock.end(); } catch (e) {} }, 50); }

  /* Wait for the next message matching a predicate. Rejects on timeout.
     Messages that arrived before the wait was registered are NOT discarded:
     the backlog is scanned first, so a broadcast that lands while the test
     is awaiting something else still gets consumed (latency-proof). */
  wait(pred, ms, label) {
    return new Promise((resolve, reject) => {
      const take = (m) => {
        const i = this.messages.indexOf(m);
        if (i >= 0) this.messages.splice(i, 1);
        return m;
      };
      const back = this.messages.find(pred);
      if (back) return resolve(take(back));
      const t = setTimeout(() => {
        this.removeListener('message', onMsg);
        reject(new Error('timeout waiting for ' + (label || pred.toString()) + ' after ' + ms + 'ms'));
      }, ms || 5000);
      const onMsg = (m) => {
        if (pred(m)) { clearTimeout(t); this.removeListener('message', onMsg); resolve(take(m)); }
      };
      this.on('message', onMsg);
    });
  }
  waitType(type, ms) { return this.wait((m) => m && m.t === type, ms, 'type=' + type); }
}

module.exports = { Client };
