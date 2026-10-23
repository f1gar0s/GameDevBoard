// Карта: сгенерированная (мир — континент, острова, архипелаг, нагорье…; город — средневековый или современный)
// или своё изображение. Рельеф можно править кистями, поверх рисовать, смотреть в 3D и выгружать
// карту высот RAW для Unity / Unreal. Метки со ссылками работают как кнопки — ведут на фрейм, объект или другую карту.
import { SEA, heights, paintWorld, modern, town, encodeDelta, decodeDelta, resample, heightmapRaw, heightmapPng } from '../js/terrain.js';
import { open3D } from '../js/terrain3d.js';

export const SIZES = { s: ['Маленькая', 80, 56], m: ['Средняя', 120, 80], l: ['Большая', 180, 120], xl: ['Огромная', 256, 170], sq: ['Квадрат', 256, 256] };
export const TERRAINS = { continent: 'Континент', pangaea: 'Суперконтинент', islands: 'Острова', archipelago: 'Архипелаг', highlands: 'Нагорье', lakes: 'Озёрный край' };
const ICONS = ['📍', '🏰', '🏘', '🏠', '⛪', '🏛', '⚔', '🛡', '⛰', '🌲', '🌊', '⚓', '🕳', '💀', '🐉', '💎', '⭐', '❓'];
const GEN = { scale: [1, 0.4, 2.5, 0.05, 'Масштаб материков'], detail: [5, 2, 8, 1, 'Детализация'], peaks: [1, 0, 2, 0.05, 'Высота гор'], rivers: [7, 0, 20, 1, 'Реки'], forest: [50, 0, 100, 1, 'Леса'], smooth: [0, 0, 6, 1, 'Сглаживание'] };
const HTOOLS = [['raise', '⛰', 'Поднять рельеф'], ['lower', '🕳', 'Опустить рельеф'], ['smooth', '〰', 'Сгладить'], ['flatten', '▬', 'Выровнять по высоте точки нажатия'], ['water', '🌊', 'Сделать водой'], ['land', '🏝', 'Сделать равниной (сушей)']];
const PTOOLS = [['paint', '🖌', 'Рисовать поверх карты'], ['erase', '🧽', 'Стереть нарисованное']];
// старые карты: style medieval → мир, modern → современный город
const kindOf = (d) => d.kind || (d.style === 'modern' ? 'city' : 'world');
const cityStyle = (d) => d.city || (d.style === 'modern' ? 'modern' : 'medieval');
const dims = (d) => [Math.max(32, Math.min(512, d.w | 0 || 120)), Math.max(32, Math.min(512, d.h | 0 || 80))];
const cellFor = (W) => (W > 300 ? 2 : W > 180 ? 3 : 4);
const genOpts = (d) => ({ terrain: d.terrain, sea: d.sea, scale: d.scale, detail: d.detail, peaks: d.peaks, smooth: d.smooth, look: d.look, rivers: d.rivers, forest: d.forest });

