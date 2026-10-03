/* ============================================================================
   LAST CALL — procedural geometry
   ----------------------------------------------------------------------------
   Every triangle in this game is generated at runtime from arithmetic. There
   are no model files, no textures, no fonts, no downloads. Total scene cost is
   around six thousand triangles and one 128x128 canvas texture for the felt
   grain.

   Meshes carry position, normal and a per-vertex tint so that a single shader
   can draw brass, steel and wood without a material system.
   ========================================================================== */
'use strict';

/* A mesh is a plain object: { pos: Float32Array, nrm, col, idx: Uint16Array } */
function blank() { return { pos: [], nrm: [], col: [], idx: [] }; }

function pushVert(m, p, n, c) {
  m.pos.push(p[0], p[1], p[2]);
  m.nrm.push(n[0], n[1], n[2]);
  m.col.push(c[0], c[1], c[2]);
  return m.pos.length / 3 - 1;
}

function finish(m) {
  return {
    pos: new Float32Array(m.pos),
    nrm: new Float32Array(m.nrm),
    col: new Float32Array(m.col),
    idx: new Uint16Array(m.idx),
    count: m.idx.length
  };
}

/* ---------------------------------------------------------------------------
   Primitives
   ------------------------------------------------------------------------- */

/* A cylinder / cone. open=true leaves the ends off (cheaper, and invisible
   from the angles this camera ever reaches). */
export function cylinder(opts) {
  const o = Object.assign({ r1: 1, r2: 1, h: 1, seg: 16, open: false, caps: true }, opts);
  const m = blank();
  const c = o.colour || [1, 1, 1];
  const cTop = o.colourTop || c;
  const half = o.h / 2;
  const slope = Math.atan2(o.r1 - o.r2, o.h);

  const rings = [];
  for (let i = 0; i <= o.seg; i++) {
    const a = (i / o.seg) * Math.PI * 2;
    const cx = Math.cos(a), sy = Math.sin(a);
    const nb = [cx * Math.cos(slope), Math.sin(slope), sy * Math.cos(slope)];
    rings.push({
      bottom: pushVert(m, [cx * o.r1, -half, sy * o.r1], nb, c),
      top: pushVert(m, [cx * o.r2, half, sy * o.r2], nb, cTop),
      cx, sy
    });
  }
  for (let i = 0; i < o.seg; i++) {
    const a = rings[i], b = rings[i + 1];
    m.idx.push(a.bottom, b.bottom, a.top, a.top, b.bottom, b.top);
  }
  if (o.caps) {
    const cb = pushVert(m, [0, -half, 0], [0, -1, 0], c);
    const ct = pushVert(m, [0, half, 0], [0, 1, 0], cTop);
    const rb = [], rt = [];
    for (let i = 0; i <= o.seg; i++) {
      const a = (i / o.seg) * Math.PI * 2;
      const cx = Math.cos(a), sy = Math.sin(a);
      rb.push(pushVert(m, [cx * o.r1, -half, sy * o.r1], [0, -1, 0], c));
      rt.push(pushVert(m, [cx * o.r2, half, sy * o.r2], [0, 1, 0], cTop));
    }
    for (let i = 0; i < o.seg; i++) {
      m.idx.push(cb, rb[i + 1], rb[i]);
      m.idx.push(ct, rt[i], rt[i + 1]);
    }
  }
  return finish(m);
}

export function box(opts) {
  const o = Object.assign({ w: 1, h: 1, d: 1 }, opts);
  const hx = o.w / 2, hy = o.h / 2, hz = o.d / 2;
  const m = blank();
  const c = o.colour || [1, 1, 1];
  const faces = [
    { n: [0, 0, 1],  v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { n: [1, 0, 0],  v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, 1, 0],  v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] }
  ];
  for (const f of faces) {
    const base = m.pos.length / 3;
    for (const v of f.v) pushVert(m, v, f.n, c);
    m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return finish(m);
}

export function sphere(opts) {
  const o = Object.assign({ r: 1, seg: 12, rings: 8 }, opts);
  const m = blank();
  const c = o.colour || [1, 1, 1];
  const grid = [];
  for (let y = 0; y <= o.rings; y++) {
    const v = y / o.rings, phi = v * Math.PI;
    const row = [];
    for (let x = 0; x <= o.seg; x++) {
      const u = x / o.seg, theta = u * Math.PI * 2;
      const n = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
      row.push(pushVert(m, [n[0] * o.r, n[1] * o.r, n[2] * o.r], n, c));
    }
    grid.push(row);
  }
  for (let y = 0; y < o.rings; y++) {
    for (let x = 0; x < o.seg; x++) {
      const a = grid[y][x], b = grid[y][x + 1], cc = grid[y + 1][x], d = grid[y + 1][x + 1];
      m.idx.push(a, cc, b, b, cc, d);
    }
  }
  return finish(m);
}

