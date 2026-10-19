// Список вариантов (текст + цвет) — источник для «Выпадающих списков» на других карточках.
// Название списка = название карточки.
export default {
  type: 'list',
  name: 'Список вариантов',
  icon: '☰',
  group: 'Данные',
  description: 'Варианты для выпадающих списков: добавляйте сверху вниз, задавайте текст и цвет',
  defaults: () => ({ label: '', items: [{ id: 'o' + Math.random().toString(36).slice(2, 8), text: 'Вариант 1', color: '#7c5cff' }, { id: 'o' + Math.random().toString(36).slice(2, 8), text: 'Вариант 2', color: '#22d3a6' }] }),

  render(ctx) {
    const { h, data: d } = ctx;
    const items = d.items || [];
    const used = Object.values(ctx.store.items).filter((it) => it.type === 'card' && it.data.components?.some((c) => c.data?.list?.card === ctx.cardId && c.data?.list?.comp === ctx.compId)).length;
    const commit = () => setTimeout(() => ctx.set({}), 0);
    const rows = items.map((o, i) => {
      const color = h('input', { type: 'color', value: o.color || '#94a3b8', class: 'opt-color' });
      color.onfocus = () => ctx.begin();
      color.oninput = () => { items[i].color = color.value; color.parentElement.style.setProperty('--oc', color.value); ctx.live({ items }); };
      color.onchange = commit;
      const text = h('input', { class: 'f opt-text', value: o.text || '' });
      text.onfocus = () => ctx.begin();
      text.oninput = () => { items[i].text = text.value; ctx.live({ items }); };
      text.onchange = commit;
      const mv = (k) => { const a = [...items]; const j = i + k; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; ctx.change({ items: a }); };
      return h('div', { class: 'opt-row', style: { '--oc': o.color } },
        h('label', { class: 'opt-sw' }, color), text,
        h('button', { class: 'x', title: 'Выше', onClick: () => mv(-1) }, '↑'),
        h('button', { class: 'x', title: 'Удалить', onClick: () => ctx.change({ items: items.filter((_, j) => j !== i) }) }, '×'));
    });
    const palette = ['#7c5cff', '#22d3a6', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#94a3b8', '#84cc16'];
    return h('div', { class: 'cx-list' },
      d.label ? h('div', { class: 'c-label' }, d.label) : null,
      rows.length ? rows : h('div', { class: 'muted small' }, 'Пусто — добавьте первый вариант'),
      h('div', { class: 'row' },
        h('button', { class: 'add', onClick: () => ctx.change({ items: [...items, { id: ctx.uid('o'), text: 'Вариант ' + (items.length + 1), color: palette[items.length % palette.length] }] }) }, '+ вариант'),
        h('span', { class: 'grow' }),
        h('span', { class: 'muted small', title: 'Сколько выпадающих списков ссылаются на этот список' }, used ? `используется: ${used}` : 'не используется')));
  },
  settings(ctx) {
    const { h } = ctx;
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Подпись'), ctx.field('label', { placeholder: 'если на карточке несколько списков', commit: true }),
      h('div', { class: 'set-note' }, 'Название списка = название карточки. Выпадающие списки на других карточках выбирают его через ⚙.'));
  },
  text: (d) => (d.items || []).map((o) => o.text).join(' '),
  exportMd: (d) => (d.items || []).map((o) => `- ${o.text} (${o.color})`).join('\n'),
  exportJson: (d) => ({ items: (d.items || []).map((o) => ({ text: o.text, color: o.color })) }),
};
