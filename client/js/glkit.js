/* ============================================================================
   LAST CALL — the renderer
   ----------------------------------------------------------------------------
   One shader program. One point light with a flicker. Additive billboards for
   dust and muzzle flash. That is the whole graphics engine, and it fits on a
   phone because it refuses to do anything else.

   Perf commitments:
     - static geometry is merged at load into a handful of buffers
     - per-frame GL calls stay in the low hundreds, not thousands
     - devicePixelRatio is capped at 2, and the whole canvas is dropped to
       half resolution while the screen is shaking (nobody can tell)
   ========================================================================== */
'use strict';

const VERT = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aCol;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormal;
varying vec3 vCol;
varying vec3 vWorld;
varying vec3 vNrm;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNrm = normalize(uNormal * aNrm);
  vCol = aCol;
  gl_Position = uViewProj * world;
}`;

const FRAG = `
precision mediump float;
varying vec3 vCol;
varying vec3 vWorld;
varying vec3 vNrm;
uniform vec3 uLightPos;
uniform vec3 uLightCol;
uniform float uLightPower;
uniform vec3 uAmbient;
uniform float uAmbientBoost;
uniform vec3 uTint;
uniform float uOpacity;
uniform float uRim;
void main() {
  vec3 N = normalize(vNrm);
  vec3 toLight = uLightPos - vWorld;
  float dist = length(toLight);
  vec3 L = toLight / max(dist, 0.001);
  float atten = uLightPower / (1.0 + 0.14 * dist + 0.055 * dist * dist);
  float diff = max(dot(N, L), 0.0);
  // Cheap specular. Enough to make brass look like brass.
  vec3 V = normalize(-vWorld);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 34.0) * 0.45;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * uRim;
  vec3 col = vCol * uTint;
  vec3 lit = col * (uAmbient + uAmbientBoost) + col * uLightCol * diff * atten + uLightCol * spec * atten + col * rim;
  gl_FragColor = vec4(lit, uOpacity);
}`;

const GLOW_VERT = `
attribute vec3 aPos;
attribute vec3 aCol;
attribute float aSize;
uniform mat4 uViewProj;
varying vec3 vCol;
void main() {
  vCol = aCol;
  gl_Position = uViewProj * vec4(aPos, 1.0);
  gl_PointSize = aSize * 300.0 / max(gl_Position.w, 0.001);
}`;

const GLOW_FRAG = `
precision mediump float;
varying vec3 vCol;
uniform float uOpacity;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.05, r);
  a *= a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol * a, a * uOpacity);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}

export class Renderer {
  constructor(canvas) {
    const opts = {
      alpha: false, antialias: true, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false
    };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('no-webgl');
    this.gl = gl;
    this.canvas = canvas;
    this.main = program(gl, VERT, FRAG);
    this.glow = program(gl, GLOW_VERT, GLOW_FRAG);
    this.uniforms = {
      viewProj: gl.getUniformLocation(this.main, 'uViewProj'),
      model: gl.getUniformLocation(this.main, 'uModel'),
      normal: gl.getUniformLocation(this.main, 'uNormal'),
      lightPos: gl.getUniformLocation(this.main, 'uLightPos'),
      lightCol: gl.getUniformLocation(this.main, 'uLightCol'),
      lightPower: gl.getUniformLocation(this.main, 'uLightPower'),
      ambient: gl.getUniformLocation(this.main, 'uAmbient'),
      ambientBoost: gl.getUniformLocation(this.main, 'uAmbientBoost'),
      tint: gl.getUniformLocation(this.main, 'uTint'),
      opacity: gl.getUniformLocation(this.main, 'uOpacity'),
      rim: gl.getUniformLocation(this.main, 'uRim')
    };
    this.glowU = {
      viewProj: gl.getUniformLocation(this.glow, 'uViewProj'),
      opacity: gl.getUniformLocation(this.glow, 'uOpacity')
    };
    this.attribs = {
      pos: gl.getAttribLocation(this.main, 'aPos'),
      nrm: gl.getAttribLocation(this.main, 'aNrm'),
      col: gl.getAttribLocation(this.main, 'aCol')
    };
    this.glowAttribs = {
      pos: gl.getAttribLocation(this.glow, 'aPos'),
      col: gl.getAttribLocation(this.glow, 'aCol'),
      size: gl.getAttribLocation(this.glow, 'aSize')
    };

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.02, 0.018, 0.022, 1);

