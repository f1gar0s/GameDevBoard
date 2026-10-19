// Общая логика, доступная компонентам (components/*.js получают её через ctx.lib)
import { h, s, clamp, readFileAsDataURL, loadImage, videoEmbedUrl, VIDEO_SITES } from './util.js';

export const RARITY = {
  common: { name: 'Обычный', color: '#9ca3af' },
  uncommon: { name: 'Необычный', color: '#22c55e' },
  rare: { name: 'Редкий', color: '#3b82f6' },
  epic: { name: 'Эпический', color: '#a855f7' },
  legendary: { name: 'Легендарный', color: '#f59e0b' },
};
export const STATUS = {
  todo: { name: 'К работе', color: '#64748b' },
  doing: { name: 'В работе', color: '#3b82f6' },
  review: { name: 'Проверка', color: '#f59e0b' },
  done: { name: 'Готово', color: '#22c55e' },
};
export const TAGS = {
  Code: '#60a5fa', Art: '#f472b6', Design: '#a78bfa', Audio: '#fbbf24', QA: '#34d399', Narrative: '#fb923c',
};
export const PRIORITY = { low: 'Низкий', mid: 'Средний', high: 'Высокий', crit: 'Критичный' };
export const TILES = {
  '.': { name: 'Пол', color: '#1b2130' },
  '#': { name: 'Стена', color: '#5b6478' },
  P: { name: 'Старт игрока', color: '#22d3a6', glyph: '@' },
  E: { name: 'Враг', color: '#ef4444', glyph: 'E' },
  C: { name: 'Монета', color: '#facc15', glyph: '●' },
  K: { name: 'Ключ', color: '#fb923c', glyph: 'k' },
  D: { name: 'Дверь', color: '#a16207', glyph: '▥' },
  '~': { name: 'Лава', color: '#dc2626', glyph: '≈' },
  X: { name: 'Выход', color: '#a78bfa', glyph: '⚑' },
};

// ---------- формулы баланса ----------
const MATH = Object.getOwnPropertyNames(Math);
const ALLOWED = new Set(['x', 'lvl', 'level', 'n', 'clamp', 'lerp', ...MATH]);
export function compileFormula(expr) {
  let src = String(expr).trim();
  if (!src) throw new Error('пустая формула');
  if (!/^[\w\s+\-*/%().,^<>=?:!&|]*$/.test(src)) throw new Error('недопустимые символы');
  src = src.replace(/\^/g, '**');
  for (const id of src.match(/[A-Za-z_]\w*/g) || []) if (!ALLOWED.has(id)) throw new Error('неизвестно: ' + id);
  // eslint-disable-next-line no-new-func
  const fn = new Function('x', 'lvl', 'level', 'n', 'clamp', 'lerp', ...MATH, `"use strict"; return (${src});`);
  const args = MATH.map((k) => Math[k]);
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const le = (a, b, t) => a + (b - a) * t;
  return (x) => fn(x, x, x, x, cl, le, ...args);
}
export function parseSeries(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m = line.match(/^([^:?]{1,30}):(.+)$/u);
    if (m && (!/\p{L}/u.test(m[1]) || /[()]/.test(m[1]))) m = null;
    let name = m ? m[1].trim() : `f${out.length + 1}`;
    const expr = m ? m[2] : line;
    try { out.push({ name, fn: compileFormula(expr), expr: expr.trim() }); }
    catch (e) { out.push({ name, error: e.message, expr: expr.trim() }); }
    if (out.length >= 4) break;
  }
  return out;
}
export function sampleSeries(series, from, to) {
  from = Math.round(+from || 0); to = Math.round(+to || 0);
  if (to <= from) to = from + 1;
  const step = Math.max(1, Math.ceil((to - from) / 400));
  const xs = [];
  for (let x = from; x <= to; x += step) xs.push(x);
  return series.filter((s) => s.fn).map((s) => ({ ...s, pts: xs.map((x) => { let y; try { y = +s.fn(x); } catch { y = NaN; } return [x, isFinite(y) ? y : NaN]; }) }));
}
const SERIES_COLORS = ['#7c5cff', '#22d3a6', '#f59e0b', '#ef4444'];
const fmt = (v) => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : a >= 100 ? Math.round(v).toString() : a >= 10 ? v.toFixed(1).replace(/\.0$/, '') : (Math.round(v * 100) / 100).toString(); };

