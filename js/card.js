// Карточка — объект доски (баг, задача, персонаж, предмет…) с фиксированным набором полей.
// Поля описаны модулями в папке components/ (это внутреннее устройство — в интерфейсе их нельзя
// добавлять, переставлять и удалять). Настройки полей открываются одной шестерёнкой ⚙ в шапке карточки.
import { h, s, uid, clamp, toast, download, modal, readFileAsDataURL, loadImage, imageFileToDataURL, parseYouTube, youTubeTitle } from './util.js';
import { store, pageOf, pathOf, framesInOrder } from './store.js';
import { getComponent, allComponents, callWithBase } from './registry.js';
import * as lib from './lib.js';
import { focusItem, goTo, openPage } from './canvas.js';
import { liveEnv, TOOLS, makeCard } from './tools.js';
import { richText } from './richtext.js';
import { openPicker } from './picker.js';
import { findFreeSpot } from './canvas.js';

export const openSettings = new Set(); // id карточек в режиме настройки (⚙)

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
function fieldEl(ctx, key, { tag = 'input', cls = '', placeholder = '', type = 'text', num = false, rows, onLive, autosize = false, commit = false, rich = true } = {}) {
  // многострочный текст — с гиперссылками (выделить слова → 🔗, или автоссылки на фреймы)
  if (tag === 'textarea' && rich) {
    return richText({
      cls: 'f rt-field ' + cls, placeholder,
      value: () => resolveComp({ card: ctx.cardId, comp: ctx.compId })?.data[key] ?? '',
      selfPage: () => pageOf(store.item(ctx.cardId)),
      onBegin: () => ctx.begin(),
      onLive: (v) => { ctx.live({ [key]: v }); onLive?.(v); },
      onCommit: (v) => ctx.set({ [key]: v }),
    });
  }
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
    // области (старые «фреймы» на холсте) со всех фреймов
    frames: () => Object.values(store.items).filter((i) => i.type === 'frame').sort((a, b) => a.y - b.y || a.x - b.x),
    // фреймы иерархии (страницы) в порядке дерева, с путём «Раздел / Подраздел / Фрейм»
    pages: () => framesInOrder(store.tree).map((n) => ({ ...n, path: pathOf(store.tree, n.id).join(' / ') })),
    pageOf, pathOf: (id) => pathOf(store.tree, id), goTo, openPage,
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
    settingsOpen: openSettings.has(cardId),
    toggleSettings: () => { openSettings.has(cardId) ? openSettings.delete(cardId) : openSettings.add(cardId); api.rerender(); },
    pick: (o) => openPicker(o),
  };
  return ctx;
}

export function newComponent(type, data = {}) {
  const def = getComponent(type);
  return { id: uid('c'), type, data: { ...(def?.defaults?.() || {}), ...data } };
}

// ---------- отрисовка ----------
function fieldBlock(it, comp, api, setMode) {
  const def = getComponent(comp.type);
  const ctx = makeCtx(it, comp, api);
  let body;
  try {
    body = def ? callWithBase(def, 'render', ctx) : h('div', { class: 'comp-err' }, `Поле «${comp.type}» не найдено`);
  } catch (e) {
    console.error(e);
    body = h('div', { class: 'comp-err' }, `Ошибка в поле «${def?.name || comp.type}»: ${e.message}`);
  }
  const wrap = h('div', { class: 'fld c-' + comp.type, 'data-comp': comp.id }, body);
  if (setMode && def?.settings) {
    let st;
    try { st = callWithBase(def, 'settings', ctx); } catch (e) { st = h('div', { class: 'comp-err' }, e.message); }
    wrap.append(h('div', { class: 'fld-settings' }, h('div', { class: 'fld-settings-t' }, (def.icon || '▪') + ' ' + (comp.data.label || def.name || comp.type)), st));
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
    const title = h('input', { class: 'f gcard-title', value: d.title || '', placeholder: 'Название' });
    title.onfocus = () => store.checkpoint();
    title.oninput = () => api.live({ title: title.value });
    const setMode = openSettings.has(it.id);
    const hasSettings = comps.some((c) => getComponent(c.type)?.settings);
    return h('div', { class: 'gcard' + (setMode ? ' setmode' : ''), style: { '--c': d.color || '#7c5cff' } },
      h('div', { class: 'gcard-head' }, h('span', { class: 'gcard-icon' }, tool?.icon || '▭'), title,
        hasSettings ? h('button', { class: 'gcard-gear' + (setMode ? ' on' : ''), title: setMode ? 'Готово' : 'Настроить поля (списки, подписи, размеры)', onClick: () => { setMode ? openSettings.delete(it.id) : openSettings.add(it.id); api.rerender(); } }, setMode ? '✓' : '⚙') : null),
      comps.length ? h('div', { class: 'fields' }, comps.map((c) => fieldBlock(it, c, api, setMode))) : null);
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
  let empty = comps.findIndex((c) => (c.type === 'image' || c.type === 'sprite') && !c.data.asset);
  // на карту — как её изображение (метки сохраняются)
  if (empty < 0) { const mi = comps.findIndex((c) => c.type === 'mapgen'); if (mi >= 0) { comps[mi] = { ...comps[mi], data: { ...comps[mi].data, source: 'image', asset, name: file.name } }; store.patch(cardId, { data: { components: comps } }); toast('Изображение поставлено на карту', 'ok', 1400); return; } }
  if (empty >= 0) {
    const c = comps[empty];
    const extra = c.type === 'sprite' ? { fw: img.width / (c.data.cols || 1), fh: img.height / (c.data.rows || 1) } : { name: file.name };
    comps[empty] = { ...c, data: { ...c.data, asset, ...extra } };
  } else {
    // свободного поля «Картинка» нет — кладём картинку рядом с карточкой отдельным объектом
    const k = Math.min(1, 320 / img.width);
    const w = Math.round(img.width * k), hh = Math.round(img.height * k);
    const p = findFreeSpot({ x: it.x + it.w + 40 + w / 2, y: it.y + hh / 2 }, w, hh);
    store.upsert({ id: uid('i'), type: 'image', x: Math.round(p.x - w / 2), y: Math.round(p.y - hh / 2), w, h: hh, z: store.maxZ() + 1, data: { asset, name: file.name } });
    toast('Картинка добавлена рядом с карточкой', 'ok', 1400);
    return;
  }
  store.patch(cardId, { data: { components: comps } });
  toast('Картинка добавлена в карточку', 'ok', 1400);
}
