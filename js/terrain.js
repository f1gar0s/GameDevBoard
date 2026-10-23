// Генерация карт: рельеф (карта высот), раскраска мира, города; правки рельефа; экспорт RAW для Unity/Unreal.
// Высоты: 0 … ~1, уровень моря SEA = 0.22 (ниже — вода).
export const SEA = 0.22;

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function noise2(seed) {
  const r = rng(seed);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const P = [...perm, ...perm];
  const g = (ix, iy) => P[P[ix & 255] + (iy & 255)] / 255;
  const sm = (t) => t * t * (3 - 2 * t);
  const n = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const a = g(ix, iy), b = g(ix + 1, iy), c = g(ix, iy + 1), d = g(ix + 1, iy + 1);
    const u = sm(fx), v = sm(fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, oct = 5) => { let s = 0, amp = 1, f = 1, norm = 0; for (let i = 0; i < oct; i++) { s += n(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; } return s / norm; };
}
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];


// ---------- рельеф ----------
// o: terrain, sea (0–100), scale (размер материков, 0.4–2.5), detail (октавы 2–8), peaks (высота гор 0–2),
//    smooth (проходы сглаживания 0–6)
export function heights(W, H, seed, o = {}) {
  const elev = noise2(seed);
  const E = new Float32Array(W * H);
  const terrain = o.terrain || 'continent';
  const seaShift = ((50 - (o.sea ?? 50)) / 100) * 0.3; // уровень моря: выше — меньше суши
  const k = (120 / Math.max(W, H)) / (o.scale || 1); // масштаб материков не зависит от размера карты
  const oct = Math.max(2, Math.min(8, Math.round(o.detail ?? 5)));
  const peaks = o.peaks ?? 1;
  const cr = rng(seed + 77);
  const centers = Array.from({ length: terrain === 'islands' ? 3 + Math.floor(cr() * 4) : 0 }, () => [0.15 + cr() * 0.7, 0.15 + cr() * 0.7, 0.10 + cr() * 0.12]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = x / W - 0.5, ny = y / H - 0.5;
    const edge = Math.min(1, Math.hypot(nx * 1.15, ny * 1.4) * 1.6);
    let e;
    if (terrain === 'pangaea') e = elev(x * k / 30, y * k / 30, oct) * 1.1 - edge * 0.28 + 0.06;
    else if (terrain === 'islands') {
      let best = 0;
      for (const [cx, cy, r] of centers) best = Math.max(best, 1 - Math.hypot(x / W - cx, (y / H - cy) * H / W) / r);
      e = (elev(x * k / 12, y * k / 12, oct) - 0.5) * 0.8 + Math.max(0, best) * 0.55 + 0.12;
    } else if (terrain === 'archipelago') e = (elev(x * k / 7, y * k / 7, Math.min(oct, 6)) - 0.5) * 2.2 + 0.17 - edge * 0.1;
    else if (terrain === 'lakes') e = (elev(x * k / 14, y * k / 14, oct) - 0.5) * 1.3 + 0.47;
    else if (terrain === 'highlands') e = elev(x * k / 18, y * k / 18, oct) * 1.25 - edge * 0.2 + 0.1;
    else e = elev(x * k / 22, y * k / 22, oct) * 1.15 - edge * 0.42; // континент
    e += seaShift;
    if (e > 0.45) e += (e - 0.45) * (peaks - 1) * 0.9; // горы выше/ниже
    E[y * W + x] = e;
  }
  for (let p = 0; p < (o.smooth | 0); p++) blur(E, W, H);
  return E;
}
function blur(E, W, H) {
  const T = new Float32Array(E);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      s += T[Y * W + X]; n++;
    }
    E[y * W + x] = s / n;
  }
}