export function drawChart(holder, data, W = 300, H = 160) {
  const sampled = sampleSeries(parseSeries(data.formula), data.from, data.to);
  holder.replaceChildren();
  const errs = parseSeries(data.formula).filter((x) => x.error);
  if (!sampled.length) {
    holder.append(h('div', { class: 'chart-err' }, errs[0] ? `Ошибка: ${errs[0].error}` : 'Введите формулу, например: 100 * lvl^1.5'));
    return;
  }
  let ymin = Infinity, ymax = -Infinity;
  for (const sr of sampled) for (const [, y] of sr.pts) if (!isNaN(y)) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  if (!isFinite(ymin)) { ymin = 0; ymax = 1; }
  if (ymin > 0) ymin = 0;
  if (ymax === ymin) ymax = ymin + 1;
  const pad = { l: 40, r: 8, t: 8, b: 18 };
  const xs = sampled[0].pts.map((p) => p[0]);
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const X = (x) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (y) => H - pad.b - ((y - ymin) / (ymax - ymin)) * (H - pad.t - pad.b);
  const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart' });
  for (let i = 0; i <= 4; i++) {
    const yv = ymin + ((ymax - ymin) * i) / 4;
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(yv), y2: Y(yv), class: 'grid' }));
    svg.append(s('text', { x: pad.l - 4, y: Y(yv) + 3, 'text-anchor': 'end', class: 'ax' }, fmt(yv)));
  }
  svg.append(s('text', { x: pad.l, y: H - 4, class: 'ax' }, x0));
  svg.append(s('text', { x: W - pad.r, y: H - 4, 'text-anchor': 'end', class: 'ax' }, x1));
  sampled.forEach((sr, i) => {
    let d = '', pen = false;
    for (const [x, y] of sr.pts) {
      if (isNaN(y)) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(y).toFixed(1);
      pen = true;
    }
    svg.append(s('path', { d, class: 'series', stroke: SERIES_COLORS[i] }));
  });
  const cross = s('line', { y1: pad.t, y2: H - pad.b, class: 'cross', style: 'display:none' });
  const dots = sampled.map((_, i) => s('circle', { r: 3.5, fill: SERIES_COLORS[i], style: 'display:none' }));
  svg.append(cross, ...dots);
  const tip = h('div', { class: 'chart-tip' });
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let idx = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (xs.length - 1));
    idx = clamp(idx, 0, xs.length - 1);
    const x = xs[idx];
    cross.setAttribute('x1', X(x)); cross.setAttribute('x2', X(x)); cross.style.display = '';
    tip.innerHTML = `<b>x=${x}</b> ` + sampled.map((sr, i) => {
      const y = sr.pts[idx][1];
      dots[i].setAttribute('cx', X(x)); dots[i].setAttribute('cy', Y(isNaN(y) ? ymin : y)); dots[i].style.display = isNaN(y) ? 'none' : '';
      return `<span style="color:${SERIES_COLORS[i]}">${sr.name}: ${isNaN(y) ? '—' : fmt(y)}</span>`;
    }).join(' ');
    tip.style.opacity = 1;
  });
  svg.addEventListener('pointerleave', () => { cross.style.display = 'none'; dots.forEach((d) => (d.style.display = 'none')); tip.style.opacity = 0; });
  holder.append(svg, tip);
  if (errs.length) holder.append(h('div', { class: 'chart-err small' }, `${errs[0].name}: ${errs[0].error}`));
  const legend = h('div', { class: 'legend' }, sampled.map((sr, i) => h('span', {}, h('i', { style: { background: SERIES_COLORS[i] } }), sr.name)));
  holder.append(legend);
}

