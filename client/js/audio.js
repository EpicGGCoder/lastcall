/* ============================================================================
   LAST CALL — sound
   ----------------------------------------------------------------------------
   Every noise in this game is synthesised in the browser. No files, no
   downloads, no loading screen. A gunshot is noise plus a pitched-down thump;
   a blank is a filtered click; the room tone is two detuned oscillators and a
   slow filter sweep that makes a silent table feel like a place with a ceiling.

   Browsers will not let us make noise until the user touches something, so
   everything routes through ensure(), which is safe to call from anywhere.
   ========================================================================== */
'use strict';

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.room = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.85;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  /* -- building blocks ---------------------------------------------------- */

  noiseBuffer(seconds) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  noise(dur, opts) {
    const ctx = this.ensure(); if (!ctx) return;
    const o = opts || {};
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(Math.max(0.01, dur));
    const filt = ctx.createBiquadFilter();
    filt.type = o.type || 'bandpass';
    filt.frequency.value = o.freq || 1000;
    filt.Q.value = o.q != null ? o.q : 1;
    const g = ctx.createGain();
    const t = ctx.currentTime + (o.delay || 0);
    const peak = (o.gain != null ? o.gain : 0.3);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (o.sweep) {
      filt.frequency.setValueAtTime(o.freq || 1000, t);
      filt.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweep), t + dur);
    }
    src.connect(filt); filt.connect(g); g.connect(o.bus || this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  tone(freq, dur, opts) {
    const ctx = this.ensure(); if (!ctx) return;
    const o = opts || {};
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    const g = ctx.createGain();
    const t = ctx.currentTime + (o.delay || 0);
    const peak = o.gain != null ? o.gain : 0.2;
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.bus || this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  /* -- the sound of the game --------------------------------------------- */

  /* A live round. Loud, ugly, and slightly different every time. */
  gunshot(self) {
    const ctx = this.ensure(); if (!ctx) return;
    const v = 0.85 + Math.random() * 0.3;
    // crack
    this.noise(0.30, { freq: 2600 * v, sweep: 180, q: 0.7, gain: 0.62 * v, type: 'bandpass' });
    // body
    this.noise(0.55, { freq: 340, sweep: 60, q: 0.9, gain: 0.5, type: 'lowpass', delay: 0.004 });
    // thump
    this.tone(self ? 62 : 74, 0.42, { type: 'sine', gain: 0.55, to: 28 });
    this.tone(150, 0.14, { type: 'triangle', gain: 0.22, to: 50, delay: 0.01 });
    // tail
    this.noise(1.25, { freq: 420, sweep: 90, q: 0.4, gain: 0.10, type: 'lowpass', delay: 0.06, attack: 0.05 });
  }

  /* A blank. All click, no consequence — exactly like the real thing. */
  blank() {
    const ctx = this.ensure(); if (!ctx) return;
    this.noise(0.07, { freq: 3000, sweep: 900, q: 0.9, gain: 0.34 });
    this.noise(0.16, { freq: 500, sweep: 120, q: 0.8, gain: 0.16, type: 'lowpass', delay: 0.006 });
    this.tone(180, 0.09, { type: 'square', gain: 0.07, to: 90 });
  }

  hammer() {
    this.noise(0.035, { freq: 2200, q: 1.6, gain: 0.16 });
    this.tone(420, 0.04, { type: 'square', gain: 0.05, to: 300 });
  }

  click(pitch) {
    this.noise(0.028, { freq: pitch || 1800, q: 2.2, gain: 0.13 });
  }

  reload() {
    for (let i = 0; i < 5; i++) {
      this.click(1400 + i * 220 + Math.random() * 200);
      this.noise(0.05, { freq: 300 + i * 60, q: 3, gain: 0.10, delay: i * 0.085, type: 'bandpass' });
    }
    this.tone(90, 0.18, { type: 'triangle', gain: 0.14, delay: 0.36, to: 60 });
  }

  eject() {
    this.noise(0.20, { freq: 900, sweep: 300, q: 1.2, gain: 0.20 });
    this.tone(300, 0.16, { type: 'triangle', gain: 0.10, to: 140 });
    for (let i = 0; i < 3; i++) this.click(900 + Math.random() * 900);
  }

  chime(root, n) {
    const base = root || 523.25;
    const steps = [0, 4, 7, 12, 16];
    for (let i = 0; i < (n || 3); i++) {
      const f = base * Math.pow(2, steps[i % steps.length] / 12);
      this.tone(f, 0.5, { type: 'triangle', gain: 0.10, delay: i * 0.055, attack: 0.008 });
      this.tone(f * 2, 0.32, { type: 'sine', gain: 0.05, delay: i * 0.055 });
    }
  }

  bad() {
    this.tone(180, 0.28, { type: 'sawtooth', gain: 0.10, to: 70 });
    this.tone(120, 0.34, { type: 'sine', gain: 0.12, to: 48, delay: 0.04 });
  }

  hurt() {
    this.noise(0.22, { freq: 260, sweep: 90, q: 0.8, gain: 0.30, type: 'lowpass' });
    this.tone(88, 0.34, { type: 'sine', gain: 0.30, to: 40 });
  }

  heal() {
    this.chime(659.25, 4);
  }

  item() {
    this.tone(880, 0.09, { type: 'triangle', gain: 0.10 });
    this.tone(1320, 0.11, { type: 'sine', gain: 0.07, delay: 0.05 });
  }

  pop() {
    this.tone(720, 0.07, { type: 'sine', gain: 0.08, to: 1000 });
  }

  join() {
    this.chime(392, 3);
    this.tone(784, 0.18, { type: 'sine', gain: 0.07, delay: 0.1 });
  }

  /* Win: a genuinely warm little fanfare. Lose: the opposite of that. */
  victory() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone(f, 0.6, { type: 'triangle', gain: 0.13, delay: i * 0.12 });
      this.tone(f / 2, 0.7, { type: 'sine', gain: 0.09, delay: i * 0.12 });
    });
    this.noise(1.6, { freq: 3000, sweep: 400, q: 0.5, gain: 0.05, delay: 0.2, attack: 0.3 });
  }

  defeat() {
    const notes = [392, 349.23, 293.66, 220];
    notes.forEach((f, i) => {
      this.tone(f, 0.7, { type: 'triangle', gain: 0.12, delay: i * 0.17 });
      this.tone(f / 2, 0.8, { type: 'sine', gain: 0.10, delay: i * 0.17 });
    });
  }

  tick() {
    this.noise(0.02, { freq: 2400, q: 3, gain: 0.06 });
  }

  /* -- ambience ----------------------------------------------------------- */

  startRoom() {
    const ctx = this.ensure(); if (!ctx || this.room) return;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 3.5);
    g.connect(this.master);

    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 54;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 54.4;
    const o3 = ctx.createOscillator(); o3.type = 'triangle'; o3.frequency.value = 108.3;
    const lg = ctx.createGain(); lg.gain.value = 0.34;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 260; filt.Q.value = 0.6;

    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 90;
    lfo.connect(lfoGain); lfoGain.connect(filt.frequency);

    o1.connect(lg); o2.connect(lg); o3.connect(lg);
    lg.connect(filt); filt.connect(g);
    o1.start(); o2.start(); o3.start(); lfo.start();

    // a very quiet hiss so the room has air in it
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noiseBuffer(4);
    hiss.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 1400; hf.Q.value = 0.4;
    const hg = ctx.createGain(); hg.gain.value = 0.05;
    hiss.connect(hf); hf.connect(hg); hg.connect(g);
    hiss.start();

    this.room = { g, o1, o2, o3, lfo, hiss, filt };
    this.roomClinkTimer = setInterval(() => {
      if (this.muted) return;
      if (Math.random() < 0.45) {
        // occasional glass-and-cutlery noise from somewhere off screen
        const f = 1800 + Math.random() * 2600;
        this.noise(0.12, { freq: f, q: 8, gain: 0.020 });
        this.tone(f * 0.5, 0.22, { type: 'sine', gain: 0.012, delay: 0.01 });
      }
    }, 4200);
  }

  stopRoom() {
    if (this.roomClinkTimer) clearInterval(this.roomClinkTimer);
    if (this.room && this.ctx) {
      try {
        this.room.g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.6);
        setTimeout(() => { try { this.room.o1.stop(); this.room.o2.stop(); this.room.o3.stop(); this.room.hiss.stop(); } catch (e) {} }, 900);
      } catch (e) {}
      this.room = null;
    }
  }
}

export const sound = new Sound();
