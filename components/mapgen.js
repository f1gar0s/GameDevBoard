// Карта: сгенерированная (мир — континент, острова, архипелаг…; город — средневековый или современный)
// или своё изображение. Поверх карты ставятся метки; метка со ссылкой работает как кнопка — ведёт на фрейм,
// объект или другую карту.

function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function noise2(seed) {
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

function world(g, W, H, cell, seed, o = {}) {
  const elev = noise2(seed), moist = noise2(seed + 101), grain = rng(seed + 7);
  const E = new Float32Array(W * H);
  const terrain = o.terrain || 'continent';
  const seaShift = ((50 - (o.sea ?? 50)) / 100) * 0.3; // уровень моря: выше — меньше суши
  const k = 120 / Math.max(W, H); // одинаковый «масштаб» материков на картах разного размера
  // центры островов
  const cr = rng(seed + 77);
  const centers = Array.from({ length: terrain === 'islands' ? 3 + Math.floor(cr() * 4) : 0 }, () => [0.15 + cr() * 0.7, 0.15 + cr() * 0.7, 0.10 + cr() * 0.12]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = x / W - 0.5, ny = y / H - 0.5;
    const edge = Math.min(1, Math.hypot(nx * 1.15, ny * 1.4) * 1.6);
    let e;
    if (terrain === 'pangaea') e = elev(x * k / 30, y * k / 30) * 1.1 - edge * 0.28 + 0.06;
    else if (terrain === 'islands') {
      let best = 0;
      for (const [cx, cy, r] of centers) best = Math.max(best, 1 - Math.hypot(x / W - cx, (y / H - cy) * H / W) / r);
      e = (elev(x * k / 12, y * k / 12) - 0.5) * 0.8 + Math.max(0, best) * 0.55 + 0.12;
    } else if (terrain === 'archipelago') e = (elev(x * k / 7, y * k / 7, 4) - 0.5) * 2.2 + 0.17 - edge * 0.1;
    else if (terrain === 'lakes') e = (elev(x * k / 14, y * k / 14) - 0.5) * 1.3 + 0.47;
    else e = elev(x * k / 22, y * k / 22) * 1.15 - edge * 0.42; // континент
    E[y * W + x] = e + seaShift;
  }
  const atlas = o.look === 'atlas';
  const P = atlas
    ? ['#2f6fb0', '#4f95cf', '#efe3b4', '#5aa14a', '#9cc66b', '#3f7f37', '#c9b37a', '#9a8f80', '#ffffff']
    : ['#5f88a6', '#83aec6', '#e5d5a6', '#6e8f4d', '#a9c07c', '#5d7d42', '#b9a774', '#8d8172', '#f1ede2'];
  const col = (e, m) => {
    if (e < 0.22) return P[0];
    if (e < 0.30) return P[1];
    if (e < 0.32) return P[2];
    if (e < 0.52) return m > 0.55 ? P[3] : P[4];
    if (e < 0.60) return m > 0.6 ? P[5] : P[6];
    if (e < 0.70) return P[7];
    return P[8];
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = E[y * W + x], m = moist(x / 14, y / 14, 3);
    const [r, gg, b] = hex(col(e, m));
    const k = 0.94 + grain() * 0.08;
    g.fillStyle = `rgb(${r * k | 0},${gg * k | 0},${b * k | 0})`;
    g.fillRect(x * cell, y * cell, cell, cell);
  }
  // реки: от гор вниз по склону до воды
  const rr = rng(seed + 33);
  g.strokeStyle = P[0]; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < 7; k++) {
    let x = Math.floor(rr() * W), y = Math.floor(rr() * H);
    if (E[y * W + x] < 0.55) continue;
    g.lineWidth = Math.max(1, cell * 0.6);
    g.beginPath(); g.moveTo(x * cell + cell / 2, y * cell + cell / 2);
    for (let s = 0; s < 400 && E[y * W + x] >= 0.22; s++) {
      let best = null, be = E[y * W + x] + 0.002;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        if (E[Y * W + X] < be) { be = E[Y * W + X]; best = [X, Y]; }
      }
      if (!best) { E[y * W + x] -= 0.01; continue; }
      [x, y] = best;
      g.lineTo(x * cell + cell / 2, y * cell + cell / 2);
    }
    g.stroke();
  }
  // значки: горы ^ и деревья •
  const ic = rng(seed + 55);
  for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) {
    const e = E[y * W + x], m = moist(x / 14, y / 14, 3);
    const px = x * cell + cell / 2, py = y * cell + cell / 2;
    if (e >= 0.6 && e < 0.72 && ic() < 0.55) {
      g.strokeStyle = 'rgba(60,45,30,.75)'; g.lineWidth = Math.max(1, cell * 0.35);
      g.beginPath(); g.moveTo(px - cell * 1.2, py + cell * 0.8); g.lineTo(px, py - cell * 1.1); g.lineTo(px + cell * 1.2, py + cell * 0.8); g.stroke();
    } else if (e >= 0.34 && e < 0.58 && m > 0.55 && ic() < 0.5) {
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

function modern(g, W, H, cell, seed) {
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
function town(g, W, H, C, seed) {
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

export const SIZES = { s: ['Маленькая', 80, 56], m: ['Средняя', 120, 80], l: ['Большая', 180, 120], xl: ['Огромная', 240, 160] };
export const TERRAINS = { continent: 'Континент', pangaea: 'Суперконтинент', islands: 'Острова', archipelago: 'Архипелаг', lakes: 'Озёрный край' };
const ICONS = ['📍', '🏰', '🏘', '🏠', '⛪', '🏛', '⚔', '🛡', '⛰', '🌲', '🌊', '⚓', '🕳', '💀', '🐉', '💎', '⭐', '❓'];
// старые карты: style medieval → мир, modern → современный город
const kindOf = (d) => d.kind || (d.style === 'modern' ? 'city' : 'world');
const cityStyle = (d) => d.city || (d.style === 'modern' ? 'modern' : 'medieval');

function render(cv, d, cell) {
  const W = Math.max(40, Math.min(240, d.w | 0 || 120)), H = Math.max(30, Math.min(240, d.h | 0 || 80));
  cv.width = W * cell; cv.height = H * cell;
  const g = cv.getContext('2d');
  if (kindOf(d) === 'city') (cityStyle(d) === 'modern' ? modern : town)(g, W, H, cell, d.seed >>> 0);
  else world(g, W, H, cell, d.seed >>> 0, { terrain: d.terrain, sea: d.sea, look: d.look });
}
function drawMarkers(g, markers, w, h, scale) {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const m of markers || []) {
    const x = m.x * w, y = m.y * h;
    g.font = `${22 * scale}px serif`;
    g.fillText(m.icon || '📍', x, y);
    if (m.label) {
      g.font = `bold ${12 * scale}px sans-serif`;
      const tw = g.measureText(m.label).width + 10 * scale;
      g.fillStyle = 'rgba(15,17,24,.78)'; g.fillRect(x - tw / 2, y + 13 * scale, tw, 17 * scale);
      g.fillStyle = '#fff'; g.fillText(m.label, x, y + 22 * scale);
    }
  }
}
const editing = new Set();      // id полей карты в режиме расстановки меток
const selMarker = new Map();    // id поля → id выбранной метки

export default {
  type: 'mapgen',
  name: 'Карта',
  icon: '🗺',
  group: 'Уровни и баланс',
  description: 'Сгенерированная карта мира или города либо своё изображение; метки-ссылки на фреймы, объекты и другие карты',
  defaults: () => ({ kind: 'world', terrain: 'continent', look: 'parchment', city: 'medieval', sea: 50, seed: Math.floor(Math.random() * 1e9), w: 120, h: 80, source: 'gen', asset: null, markers: [] }),
  deps: (d) => (d.markers || []).map((m) => m.target).filter(Boolean),

  render(ctx) {
    const { h, data: d } = ctx;
    const kind = kindOf(d), src = d.source === 'image' ? 'image' : 'gen';
    const isEdit = editing.has(ctx.compId);
    const markers = d.markers || [];
    // --- вид карты ---
    let view;
    const img = src === 'image' && d.asset ? ctx.asset(d.asset) : null;
    if (src === 'image') view = img ? h('img', { class: 'map-img', src: img, draggable: 'false' }) : h('div', { class: 'map-empty' }, d.asset ? '⏳ Изображение загружается…' : 'Загрузите изображение карты: кнопка «🖼 Изображение» или перетащите файл на карточку');
    else { view = h('canvas', { class: 'mapgen-cv' }); render(view, d, 4); }
    const layer = h('div', { class: 'map-markers' + (isEdit ? ' editing no-drag' : '') });
    const wrap = h('div', { class: 'mapgen-wrap' }, view, layer);
    const setMarkers = (list) => ctx.change({ markers: list });
    // метки
    for (const m of markers) {
      const label = m.label || '';
      const t = m.target ? (ctx.store.tree?.[m.target]?.name || ctx.store.item(m.target)?.data.title || ctx.store.item(m.target)?.data.label || null) : null;
      const el = h('button', {
        class: 'mk no-drag' + (selMarker.get(ctx.compId) === m.id && isEdit ? ' sel' : '') + (m.target ? ' linked' : ''),
        style: { left: m.x * 100 + '%', top: m.y * 100 + '%', '--mc': m.color || '#ef4444' },
        title: (label ? label + '\n' : '') + (m.target ? (t ? '→ ' + t : '⚠ цель удалена') : isEdit ? 'Без ссылки' : ''),
      }, h('span', { class: 'mk-i' }, m.icon || '📍'), label ? h('span', { class: 'mk-l' }, label) : null);
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (!isEdit) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const r = layer.getBoundingClientRect();
        let moved = false;
        const mv = (ev) => {
          const nx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), ny = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
          if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
          moved = true;
          el.style.left = nx * 100 + '%'; el.style.top = ny * 100 + '%';
          el._pos = [nx, ny];
        };
        const up = () => {
          el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
          if (moved && el._pos) setMarkers(markers.map((x) => (x.id === m.id ? { ...x, x: +el._pos[0].toFixed(4), y: +el._pos[1].toFixed(4) } : x)));
          else { selMarker.set(ctx.compId, m.id); ctx.rerender(); }
        };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isEdit) return;
        if (m.target) ctx.goTo(m.target);
        else ctx.toast('У метки нет ссылки — включите «📍 Метки» и выберите цель', 'info');
      });
      layer.append(el);
    }
    if (isEdit) layer.addEventListener('pointerdown', (e) => {
      if (e.target !== layer) return;
      e.stopPropagation(); e.preventDefault();
      const r = layer.getBoundingClientRect();
      const m = { id: ctx.uid('m'), x: +((e.clientX - r.left) / r.width).toFixed(4), y: +((e.clientY - r.top) / r.height).toFixed(4), icon: kind === 'city' ? '🏠' : '🏰', label: '', target: null, color: '#ef4444' };
      selMarker.set(ctx.compId, m.id);
      setMarkers([...markers, m]);
    });
    // --- панель выбранной метки ---
    let mkPanel = null;
    const cur = isEdit && markers.find((m) => m.id === selMarker.get(ctx.compId));
    if (cur) {
      const upd = (patch) => setMarkers(markers.map((x) => (x.id === cur.id ? { ...x, ...patch } : x)));
      const lbl = h('input', { class: 'f mk-input', value: cur.label || '', placeholder: 'Подпись метки' });
      lbl.onchange = () => upd({ label: lbl.value.trim() });
      lbl.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') lbl.blur(); };
      const tName = cur.target ? (ctx.store.tree?.[cur.target] ? '📄 ' + ctx.pathOf(cur.target).join(' / ') : (ctx.store.item(cur.target) ? '▭ ' + (ctx.store.item(cur.target).data.title || ctx.store.item(cur.target).data.label || 'объект') : '⚠ удалена')) : '🎯 Ссылка…';
      mkPanel = h('div', { class: 'mk-panel' },
        h('div', { class: 'mk-icons' }, ICONS.map((ic) => h('button', { class: 'mk-ic' + (cur.icon === ic ? ' on' : ''), onClick: () => upd({ icon: ic }) }, ic))),
        h('div', { class: 'row' }, lbl,
          h('input', { type: 'color', value: cur.color || '#ef4444', title: 'Цвет метки', onChange: (e) => upd({ color: e.target.value }) })),
        h('div', { class: 'row' },
          h('button', { class: 'f pick-btn grow', title: 'Метка будет работать как кнопка-ссылка', onClick: (e) => { const r = e.currentTarget.getBoundingClientRect(); ctx.pick({ x: r.left, y: r.bottom + 4, current: cur.target, title: 'Куда ведёт метка', onPick: (id) => upd({ target: id }) }); } }, tName),
          cur.target ? h('button', { class: 'ghost-btn', title: 'Убрать ссылку', onClick: () => upd({ target: null }) }, '✕') : null,
          h('button', { class: 'ghost-btn danger', title: 'Удалить метку', onClick: () => { selMarker.delete(ctx.compId); setMarkers(markers.filter((x) => x.id !== cur.id)); } }, '🗑')));
    }
    // --- управление ---
    const seg = (key, val, label, title) => h('button', { class: 'seg' + (val ? ' on' : ''), title, onClick: key }, label);
    const sizeSel = h('select', { class: 'f sel', title: 'Размер карты (клеток)' },
      Object.entries(SIZES).map(([k, [n, w, hh]]) => h('option', { value: k, selected: d.w === w && d.h === hh }, `${n} ${w}×${hh}`)),
      Object.values(SIZES).some(([, w, hh]) => d.w === w && d.h === hh) ? null : h('option', { value: '', selected: true }, `Свой ${d.w}×${d.h}`));
    sizeSel.onchange = () => { const s = SIZES[sizeSel.value]; if (s) ctx.change({ w: s[1], h: s[2] }); };
    const opts = [];
    if (src === 'gen' && kind === 'world') {
      const ter = h('select', { class: 'f sel', title: 'Тип суши' }, Object.entries(TERRAINS).map(([k, v]) => h('option', { value: k, selected: (d.terrain || 'continent') === k }, v)));
      ter.onchange = () => ctx.change({ terrain: ter.value });
      const look = h('select', { class: 'f sel', title: 'Оформление' }, h('option', { value: 'parchment', selected: d.look !== 'atlas' }, '📜 Пергамент'), h('option', { value: 'atlas', selected: d.look === 'atlas' }, '🗺 Атлас'));
      look.onchange = () => ctx.change({ look: look.value });
      const sea = h('input', { type: 'range', min: 0, max: 100, value: d.sea ?? 50, class: 'no-drag', title: 'Уровень моря' });
      sea.onchange = () => ctx.change({ sea: +sea.value });
      opts.push(h('div', { class: 'row wrap' }, ter, look, sizeSel), h('label', { class: 'row map-sea' }, h('span', { class: 'muted small' }, '🌊 Море'), sea));
    } else if (src === 'gen') {
      const cs = h('select', { class: 'f sel', title: 'Стиль города' }, h('option', { value: 'medieval', selected: cityStyle(d) !== 'modern' }, '🏰 Средневековый'), h('option', { value: 'modern', selected: cityStyle(d) === 'modern' }, '🏙 Современный'));
      cs.onchange = () => ctx.change({ city: cs.value, style: undefined });
      opts.push(h('div', { class: 'row wrap' }, cs, sizeSel));
    }
    const png = () => {
      const out = document.createElement('canvas');
      const finish = (w, hh, scale) => { drawMarkers(out.getContext('2d'), markers, w, hh, scale); out.toBlob((b) => ctx.download(`map_${kind}_${d.seed}.png`, b)); };
      if (src === 'image') {
        if (!img) return;
        const im = new Image();
        im.onload = () => { out.width = im.naturalWidth; out.height = im.naturalHeight; out.getContext('2d').drawImage(im, 0, 0); finish(out.width, out.height, Math.max(1, out.width / 600)); };
        im.src = img;
      } else { render(out, d, 10); finish(out.width, out.height, 2.5); }
    };
    const upload = () => ctx.pickImage((dataUrl, im, name) => ctx.change({ source: 'image', asset: ctx.addAsset(dataUrl), name }));
    return h('div', { class: 'cx-mapgen' },
      h('div', { class: 'row wrap' },
        h('div', { class: 'segs' },
          seg(() => ctx.change({ source: 'gen', kind: 'world', style: undefined }), src === 'gen' && kind === 'world', '🌍 Мир', 'Сгенерировать карту мира'),
          seg(() => ctx.change({ source: 'gen', kind: 'city', style: undefined }), src === 'gen' && kind === 'city', '🏘 Город', 'Сгенерировать карту города'),
          seg(() => (d.asset ? ctx.change({ source: 'image' }) : upload()), src === 'image', '🖼 Изображение', 'Своё изображение карты')),
        h('span', { class: 'grow' }),
        src === 'gen' ? h('button', { class: 'play-btn', title: 'Новая случайная карта', onClick: () => ctx.change({ seed: Math.floor(Math.random() * 1e9) }) }, '🎲') : h('button', { class: 'ghost-btn', title: 'Заменить изображение', onClick: upload }, '⤒'),
        h('button', { class: 'ghost-btn', title: 'Скачать PNG с метками', onClick: png }, '⤓')),
      ...opts,
      wrap,
      h('div', { class: 'row' },
        h('button', { class: 'ghost-btn' + (isEdit ? ' on' : ''), title: isEdit ? 'Готово' : 'Ставить и править метки', onClick: () => { isEdit ? editing.delete(ctx.compId) : editing.add(ctx.compId); ctx.rerender(); } }, isEdit ? '✓ Готово' : '📍 Метки'),
        h('span', { class: 'muted small grow' }, isEdit ? 'Клик по карте — новая метка, перетаскивание — сдвинуть, клик по метке — настроить' : markers.length ? `меток: ${markers.length} · клик по метке со ссылкой — переход` : ''),
        src === 'gen' ? h('span', { class: 'muted small mono' }, `#${d.seed}`) : null),
      mkPanel);
  },
  settings(ctx) {
    const { h } = ctx;
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Зерно'), ctx.field('seed', { type: 'number', num: true, cls: 'num wide-num', commit: true }),
      h('label', {}, 'Ширина'), ctx.field('w', { type: 'number', num: true, cls: 'num', commit: true }),
      h('label', {}, 'Высота'), ctx.field('h', { type: 'number', num: true, cls: 'num', commit: true }),
      h('div', { class: 'set-note' }, 'Одинаковое зерно и настройки всегда дают одинаковую карту. Размер в клетках: 40–240.'));
  },
  text: (d) => ['карта', ...(d.markers || []).map((m) => m.label)].join(' '),
  exportMd: (d) => `🗺 Карта (${d.source === 'image' ? 'своё изображение' : kindOf(d) === 'city' ? 'город' : TERRAINS[d.terrain || 'continent']})${(d.markers || []).length ? ': ' + d.markers.map((m) => (m.icon || '📍') + ' ' + (m.label || '')).join(', ') : ''}`,
  exportJson: (d) => ({ source: d.source || 'gen', kind: kindOf(d), terrain: d.terrain, city: cityStyle(d), seed: d.seed, width: d.w, height: d.h, markers: (d.markers || []).map((m) => ({ x: m.x, y: m.y, icon: m.icon, label: m.label, target: m.target })) }),
};
