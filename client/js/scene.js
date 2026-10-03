/* ============================================================================
   LAST CALL — the world
   ----------------------------------------------------------------------------
   The table, the revolver, the shells, the lamp, the dust, the camera.

   THE SHELL RING
   --------------
   The magazine is drawn as a ring of shell cases below the gun. It shows the
   public COUNT (three live, three blank) and never the ORDER, which is the
   secret the whole game runs on. When a shell is fired the server tells us its
   colour and we remove a matching shell from the ring at random — so the ring
   can never be reverse-engineered into a firing order. This is a genuine
   information-security requirement of the interface, not a flourish.
   ========================================================================== */
'use strict';

import { Renderer } from './glkit.js';
import { billboard, casing, cylinder, feltTexture, lamp, revolver, room, seat, shell, table } from './meshes.js';
import { M4, V3, clamp, lerp, approach, makeRandom } from './math.js';

const SEAT_RADIUS = 4.15;
const SEAT_HEIGHT = 0.95;
const GUN_Y = 0.62;
const RING_RADIUS = 1.32;

export class Scene {
  constructor(canvas) {
    this.renderer = new Renderer(canvas);
    this.rng = makeRandom(0x1a57ca11);
    this.time = 0;
    this.shake = 0;
    this.flash = 0;
    this.flashColour = [1, 0.95, 0.8];
    this.cam = {
      orbit: -0.35,
      orbitTarget: -0.35,
      radius: 8.6,
      radiusTarget: 8.6,
      height: 4.05,
      heightTarget: 4.05,
      look: [0, 0.35, 0],
      lookTarget: [0, 0.35, 0],
      fov: 52,
      fovTarget: 52
    };
    this.gunSpin = 0;
    this.gunRecoil = 0;
    this.gunTilt = 0;
    this.build();
    this.resize();
  }

  build() {
    const r = this.renderer;
    this.assets = {
      room: r.upload(room(), 'room'),
      table: r.upload(table(), 'table'),
      lamp: r.upload(lamp(), 'lamp'),
      gun: r.upload(revolver(), 'gun'),
      seat: r.upload(seat(), 'seat'),
      ring: r.upload(cylinder({ r1: 0.44, r2: 0.44, h: 0.03, seg: 20, open: true, caps: false, colour: [1, 1, 1] }), 'ring'),
      shellLive: r.upload(shell(true), 'shellLive'),
      shellBlank: r.upload(shell(false), 'shellBlank'),
      casing: r.upload(casing(), 'casing'),
      flash: r.upload(billboard(1, 1, [1, 1, 1]), 'flash'),
      feltTex: feltTexture(r.gl)
    };
    this.triangles = r.triangles;
    this.dust = this.makeDust(150);
    this.dustRec = r.uploadPoints(this.dust, 'dust');
    this.sparks = this.makeSparks(48);
    this.sparkRec = r.uploadPoints(this.sparks, 'sparks');
  }

