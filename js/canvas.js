// Бесконечный холст: отрисовка, выделение, перетаскивание, связи, инструменты
import { store, pageOf, pathOf, framesInOrder } from './store.js';
import { WIDGETS, STICKY_COLORS, ACCENT_COLORS } from './widgets.js';
import { setLinkHandler, autoSig } from './richtext.js';
import { setToolIcon } from './picker.js';
import { resolveList, dropImageOnCard } from './card.js';
import { makeCard, liveEnv, toolById } from './tools.js';
import { h, s, uid, clamp, isTyping, toast, readFileAsDataURL, loadImage, debounce, parseYouTube, youTubeTitle, imageFileToDataURL } from './util.js';
import { playDialogue } from './play.js';

export const view = { x: 0, y: 0, z: 1 };
export const sel = new Set();
export let selLink = null;
export let tool = 'select';
export const pen = { color: '#e6e8ef', width: 3 };

let vp, world, itemsEl, linksG, defs, selbox, marquee, ctxbar, tempG, cursorsEl;
const nodes = new Map(); // id -> { el, key }
const linkEls = new Map();
let spaceDown = false;
let gesture = null;
const pointers = new Map();
const toolListeners = [];

export const onToolChange = (fn) => toolListeners.push(fn);
export function setTool(t) {
  tool = t;
  vp.dataset.tool = t;
  toolListeners.forEach((f) => f(t));
}

// ---------- координаты ----------
export function screenToWorld(cx, cy) {
  const r = vp.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
}
export function centerWorld() {
  const r = vp.getBoundingClientRect();
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}
// вид (сдвиг и масштаб) запоминается для каждого фрейма отдельно
const saveView = debounce(() => { if (store.board) { store.board.view = { ...view }; (store.board.views ??= {})[store.page] = { ...view }; store.save(); } }, 500);
const onPage = (it) => pageOf(it) === store.page;
const pageItems = () => store.pageItems();
const viewListeners = [];
export const onViewChange = (fn) => viewListeners.push(fn);
export function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  world.style.setProperty('--iz', 1 / view.z);
  const g = 24 * view.z;
  vp.style.backgroundSize = `${g}px ${g}px, ${g * 5}px ${g * 5}px, ${g * 5}px ${g * 5}px`;
  vp.style.backgroundPosition = `${view.x}px ${view.y}px`;
  vp.classList.toggle('far', view.z < 0.45);
  positionCtxbar();
  viewListeners.forEach((f) => f(view));
  saveView();
}
export function zoomAt(cx, cy, factor) {
  const r = vp.getBoundingClientRect();
  const nz = clamp(view.z * factor, 0.08, 4);
  const px = cx - r.left, py = cy - r.top;
  view.x = px - ((px - view.x) * nz) / view.z;
  view.y = py - ((py - view.y) * nz) / view.z;
  view.z = nz;
  applyView();
}
export function zoomBy(f) { const r = vp.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); }
export function setZoom(z) { zoomBy(z / view.z); }

function animateView(target, ms = 320) {
  const from = { ...view };
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    view.x = from.x + (target.x - from.x) * e;
    view.y = from.y + (target.y - from.y) * e;
    view.z = from.z + (target.z - from.z) * e;
    applyView();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function viewForRect(b, maxZ = 1.2, margin = 80) {
  const r = vp.getBoundingClientRect();
  const z = clamp(Math.min((r.width - margin * 2) / Math.max(b.w, 1), (r.height - margin * 2) / Math.max(b.h, 1)), 0.1, maxZ);
  return { z, x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z };
}
export function bboxOf(items) {
  if (!items.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) { x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y); x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function fitAll(animate = true) {
  const b = bboxOf(pageItems());
  if (!b) { const t = { x: vp.clientWidth / 2, y: vp.clientHeight / 2, z: 1 }; animate ? animateView(t) : (Object.assign(view, t), applyView()); return; }
  const t = viewForRect(b, 1);
  animate ? animateView(t) : (Object.assign(view, t), applyView());
}
export function focusItem(id) {
  const it = store.item(id);
  if (!it) return;
  // элемент в другом фрейме — сначала открываем этот фрейм
  if (!onPage(it)) { openPage(pageOf(it), { fit: false }); requestAnimationFrame(() => focusItem(id)); return; }
  animateView(viewForRect(it, 1.2, Math.max(120, vp.clientWidth * 0.18)));
  selectOnly(id);
  const n = nodes.get(id)?.el;
  if (n) { n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash'); }
}

// Открыть фрейм (страницу иерархии)
export function openPage(id, { fit = true } = {}) {
  if (!store.setPage(id)) return false;
  if (fit && !store.board.views?.[id]) requestAnimationFrame(() => fitAll(false));
  return true;
}
// Перейти по ссылке: фрейм иерархии, элемент на любом фрейме или имя (для [[ссылок]] в тексте)
export function goTo(target) {
  if (!target || !store.board) return false;
  if (store.tree[target]?.kind === 'frame') return openPage(target);
  if (store.item(target)) { focusItem(target); return true; }
  const q = String(target).trim().toLowerCase();
  if (!q) return false;
  const frames = Object.values(store.tree).filter((n) => n.kind === 'frame');
  const byPath = frames.find((n) => pathOf(store.tree, n.id).join('/').toLowerCase() === q);
  const byName = frames.find((n) => n.name.trim().toLowerCase() === q);
  if (byPath || byName) return openPage((byPath || byName).id);
  const it = Object.values(store.items).find((i) => (i.type === 'frame' || i.type === 'card') && (i.data.title || '').trim().toLowerCase() === q);
  if (it) { focusItem(it.id); return true; }
  toast('Не найдено: «' + target + '»', 'err');
  return false;
}
// Область на холсте → отдельный фрейм в иерархии (рядом с открытым)
export function areaToPage(id) {
  const a = store.item(id);
  if (!a) return;
  const cur = store.tree[store.page];
  const sibs = Object.values(store.tree).filter((n) => (n.parent || null) === (cur?.parent || null));
  const node = { id: uid('p'), kind: 'frame', name: (a.data.title || 'Новый фрейм').trim() || 'Новый фрейм', parent: cur?.parent || null, order: Math.max(0, ...sibs.map((n) => n.order ?? 0)) + 1 };
  store.checkpoint();
  store.setNode(node);
  moveToPage([id], node.id, false);
  openPage(node.id);
}
// Перенести элементы в другой фрейм
export function moveToPage(ids, page, checkpoint = true) {
  if (!store.tree[page] || !ids.length) return;
  if (checkpoint) store.checkpoint();
  const set = new Set(ids);
  // вместе с областью переносим всё, что в ней лежит
  for (const id of ids) {
    const f = store.item(id);
    if (f?.type !== 'frame') continue;
    for (const it of pageItems()) { const c = center(it); if (it.type !== 'frame' && c.x > f.x && c.x < f.x + f.w && c.y > f.y && c.y < f.y + f.h) set.add(it.id); }
  }
  for (const id of set) store.patch(id, { page });
  // связи между перенесёнными и оставшимися элементами больше не видны — предупредим
  const cut = Object.values(store.links).filter((l) => set.has(l.from) !== set.has(l.to)).length;
  if (cut) setTimeout(() => toast(`Связей между фреймами: ${cut} — они сохранены, но на холсте не рисуются`, 'info', 3500), 400);
  sel.clear(); refreshSelection();
  toast(`Перенесено: ${set.size} → «${store.tree[page].name}»`, 'ok', 2200);
}

// ---------- API для виджетов ----------
function apiFor(id) {
  return {
    id,
    get item() { return store.item(id); },
    begin() { store.checkpoint(); },
    live(data) { store.patch(id, { data }, { norender: true }); },
    set(data) { store.patch(id, { data }); },
    change(data) { store.checkpoint(); store.patch(id, { data }); },
    rerender() { const it = store.item(id); if (it) mountItem(it, true); },
  };
}

// ---------- отрисовка элементов ----------
let treeVer = 0; // меняется при переименовании фреймов — для автоссылок в тексте
const TEXTY = new Set(['sticky', 'text', 'shape', 'card']);
function renderKey(it) {
  let k = JSON.stringify(it.data) + '|' + it.w + '|' + it.h;
  if (TEXTY.has(it.type)) k += '|t' + treeVer;
  if (it.type === 'dialogue') k += '|' + store.outgoing(it.id).map((l) => l.label + l.to + (l.cond || '') + (l.actions || '')).join(',') + '|' + store.incoming(it.id).length;
  if (it.type === 'image' || it.type === 'sprite') k += '|' + (store.board.assets[it.data.asset] ? 1 : 0);
  const watch = WIDGETS[it.type]?.watch?.(it);
  if (watch?.length) k += '|' + watchSig(watch);
  const deps = WIDGETS[it.type]?.deps?.(it);
  if (deps?.length) k += '|' + deps.map((d) => { const x = store.item(d); const n = store.tree?.[d]; return x ? JSON.stringify(x.data) + (x.data.title || '') + pageOf(x) : n ? 'T' + pathOf(store.tree, d).join('/') : '∅'; }).join('|');
  return k;
}
function place(el, it) {
  el.style.left = it.x + 'px';
  el.style.top = it.y + 'px';
  el.style.width = it.w + 'px';
  el.style.height = it.type === 'card' ? '' : it.h + 'px';
  el.style.zIndex = it.z | 0;
}
// Карточки растут по содержимому: высоту меряем и сохраняем (для рамки выделения и связей)
const sizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => {
  for (const en of entries) {
    const id = en.target.dataset.id;
    const it = store.item(id);
    if (!it || it.type !== 'card') continue;
    const hh = Math.round(en.target.offsetHeight);
    if (hh > 0 && Math.abs(hh - it.h) > 1) {
      it.h = hh;
      scheduleArrange();
      updateLinksFor(id);
      if (sel.has(id)) updateSelUI(false);
      store.save();
    }
  }
}) : null;
function watchSig(types) {
  let sig = '';
  for (const x of Object.values(store.items)) if (x.type === 'card') for (const c of x.data.components || []) if (types.includes(c.type)) sig += x.id + c.id + JSON.stringify(c.data) + ';';
  return sig;
}
// карточки, следящие за типами компонентов (types = null — за любыми)
function remountWatchers(types) {
  for (const it of Object.values(store.items)) {
    if (it.type !== 'card') continue;
    const w = WIDGETS.card.watch(it);
    if (w.length && (!types || w.some((t) => types.includes(t)))) mountItem(it);
  }
}
// элементы, которые надо перерисовать, когда меняется карточка id (например, список вариантов)
function remountDependents(id) {
  for (const it of Object.values(store.items)) {
    if (it.id === id) continue;
    const deps = WIDGETS[it.type]?.deps?.(it);
    if (deps?.includes(id)) mountItem(it);
  }
}
const isTextEntry = (el) => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|color|button|range|file)$/.test(el.type)));
function mountItem(it, force = false) {
  if (!onPage(it)) { if (nodes.has(it.id)) { sizeObs?.unobserve(nodes.get(it.id).el); unmountItem(it.id); sel.delete(it.id); } return; }
  let rec = nodes.get(it.id);
  if (!rec) {
    rec = { el: h('div', { 'data-id': it.id }), key: null };
    nodes.set(it.id, rec);
    itemsEl.append(rec.el);
    if (it.type === 'card') sizeObs?.observe(rec.el);
  }
  const el = rec.el;
  el.className = `item t-${it.type}` + (sel.has(it.id) ? ' selected' : '') + (it.locked ? ' locked' : '');
  place(el, it);
  const key = renderKey(it);
  const editing = el.contains(document.activeElement) && isTextEntry(document.activeElement);
  if (force || (key !== rec.key && !editing)) {
    const W = WIDGETS[it.type];
    let content;
    try { content = W ? W.render(it, apiFor(it.id)) : h('div', { class: 'muted' }, 'Неизвестный тип: ' + it.type); }
    catch (e) { console.error(e); content = h('div', { class: 'muted' }, 'Ошибка отрисовки'); }
    el.replaceChildren(content);
    rec.key = key;
  }
}
function unmountItem(id) {
  nodes.get(id)?.el.remove();
  nodes.delete(id);
}
export const nodeOf = (id) => nodes.get(id)?.el;

