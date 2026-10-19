// ПРИМЕР НАСЛЕДОВАНИЯ.
// «Заголовок» не пишет логику заново: он берёт «Текстовую строку» (extends: 'text'),
// вызывает её отрисовку через ctx.base() и добавляет своё — цветную полосу и выбор цвета.
export default {
  type: 'header',
  extends: 'text',
  name: 'Заголовок',
  icon: 'H',
  group: 'Базовые',
  description: 'Текстовая строка крупным шрифтом с цветной полосой (пример наследования)',
  defaults: () => ({ style: 'title', multiline: false, placeholder: 'Заголовок', accent: '#7c5cff' }),

  render(ctx) {
    const el = ctx.base();                 // ← оригинальная логика text.js
    el.classList.add('cx-header');         // ← наш код поверх неё
    el.style.setProperty('--accent', ctx.data.accent || '#7c5cff');
    return el;
  },

  settings(ctx) {
    const box = ctx.base();                // настройки родителя (подпись, стиль…)
    const color = ctx.h('input', { type: 'color', value: ctx.data.accent || '#7c5cff' });
    color.onchange = () => ctx.change({ accent: color.value });
    box.append(ctx.h('label', {}, 'Цвет полосы'), color);
    return box;
  },
};
