import { videoPageUrl as ctxUrl } from '../js/util.js';
// Видео (YouTube, RuTube, VK Видео) внутри карточки: вставьте ссылку — смотрите прямо на доске
export default {
  type: 'video',
  name: 'Видео',
  icon: '▶',
  group: 'Базовые',
  description: 'Плеер YouTube / RuTube / VK Видео: смотреть, не уходя с доски',
  defaults: () => ({ src: 'yt', id: '', start: 0, url: '', title: '' }),

  render(ctx) {
    const { h, data: d, lib } = ctx;
    if (!d.id) {
      const inp = h('input', { class: 'f', placeholder: 'Ссылка YouTube, RuTube или VK Видео + Enter' });
      const go = () => {
        const yt = ctx.parseYouTube(inp.value);
        if (!yt) { ctx.toast('Не похоже на ссылку YouTube, RuTube или VK Видео', 'err'); return; }
        ctx.change({ src: yt.src, id: yt.id, hash: yt.hash || '', start: yt.start, url: yt.url });
        ctx.youTubeTitle(yt.url).then((title) => title && ctx.set({ title }));
      };
      inp.onkeydown = (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); };
      return h('div', { class: 'cx-video empty' }, h('div', { class: 'row' }, inp, h('button', { class: 'ghost-btn', onClick: go }, 'OK')));
    }
    return h('div', { class: 'cx-video' },
      d.title ? h('div', { class: 'c-label' }, d.title) : null,
      lib.renderYouTube(d, ctx.compId, () => ctx.rerender()));
  },
  settings(ctx) {
    const { h, data: d } = ctx;
    const inp = h('input', { class: 'f', value: d.url || '', placeholder: 'https://youtu.be/…' });
    inp.onchange = () => {
      const yt = ctx.parseYouTube(inp.value);
      if (!yt) { ctx.toast('Не похоже на ссылку YouTube, RuTube или VK Видео', 'err'); return; }
      ctx.change({ src: yt.src, id: yt.id, hash: yt.hash || '', start: yt.start, url: yt.url, title: '' });
      ctx.youTubeTitle(yt.url).then((title) => title && ctx.set({ title }));
    };
    return h('div', { class: 'set-grid' }, h('label', {}, 'Ссылка'), inp,
      h('label', {}, 'Старт, сек'), ctx.field('start', { type: 'number', num: true, cls: 'num', commit: true }));
  },
  text: (d) => d.title || d.url,
  exportMd: (d) => (d.id ? `▶ [${d.title || 'Видео'}](${ctxUrl(d)})` : ''),
  exportJson: (d) => ({ site: d.src || 'yt', videoId: d.id, youtubeId: (d.src || 'yt') === 'yt' ? d.id : undefined, start: d.start, title: d.title, url: d.url }),
};