/* A ring of small holes punched into a face — used for the revolver chambers
   and the barrel muzzle. Not a real boolean; six dark cylinders sunk into the
   cylinder face read perfectly at this distance. */
export function disc(opts) {
  const o = Object.assign({ r: 1, seg: 12 }, opts);
  const m = blank();
  const c = o.colour || [1, 1, 1];
  const centre = pushVert(m, [0, 0, 0], [0, 1, 0], c);
  const rim = [];
  for (let i = 0; i <= o.seg; i++) {
    const a = (i / o.seg) * Math.PI * 2;
    rim.push(pushVert(m, [Math.cos(a) * o.r, 0, Math.sin(a) * o.r], [0, 1, 0], c));
  }
  for (let i = 0; i < o.seg; i++) m.idx.push(centre, rim[i], rim[i + 1]);
  return finish(m);
}

/* Merge several meshes, each with its own transform. This is the entire
   "scene graph". Mashing the shotgun into one buffer means the whole gun is a
   single draw call. */
export function merge(list, transform) {
  const out = blank();
  for (const part of list) {
    const mesh = part.mesh || part;
    const t = part.t || (transform && transform[mesh] ) || null;
    const base = out.pos.length / 3;
    const n = mesh.pos.length / 3;
    for (let i = 0; i < n; i++) {
      let p = [mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]];
      let nn = [mesh.nrm[i * 3], mesh.nrm[i * 3 + 1], mesh.nrm[i * 3 + 2]];
      if (t) { p = applyTRS(p, t); nn = applyRot(nn, t); }
      out.pos.push(p[0], p[1], p[2]);
      out.nrm.push(nn[0], nn[1], nn[2]);
      out.col.push(mesh.col[i * 3], mesh.col[i * 3 + 1], mesh.col[i * 3 + 2]);
    }
    for (let i = 0; i < mesh.idx.length; i++) out.idx.push(base + mesh.idx[i]);
  }
  return finish(out);
}

function applyTRS(p, t) {
  const r = t.rot || [0, 0, 0], s = t.scale || [1, 1, 1];
  const cx = Math.cos(r[0]), sx = Math.sin(r[0]);
  const cy = Math.cos(r[1]), sy = Math.sin(r[1]);
  const cz = Math.cos(r[2]), sz = Math.sin(r[2]);
  let x = p[0] * s[0], y = p[1] * s[1], z = p[2] * s[2];
  let x1 = x * cz - y * sz, y1 = x * sz + y * cz, z1 = z;
  let y2 = y1 * cx - z1 * sx, z2 = y1 * sx + z1 * cx, x2 = x1;
  let x3 = x2 * cy + z2 * sy, z3 = -x2 * sy + z2 * cy, y3 = y2;
  return [x3 + (t.pos ? t.pos[0] : 0), y3 + (t.pos ? t.pos[1] : 0), z3 + (t.pos ? t.pos[2] : 0)];
}

function applyRot(n, t) {
  const r = t.rot || [0, 0, 0];
  const cx = Math.cos(r[0]), sx = Math.sin(r[0]);
  const cy = Math.cos(r[1]), sy = Math.sin(r[1]);
  const cz = Math.cos(r[2]), sz = Math.sin(r[2]);
  let x = n[0], y = n[1], z = n[2];
  let x1 = x * cz - y * sz, y1 = x * sz + y * cz, z1 = z;
  let y2 = y1 * cx - z1 * sx, z2 = y1 * sx + z1 * cx, x2 = x1;
  return [x2 * cy + z2 * sy, y2, -x2 * sy + z2 * cy];
}

/* ---------------------------------------------------------------------------
   The props
   ------------------------------------------------------------------------- */

const STEEL     = [0.30, 0.33, 0.38];
const DARKSTEEL = [0.13, 0.14, 0.17];
const BRASS     = [0.85, 0.62, 0.20];
const REDSHELL  = [0.78, 0.12, 0.14];
const WOOD      = [0.42, 0.20, 0.10];
const FELT      = [0.06, 0.30, 0.20];
const LAMPSHADE = [0.32, 0.10, 0.07];

