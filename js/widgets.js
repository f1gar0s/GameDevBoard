// Типы элементов доски и их отрисовка
import { h, s, clamp, toast, readFileAsDataURL, loadImage } from './util.js';
import { store } from './store.js';
import { playDialogue } from './play.js';
import { isEntry, isPlayer, checkCond, checkActs } from './dialogfmt.js';

export const STICKY_COLORS = ['#fef08a', '#fdba74', '#fca5a5', '#f9a8d4', '#c4b5fd', '#93c5fd', '#99f6e4', '#86efac', '#e5e7eb', '#475569'];
export const ACCENT_COLORS = ['#7c5cff', '#22d3a6', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#94a3b8', '#e2e8f0'];

export { RARITY, STATUS, TAGS, PRIORITY, TILES, compileFormula, parseSeries, sampleSeries, tileRows, drawTiles, resizeCells } from './lib.js';
import { CARD, optionOf } from './card.js';
import { getComponent } from './registry.js';

// ---------- helpers ----------
function field(api, key, { tag = 'input', cls = '', placeholder = '', type = 'text', num = false, rows, onLive } = {}) {
  const v = api.item.data[key];
  const el = h(tag, { class: 'f ' + cls, placeholder, type: tag === 'input' ? type : null, rows, value: v ?? '' });
  el.addEventListener('focus', () => api.begin());
  el.addEventListener('input', () => {
    const val = num ? (el.value === '' ? 0 : +el.value) : el.value;
    api.live({ [key]: val });
    onLive?.(val);
  });
  return el;
}

function select(api, key, options, { cls = '', onChange } = {}) {
  const el = h('select', { class: 'f sel ' + cls },
    Object.entries(options).map(([k, v]) => h('option', { value: k, selected: api.item.data[key] === k }, typeof v === 'string' ? v : v.name)));
  el.addEventListener('change', () => { api.change({ [key]: el.value }); onChange?.(el.value); });
  return el;
}

export function editable(api, key, { cls = '', placeholder = '' } = {}) {
  const el = h('div', { class: 'editable ' + cls, 'data-placeholder': placeholder });
  el.textContent = api.item.data[key] || '';
  el._edit = () => {
    try { el.contentEditable = 'plaintext-only'; } catch { el.contentEditable = 'true'; }
    if (!el.isContentEditable) el.contentEditable = 'true';
    api.begin();
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  };
  el.addEventListener('input', () => api.live({ [key]: el.innerText }));
  el.addEventListener('blur', () => {
    el.contentEditable = 'false';
    api.set({ [key]: el.innerText.replace(/\n$/, '') });
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); el.blur(); }
    e.stopPropagation();
  });
  return el;
}

const head = (icon, label, color, ...extra) =>
  h('div', { class: 'card-head', style: { '--c': color } }, h('span', { class: 'card-kind' }, icon, ' ', label), ...extra);

