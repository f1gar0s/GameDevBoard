// Упрощённая 3D-модель рельефа: серая сетка без цветов, вращение мышью, экспорт OBJ.
import { h, modal, download, toast } from './util.js';
import { SEA, sample } from './terrain.js';

// ---------- матрицы ----------
const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; };
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function lookAt(e, t) {
  let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2]; const zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
  let xx = zz, xy = 0, xz = -zx; const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xz /= xl; // up = (0,1,0)
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
}

// сетка gw×gh из карты высот
function grid(E, W, H, max) {
  const k = Math.min(1, max / Math.max(W, H));
  const gw = Math.max(2, Math.round(W * k)), gh = Math.max(2, Math.round(H * k));
  const G = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) G[y * gw + x] = sample(E, W, H, (x / (gw - 1)) * (W - 1), (y / (gh - 1)) * (H - 1));
  return { G, gw, gh };
}

export function open3D(E, W, H, { title = 'Рельеф', name = 'terrain' } = {}) {
  const cw = Math.min(900, innerWidth - 80), ch = Math.min(540, innerHeight - 260);
  const cv = h('canvas', { width: cw * devicePixelRatio, height: ch * devicePixelRatio, class: 't3d-cv', style: { width: cw + 'px', height: ch + 'px' } });
  const gl = cv.getContext('webgl', { antialias: true });
  if (!gl) { toast('Браузер не поддерживает WebGL — 3D-просмотр недоступен', 'err'); return; }
  const st = { yaw: 0.7, pitch: 0.75, dist: 2.6, hs: 0.35, water: true, wire: false };
  const { G, gw, gh } = grid(E, W, H, 180);
  const asp = W / H, sx = asp >= 1 ? 1 : asp, sz = asp >= 1 ? 1 / asp : 1;

  // ---------- шейдеры ----------
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, `attribute vec3 p; attribute vec3 n; uniform mat4 m; uniform float hs; varying vec3 vn; varying float vy;
    void main(){ vec3 q = vec3(p.x, p.y * hs, p.z); vn = normalize(vec3(n.x, n.y / max(hs, .001), n.z)); vy = p.y; gl_Position = m * vec4(q, 1.); }`));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `precision mediump float; varying vec3 vn; varying float vy; uniform float mode; uniform float alpha;
    void main(){ vec3 L = normalize(vec3(.5, .9, .35)); float d = max(dot(normalize(vn), L), 0.);
      float c = mode > 1.5 ? .25 : mode > .5 ? .86 : .18 + .72 * d;
      gl_FragColor = vec4(vec3(c), alpha); }`));
  gl.linkProgram(prog); gl.useProgram(prog);
  const loc = { p: gl.getAttribLocation(prog, 'p'), n: gl.getAttribLocation(prog, 'n'), m: gl.getUniformLocation(prog, 'm'), hs: gl.getUniformLocation(prog, 'hs'), mode: gl.getUniformLocation(prog, 'mode'), alpha: gl.getUniformLocation(prog, 'alpha') };

  // ---------- геометрия ----------
  const pos = new Float32Array(gw * gh * 3), nor = new Float32Array(gw * gh * 3);
  const Y = (x, y) => (G[Math.max(0, Math.min(gh - 1, y)) * gw + Math.max(0, Math.min(gw - 1, x))] - SEA) * 2;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = (y * gw + x) * 3;
    pos[i] = ((x / (gw - 1)) * 2 - 1) * sx; pos[i + 1] = Y(x, y); pos[i + 2] = ((y / (gh - 1)) * 2 - 1) * sz;
    const dx = (Y(x + 1, y) - Y(x - 1, y)) / ((2 / (gw - 1)) * sx * 2), dz = (Y(x, y + 1) - Y(x, y - 1)) / ((2 / (gh - 1)) * sz * 2);
    const l = Math.hypot(dx, 1, dz); nor[i] = -dx / l; nor[i + 1] = 1 / l; nor[i + 2] = -dz / l;
  }
  const tri = new Uint16Array((gw - 1) * (gh - 1) * 6);
  let t = 0;
  for (let y = 0; y < gh - 1; y++) for (let x = 0; x < gw - 1; x++) { const a = y * gw + x, b = a + 1, c = a + gw, d = c + 1; tri.set([a, c, b, b, c, d], t); t += 6; }
  const lines = [];
  for (let y = 0; y < gh; y += 3) for (let x = 0; x < gw - 1; x++) lines.push(y * gw + x, y * gw + x + 1);
  for (let x = 0; x < gw; x += 3) for (let y = 0; y < gh - 1; y++) lines.push(y * gw + x, (y + 1) * gw + x);
  const lin = new Uint16Array(lines);
  const buf = (data, target = gl.ARRAY_BUFFER) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
  const bPos = buf(pos), bNor = buf(nor), bTri = buf(tri, gl.ELEMENT_ARRAY_BUFFER), bLin = buf(lin, gl.ELEMENT_ARRAY_BUFFER);
  const wPos = buf(new Float32Array([-sx, 0, -sz, sx, 0, -sz, -sx, 0, sz, sx, 0, sz])), wNor = buf(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]));
  const attr = (b, l) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0); };

  let raf = 0;
  const draw = () => {
    raf = 0;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.08, 0.09, 0.12, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const eye = [Math.cos(st.pitch) * Math.sin(st.yaw) * st.dist, Math.sin(st.pitch) * st.dist, Math.cos(st.pitch) * Math.cos(st.yaw) * st.dist];
    gl.uniformMatrix4fv(loc.m, false, new Float32Array(mul(persp(0.8, cv.width / cv.height, 0.05, 50), lookAt(eye, [0, 0, 0]))));
    gl.uniform1f(loc.hs, st.hs); gl.uniform1f(loc.alpha, 1);
    attr(bPos, loc.p); attr(bNor, loc.n);
    gl.uniform1f(loc.mode, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bTri); gl.drawElements(gl.TRIANGLES, tri.length, gl.UNSIGNED_SHORT, 0);
    if (st.wire) { gl.uniform1f(loc.mode, 2); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bLin); gl.drawElements(gl.LINES, lin.length, gl.UNSIGNED_SHORT, 0); }
    if (st.water) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      attr(wPos, loc.p); attr(wNor, loc.n);
      gl.uniform1f(loc.mode, 1); gl.uniform1f(loc.alpha, 0.45);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
  };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  // ---------- управление ----------
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const s0 = { x: e.clientX, y: e.clientY, yaw: st.yaw, pitch: st.pitch };
    const mv = (ev) => { st.yaw = s0.yaw - (ev.clientX - s0.x) * 0.008; st.pitch = Math.max(0.08, Math.min(1.5, s0.pitch + (ev.clientY - s0.y) * 0.006)); redraw(); };
    const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
  });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); st.dist = Math.max(0.8, Math.min(8, st.dist * Math.exp(e.deltaY * 0.0012))); redraw(); }, { passive: false });
  const hsIn = h('input', { type: 'range', min: 0.02, max: 1, step: 0.01, value: st.hs });
  hsIn.oninput = () => { st.hs = +hsIn.value; redraw(); };
  const chk = (label, key) => { const c = h('input', { type: 'checkbox', checked: st[key] }); c.onchange = () => { st[key] = c.checked; redraw(); }; return h('label', { class: 't3d-chk' }, c, label); };
  const obj = () => {
    const { G: g2, gw: w2, gh: h2 } = grid(E, W, H, 256);
    let s = `# ${title}\n# GameDev Board terrain, ${w2}x${h2}\no terrain\n`;
    const hsc = st.hs * 2;
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) s += `v ${(((x / (w2 - 1)) * 2 - 1) * sx * 50).toFixed(3)} ${((g2[y * w2 + x] - SEA) * hsc * 50).toFixed(3)} ${(((y / (h2 - 1)) * 2 - 1) * sz * 50).toFixed(3)}\n`;
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) s += `vt ${(x / (w2 - 1)).toFixed(4)} ${(1 - y / (h2 - 1)).toFixed(4)}\n`;
    for (let y = 0; y < h2 - 1; y++) for (let x = 0; x < w2 - 1; x++) {
      const a = y * w2 + x + 1, b = a + 1, c = a + w2, d = c + 1;
      s += `f ${a}/${a} ${c}/${c} ${b}/${b}\nf ${b}/${b} ${c}/${c} ${d}/${d}\n`;
    }
    download(`${name}.obj`, s, 'text/plain');
  };
  const body = h('div', { class: 't3d' }, cv,
    h('div', { class: 'row t3d-bar' },
      h('span', { class: 'muted small' }, 'Высота'), hsIn, chk(' вода', 'water'), chk(' сетка', 'wire'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', onClick: () => { Object.assign(st, { yaw: 0.7, pitch: 0.75, dist: 2.6 }); redraw(); } }, '⟲ Вид'),
      h('button', { class: 'btn primary', title: 'Сетка рельефа 256×256 для Blender, Unity, Unreal', onClick: obj }, '⤓ OBJ')),
    h('div', { class: 'muted small' }, 'Тяните мышью — вращать, колесо — приблизить. Модель без цветов: только форма рельефа.'));
  modal('🧊 ' + title + ' — 3D', body, { wide: true, onClose: () => cancelAnimationFrame(raf) });
  draw();
}
