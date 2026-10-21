// Точка входа: маршрутизация, главная страница, панели редактора
import { store, DB, newBoard } from './store.js';
import { h, s, toast, modal, prompt2, timeAgo, debounce, download } from './util.js';
import {
  initCanvas, setTool, onToolChange, tool, pen, view, onViewChange, zoomBy, setZoom, fitAll, focusItem,
  createItem, centerWorld, pasteClip, startEditing, onSelection, sel, bboxOf, findFreeSpot, createTool, addVideo,
} from './canvas.js';
import { WIDGETS, textOf, titleOf, ACCENT_COLORS, parseSeries } from './widgets.js';
import { TEMPLATES, buildTemplate } from './templates.js';
import { TOOLS, toolById, migrateItems, DONE_RE } from './tools.js';
import { loadComponents, allComponents, getComponent } from './registry.js';
import { cardField, resolveList } from './card.js';
import { exportGDD, exportEngine, exportBoardFile, readBoardFile, shareLink, readShared } from './export.js';
import { lintDialogues } from './play.js';
import { exportDialoguesDialog, exportTexts, lintFormat } from './dialogfmt.js';
import { initHierarchy } from './hierarchy.js';
import { pageOf, pathOf } from './store.js';
import { collab, connectRoom, shareBoard, leave, me, setMyName, onPresence, onState, trackCursor, roomLink, parseRoom, BROKERS, brokerSettings, saveBrokerSettings, syncNow, redial } from './collab.js';

const $ = (q) => document.querySelector(q);
const home = $('#home'), editor = $('#editor');

// ======================= ГЛАВНАЯ =======================
function thumb(b) {
  const items = Object.values(b.items || {});
  const svg = s('svg', { viewBox: '0 0 240 130', class: 'thumb' });
  const bb = bboxOf(items);
  if (!bb) { svg.append(s('text', { x: 120, y: 70, 'text-anchor': 'middle', class: 'thumb-empty' }, 'пусто')); return svg; }
  const k = Math.min(220 / bb.w, 110 / bb.h);
  const ox = (240 - bb.w * k) / 2, oy = (130 - bb.h * k) / 2;
  const col = { sticky: null, frame: 'none', character: '#7c5cff', loot: '#f59e0b', quest: '#f59e0b', dialogue: '#22d3a6', task: '#3b82f6', tilemap: '#3b82f6', curve: '#7c5cff', loottable: '#f59e0b', sprite: '#ec4899', palette: '#ec4899', shape: null, text: '#e6e8ef', image: '#64748b', draw: 'none' };
  for (const it of [...items].sort((a, c) => (a.z || 0) - (c.z || 0))) {
    const fill = it.type === 'sticky' || it.type === 'shape' || it.type === 'card' ? it.data.color : col[it.type] ?? '#475569';
    svg.append(s('rect', {
      x: ox + (it.x - bb.x) * k, y: oy + (it.y - bb.y) * k, width: Math.max(1.5, it.w * k), height: Math.max(1.5, it.h * k), rx: 1.5,
      fill: it.type === 'frame' ? 'rgba(255,255,255,.03)' : fill, stroke: it.type === 'frame' ? it.data.color : 'none', 'stroke-width': 0.8, opacity: it.type === 'text' ? 0.5 : 0.9,
    }));
  }
  return svg;
}

