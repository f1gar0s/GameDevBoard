// Квест: кто выдаёт, цели-чекбоксы, награда
export default {
  type: 'quest',
  name: 'Квест',
  icon: '📜',
  group: 'Геймдизайн',
  defaults: () => ({ title: 'Пропавший караван', giver: 'Староста', objectives: [{ t: 'Найти следы каравана', done: false }, { t: 'Победить разбойников', done: false }], reward: '200 🪙' }),

  render(ctx) {
    const { h, data: d } = ctx;
    const objs = d.objectives || [];
    const done = objs.filter((o) => o.done).length;
    const list = h('div', { class: 'objs' }, objs.map((o, i) => {
      const t = h('input', { class: 'f', value: o.t });
      t.onfocus = () => ctx.begin();
      t.oninput = () => { objs[i].t = t.value; ctx.live({ objectives: objs }); };
      return h('div', { class: 'obj' + (o.done ? ' done' : '') },
        h('input', { type: 'checkbox', checked: o.done, onChange: (e) => ctx.change({ objectives: objs.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) }) }),
        t, h('button', { class: 'x', onClick: () => ctx.change({ objectives: objs.filter((_, j) => j !== i) }) }, '×'));
    }));
    return h('div', { class: 'cx-quest' },
      h('div', { class: 'row' }, ctx.field('title', { cls: 'title' }), h('span', { class: 'pill' }, `${done}/${objs.length}`)),
      h('label', { class: 'kv' }, 'Выдаёт:', ctx.field('giver')),
      list,
      h('button', { class: 'add', onClick: () => ctx.change({ objectives: [...objs, { t: 'Новая цель', done: false }] }) }, '+ цель'),
      h('label', { class: 'kv' }, '🏆', ctx.field('reward', { placeholder: 'Награда' })));
  },
  text: (d) => [d.title, d.giver, d.reward, ...(d.objectives || []).map((o) => o.t)].join(' '),
  exportMd: (d) => `**📜 ${d.title}** (выдаёт: ${d.giver})\n\n${(d.objectives || []).map((o) => `- [${o.done ? 'x' : ' '}] ${o.t}`).join('\n')}\n\nНаграда: ${d.reward}`,
  exportJson: (d) => ({ title: d.title, giver: d.giver, objectives: (d.objectives || []).map((o) => o.t), reward: d.reward }),
};
