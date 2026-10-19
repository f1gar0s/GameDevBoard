// Карточка — контейнер компонентов (как GameObject в Unity).
// Компоненты рисуются сверху вниз, их можно переставлять, настраивать (⚙) и удалять.
import { h, s, uid, clamp, toast, download, modal, readFileAsDataURL, loadImage, imageFileToDataURL, parseYouTube, youTubeTitle } from './util.js';
import { store } from './store.js';
import { getComponent, allComponents, callWithBase } from './registry.js';
import * as lib from './lib.js';
import { focusItem } from './canvas.js';
import { liveEnv, TOOLS, makeCard } from './tools.js';
import { findFreeSpot } from './canvas.js';

export const openSettings = new Set(); // id компонентов с открытой шестерёнкой
let addMenuFor = null; // id карточки с открытым меню «+ Компонент»

// ---------- списки для выпадающих меню ----------
export function listsOnBoard() {
  const out = [];
  for (const it of Object.values(store.items)) {
    if (it.type !== 'card') continue;
    for (const c of it.data.components || []) {
      if (c.type !== 'list') continue;
      const name = (it.data.title || 'Список') + (c.data.label ? ' · ' + c.data.label : '');
      out.push({ ref: { card: it.id, comp: c.id }, title: name, items: c.data.items || [] });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}
export function resolveList(ref) {
  if (!ref) return null;
  const c = store.item(ref.card)?.data.components?.find((x) => x.id === ref.comp);
  return c && c.type === 'list' ? c.data : null;
}
export const optionOf = (ref, id) => resolveList(ref)?.items.find((o) => o.id === id) || null;

export function dropdownEl(ref, value, onChange, { placeholder = '— не выбрано —', compact = false } = {}) {
  const list = resolveList(ref);
  if (!list) return h('span', { class: 'dd-missing' }, ref ? '⚠ список удалён' : 'список не выбран');
  const opt = list.items.find((o) => o.id === value);
  const sel = h('select', { class: 'dd' + (compact ? ' compact' : '') },
    h('option', { value: '' }, placeholder),
    list.items.map((o) => h('option', { value: o.id, selected: o.id === value }, o.text || '—')));
  sel.addEventListener('change', () => onChange(sel.value || null));
  return h('span', { class: 'dd-wrap' + (compact ? ' compact' : ''), style: { '--oc': opt?.color || 'transparent' } },
    h('i', { class: 'dd-dot' }), sel);
}

// все компоненты данного типа на доске (например, все предметы для таблицы лута)
export function compsOnBoard(type) {
  const out = [];
  for (const it of Object.values(store.items)) {
    if (it.type !== 'card') continue;
    for (const c of it.data.components || []) if (c.type === type) out.push({ ref: { card: it.id, comp: c.id }, card: it, data: c.data });
  }
  return out;
}
export function resolveComp(ref) {
  return store.item(ref?.card)?.data.components?.find((x) => x.id === ref.comp) || null;
}

// значение поля карточки по подписи компонента (для обзора, канбана, экспорта)
export function cardField(card, label) {
  const want = label.toLowerCase();
  for (const c of card?.data?.components || []) {
    if ((c.data.label || '').toLowerCase() !== want) continue;
    if (c.type === 'dropdown') { const o = optionOf(c.data.list, c.data.value); return o ? { text: o.text, color: o.color } : null; }
    if (c.type === 'number') return { value: +c.data.value || 0, text: String(c.data.value ?? '') };
    return { text: c.data.text ?? '' };
  }
  return null;
}

// ---------- поле ввода, связанное с данными компонента ----------
function fieldEl(ctx, key, { tag = 'input', cls = '', placeholder = '', type = 'text', num = false, rows, onLive, autosize = false, commit = false } = {}) {
  const v = ctx.data[key];
  const el = h(tag, { class: 'f ' + cls, placeholder, type: tag === 'input' ? type : null, rows, value: v ?? '' });
  const grow = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
  el.addEventListener('focus', () => ctx.begin());
  el.addEventListener('input', () => {
    const val = num ? (el.value === '' ? 0 : +el.value) : el.value;
    ctx.live({ [key]: val });
    onLive?.(val);
    if (autosize) grow();
  });
  if (autosize && tag === 'textarea') requestAnimationFrame(grow);
  // commit: после ввода перерисовать карточку (например, подпись в настройках)
  if (commit) el.addEventListener('change', () => setTimeout(() => ctx.set({}), 0));
  return el;
}

function makeCtx(cardIt, comp, api) {
  const cardId = cardIt.id, compId = comp.id;
  const write = (patch, mode) => {
    const it = store.item(cardId);
    if (!it) return;
    const comps = it.data.components.map((c) => (c.id === compId ? { ...c, data: { ...c.data, ...patch } } : c));
    if (mode === 'change') store.checkpoint();
    store.patch(cardId, { data: { components: comps } }, mode === 'live' ? { norender: true } : {});
  };
  const ctx = {
    h, s, uid, clamp, toast, download, modal, lib, store, readFileAsDataURL, loadImage,
    parseYouTube, youTubeTitle,
    data: comp.data, comp, card: cardIt, cardId, compId,
    width: Math.max(160, cardIt.w - 26),
    begin: () => store.checkpoint(),
    live: (p) => write(p, 'live'),
    set: (p) => write(p, 'set'),
    change: (p) => write(p, 'change'),
    rerender: () => api.rerender(),
    field: (key, opts) => fieldEl(ctx, key, opts),
    asset: (id) => store.board.assets[id],
    addAsset: (src) => store.addAsset(src),
    pickImage: (cb) => lib.pickImage(cb),
    focusItem,
    frames: () => Object.values(store.items).filter((i) => i.type === 'frame').sort((a, b) => a.y - b.y || a.x - b.x),
    lists: listsOnBoard, resolveList, optionOf, dropdown: dropdownEl,
    compsOnBoard, resolveComp,
    // создать рядом карточку инструмента (например, «Предмет»)
    createTool: (toolId, o = {}) => {
      const near = store.item(cardId);
      const p = findFreeSpot({ x: near.x + near.w + 60 + 150, y: near.y + 120 }, 300, 260);
      const card = makeCard(toolId, p, liveEnv(near), { z: store.maxZ() + 1, ...o });
      store.upsert(card);
      return card;
    },
    ensureList: (title, options) => liveEnv(store.item(cardId)).ensureList(title, options),
    settingsOpen: openSettings.has(compId),
    toggleSettings: () => { openSettings.has(compId) ? openSettings.delete(compId) : openSettings.add(compId); api.rerender(); },
  };
  return ctx;
}

// ---------- операции над списком компонентов ----------
function setComps(api, comps) {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
  api.change({ components: comps });
  api.rerender();
}
function moveComp(api, it, id, dir) {
  const arr = [...it.data.components];
  const i = arr.findIndex((c) => c.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  setComps(api, arr);
}
function reorderComp(api, it, id, targetId, after) {
  const arr = [...it.data.components];
  const i = arr.findIndex((c) => c.id === id);
  if (i < 0) return;
  const [c] = arr.splice(i, 1);
  let j = arr.findIndex((x) => x.id === targetId);
  if (j < 0) return;
  if (after) j++;
  arr.splice(j, 0, c);
  setComps(api, arr);
}
export function newComponent(type, data = {}) {
  const def = getComponent(type);
  return { id: uid('c'), type, data: { ...(def?.defaults?.() || {}), ...data } };
}
function addComp(api, it, type) {
  const def = getComponent(type);
  const comp = newComponent(type);
  if (def?.openOnAdd) openSettings.add(comp.id);
  addMenuFor = null;
  setComps(api, [...it.data.components, comp]);
}

// ---------- отрисовка ----------
const GROUP_ORDER = ['Базовые', 'Данные', 'Геймдизайн', 'Уровни и баланс', 'Арт'];

function addMenu(it, api) {
  const groups = new Map();
  for (const d of allComponents()) {
    const g = d.group || 'Другое';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  const order = [...groups.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  return h('div', { class: 'add-menu' },
    order.map((g) => h('div', { class: 'am-group' }, h('div', { class: 'am-gt' }, g),
      groups.get(g).map((d) => h('button', { class: 'am-item', title: d.description || '', onClick: () => addComp(api, it, d.type) },
        h('span', { class: 'am-i' }, d.icon || '▪'), h('span', {}, d.name || d.type),
        d.extends ? h('small', { class: 'muted' }, ' ← ' + (getComponent(d.extends)?.name || d.extends)) : null)))),
    h('button', { class: 'am-close', onClick: () => { addMenuFor = null; api.rerender(); } }, 'Закрыть'));
}

function compBlock(it, comp, api, idx, total) {
  const def = getComponent(comp.type);
  const ctx = makeCtx(it, comp, api);
  let body;
  try {
    body = def ? callWithBase(def, 'render', ctx) : h('div', { class: 'comp-err' }, `Компонент «${comp.type}» не найден в папке components`);
  } catch (e) {
    console.error(e);
    body = h('div', { class: 'comp-err' }, `Ошибка в компоненте «${def?.name || comp.type}»: ${e.message}`);
  }
  const wrap = h('div', { class: 'comp c-' + comp.type, 'data-comp': comp.id });
  const grip = h('span', { class: 'comp-grip no-drag', title: 'Перетащите, чтобы переставить' }, '⠿');
  grip.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const list = wrap.parentElement;
    let target = null, after = false;
    wrap.classList.add('dragging-comp');
    const clear = () => list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    const move = (ev) => {
      clear();
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.comp');
      target = null;
      if (el && el.parentElement === list && el !== wrap) {
        const r = el.getBoundingClientRect();
        after = ev.clientY > r.top + r.height / 2;
        el.classList.add(after ? 'drop-after' : 'drop-before');
        target = el.dataset.comp;
      }
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      clear();
      wrap.classList.remove('dragging-comp');
      if (target) reorderComp(api, store.item(it.id), comp.id, target, after);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
    grip.addEventListener('pointercancel', up, { once: true });
  });
  const open = openSettings.has(comp.id);
  wrap.append(
    h('div', { class: 'comp-bar' }, grip,
      h('span', { class: 'comp-name' }, (def?.icon || '▪') + ' ' + (def?.name || comp.type)),
      h('span', { class: 'grow' }),
      def?.settings ? h('button', { class: 'cb-btn' + (open ? ' on' : ''), title: 'Настройки компонента', onClick: () => ctx.toggleSettings() }, '⚙') : null,
      h('button', { class: 'cb-btn', title: 'Выше', disabled: idx === 0, onClick: () => moveComp(api, store.item(it.id), comp.id, -1) }, '↑'),
      h('button', { class: 'cb-btn', title: 'Ниже', disabled: idx === total - 1, onClick: () => moveComp(api, store.item(it.id), comp.id, 1) }, '↓'),
      h('button', { class: 'cb-btn danger', title: 'Удалить компонент', onClick: () => { openSettings.delete(comp.id); setComps(api, store.item(it.id).data.components.filter((c) => c.id !== comp.id)); } }, '×')),
    h('div', { class: 'comp-body' }, body));
  if (open && def?.settings) {
    let st;
    try { st = callWithBase(def, 'settings', ctx); } catch (e) { st = h('div', { class: 'comp-err' }, e.message); }
    wrap.append(h('div', { class: 'comp-settings' }, st,
      h('button', { class: 'ghost-btn', onClick: () => ctx.toggleSettings() }, 'Готово')));
  }
  return wrap;
}

export const CARD = {
  label: 'Карточка', icon: '▭', w: 300, h: 140, min: [220, 40],
  data: () => ({ title: 'Карточка', tool: 'empty', color: '#7c5cff', components: [] }),
  title: (d) => (d.tool === 'bug' ? (d.components?.find((c) => c.type === 'text')?.data.text || d.title) : d.title),
  deps(it) {
    const out = [];
    for (const c of it.data.components || []) {
      const def = getComponent(c.type);
      try { out.push(...(def?.deps?.(c.data) || [])); } catch {}
    }
    return out.filter(Boolean);
  },
  // типы компонентов, за которыми следит карточка (перерисовка при их изменении на любой карточке)
  watch(it) {
    const out = new Set();
    for (const c of it.data.components || []) for (const t of getComponent(c.type)?.watch || []) out.add(t);
    return [...out];
  },
  render(it, api) {
    const d = it.data;
    const tool = TOOLS.find((t) => t.id === d.tool);
    const comps = d.components || [];
    const title = h('input', { class: 'f gcard-title', value: d.title || '', placeholder: 'Название карточки' });
    title.onfocus = () => store.checkpoint();
    title.oninput = () => api.live({ title: title.value });
    const root = h('div', { class: 'gcard', style: { '--c': d.color || '#7c5cff' } },
      h('div', { class: 'gcard-head' }, h('span', { class: 'gcard-icon' }, tool?.icon || '▭'), title,
        h('span', { class: 'gcard-count', title: 'Компонентов на карточке' }, comps.length || '')),
      h('div', { class: 'comps' }, comps.map((c, i) => compBlock(it, c, api, i, comps.length))),
      addMenuFor === it.id ? addMenu(it, api)
        : h('button', { class: 'add-comp' + (comps.length ? '' : ' big'), onClick: () => { addMenuFor = it.id; api.rerender(); } },
          comps.length ? '+ Компонент' : '+ Добавить компонент'));
    return root;
  },
};

// Картинка, брошенная на карточку: заполнить пустую картинку/спрайт или добавить компонент «Картинка»
export async function dropImageOnCard(cardId, file) {
  const it = store.item(cardId);
  if (!it) return;
  const comps0 = it.data.components || [];
  const toSprite = comps0.some((c) => c.type === 'sprite' && !c.data.asset) && !comps0.some((c) => c.type === 'image' && !c.data.asset);
  const src = toSprite ? await readFileAsDataURL(file) : await imageFileToDataURL(file); // спрайт-листы — без пережатия
  const img = await loadImage(src);
  const asset = store.addAsset(src);
  store.checkpoint();
  const comps = [...it.data.components];
  const empty = comps.findIndex((c) => (c.type === 'image' || c.type === 'sprite') && !c.data.asset);
  if (empty >= 0) {
    const c = comps[empty];
    const extra = c.type === 'sprite' ? { fw: img.width / (c.data.cols || 1), fh: img.height / (c.data.rows || 1) } : { name: file.name };
    comps[empty] = { ...c, data: { ...c.data, asset, ...extra } };
  } else comps.push(newComponent('image', { asset, name: file.name }));
  store.patch(cardId, { data: { components: comps } });
  toast('Картинка добавлена в карточку', 'ok', 1400);
}