// ---------- описания виджетов ----------
export const WIDGETS = {
  sticky: {
    label: 'Стикер', icon: '🗒', w: 200, h: 200, min: [80, 60],
    data: () => ({ text: '', color: STICKY_COLORS[0] }),
    title: (d) => d.text,
    render(it, api) {
      const len = (it.data.text || '').length;
      const fs = len < 30 ? 20 : len < 90 ? 15 : len < 200 ? 13 : 11;
      const dark = it.data.color === '#475569';
      return h('div', { class: 'sticky' + (dark ? ' dark' : ''), style: { background: it.data.color, fontSize: fs + 'px' } },
        editable(api, 'text', { placeholder: 'Двойной клик — писать' }));
    },
  },
  text: {
    label: 'Текст', icon: 'T', w: 260, h: 60, min: [40, 24],
    data: () => ({ text: '', size: 24, color: '#e6e8ef', bold: true }),
    title: (d) => d.text,
    render(it, api) {
      return h('div', { class: 'textblock', style: { fontSize: it.data.size + 'px', color: it.data.color, fontWeight: it.data.bold ? 700 : 400 } },
        editable(api, 'text', { placeholder: 'Текст' }));
    },
  },
  shape: {
    label: 'Фигура', icon: '◆', w: 180, h: 110, min: [30, 30],
    data: () => ({ shape: 'rect', text: '', color: '#7c5cff' }),
    title: (d) => d.text,
    render(it, api) {
      const { shape, color } = it.data;
      const w = it.w, hh = it.h;
      let el;
      if (shape === 'ellipse') el = s('ellipse', { cx: w / 2, cy: hh / 2, rx: w / 2 - 2, ry: hh / 2 - 2 });
      else if (shape === 'diamond') el = s('polygon', { points: `${w / 2},2 ${w - 2},${hh / 2} ${w / 2},${hh - 2} 2,${hh / 2}` });
      else if (shape === 'hex') el = s('polygon', { points: `${w * 0.25},2 ${w * 0.75},2 ${w - 2},${hh / 2} ${w * 0.75},${hh - 2} ${w * 0.25},${hh - 2} 2,${hh / 2}` });
      else el = s('rect', { x: 2, y: 2, width: w - 4, height: hh - 4, rx: shape === 'round' ? Math.min(w, hh) / 2 - 2 : 10 });
      el.setAttribute('fill', color + '33');
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', 2.5);
      return h('div', { class: 'shape' }, s('svg', { width: w, height: hh, class: 'shape-svg' }, el), editable(api, 'text', { cls: 'shape-text', placeholder: '' }));
    },
  },
  frame: {
    label: 'Фрейм', icon: '▢', w: 640, h: 440, min: [120, 80],
    data: () => ({ title: 'Раздел', color: '#7c5cff', status: '' }),
    title: (d) => d.title,
    render(it, api) {
      return h('div', { class: 'frame', style: { '--c': it.data.color } },
        h('div', { class: 'frame-title' }, editable(api, 'title', { placeholder: 'Фрейм' }),
          it.data.kanban ? h('span', { class: 'frame-status', title: 'Колонка канбана: карточка, брошенная сюда, получит значение «' + (it.data.title || '') + '» в подходящем выпадающем списке' }, '⇢ колонка') : null));
    },
  },
  draw: {
    label: 'Рисунок', icon: '✎', w: 100, h: 100, min: [10, 10],
    data: () => ({ points: [], color: '#e6e8ef', width: 3, ow: 100, oh: 100 }),
    title: () => 'Рисунок',
    render(it) {
      const d = it.data;
      const path = d.points.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
      return s('svg', { class: 'ink', viewBox: `0 0 ${d.ow} ${d.oh}`, preserveAspectRatio: 'none', width: '100%', height: '100%' },
        s('path', { d: path, stroke: d.color, 'stroke-width': d.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    },
  },
  image: {
    label: 'Изображение', icon: '🖼', w: 300, h: 200, min: [30, 30],
    data: () => ({ asset: null, name: '' }),
    title: (d) => d.name || 'Изображение',
    render(it) {
      const src = store.board.assets[it.data.asset];
      return h('div', { class: 'imagebox' }, src ? h('img', { src, draggable: 'false', alt: it.data.name || '' }) : h('div', { class: 'muted' }, 'нет изображения'));
    },
  },

  // ----- Диалоговая система (отдельный элемент, связи = варианты ответа) -----
  dialogue: {
    label: 'Реплика', icon: '💬', w: 280, h: 200, min: [200, 130], group: 'design',
    data: () => ({ speaker: 'NPC', text: 'Привет, путник! Чем могу помочь?' }),
    title: (d) => `${d.speaker}: ${d.text}`,
    render(it, api) {
      const outs = store.outgoing(it.id);
      const d = it.data;
      const entry = isEntry(it) && !isPlayer(it);
      const logic = !!d.showLogic;
      const extra = entry ? 170 : 62;
      const row = (label, el) => h('label', { class: 'lg-row' }, h('span', {}, label), el);
      const warnOf = (fn, key) => { const bad = fn(d[key]); return bad.length ? h('div', { class: 'lg-warn', title: bad.join('\n') }, '⚠ ' + bad[0]) : null; };
      return h('div', { class: 'card dialogue' + (entry ? ' is-entry' : '') },
        head('💬', entry ? 'Начало диалога' : 'Реплика', '#22d3a6',
          h('button', {
            class: 'logic-btn' + (logic ? ' on' : ''), title: 'Условия и действия (для экспорта в игру)',
            onClick: () => { store.checkpoint(); store.patch(it.id, { h: Math.max(130, it.h + (logic ? -extra : extra)), data: { showLogic: !logic } }); },
          }, '⚙'),
          h('button', { class: 'play-btn', title: 'Проиграть диалог с этой реплики', onClick: () => playDialogue(it.id) }, '▶ Играть')),
        field(api, 'speaker', { cls: 'speaker', placeholder: 'Кто говорит (id: cat)' }),
        field(api, 'text', { tag: 'textarea', cls: 'line', placeholder: 'Реплика…', rows: 3 }),
        logic ? h('div', { class: 'logic' },
          entry ? h('div', { class: 'lg-start' },
            row('id', field(api, 'dlgId', { cls: 'mono', placeholder: 'cat_hungry' })),
            row('npc', field(api, 'npc', { cls: 'mono', placeholder: 'cat' })),
            row('приоритет', field(api, 'priority', { type: 'number', num: true, cls: 'mono' })),
            row('условие', field(api, 'dcond', { cls: 'mono', placeholder: '!flag:cat_fed' })),
            warnOf(checkCond, 'dcond')) : null,
          row('действия', field(api, 'actions', { cls: 'mono', placeholder: 'set:met_cat' })),
          warnOf(checkActs, 'actions')) : null,
        h('div', { class: 'choices' }, outs.length
          ? outs.map((l, i) => h('div', { class: 'choice' }, `${i + 1}. `, l.label || '…далее',
              l.cond ? h('span', { class: 'ch-tag cond', title: 'Условие' }, '? ' + l.cond) : null,
              l.actions ? h('span', { class: 'ch-tag act', title: 'Действия' }, '⚡ ' + l.actions) : null))
          : h('div', { class: 'hint' }, 'Протяните связь ⟶ к следующей реплике. Подпись связи = вариант ответа.')));
    },
  },

  // ----- Карточка с компонентами -----
  card: CARD,
};

export function textOf(it) {
  const d = it.data || {};
  const parts = [];
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === 'string') parts.push(v);
    else if (typeof v === 'number') return;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  if (it.type === 'card') {
    parts.push(d.title || '');
    for (const c of d.components || []) {
      const def = getComponent(c.type);
      try { parts.push(def?.text ? def.text(c.data, { optionOf, store }) : ''); } catch {}
    }
    return parts.join(' ');
  }
  walk(it.type === 'draw' ? '' : d);
  return parts.join(' ');
}

export function titleOf(it) {
  const w = WIDGETS[it.type];
  const t = (w?.title?.(it.data) || '').trim();
  return t || w?.label || it.type;
}
