// Экспорт/импорт: файл доски, GDD в Markdown, JSON для движка, ссылка-снимок
import { store, newBoard } from './store.js';
import { uid, download, compress, decompress, h, modal, toast } from './util.js';
import { RARITY, STATUS, TILES, PRIORITY, parseSeries, sampleSeries, tileRows } from './widgets.js';
import * as lib from './lib.js';
import { getComponent } from './registry.js';
import { optionOf, cardField } from './card.js';
import { toolById, DONE_RE } from './tools.js';

const HELP = { lib, store, optionOf };
const compMd = (c) => { const def = getComponent(c.type); try { return def?.exportMd ? def.exportMd(c.data, HELP) : ''; } catch { return ''; } };
const compJson = (c) => { const def = getComponent(c.type); try { return def?.exportJson ? def.exportJson(c.data, HELP) : c.data; } catch { return c.data; } };

const slug = (s) => (s || 'board').toLowerCase().replace(/[^\p{L}\d]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'board';

export function exportBoardFile(board = store.board) {
  download(`${slug(board.name)}.gdboard.json`, JSON.stringify({ format: 'gdboard', version: 1, board }, null, 0));
}

export function normalizeImported(obj) {
  const b = obj?.format === 'gdboard' ? obj.board : obj?.board || obj;
  if (!b || typeof b !== 'object' || !b.items) throw new Error('Это не файл GameDev Board');
  const nb = newBoard(b.name || 'Импорт');
  nb.items = b.items; nb.links = b.links || {}; nb.assets = b.assets || {}; nb.view = b.view || nb.view;
  return nb;
}

export async function readBoardFile(file) {
  return normalizeImported(JSON.parse(await file.text()));
}

// ---------- геометрия ----------
const inside = (it, f) => {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  return cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h;
};
const byPos = (a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x);

// ---------- GDD в Markdown ----------
function md(it) {
  const d = it.data;
  const t = (x) => String(x ?? '').trim();
  if (it.type === 'card') {
    const body = (d.components || []).map(compMd).filter((x) => x && x.trim()).join('\n\n');
    return `### ${toolById(d.tool)?.icon || '▭'} ${t(d.title)}\n\n${body}\n`;
  }
  switch (it.type) {
    case 'sticky': case 'shape': return t(d.text) ? `- ${t(d.text).replace(/\n/g, ' ')}` : '';
    case 'text': return t(d.text) ? `**${t(d.text)}**` : '';
    case 'character':
      return `### ${d.avatar || ''} ${t(d.name)} — ${t(d.role)}\n\n| Характеристика | Значение |\n|---|---|\n${d.stats.map((s) => `| ${s.k} | ${s.v} |`).join('\n')}\n${t(d.notes) ? `\n${t(d.notes)}\n` : ''}`;
    case 'loot':
      return `### ${d.icon || ''} ${t(d.name)}\n*${RARITY[d.rarity]?.name || ''} · ${t(d.kind)} · ${d.price} 🪙*\n\n${t(d.desc)}\n`;
    case 'quest':
      return `### 📜 ${t(d.title)}\nВыдаёт: ${t(d.giver)}\n\n${d.objectives.map((o) => `- [${o.done ? 'x' : ' '}] ${o.t}`).join('\n')}\n\nНаграда: ${t(d.reward)}\n`;
    case 'dialogue': {
      const outs = store.outgoing(it.id);
      return `- **${t(d.speaker)}:** ${t(d.text)}` + outs.map((l) => `\n  - → ${l.label || 'далее'}`).join('');
    }
    case 'task':
      return `- [${d.status === 'done' ? 'x' : ' '}] ${d.kind === 'bug' ? '🐞 ' : ''}${t(d.title)} — ${STATUS[d.status]?.name}${d.kind === 'bug' ? `, приоритет: ${PRIORITY[d.priority]}` : `, ${d.tag}`}${d.points ? `, ${d.points} sp` : ''}${d.assignee ? `, ${d.assignee}` : ''}`;
    case 'tilemap': {
      const used = new Set(d.cells);
      return `### 🗺 ${t(d.name)} (${d.cols}×${d.rows})\n\n\`\`\`\n${tileRows(d).join('\n')}\n\`\`\`\nЛегенда: ${[...used].map((c) => `\`${c}\` ${TILES[c]?.name || ''}`).join(', ')}\n`;
    }
    case 'curve': {
      const series = sampleSeries(parseSeries(d.formula), d.from, d.to);
      if (!series.length) return `### 📈 ${t(d.title)}\n\n\`${t(d.formula)}\`\n`;
      const pts = series[0].pts;
      const idx = [...new Set(Array.from({ length: 8 }, (_, i) => Math.round((i / 7) * (pts.length - 1))))];
      return `### 📈 ${t(d.title)}\n\n${series.map((s) => `- ${s.name}: \`${s.expr}\``).join('\n')}\n\n| lvl | ${series.map((s) => s.name).join(' | ')} |\n|---|${series.map(() => '---').join('|')}|\n${idx.map((i) => `| ${pts[i][0]} | ${series.map((s) => (isNaN(s.pts[i][1]) ? '—' : Math.round(s.pts[i][1] * 100) / 100)).join(' | ')} |`).join('\n')}\n`;
    }
    case 'loottable': {
      const tot = d.rows.reduce((a, r) => a + Math.max(0, +r.w || 0), 0) || 1;
      return `### 🎲 ${t(d.title)}\n\n| Предмет | Редкость | Вес | Шанс |\n|---|---|---|---|\n${d.rows.map((r) => `| ${r.name} | ${RARITY[r.r]?.name || ''} | ${r.w} | ${((Math.max(0, +r.w || 0) / tot) * 100).toFixed(1)}% |`).join('\n')}\n`;
    }
    case 'palette': return `### 🎨 ${t(d.title)}\n\n${d.colors.map((c) => `\`${c}\``).join(' ')}\n`;
    case 'sprite': return `- 👾 Спрайт «${t(d.name)}»: сетка ${d.cols}×${d.rows}, ${d.fps} FPS`;
    case 'image': return d.name ? `- 🖼 ${d.name}` : '';
    default: return '';
  }
}

export function exportGDD(board = store.board) {
  const items = Object.values(board.items);
  const frames = items.filter((i) => i.type === 'frame').sort(byPos);
  const used = new Set();
  let out = `# ${board.name}\n\n_Сгенерировано в GameDev Board · ${new Date().toLocaleDateString('ru-RU')}_\n\n`;
  const titles = items.filter((i) => i.type === 'text' && !frames.some((f) => inside(i, f))).sort(byPos);
  if (titles.length) { out += titles.map((t) => `> ${t.data.text}`).join('\n') + '\n\n'; titles.forEach((t) => used.add(t.id)); }
  for (const f of frames) {
    const kids = items.filter((i) => i.type !== 'frame' && !used.has(i.id) && inside(i, f)).sort(byPos);
    kids.forEach((k) => used.add(k.id));
    out += `## ${f.data.title || 'Раздел'}\n\n${kids.map(md).filter(Boolean).join('\n\n')}\n\n`;
  }
  const rest = items.filter((i) => i.type !== 'frame' && !used.has(i.id)).sort(byPos);
  if (rest.length) {
    const body = rest.map(md).filter(Boolean).join('\n\n');
    if (body.trim()) out += `## ${frames.length ? 'Прочее' : 'Содержимое доски'}\n\n${body}\n`;
  }
  download(`${slug(board.name)}-GDD.md`, out.replace(/\n{3,}/g, '\n\n'), 'text/markdown');
}

