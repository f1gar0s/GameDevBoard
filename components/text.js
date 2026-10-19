// Текстовая строка: подпись + текст (одна строка или абзац)
const STYLES = { normal: 'Обычный', title: 'Крупный', muted: 'Мелкий серый', quote: 'Цитата', code: 'Моноширинный' };

export default {
  type: 'text',
  name: 'Текстовая строка',
  icon: 'T',
  group: 'Базовые',
  description: 'Строка или абзац текста с необязательной подписью',
  defaults: () => ({ label: '', text: '', style: 'normal', multiline: true, placeholder: 'Текст…' }),

  render(ctx) {
    const { h, data: d } = ctx;
    const input = d.multiline
      ? ctx.field('text', { tag: 'textarea', rows: 1, autosize: true, cls: 'c-textarea', placeholder: d.placeholder || 'Текст…' })
      : ctx.field('text', { cls: 'c-input', placeholder: d.placeholder || 'Текст…' });
    return h('div', { class: 'cx-text st-' + (d.style || 'normal') },
      d.label ? h('div', { class: 'c-label' }, d.label) : null, input);
  },

  settings(ctx) {
    const { h, data: d } = ctx;
    const style = h('select', { class: 'f sel' }, Object.entries(STYLES).map(([k, v]) => h('option', { value: k, selected: d.style === k }, v)));
    style.onchange = () => ctx.change({ style: style.value });
    const multi = h('input', { type: 'checkbox', checked: !!d.multiline });
    multi.onchange = () => ctx.change({ multiline: multi.checked });
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Подпись'), ctx.field('label', { placeholder: 'например, Описание', commit: true }),
      h('label', {}, 'Стиль'), style,
      h('label', {}, 'Несколько строк'), multi);
  },

  text: (d) => [d.label, d.text].filter(Boolean).join(' '),
  exportMd: (d) => (d.text ? (d.label ? `**${d.label}:** ${d.text}` : d.text) : ''),
  exportJson: (d) => ({ label: d.label || undefined, text: d.text }),
};