// ---------- правки рельефа (дельта высот) ----------
// хранится в ресурсе-строке «HD1:W:H:base64(Int8)», шаг 0.6/127
const STEP = 0.6 / 127;
export function encodeDelta(D, W, H) {
  const q = new Int8Array(W * H);
  for (let i = 0; i < q.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(D[i] / STEP)));
  let bin = '';
  const u = new Uint8Array(q.buffer);
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return `HD1:${W}:${H}:` + btoa(bin);
}
const decCache = new Map();
export function decodeDelta(str) {
  if (!str || !str.startsWith('HD1:')) return null;
  if (decCache.has(str)) return decCache.get(str);
  const [, w, h, b64] = str.split(':');
  const bin = atob(b64);
  const q = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) q[i] = (bin.charCodeAt(i) << 24) >> 24;
  const D = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) D[i] = q[i] * STEP;
  const out = { D, W: +w, H: +h };
  if (decCache.size > 20) decCache.clear();
  decCache.set(str, out);
  return out;
}
// пересчитать сетку на другой размер (билинейно)
export function resample(A, aw, ah, W, H) {
  if (aw === W && ah === H) return new Float32Array(A);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = sample(A, aw, ah, (x / Math.max(1, W - 1)) * (aw - 1), (y / Math.max(1, H - 1)) * (ah - 1));
  return out;
}
export function sample(A, w, h, fx, fy) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = A[y0 * w + x0], b = A[y0 * w + x1], c = A[y1 * w + x0], d = A[y1 * w + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// ---------- раскраска мира ----------
// o: look (parchment | atlas), rivers (0–20), forest (0–100)
export function paintWorld(g, W, H, cell, seed, E, o = {}) {
  const moist = noise2(seed + 101), grain = rng(seed + 7);
  const atlas = o.look === 'atlas';
  const P = (atlas
    ? ['#2f6fb0', '#4f95cf', '#efe3b4', '#5aa14a', '#9cc66b', '#3f7f37', '#c9b37a', '#9a8f80', '#ffffff']
    : ['#5f88a6', '#83aec6', '#e5d5a6', '#6e8f4d', '#a9c07c', '#5d7d42', '#b9a774', '#8d8172', '#f1ede2']).map(hex);
  const wet = 0.55 + (50 - (o.forest ?? 50)) / 250; // больше лесов — ниже порог влажности
  const col = (e, m) => {
    if (e < SEA) return P[0];
    if (e < 0.30) return P[1];
    if (e < 0.32) return P[2];
    if (e < 0.52) return m > wet ? P[3] : P[4];
    if (e < 0.60) return m > wet + 0.05 ? P[5] : P[6];
    if (e < 0.70) return P[7];
    return P[8];
  };
  const M = new Float32Array(W * H);
  const img = new ImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const e = E[i], m = (M[i] = moist(x / 14, y / 14, 3));
    const [r, gg, b] = col(e, m);
    const k = 0.94 + grain() * 0.08;
    img.data[i * 4] = r * k; img.data[i * 4 + 1] = gg * k; img.data[i * 4 + 2] = b * k; img.data[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
  tmp.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, 0, 0, W * cell, H * cell);
  // реки: от гор вниз по склону до воды
  const F = new Float32Array(E);
  const rr = rng(seed + 33);
  g.strokeStyle = atlas ? '#2f6fb0' : '#5f88a6'; g.lineCap = 'round'; g.lineJoin = 'round';
  const nRiv = o.rivers ?? 7;
  for (let k = 0, made = 0; k < nRiv * 6 && made < nRiv; k++) {
    let x = Math.floor(rr() * W), y = Math.floor(rr() * H);
    if (F[y * W + x] < 0.55) continue;
    made++;
    g.lineWidth = Math.max(1, cell * 0.6);
    g.beginPath(); g.moveTo(x * cell + cell / 2, y * cell + cell / 2);
    for (let s = 0; s < 600 && F[y * W + x] >= SEA; s++) {
      let best = null, be = F[y * W + x] + 0.002;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        if (F[Y * W + X] < be) { be = F[Y * W + X]; best = [X, Y]; }
      }
      if (!best) { F[y * W + x] -= 0.01; continue; }
      [x, y] = best;
      g.lineTo(x * cell + cell / 2, y * cell + cell / 2);
    }
    g.stroke();
  }
  // значки: горы ^ и деревья •
  const ic = rng(seed + 55);
  for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) {
    const e = E[y * W + x], m = M[y * W + x];
    const px = x * cell + cell / 2, py = y * cell + cell / 2;
    if (e >= 0.6 && e < 0.72 && ic() < 0.55) {
      g.strokeStyle = 'rgba(60,45,30,.75)'; g.lineWidth = Math.max(1, cell * 0.35);
      g.beginPath(); g.moveTo(px - cell * 1.2, py + cell * 0.8); g.lineTo(px, py - cell * 1.1); g.lineTo(px + cell * 1.2, py + cell * 0.8); g.stroke();
    } else if (e >= 0.34 && e < 0.58 && m > wet && ic() < 0.5) {
      g.fillStyle = 'rgba(40,70,30,.7)';
      g.beginPath(); g.arc(px, py, cell * 0.7, 0, 7); g.fill();
    }
  }
  if (atlas) return;
  // пергамент: тон, виньетка, рамка
  g.fillStyle = 'rgba(241,228,195,.22)'; g.fillRect(0, 0, W * cell, H * cell);
  const vg = g.createRadialGradient(W * cell / 2, H * cell / 2, Math.min(W, H) * cell * 0.3, W * cell / 2, H * cell / 2, Math.max(W, H) * cell * 0.75);
  vg.addColorStop(0, 'rgba(90,60,30,0)'); vg.addColorStop(1, 'rgba(90,60,30,.45)');
  g.fillStyle = vg; g.fillRect(0, 0, W * cell, H * cell);
  g.strokeStyle = '#5b4630'; g.lineWidth = cell * 1.2; g.strokeRect(cell, cell, W * cell - cell * 2, H * cell - cell * 2);
  g.lineWidth = cell * 0.4; g.strokeRect(cell * 2.4, cell * 2.4, W * cell - cell * 4.8, H * cell - cell * 4.8);
}

