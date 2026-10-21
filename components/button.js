// Кнопка-ссылка: по клику открывает фрейм из иерархии или переносит к объекту
// (если объект лежит в другом фрейме — сначала откроется тот фрейм). Настройка — шестерёнка рядом с кнопкой.
// что за цель: { kind: 'page' | 'item', name, where }
function describe(ctx, id) {
  if (!id) return null;
  const node = ctx.store.tree[id];
  if (node?.kind === 'frame') return { kind: 'page', name: ctx.pathOf(id).join(' / ') };
  const it = ctx.store.item(id);
  if (!it) return null;
  const name = it.data.title || it.data.text?.slice(0, 40) || 'объект';
  const page = ctx.pageOf(it);
  const where = page !== ctx.pageOf(ctx.card) ? ctx.pathOf(page).join(' / ') : '';
  return { kind: 'item', name, where };
}

export default {
  type: 'button',
  name: 'Кнопка-ссылка',
  icon: '🔘',
  group: 'Базовые',
  description: 'Кнопка, которая открывает фрейм или переносит к объекту на любом фрейме',
  openOnAdd: true,
  defaults: () => ({ label: 'Перейти', target: null, color: '#7c5cff' }),
  deps: (d) => [d.target],

  render(ctx) {
    const { h, data: d } = ctx;
    const t = describe(ctx, d.target);
    const go = () => {
      if (t) ctx.goTo(d.target);
      else { ctx.toast('Кнопка не настроена — выберите цель через ⚙', 'err'); if (!ctx.settingsOpen) ctx.toggleSettings(); }
    };
    const label = t ? (t.kind === 'page' ? '📄 ' + t.name : '→ ' + t.name + (t.where ? ' · 📄 ' + t.where : '')) : d.target ? '⚠ цель удалена' : 'цель не выбрана';
    return h('div', { class: 'cx-button' },
      h('button', { class: 'link-btn', style: { '--bc': d.color || '#7c5cff' }, title: t ? 'Перейти: ' + t.name : 'Цель не выбрана',
        // срабатываем сразу при нажатии: иначе при первом клике карточка выделяется, панель компонентов сдвигает кнопку и клик «промахивается»
        onPointerdown: (e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); go(); } },
        d.label || 'Перейти', ' ', h('span', { class: 'lb-arrow' }, '→')),
      h('button', { class: 'gear-inline' + (ctx.settingsOpen ? ' on' : ''), title: 'Настроить кнопку', onClick: () => ctx.toggleSettings() }, '⚙'),
      h('span', { class: 'lb-target muted small' }, label));
  },

  settings(ctx) {
    const { h, data: d } = ctx;
    const pages = ctx.pages();
    const pageName = (it) => { const p = ctx.pageOf(it); return p === ctx.pageOf(ctx.card) ? '' : '  · ' + ctx.pathOf(p).join(' / '); };
    const areas = ctx.frames();
    const cards = Object.values(ctx.store.items).filter((i) => i.type === 'card' && i.id !== ctx.cardId);
    const sel = h('select', { class: 'f sel wide' },
      h('option', { value: '' }, '— выберите, куда переносить —'),
      pages.length ? h('optgroup', { label: 'Фреймы (иерархия)' }, pages.map((p) => h('option', { value: p.id, selected: d.target === p.id }, '📄 ' + p.path))) : null,
      areas.length ? h('optgroup', { label: 'Области на холсте' }, areas.map((f) => h('option', { value: f.id, selected: d.target === f.id }, (f.data.title || 'Область') + pageName(f)))) : null,
      cards.length ? h('optgroup', { label: 'Карточки' }, cards.map((c) => h('option', { value: c.id, selected: d.target === c.id }, (c.data.title || 'Карточка') + pageName(c)))) : null);
    sel.onchange = () => ctx.change({ target: sel.value || null });
    const color = h('input', { type: 'color', value: d.color || '#7c5cff' });
    color.onchange = () => ctx.change({ color: color.value });
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Надпись'), ctx.field('label', { placeholder: 'Перейти', commit: true }),
      h('label', {}, 'Куда'), sel,
      h('label', {}, 'Цвет'), color,
      h('div', { class: 'set-note' }, 'Фрейм откроется целиком. Если выбрать карточку или область с другого фрейма, кнопка сначала откроет тот фрейм, а потом покажет объект.'));
  },
  text: (d) => d.label,
  exportMd: (d, x) => `[${d.label}] → ${x.store.tree?.[d.target]?.name || x.store.item(d.target)?.data.title || '—'}`,
  exportJson: (d) => ({ label: d.label, target: d.target }),
};
