// Картинка: загрузка файла или перетаскивание PNG/JPG на карточку
export default {
  type: 'image',
  name: 'Картинка',
  icon: '🖼',
  group: 'Базовые',
  defaults: () => ({ asset: null, name: '', height: 200, fit: 'contain' }),

  render(ctx) {
    const { h, data: d } = ctx;
    const src = ctx.asset(d.asset);
    const load = () => ctx.pickImage((data, img, name) => ctx.change({ asset: ctx.addAsset(data), name }));
    if (!src) return h('div', { class: 'cx-image empty' }, h('button', { class: 'ghost-btn', onClick: load }, '⤒ Загрузить картинку'), h('div', { class: 'muted small' }, 'или перетащите файл на карточку'));
    return h('div', { class: 'cx-image', style: { height: (+d.height || 200) + 'px' } },
      h('img', { src, alt: d.name || '', draggable: 'false', style: { objectFit: d.fit || 'contain' } }));
  },
  settings(ctx) {
    const { h, data: d } = ctx;
    const fit = h('select', { class: 'f sel' }, [['contain', 'Вписать'], ['cover', 'Заполнить'], ['fill', 'Растянуть']].map(([k, v]) => h('option', { value: k, selected: d.fit === k }, v)));
    fit.onchange = () => ctx.change({ fit: fit.value });
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Высота, px'), ctx.field('height', { type: 'number', num: true, cls: 'num', commit: true }),
      h('label', {}, 'Масштаб'), fit,
      h('label', {}, 'Файл'), h('div', { class: 'row' },
        h('button', { class: 'ghost-btn', onClick: () => ctx.pickImage((data, img, name) => ctx.change({ asset: ctx.addAsset(data), name })) }, 'Заменить'),
        d.asset ? h('button', { class: 'ghost-btn', onClick: () => ctx.change({ asset: null }) }, 'Убрать') : null));
  },
  text: (d) => d.name,
  exportMd: (d) => (d.name ? `🖼 ${d.name}` : ''),
  exportJson: (d) => ({ name: d.name, asset: d.asset }),
};