async function renderHome() {
  const boards = (await DB.all()).sort((a, b) => b.updated - a.updated);
  const tplCard = (t) => h('button', { class: 'tpl', style: { '--c': t.color }, onClick: () => createBoard(t) },
    h('div', { class: 'tpl-icon' }, t.icon), h('div', { class: 'tpl-name' }, t.name), h('div', { class: 'tpl-desc' }, t.desc));
  const boardCard = (b) => h('div', { class: 'bcard', onClick: () => (location.hash = '#/b/' + b.id) },
    thumb(b),
    h('div', { class: 'bcard-body' },
      h('div', { class: 'bcard-name' }, b.room ? h('span', { class: 'room-badge', title: 'Общая доска (совместный доступ)' }, '🌐 ') : null, b.name),
      h('div', { class: 'bcard-meta' }, `${Object.keys(b.items || {}).length} элементов${Object.values(b.tree || {}).filter((n) => n.kind === 'frame').length > 1 ? ' · ' + Object.values(b.tree).filter((n) => n.kind === 'frame').length + ' фреймов' : ''} · ${timeAgo(b.updated)}`)),
    h('div', { class: 'bcard-actions' },
      h('button', { title: 'Переименовать', onClick: async (e) => { e.stopPropagation(); const n = await prompt2('Название доски', b.name); if (n) { b.name = n; await DB.put(b); renderHome(); } } }, '✎'),
      h('button', { title: 'Дублировать', onClick: async (e) => { e.stopPropagation(); const c = structuredClone(b); delete c.room; c.id = newBoard().id; c.name += ' (копия)'; c.updated = Date.now(); await DB.put(c); renderHome(); } }, '⧉'),
      h('button', { title: 'Скачать файл', onClick: (e) => { e.stopPropagation(); exportBoardFile(b); } }, '⤓'),
      h('button', { title: 'Удалить', class: 'danger', onClick: (e) => { e.stopPropagation(); confirmDelete(b); } }, '🗑')));
  const features = [
    ['🧩', 'Карточки из компонентов', 'Как в Unity: добавляйте компоненты на карточку, переставляйте и настраивайте через ⚙'],
    ['💬', 'Плейтест диалогов', 'Соберите граф реплик и пройдите его как игрок прямо на доске'],
    ['▾', 'Выпадающие списки', 'Варианты с цветами живут в отдельной карточке-списке и общие для всей доски'],
    ['🐞', 'Баги и задачи', 'Приоритет, готовность, кто оставил и кто решает; канбан по фреймам'],
    ['🗺', 'Генератор карт 2D', 'Средневековая или современная карта по зерну, экспорт PNG'],
    ['🖌', 'Холст со слоями', 'Кисть, линии, фигуры, слои с перетаскиванием, экспорт PNG'],
    ['🎮', 'Экспорт в движок', 'JSON для Unity / Godot, диалоги по файлам и GDD в Markdown'],
    ['👥', 'Совместный доступ', 'Доска по ссылке прямо на GitHub Pages: правки и курсоры в реальном времени, шифрование']
  ];
  home.replaceChildren(
    h('div', { class: 'home-wrap' },
      h('header', { class: 'hero' },
        h('div', { class: 'hero-logo' }, h('span', { class: 'logo-mark big' }), h('span', { class: 'pixel' }, 'GAMEDEV', h('br'), 'BOARD')),
        h('p', { class: 'hero-sub' }, 'Бесконечная доска для команд, которые делают игры. GDD, диалоги, уровни, баланс и спринт — на одном холсте, и всё можно сразу проверить в деле.'),
        h('div', { class: 'hero-actions' },
          h('button', { class: 'btn primary big', onClick: () => createBoard(null) }, '+ Пустая доска'),
          h('button', { class: 'btn big', onClick: importFile }, '📂 Открыть файл'))),
      h('section', {},
        h('h2', {}, 'Начать с шаблона'),
        h('div', { class: 'tpl-grid' }, TEMPLATES.map(tplCard))),
      h('section', {},
        h('h2', {}, 'Мои доски ', h('span', { class: 'count' }, boards.length || '')),
        boards.length ? h('div', { class: 'board-grid' }, boards.map(boardCard))
          : h('div', { class: 'empty-boards' }, 'Пока нет досок. Выберите шаблон выше — например, «Game Design Document».')),
      h('section', {},
        h('h2', {}, 'Что умеет'),
        h('div', { class: 'feat-grid' }, features.map(([i, t, d]) => h('div', { class: 'feat' }, h('div', { class: 'feat-i' }, i), h('b', {}, t), h('span', {}, d))))),
      h('footer', { class: 'home-foot' }, 'Данные хранятся локально в вашем браузере (IndexedDB). Делитесь ссылками-снимками, файлами или сессией совместной работы.')));
}

function confirmDelete(b) {
  modal('Удалить доску?', h('p', {}, `«${b.name}» будет удалена из этого браузера без возможности восстановления.`), {
    actions: [{ label: 'Отмена' }, { label: 'Удалить', primary: true, onClick: () => { DB.del(b.id).then(renderHome); } }],
  });
}

async function createBoard(tpl) {
  const b = newBoard(tpl ? tpl.name : 'Новая доска');
  if (tpl) {
    const { items, links } = buildTemplate(tpl);
    items.forEach((i) => (b.items[i.id] = i));
    links.forEach((l) => (b.links[l.id] = l));
    b.view = null;
  }
  await DB.put(b);
  location.hash = '#/b/' + b.id;
}

function importFile() {
  const inp = h('input', { type: 'file', accept: '.json,application/json' });
  inp.onchange = async () => { if (inp.files[0]) await importBoardFromFile(inp.files[0]); };
  inp.click();
}
async function importBoardFromFile(f) {
  try {
    const b = await readBoardFile(f);
    await DB.put(b);
    toast('Доска импортирована', 'ok');
    location.hash = '#/b/' + b.id;
  } catch (e) { toast(e.message || 'Не удалось импортировать', 'err'); }
}

// ======================= РЕДАКТОР =======================
const DRAW_TOOLS = [
  ['select', '➤', 'Выделение', 'V'], ['hand', '✋', 'Рука', 'H / пробел'], null,
  ['sticky', '🗒', 'Стикер', 'N'], ['text', 'T', 'Текст', 'T'], ['shape', '◆', 'Фигура', 'R'], ['frame', '▢', 'Область (рамка на холсте)', 'F'],
  ['connector', '⟶', 'Связь', 'C'], ['pen', '✎', 'Карандаш', 'P'], ['eraser', '⌫', 'Ластик', 'E'],
];
function buildToolbar() {
  const tb = $('#toolbar');
  tb.replaceChildren(
    ...DRAW_TOOLS.map((t) => t ? h('button', { class: 'tool', 'data-tool': t[0], title: `${t[2]} (${t[3]})`, onClick: () => setTool(t[0]) }, t[1]) : h('div', { class: 'tb-sep' })),
    h('div', { class: 'tb-sep' }),
    h('button', { class: 'tool lib-btn', id: 'btn-library', title: 'Инструменты, компоненты и шаблоны', onClick: toggleLibrary }, '＋', h('small', {}, 'Инстр.')),
    h('div', { class: 'tb-sep' }),
    h('button', { class: 'tool', title: 'Отменить (Ctrl+Z)', onClick: () => store.undo() }, '↶'),
    h('button', { class: 'tool', title: 'Повторить (Ctrl+Shift+Z)', onClick: () => store.redo() }, '↷'));
  onToolChange((t) => {
    tb.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    $('#penbar').classList.toggle('hidden', t !== 'pen');
  });
  setTool('select');
  // карандаш
  const pb = $('#penbar');
  const render = () => pb.replaceChildren(
    ...['#e6e8ef', ...ACCENT_COLORS.slice(0, 6)].map((c) => h('button', { class: 'cx-sw' + (pen.color === c ? ' on' : ''), style: { background: c }, onClick: () => { pen.color = c; render(); } })),
    h('span', { class: 'cx-sep' }),
    ...[2, 4, 8].map((w) => h('button', { class: 'cx-btn' + (pen.width === w ? ' on' : ''), onClick: () => { pen.width = w; render(); } }, h('i', { class: 'pen-w', style: { height: w + 'px' } }))));
  render();
}