// итоговые высоты мира: генерация + ручные правки (кэш по параметрам)
const baseCache = new Map();
function baseHeights(d) {
  const [W, H] = dims(d);
  const o = genOpts(d);
  const key = JSON.stringify([W, H, d.seed, o.terrain, o.sea, o.scale, o.detail, o.peaks, o.smooth]);
  if (!baseCache.has(key)) { if (baseCache.size > 12) baseCache.clear(); baseCache.set(key, heights(W, H, d.seed >>> 0, o)); }
  return baseCache.get(key);
}
function deltaFor(d, ctx, W, H) {
  const dl = decodeDelta(d.heightAsset ? ctx.asset(d.heightAsset) : null);
  return dl ? resample(dl.D, dl.W, dl.H, W, H) : new Float32Array(W * H);
}
export function worldHeights(d, ctx) {
  const [W, H] = dims(d);
  const B = baseHeights(d), D = deltaFor(d, ctx, W, H);
  const E = new Float32Array(W * H);
  for (let i = 0; i < E.length; i++) E[i] = B[i] + D[i];
  return { E, W, H };
}
function drawMap(cv, d, ctx, cell, E) {
  const [W, H] = dims(d);
  cv.width = W * cell; cv.height = H * cell;
  const g = cv.getContext('2d');
  if (kindOf(d) === 'city') (cityStyle(d) === 'modern' ? modern : town)(g, W, H, cell, d.seed >>> 0);
  else paintWorld(g, W, H, cell, d.seed >>> 0, E || worldHeights(d, ctx).E, genOpts(d));
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
const ui = new Map();           // id поля → { gen, edit, mode, size, power, color }
const uiOf = (id) => { if (!ui.has(id)) ui.set(id, { gen: false, edit: false, mode: 'raise', size: 6, power: 50, color: '#c0392b' }); return ui.get(id); };

// ---------- окно экспорта карты высот ----------
function heightmapDialog(ctx, d) {
  const { h } = ctx;
  const { E, W, H } = worldHeights(d, ctx);
  const res = h('select', { class: 'input' },
    h('optgroup', { label: 'Unity (2ⁿ+1)' }, [257, 513, 1025, 2049].map((r) => h('option', { value: r, selected: r === 513 }, `${r} × ${r}`))),
    h('optgroup', { label: 'Unreal (рекомендуемые)' }, [505, 1009, 2017].map((r) => h('option', { value: r }, `${r} × ${r}`))));
  const flat = h('input', { type: 'checkbox' });
  const prev = h('div', { class: 'hm-prev' });
  const upd = () => prev.replaceChildren(heightmapPng(E, W, H, 256, { flatSea: flat.checked }));
  flat.onchange = upd; upd();
  const raw = (ext) => {
    const r = +res.value;
    const { data, seaLevel } = heightmapRaw(E, W, H, r, { flatSea: flat.checked });
    ctx.download(`heightmap_${r}.${ext}`, new Blob([data.buffer], { type: 'application/octet-stream' }));
    ctx.toast(`Готово: ${r}×${r}, 16 бит. Уровень моря — ${(seaLevel * 100).toFixed(1)}% высоты`, 'ok', 4500);
  };
  ctx.modal('⛰ Карта высот', h('div', { class: 'hm-dlg' },
    h('div', { class: 'row gap' }, prev,
      h('div', { class: 'hm-side' },
        h('label', { class: 'kv-row' }, 'Разрешение', res),
        h('label', { class: 'row' }, flat, ' Плоское море (дно не выгружать)'),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn primary', onClick: () => raw('raw') }, '⤓ Unity .raw'),
          h('button', { class: 'btn primary', onClick: () => raw('r16') }, '⤓ Unreal .r16')),
        h('button', { class: 'btn', onClick: () => { const cv = heightmapPng(E, W, H, +res.value, { flatSea: flat.checked }); cv.toBlob((b) => ctx.download(`heightmap_${res.value}.png`, b)); } }, '⤓ PNG (8 бит, просмотр)'))),
    h('ul', { class: 'tips small' },
      h('li', {}, 'Формат: RAW, 16 бит, порядок байт Windows (little-endian), квадрат.'),
      h('li', {}, 'Unity: Terrain → Terrain Settings → Import Raw… → Depth 16 bit, Byte Order Windows, Resolution как в файле. Размер террейна задайте с теми же пропорциями, что у карты: ', `${W} : ${H}`, '.'),
      h('li', {}, 'Unreal: Landscape → Import from File → выберите .r16, разрешение подставится само.'))), { wide: true });
}

