// Текст с гиперссылками.
// В данных ссылка хранится прямо в тексте: [[подпись|id]] — id фрейма или объекта (переименование не ломает ссылку).
// Старый вид [[Имя фрейма]] тоже понимается. Кроме того, слово, совпадающее с названием фрейма
// (без учёта регистра), автоматически становится ссылкой на этот фрейм.
import { h } from './util.js';
import { store, pageOf, pathOf } from './store.js';
import { openPicker, closePicker, pickerOpen } from './picker.js';

export const LINK_RE = /\[\[([^\[\]\n|]{1,200})(?:\|([^\[\]\n|]{1,80}))?\]\]/g;
let goToFn = null;
export const setLinkHandler = (fn) => { goToFn = fn; };

// текст без разметки ссылок (для поиска, экспорта, заголовков)
export const plain = (s) => String(s ?? '').replace(LINK_RE, (_, a) => a);

// ---------- автоссылки по названиям фреймов ----------
let autoCache = { sig: null, re: null, map: null };
export function autoSig() {
  if (!store.board) return '';
  return Object.values(store.tree).filter((n) => n.kind === 'frame').map((n) => n.id + ':' + n.name).join('|');
}
function autoMatcher() {
  const sig = autoSig();
  if (autoCache.sig === sig) return autoCache;
  const map = new Map();
  for (const n of Object.values(store.tree || {})) {
    if (n.kind !== 'frame') continue;
    const k = n.name.trim().toLowerCase();
    if (k.length >= 2 && !map.has(k)) map.set(k, n.id);
  }
  const names = [...map.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  let re = null;
  try { re = names.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(${names.join('|')})(?![\\p{L}\\p{N}_])`, 'giu') : null; } catch { re = null; }
  autoCache = { sig, re, map };
  return autoCache;
}
function autoNodes(text, selfPage) {
  const { re, map } = autoMatcher();
  if (!re || !text) return [text];
  const out = [];
  let last = 0;
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const id = map.get(m[0].replace(/\s+/g, ' ').toLowerCase());
    if (!id || id === selfPage) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('a', { class: 'plink auto', href: '#', 'data-target': id, title: 'Фрейм «' + pathOf(store.tree, id).join(' / ') + '»' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---------- отрисовка и разбор ----------
function targetTitle(t) {
  const n = store.tree?.[t];
  if (n) return (n.kind === 'frame' ? 'Фрейм «' : 'Раздел «') + pathOf(store.tree, t).join(' / ') + '»';
  const it = store.item(t);
  if (it) return 'Объект «' + (plain(it.data.title || it.data.text || '').slice(0, 40) || it.type) + '» · ' + pathOf(store.tree, pageOf(it)).join(' / ');
  return 'Перейти: ' + t;
}
export function fill(el, text, { auto = true, selfPage = null } = {}) {
  text = String(text ?? '');
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    if (m.index > last) parts.push(...(auto ? autoNodes(text.slice(last, m.index), selfPage) : [text.slice(last, m.index)]));
    const label = m[1], target = (m[2] || m[1]).trim();
    const broken = !!m[2] && !store.tree?.[target] && !store.item(target);
    parts.push(h('a', { class: 'plink' + (broken ? ' broken' : ''), href: '#', 'data-target': target, title: broken ? 'Цель ссылки удалена' : targetTitle(target) }, label));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(...(auto ? autoNodes(text.slice(last), selfPage) : [text.slice(last)]));
  el.replaceChildren(...parts);
}
export function serialize(el) {
  let out = '';
  const walk = (node, top) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeName === 'BR') out += '\n';
      else if (n.nodeName === 'A' && n.dataset.target && !n.classList.contains('auto')) {
        const label = n.textContent.replace(/[\[\]|\n]/g, ' ').trim();
        out += label ? `[[${label}|${n.dataset.target}]]` : '';
      } else if (n.nodeType === 1) {
        const block = /^(DIV|P)$/.test(n.nodeName);
        if (block && out && !out.endsWith('\n')) out += '\n';
        walk(n, false);
      }
    }
  };
  walk(el, true);
  return out.replace(/ /g, ' ');
}

// ---------- редактирование ----------
let bar = null; // плавающая панель «🔗 Ссылка» над выделением
let barFor = null;
function hideBar() { bar?.remove(); bar = null; barFor = null; }
function linkAtSelection(el) {
  const s = getSelection();
  if (!s.rangeCount) return null;
  const a = (s.anchorNode?.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode)?.closest?.('a.plink');
  return a && el.contains(a) && !a.classList.contains('auto') ? a : null;
}
function updateBar(el, state) {
  const s = getSelection();
  if (!el.isContentEditable || !s.rangeCount || !el.contains(s.anchorNode)) { if (barFor === el) hideBar(); return; }
  const a = linkAtSelection(el);
  if (s.isCollapsed && !a) { if (barFor === el) hideBar(); return; }
  const r = (a && s.isCollapsed ? a : s.getRangeAt(0)).getBoundingClientRect();
  if (!bar) {
    bar = h('div', { class: 'rt-bar' });
    bar.addEventListener('pointerdown', (e) => e.preventDefault()); // не терять выделение в тексте
    document.body.append(bar);
  }
  barFor = el;
  bar.replaceChildren(
    h('button', { title: a ? 'Изменить ссылку (Ctrl+K)' : 'Сделать ссылкой на фрейм или объект (Ctrl+K)', onClick: () => askLink(el, state) }, a ? '🔗 Изменить' : '🔗 Ссылка'),
    a ? h('button', { title: 'Убрать ссылку', onClick: () => { unlink(a); state.changed(); updateBar(el, state); } }, '✕') : null);
  bar.style.left = Math.max(8, r.left + r.width / 2 - bar.offsetWidth / 2) + 'px';
  bar.style.top = Math.max(8, r.top - bar.offsetHeight - 8) + 'px';
}
function unlink(a) { a.replaceWith(document.createTextNode(a.textContent)); }
function askLink(el, state) {
  const s = getSelection();
  if (!s.rangeCount) return;
  const existing = linkAtSelection(el);
  const range = existing && s.isCollapsed ? (() => { const r = document.createRange(); r.selectNode(existing); return r; })() : s.getRangeAt(0).cloneRange();
  if (range.collapsed) return;
  const rect = range.getBoundingClientRect();
  state.picking = true;
  hideBar();
  openPicker({
    x: rect.left, y: rect.bottom + 6,
    current: existing?.dataset.target,
    title: 'Ссылка на…',
    onPick: (target) => {
      state.picking = false;
      el.focus();
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      if (existing) existing.dataset.target = target;
      else {
        const text = range.toString();
        range.deleteContents();
        const a = h('a', { class: 'plink', href: '#', 'data-target': target, title: targetTitle(target) }, text);
        range.insertNode(a);
        sel.removeAllRanges();
        const after = document.createRange(); after.setStartAfter(a); after.collapse(true); sel.addRange(after);
      }
      state.changed();
    },
    onClose: () => { if (state.picking) { state.picking = false; el.focus(); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); } },
  });
}
document.addEventListener('selectionchange', () => {
  const el = document.activeElement?.closest?.('.rt');
  if (el?._rt) updateBar(el, el._rt);
  else if (bar && !pickerOpen()) hideBar();
});

// Редактируемый текст со ссылками.
// opts: value(), onBegin(), onLive(text), onCommit(text), placeholder, multiline, cls, selfPage(), selectAll
export function richText(opts) {
  const el = h('div', { class: 'editable rt ' + (opts.cls || ''), 'data-placeholder': opts.placeholder || '' });
  const selfPage = () => opts.selfPage?.() ?? null;
  const render = () => fill(el, opts.value() || '', { auto: opts.auto !== false, selfPage: selfPage() });
  render();
  const state = {
    picking: false,
    changed: () => opts.onLive?.(serialize(el)),
  };
  el._rt = state;
  el.addEventListener('click', (e) => {
    const a = e.target.closest('a.plink');
    if (!a) return;
    e.preventDefault();
    if (el.isContentEditable && !e.ctrlKey && !e.metaKey) return; // в режиме правки ссылка — просто текст (Ctrl+клик — перейти)
    e.stopPropagation();
    goToFn?.(a.dataset.target);
  });
  // начать правку; (x, y) — куда поставить курсор
  el._edit = (x, y) => {
    if (el.isContentEditable) return;
    fill(el, opts.value() || '', { auto: false });
    el.contentEditable = 'true';
    opts.onBegin?.();
    el.focus();
    const sel = getSelection();
    let r = null;
    if (x != null && document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
    else if (x != null && document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); } }
    if (!r || !el.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(el); if (!opts.selectAll) r.collapse(false); }
    sel.removeAllRanges();
    sel.addRange(r);
  };
  el.addEventListener('input', () => state.changed());
  el.addEventListener('paste', (e) => {
    if (!el.isContentEditable) return;
    e.preventDefault();
    e.stopPropagation();
    const t = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, opts.multiline === false ? t.replace(/\s*\n\s*/g, ' ') : t);
  });
  el.addEventListener('keydown', (e) => {
    if (!el.isContentEditable) return;
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) { e.preventDefault(); askLink(el, state); return; }
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey || opts.multiline === false))) { e.preventDefault(); el.blur(); return; }
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
  });
  el.addEventListener('blur', () => {
    if (state.picking) return; // фокус ушёл в окно выбора ссылки — правка продолжается
    if (barFor === el) hideBar();
    el.contentEditable = 'false';
    const v = serialize(el).replace(/\n$/, '');
    opts.onCommit?.(v);
    fill(el, v, { auto: opts.auto !== false, selfPage: selfPage() });
  });
  return el;
}
export { closePicker };