// ---------- библиотека ----------
function toggleLibrary(force) {
  const lib = $('#library');
  const show = typeof force === 'boolean' ? force : lib.classList.contains('hidden');
  lib.classList.toggle('hidden', !show);
  $('#btn-library')?.classList.toggle('on', show);
}
function insertTemplate(t, at) {
  const { items, links } = buildTemplate(t);
  const created = pasteClip({ items, links, assets: {} }, at || centerWorld());
  const b = bboxOf(created.map((id) => store.item(id)));
  if (b) fitAll(true);
  toast(`Шаблон «${t.name}» добавлен`, 'ok');
}
function buildLibrary() {
  const lib = $('#library');
  const BASIC = [['sticky', 'Стикер', '🗒'], ['text', 'Текст', 'T'], ['shape', 'Фигура', '◆'], ['frame', 'Область', '▢'], ['video', 'Видео', '▶']];
  const toolTile = (t) => h('button', {
    class: 'lib-tile', draggable: 'true', title: (t.desc ? t.desc + '. ' : '') + 'Клик — добавить, или перетащите на доску',
    onClick: () => {
      const W = t.w || 300;
      const it = createTool(t.id, findFreeSpot(centerWorld(), W, 220));
      if (it) focusItem(it.id);
      if (window.innerWidth < 700) toggleLibrary(false);
    },
    onDragstart: (e) => e.dataTransfer.setData('application/x-gdb', JSON.stringify({ tool: t.id })),
  }, h('span', { class: 'lt-i' }, t.icon), h('span', {}, t.name));
  const basicTile = ([type, label, icon]) => h('button', {
    class: 'lib-tile', draggable: type === 'video' ? null : 'true', title: type === 'video' ? 'YouTube, RuTube или VK Видео. Можно просто вставить ссылку на доску (Ctrl+V)' : null,
    onClick: async () => {
      const W = WIDGETS[type];
      if (type === 'video') {
        const url = await prompt2('Ссылка на видео (YouTube, RuTube, VK Видео)', '', 'https://rutube.ru/video/…');
        if (!url) return;
        const it = addVideo(url, findFreeSpot(centerWorld(), W.w, W.h));
        if (it) focusItem(it.id); else toast('Не похоже на ссылку YouTube, RuTube или VK Видео', 'err');
        return;
      }
      const it = createItem(type, findFreeSpot(centerWorld(), W.w, W.h)); if (it) { focusItem(it.id); startEditing(it.id); }
    },
    onDragstart: (e) => e.dataTransfer.setData('application/x-gdb', JSON.stringify({ type })),
  }, h('span', { class: 'lt-i' }, icon), h('span', {}, label));
  const groups = [];
  for (const t of TOOLS) { let g = groups.find((x) => x.name === t.group); if (!g) groups.push((g = { name: t.group, tools: [] })); g.tools.push(t); }
  lib.replaceChildren(
    h('div', { class: 'drawer-head' }, h('b', {}, 'Инструменты'), h('button', { class: 'icon-btn', onClick: () => toggleLibrary(false) }, '✕')),
    h('div', { class: 'drawer-body scroll' },
      h('div', { class: 'lib-tip top' }, 'Инструмент = карточка с готовым набором компонентов. На любую карточку можно добавить ещё компоненты кнопкой «+ Компонент».'),
      groups.map((g) => h('div', { class: 'lib-group' }, h('div', { class: 'lib-gt' }, g.name), h('div', { class: 'lib-grid' }, g.tools.map(toolTile)))),
      h('div', { class: 'lib-group' }, h('div', { class: 'lib-gt' }, 'Базовые элементы'), h('div', { class: 'lib-grid' }, BASIC.map(basicTile))),
      h('div', { class: 'lib-group' }, h('div', { class: 'lib-gt' }, `Компоненты (${allComponents().length})`),
        h('div', { class: 'comp-catalog' }, allComponents().map((c) => h('div', { class: 'cc-row', title: c.description || '' },
          h('span', { class: 'lt-i sm' }, c.icon || '▪'), h('span', { class: 'grow' }, c.name || c.type),
          c.extends ? h('small', { class: 'muted' }, '← ' + (c.parent?.name || c.extends)) : h('small', { class: 'muted mono' }, c.type)))),
        h('div', { class: 'lib-tip' }, 'Компоненты загружаются из папки components/. Свой компонент: создайте файл, добавьте его в components/manifest.js. Через extends можно взять логику готового компонента и дописать свою (пример — header.js).')),
      h('div', { class: 'lib-group' }, h('div', { class: 'lib-gt' }, 'Вставить шаблон'),
        h('div', { class: 'lib-list' }, TEMPLATES.map((t) => h('button', {
          class: 'lib-row', draggable: 'true', onClick: () => insertTemplate(t),
          onDragstart: (e) => e.dataTransfer.setData('application/x-gdb', JSON.stringify({ template: t.id })),
        }, h('span', { class: 'lt-i' }, t.icon), h('span', {}, t.name))))),
      h('div', { class: 'lib-tip' }, '💡 PNG, брошенный на пустое место, станет изображением; брошенный на карточку — заполнит её «Картинку» или «Спрайт».')));
}
function setupLibraryDrop() {
  $('#viewport').addEventListener('gdb-library-drop', (e) => {
    const { type, data, template, tool, pt } = e.detail;
    if (template) { const t = TEMPLATES.find((x) => x.id === template); if (t) insertTemplate(t, pt); return; }
    if (tool) { createTool(tool, pt); return; }
    createItem(type, pt, data || {});
  });
  $('#viewport').addEventListener('gdb-import-file', (e) => importBoardFromFile(e.detail));
}