// ---------- тайловая карта ----------
export const brushes = new Map();
export function tileRows(d) {
  const rows = [];
  for (let r = 0; r < d.rows; r++) rows.push(d.cells.slice(r * d.cols, (r + 1) * d.cols));
  return rows;
}
export function drawTiles(cv, d, cell = 16) {
  cv.width = d.cols * cell; cv.height = d.rows * cell;
  const g = cv.getContext('2d');
  g.font = `bold ${Math.floor(cell * 0.75)}px JetBrains Mono, monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
    const ch = d.cells[r * d.cols + c] || '.';
    const t = TILES[ch] || TILES['.'];
    g.fillStyle = ch === '.' || !t.glyph ? t.color : TILES['.'].color;
    g.fillRect(c * cell, r * cell, cell, cell);
    if (t.glyph && ch !== '~') {
      g.fillStyle = t.color;
      g.fillText(t.glyph, c * cell + cell / 2, r * cell + cell / 2 + 1);
    } else if (ch === '~') {
      g.fillStyle = t.color; g.fillRect(c * cell, r * cell, cell, cell);
    }
    g.strokeStyle = 'rgba(255,255,255,.05)';
    g.strokeRect(c * cell + 0.5, r * cell + 0.5, cell - 1, cell - 1);
  }
}
export function resizeCells(d, cols, rows) {
  let out = '';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out += r < d.rows && c < d.cols ? d.cells[r * d.cols + c] : '.';
  return out;
}

// ---------- анимация спрайтов ----------
let tickerStarted = false;
export function startTicker() {
  if (tickerStarted) return;
  tickerStarted = true;
  const loop = (t) => {
    for (const el of document.querySelectorAll('.sprite-anim')) {
      const cols = +el.dataset.cols || 1, rows = +el.dataset.rows || 1, fps = +el.dataset.fps || 8;
      const total = +el.dataset.frames || cols * rows;
      const f = el.dataset.playing === '1' ? Math.floor((t / 1000) * fps) % total : +el.dataset.frame || 0;
      const c = f % cols, r = Math.floor(f / cols);
      el.style.backgroundPosition = `${cols > 1 ? (c / (cols - 1)) * 100 : 0}% ${rows > 1 ? (r / (rows - 1)) * 100 : 0}%`;
      if (el._label) el._label.textContent = `кадр ${f + 1}/${total}`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export async function pickImage(cb) {
  const inp = h('input', { type: 'file', accept: 'image/*' });
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    const src = await readFileAsDataURL(f);
    const img = await loadImage(src);
    cb(src, img, f.name);
  };
  inp.click();
}


// ---------- видео YouTube (общая отрисовка для элемента «Видео» и компонента) ----------
// Сначала обложка с кнопкой ▶ (не грузит плеер и не мешает таскать элемент), по клику — встроенный плеер.
export const playingVideos = new Set();
export function renderYouTube(d, key, rerender) {
  if (!d.id) return h('div', { class: 'yt-empty muted' }, 'Нет ссылки на видео');
  const src = d.src || 'yt';
  if (playingVideos.has(key)) {
    return h('div', { class: 'yt-frame' },
      h('iframe', { src: videoEmbedUrl(d), title: d.title || VIDEO_SITES[src], allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; screen-wake-lock', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', frameborder: '0' }),
      h('button', { class: 'yt-stop no-drag', title: 'Остановить и показать обложку', onClick: (e) => { e.stopPropagation(); playingVideos.delete(key); rerender(); } }, '■'));
  }
  const thumb = src === 'yt' ? `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg` : src === 'rutube' ? `https://rutube.ru/api/video/${d.id}/thumbnail/?redirect=1` : null;
  const color = src === 'rutube' ? '#00a1e7' : src === 'vk' ? '#0077ff' : '#f00';
  return h('div', { class: 'yt-cover vsrc-' + src },
    thumb ? h('img', { src: thumb, alt: d.title || '', draggable: 'false', onError: (e) => e.target.remove() }) : null,
    src !== 'yt' ? h('span', { class: 'v-site' }, VIDEO_SITES[src]) : null,
    h('button', { class: 'yt-play no-drag', title: 'Смотреть прямо на доске', onClick: (e) => { e.stopPropagation(); playingVideos.add(key); rerender(); } },
      s('svg', { viewBox: '0 0 68 48', width: 68, height: 48 }, s('path', { d: 'M66.5 7.7c-.8-2.9-3-5.2-5.9-6C55.3.3 34 .3 34 .3s-21.3 0-26.6 1.4c-2.9.8-5.1 3.1-5.9 6C.1 13 .1 24 .1 24s0 11 1.4 16.3c.8 2.9 3 5.2 5.9 6C12.7 47.7 34 47.7 34 47.7s21.3 0 26.6-1.4c2.9-.8 5.1-3.1 5.9-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3z', fill: color }), s('path', { d: 'M27 34V14l18 10z', fill: '#fff' }))),
    d.start ? h('span', { class: 'yt-time' }, `с ${Math.floor(d.start / 60)}:${String(d.start % 60).padStart(2, '0')}`) : null);
}