// ---------- связи ----------
function center(it) { return { x: it.x + it.w / 2, y: it.y + it.h / 2 }; }

// ---------- раскладка внутри областей (как HBoxContainer / VBoxContainer / GridContainer в Godot) ----------
export const LAYOUTS = { free: 'Свободно', hbox: 'Строка', vbox: 'Столбец', grid: 'Сетка' };
const PAD = 20, GAP = 16;
const inRect = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
// ближайшая (самая маленькая) область, в которой лежит центр элемента
function parentArea(it, areas) {
  let best = null;
  const c = center(it);
  for (const a of areas) {
    if (a.id === it.id || (it.type === 'frame' && a.w * a.h <= it.w * it.h)) continue;
    if (inRect(c, a) && (!best || a.w * a.h < best.w * best.h)) best = a;
  }
  return best;
}
function arrangeArea(area, items, areas) {
  const mode = area.data.layout;
  if (!mode || mode === 'free') return;
  const kids = items.filter((it) => it.id !== area.id && !it.locked && parentArea(it, areas)?.id === area.id);
  if (!kids.length) return;
  const cx = (it) => it.x + it.w / 2, cy = (it) => it.y + it.h / 2;
  if (mode === 'hbox') kids.sort((a, b) => cx(a) - cx(b));
  else if (mode === 'vbox') kids.sort((a, b) => cy(a) - cy(b));
  else {
    // сетка: порядок чтения — по строкам (с допуском по высоте), затем слева направо
    const tol = Math.max(30, Math.min(...kids.map((k) => k.h)) / 2);
    kids.sort((a, b) => (Math.abs(cy(a) - cy(b)) < tol ? cx(a) - cx(b) : cy(a) - cy(b)));
  }
  const pos = new Map();
  let W = 0, H = 0;
  if (mode === 'hbox') {
    let x = 0;
    for (const k of kids) { pos.set(k.id, [x, 0]); x += k.w + GAP; H = Math.max(H, k.h); }
    W = x - GAP;
  } else if (mode === 'vbox') {
    let y = 0;
    for (const k of kids) { pos.set(k.id, [0, y]); y += k.h + GAP; W = Math.max(W, k.w); }
    H = y - GAP;
  } else {
    const cols = Math.max(1, Math.min(12, +area.data.cols || 3));
    const colW = Math.max(...kids.map((k) => k.w));
    let y = 0;
    for (let i = 0; i < kids.length; i += cols) {
      const row = kids.slice(i, i + cols);
      row.forEach((k, j) => pos.set(k.id, [j * (colW + GAP), y]));
      y += Math.max(...row.map((k) => k.h)) + GAP;
    }
    W = Math.min(cols, kids.length) * (colW + GAP) - GAP;
    H = y - GAP;
  }
  const o = { arranging: true };
  const aw = Math.max(160, Math.round(W + PAD * 2)), ah = Math.max(100, Math.round(H + PAD * 2));
  if (area.w !== aw || area.h !== ah) store.patch(area.id, { w: aw, h: ah }, o);
  for (const k of kids) {
    const [dx, dy] = pos.get(k.id);
    const nx = Math.round(area.x + PAD + dx), ny = Math.round(area.y + PAD + dy);
    if (k.x !== nx || k.y !== ny) store.patch(k.id, { x: nx, y: ny }, o);
  }
}
// разложить все области открытого фрейма (вложенные — сначала, чтобы внешние учли их новый размер)
export function arrangeAll() {
  if (!store.board) return;
  const areas0 = pageItems().filter((i) => i.type === 'frame' && i.data.layout && i.data.layout !== 'free').sort((a, b) => a.w * a.h - b.w * b.h);
  for (const a of areas0) {
    const items = pageItems();
    arrangeArea(store.item(a.id), items, items.filter((i) => i.type === 'frame'));
  }
  if (areas0.length && sel.size) updateSelUI(false);
}
const scheduleArrange = debounce(() => { if (gesture) scheduleArrange(); else arrangeAll(); }, 60);
function edgePoint(r, t) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = t.x - cx, dy = t.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? r.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? r.h / 2 / Math.abs(dy) : Infinity;
  const k = Math.min(sx, sy);
  return { x: cx + dx * k, y: cy + dy * k };
}
function markerFor(color) {
  const id = 'arr-' + color.replace(/[^a-z0-9]/gi, '');
  if (!defs.querySelector('#' + id)) {
    defs.append(s('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' },
      s('path', { d: 'M0,0 L10,5 L0,10 z', fill: color })));
    defs.lastChild.setAttribute('markerWidth', 14);
    defs.lastChild.setAttribute('markerHeight', 14);
  }
  return `url(#${id})`;
}
function renderLink(l) {
  const a = store.item(l.from), b = store.item(l.to);
  let g = linkEls.get(l.id);
  if (!a || !b || !onPage(a) || !onPage(b)) { g?.remove(); linkEls.delete(l.id); return; }
  if (!g) {
    g = s('g', { 'data-link': l.id, class: 'link' },
      s('path', { class: 'hit' }), s('path', { class: 'line' }),
      s('g', { class: 'lbl' }, s('rect', { rx: 6 }), s('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' })));
    linksG.append(g);
    linkEls.set(l.id, g);
  }
  const pa = edgePoint(a, center(b)), pb = edgePoint(b, center(a));
  const d = `M${pa.x.toFixed(1)} ${pa.y.toFixed(1)} L${pb.x.toFixed(1)} ${pb.y.toFixed(1)}`;
  const color = l.color || '#8b93a7';
  const [hit, line, lbl] = g.children;
  hit.setAttribute('d', d);
  line.setAttribute('d', d);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-dasharray', l.dashed ? '8 6' : '');
  line.setAttribute('marker-end', markerFor(color));
  if (l.both) line.setAttribute('marker-start', markerFor(color)); else line.removeAttribute('marker-start');
  g.classList.toggle('selected', selLink === l.id);
  const text = lbl.querySelector('text'), rect = lbl.querySelector('rect');
  const shown = (l.label || '') + (l.cond ? '  ?' + l.cond : '') + (l.actions ? '  ⚡' : '');
  if (shown.trim()) {
    lbl.style.display = '';
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    text.textContent = shown.trim();
    text.setAttribute('x', mx); text.setAttribute('y', my);
    const w = Math.min(320, shown.trim().length * 7.4 + 16);
    rect.setAttribute('x', mx - w / 2); rect.setAttribute('y', my - 12);
    rect.setAttribute('width', w); rect.setAttribute('height', 24);
    rect.setAttribute('stroke', color);
  } else lbl.style.display = 'none';
}
function updateLinksFor(id) {
  for (const l of Object.values(store.links)) if (l.from === id || l.to === id) renderLink(l);
}
function rerenderDialogue(id) {
  const it = store.item(id);
  if (it && it.type === 'dialogue') mountItem(it);
}