// ---------- обзор проекта ----------
let ovTab = 'progress';
function toggleOverview(force) {
  const ov = $('#overview');
  const show = typeof force === 'boolean' ? force : ov.classList.contains('hidden');
  ov.classList.toggle('hidden', !show);
  $('#btn-overview').classList.toggle('on', show);
  if (show) renderOverview();
}
const refreshOverview = debounce(() => { if (!$('#overview').classList.contains('hidden') && !$('#overview').contains(document.activeElement)) renderOverview(); }, 350);

function bar(parts, total) {
  return h('div', { class: 'sbar' }, parts.filter((p) => p.v > 0).map((p) => h('i', { style: { width: (p.v / total) * 100 + '%', background: p.c }, title: `${p.n}: ${p.v}` })));
}
function itemRow(it, extra) {
  const pg = pageOf(it) !== store.page ? pathOf(store.tree, pageOf(it)).join(' / ') : '';
  return h('button', { class: 'ov-row', onClick: () => focusItem(it.id), title: pg ? 'На фрейме «' + pg + '»' : null },
    h('span', { class: 'ov-i' }, it.type === 'card' ? (toolById(it.data.tool)?.icon || '▭') : WIDGETS[it.type]?.icon || '•'),
    h('span', { class: 'ov-t' }, titleOf(it), pg ? h('small', { class: 'ov-page' }, '📄 ' + pg) : null),
    extra ? h('span', { class: 'ov-x' }, extra) : null);
}
function renderOverview() {
  const ov = $('#overview');
  const items = Object.values(store.items);
  const tabs = [['progress', 'Прогресс'], ['entities', 'Сущности'], ['search', 'Поиск'], ['check', 'Проверка']];
  let body;
  const cards = items.filter((i) => i.type === 'card');
  if (ovTab === 'progress') {
    const tasks = cards.filter((c) => c.data.tool === 'task');
    const bugs = cards.filter((c) => c.data.tool === 'bug');
    const stOf = (t) => cardField(t, 'Статус');
    const isDone = (t) => DONE_RE.test(stOf(t)?.text || '');
    const pts = (t) => cardField(t, 'Story points')?.value || 0;
    const ptsAll = tasks.reduce((a, t) => a + pts(t), 0);
    const ptsDone = tasks.filter(isDone).reduce((a, t) => a + pts(t), 0);
    const pct = ptsAll ? Math.round((ptsDone / ptsAll) * 100) : tasks.length ? Math.round((tasks.filter(isDone).length / tasks.length) * 100) : 0;
    // статусы в порядке списка
    const stList = resolveList(tasks.map((t) => t.data.components.find((c) => (c.data.label || '') === 'Статус')?.data.list).find(Boolean));
    const byStatus = (stList?.items || []).map((o) => ({ n: o.text, c: o.color, v: tasks.filter((t) => stOf(t)?.text === o.text).length }));
    const unset = tasks.filter((t) => !stOf(t)).length;
    if (unset) byStatus.push({ n: 'не задан', c: '#475569', v: unset });
    const dirs = new Map();
    for (const t of tasks) { const d = cardField(t, 'Направление'); const k = d?.text || 'без направления'; const x = dirs.get(k) || { n: k, c: d?.color || '#475569', v: 0, d: 0 }; x.v++; if (isDone(t)) x.d++; dirs.set(k, x); }
    const bugDone = (b) => DONE_RE.test(cardField(b, 'Готовность')?.text || '');
    const prioRank = (b) => { const c = b.data.components.find((x) => x.data.label === 'Приоритет'); const l = resolveList(c?.data.list); const i = l?.items.findIndex((o) => o.id === c.data.value) ?? -1; return i < 0 ? 99 : i; };
    const openBugs = bugs.filter((b) => !bugDone(b)).sort((a, b) => prioRank(a) - prioRank(b));
    const people = {};
    tasks.filter((t) => !isDone(t)).forEach((t) => { const w = cardField(t, 'Исполнитель')?.text || 'не назначено'; (people[w] ??= { sp: 0, bugs: 0 }).sp += pts(t); });
    openBugs.forEach((b) => { const w = cardField(b, 'Кто решает')?.text || 'не назначено'; (people[w] ??= { sp: 0, bugs: 0 }).bugs++; });
    const maxP = Math.max(1, ...Object.values(people).map((x) => x.sp));
    body = tasks.length || bugs.length ? h('div', { class: 'ov-progress' },
      h('div', { class: 'ring', style: { '--p': pct } }, h('b', {}, pct + '%'), h('span', {}, 'готово')),
      h('div', { class: 'ov-kpis' },
        h('div', {}, h('b', {}, tasks.length), h('span', {}, 'задач')),
        h('div', {}, h('b', {}, `${ptsDone}/${ptsAll}`), h('span', {}, 'story points')),
        h('div', { class: openBugs.length ? 'bad' : '' }, h('b', {}, `${openBugs.length}/${bugs.length}`), h('span', {}, 'открытых багов'))),
      tasks.length ? [h('h4', {}, 'Задачи по статусам'), bar(byStatus, tasks.length),
        h('div', { class: 'legend-list' }, byStatus.map((x) => h('span', {}, h('i', { style: { background: x.c } }), `${x.n} ${x.v}`)))] : null,
      dirs.size ? h('h4', {}, 'По направлениям') : null,
      ...[...dirs.values()].map((x) => h('div', { class: 'ov-line' }, h('span', { class: 'tagdot', style: { background: x.c } }), h('span', { class: 'grow' }, x.n), h('span', { class: 'muted' }, `${x.d}/${x.v}`), h('div', { class: 'mini' }, h('i', { style: { width: (x.d / x.v) * 100 + '%', background: x.c } })))),
      openBugs.length ? h('h4', {}, 'Открытые баги') : null,
      ...openBugs.map((b) => itemRow(b, cardField(b, 'Приоритет')?.text || '')),
      Object.keys(people).length ? h('h4', {}, 'Нагрузка (SP задач · баги)') : null,
      ...Object.entries(people).sort((a, b) => b[1].sp - a[1].sp).map(([n, v]) => h('div', { class: 'ov-line' }, h('span', { class: 'grow' }, n), h('span', { class: 'muted' }, `${v.sp} SP${v.bugs ? ' · 🐞' + v.bugs : ''}`), h('div', { class: 'mini' }, h('i', { style: { width: (v.sp / maxP) * 100 + '%', background: '#7c5cff' } })))))
      : h('div', { class: 'ov-empty' }, 'На доске пока нет задач и багов. Добавьте инструменты «Задача» или «Баг», либо вставьте шаблон «Спринт / Канбан».');
  } else if (ovTab === 'entities') {
    const groups = [];
    for (const t of TOOLS) {
      const list = t.standalone ? items.filter((i) => i.type === t.standalone) : cards.filter((c) => (c.data.tool || 'empty') === t.id);
      if (list.length) groups.push([t.id === 'empty' ? 'Свои карточки' : t.name, list]);
    }
    const frames = items.filter((i) => i.type === 'frame');
    if (frames.length) groups.push(['Области', frames]);
    body = groups.length
      ? h('div', {}, groups.map(([n, list]) => h('div', { class: 'ov-group' }, h('h4', {}, `${n} `, h('span', { class: 'muted' }, list.length)), list.map((i) => itemRow(i)))))
      : h('div', { class: 'ov-empty' }, 'Здесь появятся карточки, реплики и области со всех фреймов доски.');
  } else if (ovTab === 'search') {
    const inp = h('input', { class: 'input', placeholder: 'Найти на доске…', value: ov._q || '' });
    const res = h('div', { class: 'ov-results' });
    const run = () => {
      ov._q = inp.value;
      const q = inp.value.trim().toLowerCase();
      res.replaceChildren(...(q ? items.filter((i) => textOf(i).toLowerCase().includes(q)).slice(0, 80).map((i) => itemRow(i)) : []));
      if (q && !res.children.length) res.append(h('div', { class: 'ov-empty' }, 'Ничего не найдено'));
    };
    inp.oninput = run;
    inp.onkeydown = (e) => { if (e.key === 'Enter') res.querySelector('.ov-row')?.click(); };
    run();
    body = h('div', {}, inp, res);
    setTimeout(() => inp.focus(), 30);
  } else {
    const issues = [...lintDialogues(), ...lintFormat()];
    const names = {};
    for (const c of cards) {
      for (const cp of c.data.components || []) {
        const d = cp.data;
        const def = getComponent(cp.type);
        if (!def) { issues.push({ id: c.id, msg: `Компонент «${cp.type}» не найден в папке components` }); continue; }
        if (cp.type === 'dropdown') {
          if (!d.list) issues.push({ id: c.id, msg: `Выпадающий список «${d.label}» не привязан к списку` });
          else if (!resolveList(d.list)) issues.push({ id: c.id, msg: `Выпадающий список «${d.label}»: карточка-список удалена` });
        }
        if (cp.type === 'button' && (!d.target || (!store.item(d.target) && !store.tree[d.target]))) issues.push({ id: c.id, msg: `Кнопка «${d.label}» никуда не ведёт` });
        if (cp.type === 'list' && !(d.items || []).length) issues.push({ id: c.id, msg: 'Пустой список вариантов' });
        if (cp.type === 'loottable' && !(d.rows || []).some((r) => +r.w > 0)) issues.push({ id: c.id, msg: 'Таблица лута: сумма весов равна нулю' });
        if (cp.type === 'quest' && !(d.objectives || []).length) issues.push({ id: c.id, msg: 'У квеста нет целей' });
        if (cp.type === 'curve') for (const sr of parseSeries(d.formula)) if (sr.error) issues.push({ id: c.id, msg: `Ошибка в формуле «${sr.name}»: ${sr.error}` });
        if (cp.type === 'character' || cp.type === 'item') { const k = cp.type + ':' + (d.name || '').trim().toLowerCase(); (names[k] ??= []).push([c, d.name]); }
      }
    }
    for (const list of Object.values(names)) if (list.length > 1) list.forEach(([c, n]) => issues.push({ id: c.id, msg: 'Повторяющееся имя: ' + n }));
    body = issues.length
      ? h('div', {}, h('p', { class: 'muted small' }, `Найдено проблем: ${issues.length}. Клик — перейти к элементу.`), issues.filter((x) => x.msg).map((x) => { const it = store.item(x.id); return it ? h('button', { class: 'ov-row issue', onClick: () => focusItem(x.id) }, h('span', { class: 'ov-i' }, '⚠'), h('span', { class: 'ov-t' }, h('b', {}, x.msg), h('br'), h('small', { class: 'muted' }, titleOf(it)))) : null; }))
      : h('div', { class: 'ov-empty ok' }, '✓ Проблем не найдено: диалоги связаны, списки и кнопки настроены, формулы без ошибок.');
  }
  ov.replaceChildren(
    h('div', { class: 'drawer-head' }, h('b', {}, 'Обзор проекта'), h('button', { class: 'icon-btn', onClick: () => toggleOverview(false) }, '✕')),
    h('div', { class: 'tabs' }, tabs.map(([k, n]) => h('button', { class: 'tab' + (ovTab === k ? ' on' : ''), onClick: () => { ovTab = k; renderOverview(); } }, n))),
    h('div', { class: 'drawer-body scroll' }, body));
}

