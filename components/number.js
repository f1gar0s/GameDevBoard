// Число с подписью и кнопками − / +
export default {
  type: 'number',
  name: 'Число',
  icon: '#',
  group: 'Базовые',
  defaults: () => ({ label: 'Значение', value: 0, step: 1, unit: '' }),

  render(ctx) {
    const { h, data: d } = ctx;
    const inp = ctx.field('value', { type: 'number', num: true, cls: 'num c-num' });
    const bump = (k) => ctx.change({ value: Math.round(((+ctx.data.value || 0) + k * (+d.step || 1)) * 1000) / 1000 });
    return h('div', { class: 'cx-number' },
      h('span', { class: 'c-label inline' }, d.label || 'Число'),
      h('span', { class: 'grow' }),
      h('button', { class: 'nb', onClick: () => bump(-1) }, '−'), inp, h('button', { class: 'nb', onClick: () => bump(1) }, '+'),
      d.unit ? h('span', { class: 'muted small' }, d.unit) : null);
  },
  settings(ctx) {
    const { h } = ctx;
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Подпись'), ctx.field('label', { commit: true }),
      h('label', {}, 'Шаг'), ctx.field('step', { type: 'number', num: true, cls: 'num', commit: true }),
      h('label', {}, 'Единица'), ctx.field('unit', { placeholder: 'шт, %, 🪙', commit: true }));
  },
  text: (d) => `${d.label} ${d.value}`,
  exportMd: (d) => `**${d.label}:** ${d.value}${d.unit ? ' ' + d.unit : ''}`,
  exportJson: (d) => ({ label: d.label, value: +d.value || 0, unit: d.unit || undefined }),
};
