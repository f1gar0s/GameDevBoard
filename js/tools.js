// Инструменты — готовые карточки с набором компонентов (пресеты), + миграция старых досок
import { uid } from './util.js';
import { getComponent } from './registry.js';
import { findFreeSpot } from './canvas.js';
import { store } from './store.js';

const comp = (type, data = {}) => ({ id: uid('c'), type, data: { ...(getComponent(type)?.defaults?.() || {}), ...data } });

// Стандартные списки (карточки «Список»), которые создаются автоматически при первом использовании
export const LISTS = {
  priority: ['Приоритет', [['Высокий', '#ef4444'], ['Средний', '#f59e0b'], ['Низкий', '#64748b']]],
  bugState: ['Готовность', [['К работе', '#64748b'], ['В работе', '#3b82f6'], ['Исправлен', '#22c55e']]],
  taskState: ['Статус задачи', [['К работе', '#64748b'], ['В работе', '#3b82f6'], ['Проверка', '#f59e0b'], ['Готово', '#22c55e']]],
  direction: ['Направление', [['Code', '#60a5fa'], ['Art', '#f472b6'], ['Design', '#a78bfa'], ['Audio', '#fbbf24'], ['QA', '#34d399'], ['Narrative', '#fb923c']]],
  team: ['Команда', [['Аня', '#f472b6'], ['Дима', '#60a5fa'], ['Олег', '#34d399'], ['Лена', '#fbbf24']]],
  rarity: ['Редкость', [['Обычный', '#9ca3af'], ['Необычный', '#22c55e'], ['Редкий', '#3b82f6'], ['Эпический', '#a855f7'], ['Легендарный', '#f59e0b']]],
};
export const DONE_RE = /^(готово|исправлен|done|закрыт|закрыто|fixed)$/i;

// Окружение: где искать и куда класть карточки (живая доска, шаблон или миграция)
export function makeEnv(getItems, add, spot) {
  const env = {
    findList(title) {
      const t = title.trim().toLowerCase();
      for (const it of getItems()) {
        if (it.type !== 'card' || it.data.tool !== 'list' || (it.data.title || '').trim().toLowerCase() !== t) continue;
        const c = it.data.components.find((x) => x.type === 'list');
        if (c) return { card: it.id, comp: c.id, items: c.data.items, cardItem: it, compObj: c };
      }
      return null;
    },
    ensureList(keyOrTitle, options) {
      const [title, opts] = LISTS[keyOrTitle] || [keyOrTitle, options || [['Вариант 1', '#7c5cff'], ['Вариант 2', '#22d3a6']]];
      const found = env.findList(title);
      if (found) return found;
      const items = opts.map(([text, color]) => ({ id: uid('o'), text, color }));
      const lc = comp('list', { items });
      const w = 240, hh = 120 + items.length * 36;
      const p = spot(w, hh);
      const card = { id: uid('i'), type: 'card', x: Math.round(p.x - w / 2), y: Math.round(p.y - hh / 2), w, h: hh, z: 1, data: { title, tool: 'list', color: '#94a3b8', components: [lc] } };
      add(card);
      return { card: card.id, comp: lc.id, items, cardItem: card, compObj: lc };
    },
    // найти вариант по тексту, при необходимости дописать его в список
    option(keyOrTitle, text, addMissing = false) {
      if (text == null || text === '') return null;
      const l = env.ensureList(keyOrTitle);
      const t = String(text).trim().replace(/^@/, '').toLowerCase();
      let o = l.items.find((x) => x.text.toLowerCase() === t);
      if (!o && addMissing && t) {
        const clean = String(text).trim().replace(/^@/, '');
        o = { id: uid('o'), text: clean.charAt(0).toUpperCase() + clean.slice(1), color: '#94a3b8' };
        l.items.push(o);
        l.compObj.data.items = l.items;
      }
      return o?.id || null;
    },
  };
  return env;
}
export function liveEnv(near) {
  const n = near || { x: 0, y: 0, w: 300, h: 200 };
  let dy = 0;
  return makeEnv(() => Object.values(store.items), (it) => store.upsert(it), (w, hh) => {
    const p = findFreeSpot({ x: n.x + (n.w || 300) + 60 + w / 2, y: n.y + hh / 2 + dy }, w, hh);
    dy += 0;
    return p;
  });
}

const dd = (env, key, label, valueText = null) => {
  const l = env.ensureList(key);
  const v = valueText == null ? null : typeof valueText === 'number' ? l.items[valueText]?.id : env.option(key, valueText, true);
  return comp('dropdown', { label, list: { card: l.card, comp: l.comp }, value: v ?? null });
};