// ---------- выделение ----------
export function selectOnly(id) {
  sel.clear();
  if (id) sel.add(id);
  selLink = null;
  refreshSelection();
}
export function setSelection(ids) {
  sel.clear();
  ids.forEach((i) => sel.add(i));
  selLink = null;
  refreshSelection();
}
export function selectLink(id) {
  sel.clear();
  selLink = id;
  refreshSelection();
}
function refreshSelection() {
  for (const [id, rec] of nodes) rec.el.classList.toggle('selected', sel.has(id));
  for (const [id, g] of linkEls) g.classList.toggle('selected', id === selLink);
  updateSelUI(true);
}
const selListeners = [];
export const onSelection = (fn) => selListeners.push(fn);

function selectedItems() { return [...sel].map((id) => store.item(id)).filter(Boolean); }

function updateSelUI(rebuild = false) {
  const items = selectedItems();
  const b = bboxOf(items);
  if (!b) selbox.style.display = 'none';
  else {
    selbox.style.display = 'block';
    Object.assign(selbox.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
    const single = items.length === 1 && !items[0].locked;
    selbox.classList.toggle('single', single);
    selbox.classList.toggle('multi', items.length > 1);
  }
  if (rebuild && !ctxbar.contains(document.activeElement)) buildCtxbar();
  positionCtxbar();
  selListeners.forEach((f) => f(sel, selLink));
}

// ---------- контекстная панель ----------
function swatches(colors, current, onPick) {
  return h('div', { class: 'cx-colors' }, colors.map((c) =>
    h('button', { class: 'cx-sw' + (c === current ? ' on' : ''), style: { background: c }, title: c, onClick: () => onPick(c) })));
}
function patchSelected(fn) {
  store.checkpoint();
  for (const it of selectedItems()) {
    const p = fn(it);
    if (p) store.patch(it.id, p);
  }
  buildCtxbar();
}
function buildCtxbar() {
  ctxbar.replaceChildren();
  if (selLink) {
    const l = store.links[selLink];
    if (!l) { ctxbar.style.display = 'none'; return; }
    const inp = h('input', { class: 'cx-input', placeholder: 'Подпись / вариант ответа', value: l.label || '' });
    inp.onfocus = () => store.checkpoint();
    inp.oninput = () => store.patchLink(l.id, { label: inp.value });
    inp.onkeydown = (e) => { if (e.key === 'Enter' || e.key === 'Escape') inp.blur(); e.stopPropagation(); };
    const fromDlg = store.item(l.from)?.type === 'dialogue';
    const mk = (key, ph, title) => {
      const el = h('input', { class: 'cx-input small mono', placeholder: ph, title, value: l[key] || '' });
      el.onfocus = () => store.checkpoint();
      el.oninput = () => store.patchLink(l.id, { [key]: el.value });
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === 'Escape') el.blur(); e.stopPropagation(); };
      return el;
    };
    ctxbar.append(inp,
      fromDlg ? mk('cond', 'условие: item:cat_food', 'Показывать вариант, только если верно. Несколько — через пробел, ! — «не»') : null,
      fromDlg ? mk('actions', 'действия: take:cat_food set:cat_fed', 'Что сделать после выбора. Через пробел') : null,
      swatches(['#8b93a7', ...ACCENT_COLORS.slice(0, 6)], l.color || '#8b93a7', (c) => { store.checkpoint(); store.patchLink(l.id, { color: c }); buildCtxbar(); }),
      h('button', { class: 'cx-btn' + (l.dashed ? ' on' : ''), title: 'Пунктир', onClick: () => { store.checkpoint(); store.patchLink(l.id, { dashed: !l.dashed }); buildCtxbar(); } }, '┄'),
      h('button', { class: 'cx-btn' + (l.both ? ' on' : ''), title: 'Стрелки с двух сторон', onClick: () => { store.checkpoint(); store.patchLink(l.id, { both: !l.both }); buildCtxbar(); } }, '⟷'),
      h('button', { class: 'cx-btn', title: 'Развернуть', onClick: () => { store.checkpoint(); store.patchLink(l.id, { from: l.to, to: l.from }); rerenderDialogue(l.to); rerenderDialogue(l.from); } }, '⇄'),
      h('button', { class: 'cx-btn danger', title: 'Удалить связь (Del)', onClick: deleteSelection }, '🗑'));
    ctxbar.style.display = '';
    ctxbar._focus = () => inp.focus();
    return;
  }
  const items = selectedItems();
  if (!items.length) { ctxbar.style.display = 'none'; return; }
  const types = new Set(items.map((i) => i.type));
  const one = types.size === 1 ? [...types][0] : null;
  const first = items[0];
  const parts = [];
  if (one === 'sticky') parts.push(swatches(STICKY_COLORS, first.data.color, (c) => patchSelected(() => ({ data: { color: c } }))));
  if (one === 'shape') {
    parts.push(h('div', { class: 'cx-group' }, [['rect', '▭'], ['round', '⬭'], ['ellipse', '◯'], ['diamond', '◇'], ['hex', '⬡']].map(([k, ic]) =>
      h('button', { class: 'cx-btn' + (first.data.shape === k ? ' on' : ''), onClick: () => patchSelected(() => ({ data: { shape: k } })) }, ic))));
    parts.push(swatches(ACCENT_COLORS, first.data.color, (c) => patchSelected(() => ({ data: { color: c } }))));
  }
  if (one === 'frame') {
    parts.push(swatches(ACCENT_COLORS, first.data.color, (c) => patchSelected(() => ({ data: { color: c } }))));
    // раскладка содержимого области
    const lay = first.data.layout || 'free';
    const setLay = (mode) => { patchSelected(() => ({ data: { layout: mode } })); buildCtxbar(); };
    parts.push(h('div', { class: 'cx-group', title: 'Как располагать объекты внутри области' },
      [['free', '✥', 'Свободно — объекты лежат где положили'], ['hbox', '⇄', 'Строка (HBox) — объекты выстраиваются слева направо'], ['vbox', '⇅', 'Столбец (VBox) — объекты выстраиваются сверху вниз'], ['grid', '▦', 'Сетка — объекты выстраиваются таблицей']].map(([k, ic, t]) =>
        h('button', { class: 'cx-btn' + (lay === k ? ' on' : ''), title: t, onClick: () => setLay(k) }, ic))));
    if (lay === 'grid') {
      const cols = h('input', { class: 'cx-input small', type: 'number', min: 1, max: 12, value: first.data.cols || 3, title: 'Столбцов в сетке', style: { width: '54px' } });
      cols.onchange = () => patchSelected(() => ({ data: { cols: Math.max(1, Math.min(12, +cols.value || 3)) } }));
      cols.onkeydown = (e) => e.stopPropagation();
      parts.push(h('span', { class: 'cx-lbl' }, 'столбцов'), cols);
    }
    parts.push(h('button', {
      class: 'cx-btn' + (first.data.kanban ? ' on' : ''),
      title: 'Колонка канбана: карточка, брошенная во фрейм, получит значение, совпадающее с названием фрейма, в своём выпадающем списке (например «В работе»)',
      onClick: () => patchSelected(() => ({ data: { kanban: !first.data.kanban } })),
    }, '▥ Колонка канбана'));
    if (items.length === 1) parts.push(h('button', {
      class: 'cx-btn', title: 'Сделать область отдельным фреймом в иерархии: она и всё, что в ней лежит, переедут на новую страницу',
      onClick: () => areaToPage(first.id),
    }, '📄 В отдельный фрейм'));
  }
  if (one === 'card') parts.push(swatches(ACCENT_COLORS, first.data.color, (c) => patchSelected(() => ({ data: { color: c } }))));
  if (one === 'text') {
    parts.push(h('div', { class: 'cx-group' }, [[14, 'S'], [24, 'M'], [40, 'L'], [72, 'XL']].map(([sz, l]) =>
      h('button', { class: 'cx-btn' + (first.data.size === sz ? ' on' : ''), onClick: () => patchSelected((it) => ({ data: { size: sz }, h: Math.max(it.h, sz * 1.6) })) }, l))));
    parts.push(h('button', { class: 'cx-btn' + (first.data.bold ? ' on' : ''), onClick: () => patchSelected(() => ({ data: { bold: !first.data.bold } })) }, 'B'));
    parts.push(swatches(['#e6e8ef', ...ACCENT_COLORS.slice(0, 6)], first.data.color, (c) => patchSelected(() => ({ data: { color: c } }))));
  }
  if (one === 'draw') parts.push(swatches(['#e6e8ef', ...ACCENT_COLORS.slice(0, 6)], first.data.color, (c) => patchSelected(() => ({ data: { color: c } }))));
  if (items.length === 1 && one === 'dialogue') parts.push(h('button', { class: 'cx-btn accent', onClick: () => playDialogue(first.id) }, '▶ Играть диалог'));
  if (items.length > 1) {
    parts.push(h('div', { class: 'cx-group' },
      h('button', { class: 'cx-btn', title: 'Выровнять по левому краю', onClick: () => align('left') }, '⫷'),
      h('button', { class: 'cx-btn', title: 'Выровнять по верху', onClick: () => align('top') }, '⫠'),
      h('button', { class: 'cx-btn', title: 'Распределить по горизонтали', onClick: () => align('hdist') }, '⇹'),
      h('button', { class: 'cx-btn', title: 'Сетка', onClick: () => align('grid') }, '▦')));
  }
  if (parts.length) parts.push(h('span', { class: 'cx-sep' }));
  // перенос выделенного на другой фрейм иерархии
  const pages = framesInOrder(store.tree).filter((n) => n.id !== store.page);
  if (pages.length) {
    const mv = h('select', { class: 'cx-select', title: 'Перенести выделенное в другой фрейм' },
      h('option', { value: '' }, '📄 →'),
      pages.map((n) => h('option', { value: n.id }, pathOf(store.tree, n.id).join(' / '))));
    mv.onchange = () => { if (mv.value) moveToPage([...sel], mv.value); };
    mv.onkeydown = (e) => e.stopPropagation();
    parts.push(mv);
  }
  parts.push(
    h('button', { class: 'cx-btn', title: 'Дублировать (Ctrl+D)', onClick: duplicate }, '⧉'),
    one !== 'frame' ? h('button', { class: 'cx-btn', title: 'На передний план', onClick: () => patchSelected(() => ({ z: store.maxZ() + 1 })) }, '⬆') : null,
    one !== 'frame' ? h('button', { class: 'cx-btn', title: 'На задний план', onClick: () => patchSelected(() => ({ z: Math.max(1, store.minZ()) - 1 })) }, '⬇') : null,
    h('button', { class: 'cx-btn' + (first.locked ? ' on' : ''), title: 'Закрепить', onClick: () => patchSelected(() => ({ locked: !first.locked })) }, first.locked ? '🔒' : '🔓'),
    h('button', { class: 'cx-btn danger', title: 'Удалить (Del)', onClick: deleteSelection }, '🗑'));
  ctxbar.append(...parts.filter(Boolean));
  ctxbar.style.display = '';
  ctxbar._focus = null;
}
function positionCtxbar() {
  if (!ctxbar || ctxbar.style.display === 'none') return;
  let b;
  if (selLink) {
    const l = store.links[selLink];
    const a = l && store.item(l.from), c = l && store.item(l.to);
    if (!a || !c) return;
    const p = { x: (a.x + a.w / 2 + c.x + c.w / 2) / 2, y: (a.y + a.h / 2 + c.y + c.h / 2) / 2 };
    b = { x: p.x, y: p.y - 10, w: 0, h: 20 };
  } else b = bboxOf(selectedItems());
  if (!b) return;
  const sx = b.x * view.z + view.x + (b.w * view.z) / 2;
  let sy = b.y * view.z + view.y - 14;
  const bw = ctxbar.offsetWidth, bh = ctxbar.offsetHeight;
  if (sy - bh < 8) sy = (b.y + b.h) * view.z + view.y + 14 + bh;
  ctxbar.style.left = clamp(sx - bw / 2, 8, vp.clientWidth - bw - 8) + 'px';
  ctxbar.style.top = clamp(sy - bh, 8, vp.clientHeight - bh - 8) + 'px';
}