    this.buffers = new Map();
    this.triangles = 0;
  }

  /* Upload a mesh once, reuse the buffers forever. */
  upload(mesh, key) {
    const gl = this.gl;
    if (key && this.buffers.has(key)) return this.buffers.get(key);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.STATIC_DRAW);
    const nbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.nrm, gl.STATIC_DRAW);
    const cbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.col, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
    const rec = { vbo, nbo, cbo, ibo, count: mesh.count };
    if (key) this.buffers.set(key, rec);
    this.triangles += mesh.count / 3;
    return rec;
  }

  /* Swap a keyed mesh for new geometry (maps, guns). The cache that makes
     static draws cheap would otherwise make re-uploads silent no-ops. */
  replace(mesh, key) {
    const old = this.buffers.get(key);
    if (old) {
      this.gl.deleteBuffer(old.vbo);
      this.gl.deleteBuffer(old.nbo);
      this.gl.deleteBuffer(old.cbo);
      this.gl.deleteBuffer(old.ibo);
      this.buffers.delete(key);
    }
    return this.upload(mesh, key);
  }

  /* Upload a point cloud used for dust and sparks. */
  uploadPoints(cloud, key) {
    const gl = this.gl;
    if (key && this.buffers.has(key)) return this.buffers.get(key);
    const pbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pbo);
    gl.bufferData(gl.ARRAY_BUFFER, cloud.pos, gl.DYNAMIC_DRAW);
    const cbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
    gl.bufferData(gl.ARRAY_BUFFER, cloud.col, gl.DYNAMIC_DRAW);
    const sbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sbo);
    gl.bufferData(gl.ARRAY_BUFFER, cloud.size, gl.DYNAMIC_DRAW);
    const rec = { pbo, cbo, sbo, count: cloud.count };
    if (key) this.buffers.set(key, rec);
    return rec;
  }

  updatePoints(rec, cloud) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.pbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, cloud.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.cbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, cloud.col);
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.sbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, cloud.size);
  }

  resize(cap) {
    const dpr = Math.min(window.devicePixelRatio || 1, cap || 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    return w / h;
  }

  begin(viewProj, light) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.main);
    const u = this.uniforms;
    gl.uniformMatrix4fv(u.viewProj, false, viewProj);
    gl.uniform3fv(u.lightPos, light.pos);
    gl.uniform3fv(u.lightCol, light.colour);
    gl.uniform1f(u.lightPower, light.power);
    gl.uniform3fv(u.ambient, light.ambient);
    gl.uniform1f(u.ambientBoost, light.ambientBoost || 0);
  }

  /* Draw an uploaded mesh with a model matrix. */
  draw(rec, model, normal, opts) {
    const gl = this.gl;
    const o = opts || {};
    gl.uniformMatrix4fv(this.uniforms.model, false, model);
    gl.uniformMatrix3fv(this.uniforms.normal, false, normal);
    gl.uniform3fv(this.uniforms.tint, o.tint || [1, 1, 1]);
    gl.uniform1f(this.uniforms.opacity, o.opacity != null ? o.opacity : 1);
    gl.uniform1f(this.uniforms.rim, o.rim != null ? o.rim : 0.10);

    gl.bindBuffer(gl.ARRAY_BUFFER, rec.vbo);
    gl.enableVertexAttribArray(this.attribs.pos);
    gl.vertexAttribPointer(this.attribs.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.nbo);
    gl.enableVertexAttribArray(this.attribs.nrm);
    gl.vertexAttribPointer(this.attribs.nrm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.cbo);
    gl.enableVertexAttribArray(this.attribs.col);
    gl.vertexAttribPointer(this.attribs.col, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rec.ibo);
    gl.drawElements(gl.TRIANGLES, rec.count, gl.UNSIGNED_SHORT, 0);
  }

  beginGlow(viewProj, opacity) {
    const gl = this.gl;
    gl.useProgram(this.glow);
    gl.uniformMatrix4fv(this.glowU.viewProj, false, viewProj);
    gl.uniform1f(this.glowU.opacity, opacity != null ? opacity : 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
  }

  drawGlow(rec) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.pbo);
    gl.enableVertexAttribArray(this.glowAttribs.pos);
    gl.vertexAttribPointer(this.glowAttribs.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.cbo);
    gl.enableVertexAttribArray(this.glowAttribs.col);
    gl.vertexAttribPointer(this.glowAttribs.col, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, rec.sbo);
    gl.enableVertexAttribArray(this.glowAttribs.size);
    gl.vertexAttribPointer(this.glowAttribs.size, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, rec.count);
  }

  endGlow() {
    const gl = this.gl;
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /* Resolution dial: the screenshake frames do not need every pixel. */
  setResolutionScale(s) {
    if (this._scale === s) return;
    this._scale = s;
    const dpr = (Math.min(window.devicePixelRatio || 1, 2)) * s;
    this.canvas.width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
}