/* The revolver: barrel, frame, six chambers, grip. This is the hero object and
   it gets the most triangles in the scene — roughly 1,900. */
export function revolver() {
  const parts = [];
  const seg = 16;

  // barrel + underlug
  parts.push({ mesh: cylinder({ r1: 0.115, r2: 0.115, h: 1.5, seg, colour: STEEL }), t: { pos: [0, 0, -0.75], rot: [Math.PI / 2, 0, 0] } });
  parts.push({ mesh: cylinder({ r1: 0.055, r2: 0.055, h: 1.35, seg: 10, colour: DARKSTEEL }), t: { pos: [0, -0.10, -0.72], rot: [Math.PI / 2, 0, 0] } });
  // muzzle
  parts.push({ mesh: cylinder({ r1: 0.13, r2: 0.13, h: 0.06, seg, colour: DARKSTEEL }), t: { pos: [0, 0, -1.5], rot: [Math.PI / 2, 0, 0] } });
  parts.push({ mesh: cylinder({ r1: 0.06, r2: 0.06, h: 0.02, seg: 12, colour: [0.02, 0.02, 0.03] }), t: { pos: [0, 0, -1.53], rot: [Math.PI / 2, 0, 0] } });
  // frame / top strap
  parts.push({ mesh: box({ w: 0.22, h: 0.20, d: 0.55, colour: STEEL }), t: { pos: [0, 0.005, -0.05] } });
  parts.push({ mesh: box({ w: 0.20, h: 0.055, d: 0.5, colour: DARKSTEEL }), t: { pos: [0, 0.115, -0.12] } });
  // cylinder
  parts.push({ mesh: cylinder({ r1: 0.19, r2: 0.19, h: 0.40, seg: 14, colour: STEEL }), t: { pos: [0, 0, 0.22], rot: [Math.PI / 2, 0, 0] } });
  // six chambers, sunk into the front face
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push({
      mesh: cylinder({ r1: 0.045, r2: 0.045, h: 0.44, seg: 8, colour: [0.015, 0.015, 0.02] }),
      t: { pos: [Math.cos(a) * 0.105, Math.sin(a) * 0.105, 0.22], rot: [Math.PI / 2, 0, 0] }
    });
    parts.push({
      mesh: cylinder({ r1: 0.055, r2: 0.055, h: 0.03, seg: 8, colour: BRASS }),
      t: { pos: [Math.cos(a) * 0.105, Math.sin(a) * 0.105, 0.42], rot: [Math.PI / 2, 0, 0] }
    });
  }
  // crane pivot + trigger + guard
  parts.push({ mesh: cylinder({ r1: 0.035, r2: 0.035, h: 0.42, seg: 8, colour: DARKSTEEL }), t: { pos: [0, -0.12, 0.24] } });
  parts.push({ mesh: box({ w: 0.05, h: 0.16, d: 0.06, colour: DARKSTEEL }), t: { pos: [0, -0.16, 0.02], rot: [0.3, 0, 0] } });
  parts.push({ mesh: cylinder({ r1: 0.085, r2: 0.085, h: 0.045, seg: 10, open: true, caps: false, colour: DARKSTEEL }), t: { pos: [0, -0.20, 0.0], rot: [0, 0, Math.PI / 2] } });
  // hammer, cocked back
  parts.push({ mesh: box({ w: 0.05, h: 0.13, d: 0.09, colour: DARKSTEEL }), t: { pos: [0, 0.14, 0.40], rot: [-0.5, 0, 0] } });
  parts.push({ mesh: box({ w: 0.07, h: 0.03, d: 0.07, colour: [0.20, 0.20, 0.23] }), t: { pos: [0, 0.20, 0.45], rot: [-0.5, 0, 0] } });
  // grip
  parts.push({ mesh: box({ w: 0.16, h: 0.52, d: 0.14, colour: WOOD }), t: { pos: [0, -0.34, 0.50], rot: [0.55, 0, 0] } });
  parts.push({ mesh: box({ w: 0.17, h: 0.10, d: 0.15, colour: BRASS }), t: { pos: [0, -0.13, 0.42], rot: [0.55, 0, 0] } });

  return merge(parts);
}

/* One shotgun shell. Live shells are red, blanks are pale brass — the game's
   colour language, established without a single word of tutorial. */