function align(mode) {
  const items = selectedItems().sort((a, b) => a.x - b.x);
  store.checkpoint();
  const b = bboxOf(items);
  if (mode === 'left') items.forEach((it) => store.patch(it.id, { x: b.x }));
  if (mode === 'top') items.forEach((it) => store.patch(it.id, { y: b.y }));
  if (mode === 'hdist') {
    const total = items.reduce((a, it) => a + it.w, 0);
    const gap = items.length > 1 ? (b.w - total) / (items.length - 1) : 0;
    let x = b.x;
    items.forEach((it) => { store.patch(it.id, { x: Math.round(x) }); x += it.w + Math.max(gap, 20); });
  }
  if (mode === 'grid') {
    const cols = Math.ceil(Math.sqrt(items.length));
    const cw = Math.max(...items.map((i) => i.w)) + 24, rh = Math.max(...items.map((i) => i.h)) + 24;
    items.forEach((it, i) => store.patch(it.id, { x: b.x + (i % cols) * cw, y: b.y + Math.floor(i / cols) * rh }));
  }
  updateSelUI();
}

// ---------- операции ----------
export function createItem(type, pt, data = {}, size = {}) {
  const W = WIDGETS[type];
  if (!W) return null;
  const w = size.w || W.w, hh = size.h || W.h;
  const it = {
    id: uid('i'), type, x: Math.round(pt.x - w / 2), y: Math.round(pt.y - hh / 2), w, h: hh,
    z: type === 'frame' ? Math.min(0, store.minZ()) - 1 : store.maxZ() + 1,
    data: { ...W.data(), ...data },
  };
  store.checkpoint();
  store.upsert(it);
  selectOnly(it.id);
  return it;
}
// Создать инструмент из библиотеки: карточку с компонентами (или отдельный элемент, напр. реплику)
export function createTool(toolId, pt) {
  const t = toolById(toolId);
  if (!t) return null;
  if (t.standalone) return createItem(t.standalone, pt);
  store.checkpoint();
  const w = t.w || 300;
  const card = makeCard(toolId, pt, liveEnv({ x: pt.x - w / 2, y: pt.y - 60, w, h: 200 }), { z: store.maxZ() + 1 });
  store.upsert(card);
  selectOnly(card.id);
  return card;
}
export function findFreeSpot(pt, w, hh) {
  const others = pageItems().filter((i) => i.type !== 'frame');
  const hit = (x, y) => others.some((o) => x - w / 2 < o.x + o.w + 16 && x + w / 2 > o.x - 16 && y - hh / 2 < o.y + o.h + 16 && y + hh / 2 > o.y - 16);
  for (let row = 0; row < 6; row++) for (let col = 0; col < 10; col++) {
    const x = pt.x + col * (w + 30), y = pt.y + row * (hh + 30);
    if (!hit(x, y)) return { x, y };
  }
  return pt;
}
export function startEditing(id) {
  requestAnimationFrame(() => nodes.get(id)?.el.querySelector('.editable')?._edit?.());
}
export function deleteSelection() {
  if (!sel.size && !selLink) return;
  store.checkpoint();
  if (selLink) { const l = store.links[selLink]; store.removeLink(selLink); if (l) rerenderDialogue(l.from); selLink = null; }
  for (const id of [...sel]) if (!store.item(id)?.locked) store.remove(id);
  sel.clear();
  refreshSelection();
}
export function serializeSelection() {
  const items = selectedItems();
  const ids = new Set(items.map((i) => i.id));
  const links = Object.values(store.links).filter((l) => ids.has(l.from) && ids.has(l.to));
  const assets = {};
  for (const it of items) if (it.data.asset && store.board.assets[it.data.asset]) assets[it.data.asset] = store.board.assets[it.data.asset];
  return { items, links, assets };
}
export function pasteClip(clip, at = null, { offset = 30, checkpoint = true } = {}) {
  if (!clip?.items?.length) return [];
  if (checkpoint) store.checkpoint();
  const idMap = new Map();
  const assetMap = new Map();
  for (const [k, v] of Object.entries(clip.assets || {})) assetMap.set(k, store.addAsset(v));
  const b = bboxOf(clip.items);
  const dx = at ? Math.round(at.x - (b.x + b.w / 2)) : offset;
  const dy = at ? Math.round(at.y - (b.y + b.h / 2)) : offset;
  let z = store.maxZ();
  let fz = Math.min(0, store.minZ());
  const sorted = [...clip.items].sort((a, b2) => (a.z || 0) - (b2.z || 0));
  const created = [];
  for (const src of sorted) {
    const it = structuredClone(src);
    it.id = uid('i');
    idMap.set(src.id, it.id);
    it.x += dx; it.y += dy;
    it.z = it.type === 'frame' ? --fz : ++z;
    if (store.page === 'p_main') delete it.page; else it.page = store.page; // вставляем в открытый фрейм
    if (it.data.asset && assetMap.has(it.data.asset)) it.data.asset = assetMap.get(it.data.asset);
    store.upsert(it);
    created.push(it.id);
  }
  for (const l of clip.links || []) {
    if (!idMap.has(l.from) || !idMap.has(l.to)) continue;
    store.upsertLink({ ...l, id: uid('l'), from: idMap.get(l.from), to: idMap.get(l.to) });
  }
  for (const id of created) rerenderDialogue(id);
  setSelection(created);
  return created;
}
export function duplicate() {
  if (!sel.size) return;
  pasteClip(serializeSelection());
}
export function addLink(from, to, extra = {}) {
  if (from === to) return null;
  if (Object.values(store.links).some((l) => l.from === from && l.to === to)) return null;
  const l = { id: uid('l'), from, to, label: '', ...extra };
  store.upsertLink(l);
  return l;
}
// Видео (YouTube, RuTube, VK) на доске как в Miro: обложка → плеер прямо на доске
export function addVideo(url, pt) {
  const yt = parseYouTube(url);
  if (!yt) return null;
  const it = createItem('video', pt, { src: yt.src, id: yt.id, hash: yt.hash || '', start: yt.start, url: yt.url, title: '' });
  youTubeTitle(yt.url).then((title) => { if (title && store.item(it.id)) store.patch(it.id, { data: { title } }); });
  return it;
}
export async function addImageFile(file, pt) {
  const src = await imageFileToDataURL(file);
  const img = await loadImage(src);
  const asset = store.addAsset(src);
  const k = Math.min(1, 420 / Math.max(img.width, img.height));
  const w = Math.max(40, Math.round(img.width * k)), hh = Math.max(40, Math.round(img.height * k));
  const it = createItem('image', pt, { asset, name: file.name || '' }, { w, h: hh });
  if (img.width <= 256 && img.height <= 256 && it) {
    store.patch(it.id, { w: w * 2, h: hh * 2, x: it.x - w / 2, y: it.y - hh / 2 });
  }
  return it;
}