// ---------- совместная работа ----------
function renderPresence(users) {
  const p = $('#presence');
  const list = collab.active ? users : [];
  p.replaceChildren(...list.slice(0, 6).map((u) => h('span', { class: 'avatar-dot' + (u.id === me.id ? ' me' : ''), style: { background: u.color }, title: u.name + (u.id === me.id ? ' (вы)' : '') }, (u.name || '?')[0].toUpperCase())),
    ...(list.length > 6 ? [h('span', { class: 'avatar-dot more' }, '+' + (list.length - 6))] : []));
  const b = $('#btn-collab');
  b.classList.toggle('live', collab.active && collab.status === 'online');
  b.classList.toggle('wait', collab.active && collab.status !== 'online');
  b.title = !collab.active ? 'Совместный доступ' : collab.status === 'online' ? 'Совместный доступ: подключено' : 'Совместный доступ: подключение…';
}
let collabRefresh = null;
function collabDialog() {
  const nameInp = h('input', { class: 'input', value: me.name, maxlength: 24 });
  nameInp.onchange = () => { setMyName(nameInp.value.trim()); renderPresence([...collab.users.values()]); };
  const content = h('div', { class: 'collab' });
  const brokerBox = () => {
    const st = brokerSettings();
    const sel = h('select', { class: 'input' },
      h('option', { value: 'auto', selected: st.id !== 'custom' }, 'Все публичные серверы сразу (рекомендуется)'),
      h('option', { value: 'custom', selected: st.id === 'custom' }, 'Свой брокер (wss://…)'));
    const url = h('input', { class: 'input mono', placeholder: 'wss://xxxx.s1.eu.hivemq.cloud:8884/mqtt', value: st.url || '' });
    const user = h('input', { class: 'input', placeholder: 'логин (если нужен)', value: st.username || '' });
    const pass = h('input', { class: 'input', type: 'password', placeholder: 'пароль', value: st.password || '' });
    const custom = h('div', { class: 'custom-broker' + (st.id === 'custom' ? '' : ' hidden') }, url, h('div', { class: 'row gap tight' }, user, pass));
    const save = () => saveBrokerSettings({ id: sel.value, url: url.value.trim(), username: user.value.trim(), password: pass.value });
    sel.onchange = () => { custom.classList.toggle('hidden', sel.value !== 'custom'); save(); };
    url.onchange = user.onchange = pass.onchange = save;
    return h('details', { class: 'broker-box' }, h('summary', {}, 'Сервер синхронизации: ' + (st.id === 'custom' ? 'свой' : 'все публичные')),
      h('p', { class: 'muted small' }, `Доска подключается сразу к ${Object.keys(BROKERS).length} бесплатным серверам (${Object.values(BROKERS).map((b) => b.name.split(' ')[0]).join(', ')}). Если какой-то заблокирован у провайдера, работают остальные — VPN не нужен. Можно указать свой сервер (например, бесплатный HiveMQ Cloud); логин и пароль в ссылку не попадают.`),
      sel, custom);
  };
  const refresh = () => {
    if (!content.isConnected && collabRefresh === refresh) collabRefresh = null;
    const b = store.board;
    content.replaceChildren(h('label', { class: 'kv-row' }, 'Ваше имя', nameInp));
    if (!collab.active) {
      content.append(
        h('p', {}, 'Откройте доступ к этой доске по ссылке. Все, у кого есть ссылка, видят доску, курсоры и правки друг друга в реальном времени.'),
        h('ul', { class: 'tips' },
          collab.own ? h('li', {}, 'Доски хранятся на вашем сервере и открываются по ссылке в любое время.') : h('li', {}, 'Работает прямо на GitHub Pages — свой сервер не нужен. Используется несколько серверов сразу, поэтому VPN не нужен.'),
          h('li', {}, 'Между участниками устанавливается прямое соединение — правки и курсоры появляются мгновенно.'),
          h('li', {}, 'Доска хранится в «комнате» на сервере синхронизации: открыть ссылку можно в любое время, даже если вы офлайн.'),
          h('li', {}, 'Содержимое шифруется ключом из ссылки (AES-256). Сервер видит только зашифрованные данные.')),
        collab.own ? h('p', { class: 'muted small' }, `Синхронизация идёт через ваш сервер ${collab.own.name} — VPN не нужен.`) : brokerBox(),
        h('div', { class: 'row gap' }, h('button', { class: 'btn primary', onClick: async (e) => {
          e.target.disabled = true; e.target.textContent = 'Подключение…';
          try { await shareBoard(); } catch (err) { toast('Не удалось открыть доступ: ' + err.message, 'err'); }
          refresh();
        } }, b?.room ? 'Подключиться снова' : '🔓 Открыть совместный доступ')));
    } else {
      const url = roomLink(collab.room);
      const inp = h('input', { class: 'input mono', value: url, readonly: true });
      const st = collab.status === 'online' ? (collab.synced ? '🟢 Подключено, доска синхронизирована' : '🟢 Подключено, загружаем доску…') : collab.status === 'connecting' ? '🟡 Подключение…' : collab.direct ? '🟡 Серверы недоступны — правки идут напрямую между участниками' : '🟠 Связь потеряна, переподключаемся…';
      content.append(
        h('p', { class: 'collab-status' }, st, collab.error ? h('span', { class: 'muted small' }, ' · ' + collab.error) : null),
        h('div', { class: 'links-state' },
          collab.links.map((l) => h('span', { class: 'link-st ' + l.status, title: l.err || '' },
            h('i'), l.name.split(' ')[0], l.status === 'online' ? h('small', {}, (l.rtt ?? '?') + ' мс') : l.status === 'error' ? h('small', {}, 'недоступен') : h('small', {}, '…'))),
          h('span', { class: 'link-st ' + (collab.direct ? 'online' : 'idle'), title: 'Прямое соединение браузер↔браузер (WebRTC): правки идут без сервера' },
            h('i'), '⚡ Напрямую', h('small', {}, collab.direct ? `${collab.direct} уч.` : collab.users.size > 1 ? 'устанавливается…' : 'нет участников')),
          collab.links.some((l) => l.status === 'error') ? h('button', { class: 'btn small', onClick: () => { redial(); setTimeout(refresh, 300); } }, '↻ Проверить') : null),
        inp,
        h('div', { class: 'row gap' },
          h('button', { class: 'btn primary', onClick: () => { navigator.clipboard?.writeText(url); inp.select(); toast('Ссылка скопирована', 'ok'); } }, 'Скопировать ссылку'),
          h('button', { class: 'btn', title: 'Сохранить текущее состояние в комнате прямо сейчас', onClick: () => syncNow() }, '⟳ Сохранить'),
          h('button', { class: 'btn', title: 'Перестать синхронизировать эту доску (комната останется у других)', onClick: () => { leave(false, true); refresh(); } }, 'Отключить')),
        h('p', { class: 'warn small' }, 'Ссылка — это и адрес, и ключ: любой, у кого она есть, может редактировать доску.'),
        h('h4', {}, `Сейчас на доске: ${collab.users.size}`),
        h('div', { class: 'people' }, [...collab.users.values()].map((u) => h('span', { class: 'person' }, h('i', { style: { background: u.color } }), u.name + (u.id === me.id ? ' (вы)' : '')))));
    }
  };
  collabRefresh = refresh;
  refresh();
  modal('👥 Совместный доступ', content, { onClose: () => { collabRefresh = null; } });
}

