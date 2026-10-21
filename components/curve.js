// Кривая баланса: формулы от lvl, несколько графиков, подсказка при наведении
export default {
  type: 'curve',
  name: 'Кривая баланса',
  icon: '📈',
  group: 'Уровни и баланс',
  defaults: () => ({ title: 'Опыт до уровня', formula: 'XP: 100 * lvl^1.5\nНаграда: 40 * lvl + 10', from: 1, to: 30 }),

  render(ctx) {
    const { h, lib } = ctx;
    const holder = h('div', { class: 'chart-holder' });
    const W = ctx.width, H = 170;
    const redraw = () => lib.drawChart(holder, ctx.store.item(ctx.cardId)?.data.components.find((c) => c.id === ctx.compId)?.data || ctx.data, W, H);
    lib.drawChart(holder, ctx.data, W, H);
    return h('div', { class: 'cx-curve' },
      ctx.field('title', { cls: 'title', placeholder: 'Название' }),
      ctx.field('formula', { tag: 'textarea', rich: false, cls: 'mono', rows: 2, autosize: true, placeholder: 'Имя: формула от lvl, напр. 50*lvl^2', onLive: redraw }),
      h('div', { class: 'row' }, 'lvl от', ctx.field('from', { type: 'number', num: true, cls: 'num', onLive: redraw }), 'до', ctx.field('to', { type: 'number', num: true, cls: 'num', onLive: redraw }),
        h('span', { class: 'help', title: 'Переменная: lvl (или x). Доступно: + - * / ^ %, floor, round, sqrt, log, pow, min, max, abs, clamp(v,a,b), lerp(a,b,t), PI, E и a ? b : c. Каждая строка — отдельная кривая «Имя: формула».' }, '?')),
      holder);
  },
  text: (d) => [d.title, d.formula].join(' '),
  exportMd: (d, x) => {
    const series = x.lib.sampleSeries(x.lib.parseSeries(d.formula), d.from, d.to);
    if (!series.length) return `**📈 ${d.title}**\n\n\`${d.formula}\``;
    const pts = series[0].pts;
    const idx = [...new Set(Array.from({ length: 8 }, (_, i) => Math.round((i / 7) * (pts.length - 1))))];
    return `**📈 ${d.title}**\n\n${series.map((s) => `- ${s.name}: \`${s.expr}\``).join('\n')}\n\n| lvl | ${series.map((s) => s.name).join(' | ')} |\n|---|${series.map(() => '---').join('|')}|\n${idx.map((i) => `| ${pts[i][0]} | ${series.map((s) => (isNaN(s.pts[i][1]) ? '—' : Math.round(s.pts[i][1] * 100) / 100)).join(' | ')} |`).join('\n')}`;
  },
  exportJson: (d, x) => ({
    title: d.title, from: d.from, to: d.to,
    series: x.lib.sampleSeries(x.lib.parseSeries(d.formula), d.from, d.to).map((s) => ({ name: s.name, formula: s.expr, values: Object.fromEntries(s.pts.map(([px, y]) => [px, isNaN(y) ? null : Math.round(y * 1000) / 1000])) })),
  }),
};
