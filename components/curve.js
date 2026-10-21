// Кривая баланса: несколько формул от lvl (каждая — своя строка, «+ формула» добавляет новую),
// общий график, значение каждой формулы на выбранном уровне и таблица значений.
const parseRows = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
  let m = line.match(/^([^:?]{1,30}):(.+)$/u);
  if (m && (!/\p{L}/u.test(m[1]) || /[()]/.test(m[1]))) m = null;
  return { name: m ? m[1].trim() : `f${i + 1}`, expr: (m ? m[2] : line).trim() };
});
const joinRows = (rows) => rows.map((r) => `${(r.name || 'f').replace(/[:\n]/g, ' ').trim() || 'f'}: ${r.expr.replace(/\n/g, ' ')}`).join('\n');
const MAX = 8;

export default {
  type: 'curve',
  name: 'Кривая баланса',
  icon: '📈',
  group: 'Уровни и баланс',
  defaults: () => ({ title: 'Опыт до уровня', formula: 'XP: 100 * lvl^1.5\nНаграда: 40 * lvl + 10', from: 1, to: 30, at: 10, table: false }),

  render(ctx) {
    const { h, lib } = ctx;
    const cur = () => ctx.store.item(ctx.cardId)?.data.components.find((c) => c.id === ctx.compId)?.data || ctx.data;
    let rows = parseRows(ctx.data.formula);
    const holder = h('div', { class: 'chart-holder' });
    const W = ctx.width, H = 180;
    const valEls = [];
    const tableBox = h('div', { class: 'curve-table' });
    const calc = (expr, x) => { try { const y = +lib.compileFormula(expr)(x); return isFinite(y) ? y : NaN; } catch { return null; } };
    const refresh = () => {
      const d = cur();
      lib.drawChart(holder, d, W, H);
      const at = +d.at || +d.from || 1;
      rows.forEach((r, i) => {
        const v = calc(r.expr, at);
        if (!valEls[i]) return;
        valEls[i].textContent = v === null ? '⚠' : isNaN(v) ? '—' : lib.fmt(v);
        valEls[i].title = v === null ? 'Ошибка в формуле' : `${r.name} при lvl = ${at}`;
        valEls[i].parentElement.classList.toggle('bad', v === null);
      });
      if (d.table) {
        const from = Math.round(+d.from || 0), to = Math.max(from + 1, Math.round(+d.to || 0));
        const n = Math.min(12, to - from + 1);
        const lv = [...new Set(Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / Math.max(1, n - 1))))];
        tableBox.replaceChildren(h('table', {},
          h('tr', {}, h('th', {}, 'lvl'), rows.map((r, i) => h('th', { style: { color: lib.SERIES_COLORS[i] } }, r.name))),
          lv.map((x) => h('tr', {}, h('td', {}, x), rows.map((r) => { const v = calc(r.expr, x); return h('td', {}, v === null || isNaN(v) ? '—' : lib.fmt(v)); })))));
      } else tableBox.replaceChildren();
    };
    const save = () => ctx.live({ formula: joinRows(rows) });
    const rowEl = (r, i) => {
      const name = h('input', { class: 'f cv-name', value: r.name, placeholder: 'Имя' });
      const expr = h('input', { class: 'f cv-expr mono', value: r.expr, placeholder: 'формула от lvl, напр. 50*lvl^2' });
      const val = h('span', { class: 'cv-val mono' });
      valEls[i] = val;
      for (const el of [name, expr]) {
        el.addEventListener('focus', () => ctx.begin());
        el.addEventListener('change', () => setTimeout(() => ctx.set({}), 0));
      }
      name.oninput = () => { r.name = name.value; save(); refresh(); };
      expr.oninput = () => { r.expr = expr.value; save(); refresh(); };
      return h('div', { class: 'cv-row' },
        h('i', { class: 'cv-dot', style: { background: lib.SERIES_COLORS[i] } }), name, h('span', { class: 'muted' }, '='), expr,
        h('span', { class: 'cv-res' }, val),
        h('button', { class: 'cv-del', title: 'Убрать формулу', onClick: () => { rows.splice(i, 1); ctx.change({ formula: joinRows(rows) }); } }, '×'));
    };
    const add = () => {
      if (rows.length >= MAX) { ctx.toast(`Не больше ${MAX} формул на одном графике`, 'err'); return; }
      rows.push({ name: 'Формула ' + (rows.length + 1), expr: (rows.length + 1) * 10 + ' * lvl' });
      ctx.change({ formula: joinRows(rows) });
    };
    const d = ctx.data;
    const at = ctx.field('at', { type: 'number', num: true, cls: 'num', onLive: refresh });
    if (d.at == null) at.value = d.from ?? 1;
    const node = h('div', { class: 'cx-curve' },
      ctx.field('title', { cls: 'title', placeholder: 'Название' }),
      h('div', { class: 'cv-rows' }, rows.map(rowEl)),
      h('div', { class: 'row' },
        h('button', { class: 'ghost-btn', title: 'Добавить ещё одну формулу на график', onClick: add }, '+ Формула'),
        h('span', { class: 'grow' }),
        h('span', { class: 'muted small' }, 'значение при lvl'), at),
      h('div', { class: 'row' }, 'lvl от', ctx.field('from', { type: 'number', num: true, cls: 'num', onLive: refresh }), 'до', ctx.field('to', { type: 'number', num: true, cls: 'num', onLive: refresh }),
        h('span', { class: 'help', title: 'Переменная: lvl (или x). Доступно: + - * / ^ %, floor, round, sqrt, log, pow, min, max, abs, clamp(v,a,b), lerp(a,b,t), PI, E и a ? b : c.' }, '?'),
        h('span', { class: 'grow' }),
        h('button', { class: 'ghost-btn' + (d.table ? ' on' : ''), title: 'Таблица значений по уровням', onClick: () => ctx.change({ table: !d.table }) }, '▦ Таблица')),
      holder, tableBox);
    refresh();
    return node;
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
