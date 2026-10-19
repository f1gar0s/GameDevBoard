// Таблица лута: веса и шансы. Строка — предмет с доски (выпадающий список всех «Предметов») или свой текст.
// Редкость строки — выпадающий список из карточки-списка «Редкость».
const itemName = (r, x) => x.store.item(r.item?.card)?.data.components?.find((c) => c.id === r.item.comp)?.data.name ?? r.name;

export default {
  type: 'loottable',
  name: 'Таблица лута',
  icon: '🎲',
  group: 'Уровни и баланс',
  openOnAdd: true,
  defaults: () => ({ title: 'Сундук', list: null, rows: [{ name: 'Золото x10', w: 50, opt: null }, { name: 'Зелье', w: 30, opt: null }] }),
  deps: (d) => [d.list?.card],
  watch: ['item'], // перерисовка, когда на доске появляется, меняется или удаляется предмет

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
    const items = ctx.compsOnBoard('item');
    const linked = (r) => (r.item ? ctx.resolveComp(r.item) : null);
    const nameOf = (r) => linked(r)?.data.name ?? r.name;
    // вариант редкости из списка, совпадающий с редкостью предмета
    const rarityOpt = (itemData) => {
      const want = ctx.lib.RARITY[itemData.rarity]?.name?.toLowerCase();
      return ctx.resolveList(d.list)?.items.find((o) => o.text.toLowerCase() === want)?.id || null;
    };
    const itemSelect = (r, i) => {
      const cur = r.item ? `${r.item.card}|${r.item.comp}` : '';
      const sel = h('select', { class: 'f sel item-pick', title: 'Предмет с доски' },
        h('option', { value: '' }, '✎ свой текст'),
        items.length ? h('optgroup', { label: 'Предметы на доске' }, items.map((x) => h('option', { value: `${x.ref.card}|${x.ref.comp}`, selected: cur === `${x.ref.card}|${x.ref.comp}` }, `${x.data.icon || '▪'} ${x.data.name || 'Без названия'}`))) : null,
        h('option', { value: '__new' }, '+ создать новый предмет'));
      if (r.item && !linked(r)) sel.prepend(h('option', { value: cur, selected: true }, '⚠ предмет удалён'));
      sel.onchange = () => {
        if (sel.value === '__new') {
          ctx.begin();
          const card = ctx.createTool('item', { title: r.name || 'Новый предмет', data: { name: r.name || 'Новый предмет' } });
          const comp = card.data.components[0];
          ctx.set({ rows: rows.map((x, j) => (j === i ? { ...x, item: { card: card.id, comp: comp.id }, name: comp.data.name, opt: rarityOpt(comp.data) || x.opt } : x)) });
          ctx.toast('Предмет создан рядом с таблицей', 'ok');
          return;
        }
        if (!sel.value) { ctx.change({ rows: rows.map((x, j) => (j === i ? { ...x, item: null, name: nameOf(x) } : x)) }); return; }
        const [card, comp] = sel.value.split('|');
        const it = items.find((x) => x.ref.card === card && x.ref.comp === comp);
        ctx.change({ rows: rows.map((x, j) => (j === i ? { ...x, item: { card, comp }, name: it?.data.name || x.name, opt: (it && rarityOpt(it.data)) || x.opt } : x)) });
      };
      return sel;
    };
    const rowsEl = h('div', { class: 'loot-rows' }, rows.map((r, i) => {
      const nm = linked(r)
        ? h('button', { class: 'item-link', title: 'Перейти к предмету', onClick: () => ctx.focusItem(r.item.card) }, `${linked(r).data.icon || ''} ${linked(r).data.name}`)
        : h('input', { class: 'f', value: r.name, placeholder: 'Название' });
      const w = h('input', { class: 'f num', type: 'number', min: 0, value: r.w });
      nm.onfocus = w.onfocus = () => ctx.begin();
      if (nm.tagName === 'INPUT') nm.oninput = () => { rows[i].name = nm.value; ctx.live({ rows }); };
      w.oninput = () => { rows[i].w = +w.value; ctx.live({ rows }); refresh(); };
      const dd = d.list ? ctx.dropdown(d.list, r.opt, (v) => ctx.change({ rows: rows.map((x, j) => (j === i ? { ...x, opt: v } : x)) }), { compact: true, placeholder: '—' }) : h('span');
      return h('div', { class: 'loot-row2', style: { '--c': color(r) } },
        h('div', { class: 'lr-top' }, itemSelect(r, i), nm, w, h('button', { class: 'x', onClick: () => ctx.change({ rows: rows.filter((_, j) => j !== i) }) }, '×')),
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
          out.replaceChildren(h('span', { class: 'drop', style: { color: color(r) } }, '✦ ', nameOf(r)));
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
  // имя строки: актуальное имя связанного предмета или свой текст

  exportMd: (d, x) => {
    const tot = (d.rows || []).reduce((a, r) => a + Math.max(0, +r.w || 0), 0) || 1;
    return `**🎲 ${d.title}**\n\n| Предмет | Редкость | Вес | Шанс |\n|---|---|---|---|\n${(d.rows || []).map((r) => `| ${itemName(r, x)} | ${x.optionOf(d.list, r.opt)?.text || '—'} | ${r.w} | ${((Math.max(0, +r.w || 0) / tot) * 100).toFixed(1)}% |`).join('\n')}`;
  },
  exportJson: (d, x) => {
    const tot = (d.rows || []).reduce((a, r) => a + Math.max(0, +r.w || 0), 0) || 1;
    return { title: d.title, entries: (d.rows || []).map((r) => ({ name: itemName(r, x), item: r.item?.card || undefined, weight: r.w, rarity: x.optionOf(d.list, r.opt)?.text ?? null, chance: Math.round((Math.max(0, +r.w || 0) / tot) * 10000) / 10000 })) };
  },
};
