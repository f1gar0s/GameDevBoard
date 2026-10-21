// Иерархия доски (как Hierarchy в Unity): разделы → подразделы → фреймы.
// Фрейм — отдельная страница доски со своими элементами; открыт всегда один фрейм,
// поэтому большие проекты не тормозят: на холсте только то, что лежит в открытом фрейме.
import { store, childrenOf, framesInOrder, pathOf, descendantsOf, pageOf, MAIN_PAGE } from './store.js';
import { h, uid, toast, modal, isTyping, debounce } from './util.js';
import { openPage } from './canvas.js';
import { collab, onPresence, me } from './collab.js';

const $ = (q) => document.querySelector(q);
let panel, listEl, filterEl;
let selected = null;       // выбранный раздел (куда добавлять новое)
let renaming = null;       // id узла, который сейчас переименовывают
let dragId = null;
let filter = '';

const LS = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } };
const collapsedKey = () => 'gdb-tree-collapsed-' + (store.board?.id || '');
let collapsed = new Set();

// ---------- операции с деревом ----------
function nextOrder(parent) {
  return Math.max(0, ...childrenOf(store.tree, parent).map((n) => n.order ?? 0)) + 1;
}
export function addNode(kind, parent = null, name) {
  const node = { id: uid(kind === 'frame' ? 'p' : 's'), kind, name: name || (kind === 'frame' ? 'Новый фрейм' : 'Новый раздел'), parent: parent || null, order: nextOrder(parent) };
  store.checkpoint();
  store.setNode(node);
  if (parent) { collapsed.delete(parent); saveCollapsed(); }
  if (kind === 'frame') openPage(node.id);
  else selected = node.id;
  renaming = node.id;
  render();
  return node;
}
function rename(id, name) {
  const n = store.tree[id];
  name = (name || '').trim();
  if (!n || !name || name === n.name) return;
  store.checkpoint();
  store.setNode({ ...n, name });
}
function move(id, parent, order) {
  const n = store.tree[id];
  if (!n) return;
  if (parent && (parent === id || descendantsOf(store.tree, id).some((d) => d.id === parent))) return; // нельзя в самого себя
  store.checkpoint();
  store.setNode({ ...n, parent: parent || null, order });
}
function itemsOfFrames(ids) {
  const set = new Set(ids);
  return Object.values(store.items).filter((it) => set.has(pageOf(it)));
}
function removeNode(id) {
  const n = store.tree[id];
  if (!n) return;
  const nodes = [n, ...descendantsOf(store.tree, id)];
  const frames = nodes.filter((x) => x.kind === 'frame');
  const items = itemsOfFrames(frames.map((f) => f.id));
  const allFrames = Object.values(store.tree).filter((x) => x.kind === 'frame');
  const doIt = () => {
    store.checkpoint();
    for (const it of items) store.remove(it.id);
    // если удаляем все фреймы — оставим один пустой
    if (frames.length && frames.length === allFrames.length) {
      store.setNode({ id: uid('p'), kind: 'frame', name: 'Новый фрейм', parent: null, order: nextOrder(null) });
    }
    for (const x of nodes.reverse()) store.removeNode(x.id);
    if (!store.tree[store.page]) openPage(framesInOrder(store.tree)[0]?.id);
    if (selected && !store.tree[selected]) selected = null;
    render();
  };
  const what = n.kind === 'frame' ? `фрейм «${n.name}»` : `раздел «${n.name}»`;
  const details = [
    n.kind === 'section' && frames.length ? `фреймов внутри: ${frames.length}` : null,
    items.length ? `элементов на доске: ${items.length}` : null,
  ].filter(Boolean).join(', ');
  if (!items.length && !frames.length) { doIt(); return; }
  modal('Удалить ' + what + '?', h('div', {},
    h('p', {}, `Будет удалено: ${details}.`),
    h('p', { class: 'muted small' }, 'Отменить можно через Ctrl+Z.')), {
    actions: [{ label: 'Отмена' }, { label: 'Удалить', primary: true, onClick: doIt }],
  });
}
function linkText(id) { return '[[' + pathOf(store.tree, id).join('/') + ']]'; }

