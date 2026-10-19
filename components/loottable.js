// Таблица лута: веса и шансы. Редкость каждой строки — выпадающий список из карточки-списка «Редкость».
export default {
  type: 'loottable',
  name: 'Таблица лута',
  icon: '🎲',
  group: 'Уровни и баланс',
  openOnAdd: true,
  defaults: () => ({ title: 'Сундук', list: null, rows: [{ name: 'Золото x10', w: 50, opt: null }, { name: 'Зелье', w: 30, opt: null }] }),
  deps: (d) => [d.list?.card],

  render(ctx) {
    const { h, data: d } = ctx;
    const rows = d.rows || [];
    const weight = () => rows.reduce((a, r) => a + Math.max(0, +r.w || 0), 0) || 1;
    const out = h('div', { class: 'roll-out' });
    const sims = rows.map(() => h('span', { class: 'sim' }));
    const pcts = rows.map(() => h('span', { class: 'pct' }));
    const bars = rows.map(() => h('i'));
    const refresh = () => rows.forEach((r, i) => { const p = (Math.max(0, +r.w || 0) / weight()) * 100; pcts[i].textContent = p.toFixed(1) + '%'; bars[i].style.width = p + '%'; });
    const color = (r) => ctx.optionOf(d.list, r.opt)?.color || '#9ca3af';
    const rowsEl = h('div', { class: 'loot-rows' }, rows.map((r, i) => {
      const nm = h('input', { class: 'f', value: r.name });
      const w = h('input', { class: 'f num', type: 'number', min: 0, value: r.w });
      nm.onfocus = w.onfocus = () => ctx.begin();
      nm.oninput = () => { rows[i].name = nm.value; ctx.live({ rows }); };
      w.oninput = () => { rows[i].w = +w.value; ctx.live({ rows }); refresh(); };
      const dd = d.list ? ctx.dropdown(d.list, r.opt, (v) => ctx.change({ rows: rows.map((x, j) => (j === i ? { ...x, opt: v } : x)) }), { compact: true, placeholder: '—' }) : h('span');
      return h('div', { class: 'loot-row2', style: { '--c': color(r) } },
        h('div', { class: 'lr-top' }, nm, w, h('button', { class: 'x', onClick: () => ctx.change({ rows: rows.filter((_, j) => j !== i) }) }, '×')),
        h('div', { class: 'lr-bot' }, dd, h('div', { class: 'lbar', style: { '--c': color(r) } }, bars[i], pcts[i], sims[i])));
    }));
    refresh();
    const roll = () => {
      let x = Math.random() * rows.reduce((a, r) => a + Math.max(0, +r.w || 0), 0);
      for (const r of rows) { x -= Math.max(0, +r.w || 0); if (x < 0) return r; }
      return rows[rows.length - 1];
    };
    return h('div', { class: 'cx-loot' },
      ctx.field('title', { cls: 'title', placeholder: 'Название таблицы' }),
      d.list ? null : h('button', { class: 'ghost-btn', onClick: () => ctx.toggleSettings() }, '⚙ Выбрать список редкостей'),
      rowsEl,
      h('button', { class: 'add', onClick: () => ctx.change({ rows: [...rows, { name: 'Новый дроп', w: 10, opt: ctx.resolveList(d.list)?.items[0]?.id || null }] }) }, '+ строка'),
      h('div', { class: 'row foot' },
        h('button', { class: 'play-btn', onClick: () => {
          const r = roll();
          if (!r) return;
          out.replaceChildren(h('span', { class: 'drop', style: { color: color(r) } }, '✦ ', r.name));
          out.classList.remove('pop'); void out.offsetWidth; out.classList.add('pop');
        } }, '🎲 Бросок'),
        h('button', { class: 'ghost-btn', title: 'Сравнить фактическую частоту с ожидаемой', onClick: () => {
          const cnt = new Map();
          for (let k = 0; k < 1000; k++) { const r = roll(); cnt.set(r, (cnt.get(r) || 0) + 1); }
          rows.forEach((r, i) => (sims[i].textContent = `факт ${(((cnt.get(r) || 0) / 1000) * 100).toFixed(1)}%`));
          out.replaceChildren(h('span', { class: 'muted' }, '1000 бросков'));
        } }, '×1000'),
        out));
  },
  settings(ctx) {
    const { h, data: d } = ctx;
    const lists = ctx.lists();
    const cur = d.list ? `${d.list.card}|${d.list.comp}` : '';
    const sel = h('select', { class: 'f sel wide' }, h('option', { value: '' }, '— список редкостей —'),
      lists.map((l) => h('option', { value: `${l.ref.card}|${l.ref.comp}`, selected: cur === `${l.ref.card}|${l.ref.comp}` }, l.title)));
    sel.onchange = () => { const [card, comp] = sel.value.split('|'); ctx.change({ list: sel.value ? { card, comp } : null }); };
    return h('div', { class: 'set-grid' }, h('label', {}, 'Редкости из'), sel,
      h('label', {}, ''), h('button', { class: 'ghost-btn', onClick: () => {
        const ref = ctx.ensureList('Редкость', [['Обычный', '#9ca3af'], ['Необычный', '#22c55e'], ['Редкий', '#3b82f6'], ['Эпический', '#a855f7'], ['Легендарный', '#f59e0b']]);
        ctx.change({ list: { card: ref.card, comp: ref.comp } });
      } }, 'Использовать стандартный «Редкость»'));
  },
  text: (d) => [d.title, ...(d.rows || []).map((r) => r.name)].join(' '),
  exportMd: (d, x) => {
    const tot = (d.rows || []).reduce((a, r) => a + Math.max(0, +r.w || 0), 0) || 1;
    return `**🎲 ${d.title}**\n\n| Предмет | Редкость | Вес | Шанс |\n|---|---|---|---|\n${(d.rows || []).map((r) => `| ${r.name} | ${x.optionOf(d.list, r.opt)?.text || '—'} | ${r.w} | ${((Math.max(0, +r.w || 0) / tot) * 100).toFixed(1)}% |`).join('\n')}`;
  },
  exportJson: (d, x) => {
    const tot = (d.rows || []).reduce((a, r) => a + Math.max(0, +r.w || 0), 0) || 1;
    return { title: d.title, entries: (d.rows || []).map((r) => ({ name: r.name, weight: r.w, rarity: x.optionOf(d.list, r.opt)?.text ?? null, chance: Math.round((Math.max(0, +r.w || 0) / tot) * 10000) / 10000 })) };
  },
};