// ---------- JSON для игрового движка ----------
export function buildEngineData(board = store.board) {
  const items = Object.values(board.items);
  const cards = items.filter((i) => i.type === 'card').sort(byPos);
  const links = Object.values(board.links);
  const outgoing = (id) => links.filter((l) => l.from === id);
  const incoming = (id) => links.filter((l) => l.to === id);
  // все компоненты данного типа со ссылкой на карточку
  const all = (type) => cards.flatMap((c) => (c.data.components || []).filter((x) => x.type === type).map((x) => ({ card: c, comp: x })));
  const pack = (type, key) => all(type).map(({ card, comp }) => ({ id: card.id, card: card.data.title, ...compJson(comp) }));
  const fieldsOf = (c) => Object.fromEntries((c.data.components || []).filter((x) => x.data.label).map((x) => [x.data.label, compJson(x).value ?? compJson(x).text ?? null]));
  return {
    meta: { board: board.name, exportedAt: new Date().toISOString(), generator: 'GameDev Board', version: 2 },
    cards: cards.map((c) => ({ id: c.id, title: c.data.title, tool: c.data.tool, components: (c.data.components || []).map((x) => ({ type: x.type, ...compJson(x) })) })),
    characters: pack('character'),
    items: pack('item'),
    quests: pack('quest'),
    lootTables: pack('loottable'),
    levels: pack('tilemap'),
    maps: pack('mapgen'),
    curves: pack('curve'),
    tables: pack('table'),
    palettes: pack('palette'),
    lists: all('list').map(({ card, comp }) => ({ id: card.id, title: card.data.title, ...compJson(comp) })),
    tasks: cards.filter((c) => c.data.tool === 'task').map((c) => ({ id: c.id, title: c.data.title, done: DONE_RE.test(cardField(c, 'Статус')?.text || ''), ...fieldsOf(c) })),
    bugs: cards.filter((c) => c.data.tool === 'bug').map((c) => ({ id: c.id, ...fieldsOf(c) })),
    dialogues: {
      entryPoints: items.filter((i) => i.type === 'dialogue' && !incoming(i.id).length).map((i) => i.id),
      nodes: items.filter((i) => i.type === 'dialogue').sort(byPos).map((i) => ({
        id: i.id, speaker: i.data.speaker, text: i.data.text,
        choices: outgoing(i.id).map((l) => ({ text: l.label || null, next: l.to, nextType: board.items[l.to]?.type === 'card' ? board.items[l.to].data.tool : board.items[l.to]?.type })),
      })),
    },
  };
}
export function exportEngine(board = store.board) {
  download(`${slug(board.name)}-data.json`, JSON.stringify(buildEngineData(board), null, 2));
}