// ---------- меню ----------
let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; }
function openMenu(id, x, y) {
  closeMenu();
  const n = store.tree[id];
  if (!n) return;
  const item = (label, fn, cls = '') => h('button', { class: cls, onClick: () => { closeMenu(); fn(); } }, label);
  menuEl = h('div', { class: 'menu tree-menu', style: { left: x + 'px', top: y + 'px' } },
    n.kind === 'frame' ? item('📂 Открыть', () => openPage(id)) : null,
    item('✎ Переименовать', () => { renaming = id; render(); }),
    n.kind === 'section' ? item('📁 Добавить подраздел', () => addNode('section', id)) : null,
    n.kind === 'section' ? item('📄 Добавить фрейм', () => addNode('frame', id)) : null,
    n.kind === 'frame' ? item('🔗 Копировать ссылку для текста', () => { navigator.clipboard?.writeText(linkText(id)); toast('Скопировано: ' + linkText(id) + ' — вставьте в стикер или текст', 'ok', 3000); }) : null,
    n.parent ? item('⤴ Вынести на уровень выше', () => { const p = store.tree[n.parent]; move(id, p?.parent || null, (p?.order ?? 0) + 0.5); }) : null,
    item('🗑 Удалить', () => removeNode(id), 'danger'));
  document.body.append(menuEl);
  const r = menuEl.getBoundingClientRect();
  if (r.bottom > innerHeight - 8) menuEl.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
  if (r.right > innerWidth - 8) menuEl.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
}
document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);

// ---------- отрисовка ----------
function counts() {
  const c = {};
  for (const it of Object.values(store.items)) { const p = pageOf(it); c[p] = (c[p] || 0) + 1; }
  return c;
}
function peopleOn() {
  const out = {};
  if (!collab.active) return out;
  for (const u of collab.users.values()) {
    if (u.id === me.id) continue;
    if (u.page) (out[u.page] ??= []).push(u);
  }
  return out;
}
function matches(n) {
  if (!filter) return true;
  const q = filter.toLowerCase();
  if (n.name.toLowerCase().includes(q)) return true;
  return descendantsOf(store.tree, n.id).some((d) => d.name.toLowerCase().includes(q));
}
function rowFor(n, depth, cnt, people) {
  const isFrame = n.kind === 'frame';
  const kids = isFrame ? [] : childrenOf(store.tree, n.id);
  const open = filter ? true : !collapsed.has(n.id);
  const active = isFrame && n.id === store.page;
  const nameEl = renaming === n.id
    ? (() => {
      const inp = h('input', { class: 'tree-rename', value: n.name, maxlength: 80 });
      let done = false;
      const finish = (save) => { if (done) return; done = true; if (save) rename(n.id, inp.value); renaming = null; render(); };
      inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
      inp.onblur = () => finish(true);
      inp.onpointerdown = (e) => e.stopPropagation();
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
      return inp;
    })()
    : h('span', { class: 'tree-name', title: pathOf(store.tree, n.id).join(' / ') }, n.name);
  const framesInside = isFrame ? 0 : descendantsOf(store.tree, n.id).filter((d) => d.kind === 'frame').length;
  const row = h('div', {
    class: 'tree-row' + (isFrame ? ' frame' : ' section') + (active ? ' active' : '') + (selected === n.id ? ' selected' : ''),
    style: { '--d': depth }, draggable: renaming === n.id ? null : 'true', 'data-id': n.id, tabindex: '0',
    onClick: (e) => {
      if (e.target.closest('.tree-act, .tree-rename')) return;
      if (isFrame) { selected = n.parent || null; openPage(n.id); }
      else if (e.target.closest('.tree-caret') || selected === n.id) toggle(n.id);
      else { selected = n.id; render(); }
    },
    onDblclick: (e) => { if (!e.target.closest('.tree-act')) { renaming = n.id; render(); } },
    onContextmenu: (e) => { e.preventDefault(); openMenu(n.id, e.clientX, e.clientY); },
    onKeydown: (e) => {
      if (renaming) return;
      if (e.key === 'F2') { e.preventDefault(); renaming = n.id; render(); }
      if (e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); removeNode(n.id); }
      if (e.key === 'Enter') { e.preventDefault(); isFrame ? openPage(n.id) : toggle(n.id); }
    },
  },
  h('span', { class: 'tree-caret' }, isFrame ? '' : open ? '▾' : '▸'),
  h('span', { class: 'tree-icon' }, isFrame ? '📄' : open ? '📂' : '📁'),
  nameEl,
  people[n.id]?.length ? h('span', { class: 'tree-people' }, people[n.id].slice(0, 4).map((u) => h('i', { style: { background: u.color }, title: u.name }))) : null,
  h('span', { class: 'tree-count muted' }, isFrame ? (cnt[n.id] || '') : framesInside || ''),
  !isFrame ? h('button', { class: 'tree-act', title: 'Добавить фрейм в раздел', onClick: () => addNode('frame', n.id) }, '+') : null,
  h('button', { class: 'tree-act', title: 'Действия', onClick: (e) => { const r = e.currentTarget.getBoundingClientRect(); openMenu(n.id, r.right - 4, r.bottom + 2); } }, '⋯'));
  // перетаскивание: выше / ниже / внутрь раздела
  row.addEventListener('dragstart', (e) => { dragId = n.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.name); row.classList.add('dragging'); });
  row.addEventListener('dragend', () => { dragId = null; row.classList.remove('dragging'); clearDrop(); });
  row.addEventListener('dragover', (e) => {
    if (!dragId || dragId === n.id) return;
    e.preventDefault();
    const r = row.getBoundingClientRect();
    const k = (e.clientY - r.top) / r.height;
    const zone = !isFrame && k > 0.25 && k < 0.75 ? 'inside' : k < 0.5 ? 'before' : 'after';
    clearDrop();
    row.classList.add('drop-' + zone);
    row.dataset.zone = zone;
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after', 'drop-inside'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const zone = row.dataset.zone;
    clearDrop();
    if (!dragId || dragId === n.id) return;
    if (zone === 'inside') { move(dragId, n.id, nextOrder(n.id)); collapsed.delete(n.id); saveCollapsed(); }
    else {
      const sibs = childrenOf(store.tree, n.parent).filter((x) => x.id !== dragId);
      const i = sibs.findIndex((x) => x.id === n.id);
      const o = n.order ?? 0;
      const other = zone === 'before' ? sibs[i - 1] : sibs[i + 1];
      const order = other ? (o + (other.order ?? 0)) / 2 : zone === 'before' ? o - 1 : o + 1;
      move(dragId, n.parent || null, order);
    }
    render();
  });
  const out = [row];
  if (!isFrame && open) {
    for (const k of kids) if (matches(k)) out.push(...rowFor(k, depth + 1, cnt, people));
    if (!kids.length && !filter) out.push(h('div', { class: 'tree-empty muted', style: { '--d': depth + 1 } }, 'пусто — ', h('button', { class: 'linklike', onClick: () => addNode('frame', n.id) }, 'добавить фрейм')));
  }
  return out;
}
function clearDrop() { listEl?.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach((r) => r.classList.remove('drop-before', 'drop-after', 'drop-inside')); }
function toggle(id) { collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); saveCollapsed(); render(); }
function saveCollapsed() { LS(collapsedKey(), [...collapsed]); }

