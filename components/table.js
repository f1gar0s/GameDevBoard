// Таблица: ячейки-поля, добавление/удаление строк и столбцов, экспорт CSV
export default {
  type: 'table',
  name: 'Таблица',
  icon: '▦',
  group: 'Данные',
  defaults: () => ({ header: true, rows: [['Параметр', 'Значение', 'Заметка'], ['Скорость', '5', ''], ['Прыжок', '2.5', '']] }),

  render(ctx) {
    const { h, data: d } = ctx;
    const rows = d.rows?.length ? d.rows : [['']];
    const cols = Math.max(...rows.map((r) => r.length));
    const cell = (r, c) => {
      const inp = h('input', { class: 'tc', value: rows[r][c] ?? '' });
      inp.onfocus = () => ctx.begin();
      inp.oninput = () => { rows[r][c] = inp.value; ctx.live({ rows }); };
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); inp.closest('table').querySelector(`[data-rc="${r + 1}-${c}"]`)?.focus(); }
      };
      inp.dataset.rc = `${r}-${c}`;
      return inp;
    };
    const delRow = (r) => ctx.change({ rows: rows.filter((_, i) => i !== r) });
    const delCol = (c) => ctx.change({ rows: rows.map((row) => row.filter((_, i) => i !== c)) });
    const table = h('table', { class: 'ctable' + (d.header ? ' with-head' : '') },
      h('tr', { class: 'col-ctrl' }, Array.from({ length: cols }, (_, c) => h('td', {}, h('button', { class: 'x', title: 'Удалить столбец', onClick: () => delCol(c) }, '×'))), h('td')),
      rows.map((row, r) => h('tr', {},
        Array.from({ length: cols }, (_, c) => h(r === 0 && d.header ? 'th' : 'td', {}, cell(r, c))),
        h('td', { class: 'row-ctrl' }, h('button', { class: 'x', title: 'Удалить строку', onClick: () => delRow(r) }, '×')))));
    return h('div', { class: 'cx-table' },
      h('div', { class: 'table-scroll scroll' }, table),
      h('div', { class: 'row' },
        h('button', { class: 'add', onClick: () => ctx.change({ rows: [...rows, Array(cols).fill('')] }) }, '+ строка'),
        h('button', { class: 'add', onClick: () => ctx.change({ rows: rows.map((r, i) => [...r, i === 0 && d.header ? 'Колонка ' + (cols + 1) : '']) }) }, '+ столбец')));
  },
  settings(ctx) {
    const { h, data: d } = ctx;
    const head = h('input', { type: 'checkbox', checked: !!d.header });
    head.onchange = () => ctx.change({ header: head.checked });
    const csv = () => {
      const q = (v) => (/[",;\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v);
      ctx.download((ctx.card.data.title || 'table') + '.csv', '﻿' + d.rows.map((r) => r.map((v) => q(v ?? '')).join(',')).join('\n'), 'text/csv');
    };
    return h('div', { class: 'set-grid' },
      h('label', {}, 'Первая строка — заголовок'), head,
      h('label', {}, 'Экспорт'), h('button', { class: 'ghost-btn', onClick: csv }, '⤓ CSV'));
  },
  text: (d) => (d.rows || []).flat().join(' '),
  exportMd: (d) => {
    const rows = d.rows || [];
    if (!rows.length) return '';
    const cols = Math.max(...rows.map((r) => r.length));
    const line = (r) => '| ' + Array.from({ length: cols }, (_, i) => String(r[i] ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |';
    const head = d.header ? rows[0] : Array.from({ length: cols }, (_, i) => 'Колонка ' + (i + 1));
    const body = d.header ? rows.slice(1) : rows;
    return [line(head), '|' + ' --- |'.repeat(cols), ...body.map(line)].join('\n');
  },
  exportJson: (d) => {
    const rows = d.rows || [];
    if (!d.header) return { rows };
    return { columns: rows[0], rows: rows.slice(1).map((r) => Object.fromEntries(rows[0].map((k, i) => [k || 'col' + (i + 1), r[i] ?? '']))) };
  },
};