// ---------- жесты ----------
function startPan(e) {
  gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  vp.classList.add('panning');
}
function startDrag(e, id) {
  if (e.shiftKey) {
    if (sel.has(id)) { sel.delete(id); refreshSelection(); return; }
    sel.add(id); selLink = null; refreshSelection();
  } else if (!sel.has(id)) selectOnly(id);
  else if (selLink) { selLink = null; refreshSelection(); }
  const moving = new Set([...sel].filter((i) => !store.item(i)?.locked));
  for (const id2 of [...moving]) {
    const f = store.item(id2);
    if (f?.type !== 'frame') continue;
    for (const it of pageItems()) {
      if (moving.has(it.id) || it.type === 'frame' || it.locked) continue;
      const c = center(it);
      if (c.x > f.x && c.x < f.x + f.w && c.y > f.y && c.y < f.y + f.h) moving.add(it.id);
    }
  }
  const orig = new Map([...moving].map((i) => { const it = store.item(i); return [i, { x: it.x, y: it.y }]; }));
  gesture = { type: 'drag', sx: e.clientX, sy: e.clientY, orig, moved: false, clickId: id, shift: e.shiftKey };
}
function startResize(e) {
  const it = selectedItems()[0];
  if (!it || it.locked) return;
  gesture = { type: 'resize', id: it.id, sx: e.clientX, sy: e.clientY, w: it.w, h: it.h, moved: false, ratio: it.w / it.h };
}
function startLinkDrag(e, from) {
  const a = store.item(from);
  if (!a) return;
  gesture = { type: 'link', from, sx: e.clientX, sy: e.clientY, line: s('line', { class: 'temp-link' }) };
  tempG.append(gesture.line);
  const c = center(a);
  gesture.line.setAttribute('x1', c.x); gesture.line.setAttribute('y1', c.y);
  gesture.line.setAttribute('x2', c.x); gesture.line.setAttribute('y2', c.y);
}
function startMarquee(e) {
  gesture = { type: 'marquee', sx: e.clientX, sy: e.clientY, base: e.shiftKey ? new Set(sel) : new Set(), moved: false };
  if (!e.shiftKey) selectOnly(null);
}
function startPen(e) {
  const p = screenToWorld(e.clientX, e.clientY);
  gesture = { type: 'pen', pts: [[p.x, p.y]], path: s('path', { class: 'temp-ink', stroke: pen.color, 'stroke-width': pen.width }) };
  tempG.append(gesture.path);
}
function startErase(e) {
  store.checkpoint();
  gesture = { type: 'erase' };
  eraseAt(e);
}
function eraseAt(e) {
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    const it = el.closest?.('.item.t-draw');
    if (it) { store.remove(it.dataset.id); break; }
  }
}