export default {
  type: 'mapgen',
  name: 'Карта',
  icon: '🗺',
  group: 'Уровни и баланс',
  description: 'Мир, город или своё изображение; кисти рельефа и рисования, 3D, карта высот RAW, метки-ссылки',
  defaults: () => ({ kind: 'world', terrain: 'continent', look: 'parchment', city: 'medieval', sea: 50, seed: Math.floor(Math.random() * 1e9), w: 120, h: 80, source: 'gen', asset: null, markers: [], heightAsset: null, paintAsset: null }),
  deps: (d) => (d.markers || []).map((m) => m.target).filter(Boolean),

  render(ctx) {
    const { h, data: d } = ctx;
    const kind = kindOf(d), src = d.source === 'image' ? 'image' : 'gen';
    const isWorld = src === 'gen' && kind === 'world';
    const isEdit = editing.has(ctx.compId);
    const U = uiOf(ctx.compId);
    if (!isWorld && HTOOLS.some(([k]) => k === U.mode)) U.mode = 'paint';
    const markers = d.markers || [];
    const [W, H] = dims(d);
    const cell = cellFor(W);
    // --- вид карты ---
    let view, worldE = null;
    const img = src === 'image' && d.asset ? ctx.asset(d.asset) : null;
    if (src === 'image') view = img ? h('img', { class: 'map-img', src: img, draggable: 'false' }) : h('div', { class: 'map-empty' }, d.asset ? '⏳ Изображение загружается…' : 'Загрузите изображение карты: кнопка «🖼 Изображение» или перетащите файл на карточку');
    else { view = h('canvas', { class: 'mapgen-cv' }); if (isWorld) worldE = worldHeights(d, ctx).E; drawMap(view, d, ctx, cell, worldE); }
    // слой рисунка поверх карты
    const paintCv = h('canvas', { class: 'map-paint' });
    const sizePaint = (aspect) => { paintCv.width = 1200; paintCv.height = Math.max(1, Math.round(1200 * aspect)); };
    const loadPaint = () => {
      const pa = d.paintAsset ? ctx.asset(d.paintAsset) : null;
      if (!pa) return;
      const im = new Image();
      im.onload = () => paintCv.getContext('2d').drawImage(im, 0, 0, paintCv.width, paintCv.height);
      im.src = pa;
    };
    if (src === 'image' && img) { sizePaint(0.66); view.onload = () => { sizePaint(view.naturalHeight / view.naturalWidth); loadPaint(); }; }
    else sizePaint(H / W);
    loadPaint();
    const layer = h('div', { class: 'map-markers' + (isEdit ? ' editing no-drag' : '') });
    const wrap = h('div', { class: 'mapgen-wrap' }, view, paintCv, layer);
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

    // --- кисти: правка рельефа и рисование поверх ---
    if (U.edit && (src === 'gen' || img)) {
      const brush = h('div', { class: 'map-brush no-drag' });
      const cur = h('div', { class: 'brush-cur' });
      brush.append(cur);
      const rect = () => brush.getBoundingClientRect();
      const showCur = (e) => {
        const r = rect();
        const rad = (U.size / W) * r.width;
        Object.assign(cur.style, { left: e.clientX - r.left + 'px', top: e.clientY - r.top + 'px', width: rad * 2 + 'px', height: rad * 2 + 'px', display: 'block' });
      };
      brush.addEventListener('pointermove', showCur);
      brush.addEventListener('pointerleave', () => (cur.style.display = 'none'));
      brush.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        brush.setPointerCapture(e.pointerId);
        ctx.begin();
        const isH = HTOOLS.some(([k]) => k === U.mode);
        const pw = U.power / 100;
        let last = null, raf = 0;
        // рельеф
        const B = isH ? baseHeights(d) : null;
        const D = isH ? deltaFor(d, ctx, W, H) : null;
        const Ecur = () => { const E = new Float32Array(W * H); for (let i = 0; i < E.length; i++) E[i] = B[i] + D[i]; return E; };
        let target = null;
        const redraw = () => { raf = 0; drawMap(view, d, ctx, cell, Ecur()); };
        const dab = (cx, cy) => {
          if (isH) {
            const r = U.size, r2 = r * r;
            if (target == null) { const i0 = Math.min(H - 1, Math.max(0, Math.round(cy))) * W + Math.min(W - 1, Math.max(0, Math.round(cx))); target = B[i0] + D[i0]; }
            for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++) {
              const q = (x - cx) ** 2 + (y - cy) ** 2;
              if (q > r2) continue;
              const fall = 1 - Math.sqrt(q) / r; // мягкий край
              const i = y * W + x, e = B[i] + D[i];
              let t = null, k = pw * fall;
              if (U.mode === 'raise') D[i] += 0.025 * k;
              else if (U.mode === 'lower') D[i] -= 0.025 * k;
              else if (U.mode === 'smooth') {
                let s = 0, n = 0;
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) { s += B[Y * W + X] + D[Y * W + X]; n++; } }
                t = s / n; k *= 0.5;
              } else if (U.mode === 'flatten') t = target;
              else if (U.mode === 'water') t = SEA - 0.06;
              else if (U.mode === 'land') t = 0.4;
              if (t != null) D[i] += (t - e) * Math.min(1, k * 0.5);
              D[i] = Math.max(-0.6, Math.min(0.6, D[i]));
            }
            if (!raf) raf = requestAnimationFrame(redraw);
          } else {
            const g = paintCv.getContext('2d');
            const sx = paintCv.width / W, rad = U.size * sx;
            g.save();
            g.globalCompositeOperation = U.mode === 'erase' ? 'destination-out' : 'source-over';
            g.globalAlpha = U.mode === 'erase' ? 1 : Math.max(0.05, pw);
            g.fillStyle = U.color;
            g.beginPath(); g.arc(cx * sx, cy * (paintCv.height / H), rad, 0, 7); g.fill();
            g.restore();
          }
        };
        const at = (ev) => { const r = rect(); return [((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * H]; };
        const stroke = (ev) => {
          const p = at(ev);
          if (last) {
            const dist = Math.hypot(p[0] - last[0], p[1] - last[1]), step = Math.max(0.5, U.size / 3);
            for (let s = step; s < dist; s += step) dab(last[0] + ((p[0] - last[0]) * s) / dist, last[1] + ((p[1] - last[1]) * s) / dist);
          }
          dab(p[0], p[1]);
          last = p;
        };
        stroke(e);
        const mv = (ev) => { showCur(ev); stroke(ev); };
        const up = () => {
          brush.removeEventListener('pointermove', mv); brush.removeEventListener('pointerup', up); brush.removeEventListener('pointercancel', up);
          if (isH) ctx.set({ heightAsset: ctx.addAsset(encodeDelta(D, W, H)) });
          else ctx.set({ paintAsset: ctx.addAsset(paintCv.toDataURL('image/png')) });
        };
        brush.addEventListener('pointermove', mv); brush.addEventListener('pointerup', up); brush.addEventListener('pointercancel', up);
      });
      wrap.append(brush);
    }
    // --- управление ---
    const seg = (fn, on, label, title) => h('button', { class: 'seg' + (on ? ' on' : ''), title, onClick: fn }, label);
    const presetKey = Object.entries(SIZES).find(([, [, w, hh]]) => w === W && hh === H)?.[0] || '';
    const sizeSel = h('select', { class: 'f sel', title: 'Готовые размеры' },
      Object.entries(SIZES).map(([k, [n, w, hh]]) => h('option', { value: k, selected: k === presetKey }, `${n} ${w}×${hh}`)),
      presetKey ? null : h('option', { value: '', selected: true }, 'Свой размер'));
    sizeSel.onchange = () => { const s = SIZES[sizeSel.value]; if (s) ctx.change({ w: s[1], h: s[2] }); };
    const num = (key, val) => {
      const el = h('input', { class: 'f num map-num', type: 'number', min: 32, max: 512, value: val, title: key === 'w' ? 'Ширина, клеток (32–512)' : 'Высота, клеток (32–512)' });
      el.onchange = () => ctx.change({ [key]: Math.max(32, Math.min(512, Math.round(+el.value) || 120)) });
      el.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); };
      return el;
    };
    const sizeRow = src === 'gen' ? h('div', { class: 'row wrap map-size' }, h('span', { class: 'muted small' }, 'Размер'), sizeSel, num('w', W), h('span', { class: 'muted' }, '×'), num('h', H)) : null;
    const opts = [];
    if (isWorld) {
      const ter = h('select', { class: 'f sel', title: 'Тип суши' }, Object.entries(TERRAINS).map(([k, v]) => h('option', { value: k, selected: (d.terrain || 'continent') === k }, v)));
      ter.onchange = () => ctx.change({ terrain: ter.value });
      const look = h('select', { class: 'f sel', title: 'Оформление' }, h('option', { value: 'parchment', selected: d.look !== 'atlas' }, '📜 Пергамент'), h('option', { value: 'atlas', selected: d.look === 'atlas' }, '🗺 Атлас'));
      look.onchange = () => ctx.change({ look: look.value });
      const sea = h('input', { type: 'range', min: 0, max: 100, value: d.sea ?? 50, class: 'no-drag', title: 'Уровень моря' });
      sea.onchange = () => ctx.change({ sea: +sea.value });
      opts.push(h('div', { class: 'row wrap' }, ter, look,
        h('button', { class: 'ghost-btn' + (U.gen ? ' on' : ''), title: 'Тонкие настройки генерации', onClick: () => { U.gen = !U.gen; ctx.rerender(); } }, (U.gen ? '▾' : '▸') + ' Генерация')),
        h('label', { class: 'row map-sea' }, h('span', { class: 'muted small' }, '🌊 Море'), sea));
      if (U.gen) opts.push(h('div', { class: 'gen-grid' }, Object.entries(GEN).map(([k, [def, min, max, step, label]]) => {
        const v = d[k] ?? def;
        const out = h('span', { class: 'mono small' }, String(v));
        const r = h('input', { type: 'range', min, max, step, value: v, class: 'no-drag' });
        r.oninput = () => (out.textContent = r.value);
        r.onchange = () => ctx.change({ [k]: +r.value });
        return [h('span', { class: 'muted small' }, label), r, out];
      }), h('button', { class: 'ghost-btn', onClick: () => ctx.change(Object.fromEntries(Object.keys(GEN).map((k) => [k, undefined]))) }, '⟲ По умолчанию')));
    } else if (src === 'gen') {
      const cs = h('select', { class: 'f sel', title: 'Стиль города' }, h('option', { value: 'medieval', selected: cityStyle(d) !== 'modern' }, '🏰 Средневековый'), h('option', { value: 'modern', selected: cityStyle(d) === 'modern' }, '🏙 Современный'));
      cs.onchange = () => ctx.change({ city: cs.value, style: undefined });
      opts.push(h('div', { class: 'row wrap' }, cs));
    }
    // панель кистей
    let tools = null;
    if (U.edit) {
      const tb = (k, ic, t) => h('button', { class: 'tool-b' + (U.mode === k ? ' on' : ''), title: t, onClick: () => { U.mode = k; ctx.rerender(); } }, ic);
      const rng = (key, min, max, label) => { const r = h('input', { type: 'range', min, max, value: U[key], class: 'no-drag', title: label }); r.oninput = () => (U[key] = +r.value); return h('label', { class: 'row tool-r' }, h('span', { class: 'muted small' }, label), r); };
      const color = h('input', { type: 'color', value: U.color, title: 'Цвет кисти' });
      color.oninput = () => (U.color = color.value);
      tools = h('div', { class: 'map-tools' },
        h('div', { class: 'row wrap' },
          isWorld ? h('div', { class: 'tool-grp', title: 'Рельеф: карта перекрашивается по высоте' }, HTOOLS.map(([k, ic, t]) => tb(k, ic, t))) : null,
          h('div', { class: 'tool-grp' }, PTOOLS.map(([k, ic, t]) => tb(k, ic, t)), color)),
        h('div', { class: 'row wrap' }, rng('size', 1, 40, 'Размер'), rng('power', 5, 100, 'Сила'),
          h('span', { class: 'grow' }),
          isWorld && d.heightAsset ? h('button', { class: 'ghost-btn', title: 'Убрать все правки рельефа', onClick: () => ctx.change({ heightAsset: null }) }, '⟲ Рельеф') : null,
          d.paintAsset ? h('button', { class: 'ghost-btn', title: 'Стереть весь рисунок', onClick: () => ctx.change({ paintAsset: null }) }, '⟲ Рисунок') : null));
    }
    const png = () => {
      const out = document.createElement('canvas');
      const finish = (w, hh, scale) => {
        const g = out.getContext('2d');
        const pc = paintCv;
        if (d.paintAsset) g.drawImage(pc, 0, 0, w, hh);
        drawMarkers(g, markers, w, hh, scale);
        out.toBlob((b) => ctx.download(`map_${kind}_${d.seed}.png`, b));
      };
      if (src === 'image') {
        if (!img) return;
        const im = new Image();
        im.onload = () => { out.width = im.naturalWidth; out.height = im.naturalHeight; out.getContext('2d').drawImage(im, 0, 0); finish(out.width, out.height, Math.max(1, out.width / 600)); };
        im.src = img;
      } else { drawMap(out, d, ctx, Math.max(4, Math.round(1600 / W)), worldE); finish(out.width, out.height, out.width / 600); }
    };
    const upload = () => ctx.pickImage((dataUrl, im, name) => ctx.change({ source: 'image', asset: ctx.addAsset(dataUrl), name }));
    return h('div', { class: 'cx-mapgen' },
      h('div', { class: 'row wrap' },
        h('div', { class: 'segs' },
          seg(() => ctx.change({ source: 'gen', kind: 'world', style: undefined }), isWorld, '🌍 Мир', 'Сгенерировать карту мира'),
          seg(() => ctx.change({ source: 'gen', kind: 'city', style: undefined }), src === 'gen' && kind === 'city', '🏘 Город', 'Сгенерировать карту города'),
          seg(() => (d.asset ? ctx.change({ source: 'image' }) : upload()), src === 'image', '🖼 Изображение', 'Своё изображение карты')),
        h('span', { class: 'grow' }),
        src === 'gen' ? h('button', { class: 'play-btn', title: 'Новая случайная карта (правки рельефа сохранятся)', onClick: () => ctx.change({ seed: Math.floor(Math.random() * 1e9) }) }, '🎲') : h('button', { class: 'ghost-btn', title: 'Заменить изображение', onClick: upload }, '⤒'),
        h('button', { class: 'ghost-btn', title: 'Скачать PNG с рисунком и метками', onClick: png }, '⤓')),
      sizeRow,
      ...opts,
      tools,
      wrap,
      h('div', { class: 'row wrap' },
        h('button', { class: 'ghost-btn' + (U.edit ? ' on' : ''), title: U.edit ? 'Готово' : 'Кисти: рельеф и рисование поверх карты', onClick: () => { U.edit = !U.edit; if (U.edit) editing.delete(ctx.compId); ctx.rerender(); } }, U.edit ? '✓ Кисти' : '✏ Кисти'),
        h('button', { class: 'ghost-btn' + (isEdit ? ' on' : ''), title: isEdit ? 'Готово' : 'Ставить и править метки', onClick: () => { isEdit ? editing.delete(ctx.compId) : editing.add(ctx.compId); U.edit = false; ctx.rerender(); } }, isEdit ? '✓ Метки' : '📍 Метки'),
        isWorld ? h('button', { class: 'ghost-btn', title: 'Упрощённая 3D-модель рельефа (без цветов), экспорт OBJ', onClick: () => { const r = worldHeights(d, ctx); open3D(r.E, r.W, r.H, { title: ctx.card?.data?.title || 'Рельеф', name: 'terrain_' + d.seed }); } }, '🧊 3D') : null,
        isWorld ? h('button', { class: 'ghost-btn', title: 'Карта высот RAW 16 бит для Unity / Unreal', onClick: () => heightmapDialog(ctx, d) }, '⛰ RAW') : null,
        h('span', { class: 'muted small grow' }, isEdit ? 'Клик по карте — новая метка, перетаскивание — сдвинуть, клик по метке — настроить' : U.edit ? 'Рисуйте по карте; карта перекрашивается по высоте' : markers.length ? `меток: ${markers.length}` : ''),
        src === 'gen' ? h('span', { class: 'muted small mono' }, `#${d.seed}`) : null),
      mkPanel);
  },
  settings(ctx) {
    const { h } = ctx;
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Зерно'), ctx.field('seed', { type: 'number', num: true, cls: 'num wide-num', commit: true }),
      h('div', { class: 'set-note' }, 'Одинаковое зерно и настройки всегда дают одинаковую карту. Ручные правки рельефа хранятся отдельно и накладываются поверх — их можно сбросить кнопкой «⟲ Рельеф».'));
  },
  text: (d) => ['карта', ...(d.markers || []).map((m) => m.label)].join(' '),
  exportMd: (d) => `🗺 Карта (${d.source === 'image' ? 'своё изображение' : kindOf(d) === 'city' ? 'город' : TERRAINS[d.terrain || 'continent']}, ${dims(d).join('×')})${(d.markers || []).length ? ': ' + d.markers.map((m) => (m.icon || '📍') + ' ' + (m.label || '')).join(', ') : ''}`,
  exportJson: (d) => ({ source: d.source || 'gen', kind: kindOf(d), terrain: d.terrain, city: cityStyle(d), seed: d.seed, width: dims(d)[0], height: dims(d)[1], seaLevel: SEA, markers: (d.markers || []).map((m) => ({ x: m.x, y: m.y, icon: m.icon, label: m.label, target: m.target })) }),
};