// ---------- экспорт меню ----------
function setupTopbar() {
  const nameInp = $('#board-name');
  nameInp.addEventListener('change', () => { store.rename(nameInp.value.trim() || 'Без названия'); document.title = store.board.name + ' — GameDev Board'; });
  nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') nameInp.blur(); });
  store.on('rename', (n) => { if (document.activeElement !== nameInp) nameInp.value = n; });
  const menu = $('#export-menu');
  $('#btn-export').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu-wrap')) menu.classList.add('hidden'); });
  menu.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    menu.classList.add('hidden');
    if (act === 'gdd') { exportGDD(); toast('GDD сохранён в Markdown', 'ok'); }
    if (act === 'dialogs') exportDialoguesDialog();
    if (act === 'texts') exportTexts();
    if (act === 'engine') { exportEngine(); toast('Данные для движка сохранены', 'ok'); }
    if (act === 'file') exportBoardFile();
    if (act === 'import') importFile();
  };
  $('#btn-share').onclick = () => shareLink().catch((e) => toast('Ошибка: ' + e.message, 'err'));
  $('#btn-overview').onclick = () => toggleOverview();
  $('#btn-collab').onclick = collabDialog;
  const st = $('#save-state');
  store.on('saving', () => { st.textContent = 'Сохранение…'; st.className = 'save-state'; });
  store.on('saved', () => { st.textContent = '✓ Сохранено'; st.className = 'save-state ok'; });
  store.on('save-error', () => { st.textContent = '⚠ Не сохранено (мало места?)'; st.className = 'save-state err'; });
  // зум
  $('#z-in').onclick = () => zoomBy(1.25);
  $('#z-out').onclick = () => zoomBy(0.8);
  $('#z-val').onclick = () => setZoom(1);
  $('#z-fit').onclick = () => fitAll();
  $('#z-help').onclick = showHelp;
  onViewChange((v) => ($('#z-val').textContent = Math.round(v.z * 100) + '%'));
  const empty = $('#empty-hint');
  const upd = () => empty.classList.toggle('hidden', !store.board || store.pageItems().length > 0);
  store.on('change', () => { upd(); refreshOverview(); });
  store.on('load', upd);
  store.on('page', () => { upd(); refreshOverview(); });
}

