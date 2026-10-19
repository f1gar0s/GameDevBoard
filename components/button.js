// Кнопка-ссылка: по клику переносит к фрейму (или карточке). Настройка — шестерёнка рядом с кнопкой.
export default {
  type: 'button',
  name: 'Кнопка-ссылка',
  icon: '🔘',
  group: 'Базовые',
  description: 'Кнопка, которая переносит к выбранному фрейму',
  openOnAdd: true,
  defaults: () => ({ label: 'Перейти', target: null, color: '#7c5cff' }),
  deps: (d) => [d.target],

  render(ctx) {
    const { h, data: d } = ctx;
    const target = d.target && ctx.store.item(d.target);
    const go = () => {
      if (target) ctx.focusItem(target.id);
      else { ctx.toast('Кнопка не настроена — выберите фрейм через ⚙', 'err'); if (!ctx.settingsOpen) ctx.toggleSettings(); }
    };
    const name = target ? (target.data.title || 'без названия') : null;
    return h('div', { class: 'cx-button' },
      h('button', { class: 'link-btn', style: { '--bc': d.color || '#7c5cff' }, title: name ? 'Перейти к «' + name + '»' : 'Цель не выбрана', onClick: go },
        d.label || 'Перейти', ' ', h('span', { class: 'lb-arrow' }, '→')),
      h('button', { class: 'gear-inline' + (ctx.settingsOpen ? ' on' : ''), title: 'Настроить кнопку', onClick: () => ctx.toggleSettings() }, '⚙'),
      h('span', { class: 'lb-target muted small' }, name ? '→ ' + name : d.target ? '⚠ цель удалена' : 'цель не выбрана'));
  },

  settings(ctx) {
    const { h, data: d } = ctx;
    const frames = ctx.frames();
    const cards = Object.values(ctx.store.items).filter((i) => i.type === 'card' && i.id !== ctx.cardId);
    const sel = h('select', { class: 'f sel wide' },
      h('option', { value: '' }, '— выберите, куда переносить —'),
      frames.length ? h('optgroup', { label: 'Фреймы' }, frames.map((f) => h('option', { value: f.id, selected: d.target === f.id }, f.data.title || 'Фрейм'))) : null,
      cards.length ? h('optgroup', { label: 'Карточки' }, cards.map((c) => h('option', { value: c.id, selected: d.target === c.id }, c.data.title || 'Карточка'))) : null);
    sel.onchange = () => ctx.change({ target: sel.value || null });
    const color = h('input', { type: 'color', value: d.color || '#7c5cff' });
    color.onchange = () => ctx.change({ color: color.value });
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Надпись'), ctx.field('label', { placeholder: 'Перейти', commit: true }),
      h('label', {}, 'Куда'), sel,
      h('label', {}, 'Цвет'), color,
      !frames.length ? h('div', { class: 'set-note' }, 'На доске нет фреймов. Создайте фрейм (клавиша F) и назовите его.') : null);
  },
  text: (d) => d.label,
  exportMd: (d, x) => `[${d.label}] → ${x.store.item(d.target)?.data.title || '—'}`,
  exportJson: (d) => ({ label: d.label, target: d.target }),
};
