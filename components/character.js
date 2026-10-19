// Персонаж: аватар, имя, роль, характеристики с полосками, заметки
export default {
  type: 'character',
  name: 'Персонаж',
  icon: '🧙',
  group: 'Геймдизайн',
  defaults: () => ({ avatar: '🧙', name: 'Новый герой', role: 'Класс / роль', color: '#7c5cff', stats: [{ k: 'HP', v: 100 }, { k: 'ATK', v: 25 }, { k: 'DEF', v: 15 }, { k: 'SPD', v: 40 }], notes: '' }),

  render(ctx) {
    const { h, data: d } = ctx;
    const stats = d.stats || [];
    const statsBox = h('div', { class: 'stats' });
    const total = h('span', { class: 'pill' });
    const refresh = () => {
      const cap = Math.max(100, ...stats.map((x) => +x.v || 0));
      statsBox.querySelectorAll('.stat').forEach((row, i) => { row.querySelector('.bar i').style.width = ctx.clamp(((+stats[i].v || 0) / cap) * 100, 0, 100) + '%'; });
      total.textContent = 'Σ ' + stats.reduce((a, x) => a + (+x.v || 0), 0);
    };
    stats.forEach((st, i) => {
      const k = h('input', { class: 'f stat-k', value: st.k });
      const v = h('input', { class: 'f stat-v', type: 'number', value: st.v });
      k.onfocus = v.onfocus = () => ctx.begin();
      k.oninput = () => { stats[i].k = k.value; ctx.live({ stats }); };
      v.oninput = () => { stats[i].v = +v.value; ctx.live({ stats }); refresh(); };
      statsBox.append(h('div', { class: 'stat' }, k, h('div', { class: 'bar', style: { '--c': d.color } }, h('i')), v,
        h('button', { class: 'x', title: 'Удалить', onClick: () => ctx.change({ stats: stats.filter((_, j) => j !== i) }) }, '×')));
    });
    refresh();
    return h('div', { class: 'cx-character', style: { '--c': d.color } },
      h('div', { class: 'char-top' }, ctx.field('avatar', { cls: 'avatar' }),
        h('div', { class: 'grow' }, ctx.field('name', { cls: 'title' }), ctx.field('role', { cls: 'sub' })), total),
      statsBox,
      h('button', { class: 'add', onClick: () => ctx.change({ stats: [...stats, { k: 'STAT', v: 10 }] }) }, '+ характеристика'),
      ctx.field('notes', { tag: 'textarea', cls: 'notes', placeholder: 'Мотивация, способности, лор…', rows: 2, autosize: true }));
  },
  settings(ctx) {
    const color = ctx.h('input', { type: 'color', value: ctx.data.color || '#7c5cff' });
    color.onchange = () => ctx.change({ color: color.value });
    return ctx.h('div', { class: 'set-grid' }, ctx.h('label', {}, 'Цвет полосок'), color);
  },
  text: (d) => [d.name, d.role, d.notes].join(' '),
  exportMd: (d) => `**${d.avatar || ''} ${d.name}** — ${d.role}\n\n| Характеристика | Значение |\n|---|---|\n${(d.stats || []).map((s) => `| ${s.k} | ${s.v} |`).join('\n')}${d.notes ? `\n\n${d.notes}` : ''}`,
  exportJson: (d) => ({ name: d.name, role: d.role, icon: d.avatar, stats: Object.fromEntries((d.stats || []).map((s) => [s.k, s.v])), notes: d.notes }),
};