// ---------- экспорт карты высот ----------
// RAW 16 бит, little-endian (порядок байт Windows) — Unity: Terrain → Import Raw; Unreal: Landscape → Import (.r16/.raw)
export function heightmapRaw(E, W, H, res, { flatSea = false } = {}) {
  let lo = Infinity, hi = -Infinity;
  for (const v of E) { const e = flatSea ? Math.max(SEA, v) : v; if (e < lo) lo = e; if (e > hi) hi = e; }
  if (hi <= lo) hi = lo + 1;
  const out = new Uint16Array(res * res);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    let e = sample(E, W, H, (x / (res - 1)) * (W - 1), (y / (res - 1)) * (H - 1));
    if (flatSea) e = Math.max(SEA, e);
    out[y * res + x] = Math.round(((e - lo) / (hi - lo)) * 65535);
  }
  // Uint16Array в браузерах little-endian — как раз то, что нужно
  return { data: out, seaLevel: Math.max(0, Math.min(1, (SEA - lo) / (hi - lo))) };
}
export function heightmapPng(E, W, H, res, opts) {
  const { data } = heightmapRaw(E, W, H, res, opts);
  const cv = document.createElement('canvas'); cv.width = res; cv.height = res;
  const g = cv.getContext('2d'); const img = g.createImageData(res, res);
  for (let i = 0; i < data.length; i++) { const v = data[i] >> 8; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return cv;
}

// ---------- города ----------
export function modern(g, W, H, cell, seed) {
  const r = rng(seed), park = noise2(seed + 9), river = noise2(seed + 21);
  const C = cell;
  g.fillStyle = '#ece9e3'; g.fillRect(0, 0, W * C, H * C);
  // кварталы: застройка
  const shade = noise2(seed + 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = shade(x / 3, y / 3, 2);
    g.fillStyle = v > 0.55 ? '#d6d2ca' : v > 0.4 ? '#dedad3' : '#e6e2dc';
    g.fillRect(x * C, y * C, C, C);
  }
  // парки
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (park(x / 18, y / 18, 3) > 0.64) { g.fillStyle = '#bfdea7'; g.fillRect(x * C, y * C, C, C); }
  // улицы
  const vx = [], hy = [];
  for (let x = 2 + Math.floor(r() * 4); x < W; x += 5 + Math.floor(r() * 5)) vx.push(x);
  for (let y = 2 + Math.floor(r() * 4); y < H; y += 5 + Math.floor(r() * 5)) hy.push(y);
  const mainX = new Set(vx.filter((_, i) => i % 4 === 1)), mainY = new Set(hy.filter((_, i) => i % 3 === 1));
  const road = (x, y, w, h, main) => { g.fillStyle = main ? '#f3cf6b' : '#ffffff'; g.fillRect(x, y, w, h); };
  for (const x of vx) { const m = mainX.has(x); road(x * C, 0, m ? C * 1.6 : C * 0.8, H * C, m); }
  for (const y of hy) { const m = mainY.has(y); road(0, y * C, W * C, m ? C * 1.6 : C * 0.8, m); }
  // диагональный проспект
  if (r() < 0.7) {
    g.strokeStyle = '#f3cf6b'; g.lineWidth = C * 1.4;
    g.beginPath(); g.moveTo(0, H * C * (0.2 + r() * 0.3)); g.lineTo(W * C, H * C * (0.6 + r() * 0.3)); g.stroke();
  }
  // река
  const o = r() < 0.5;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = o ? x / W : y / H;
    const v = Math.abs(river(t * 3, 0.5, 3) - 0.5 + (o ? y / H : x / W) - 0.5);
    if (v < 0.045) { g.fillStyle = '#9ccbea'; g.fillRect(x * C, y * C, C, C); }
  }
  // мосты: проспекты поверх воды
  g.globalAlpha = 0.9;
  for (const x of mainX) { g.fillStyle = '#f3cf6b'; for (let y = 0; y < H; y++) { const t = o ? x / W : y / H; const v = Math.abs(river(t * 3, 0.5, 3) - 0.5 + (o ? y / H : x / W) - 0.5); if (v < 0.045) g.fillRect(x * C, y * C, C * 1.6, C); } }
  g.globalAlpha = 1;
}