function showHelp() {
  const rows = [
    ['V / H', 'Выделение / рука'], ['Пробел + тянуть, ПКМ, колесо', 'Перемещение по доске'], ['Колесо / Ctrl + колесо', 'Масштаб'],
    ['N, T, R, F', 'Стикер, текст, фигура, область'], ['B', 'Иерархия: разделы и фреймы'], ['Alt + ↑ / ↓', 'Предыдущий / следующий фрейм'], ['C', 'Связь: тянуть от элемента к элементу'], ['P / E', 'Карандаш / ластик'],
    ['Двойной клик', 'Редактировать текст'], ['⟶ у выделенного', 'Протянуть связь (в пустоту — создаст новый элемент)'],
    ['Ctrl+C / V / D', 'Копировать / вставить / дублировать'], ['Ctrl+Z / Ctrl+Shift+Z', 'Отменить / повторить'],
    ['Del', 'Удалить'], ['Стрелки (+Shift)', 'Сдвиг на 1 (10) px'], ['Shift+1 / Ctrl+0', 'Показать всё / 100%'], ['Shift при ресайзе', 'Сохранить пропорции'],
  ];
  modal('⌨ Горячие клавиши и приёмы', h('div', {},
    h('table', { class: 'keys' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))),
    h('h4', {}, 'Фишки для геймдева'),
    h('ul', { class: 'tips' },
      h('li', {}, 'Диалоги: связывайте реплики, подпись связи — вариант ответа. ▶ Играть — пройти как игрок.'),
      h('li', {}, 'Карточка = набор компонентов. «+ Компонент» внизу карточки, ⠿ — перетащить компонент, ⚙ — настроить, ↑↓ — порядок.'),
      h('li', {}, 'Выпадающий список берёт варианты из карточки «Список» (текст + цвет). Поменяли вариант в списке — обновились все карточки.'),
      h('li', {}, 'Иерархия слева (B): разделы и подразделы любой глубины, в них — фреймы. Фрейм — отдельная страница доски, на холсте только его элементы, поэтому большие проекты не тормозят.'),
      h('li', {}, 'Ссылка в тексте: напишите в стикере или тексте [[Имя фрейма]] — получится ссылка, клик открывает фрейм. Готовую ссылку даёт меню фрейма в иерархии.'),
      h('li', {}, 'Выделенное можно перенести на другой фрейм (📄 → на панели над выделением). Область — «📄 В отдельный фрейм».'),
      h('li', {}, 'Область можно сделать колонкой канбана (панель над областью): карточка, брошенная в неё, получит вариант с названием области, например «В работе».'),
      h('li', {}, 'Кнопка-ссылка: ⚙ рядом с кнопкой → выберите фрейм или объект; если объект на другом фрейме, кнопка откроет этот фрейм.'),
      h('li', {}, 'Уровень: левая кнопка рисует выбранным тайлом, правая стирает. Холст: слои перетаскиваются за ⠿.'),
      h('li', {}, 'Кривая баланса: каждая строка «Имя: формула» от lvl, например «Урон: 10 + lvl^1.3».'),
      h('li', {}, 'Экспорт → «Данные для движка» отдаёт JSON с персонажами, предметами, диалогами, уровнями и таблицами.'))), { wide: true });
}