export function render() {
  if (!panel || !store.board) return;
  renderCrumbs();
  if (panel.classList.contains('closed')) return;
  // идёт переименование — не пересоздаём поле ввода (перерисуем после Enter)
  if (renaming && document.activeElement?.classList.contains('tree-rename') && listEl.contains(document.activeElement)) return;
  const cnt = counts();
  const people = peopleOn();
  const rows = childrenOf(store.tree, null).filter(matches).flatMap((n) => rowFor(n, 0, cnt, people));
  listEl.replaceChildren(...rows, h('div', { class: 'tree-rootdrop' }, filter && !rows.length ? 'Ничего не найдено' : ''));
  listEl.querySelector('.tree-row.active')?.scrollIntoView?.({ block: 'nearest' });
}
const renderSoon = debounce(render, 120);

// «Раздел › Подраздел › Фрейм» в верхней панели
function renderCrumbs() {
  const c = $('#crumbs');
  if (!c || !store.board) return;
  const path = pathOf(store.tree, store.page);
  const frames = framesInOrder(store.tree);
  const i = frames.findIndex((f) => f.id === store.page);
  c.replaceChildren(
    h('button', { class: 'crumb-nav', title: 'Предыдущий фрейм (Alt+↑)', disabled: i <= 0, onClick: () => step(-1) }, '‹'),
    h('button', { class: 'crumbs-path', title: 'Показать иерархию (B)', onClick: () => setOpen(true) },
      path.slice(0, -1).map((p) => [h('span', { class: 'muted' }, p), h('span', { class: 'crumb-sep' }, '›')]),
      h('b', {}, '📄 ' + (path[path.length - 1] || ''))),
    h('button', { class: 'crumb-nav', title: 'Следующий фрейм (Alt+↓)', disabled: i < 0 || i >= frames.length - 1, onClick: () => step(1) }, '›'));
}
function step(d) {
  const frames = framesInOrder(store.tree);
  const i = frames.findIndex((f) => f.id === store.page);
  const n = frames[i + d];
  if (n) openPage(n.id);
}