// Средневековый город: стена с башнями, площадь, радиальные улицы, кольцо, плотная застройка, поля вокруг, река
export function town(g, W, H, C, seed) {
  const r = rng(seed), field = noise2(seed + 3), riv = noise2(seed + 11), jit = noise2(seed + 19);
  // поля лоскутами
  for (let by = 0; by < H; by += 6) for (let bx = 0; bx < W; bx += 6) {
    const v = field(bx / 9, by / 9, 2);
    g.fillStyle = v > 0.62 ? '#d8c98a' : v > 0.5 ? '#b9c98a' : v > 0.38 ? '#a7bf78' : '#93b06a';
    g.fillRect(bx * C, by * C, 6 * C, 6 * C);
  }
  g.strokeStyle = 'rgba(80,90,50,.18)'; g.lineWidth = Math.max(1, C * 0.3);
  for (let by = 0; by < H; by += 6) for (let bx = 0; bx < W; bx += 6) g.strokeRect(bx * C, by * C, 6 * C, 6 * C);
  const cx = W / 2 + (r() - 0.5) * W * 0.08, cy = H / 2 + (r() - 0.5) * H * 0.08;
  const R = Math.min(W, H) * 0.38;
  const wallR = (a) => R * (0.86 + jit(Math.cos(a) * 1.5 + 5, Math.sin(a) * 1.5 + 5, 2) * 0.28);
  const nRoads = 5 + Math.floor(r() * 4);
  const roads = Array.from({ length: nRoads }, (_, i) => (i / nRoads) * Math.PI * 2 + r() * 0.5);
  const ringK = 0.52 + r() * 0.08;
  const plaza = R * 0.14;
  // река
  const vert = r() < 0.5;
  const isRiver = (x, y) => { const t = vert ? y / H : x / W; const off = (vert ? x / W : y / H) - 0.5 - (riv(t * 3, 0.5, 3) - 0.5) * 0.8 - 0.18; return Math.abs(off) < 0.028; };
  const angDist = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };
  const onRoad = (dx, dy, d, a, w) => {
    for (const ra of roads) if (angDist(a, ra) < Math.PI / 2 && Math.abs(d * Math.sin(angDist(a, ra))) < w) return true;
    if (Math.abs(d - wallR(a) * ringK) < w * 0.8) return true;
    return false;
  };
  const ROOF = ['#a0522d', '#8b4513', '#b5651d', '#7a3b1e', '#9c6644', '#8a5a44', '#a86b3c'];
  const rb = rng(seed + 5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (isRiver(x, y)) { g.fillStyle = '#7fb0d6'; g.fillRect(x * C, y * C, C, C); continue; }
    const inside = d < wallR(a) - 1;
    if (onRoad(dx, dy, d, a, inside ? 0.9 : 0.75) && d > plaza) { g.fillStyle = '#d9c7a0'; g.fillRect(x * C, y * C, C, C); continue; }
    if (d <= plaza) { g.fillStyle = '#e3d6b6'; g.fillRect(x * C, y * C, C, C); continue; }
    const p = inside ? 0.9 : Math.max(0, 0.55 - (d - R) / (R * 0.5)) * (onRoad(dx, dy, d, a, 3.2) ? 1 : 0.08);
    if (rb() < p) {
      g.fillStyle = ROOF[Math.floor(rb() * ROOF.length)];
      g.fillRect(x * C + C * 0.06, y * C + C * 0.06, C * 0.88, C * 0.88);
    } else if (inside) { g.fillStyle = '#c9bb95'; g.fillRect(x * C, y * C, C, C); }
  }
  // собор на площади
  g.fillStyle = '#6b6f7a'; const s = Math.max(2, Math.round(plaza * 0.6));
  g.fillRect((cx + plaza * 0.3) * C, (cy - s / 2) * C, s * C, s * 0.7 * C);
  // стена с башнями
  g.strokeStyle = '#5a4e42'; g.lineWidth = C * 1.1; g.beginPath();
  const N = 48;
  for (let i = 0; i <= N; i++) { const a = (i / N) * Math.PI * 2; const rr = wallR(a); const px = (cx + Math.cos(a) * rr) * C, py = (cy + Math.sin(a) * rr) * C; i ? g.lineTo(px, py) : g.moveTo(px, py); }
  g.stroke();
  g.fillStyle = '#4a4038';
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2 + 0.1; const rr = wallR(a); g.beginPath(); g.arc((cx + Math.cos(a) * rr) * C, (cy + Math.sin(a) * rr) * C, C * 1.3, 0, 7); g.fill(); }
  // ворота: разрыв стены на дорогах
  g.fillStyle = '#d9c7a0';
  for (const ra of roads) { const rr = wallR(ra); g.beginPath(); g.arc((cx + Math.cos(ra) * rr) * C, (cy + Math.sin(ra) * rr) * C, C * 0.9, 0, 7); g.fill(); }
}