function onDown(e) {
  if (e.target.closest('#ctxbar')) return;
  if (gesture?.type === 'pinch') return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    gesture?.path?.remove(); gesture?.line?.remove();
    const [p1, p2] = [...pointers.values()];
    gesture = { type: 'pinch', d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), m0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, v0: { ...view } };
    return;
  }
  const itemEl = e.target.closest('.item');
  // кнопки и холсты внутри карточек работают всегда; поля ввода — только у уже выделенного элемента
  const always = e.target.closest('button, a, .no-drag, input[type="checkbox"], input[type="color"], .chart');
  const field = e.target.closest('input, textarea, select, label, [contenteditable="true"], [contenteditable="plaintext-only"]');
  // текст со ссылками в карточке: у выделенной карточки клик сразу начинает правку в месте клика
  const rich = !field && !always && e.target.closest('.rt-field');
  if (itemEl && rich && e.button === 0 && sel.has(itemEl.dataset.id) && sel.size === 1 && tool === 'select') {
    e.preventDefault();
    rich._edit(e.clientX, e.clientY);
    return;
  }
  if (itemEl && (always || (field && sel.has(itemEl.dataset.id) && sel.size === 1 && tool === 'select'))) {
    if (!sel.has(itemEl.dataset.id)) selectOnly(itemEl.dataset.id);
    return;
  }
  if (itemEl && field) e.preventDefault();
  if (isTyping() && !e.target.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')) document.activeElement.blur();
  if (e.button === 1 || e.button === 2 || tool === 'hand' || spaceDown) { e.preventDefault(); startPan(e); return capture(e); }
  if (e.button !== 0) return;
  const handle = e.target.closest('[data-handle]');
  if (handle) {
    if (handle.dataset.handle === 'resize') startResize(e);
    else if (handle.dataset.handle === 'link' && sel.size === 1) startLinkDrag(e, [...sel][0]);
    return capture(e);
  }
  const linkEl = e.target.closest('[data-link]');
  switch (tool) {
    case 'select':
      if (itemEl) { startDrag(e, itemEl.dataset.id); if (gesture?.type === 'drag') gesture.focusEl = rich || (field && field.matches('input, textarea') ? field : null); }
      else if (linkEl) { selectLink(linkEl.dataset.link); return; }
      else if (e.pointerType === 'touch') startPan(e);
      else startMarquee(e);
      break;
    case 'connector':
      if (itemEl) startLinkDrag(e, itemEl.dataset.id); else startPan(e);
      break;
    case 'pen': startPen(e); break;
    case 'eraser': startErase(e); break;
    default: {
      const t = tool;
      const it = createItem(t, screenToWorld(e.clientX, e.clientY));
      setTool('select');
      if (it && ['sticky', 'text', 'shape', 'frame'].includes(t)) startEditing(it.id);
      return;
    }
  }
  capture(e);
}
function capture(e) { try { vp.setPointerCapture(e.pointerId); } catch {} }

function onMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) { hoverLink(e); return; }
  const g = gesture;
  const dx = (e.clientX - (g.sx ?? 0)) / view.z, dy = (e.clientY - (g.sy ?? 0)) / view.z;
  switch (g.type) {
    case 'pan':
      view.x = g.vx + (e.clientX - g.sx); view.y = g.vy + (e.clientY - g.sy);
      applyView();
      break;
    case 'pinch': {
      const ps = [...pointers.values()];
      if (ps.length < 2) return;
      const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      const m = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
      const r = vp.getBoundingClientRect();
      const nz = clamp(g.v0.z * (d / g.d0), 0.08, 4);
      const wx = (g.m0.x - r.left - g.v0.x) / g.v0.z, wy = (g.m0.y - r.top - g.v0.y) / g.v0.z;
      view.z = nz; view.x = m.x - r.left - wx * nz; view.y = m.y - r.top - wy * nz;
      applyView();
      break;
    }
    case 'drag': {
      if (!g.moved) {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return;
        g.moved = true;
        store.checkpoint();
        vp.classList.add('dragging');
      }
      for (const [id, o] of g.orig) store.patch(id, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }, { norender: true });
      highlightDropFrame();
      break;
    }
    case 'resize': {
      if (!g.moved) { g.moved = true; store.checkpoint(); }
      const it = store.item(g.id);
      const W = WIDGETS[it.type];
      const [mw, mh] = W?.min || [20, 20];
      let w = Math.max(mw, Math.round(g.w + dx)), hh = Math.max(mh, Math.round(g.h + dy));
      if (((it.type === 'image' || it.type === 'draw') && !e.shiftKey) || ((it.type !== 'image' && it.type !== 'draw') && e.shiftKey)) hh = Math.max(mh, Math.round(w / g.ratio));
      if (it.type === 'card') hh = it.h; // высота карточки — по содержимому
      store.patch(g.id, { w, h: hh });
      break;
    }
    case 'link': {
      const p = screenToWorld(e.clientX, e.clientY);
      g.line.setAttribute('x2', p.x); g.line.setAttribute('y2', p.y);
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.item');
      document.querySelectorAll('.item.link-target').forEach((n) => n.classList.remove('link-target'));
      if (t && t.dataset.id !== g.from) t.classList.add('link-target');
      break;
    }
    case 'marquee': {
      const r = vp.getBoundingClientRect();
      const x0 = Math.min(g.sx, e.clientX) - r.left, y0 = Math.min(g.sy, e.clientY) - r.top;
      const w = Math.abs(e.clientX - g.sx), hh = Math.abs(e.clientY - g.sy);
      if (w + hh < 4) return;
      g.moved = true;
      Object.assign(marquee.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: hh + 'px' });
      const a = screenToWorld(Math.min(g.sx, e.clientX), Math.min(g.sy, e.clientY));
      const bw = w / view.z, bh = hh / view.z;
      const hit = new Set(g.base);
      for (const it of pageItems()) {
        const inside = it.x >= a.x && it.y >= a.y && it.x + it.w <= a.x + bw && it.y + it.h <= a.y + bh;
        const inter = it.x < a.x + bw && it.x + it.w > a.x && it.y < a.y + bh && it.y + it.h > a.y;
        if (it.type === 'frame' ? inside : inter) hit.add(it.id);
      }
      sel.clear(); hit.forEach((i) => sel.add(i));
      for (const [id, rec] of nodes) rec.el.classList.toggle('selected', sel.has(id));
      updateSelUI(false);
      break;
    }
    case 'pen': {
      const p = screenToWorld(e.clientX, e.clientY);
      const last = g.pts[g.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5 / view.z) return;
      g.pts.push([p.x, p.y]);
      g.path.setAttribute('d', g.pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(''));
      break;
    }
    case 'erase': eraseAt(e); break;
  }
}

function frameAt(pt, exclude) {
  let best = null;
  for (const f of pageItems()) {
    if (f.type !== 'frame' || exclude?.has(f.id)) continue;
    if (pt.x > f.x && pt.x < f.x + f.w && pt.y > f.y && pt.y < f.y + f.h) if (!best || (f.z || 0) > (best.z || 0)) best = f;
  }
  return best;
}
// Канбан: найти выпадающий список карточки, в котором есть вариант с названием фрейма
function kanbanMatch(card, frame) {
  if (card?.type !== 'card' || !frame?.data.kanban) return null;
  const want = (frame.data.title || '').trim().toLowerCase();
  if (!want) return null;
  for (const c of card.data.components || []) {
    if (c.type !== 'dropdown') continue;
    const o = resolveList(c.data.list)?.items.find((x) => (x.text || '').trim().toLowerCase() === want);
    if (o) return { compId: c.id, opt: o, label: c.data.label };
  }
  return null;
}
function highlightDropFrame() {
  document.querySelectorAll('.item.drop-target').forEach((n) => n.classList.remove('drop-target'));
  const g = gesture;
  const cards = [...g.orig.keys()].map((i) => store.item(i)).filter((i) => i?.type === 'card');
  if (!cards.length) return;
  const f = frameAt(center(cards[0]), new Set(g.orig.keys()));
  if (f && kanbanMatch(cards[0], f)) nodes.get(f.id)?.el.classList.add('drop-target');
}