// ======================= МАРШРУТЫ =======================
function showScreen(name) {
  home.classList.toggle('hidden', name !== 'home');
  editor.classList.toggle('hidden', name !== 'editor');
}
// удалить ресурсы (картинки, слои холста), на которые больше ничего не ссылается
function gcAssets(b) {
  const json = JSON.stringify(b.items);
  for (const id of Object.keys(b.assets || {})) if (!json.includes('"' + id + '"')) delete b.assets[id];
}
async function openBoard(id) {
  if (store.board?.id === id && !editor.classList.contains('hidden')) return;
  const b = store.board?.id === id ? store.board : await DB.get(id);
  if (!b) { toast('Доска не найдена', 'err'); location.hash = '#/'; return; }
  const needFit = !b.view;
  if (migrateItems(b.items)) { toast('Доска обновлена до карточек с компонентами', 'ok', 3500); }
  gcAssets(b);
  showScreen('editor');
  store.load(b);
  $('#board-name').value = b.name;
  document.title = b.name + ' — GameDev Board';
  $('#save-state').textContent = '';
  if (needFit) requestAnimationFrame(() => fitAll(false));
  if (b.room) connectRoom(b).catch((e) => toast('Совместный доступ: ' + e.message, 'err'));
  else if (collab.active) leave();
  if (!localStorage.getItem('gdb-seen-hint')) {
    try { localStorage.setItem('gdb-seen-hint', '1'); } catch {}
    setTimeout(() => toast('Совет: ＋ Инструменты слева — карточки с компонентами, диалоги, баги, карты. «?» внизу — горячие клавиши', 'info', 6000), 600);
  }
}
async function route() {
  const hsh = location.hash;
  let m;
  if ((m = hsh.match(/^#\/b\/([\w-]+)/))) return openBoard(m[1]);
  if ((m = hsh.match(/^#\/s\/(.+)$/))) {
    try {
      const b = await readShared(m[1]);
      await DB.put(b);
      toast('Открыта копия доски по ссылке', 'ok');
      location.replace('#/b/' + b.id);
    } catch (e) { console.error(e); toast('Ссылка повреждена', 'err'); location.hash = '#/'; }
    return;
  }
  if ((m = hsh.match(/^#\/room\/([\w.-]+)/))) {
    try {
      const room = parseRoom(m[1]);
      const all = await DB.all();
      let b = all.find((x) => x.room?.id === room.id);
      if (!b) {
        b = newBoard('Общая доска');
        b.id = 'r_' + room.id;
        b.room = room;
        await DB.put(b);
      }
      location.replace('#/b/' + b.id);
    } catch (e) { toast('Ссылка на общую доску повреждена', 'err'); location.hash = '#/'; }
    return;
  }
  if (collab.active) leave();
  await store.saveNow?.();
  store.board = null;
  showScreen('home');
  document.title = 'GameDev Board — доска для разработчиков игр';
  renderHome();
}

// ======================= СТАРТ =======================
const failed = await loadComponents();
if (failed.length) setTimeout(() => toast('Не загрузились компоненты: ' + failed.join(', '), 'err', 6000), 800);
initCanvas();
initHierarchy();
buildToolbar();
buildLibrary();
setupLibraryDrop();
setupTopbar();
trackCursor($('#viewport'));
onPresence((u) => { renderPresence(u); collabRefresh?.(); });
onState(() => { renderPresence([...collab.users.values()]); collabRefresh?.(); });
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => { store.saveNow?.(); });
route();
