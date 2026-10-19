// Холст для рисования со слоями. Слои можно добавлять, удалять, скрывать и перетаскивать.
// Каждый слой хранится как PNG в ресурсах доски. Готовый рисунок скачивается как PNG.

const toolState = new Map(); // compId → { tool, color, size }
const cache = new Map();     // assetId → canvas/картинка для мгновенной перерисовки

const TOOLS = [['pen', '✎', 'Кисть'], ['line', '╱', 'Линия'], ['rect', '▭', 'Прямоугольник'], ['ellipse', '◯', 'Эллипс'], ['fill', '▧', 'Заливка слоя'], ['eraser', '⌫', 'Ластик']];

function drawAsset(g, src, id) {
  const c = cache.get(id);
  if (c) { g.drawImage(c, 0, 0); return; }
  if (!src) return;
  const img = new Image();
  img.onload = () => { cache.set(id, img); g.drawImage(img, 0, 0); };
  img.src = src;
}

export default {
  type: 'canvas',
  name: 'Холст со слоями',
  icon: '🖌',
  group: 'Арт',
  description: 'Рисование кистью и фигурами на слоях, экспорт PNG',
  defaults: () => {
    const id = 'L' + Math.random().toString(36).slice(2, 8);
    return { w: 960, h: 600, bg: '#ffffff', layers: [{ id, name: 'Слой 1', visible: true, asset: null }], active: id };
  },

  render(ctx) {
    const { h, data: d } = ctx;
    const st = toolState.get(ctx.compId) || { tool: 'pen', color: '#1f2430', size: 6 };
    toolState.set(ctx.compId, st);
    const layers = d.layers || [];
    const active = layers.find((l) => l.id === d.active) || layers[layers.length - 1];

    // ---- сцена ----
    const stage = h('div', { class: 'paint-stage no-drag', style: { aspectRatio: `${d.w} / ${d.h}`, background: d.bg === 'transparent' ? null : d.bg } });
    if (d.bg === 'transparent') stage.classList.add('checker');
    const canvases = new Map();
    for (const l of layers) {
      const cv = h('canvas', { width: d.w, height: d.h, class: 'paint-layer', style: { display: l.visible ? '' : 'none' } });
      drawAsset(cv.getContext('2d'), ctx.asset(l.asset), l.asset);
      canvases.set(l.id, cv);
      stage.append(cv);
    }
    const overlay = h('canvas', { width: d.w, height: d.h, class: 'paint-layer overlay' });
    stage.append(overlay);

    const pos = (e) => { const r = stage.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * d.w, y: ((e.clientY - r.top) / r.height) * d.h }; };
    let drawing = null;
    const style = (g) => { g.strokeStyle = st.color; g.fillStyle = st.color; g.lineWidth = st.size; g.lineCap = 'round'; g.lineJoin = 'round'; };
    const shape = (g, a, b) => {
      g.beginPath();
      if (st.tool === 'line') { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
      else if (st.tool === 'rect') g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      else g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      g.stroke();
    };
    stage.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !active) return;
      if (!active.visible) { ctx.toast('Слой скрыт — включите 👁', 'err'); return; }
      e.stopPropagation();
      stage.setPointerCapture(e.pointerId);
      const cv = canvases.get(active.id), g = cv.getContext('2d');
      const p = pos(e);
      drawing = { g, start: p, last: p };
      style(g);
      if (st.tool === 'fill') { g.fillRect(0, 0, d.w, d.h); drawing = { g, fill: true }; return; }
      if (st.tool === 'pen' || st.tool === 'eraser') {
        g.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
        g.beginPath(); g.arc(p.x, p.y, st.size / 2, 0, Math.PI * 2); g.fill();
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drawing || drawing.fill) return;
      const p = pos(e), { g } = drawing;
      if (st.tool === 'pen' || st.tool === 'eraser') {
        g.beginPath(); g.moveTo(drawing.last.x, drawing.last.y); g.lineTo(p.x, p.y); g.stroke();
        drawing.last = p;
      } else {
        const o = overlay.getContext('2d');
        o.clearRect(0, 0, d.w, d.h); style(o); shape(o, drawing.start, p);
      }
    });
    const finish = (e) => {
      if (!drawing) return;
      const { g } = drawing;
      if (!drawing.fill && !(st.tool === 'pen' || st.tool === 'eraser')) {
        overlay.getContext('2d').clearRect(0, 0, d.w, d.h);
        style(g); g.globalCompositeOperation = 'source-over'; shape(g, drawing.start, pos(e));
      }
      g.globalCompositeOperation = 'source-over';
      drawing = null;
      const cv = canvases.get(active.id);
      const url = cv.toDataURL('image/png');
      const copy = document.createElement('canvas'); copy.width = d.w; copy.height = d.h; copy.getContext('2d').drawImage(cv, 0, 0);
      ctx.begin();
      const asset = ctx.addAsset(url);
      cache.set(asset, copy);
      ctx.set({ layers: layers.map((l) => (l.id === active.id ? { ...l, asset } : l)) });
    };
    stage.addEventListener('pointerup', finish);
    stage.addEventListener('pointercancel', finish);

    // ---- панель инструментов ----
    const color = h('input', { type: 'color', value: st.color, title: 'Цвет' });
    color.oninput = () => { st.color = color.value; };
    const size = h('select', { class: 'f sel', title: 'Толщина' }, [2, 4, 6, 10, 16, 28].map((v) => h('option', { value: v, selected: st.size === v }, v + ' px')));
    size.onchange = () => { st.size = +size.value; };
    const toolbar = h('div', { class: 'paint-tools' },
      TOOLS.map(([k, ic, name]) => h('button', {
        class: 'pt-btn' + (st.tool === k ? ' on' : ''), title: name,
        onClick: (e) => { st.tool = k; e.currentTarget.parentElement.querySelectorAll('.pt-btn').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); },
      }, ic)),
      color, size, h('span', { class: 'grow' }),
      h('button', { class: 'ghost-btn', title: 'Очистить активный слой', onClick: () => { ctx.change({ layers: layers.map((l) => (l.id === active?.id ? { ...l, asset: null } : l)) }); } }, 'Очистить'),
      h('button', { class: 'play-btn', title: 'Скачать рисунок как PNG', onClick: () => {
        const out = document.createElement('canvas'); out.width = d.w; out.height = d.h;
        const g = out.getContext('2d');
        if (d.bg !== 'transparent') { g.fillStyle = d.bg; g.fillRect(0, 0, d.w, d.h); }
        for (const l of layers) if (l.visible) g.drawImage(canvases.get(l.id), 0, 0);
        out.toBlob((b) => ctx.download((ctx.card.data.title || 'canvas') + '.png', b));
      } }, '⤓ PNG'));

    // ---- слои (сверху — верхний) ----
    const rows = [...layers].reverse().map((l) => {
      const name = h('input', { class: 'f layer-name', value: l.name });
      name.onfocus = () => ctx.begin();
      name.oninput = () => { l.name = name.value; ctx.live({ layers }); };
      const row = h('div', { class: 'layer-row' + (l.id === active?.id ? ' on' : ''), 'data-layer': l.id },
        h('span', { class: 'lr-grip', title: 'Перетащите, чтобы изменить порядок' }, '⠿'),
        h('button', { class: 'eye' + (l.visible ? '' : ' off'), title: l.visible ? 'Скрыть' : 'Показать', onClick: (e) => { e.stopPropagation(); ctx.change({ layers: layers.map((x) => (x.id === l.id ? { ...x, visible: !x.visible } : x)) }); } }, l.visible ? '👁' : '—'),
        name,
        layers.length > 1 ? h('button', { class: 'x', title: 'Удалить слой', onClick: (e) => { e.stopPropagation(); const rest = layers.filter((x) => x.id !== l.id); ctx.change({ layers: rest, active: d.active === l.id ? rest[rest.length - 1].id : d.active }); } }, '×') : null);
      row.addEventListener('click', (e) => { if (e.target.closest('input, button')) return; if (d.active !== l.id) ctx.change({ active: l.id }); });
      const grip = row.querySelector('.lr-grip');
      grip.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        grip.setPointerCapture(e.pointerId);
        row.classList.add('dragging');
        let target = null, above = false;
        const list = row.parentElement;
        const clear = () => list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
        const move = (ev) => {
          clear(); target = null;
          const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.layer-row');
          if (!el || el === row || el.parentElement !== list) return;
          const r = el.getBoundingClientRect();
          above = ev.clientY < r.top + r.height / 2;
          el.classList.add(above ? 'drop-before' : 'drop-after');
          target = el.dataset.layer;
        };
        const up = () => {
          grip.removeEventListener('pointermove', move);
          clear(); row.classList.remove('dragging');
          if (!target) return;
          // в UI список перевёрнут: «выше» в списке = ближе к концу массива
          const arr = layers.filter((x) => x.id !== l.id);
          const j = arr.findIndex((x) => x.id === target);
          arr.splice(above ? j + 1 : j, 0, l);
          ctx.change({ layers: arr });
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up, { once: true });
      });
      return row;
    });
    const panel = h('div', { class: 'paint-layers no-drag' },
      h('div', { class: 'pl-head' }, h('b', {}, 'Слои'), h('span', { class: 'grow' }),
        h('button', { class: 'ghost-btn', title: 'Новый слой', onClick: () => {
          const id = ctx.uid('L');
          ctx.change({ layers: [...layers, { id, name: 'Слой ' + (layers.length + 1), visible: true, asset: null }], active: id });
        } }, '+ слой')),
      h('div', { class: 'pl-list' }, rows));

    return h('div', { class: 'cx-canvas' }, toolbar, h('div', { class: 'paint-body' }, stage, panel));
  },

  settings(ctx) {
    const { h, data: d } = ctx;
    const bg = h('select', { class: 'f sel' }, [['#ffffff', 'Белый'], ['#f5efe0', 'Бумага'], ['#1f2430', 'Тёмный'], ['transparent', 'Прозрачный']].map(([k, v]) => h('option', { value: k, selected: d.bg === k }, v)));
    bg.onchange = () => ctx.change({ bg: bg.value });
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Фон'), bg,
      h('div', { class: 'set-note' }, `Размер холста ${d.w}×${d.h} px. Каждый слой хранится отдельно; на экспорт идут только видимые.`));
  },
  text: (d) => (d.layers || []).map((l) => l.name).join(' '),
  exportMd: (d) => `🖌 Холст ${d.w}×${d.h}, слоёв: ${(d.layers || []).length}`,
  exportJson: (d) => ({ width: d.w, height: d.h, layers: (d.layers || []).map((l) => ({ name: l.name, visible: l.visible, asset: l.asset })) }),
};
