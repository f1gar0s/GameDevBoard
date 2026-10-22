// Предмет: иконка, редкость, тип, цена, описание.
// Редкость — выпадающий список из любого объекта «Список» (по умолчанию «Редкость»); список меняется в ⚙.
export function itemRarity(d, x) {
  if (d.rarityList) { const o = x.optionOf(d.rarityList, d.rarityOpt); return o ? { text: o.text, color: o.color } : null; }
  const r = x.lib.RARITY[d.rarity];
  return r ? { text: r.name, color: r.color } : null;
}

export default {
  type: 'item',
  name: 'Предмет',
  icon: '🗡',
  group: 'Геймдизайн',
  defaults: () => ({ icon: '🗡', name: 'Меч рассвета', rarity: 'rare', rarityList: null, rarityOpt: null, kind: 'Оружие', price: 120, desc: '+15 к атаке. Светится рядом с нежитью.' }),
  deps: (d) => [d.rarityList?.card],

  render(ctx) {
    const { h, data: d, lib } = ctx;
    const rar = itemRarity(d, ctx);
    const col = rar?.color || '#9ca3af';
    let ctrl;
    if (d.rarityList) {
      ctrl = ctx.dropdown(d.rarityList, d.rarityOpt, (v) => ctx.change({ rarityOpt: v }), { placeholder: '— редкость —' });
    } else {
      // старые предметы: встроенный набор редкостей, пока в ⚙ не выбран список
      ctrl = h('select', { class: 'f sel', style: { color: col } }, Object.entries(lib.RARITY).map(([k, v]) => h('option', { value: k, selected: d.rarity === k }, v.name)));
      ctrl.onchange = () => ctx.change({ rarity: ctrl.value });
    }
    return h('div', { class: 'cx-item', style: { '--c': col } },
      h('div', { class: 'char-top' }, ctx.field('icon', { cls: 'avatar rar', commit: true }),
        h('div', { class: 'grow' }, ctx.field('name', { cls: 'title', commit: true }), ctx.field('kind', { cls: 'sub', placeholder: 'Тип' }))),
      h('div', { class: 'row' }, ctrl, h('label', { class: 'price' }, '🪙', ctx.field('price', { type: 'number', num: true }))),
      ctx.field('desc', { tag: 'textarea', cls: 'notes', placeholder: 'Описание и эффекты', rows: 2, autosize: true }));
  },
  settings(ctx) {
    const { h, data: d } = ctx;
    const lists = ctx.lists();
    const cur = d.rarityList ? `${d.rarityList.card}|${d.rarityList.comp}` : '';
    // при смене списка стараемся сохранить редкость по названию
    const pick = (ref) => {
      const was = itemRarity(d, ctx)?.text?.toLowerCase();
      const opt = ref ? ctx.resolveList(ref)?.items.find((o) => o.text.toLowerCase() === was)?.id || null : null;
      ctx.change({ rarityList: ref, rarityOpt: opt });
    };
    const sel = h('select', { class: 'f sel wide' },
      h('option', { value: '' }, '— встроенные редкости —'),
      lists.map((l) => h('option', { value: `${l.ref.card}|${l.ref.comp}`, selected: cur === `${l.ref.card}|${l.ref.comp}` }, `${l.title} (${l.items.length})`)));
    sel.onchange = () => { const [card, comp] = sel.value.split('|'); pick(sel.value ? { card, comp } : null); };
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Редкость из'), sel,
      h('label', {}, ''), h('button', { class: 'ghost-btn', onClick: () => {
        const ref = ctx.ensureList('Редкость', [['Обычный', '#9ca3af'], ['Необычный', '#22c55e'], ['Редкий', '#3b82f6'], ['Эпический', '#a855f7'], ['Легендарный', '#f59e0b']]);
        pick({ card: ref.card, comp: ref.comp });
      } }, 'Стандартный список «Редкость»'),
      h('div', { class: 'set-note' }, 'Можно взять любой свой список (объект «Список»), например «Качество» или «Тир». Таблицы лута берут редкость предмета отсюда.'));
  },
  text: (d) => [d.name, d.kind, d.desc].join(' '),
  exportMd: (d, x) => `**${d.icon || ''} ${d.name}** — *${itemRarity(d, x)?.text || ''} · ${d.kind} · ${d.price} 🪙*\n\n${d.desc || ''}`,
  exportJson: (d, x) => ({ name: d.name, icon: d.icon, rarity: itemRarity(d, x)?.text ?? null, type: d.kind, price: d.price, description: d.desc }),
};
