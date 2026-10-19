// Спрайт-анимация из спрайт-листа: колонки, ряды, число кадров, FPS
export default {
  type: 'sprite',
  name: 'Спрайт-анимация',
  icon: '👾',
  group: 'Арт',
  defaults: () => ({ name: 'idle', asset: null, cols: 4, rows: 1, frames: 0, fps: 8, playing: true, fw: 1, fh: 1 }),

  render(ctx) {
    const { h, data: d, lib } = ctx;
    lib.startTicker();
    const src = ctx.asset(d.asset);
    const load = () => ctx.pickImage((data, img) => ctx.change({ asset: ctx.addAsset(data), fw: img.width / (d.cols || 1), fh: img.height / (d.rows || 1) }));
    let preview;
    if (src) {
      const label = h('span', { class: 'muted small' });
      const anim = h('div', {
        class: 'sprite-anim', 'data-cols': d.cols, 'data-rows': d.rows, 'data-fps': d.fps, 'data-frames': d.frames || d.cols * d.rows, 'data-playing': d.playing ? '1' : '0',
        style: { backgroundImage: `url(${src})`, backgroundSize: `${d.cols * 100}% ${d.rows * 100}%`, aspectRatio: `${d.fw || 1} / ${d.fh || 1}` },
      });
      anim._label = label;
      preview = h('div', { class: 'sprite-stage' }, anim, label);
    } else {
      preview = h('div', { class: 'sprite-stage empty' }, h('button', { class: 'ghost-btn', onClick: load }, '⤒ Загрузить спрайт-лист'), h('div', { class: 'muted small' }, 'или перетащите PNG на карточку'));
    }
    const num = (key, min, max) => {
      const inp = h('input', { class: 'f num', type: 'number', min, max, value: d[key] });
      inp.onfocus = () => ctx.begin();
      inp.onchange = () => {
        const v = ctx.clamp(Math.round(+inp.value || min), min, max);
        if (src && (key === 'cols' || key === 'rows')) {
          ctx.loadImage(src).then((img) => {
            const cols = key === 'cols' ? v : d.cols, rows = key === 'rows' ? v : d.rows;
            ctx.set({ [key]: v, fw: img.width / cols, fh: img.height / rows });
          });
        } else ctx.set({ [key]: v });
      };
      return inp;
    };
    return h('div', { class: 'cx-sprite' },
      ctx.field('name', { cls: 'inline-title', placeholder: 'Название анимации' }),
      preview,
      h('div', { class: 'row' }, 'Колонки', num('cols', 1, 64), 'Ряды', num('rows', 1, 64)),
      h('div', { class: 'row' }, 'Кадров', num('frames', 0, 999), 'FPS', num('fps', 1, 60)),
      h('div', { class: 'row' },
        h('button', { class: 'play-btn', onClick: () => ctx.change({ playing: !d.playing }) }, d.playing ? '⏸ Пауза' : '▶ Играть'),
        src ? h('button', { class: 'ghost-btn', onClick: load }, 'Заменить') : null));
  },
  text: (d) => d.name,
  exportMd: (d) => `👾 Спрайт «${d.name}»: сетка ${d.cols}×${d.rows}, ${d.fps} FPS`,
  exportJson: (d) => ({ name: d.name, cols: d.cols, rows: d.rows, frames: d.frames || d.cols * d.rows, fps: d.fps }),
};
