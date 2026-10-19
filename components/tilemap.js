// Уровень: тайловая карта.
// Как в Godot: загружаете тайлсет (картинку), задаёте размер тайла, отступ и промежуток —
// картинка режется на тайлы, и ими рисуется уровень. Поверх можно ставить метки (старт, враги, монеты…).
// ЛКМ — рисовать, ПКМ — стирать, Shift+тянуть — прямоугольник, Alt+клик — пипетка.

const imgCache = new Map();    // assetId → HTMLImageElement
const brushTile = new Map();   // compId → индекс тайла
const modeOf = new Map();      // compId → 'tiles' | 'marks'
const emptyCache = new Map();  // ключ нарезки → Set пустых (прозрачных) тайлов

function getImg(src, id, onload) {
  if (!src) return null;
  const c = imgCache.get(id);
  if (c?.complete && c.naturalWidth) return c;
  if (!c) {
    const img = new Image();
    img.onload = () => onload?.();
    img.src = src;
    imgCache.set(id, img);
  } else if (onload) c.addEventListener('load', onload, { once: true });
  return null;
}

// параметры нарезки
export function slice(ts, iw, ih) {
  const tw = Math.max(1, +ts.tw || 16), th = Math.max(1, +ts.th || 16);
  const sep = Math.max(0, +ts.sep || 0), off = Math.max(0, +ts.off || 0);
  const cols = Math.max(0, Math.floor((iw - off + sep) / (tw + sep)));
  const rows = Math.max(0, Math.floor((ih - off + sep) / (th + sep)));
  return { tw, th, sep, off, cols, rows, count: cols * rows, src: (i) => ({ x: off + (i % cols) * (tw + sep), y: off + Math.floor(i / cols) * (th + sep) }) };
}
function emptyTiles(img, sl, key) {
  if (emptyCache.has(key)) return emptyCache.get(key);
  const set = new Set();
  try {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 0; i < sl.count; i++) {
      const { x, y } = sl.src(i);
      let empty = true;
      for (let yy = y; yy < y + sl.th && empty; yy += 1) for (let xx = x; xx < x + sl.tw; xx += 1) if (data[(yy * cv.width + xx) * 4 + 3] > 8) { empty = false; break; }
      if (empty) set.add(i);
    }
  } catch {}
  emptyCache.set(key, set);
  return set;
}

function defaultMap() {
  const cols = 20, rows = 12;
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(r === 0 || c === 0 || r === rows - 1 || c === cols - 1 ? '#' : '.');
  const set = (c, r, ch) => (cells[r * cols + c] = ch);
  set(2, 2, 'P'); set(17, 9, 'X'); set(8, 5, 'C'); set(12, 7, 'C'); set(14, 3, 'E');
  for (let r = 1; r < 8; r++) set(10, r, '#');
  return { cols, rows, cells: cells.join('') };
}
function resizeTiles(d, cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(r < d.rows && c < d.cols ? (d.tiles?.[r * d.cols + c] ?? -1) : -1);
  return out;
}