// ---------- ссылка-снимок ----------
export async function shareLink(board = store.board) {
  const base = location.origin + location.pathname;
  const mk = async (withAssets) => {
    const b = { name: board.name, items: board.items, links: board.links, view: board.view, assets: withAssets ? board.assets : {} };
    return base + '#/s/' + (await compress(JSON.stringify(b)));
  };
  const hasAssets = Object.keys(board.assets || {}).length > 0;
  let url = await mk(true);
  let note = '';
  if (url.length > 60000 && hasAssets) { url = await mk(false); note = 'Картинки не влезли в ссылку — для полной копии используйте экспорт файла доски.'; }
  const inp = h('input', { class: 'input mono', value: url, readonly: true });
  const body = h('div', { class: 'share' },
    h('p', {}, 'Ссылка содержит снимок доски целиком — сервер не нужен. Получатель откроет копию у себя в браузере.'),
    inp,
    note ? h('p', { class: 'warn' }, note) : null,
    h('p', { class: 'muted small' }, `Длина ссылки: ${url.length.toLocaleString('ru-RU')} символов. Для совместной работы в реальном времени используйте кнопку «Совместно».`));
  modal('🔗 Поделиться снимком', body, {
    actions: [{ label: 'Скопировать', primary: true, onClick: () => { navigator.clipboard?.writeText(url).then(() => toast('Ссылка скопирована', 'ok')); inp.select(); return false; } }],
  });
  setTimeout(() => inp.select(), 50);
}
export async function readShared(data) {
  const obj = JSON.parse(await decompress(data));
  const nb = normalizeImported(obj);
  nb.name = (obj.name || 'Доска') + ' (копия)';
  return nb;
}

export function newIdsBoard(b) { b.id = uid('b'); return b; }
