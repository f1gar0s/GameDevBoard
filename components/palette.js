// Палитра цветов арт-направления
export default {
  type: 'palette',
  name: 'Палитра',
  icon: '🎨',
  group: 'Арт',
  defaults: () => ({ colors: ['#1b1b2f', '#162447', '#1f4068', '#e43f5a', '#f9d56e', '#e8e8e8'] }),

  render(ctx) {
    const { h, data: d } = ctx;
    const colors = d.colors || [];
    return h('div', { class: 'swatches' },
      colors.map((c, i) => {
        const inp = h('input', { type: 'color', value: c });
        inp.onfocus = () => ctx.begin();
        inp.oninput = () => { colors[i] = inp.value; inp.parentElement.style.background = inp.value; inp.parentElement.querySelector('span').textContent = inp.value; ctx.live({ colors }); };
        return h('label', { class: 'sw', style: { background: c } }, inp,
          h('span', { title: 'Клик — скопировать', onClick: (e) => { e.preventDefault(); navigator.clipboard?.writeText(colors[i]); ctx.toast('Скопировано ' + colors[i]); } }, c),
          h('button', { class: 'x', onClick: (e) => { e.preventDefault(); ctx.change({ colors: colors.filter((_, j) => j !== i) }); } }, '×'));
      }),
      h('button', { class: 'sw add-sw', title: 'Добавить цвет', onClick: () => ctx.change({ colors: [...colors, '#888888'] }) }, '+'));
  },
  text: (d) => (d.colors || []).join(' '),
  exportMd: (d) => (d.colors || []).map((c) => `\`${c}\``).join(' '),
  exportJson: (d) => ({ colors: d.colors }),
};