function onUp(e) {
  pointers.delete(e.pointerId);
  const g = gesture;
  if (!g) return;
  if (g.type === 'pinch') { if (pointers.size === 0) gesture = null; return; }
  gesture = null;
  vp.classList.remove('panning', 'dragging');
  switch (g.type) {
    case 'drag':
      document.querySelectorAll('.item.drop-target').forEach((n) => n.classList.remove('drop-target'));
      if (!g.moved) {
        if (!g.shift && sel.size > 1) selectOnly(g.clickId);
        if (g.focusEl?.isConnected && sel.size === 1 && g.focusEl._edit) { g.focusEl._edit(e.clientX, e.clientY); return; }
        if (g.focusEl?.isConnected && sel.size === 1) { g.focusEl.focus(); if (g.focusEl.select && g.focusEl.type !== 'number' && g.focusEl.tagName === 'INPUT') g.focusEl.select(); }
        return;
      }
      for (const id of g.orig.keys()) {
        const it = store.item(id);
        if (it?.type !== 'card') continue;
        const f = frameAt(center(it), new Set(g.orig.keys()));
        const m = kanbanMatch(it, f);
        const cur = m && it.data.components.find((c) => c.id === m.compId);
        if (m && cur.data.value !== m.opt.id) {
          store.patch(id, { data: { components: it.data.components.map((c) => (c.id === m.compId ? { ...c, data: { ...c.data, value: m.opt.id } } : c)) } });
          toast(`«${it.data.title}»: ${m.label || 'поле'} → ${m.opt.text}`, 'ok', 1800);
        }
      }
      updateSelUI();
      scheduleArrange();
      break;
    case 'resize': updateSelUI(); scheduleArrange(); break;
    case 'link': {
      g.line.remove();
      document.querySelectorAll('.item.link-target').forEach((n) => n.classList.remove('link-target'));
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.item');
      const from = store.item(g.from);
      if (!from) return;
      store.checkpoint();
      let toId = null;
      if (t && t.dataset.id !== g.from) toId = t.dataset.id;
      else if (!t && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 40) {
        const p = screenToWorld(e.clientX, e.clientY);
        if (from.type === 'card') {
          // новая карточка того же инструмента (для пустой — пустая), цвет как у исходной
          const card = makeCard(from.data.tool || 'empty', p, liveEnv(from), { color: from.data.color, z: store.maxZ() + 1 });
          card.y = Math.round(p.y - 30);
          store.upsert(card);
          toId = card.id;
        }
        const type = ['dialogue', 'shape', 'sticky'].includes(from.type) ? from.type : 'sticky';
        const W = WIDGETS[type];
        const data = type === 'shape' ? { color: from.data.color, shape: from.data.shape } : type === 'sticky' && from.type === 'sticky' ? { color: from.data.color } : type === 'dialogue' ? { speaker: from.data.speaker === 'Игрок' ? 'NPC' : 'Игрок', text: '' } : {};
        const it = toId ? null : { id: uid('i'), type, x: Math.round(p.x - (from.w || W.w) / 2), y: Math.round(p.y - (from.h || W.h) / 2), w: from.type === type ? from.w : W.w, h: from.type === type ? from.h : W.h, z: store.maxZ() + 1, data: { ...W.data(), ...data } };
        if (it) { store.upsert(it); toId = it.id; }
      }
      if (!toId) return;
      const l = addLink(g.from, toId, { color: from.type === 'dialogue' ? '#22d3a6' : undefined });
      if (!l) return;
      rerenderDialogue(g.from);
      if (from.type === 'dialogue') {
        selectLink(l.id);
        setTimeout(() => ctxbar._focus?.(), 30);
      } else selectOnly(toId);
      break;
    }
    case 'marquee':
      marquee.style.display = 'none';
      updateSelUI(true);
      break;
    case 'pen': {
      g.path.remove();
      if (g.pts.length < 2) return;
      const pad = pen.width + 2;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of g.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const w = Math.max(4, x1 - x0), hh = Math.max(4, y1 - y0);
      store.checkpoint();
      store.upsert({
        id: uid('i'), type: 'draw', x: Math.round(x0), y: Math.round(y0), w: Math.round(w), h: Math.round(hh), z: store.maxZ() + 1,
        data: { points: g.pts.map(([x, y]) => [+(x - Math.round(x0)).toFixed(1), +(y - Math.round(y0)).toFixed(1)]), color: pen.color, width: pen.width, ow: Math.round(w), oh: Math.round(hh) },
      });
      break;
    }
  }
}
function hoverLink() {}

// ---------- клавиатура ----------
const TOOL_KEYS = { v: 'select', h: 'hand', n: 'sticky', t: 'text', r: 'shape', f: 'frame', c: 'connector', p: 'pen', e: 'eraser' };
const CODE_KEYS = { KeyV: 'v', KeyH: 'h', KeyN: 'n', KeyT: 't', KeyR: 'r', KeyF: 'f', KeyC: 'c', KeyP: 'p', KeyE: 'e', KeyZ: 'z', KeyY: 'y', KeyD: 'd', KeyA: 'a' };
function onKey(e) {
  if (!store.board || document.getElementById('editor').classList.contains('hidden')) return;
  if (document.querySelector('.modal-wrap')) return;
  if (isTyping()) return;
  const k = CODE_KEYS[e.code] || e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (e.code === 'Space') { if (!spaceDown) { spaceDown = true; vp.classList.add('space'); } e.preventDefault(); return; }
  if (mod && k === 'z') { e.preventDefault(); (e.shiftKey ? store.redo() : store.undo()) || toast(e.shiftKey ? 'Нечего повторять' : 'Нечего отменять', 'info', 1200); pruneSelection(); return; }
  if (mod && k === 'y') { e.preventDefault(); store.redo(); pruneSelection(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
  if (mod && k === 'a') { e.preventDefault(); setSelection(Object.keys(store.items)); return; }
  if (mod && (e.key === '0')) { e.preventDefault(); setZoom(1); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.2); return; }
  if (mod && e.key === '-') { e.preventDefault(); zoomBy(1 / 1.2); return; }
  if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) { e.preventDefault(); fitAll(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key === 'Escape') { selectOnly(null); setTool('select'); return; }
  if (e.key === 'Enter' && sel.size === 1) { e.preventDefault(); startEditing([...sel][0]); return; }
  if (e.key.startsWith('Arrow') && sel.size && !e.altKey) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const [ddx, ddy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (!e.repeat) store.checkpoint();
    for (const it of selectedItems()) store.patch(it.id, { x: it.x + ddx, y: it.y + ddy }, { norender: true });
    return;
  }
  if (!mod && !e.altKey && TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); }
}
function pruneSelection() {
  for (const id of [...sel]) if (!store.item(id)) sel.delete(id);
  if (selLink && !store.links[selLink]) selLink = null;
  refreshSelection();
}