export function shell(live) {
  const brass = live ? [0.80, 0.55, 0.18] : [0.62, 0.55, 0.30];
  const hull  = live ? REDSHELL : [0.86, 0.80, 0.62];
  const parts = [
    { mesh: cylinder({ r1: 0.085, r2: 0.085, h: 0.10, seg: 10, colour: brass }), t: { pos: [0, -0.16, 0] } },
    { mesh: cylinder({ r1: 0.085, r2: 0.088, h: 0.26, seg: 10, colour: brass }), t: { pos: [0, -0.02, 0] } },
    { mesh: cylinder({ r1: 0.088, r2: 0.088, h: 0.55, seg: 10, colour: hull }), t: { pos: [0, 0.30, 0] } },
    { mesh: cylinder({ r1: 0.088, r2: 0.086, h: 0.05, seg: 10, colour: [0.75, 0.72, 0.60] }), t: { pos: [0, 0.60, 0] } }
  ];
  return merge(parts);
}

export function casing() {
  return merge([
    { mesh: cylinder({ r1: 0.075, r2: 0.078, h: 0.30, seg: 9, colour: BRASS }) },
    { mesh: cylinder({ r1: 0.081, r2: 0.079, h: 0.035, seg: 9, colour: [0.55, 0.40, 0.14] }), t: { pos: [0, -0.16, 0] } }
  ]);
}

/* The table. A ring of felt over a wooden drum. */
export function table(map) {
  return tableFor(map);
}
function tableFor(map) {
  const pal = MAP_PALETTES[map] || MAP_PALETTES.backroom;
  return merge([
    { mesh: cylinder({ r1: 3.15, r2: 3.15, h: 0.16, seg: 40, colour: pal.rim }), t: { pos: [0, -0.14, 0] } },
    { mesh: cylinder({ r1: 3.02, r2: 3.02, h: 0.10, seg: 40, colour: pal.felt }), t: { pos: [0, 0.02, 0] } },
    { mesh: cylinder({ r1: 3.22, r2: 3.22, h: 0.22, seg: 40, open: true, caps: false, colour: [0.24, 0.11, 0.06] }), t: { pos: [0, -0.10, 0] } },
    { mesh: cylinder({ r1: 0.55, r2: 0.42, h: 0.9, seg: 16, colour: [0.20, 0.10, 0.06] }), t: { pos: [0, -0.62, 0] } },
    { mesh: cylinder({ r1: 1.05, r2: 1.05, h: 0.10, seg: 20, colour: [0.16, 0.08, 0.05] }), t: { pos: [0, -1.05, 0] } }
  ]);
}

/* The room. Four walls and a floor, seen only at the edges of the lamp light,
   which is exactly how much set dressing this game needs. */
/* Three rooms, one geometry budget: the maps are palettes plus a couple of
   signature props, because a room is recognised by its light, not its floor
   plan. */
export const MAP_PALETTES = {
  backroom: { wall: [0.07, 0.055, 0.05], floor: [0.05, 0.045, 0.042], felt: [0.06, 0.30, 0.20], rim: [0.42, 0.20, 0.10], shade: [0.55, 0.20, 0.12], bulb: [1.0, 0.92, 0.70] },
  diner:    { wall: [0.045, 0.13, 0.12], floor: [0.08, 0.09, 0.09],  felt: [0.10, 0.30, 0.28], rim: [0.52, 0.53, 0.56], shade: [0.70, 0.74, 0.78], bulb: [0.85, 0.96, 1.0] },
  rooftop:  { wall: [0.040, 0.045, 0.10], floor: [0.055, 0.055, 0.07], felt: [0.09, 0.11, 0.19], rim: [0.28, 0.26, 0.24], shade: [0.16, 0.13, 0.26], bulb: [1.0, 0.72, 0.50] }
};