// ---------- список инструментов ----------
export const TOOLS = [
  { id: 'empty', hidden: true, name: 'Карточка', icon: '▭', group: 'Основа', w: 280, desc: 'Название и текст с гиперссылками на фреймы и объекты', make: (env, o) => [comp('text', { text: o.text ?? '', placeholder: 'Текст… выделите слова и нажмите 🔗, чтобы сделать ссылку', multiline: true })] },
  { id: 'dialogue', name: 'Реплика (диалог)', icon: '💬', group: 'Геймдизайн', standalone: 'dialogue', desc: 'Диалоговая система: стрелки — варианты ответа, ▶ плейтест' },
  { id: 'character', name: 'Персонаж', icon: '🧙', group: 'Геймдизайн', w: 290, make: (env, o) => [comp('character', o.data)] },
  {
    id: 'item', name: 'Предмет', icon: '🗡', group: 'Геймдизайн', w: 270,
    make: (env, o) => {
      const l = env.ensureList('rarity');
      const RAR = { common: 'Обычный', uncommon: 'Необычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };
      const want = o.data?.rarity ? RAR[o.data.rarity] || o.data.rarity : 'Редкий';
      return [comp('item', { ...o.data, rarityList: { card: l.card, comp: l.comp }, rarityOpt: env.option('rarity', want, true) })];
    },
  },
  { id: 'quest', name: 'Квест', icon: '📜', group: 'Геймдизайн', w: 290, color: '#f59e0b', make: (env, o) => [comp('quest', o.data)] },
  {
    id: 'bug', name: 'Баг', icon: '🐞', group: 'Продакшн', w: 300, color: '#ef4444', desc: 'Описание, приоритет, готовность, кто оставил и кто решает',
    make: (env, o) => [
      comp('text', { label: 'Описание бага', text: o.text ?? '', placeholder: 'Что сломалось, как воспроизвести…', multiline: true }),
      dd(env, 'priority', 'Приоритет', o.priority ?? 1),
      dd(env, 'bugState', 'Готовность', o.state ?? 0),
      dd(env, 'team', 'Кто оставил', o.author ?? null),
      dd(env, 'team', 'Кто решает', o.assignee ?? null),
    ],
  },
  {
    id: 'task', name: 'Задача', icon: '✅', group: 'Продакшн', w: 280, color: '#3b82f6',
    make: (env, o) => [
      dd(env, 'taskState', 'Статус', o.status ?? 0),
      dd(env, 'direction', 'Направление', o.direction ?? 0),
      dd(env, 'team', 'Исполнитель', o.assignee ?? null),
      comp('number', { label: 'Story points', value: o.points ?? 3 }),
    ],
  },
  { id: 'table', name: 'Таблица', icon: '▦', group: 'Данные', w: 440, make: (env, o) => [comp('table', o.data)] },
  { id: 'list', name: 'Список для выпадающих', icon: '☰', group: 'Данные', w: 240, color: '#94a3b8', desc: 'Варианты (текст + цвет) для компонента «Выпадающий список»', make: (env, o) => [comp('list', o.data)] },
  { id: 'mapgen', name: 'Карта', icon: '🗺', group: 'Уровни и баланс', w: 480, color: '#22d3a6', desc: 'Сгенерировать мир или загрузить своё изображение; метки-ссылки', make: (env, o) => [comp('mapgen', o.data)] },
  { id: 'citymap', name: 'Карта города', icon: '🏘', group: 'Уровни и баланс', w: 480, color: '#22d3a6', desc: 'Сгенерированный город: средневековый или современный; метки-ссылки', make: (env, o) => [comp('mapgen', { kind: 'city', city: 'medieval', ...o.data })] },
  { id: 'tilemap', name: 'Уровень (тайлы)', icon: '🧱', group: 'Уровни и баланс', w: 460, color: '#3b82f6', make: (env, o) => [comp('tilemap', o.data)] },
  { id: 'curve', name: 'Кривая баланса', icon: '📈', group: 'Уровни и баланс', w: 400, make: (env, o) => [comp('curve', o.data)] },
  {
    id: 'loottable', name: 'Таблица лута', icon: '🎲', group: 'Уровни и баланс', w: 420, color: '#f59e0b',
    make: (env, o) => {
      const l = env.ensureList('rarity');
      const rows = (o.rows || [['Золото x10', 50, 0], ['Зелье лечения', 30, 1], ['Редкий амулет', 15, 2], ['Легендарный клинок', 5, 4]])
        .map(([name, w, ri]) => ({ name, w, opt: typeof ri === 'number' ? l.items[ri]?.id : env.option('rarity', ri, true) }));
      return [comp('loottable', { title: o.title ?? 'Сундук подземелья', list: { card: l.card, comp: l.comp }, rows })];
    },
  },
  { id: 'canvas', name: 'Холст со слоями', icon: '🖌', group: 'Арт', w: 700, color: '#ec4899', make: (env, o) => [comp('canvas', o.data)] },
  { id: 'sprite', name: 'Спрайт-анимация', icon: '👾', group: 'Арт', w: 280, color: '#ec4899', make: (env, o) => [comp('sprite', o.data)] },
  { id: 'palette', name: 'Палитра', icon: '🎨', group: 'Арт', w: 330, color: '#ec4899', make: (env, o) => [comp('palette', o.data)] },
];
export const toolById = (id) => TOOLS.find((t) => t.id === id);

// Создать карточку инструмента (без добавления на доску). o: { title, color, data, text, ... }
export function makeCard(toolId, center, env, o = {}) {
  const t = toolById(toolId) || TOOLS[0];
  const w = o.w || t.w || 300;
  const comps = t.make ? t.make(env, o) : [];
  const defTitle = t.id === 'task' ? 'Новая задача' : t.name;
  return {
    id: o.id || uid('i'), type: 'card', x: Math.round(center.x - w / 2), y: Math.round(center.y - 60), w, h: o.h || 160, z: o.z ?? 1,
    data: { title: o.title ?? defTitle, tool: t.id, color: o.color || t.color || '#7c5cff', components: comps },
  };
}

// ---------- миграция досок старого формата ----------
const OLD = { character: 'character', loot: 'item', quest: 'quest', tilemap: 'tilemap', curve: 'curve', loottable: 'loottable', sprite: 'sprite', palette: 'palette', task: 'task',
  // не старые типы, а сокращения для шаблонов:
  mapgen: 'mapgen', table: 'table', canvas: 'canvas' };
const OLD_STATUS = { todo: 'К работе', doing: 'В работе', review: 'Проверка', done: 'Готово' };
const OLD_BUG = { todo: 'К работе', doing: 'В работе', review: 'В работе', done: 'Исправлен' };
const OLD_PRIO = { crit: 'Высокий', high: 'Высокий', mid: 'Средний', low: 'Низкий' };
const OLD_RARITY = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export function migrateItems(items /* объект id → item */) {
  const list = Object.values(items);
  if (!list.some((i) => OLD[i.type] || (i.type === 'frame' && i.data.status))) return false;
  let maxX = -Infinity, minY = Infinity;
  for (const i of list) { maxX = Math.max(maxX, i.x + i.w); minY = Math.min(minY, i.y); }
  let ly = minY;
  const env = makeEnv(() => Object.values(items), (it) => { items[it.id] = it; }, (w, hh) => { const p = { x: maxX + 120 + w / 2, y: ly + hh / 2 }; ly += hh + 50; return p; });
  for (const it of list) {
    if (it.type === 'frame' && it.data.status) {
      it.data = { ...it.data, kanban: true };
      delete it.data.status;
      continue;
    }
    const tool = OLD[it.type];
    if (!tool) continue;
    const d = it.data;
    let o = { data: d };
    let toolId = tool;
    if (it.type === 'task') {
      if (d.kind === 'bug') { toolId = 'bug'; o = { text: d.title, priority: OLD_PRIO[d.priority] || 'Средний', state: OLD_BUG[d.status] || 'К работе', assignee: d.assignee || null }; }
      else o = { title: d.title, status: OLD_STATUS[d.status] || 'К работе', direction: d.tag || 'Code', assignee: d.assignee || null, points: d.points };
    }
    if (it.type === 'loottable') o = { title: d.title, rows: d.rows ? d.rows.map((r) => [r.name, r.w, Math.max(0, OLD_RARITY.indexOf(r.r))]) : undefined };
    if (it.type === 'loot') o = { data: { icon: d.icon, name: d.name, rarity: d.rarity, kind: d.kind, price: d.price, desc: d.desc } };
    const title = { mapgen: 'Карта мира', table: 'Таблица', canvas: 'Холст', character: d.name, loot: d.name, quest: d.title, tilemap: d.name, curve: d.title, loottable: d.title, sprite: 'Спрайт ' + (d.name || ''), palette: d.title }[it.type];
    const card = makeCard(toolId, { x: it.x + it.w / 2, y: it.y + 60 }, env, { ...o, id: it.id, z: it.z, w: Math.max(it.w, toolById(toolId)?.w || 0), title: it.type === 'task' ? (toolId === 'bug' ? 'Баг' : d.title) : title });
    items[it.id] = card;
  }
  return true;
}