  /* Dust hanging in the lamp light. It is the cheapest possible way to make a
     static room feel like a place. */
  makeDust(n) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const rad = Math.sqrt(this.rng()) * 3.1;
      pos[i * 3] = Math.cos(a) * rad;
      pos[i * 3 + 1] = this.rng() * 2.6 - 0.4;
      pos[i * 3 + 2] = Math.sin(a) * rad;
      const warm = 0.55 + this.rng() * 0.45;
      col[i * 3] = warm * 0.9; col[i * 3 + 1] = warm * 0.85; col[i * 3 + 2] = warm * 0.6;
      size[i] = 0.010 + this.rng() * 0.026;
      vel[i * 3] = (this.rng() - 0.5) * 0.045;
      vel[i * 3 + 1] = 0.010 + this.rng() * 0.045;
      vel[i * 3 + 2] = (this.rng() - 0.5) * 0.045;
    }
    return { pos, col, size, vel, count: n };
  }

  makeSparks(n) {
    return {
      pos: new Float32Array(n * 3).fill(9999),
      col: new Float32Array(n * 3),
      size: new Float32Array(n),
      vel: new Float32Array(n * 3),
      life: new Float32Array(n),
      count: n
    };
  }

  resize() {
    const rect = this.renderer.canvas.getBoundingClientRect();
    this.aspect = (rect.width || 1) / (rect.height || 1);
    this.renderer.resize(this.shake > 0.35 ? 1 : 2);
  }

  /* ---------------------------------------------------------------- shells */
  /* Seat a fresh ring. Read the public counts from the server, colour them,
     and shuffle the arrangement so it carries no order information at all. */
  loadMagazine(mag) {
    const slots = [];
    for (let i = 0; i < mag.live; i++) slots.push('live');
    for (let i = 0; i < mag.blank; i++) slots.push('blank');
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const t = slots[i]; slots[i] = slots[j]; slots[j] = t;
    }
    this.shells = slots.map((shell, i) => ({
      shell,
      slot: i,
      total: slots.length,
      spent: false,
      t: 0,
      fallT: 0,
      jitter: (this.rng() - 0.5) * 0.12
    }));
    this.casings = [];
  }

  /* Remove one shell of the given colour. Which one is random on purpose. */
  consumeShell(colour) {
    if (!this.shells) return;
    const pool = this.shells.filter((s) => !s.spent && s.shell === colour);
    const pick = pool.length ? pool[Math.floor(this.rng() * pool.length)]
                             : this.shells.find((s) => !s.spent);
    if (pick) { pick.spent = true; pick.fallT = 0; }
  }

  spendOne() {
    if (!this.shells) return;
    const left = this.shells.filter((s) => !s.spent);
    if (left.length) { const p = left[Math.floor(this.rng() * left.length)]; p.spent = true; p.fallT = 0; }
  }

  /* --------------------------------------------------------------- effects */
  fire(opts) {
    const o = opts || {};
    this.flash = 1;
    this.flashColour = o.shell === 'live' ? [1, 0.82, 0.42] : [1, 0.95, 0.78];
    this.shake = o.shell === 'live' ? (o.self ? 1.0 : 0.72) : 0.34;
    this.gunRecoil = 1;
    this.gunTilt = 0.35;
    this.spawnSparks(o.shell === 'live' ? 26 : 13);
    if (o.shell === 'live') this.camShove(o.self ? 1.35 : 0.7);
  }

  camShove(amount) {
    this.cam.radiusTarget = this.cam.radius - amount * 0.75;
    this.cam.shoveT = 0.55;
  }

  spawnSparks(n) {
    const s = this.sparks;
    let placed = 0;
    for (let i = 0; i < s.count && placed < n; i++) {
      if (s.life[i] > 0) continue;
      const a = this.rng() * Math.PI * 2;
      const up = this.rng();
      s.pos[i * 3] = Math.cos(a) * 0.06;
      s.pos[i * 3 + 1] = GUN_Y + 0.05;
      s.pos[i * 3 + 2] = -1.5;
      s.vel[i * 3] = Math.cos(a) * (0.6 + this.rng() * 1.4);
      s.vel[i * 3 + 1] = 0.5 + up * 1.8;
      s.vel[i * 3 + 2] = -0.7 - this.rng() * 1.6;
      const hot = 0.85 + this.rng() * 0.15;
      s.col[i * 3] = hot; s.col[i * 3 + 1] = hot * 0.72; s.col[i * 3 + 2] = hot * 0.32;
      s.size[i] = 0.012 + this.rng() * 0.03;
      s.life[i] = 0.42 + this.rng() * 0.5;
      placed++;
    }
  }

  addCasing(shell) {
    this.casings = this.casings || [];
    this.casings.push({
      shell,
      x: (this.rng() - 0.5) * 1.2,
      z: -2.4 - this.rng() * 1.1,
      y: 0.16,
      vy: 1.6 + this.rng() * 1.2,
      spin: (this.rng() - 0.5) * 14,
      angle: this.rng() * 6.28,
      tilt: 1.2 + this.rng(),
      rest: false,
      t: 0
    });
    if (this.casings.length > 22) this.casings.shift();
  }

  /* ------------------------------------------------------------------ view */
  seatPosition(index, count) {
    const a = (index / Math.max(1, count)) * Math.PI * 2 + Math.PI / count + this.cam.orbit * 0.35;
    return [Math.cos(a) * SEAT_RADIUS, SEAT_HEIGHT, Math.sin(a) * SEAT_RADIUS];
  }

  /* Where a player's DOM card should sit, in CSS pixels. */
  cardScreenPos(index, count, width, height, dpr) {
    const p = this.seatPosition(index, count);
    const world = [p[0], p[1] + 0.55, p[2]];
    const ndc = M4.project(this.viewProj, world);
    return {
      x: (ndc[0] * 0.5 + 0.5) * width,
      y: (-ndc[1] * 0.5 + 0.5) * height,
      depth: ndc[3],
      visible: ndc[3] > 0.001
    };
  }

  setCamera(mode, opts) {
    const o = opts || {};
    if (mode === 'table') {
      this.cam.radiusTarget = 8.6; this.cam.heightTarget = 4.05;
      this.cam.lookTarget = [0, 0.35, 0];
      this.cam.fovTarget = 52;
    } else if (mode === 'lean') {
      this.cam.radiusTarget = 6.4; this.cam.heightTarget = 2.6;
      this.cam.lookTarget = [0, 0.55, 0];
      this.cam.fovTarget = 46;
    } else if (mode === 'barrel') {
      this.cam.radiusTarget = 2.6; this.cam.heightTarget = 1.1;
      this.cam.lookTarget = [0, GUN_Y + 0.05, -1.4];
      this.cam.fovTarget = 40;
    } else if (mode === 'wide') {
      this.cam.radiusTarget = 11.5; this.cam.heightTarget = 5.6;
      this.cam.lookTarget = [0, 0.2, 0];
      this.cam.fovTarget = 56;
    }
    if (o.orbit != null) this.cam.orbitTarget = o.orbit;
  }

  /* ------------------------------------------------------------------ tick */
  update(dt, state) {
    this.time += dt;
    const cam = this.cam;

    // smooth the camera toward its targets
    cam.orbit = approach(cam.orbit, cam.orbitTarget, 2.4, dt);
    cam.height = approach(cam.height, cam.heightTarget, 3.0, dt);
    cam.fov = approach(cam.fov, cam.fovTarget, 3.0, dt);
    for (let i = 0; i < 3; i++) cam.look[i] = approach(cam.look[i], cam.lookTarget[i], 3.4, dt);

    if (cam.shoveT > 0) { cam.shoveT -= dt; if (cam.shoveT <= 0) cam.radiusTarget = cam.radiusBase || cam.radiusTarget; }

    // gentle idle drift so the scene is never perfectly still
    const drift = Math.sin(this.time * 0.19) * 0.16;
    cam.orbit += drift * dt;
    cam.radius = approach(cam.radius, cam.radiusTarget + Math.sin(this.time * 0.41) * 0.08, 2.6, dt);

    const eye = [
      Math.cos(cam.orbit) * cam.radius,
      cam.height + Math.sin(this.time * 0.31) * 0.06,
      Math.sin(cam.orbit) * cam.radius
    ];

    // shake
    this.shake = Math.max(0, this.shake - dt * 2.6);
    this.flash = Math.max(0, this.flash - dt * 4.2);
    const s = this.shake * this.shake;
    if (s > 0.001) {
      eye[0] += (Math.random() - 0.5) * s * 0.9;
      eye[1] += (Math.random() - 0.5) * s * 0.9;
      eye[2] += (Math.random() - 0.5) * s * 0.9;
    }

    const look = cam.look.slice();
    if (s > 0.001) {
      look[0] += (Math.random() - 0.5) * s * 0.4;
      look[1] += (Math.random() - 0.5) * s * 0.4;
    }

    const proj = M4.perspective(cam.fov * Math.PI / 180, this.aspect, 0.1, 60);
    const view = M4.lookAt(eye, look, [0, 1, 0]);
    this.viewProj = M4.multiply(proj, view);
    this.eye = eye;

    // gun idle rotation + recoil recovery
    this.gunSpin += dt * 0.28;
    this.gunRecoil = approach(this.gunRecoil, 0, 7, dt);
    this.gunTilt = approach(this.gunTilt, 0, 5, dt);

    // dust rises forever, wraps at the top
    const d = this.dust;
    for (let i = 0; i < d.count; i++) {
      d.pos[i * 3] += d.vel[i * 3] * dt;
      d.pos[i * 3 + 1] += d.vel[i * 3 + 1] * dt;
      d.pos[i * 3 + 2] += d.vel[i * 3 + 2] * dt;
      if (d.pos[i * 3 + 1] > 3.2) {
        d.pos[i * 3 + 1] = -0.5;
        const a = this.rng() * Math.PI * 2, rad = Math.sqrt(this.rng()) * 3.1;
        d.pos[i * 3] = Math.cos(a) * rad;
        d.pos[i * 3 + 2] = Math.sin(a) * rad;
      }
    }
    this.renderer.updatePoints(this.dustRec, d);

    // sparks
    const sp = this.sparks;
    let anySpark = false;
    for (let i = 0; i < sp.count; i++) {
      if (sp.life[i] <= 0) continue;
      anySpark = true;
      sp.life[i] -= dt;
      sp.vel[i * 3 + 1] -= 5.2 * dt;
      sp.pos[i * 3] += sp.vel[i * 3] * dt;
      sp.pos[i * 3 + 1] += sp.vel[i * 3 + 1] * dt;
      sp.pos[i * 3 + 2] += sp.vel[i * 3 + 2] * dt;
      if (sp.pos[i * 3 + 1] < 0.1) {
        sp.pos[i * 3 + 1] = 0.1;
        sp.vel[i * 3] *= 0.55; sp.vel[i * 3 + 2] *= 0.55; sp.vel[i * 3 + 1] *= -0.35;
      }
      const k = clamp(sp.life[i], 0, 1);
      sp.size[i] = 0.02 * k + 0.004;
      if (sp.life[i] <= 0) { sp.pos[i * 3 + 1] = 9999; sp.size[i] = 0; }
    }
    if (anySpark) this.renderer.updatePoints(this.sparkRec, sp);

    // shells: spent ones tip over and slide away from the ring
    if (this.shells) {
      for (const sh of this.shells) {
        sh.t += dt;
        if (sh.spent) sh.fallT = Math.min(1, sh.fallT + dt * 1.4);
      }
    }
    if (this.casings) {
      for (const c of this.casings) {
        c.t += dt;
        if (!c.rest) {
          c.vy -= 9.5 * dt;
          c.y += c.vy * dt;
          c.angle += c.spin * dt;
          if (c.y <= 0.08) { c.y = 0.08; c.vy *= -0.32; c.angle += c.spin * dt; if (Math.abs(c.vy) < 0.5) { c.rest = true; c.tilt = 1.57; } }
        }
      }
    }
  }

  render(state) {
    const r = this.renderer;
    const flicker = 1 + Math.sin(this.time * 11.3) * 0.03 + Math.sin(this.time * 27.7) * 0.018;
    const flashBoost = this.flash * this.flash;

    const light = {
      pos: [0, 2.0, 0],
      colour: [
        (1.05 + flashBoost * 1.4) * this.flashColour[0] * flicker,
        (0.92 + flashBoost * 1.2) * this.flashColour[1] * flicker,
        (0.68 + flashBoost * 0.7) * this.flashColour[2] * flicker
      ],
      power: 7.4 * flicker,
      ambient: [0.030, 0.026, 0.032],
      ambientBoost: flashBoost * 0.55
    };

    r.begin(this.viewProj, light);

    const I = M4.identity();
    r.draw(this.assets.room, I, M4.normalFrom(I), { rim: 0.02, tint: [1, 1, 1] });
    r.draw(this.assets.table, I, M4.normalFrom(I), { rim: 0.25 });
    r.draw(this.assets.lamp, I, M4.normalFrom(I), { rim: 0.1 });

    // seats + turn rings
    const players = (state && state.players) || [];
    const count = players.length || 1;
    for (let i = 0; i < count; i++) {
      const p = players[i];
      const pos = this.seatPosition(i, count);
      const m = M4.compose([pos[0], 0.12, pos[2]], [0, 0, p && !p.alive ? 1.35 : 0], [1, 1, 1]);
      const dead = p && !p.alive;
      r.draw(this.assets.seat, m, M4.normalFrom(m), { rim: 0.06, opacity: dead ? 0.55 : 1 });
      const isTurn = p && state.turnId === p.id;
      const ring = M4.compose([pos[0], 0.085, pos[2]], [0, 0, 0], isTurn ? [1.12, 1, 1.12] : [1, 1, 1]);
      const c = hexToRgb(p ? p.colour : '#ffd23f');
      const pulse = isTurn ? (0.75 + Math.sin(this.time * 5.2) * 0.25) : 0.0;
      r.draw(this.assets.ring, ring, M4.normalFrom(ring), {
        tint: [c[0] * (0.25 + pulse * 1.5), c[1] * (0.25 + pulse * 1.5), c[2] * (0.25 + pulse * 1.5)],
        rim: isTurn ? 0.5 : 0.05,
        opacity: dead ? 0.15 : (isTurn ? 1 : 0.42)
      });
    }

    // shell ring
    if (this.shells) {
      for (let i = 0; i < this.shells.length; i++) {
        const sh = this.shells[i];
        const frac = (sh.slot + sh.jitter) / Math.max(1, sh.total);
        const a = frac * Math.PI * 2 + this.time * 0.09;
        const fall = sh.fallT;
        const rad = RING_RADIUS + fall * 1.9;
        const y = 0.20 - fall * 0.06;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        const mesh = sh.shell === 'live' ? this.assets.shellLive : this.assets.shellBlank;
        const m = M4.compose(
          [x, y, z],
          [1.57 + fall * 1.5, -a + 1.57, fall * 1.6],
          [1, 1, 1]
        );
        r.draw(mesh, m, M4.normalFrom(m), {
          rim: 0.28,
          opacity: sh.spent ? Math.max(0, 1 - fall * 1.25) : 1,
          tint: sh.spent ? [0.4, 0.4, 0.4] : [1, 1, 1]
        });
      }
    }

    // ejected casings on the floor
    if (this.casings) {
      for (const c of this.casings) {
        const m = M4.compose([c.x, c.y, c.z], [c.tilt, c.angle, 0], [1, 1, 1]);
        r.draw(this.assets.casing, m, M4.normalFrom(m), { rim: 0.3 });
      }
    }

    // the gun
    const gx = this.gunRecoil * 0.30;
    const gy = GUN_Y + this.gunRecoil * 0.02;
    const gm = M4.compose(
      [0, gy, gx * 0.35],
      [this.gunTilt, this.gunSpin, 0],
      [1, 1, 1]
    );
    r.draw(this.assets.gun, gm, M4.normalFrom(gm), {
      rim: 0.42,
      tint: [1 + flashBoost * 0.8, 1 + flashBoost * 0.7, 1 + flashBoost * 0.5]
    });

    // additive layer: dust, sparks, muzzle flash
    r.beginGlow(this.viewProj, 1);
    r.drawGlow(this.dustRec);
    if (this.sparks.life.some ? true : true) r.drawGlow(this.sparkRec);
    if (this.flash > 0.02) {
      const f = this.flash;
      const bill = M4.compose([0, GUN_Y + 0.02, -1.62], [0, 0, 0], [2.4 * f + 0.4, 2.4 * f + 0.4, 1]);
      r.draw(this.assets.flash, bill, M4.normalFrom(bill), {
        tint: [this.flashColour[0] * 2.2 * f, this.flashColour[1] * 2.0 * f, this.flashColour[2] * 1.4 * f],
        opacity: f * 0.9
      });
    }
    r.endGlow();

    // point cloud size buffer is static; scale spark sizes via colour fade
    this.renderer.setResolutionScale(1);
  }
}

function hexToRgb(hex) {
  const h = String(hex || '#ffd23f').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
