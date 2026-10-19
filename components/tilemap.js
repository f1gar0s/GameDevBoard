// Уровень: статичная тайловая карта. ЛКМ — рисовать выбранным тайлом, ПКМ — стирать.
function defaultMap() {
  const cols = 20, rows = 12;
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(r === 0 || c === 0 || r === rows - 1 || c === cols - 1 ? '#' : '.');
  const set = (c, r, ch) => (cells[r * cols + c] = ch);
  set(2, 2, 'P'); set(17, 9, 'X'); set(8, 5, 'C'); set(12, 7, 'C'); set(14, 3, 'E');
  for (let r = 1; r < 8; r++) set(10, r, '#');
  return { cols, rows, cells: cells.join('') };
}

export default {
  type: 'tilemap',
  name: 'Тайловая карта',
  icon: '🧱',
  group: 'Уровни и баланс',
  defaults: () => ({ name: 'Уровень 1-1', ...defaultMap() }),

  render(ctx) {
    const { h, data: d, lib } = ctx;
    const brush = lib.brushes.get(ctx.compId) || '#';
    const cv = h('canvas', { class: 'tiles no-drag' });
    lib.drawTiles(cv, d);
    let painting = false;
    const paint = (e) => {
      const r = cv.getBoundingClientRect();
      const k = Math.min(r.width / cv.width, r.height / cv.height);
      const ox = (r.width - cv.width * k) / 2, oy = (r.height - cv.height * k) / 2;
      const c = Math.floor((e.clientX - r.left - ox) / (16 * k));
      const rr = Math.floor((e.clientY - r.top - oy) / (16 * k));
      if (c < 0 || rr < 0 || c >= d.cols || rr >= d.rows) return;
      const b = e.button === 2 || e.buttons === 2 ? '.' : lib.brushes.get(ctx.compId) || '#';
      const idx = rr * d.cols + c;
      if (d.cells[idx] === b) return;
      let cells = d.cells;
      if (b === 'P') cells = cells.replace(/P/g, '.');
      d.cells = cells.slice(0, idx) + b + cells.slice(idx + 1);
      lib.drawTiles(cv, d);
      ctx.live({ cells: d.cells });
    };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => { e.stopPropagation(); painting = true; cv.setPointerCapture(e.pointerId); ctx.begin(); paint(e); });
    cv.addEventListener('pointermove', (e) => { if (painting) paint(e); });
    cv.addEventListener('pointerup', () => { painting = false; });
    const pal = h('div', { class: 'tile-pal' }, Object.entries(lib.TILES).map(([ch, t]) =>
      h('button', {
        class: 'tile-b' + (ch === brush ? ' on' : ''), title: t.name, style: { '--c': t.color },
        onClick: (e) => { lib.brushes.set(ctx.compId, ch); e.currentTarget.parentElement.querySelectorAll('.tile-b').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); },
      }, t.glyph || '')));
    return h('div', { class: 'cx-tilemap' },
      h('div', { class: 'row' }, ctx.field('name', { cls: 'inline-title', placeholder: 'Название уровня' }), h('span', { class: 'muted small' }, `${d.cols}×${d.rows}`)),
      pal,
      h('div', { class: 'tiles-wrap', style: { aspectRatio: `${d.cols} / ${d.rows}` } }, cv));
  },
  settings(ctx) {
    const { h, data: d, lib } = ctx;
    const sz = (key) => {
      const inp = h('input', { class: 'f num', type: 'number', min: 4, max: 64, value: d[key] });
      inp.onchange = () => {
        const v = ctx.clamp(Math.round(+inp.value || 4), 4, 64);
        const cols = key === 'cols' ? v : d.cols, rows = key === 'rows' ? v : d.rows;
        ctx.change({ cols, rows, cells: lib.resizeCells(d, cols, rows) });
      };
      return inp;
    };
    const png = () => {
      const cv = document.createElement('canvas');
      lib.drawTiles(cv, d, 32);
      cv.toBlob((b) => ctx.download((d.name || 'level') + '.png', b));
    };
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Ширина'), sz('cols'), h('label', {}, 'Высота'), sz('rows'),
      h('label', {}, 'Экспорт'), h('div', { class: 'row' },
        h('button', { class: 'ghost-btn', onClick: png }, '⤓ PNG'),
        h('button', { class: 'ghost-btn', onClick: () => ctx.download((d.name || 'level') + '.txt', lib.tileRows(d).join('\n'), 'text/plain') }, '⤓ TXT')),
      h('div', { class: 'set-note' }, 'ЛКМ — рисовать, ПКМ — стирать. Старт игрока на карте может быть только один.'));
  },
  text: (d) => d.name,
  exportMd: (d, x) => `**🗺 ${d.name}** (${d.cols}×${d.rows})\n\n\`\`\`\n${x.lib.tileRows(d).join('\n')}\n\`\`\``,
  exportJson: (d, x) => ({ name: d.name, width: d.cols, height: d.rows, rows: x.lib.tileRows(d), legend: Object.fromEntries(Object.entries(x.lib.TILES).map(([k, v]) => [k, v.name])) }),
};
