// Предмет: иконка, редкость, тип, цена, описание
export default {
  type: 'item',
  name: 'Предмет',
  icon: '🗡',
  group: 'Геймдизайн',
  defaults: () => ({ icon: '🗡', name: 'Меч рассвета', rarity: 'rare', kind: 'Оружие', price: 120, desc: '+15 к атаке. Светится рядом с нежитью.' }),

  render(ctx) {
    const { h, data: d, lib } = ctx;
    const col = lib.RARITY[d.rarity]?.color || '#9ca3af';
    const rar = h('select', { class: 'f sel', style: { color: col } }, Object.entries(lib.RARITY).map(([k, v]) => h('option', { value: k, selected: d.rarity === k }, v.name)));
    rar.onchange = () => ctx.change({ rarity: rar.value });
    return h('div', { class: 'cx-item', style: { '--c': col } },
      h('div', { class: 'char-top' }, ctx.field('icon', { cls: 'avatar rar', commit: true }),
        h('div', { class: 'grow' }, ctx.field('name', { cls: 'title', commit: true }), ctx.field('kind', { cls: 'sub', placeholder: 'Тип' }))),
      h('div', { class: 'row' }, rar, h('label', { class: 'price' }, '🪙', ctx.field('price', { type: 'number', num: true }))),
      ctx.field('desc', { tag: 'textarea', cls: 'notes', placeholder: 'Описание и эффекты', rows: 2, autosize: true }));
  },
  text: (d) => [d.name, d.kind, d.desc].join(' '),
  exportMd: (d, x) => `**${d.icon || ''} ${d.name}** — *${x.lib.RARITY[d.rarity]?.name || ''} · ${d.kind} · ${d.price} 🪙*\n\n${d.desc || ''}`,
  exportJson: (d) => ({ name: d.name, icon: d.icon, rarity: d.rarity, type: d.kind, price: d.price, description: d.desc }),
};