export function room(map) {
  const pal = MAP_PALETTES[map] || MAP_PALETTES.backroom;
  const R = 9, H = 5.5;
  const wall = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    wall.push({
      mesh: box({ w: R * 1.05, h: H, d: 0.2, colour: pal.wall }),
      t: { pos: [Math.cos(a) * R, H / 2 - 1.6, Math.sin(a) * R], rot: [0, -a + Math.PI / 2, 0] }
    });
  }
  wall.push({ mesh: cylinder({ r1: 13, r2: 13, h: 0.3, seg: 24, colour: pal.floor }), t: { pos: [0, -2.4, 0] } });
  if (map === 'diner') {
    // a neon strip and a chrome rail: the whole identity of the place
    wall.push({ mesh: box({ w: 7, h: 0.10, d: 0.10, colour: [1.5, 0.35, 0.55] }), t: { pos: [0, 1.6, -8.8] } });
    wall.push({ mesh: box({ w: 7, h: 0.06, d: 0.06, colour: [0.35, 1.3, 1.2] }), t: { pos: [0, 1.35, -8.8] } });
  }
  if (map === 'rooftop') {
    // skyline: dark slabs beyond the parapet, and stars that cost nothing
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const h = 1.2 + (i % 4) * 0.9;
      wall.push({ mesh: box({ w: 2.4, h, d: 1.2, colour: [0.02, 0.022, 0.05] }), t: { pos: [Math.cos(a) * 12, h / 2 - 1.2, Math.sin(a) * 12] } });
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      wall.push({ mesh: box({ w: 0.05, h: 0.05, d: 0.05, colour: [1.4, 1.4, 1.5] }), t: { pos: [Math.cos(a) * 11.5, 3.4 + (i % 3) * 0.7, Math.sin(a) * 11.5] } });
    }
  }
  return merge(wall);
}

/* The lamp. A cone shade with a hot bulb under it and a cord going nowhere. */
export function lamp(map) {
  const pal = MAP_PALETTES[map] || MAP_PALETTES.backroom;
  const bits = [
    { mesh: cylinder({ r1: 0.035, r2: 0.035, h: 2.4, seg: 6, colour: [0.05, 0.04, 0.04] }), t: { pos: [0, 3.7, 0] } }
  ];
  if (map === 'rooftop') {
    // a string of bulbs instead of a shade: cheaper than a roof
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      bits.push({ mesh: sphere({ r: 0.16, seg: 8, rings: 6, colour: pal.bulb }), t: { pos: [Math.cos(a) * 0.5, 1.95 - (i % 2) * 0.15, Math.sin(a) * 0.5] } });
      bits.push({ mesh: cylinder({ r1: 0.012, r2: 0.012, h: 1.2, seg: 5, colour: [0.06, 0.05, 0.05] }), t: { pos: [Math.cos(a) * 0.5, 2.6, Math.sin(a) * 0.5], rot: [0.3 * Math.cos(a), 0, 0.3 * Math.sin(a)] } });
    }
  } else {
    bits.push({ mesh: cylinder({ r1: 1.9, r2: 0.42, h: 0.85, seg: 28, open: true, caps: false, colour: pal.shade }), t: { pos: [0, 2.05, 0] } });
    bits.push({ mesh: cylinder({ r1: 0.44, r2: 0.44, h: 0.05, seg: 16, colour: [0.12, 0.05, 0.04] }), t: { pos: [0, 2.46, 0] } });
    bits.push({ mesh: sphere({ r: 0.20, seg: 10, rings: 7, colour: pal.bulb }), t: { pos: [0, 1.80, 0] } });
  }
  return merge(bits);
}

/* Two more guns and a precious one. The golden revolver is the revolver,
   drawn with a tint — vanity should not cost triangles. */
export function sawedoff() {
  return merge([
    { mesh: cylinder({ r1: 0.10, r2: 0.10, h: 0.95, seg: 12, colour: [0.22, 0.24, 0.28] }), t: { pos: [0, 0, -0.55], rot: [1.5708, 0, 0] } },
    { mesh: cylinder({ r1: 0.16, r2: 0.16, h: 0.34, seg: 12, colour: [0.30, 0.32, 0.37] }), t: { pos: [0, 0, -0.05], rot: [1.5708, 0, 0] } },
    { mesh: box({ w: 0.10, h: 0.34, d: 0.16, colour: [0.35, 0.18, 0.09] }), t: { pos: [0, -0.20, 0.22], rot: [0.35, 0, 0] } },
    { mesh: box({ w: 0.06, h: 0.10, d: 0.10, colour: [0.22, 0.24, 0.28] }), t: { pos: [0, 0.14, 0.10] } }
  ]);
}

export function flintlock() {
  return merge([
    { mesh: cylinder({ r1: 0.05, r2: 0.055, h: 2.1, seg: 10, colour: [0.24, 0.26, 0.30] }), t: { pos: [0, 0.02, -0.85], rot: [1.5708, 0, 0] } },
    { mesh: cylinder({ r1: 0.09, r2: 0.09, h: 0.5, seg: 10, colour: [0.40, 0.24, 0.12] }), t: { pos: [0, -0.02, 0.42], rot: [1.5708, 0, 0] } },
    { mesh: box({ w: 0.07, h: 0.30, d: 0.14, colour: [0.40, 0.24, 0.12] }), t: { pos: [0, -0.18, 0.62], rot: [0.5, 0, 0] } },
    { mesh: sphere({ r: 0.06, seg: 8, rings: 6, colour: [0.55, 0.50, 0.40] }), t: { pos: [0.06, 0.10, 0.30] } },
    { mesh: box({ w: 0.03, h: 0.12, d: 0.03, colour: [0.55, 0.50, 0.40] }), t: { pos: [0, 0.10, -1.75] } }
  ]);
}

