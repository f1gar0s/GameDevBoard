// Выпадающий список. Варианты берутся из отдельной карточки с компонентом «Список».
export default {
  type: 'dropdown',
  name: 'Выпадающий список',
  icon: '▾',
  group: 'Данные',
  description: 'Выбор варианта из карточки-списка (текст + цвет)',
  openOnAdd: true,
  defaults: () => ({ label: 'Поле', list: null, value: null }),
  deps: (d) => [d.list?.card],

  render(ctx) {
    const { h, data: d } = ctx;
    const ctrl = d.list
      ? ctx.dropdown(d.list, d.value, (v) => ctx.change({ value: v }))
      : h('button', { class: 'ghost-btn', onClick: () => ctx.toggleSettings() }, '⚙ Выбрать список');
    return h('div', { class: 'cx-dropdown' }, h('span', { class: 'c-label inline' }, d.label || 'Поле'), ctrl);
  },

  settings(ctx) {
    const { h, data: d } = ctx;
    const lists = ctx.lists();
    const cur = d.list ? `${d.list.card}|${d.list.comp}` : '';
    const sel = h('select', { class: 'f sel wide' },
      h('option', { value: '' }, lists.length ? '— выберите список —' : 'на доске нет списков'),
      lists.map((l) => h('option', { value: `${l.ref.card}|${l.ref.comp}`, selected: cur === `${l.ref.card}|${l.ref.comp}` }, `${l.title} (${l.items.length})`)));
    sel.onchange = () => {
      const [card, comp] = sel.value.split('|');
      ctx.change({ list: sel.value ? { card, comp } : null, value: null });
    };
    const newName = h('input', { class: 'f', placeholder: 'Название нового списка' });
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Подпись'), ctx.field('label', { placeholder: 'Статус, Приоритет…', commit: true }),
      h('label', {}, 'Список'), sel,
      h('label', {}, 'Новый'), h('div', { class: 'row' }, newName,
        h('button', { class: 'ghost-btn', onClick: () => {
          const name = newName.value.trim() || d.label || 'Новый список';
          const ref = ctx.ensureList(name, [['Вариант 1', '#7c5cff'], ['Вариант 2', '#22d3a6'], ['Вариант 3', '#f59e0b']]);
          ctx.change({ list: { card: ref.card, comp: ref.comp }, value: null });
          ctx.toast(`Список «${name}» создан рядом — добавляйте в него варианты`, 'ok');
        } }, '+ Создать')),
      d.list ? h('div', { class: 'set-note' }, h('button', { class: 'linkish', onClick: () => ctx.focusItem(d.list.card) }, 'Открыть карточку списка →')) : null);
  },

  text: (d, x) => `${d.label} ${x.optionOf(d.list, d.value)?.text || ''}`,
  exportMd: (d, x) => `**${d.label}:** ${x.optionOf(d.list, d.value)?.text || '—'}`,
  exportJson: (d, x) => ({ label: d.label, value: x.optionOf(d.list, d.value)?.text ?? null }),
};