// ---------- панель ----------
export function setOpen(open) {
  if (!panel) return;
  panel.classList.toggle('closed', !open);
  document.getElementById('editor').classList.toggle('hier-open', open);
  $('#btn-hier')?.classList.toggle('on', open);
  LS('gdb-tree-open', open);
  render();
  window.dispatchEvent(new Event('resize'));
}
function setWidth(px) {
  const w = Math.round(Math.max(200, Math.min(px, innerWidth * 0.35)));
  document.getElementById('editor').style.setProperty('--tree-w', w + 'px');
  LS('gdb-tree-w', w);
}

export function initHierarchy() {
  panel = $('#hierarchy');
  filterEl = h('input', { class: 'input tree-filter', placeholder: 'Поиск фрейма…' });
  filterEl.oninput = () => { filter = filterEl.value.trim(); render(); };
  filterEl.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { const f = framesInOrder(store.tree).find((n) => n.name.toLowerCase().includes(filter.toLowerCase())); if (f) openPage(f.id); }
    if (e.key === 'Escape') { filterEl.value = ''; filter = ''; render(); filterEl.blur(); }
  };
  listEl = h('div', { class: 'tree-list scroll' });
  // бросить в пустое место списка — на верхний уровень, в конец
  listEl.addEventListener('dragover', (e) => { if (dragId && e.target === listEl || e.target.classList?.contains('tree-rootdrop')) e.preventDefault(); });
  listEl.addEventListener('drop', (e) => {
    if (!dragId || !(e.target === listEl || e.target.classList?.contains('tree-rootdrop'))) return;
    e.preventDefault();
    move(dragId, null, nextOrder(null));
    render();
  });
  const grip = h('div', { class: 'tree-grip', title: 'Потяните, чтобы изменить ширину' });
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const mv = (ev) => { setWidth(ev.clientX); window.dispatchEvent(new Event('resize')); };
    const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); };
    grip.addEventListener('pointermove', mv);
    grip.addEventListener('pointerup', up);
  });
  const addHere = (kind) => {
    const parent = selected && store.tree[selected]?.kind === 'section' ? selected : null;
    addNode(kind, parent);
  };
  panel.replaceChildren(
    h('div', { class: 'tree-head' },
      h('b', {}, 'Иерархия'),
      h('div', { class: 'grow' }),
      h('button', { class: 'icon-btn', title: 'Новый раздел (в выбранном разделе или на верхнем уровне)', onClick: () => addHere('section') }, '📁+'),
      h('button', { class: 'icon-btn', title: 'Новый фрейм (в выбранном разделе или на верхнем уровне)', onClick: () => addHere('frame') }, '📄+'),
      h('button', { class: 'icon-btn', title: 'Свернуть панель (B)', onClick: () => setOpen(false) }, '⟨')),
    filterEl,
    listEl,
    h('div', { class: 'tree-foot muted small' }, 'Клик — открыть фрейм · двойной клик — переименовать · перетаскивайте, чтобы сложить в раздел · ПКМ — меню'),
    grip);
  // кнопка в верхней панели
  const btn = h('button', { id: 'btn-hier', class: 'btn', title: 'Иерархия: разделы и фреймы (B)', onClick: () => setOpen(panel.classList.contains('closed')) }, '🗂 ', h('span', { class: 'hide-sm' }, 'Иерархия'));
  $('.topbar .logo-btn').after(btn);

  const w = LS('gdb-tree-w');
  setWidth(w || Math.max(220, innerWidth * 0.14));
  const wasOpen = LS('gdb-tree-open');
  setOpen(wasOpen === null ? innerWidth > 900 : wasOpen);

  store.on('load', () => { collapsed = new Set(LS(collapsedKey()) || []); selected = null; render(); });
  store.on('page', () => render());
  store.on('tree', renderSoon);
  store.on('treerm', renderSoon);
  store.on('change', renderSoon);
  onPresence(renderSoon);

  window.addEventListener('keydown', (e) => {
    if (!store.board || document.getElementById('editor').classList.contains('hidden') || isTyping()) return;
    if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setOpen(panel.classList.contains('closed')); }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); step(e.key === 'ArrowUp' ? -1 : 1); }
  });
}
export { MAIN_PAGE };