// ---------- инициализация ----------
export function initCanvas() {
  vp = document.getElementById('viewport');
  world = document.getElementById('world');
  itemsEl = document.getElementById('items');
  selbox = document.getElementById('selbox');
  marquee = document.getElementById('marquee');
  ctxbar = document.getElementById('ctxbar');
  cursorsEl = document.getElementById('cursors');
  const svg = document.getElementById('links');
  defs = s('defs');
  linksG = s('g', { transform: 'translate(50000 50000)' });
  svg.append(defs, linksG);
  const tsvg = document.getElementById('temp');
  tempG = s('g', { transform: 'translate(50000 50000)' });
  tsvg.append(tempG);
  selbox.append(
    h('div', { class: 'handle resize', 'data-handle': 'resize', title: 'Изменить размер' }),
    h('div', { class: 'handle link', 'data-handle': 'link', title: 'Протяните к другому элементу, чтобы связать' }, '⟶'));
  vp.dataset.tool = 'select';
  setLinkHandler(goTo);
  setToolIcon((it) => toolById(it.data.tool)?.icon);

  vp.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  vp.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });
  vp.addEventListener('wheel', (e) => {
    if (e.target.closest('#ctxbar')) return;
    const sc = e.target.closest('textarea, .scroll');
    if (sc && !e.ctrlKey && sc.scrollHeight > sc.clientHeight) return;
    e.preventDefault();
    const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    else if (mouseWheel && !e.shiftKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
    else { view.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; view.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY; applyView(); }
  }, { passive: false });
  vp.addEventListener('dblclick', (e) => {
    if (e.target.closest('#ctxbar')) return;
    // из-за захвата указателя событие может прийти на сам холст — берём элемент под курсором
    const tgt = e.target === vp ? document.elementFromPoint(e.clientX, e.clientY) || vp : e.target;
    const itemEl = tgt.closest('.item');
    if (itemEl) {
      const ed = tgt.closest('.editable') || itemEl.querySelector('.editable');
      if (ed?.classList.contains('rt')) ed._edit?.(e.clientX, e.clientY);
      else ed?._edit?.();
      return;
    }
    const linkEl = tgt.closest('[data-link]');
    if (linkEl) { selectLink(linkEl.dataset.link); setTimeout(() => ctxbar._focus?.(), 20); return; }
    // двойной клик по пустому месту ничего не создаёт (стикер — клавиша N или панель слева)
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; vp.classList.remove('space'); } });
  window.addEventListener('blur', () => { spaceDown = false; vp.classList.remove('space'); });

  // буфер обмена
  document.addEventListener('copy', (e) => {
    if (isTyping() || !sel.size || !store.board) return;
    e.clipboardData.setData('text/plain', 'gdboard:' + JSON.stringify(serializeSelection()));
    e.preventDefault();
    toast(`Скопировано: ${sel.size}`, 'info', 1000);
  });
  document.addEventListener('cut', (e) => {
    if (isTyping() || !sel.size || !store.board) return;
    e.clipboardData.setData('text/plain', 'gdboard:' + JSON.stringify(serializeSelection()));
    e.preventDefault();
    deleteSelection();
  });
  document.addEventListener('paste', async (e) => {
    if (isTyping() || !store.board || document.getElementById('editor').classList.contains('hidden')) return;
    const dt = e.clipboardData;
    const files = [...(dt?.files || [])].filter((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (files.length) { for (const f of files) await addImageFile(f, centerWorld()); return; }
    const text = dt?.getData('text/plain') || '';
    if (text.startsWith('gdboard:')) { try { pasteClip(JSON.parse(text.slice(8))); } catch { toast('Не удалось вставить', 'err'); } return; }
    if (parseYouTube(text)) { addVideo(text.trim(), findFreeSpot(centerWorld(), WIDGETS.video.w, WIDGETS.video.h)); return; }
    if (text.trim()) {
      const it = createItem('sticky', centerWorld(), { text: text.slice(0, 2000) });
      if (it && text.length > 200) store.patch(it.id, { w: 320, h: 320 });
    }
  });

  // drag & drop
  vp.addEventListener('dragover', (e) => { e.preventDefault(); vp.classList.add('drop-hover'); });
  vp.addEventListener('dragleave', () => vp.classList.remove('drop-hover'));
  vp.addEventListener('drop', async (e) => {
    e.preventDefault();
    vp.classList.remove('drop-hover');
    const pt = screenToWorld(e.clientX, e.clientY);
    const lib = e.dataTransfer.getData('application/x-gdb');
    if (lib) { const { type, data, template, tool } = JSON.parse(lib); vp.dispatchEvent(new CustomEvent('gdb-library-drop', { detail: { type, data, template, tool, pt } })); return; }
    const dropped = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (!e.dataTransfer.files.length && parseYouTube(dropped)) { addVideo(dropped.trim(), pt); return; }
    const cardEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.item.t-card');
    for (const f of e.dataTransfer.files) {
      if (f.type.startsWith('image/')) {
        if (cardEl) await dropImageOnCard(cardEl.dataset.id, f);
        else await addImageFile(f, pt);
      } else if (f.name.endsWith('.json')) {
        vp.dispatchEvent(new CustomEvent('gdb-import-file', { detail: f }));
      }
    }
  });

  // события хранилища
  const mountPage = (keepView) => {
    const b = store.board;
    nodes.forEach((r) => { sizeObs?.unobserve(r.el); r.el.remove(); }); nodes.clear();
    linkEls.forEach((g) => g.remove()); linkEls.clear();
    sel.clear(); selLink = null;
    pageItems().forEach((it) => mountItem(it));
    Object.values(b.links).forEach(renderLink);
    clearRemoteCursors();
    if (!keepView) Object.assign(view, b.views?.[store.page] || (store.page === 'p_main' && b.view) || { x: vp.clientWidth / 2, y: vp.clientHeight / 2, z: 1 });
    applyView();
    updateSelUI(true);
  };
  let loadedId = null;
  store.on('load', (b) => { mountPage(loadedId === b.id); loadedId = b.id; });
  store.on('page', () => mountPage(false));
  // переименовали/переместили фрейм — обновить кнопки, которые на него ссылаются
  const treeChanged = () => { treeVer++; for (const it of pageItems()) if (TEXTY.has(it.type)) mountItem(it); };
  store.on('tree', (n) => treeChanged(n.id));
  store.on('treerm', (id) => treeChanged(id));
  store.on('item', (it, opts) => {
    if (!opts.remote && !opts.norender && !opts.arranging && !opts.restore && onPage(it)) scheduleArrange();
    if (opts.norender) {
      const rec = nodes.get(it.id);
      if (rec) place(rec.el, it); else mountItem(it);
    } else {
      mountItem(it);
      if (it.type === 'card' || it.type === 'frame') remountDependents(it.id);
      if (it.type === 'card') remountWatchers((it.data.components || []).map((c) => c.type));
      // списки, на которые ссылается карточка, обновляют счётчик «используется»
      for (const d of WIDGETS[it.type]?.deps?.(it) || []) { const x = store.item(d); if (x?.type === 'card') mountItem(x, !nodes.get(d)?.el.contains(document.activeElement)); }
    }
    updateLinksFor(it.id);
    if (sel.has(it.id)) { updateSelUI(!opts.norender && !opts.remote); }
    else if (!onPage(it)) updateSelUI(true);
  });
  store.on('remove', (id, opts) => {
    if (!opts?.remote) scheduleArrange();
    sizeObs?.unobserve(nodes.get(id)?.el || document.body);
    unmountItem(id);
    remountDependents(id);
    remountWatchers(null);
    if (sel.delete(id)) updateSelUI(true);
  });
  store.on('link', (l) => { renderLink(l); rerenderDialogue(l.from); rerenderDialogue(l.to); if (selLink === l.id) positionCtxbar(); });
  store.on('unlink', (l) => {
    linkEls.get(l.id)?.remove(); linkEls.delete(l.id);
    rerenderDialogue(l.from); rerenderDialogue(l.to);
    if (selLink === l.id) { selLink = null; updateSelUI(true); }
  });
  store.on('asset', (id) => {
    for (const it of Object.values(store.items)) if (it.data.asset === id) mountItem(it, true);
  });
  window.addEventListener('resize', () => positionCtxbar());
}

// ---------- курсоры участников ----------
const cursors = new Map();
export function setRemoteCursor(pid, c) {
  if (c.page && c.page !== store.page) { removeRemoteCursor(pid); return; } // участник на другом фрейме
  let el = cursors.get(pid);
  if (!el) {
    el = h('div', { class: 'rcursor' },
      s('svg', { width: 18, height: 18, viewBox: '0 0 18 18' }, s('path', { d: 'M1 1 L16 8 L9 10 L7 17 Z', fill: c.color, stroke: '#0b0d12', 'stroke-width': 1.2 })),
      h('span', { style: { background: c.color } }, c.name));
    cursorsEl.append(el);
    cursors.set(pid, el);
  }
  el.style.left = c.x + 'px';
  el.style.top = c.y + 'px';
  el.querySelector('span').textContent = c.name;
}
export function removeRemoteCursor(pid) { cursors.get(pid)?.remove(); cursors.delete(pid); }
export function clearRemoteCursors() { cursors.forEach((el) => el.remove()); cursors.clear(); }