// отрисовка карты: тайлы из тайлсета + метки поверх
function drawMap(cv, d, lib, img, { cellPx, marks = true } = {}) {
  const ts = d.tileset;
  if (!ts || !img) {
    lib.drawTiles(cv, d, cellPx || 16);
    return;
  }
  const sl = slice(ts, img.naturalWidth, img.naturalHeight);
  const cw = cellPx || sl.tw, chh = cellPx ? Math.round((cellPx * sl.th) / sl.tw) : sl.th;
  cv.width = d.cols * cw; cv.height = d.rows * chh;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#0d1018'; g.fillRect(0, 0, cv.width, cv.height);
  for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
    const t = d.tiles?.[r * d.cols + c] ?? -1;
    if (t >= 0 && t < sl.count) { const s = sl.src(t); g.drawImage(img, s.x, s.y, sl.tw, sl.th, c * cw, r * chh, cw, chh); }
  }
  if (marks && d.showMarks !== false) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${Math.max(8, Math.floor(Math.min(cw, chh) * 0.7))}px JetBrains Mono, monospace`;
    for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
      const ch = d.cells[r * d.cols + c];
      if (!ch || ch === '.') continue;
      const t = lib.TILES[ch];
      if (!t) continue;
      g.fillStyle = t.color + '55'; g.fillRect(c * cw, r * chh, cw, chh);
      g.strokeStyle = t.color; g.lineWidth = 1; g.strokeRect(c * cw + 0.5, r * chh + 0.5, cw - 1, chh - 1);
      if (t.glyph) { g.fillStyle = '#fff'; g.fillText(t.glyph, c * cw + cw / 2, r * chh + chh / 2 + 1); }
    }
  }
  if (!cellPx) { // тонкая сетка в редакторе
    g.strokeStyle = 'rgba(255,255,255,.06)';
    for (let c = 1; c < d.cols; c++) { g.beginPath(); g.moveTo(c * cw + 0.5, 0); g.lineTo(c * cw + 0.5, cv.height); g.stroke(); }
    for (let r = 1; r < d.rows; r++) { g.beginPath(); g.moveTo(0, r * chh + 0.5); g.lineTo(cv.width, r * chh + 0.5); g.stroke(); }
  }
}

export default {
  type: 'tilemap',
  name: 'Тайловая карта',
  icon: '🧱',
  group: 'Уровни и баланс',
  description: 'Уровень из тайлсета (нарезка картинки как в Godot) + метки игровой логики',
  defaults: () => ({ name: 'Уровень 1-1', ...defaultMap(), tiles: null, tileset: null, showMarks: true }),

  render(ctx) {
    const { h, data: d, lib } = ctx;
    const ts = d.tileset;
    const src = ts ? ctx.asset(ts.asset) : null;
    const img = src ? getImg(src, ts.asset, () => ctx.rerender()) : null;
    const sl = img ? slice(ts, img.naturalWidth, img.naturalHeight) : null;
    const hasTiles = !!(ts && src);
    let mode = modeOf.get(ctx.compId) || (hasTiles ? 'tiles' : 'marks');
    if (!hasTiles) mode = 'marks';

    const cv = h('canvas', { class: 'tiles no-drag' });
    const redraw = () => drawMap(cv, d, lib, img);
    redraw();

    // ---- рисование ----
    let painting = false, rect = null;
    const cellAt = (e) => {
      const r = cv.getBoundingClientRect();
      const k = Math.min(r.width / cv.width, r.height / cv.height);
      const ox = (r.width - cv.width * k) / 2, oy = (r.height - cv.height * k) / 2;
      const cw = cv.width / d.cols, chh = cv.height / d.rows;
      const c = Math.floor((e.clientX - r.left - ox) / (cw * k));
      const rr = Math.floor((e.clientY - r.top - oy) / (chh * k));
      return c < 0 || rr < 0 || c >= d.cols || rr >= d.rows ? null : { c, r: rr };
    };
    const setCell = (c, r, erase) => {
      const idx = r * d.cols + c;
      if (mode === 'tiles') {
        if (!d.tiles || d.tiles.length !== d.cols * d.rows) d.tiles = resizeTiles({ ...d, tiles: d.tiles || [] }, d.cols, d.rows);
        const v = erase ? -1 : (brushTile.get(ctx.compId) ?? 0);
        if (d.tiles[idx] === v) return false;
        d.tiles[idx] = v;
      } else {
        const b = erase ? '.' : lib.brushes.get(ctx.compId) || '#';
        if (d.cells[idx] === b) return false;
        let cells = d.cells;
        if (b === 'P') cells = cells.replace(/P/g, '.');
        d.cells = cells.slice(0, idx) + b + cells.slice(idx + 1);
      }
      return true;
    };
    const commit = () => ctx.live(mode === 'tiles' ? { tiles: d.tiles } : { cells: d.cells });
    const erasing = (e) => e.button === 2 || e.buttons === 2 || eraser;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const p = cellAt(e);
      if (!p) return;
      if (e.altKey) { // пипетка
        if (mode === 'tiles') brushTile.set(ctx.compId, d.tiles?.[p.r * d.cols + p.c] ?? -1); else lib.brushes.set(ctx.compId, d.cells[p.r * d.cols + p.c]);
        ctx.rerender();
        return;
      }
      cv.setPointerCapture(e.pointerId);
      ctx.begin();
      if (e.shiftKey) { rect = { a: p, erase: erasing(e) }; return; }
      painting = true;
      if (setCell(p.c, p.r, erasing(e))) { redraw(); commit(); }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = cellAt(e);
      if (!p) return;
      if (rect) {
        redraw();
        const g = cv.getContext('2d'), cw = cv.width / d.cols, chh = cv.height / d.rows;
        g.strokeStyle = '#22d3a6'; g.lineWidth = 2;
        g.strokeRect(Math.min(rect.a.c, p.c) * cw, Math.min(rect.a.r, p.r) * chh, (Math.abs(p.c - rect.a.c) + 1) * cw, (Math.abs(p.r - rect.a.r) + 1) * chh);
        rect.b = p;
        return;
      }
      if (painting && setCell(p.c, p.r, erasing(e))) { redraw(); commit(); }
    });
    cv.addEventListener('pointerup', (e) => {
      painting = false;
      if (rect) {
        const b = rect.b || rect.a;
        for (let r = Math.min(rect.a.r, b.r); r <= Math.max(rect.a.r, b.r); r++) for (let c = Math.min(rect.a.c, b.c); c <= Math.max(rect.a.c, b.c); c++) setCell(c, r, rect.erase);
        rect = null;
        redraw(); commit();
      }
    });

    // ---- палитра ----
    let eraser = false;
    const marksPal = h('div', { class: 'tile-pal' }, Object.entries(lib.TILES).map(([ch, t]) =>
      h('button', {
        class: 'tile-b' + (ch === (lib.brushes.get(ctx.compId) || '#') ? ' on' : ''), title: t.name, style: { '--c': t.color },
        onClick: (e) => { lib.brushes.set(ctx.compId, ch); e.currentTarget.parentElement.querySelectorAll('.tile-b').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); },
      }, t.glyph || '')));
    let tilesPal = null;
    if (hasTiles && sl) {
      const empty = emptyTiles(img, sl, `${ts.asset}|${sl.tw}|${sl.th}|${sl.sep}|${sl.off}`);
      const cur = brushTile.get(ctx.compId) ?? 0;
      const btns = [];
      for (let i = 0; i < sl.count; i++) {
        if (empty.has(i)) continue;
        const tc = h('canvas', { width: sl.tw, height: sl.th, class: 'tile-thumb' });
        const g = tc.getContext('2d'); g.imageSmoothingEnabled = false;
        const s = sl.src(i); g.drawImage(img, s.x, s.y, sl.tw, sl.th, 0, 0, sl.tw, sl.th);
        btns.push(h('button', { class: 'tile-t' + (i === cur ? ' on' : ''), title: `Тайл #${i}`, onClick: (e) => {
          brushTile.set(ctx.compId, i); eraser = false;
          e.currentTarget.closest('.tileset-pal').querySelectorAll('.tile-t').forEach((b) => b.classList.remove('on'));
          e.currentTarget.classList.add('on');
        } }, tc));
      }
      tilesPal = h('div', { class: 'tileset-pal scroll' },
        h('button', { class: 'tile-t eraser', title: 'Ластик (или ПКМ)', onClick: (e) => {
          eraser = true;
          e.currentTarget.parentElement.querySelectorAll('.tile-t').forEach((b) => b.classList.remove('on'));
          e.currentTarget.classList.add('on');
        } }, '⌫'), btns);
    }
    const tabs = hasTiles ? h('div', { class: 'tm-tabs' },
      h('button', { class: 'tm-tab' + (mode === 'tiles' ? ' on' : ''), onClick: () => { modeOf.set(ctx.compId, 'tiles'); ctx.rerender(); } }, `🧱 Тайлы (${sl ? sl.count : '…'})`),
      h('button', { class: 'tm-tab' + (mode === 'marks' ? ' on' : ''), onClick: () => { modeOf.set(ctx.compId, 'marks'); ctx.rerender(); } }, '⚑ Метки')) : null;

    return h('div', { class: 'cx-tilemap' },
      h('div', { class: 'row' }, ctx.field('name', { cls: 'inline-title', placeholder: 'Название уровня' }), h('span', { class: 'muted small' }, `${d.cols}×${d.rows}`)),
      tabs,
      mode === 'tiles' ? tilesPal : marksPal,
      !hasTiles ? h('button', { class: 'ghost-btn tm-load', onClick: () => { if (!ctx.settingsOpen) ctx.toggleSettings(); } }, '🧱 Загрузить тайлсет (нарезка как в Godot)') : null,
      h('div', { class: 'tiles-wrap', style: { aspectRatio: `${cv.width} / ${cv.height}` } }, cv),
      h('div', { class: 'muted small' }, 'ЛКМ — рисовать · ПКМ — стирать · Shift+тянуть — прямоугольник · Alt+клик — пипетка'));
  },

  settings(ctx) {
    const { h, data: d, lib } = ctx;
    const ts = d.tileset;
    const src = ts ? ctx.asset(ts.asset) : null;
    const img = src ? getImg(src, ts.asset, () => ctx.rerender()) : null;
    const load = () => ctx.pickImage((data, im) => {
      const asset = ctx.addAsset(data);
      const guess = [32, 16, 48, 64, 24, 8].find((s) => im.width % s === 0 && im.height % s === 0) || 16;
      ctx.change({ tileset: { asset, tw: ts?.tw || guess, th: ts?.th || guess, sep: ts?.sep || 0, off: ts?.off || 0 }, tiles: d.tiles || Array(d.cols * d.rows).fill(-1) });
    });
    const num = (key, label) => {
      const inp = h('input', { class: 'f num', type: 'number', min: 0, max: 512, value: ts?.[key] ?? 0 });
      inp.onchange = () => ctx.change({ tileset: { ...ts, [key]: Math.max(key === 'tw' || key === 'th' ? 1 : 0, Math.round(+inp.value || 0)) } });
      return [h('label', {}, label), inp];
    };
    // превью нарезки
    let preview = null;
    if (img) {
      const sl = slice(ts, img.naturalWidth, img.naturalHeight);
      const pv = h('canvas', { width: img.naturalWidth, height: img.naturalHeight, class: 'slice-preview' });
      const g = pv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0);
      g.strokeStyle = 'rgba(34,211,166,.9)'; g.lineWidth = Math.max(1, img.naturalWidth / 400);
      for (let i = 0; i < sl.count; i++) { const s = sl.src(i); g.strokeRect(s.x + 0.5, s.y + 0.5, sl.tw - 1, sl.th - 1); }
      preview = h('div', { class: 'slice-box' }, pv, h('div', { class: 'muted small' }, `${img.naturalWidth}×${img.naturalHeight} px → ${sl.cols}×${sl.rows} = ${sl.count} тайлов`));
    }
    const size = (key) => {
      const inp = h('input', { class: 'f num', type: 'number', min: 4, max: 128, value: d[key] });
      inp.onchange = () => {
        const v = ctx.clamp(Math.round(+inp.value || 4), 4, 128);
        const cols = key === 'cols' ? v : d.cols, rows = key === 'rows' ? v : d.rows;
        ctx.change({ cols, rows, cells: lib.resizeCells(d, cols, rows), tiles: d.tiles ? resizeTiles(d, cols, rows) : null });
      };
      return inp;
    };
    const marks = h('input', { type: 'checkbox', checked: d.showMarks !== false });
    marks.onchange = () => ctx.change({ showMarks: marks.checked });
    const png = (withMarks) => {
      const cv = document.createElement('canvas');
      if (img) drawMap(cv, d, lib, img, { cellPx: Math.max(16, ts.tw * 2), marks: withMarks }); else lib.drawTiles(cv, d, 32);
      cv.toBlob((b) => ctx.download((d.name || 'level') + '.png', b));
    };
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Тайлсет'), h('div', { class: 'row' },
        h('button', { class: 'ghost-btn', onClick: load }, ts ? 'Заменить картинку' : '⤒ Загрузить картинку'),
        ts ? h('button', { class: 'ghost-btn', onClick: () => ctx.change({ tileset: null }) }, 'Убрать') : null),
      ...(ts ? [...num('tw', 'Ширина тайла, px'), ...num('th', 'Высота тайла, px'), ...num('sep', 'Промежуток, px'), ...num('off', 'Отступ от края, px')] : []),
      preview ? h('div', { class: 'set-note' }, preview) : null,
      h('label', {}, 'Карта, клеток'), h('div', { class: 'row' }, size('cols'), '×', size('rows')),
      h('label', {}, 'Метки поверх тайлов'), marks,
      h('label', {}, 'Экспорт'), h('div', { class: 'row' },
        h('button', { class: 'ghost-btn', onClick: () => png(false) }, '⤓ PNG'),
        h('button', { class: 'ghost-btn', onClick: () => png(true) }, '⤓ PNG с метками'),
        h('button', { class: 'ghost-btn', onClick: () => ctx.download((d.name || 'level') + '.json', JSON.stringify(exportJson(d, { lib }), null, 2)) }, '⤓ JSON')),
      h('div', { class: 'set-note' }, 'Тайлсет режется сеткой: размер тайла + промежуток между тайлами + отступ от края, как в Godot (Texture Region / Separation / Margins). Пустые прозрачные тайлы скрыты из палитры.'));
  },
  text: (d) => d.name,
  exportMd: (d, x) => `**🗺 ${d.name}** (${d.cols}×${d.rows}${d.tileset ? `, тайлсет ${d.tileset.tw}×${d.tileset.th}` : ''})\n\n\`\`\`\n${x.lib.tileRows(d).join('\n')}\n\`\`\``,
  exportJson,
};

function exportJson(d, x) {
  const out = { name: d.name, width: d.cols, height: d.rows, marks: x.lib.tileRows(d), legend: Object.fromEntries(Object.entries(x.lib.TILES).map(([k, v]) => [k, v.name])) };
  if (d.tileset) {
    out.tileset = { asset: d.tileset.asset, tileWidth: d.tileset.tw, tileHeight: d.tileset.th, separation: d.tileset.sep || 0, margin: d.tileset.off || 0 };
    const rows = [];
    for (let r = 0; r < d.rows; r++) rows.push((d.tiles || []).slice(r * d.cols, (r + 1) * d.cols));
    out.tiles = rows; // индекс тайла в тайлсете (слева направо, сверху вниз), -1 — пусто
  }
  return out;
}