/* A chair marker. These are what the DOM player cards are anchored to. */
export function seat() {
  return merge([
    { mesh: cylinder({ r1: 0.42, r2: 0.42, h: 0.08, seg: 12, colour: [0.20, 0.13, 0.09] }), t: { pos: [0, 0, 0] } },
    { mesh: cylinder({ r1: 0.10, r2: 0.10, h: 1.05, seg: 8, open: true, caps: false, colour: [0.16, 0.10, 0.07] }), t: { pos: [0, -0.55, 0] } },
    { mesh: box({ w: 0.72, h: 0.85, d: 0.10, colour: [0.19, 0.12, 0.08] }), t: { pos: [0, 0.46, 0.38], rot: [-0.12, 0, 0] } }
  ]);
}

/* Item token: a chunky little die with a coloured face, sat in front of a
   player's seat. Reads at a glance which is the whole job. */
export function token(colour) {
  return merge([
    { mesh: box({ w: 0.34, h: 0.10, d: 0.52, colour: [0.10, 0.10, 0.12] }) },
    { mesh: box({ w: 0.30, h: 0.045, d: 0.46, colour }), t: { pos: [0, 0.06, 0] } }
  ]);
}

export function billboard(w, h, colour) {
  const m = blank();
  const c = colour || [1, 1, 1];
  const idx = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  for (const p of idx) pushVert(m, [p[0], p[1], 0], [0, 0, 1], c);
  m.idx.push(0, 1, 2, 0, 2, 3);
  return finish(m);
}

export function quadXZ(w, d, colour) {
  const m = blank();
  const c = colour || [1, 1, 1];
  const pts = [[-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2]];
  for (const p of pts) pushVert(m, p, [0, 1, 0], c);
  m.idx.push(0, 2, 1, 0, 3, 2);
  return finish(m);
}

/* Generate the felt grain once, on a canvas, and keep it forever. This is the
   only texture in the build and it costs 128x128 bytes of VRAM. */
export function feltTexture(gl) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d3a28';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const v = Math.random();
    ctx.fillStyle = v > 0.5
      ? 'rgba(255,255,255,' + (0.015 + Math.random() * 0.03) + ')'
      : 'rgba(0,0,0,' + (0.02 + Math.random() * 0.05) + ')';
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}

export function triangleCount(mesh) { return mesh.count / 3; }

/* ============================================================================
   CHARACTERS
   ----------------------------------------------------------------------------
   A seated person is seven animatable parts, not one mesh: the scene moves
   the head to look around, slides pupils inside the eyes, opens the mouth to
   talk, raises the arms to cheer, and — when a live round lands — detaches
   the head entirely and lets physics take it.

   Faces are deliberately toy-like: oversized eye whites, big pupils, one
   small mouth. Round reads friendly; angular reads horrific, and this table
   has enough horror in the rules already.
   ========================================================================== */

const SPECIES = {
  fedora:    { skin: [0.83, 0.62, 0.45], cloth: [0.24, 0.22, 0.28], h: 1.00, hw: 1.00 },
  shades:    { skin: [0.55, 0.38, 0.28], cloth: [0.16, 0.22, 0.30], h: 1.02, hw: 0.98 },
  moustache: { skin: [0.90, 0.72, 0.55], cloth: [0.30, 0.20, 0.16], h: 0.98, hw: 1.10 },
  cigarette: { skin: [0.72, 0.55, 0.42], cloth: [0.20, 0.26, 0.22], h: 1.00, hw: 0.95 },
  moth:      { skin: [0.78, 0.70, 0.58], cloth: [0.35, 0.30, 0.24], h: 0.92, hw: 0.85 },
  cat:       { skin: [0.85, 0.78, 0.70], cloth: [0.30, 0.24, 0.34], h: 0.94, hw: 0.88 },
  skull:     { skin: [0.92, 0.90, 0.84], cloth: [0.16, 0.16, 0.20], h: 1.00, hw: 0.96 },
  cactus:    { skin: [0.36, 0.62, 0.36], cloth: [0.42, 0.30, 0.20], h: 1.06, hw: 0.80 },
  toucan:    { skin: [0.20, 0.20, 0.24], cloth: [0.85, 0.45, 0.15], h: 0.96, hw: 0.90 },
  toaster:   { skin: [0.72, 0.74, 0.78], cloth: [0.55, 0.30, 0.30], h: 0.90, hw: 1.05 }
};

