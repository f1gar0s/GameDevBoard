// Простой генератор 2D-карт: средневековый (суша, моря, леса, горы, реки на пергаменте)
// и современный (город: кварталы, улицы, проспекты, парки, река). Только карта, без надписей.

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

function medieval(g, W, H, cell, seed) {
  const elev = noise2(seed), moist = noise2(seed + 101), grain = rng(seed + 7);
  const E = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = x / W - 0.5, ny = y / H - 0.5;
    const edge = Math.min(1, Math.hypot(nx * 1.15, ny * 1.4) * 1.6);
    E[y * W + x] = elev(x / 22, y / 22) * 1.15 - edge * 0.42;
  }
  const col = (e, m) => {
    if (e < 0.22) return '#5f88a6';
    if (e < 0.30) return '#83aec6';
    if (e < 0.32) return '#e5d5a6';
    if (e < 0.52) return m > 0.55 ? '#6e8f4d' : '#a9c07c';
    if (e < 0.60) return m > 0.6 ? '#5d7d42' : '#b9a774';
    if (e < 0.70) return '#8d8172';
    return '#f1ede2';
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
  g.strokeStyle = '#5f88a6'; g.lineCap = 'round'; g.lineJoin = 'round';
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

function render(cv, d, cell) {
  const W = Math.max(40, Math.min(240, d.w | 0 || 120)), H = Math.max(30, Math.min(240, d.h | 0 || 80));
  cv.width = W * cell; cv.height = H * cell;
  const g = cv.getContext('2d');
  (d.style === 'modern' ? modern : medieval)(g, W, H, cell, d.seed >>> 0);
}

export default {
  type: 'mapgen',
  name: 'Генератор карт 2D',
  icon: '🗺',
  group: 'Уровни и баланс',
  description: 'Случайная карта в средневековом или современном стиле, экспорт PNG',
  defaults: () => ({ style: 'medieval', seed: Math.floor(Math.random() * 1e9), w: 120, h: 80 }),

  render(ctx) {
    const { h, data: d } = ctx;
    const cv = h('canvas', { class: 'mapgen-cv' });
    render(cv, d, 4);
    const style = h('select', { class: 'f sel' }, h('option', { value: 'medieval', selected: d.style !== 'modern' }, '🏰 Средневековый'), h('option', { value: 'modern', selected: d.style === 'modern' }, '🏙 Современный'));
    style.onchange = () => ctx.change({ style: style.value });
    const png = () => { const big = document.createElement('canvas'); render(big, d, 10); big.toBlob((b) => ctx.download(`map_${d.style}_${d.seed}.png`, b)); };
    return h('div', { class: 'cx-mapgen' },
      h('div', { class: 'row' }, style, h('span', { class: 'grow' }),
        h('button', { class: 'play-btn', title: 'Новая случайная карта', onClick: () => ctx.change({ seed: Math.floor(Math.random() * 1e9) }) }, '🎲 Новая'),
        h('button', { class: 'ghost-btn', title: 'Скачать PNG в высоком разрешении', onClick: png }, '⤓ PNG')),
      h('div', { class: 'mapgen-wrap' }, cv),
      h('div', { class: 'muted small mono' }, `зерно ${d.seed} · ${d.w}×${d.h}`));
  },
  settings(ctx) {
    const { h } = ctx;
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Зерно'), ctx.field('seed', { type: 'number', num: true, cls: 'num wide-num', commit: true }),
      h('label', {}, 'Ширина'), ctx.field('w', { type: 'number', num: true, cls: 'num', commit: true }),
      h('label', {}, 'Высота'), ctx.field('h', { type: 'number', num: true, cls: 'num', commit: true }),
      h('div', { class: 'set-note' }, 'Одинаковое зерно всегда даёт одинаковую карту. Размер в клетках: 40–240.'));
  },
  text: (d) => 'карта ' + d.style,
  exportMd: (d) => `🗺 Карта (${d.style === 'modern' ? 'современная' : 'средневековая'}), зерно ${d.seed}, ${d.w}×${d.h}`,
  exportJson: (d) => ({ style: d.style, seed: d.seed, width: d.w, height: d.h }),
};
