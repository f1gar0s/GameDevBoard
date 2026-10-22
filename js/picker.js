// Окно выбора цели ссылки: дерево «раздел → фрейм → объекты фрейма» с поиском.
// Объекты показаны дочерними элементами своего фрейма, поэтому в большом проекте легко найти нужное.
import { h } from './util.js';
import { store, childrenOf, pageOf } from './store.js';

let el = null, opts = null;
const openFrames = new Set();
const ICON = { card: '▭', frame: '▢', text: 'T', sticky: '🗒', shape: '◆', dialogue: '💬', linkbtn: '🔘', image: '🖼', video: '▶', draw: '✎' };
let toolIcon = () => null;
export const setToolIcon = (fn) => { toolIcon = fn; };

const clean = (s) => String(s || '').replace(/\[\[([^\[\]\n|]+)(?:\|[^\[\]\n|]+)?\]\]/g, '$1').replace(/\s+/g, ' ').trim();
export function objectLabel(it) {
  const d = it.data || {};
  if (it.name) return '🏷 ' + it.name;
  if (it.type === 'image') return clean(d.name) || '';
  if (it.type === 'video') return clean(d.title) || '';
  if (it.type === 'draw') return '';
  if (it.type === 'card') return clean(d.title) || 'Карточка';
  if (it.type === 'frame') return clean(d.title) || 'Область';
  if (it.type === 'linkbtn') return '🔘 ' + (clean(d.label) || 'Кнопка');
  if (it.type === 'dialogue') return (d.speaker ? d.speaker + ': ' : '') + (clean(d.text).slice(0, 50) || 'реплика');
  return clean(d.text).slice(0, 50);
}
function objectsOf(page) {
  return Object.values(store.items)
    .filter((it) => pageOf(it) === page && ICON[it.type] && objectLabel(it))
    .sort((a, b) => (a.type === 'frame' ? 0 : 1) - (b.type === 'frame' ? 0 : 1) || a.y - b.y || a.x - b.x);
}

export const pickerOpen = () => !!el;
export function closePicker(picked = false) {
  if (!el) return;
  el.remove(); el = null;
  document.removeEventListener('pointerdown', outside, true);
  const o = opts; opts = null;
  if (!picked) o?.onClose?.();
}
function outside(e) { if (el && !el.contains(e.target)) closePicker(); }

// openPicker({ x, y, current, title, onPick(targetId), onClose() })
export function openPicker(o) {
  closePicker();
  opts = o;
  openFrames.clear();
  openFrames.add(store.page);
  if (o.current) { const it = store.item(o.current); if (it) openFrames.add(pageOf(it)); }
  const search = h('input', { class: 'input pk-search', placeholder: 'Найти фрейм или объект…' });
  const list = h('div', { class: 'pk-list scroll' });
  el = h('div', { class: 'picker' },
    h('div', { class: 'pk-head' }, h('b', {}, o.title || 'Выберите цель'), h('button', { class: 'icon-btn', onClick: () => closePicker() }, '✕')),
    search, list,
    h('div', { class: 'pk-foot muted small' }, 'Клик по фрейму — ссылка на фрейм · ▸ — показать объекты внутри'));
  el.addEventListener('keydown', (e) => e.stopPropagation());
  const pick = (id) => { const cb = opts?.onPick; closePicker(true); cb?.(id); };
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const has = (s) => !q || s.toLowerCase().includes(q);
    const walk = (parent, depth) => {
      const rows = [];
      for (const n of childrenOf(store.tree, parent)) {
        if (n.kind === 'section') {
          const kids = walk(n.id, depth + 1);
          if (kids.length || (q && has(n.name)) || !q) {
            rows.push(h('div', { class: 'pk-row section', style: { '--d': depth } }, h('span', { class: 'pk-caret' }), '📁 ', h('span', { class: 'pk-name' }, n.name)), ...kids);
          }
          continue;
        }
        const objs = objectsOf(n.id);
        const hitObjs = q && !has(n.name) ? objs.filter((it) => has(objectLabel(it))) : objs;
        if (q && !has(n.name) && !hitObjs.length) continue;
        const open = q ? hitObjs.length > 0 && !has(n.name) || openFrames.has(n.id) : openFrames.has(n.id);
        rows.push(h('div', { class: 'pk-row frame' + (o.current === n.id ? ' current' : '') + (n.id === store.page ? ' here' : ''), style: { '--d': depth } },
          h('button', { class: 'pk-caret', title: objs.length ? 'Объекты фрейма' : '', disabled: !objs.length, onClick: () => { openFrames.has(n.id) ? openFrames.delete(n.id) : openFrames.add(n.id); render(); } }, objs.length ? (open ? '▾' : '▸') : ''),
          h('button', { class: 'pk-pick', onClick: () => pick(n.id) }, '📄 ', h('span', { class: 'pk-name' }, n.name), objs.length ? h('small', { class: 'muted' }, ' ' + objs.length) : null)));
        if (open) for (const it of hitObjs) {
          rows.push(h('div', { class: 'pk-row obj' + (o.current === it.id ? ' current' : ''), style: { '--d': depth + 1 } },
            h('span', { class: 'pk-caret' }),
            h('button', { class: 'pk-pick', onClick: () => pick(it.id) }, (it.type === 'card' && toolIcon(it)) || ICON[it.type], ' ', h('span', { class: 'pk-name' }, objectLabel(it)))));
        }
      }
      return rows;
    };
    const rows = walk(null, 0);
    list.replaceChildren(...(rows.length ? rows : [h('div', { class: 'pk-empty muted' }, 'Ничего не найдено')]));
  };
  search.oninput = render;
  search.onkeydown = (e) => {
    if (e.key === 'Escape') closePicker();
    if (e.key === 'Enter') list.querySelector('.pk-pick')?.click();
  };
  render();
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(o.x, innerWidth - r.width - 8)) + 'px';
  el.style.top = Math.max(8, o.y + r.height > innerHeight - 8 ? o.y - r.height - 40 : o.y) + 'px';
  setTimeout(() => { search.focus(); document.addEventListener('pointerdown', outside, true); }, 0);
}