const at = (mesh, x, y, z, rot, scale) => ({ mesh, t: { pos: [x, y, z], rot: rot || [0, 0, 0], scale: scale || [1, 1, 1] } });

export function characterParts(kind, accent) {
  const sp = SPECIES[kind] || SPECIES.fedora;
  const skin = sp.skin, cloth = sp.cloth;
  const acc = accent || [0.91, 0.69, 0.29];
  const parts = {};
  const HR = 0.24 * sp.hw;

  /* torso: soft tapered column, shoulder bar, neck stub */
  parts.torso = merge([
    at(cylinder({ r1: 0.30 * sp.hw, r2: 0.22 * sp.hw, h: 0.62, seg: 10, colour: cloth }), 0, 0.31, 0),
    at(box({ w: 0.62 * sp.hw, h: 0.16, d: 0.30 * sp.hw, colour: cloth.map((c) => Math.min(1, c * 1.08)) }), 0, 0.60, 0),
    at(cylinder({ r1: 0.09, r2: 0.09, h: 0.12, seg: 8, colour: skin }), 0, 0.68, 0)
  ]);

  /* head group pivots at the neck (y=0.74 in seat space) */
  const HY = 0.74;
  const bits = [
    at(sphere({ r: HR, seg: 10, rings: 8, colour: skin }), 0, HY + 0.20, 0, [0, 0, 0], [1, 1.06, 1]),
    at(sphere({ r: 0.068, seg: 8, rings: 6, colour: [1.35, 1.35, 1.32] }), -0.095, HY + 0.24, HR * 0.74),
    at(sphere({ r: 0.068, seg: 8, rings: 6, colour: [1.35, 1.35, 1.32] }), 0.095, HY + 0.24, HR * 0.74),
    at(box({ w: 0.20, h: 0.028, d: 0.05, colour: skin.map((c) => c * 0.8) }), 0, HY + 0.335, HR * 0.78)
  ];
  const gear = {
    fedora: () => [
      at(cylinder({ r1: 0.30, r2: 0.30, h: 0.02, seg: 12, colour: [0.15, 0.13, 0.12] }), 0, HY + 0.34, 0),
      at(cylinder({ r1: 0.16, r2: 0.14, h: 0.16, seg: 12, colour: [0.15, 0.13, 0.12] }), 0, HY + 0.42, 0),
      at(cylinder({ r1: 0.165, r2: 0.165, h: 0.03, seg: 12, colour: acc }), 0, HY + 0.365, 0)
    ],
    shades: () => [
      at(box({ w: 0.26, h: 0.075, d: 0.05, colour: [0.08, 0.08, 0.10] }), 0, HY + 0.245, HR * 0.86),
      at(box({ w: 0.30, h: 0.02, d: 0.04, colour: [0.08, 0.08, 0.10] }), 0, HY + 0.275, HR * 0.6)
    ],
    moustache: () => [
      at(box({ w: 0.17, h: 0.05, d: 0.06, colour: [0.25, 0.16, 0.10] }), 0, HY + 0.145, HR * 0.86),
      at(box({ w: 0.05, h: 0.06, d: 0.05, colour: [0.25, 0.16, 0.10] }), -0.08, HY + 0.125, HR * 0.84),
      at(box({ w: 0.05, h: 0.06, d: 0.05, colour: [0.25, 0.16, 0.10] }), 0.08, HY + 0.125, HR * 0.84)
    ],
    cigarette: () => [
      at(cylinder({ r1: 0.014, r2: 0.014, h: 0.16, seg: 6, colour: [0.92, 0.90, 0.85] }), 0.13, HY + 0.14, HR * 0.8, [0, 0, 1.2]),
      at(sphere({ r: 0.02, seg: 6, rings: 4, colour: [1.0, 0.35, 0.15] }), 0.20, HY + 0.145, HR * 0.8)
    ],
    moth: () => [
      at(box({ w: 0.16, h: 0.20, d: 0.02, colour: [0.80, 0.72, 0.55] }), -0.17, HY + 0.30, -0.06, [0, 0.5, 0.4]),
      at(box({ w: 0.16, h: 0.20, d: 0.02, colour: [0.80, 0.72, 0.55] }), 0.17, HY + 0.30, -0.06, [0, -0.5, -0.4]),
      at(cylinder({ r1: 0.008, r2: 0.008, h: 0.14, seg: 5, colour: [0.4, 0.35, 0.3] }), -0.06, HY + 0.42, 0.05, [0.5, 0, 0.3]),
      at(cylinder({ r1: 0.008, r2: 0.008, h: 0.14, seg: 5, colour: [0.4, 0.35, 0.3] }), 0.06, HY + 0.42, 0.05, [0.5, 0, -0.3])
    ],
    cat: () => [
      at(cylinder({ r1: 0.075, r2: 0.01, h: 0.13, seg: 4, colour: skin }), -0.13, HY + 0.40, 0),
      at(cylinder({ r1: 0.075, r2: 0.01, h: 0.13, seg: 4, colour: skin }), 0.13, HY + 0.40, 0),
      at(cylinder({ r1: 0.045, r2: 0.008, h: 0.09, seg: 4, colour: [0.90, 0.55, 0.60] }), -0.13, HY + 0.39, 0.02),
      at(cylinder({ r1: 0.045, r2: 0.008, h: 0.09, seg: 4, colour: [0.90, 0.55, 0.60] }), 0.13, HY + 0.39, 0.02)
    ],
    skull: () => [
      at(box({ w: 0.24, h: 0.10, d: 0.06, colour: acc }), 0, HY + 0.32, HR * 0.7),
      at(box({ w: 0.10, h: 0.16, d: 0.05, colour: acc }), 0, HY + 0.14, HR * 0.9)
    ],
    cactus: () => [
      at(cylinder({ r1: 0.05, r2: 0.02, h: 0.10, seg: 6, colour: [0.95, 0.45, 0.60] }), 0.05, HY + 0.45, 0.02),
      at(cylinder({ r1: 0.05, r2: 0.05, h: 0.02, seg: 6, colour: [0.98, 0.85, 0.30] }), 0.05, HY + 0.50, 0.02)
    ],
    toucan: () => [
      at(cylinder({ r1: 0.09, r2: 0.02, h: 0.30, seg: 8, colour: [0.95, 0.55, 0.15] }), 0, HY + 0.18, HR + 0.10, [1.45, 0, 0]),
      at(cylinder({ r1: 0.05, r2: 0.02, h: 0.10, seg: 6, colour: [0.20, 0.60, 0.60] }), 0, HY + 0.40, -0.05, [0.6, 0, 0])
    ],
    toaster: () => [
      at(box({ w: 0.30, h: 0.05, d: 0.22, colour: [0.35, 0.36, 0.40] }), 0, HY + 0.40, 0),
      at(box({ w: 0.10, h: 0.06, d: 0.14, colour: [0.85, 0.75, 0.55] }), -0.07, HY + 0.44, 0),
      at(box({ w: 0.10, h: 0.06, d: 0.14, colour: [0.85, 0.75, 0.55] }), 0.07, HY + 0.44, 0),
      at(cylinder({ r1: 0.02, r2: 0.02, h: 0.10, seg: 6, colour: [0.85, 0.20, 0.20] }), 0.17, HY + 0.32, 0.08)
    ]
  };
  parts.head = merge(bits.concat((gear[kind] || gear.fedora)()));

  parts.pupilL = sphere({ r: 0.027, seg: 6, rings: 5, colour: [0.08, 0.07, 0.08] });
  parts.pupilR = sphere({ r: 0.027, seg: 6, rings: 5, colour: [0.08, 0.07, 0.08] });
  parts.mouth = box({ w: 0.105, h: 0.036, d: 0.05, colour: [0.34, 0.11, 0.13] });

  /* arms pivot at the shoulder (y=0.58); the hand sphere hangs at the far end */
  const arm = merge([
    at(cylinder({ r1: 0.075, r2: 0.06, h: 0.42, seg: 7, colour: cloth.map((c) => Math.min(1, c * 1.1)) }), 0, -0.21, 0),
    at(sphere({ r: 0.075, seg: 7, rings: 5, colour: skin }), 0, -0.44, 0)
  ]);
  parts.armL = arm;
  parts.armR = arm;

  parts.meta = { skin, cloth, acc, h: sp.h, hw: sp.hw, HY, HR, eyeY: HY + 0.24, eyeX: 0.095, eyeZ: HR * 0.74, shoulderY: 0.58 };
  return parts;
}
