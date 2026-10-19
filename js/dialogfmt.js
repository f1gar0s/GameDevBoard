// Формат JSON для диалогов: «один файл — один диалог», условия, действия, сбор текстов
import { store } from './store.js';
import { h, modal, download, toast } from './util.js';

export const PLAYER_RE = /^(игрок|player|герой|hero)$/i;
export const isPlayer = (it) => it?.type === 'dialogue' && PLAYER_RE.test((it.data.speaker || '').trim());

// ---------- команды ----------
export const COND_CMDS = {
  flag: 'флаг включён', item: 'предмет есть в инвентаре', quest: 'задание сейчас активно',
  day: 'сегодня этот день недели (Mon…Sun)', night: 'сейчас ночь',
};
export const ACT_CMDS = {
  set: 'включить флаг', unset: 'выключить флаг', give: 'выдать предмет', take: 'забрать предмет',
  quest: 'выдать задание', unlock: 'отпереть дверь', damage: 'отнять здоровье', event: 'особое событие',
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const tokens = (s) => String(s || '').split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);

export function checkCond(str) {
  const bad = [];
  for (const raw of tokens(str)) {
    const t = raw.replace(/^!/, '');
    const [cmd, val] = t.split(':');
    if (!(cmd in COND_CMDS)) { bad.push(`неизвестное условие «${raw}»`); continue; }
    if (cmd === 'night') { if (val) bad.push(`«${raw}»: у night нет значения`); continue; }
    if (!val) bad.push(`«${raw}»: нет значения после двоеточия`);
    else if (cmd === 'day' && !DAYS.includes(val)) bad.push(`«${raw}»: день пишется как Mon…Sun`);
  }
  return bad;
}
export function checkActs(str) {
  const bad = [];
  for (const t of tokens(str)) {
    const [cmd, val] = t.split(':');
    if (!(cmd in ACT_CMDS)) { bad.push(`новая команда «${t}» — договоритесь с программистом`); continue; }
    if (!val) bad.push(`«${t}»: нет значения после двоеточия`);
    else if (cmd === 'damage' && !/^\d+$/.test(val)) bad.push(`«${t}»: урон — целое число`);
  }
  return bad;
}

// ---------- симуляция для плейтеста ----------
export function newState() {
  return { flags: new Set(), items: new Set(), quests: new Set(), unlocked: new Set(), damage: 0, events: [], night: false, day: DAYS[new Date().getDay()] };
}
export function evalCond(str, st) {
  for (const raw of tokens(str)) {
    const neg = raw.startsWith('!');
    const [cmd, val] = raw.replace(/^!/, '').split(':');
    let ok;
    switch (cmd) {
      case 'flag': ok = st.flags.has(val); break;
      case 'item': ok = st.items.has(val); break;
      case 'quest': ok = st.quests.has(val); break;
      case 'day': ok = st.day === val; break;
      case 'night': ok = st.night; break;
      default: ok = true;
    }
    if (neg ? ok : !ok) return false;
  }
  return true;
}
export function applyActs(str, st) {
  const log = [];
  for (const t of tokens(str)) {
    const [cmd, val] = t.split(':');
    switch (cmd) {
      case 'set': st.flags.add(val); break;
      case 'unset': st.flags.delete(val); break;
      case 'give': st.items.add(val); break;
      case 'take': st.items.delete(val); break;
      case 'quest': st.quests.add(val); break;
      case 'unlock': st.unlocked.add(val); break;
      case 'damage': st.damage += +val || 0; break;
      default: st.events.push(t);
    }
    log.push(t);
  }
  return log;
}

// ---------- сборка диалогов ----------
const slug = (s) => String(s || '').toLowerCase().trim()
  .replace(/[а-яё]/g, (c) => ({ а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' }[c]))
  .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'npc';

const dlgItems = (board) => Object.values(board.items).filter((i) => i.type === 'dialogue');
const outOf = (board, id) => Object.values(board.links).filter((l) => l.from === id);
const inOf = (board, id) => Object.values(board.links).filter((l) => l.to === id);

export function isEntry(it, board = store.board) {
  if (it?.type !== 'dialogue') return false;
  if (it.data.isStart) return true;
  return !inOf(board, it.id).some((l) => board.items[l.from]?.type === 'dialogue');
}
export function entries(board = store.board) {
  return dlgItems(board).filter((i) => isEntry(i, board) && !isPlayer(i)).sort((a, b) => a.y - b.y || a.x - b.x);
}

// Реплика игрока без подписи на стрелке «сворачивается» в кнопку ответа
function collapsible(board, t) {
  if (!isPlayer(t)) return false;
  const outs = outOf(board, t.id).filter((l) => board.items[l.to]);
  return outs.length <= 1 && (!outs.length || !outs[0].label);
}

export function buildDialogue(board, start) {
  const warn = [];
  const ids = new Map();
  const order = [];
  const queue = [start.id];
  const visit = (id) => { if (!ids.has(id)) { ids.set(id, 'n' + (ids.size + 1)); order.push(id); queue.push(id); } };
  ids.set(start.id, 'n1'); order.push(start.id);
  const choicesOf = (it) => {
    const outs = outOf(board, it.id).map((l) => ({ l, t: board.items[l.to] })).filter((x) => x.t);
    return outs;
  };
  // обход в ширину
  for (let qi = 0; qi < queue.length; qi++) {
    const it = board.items[queue[qi]];
    for (const { t } of choicesOf(it)) {
      if (t.type !== 'dialogue') continue;
      if (collapsible(board, t)) {
        const nx = outOf(board, t.id)[0];
        const tt = nx && board.items[nx.to];
        if (tt?.type === 'dialogue') visit(tt.id);
      } else visit(t.id);
    }
  }
  const nodes = order.map((id) => {
    const it = board.items[id];
    const d = it.data;
    const node = { id: ids.get(id), speaker: (d.speaker || '').trim(), text: (d.text || '').trim() };
    if (!node.text) warn.push(`${node.id}: пустая реплика`);
    const acts = tokens(d.actions);
    if (acts.length) node.actions = acts;
    checkActs(d.actions).forEach((m) => warn.push(`${node.id}: ${m}`));
    const outs = choicesOf(it);
    const nextOf = (t) => (t?.type === 'dialogue' && ids.has(t.id) ? ids.get(t.id) : undefined);
    if (outs.length === 1 && !outs[0].l.label && !outs[0].l.cond && !outs[0].l.actions && !collapsible(board, outs[0].t)) {
      const nx = nextOf(outs[0].t);
      if (nx) node.next = nx;
      return node;
    }
    if (outs.length) {
      node.choices = outs.map(({ l, t }) => {
        const c = {};
        let text = (l.label || '').trim();
        let acts2 = tokens(l.actions);
        let target = t;
        if (collapsible(board, t)) {
          if (!text) text = (t.data.text || '').trim();
          acts2 = acts2.concat(tokens(t.data.actions));
          const nx = outOf(board, t.id)[0];
          target = nx ? board.items[nx.to] : null;
        }
        if (!text) { text = 'Далее'; warn.push(`${node.id}: вариант ответа без текста — подставлено «Далее»`); }
        c.text = text;
        if ((l.cond || '').trim()) c.condition = tokens(l.cond).join(' ');
        if (acts2.length) c.actions = acts2;
        const nx = nextOf(target);
        if (nx) c.next = nx;
        checkCond(l.cond).forEach((m) => warn.push(`${node.id} → «${text}»: ${m}`));
        checkActs(l.actions).forEach((m) => warn.push(`${node.id} → «${text}»: ${m}`));
        return c;
      });
    }
    return node;
  });
  const d = start.data;
  const npc = (d.npc || '').trim() || slug(d.speaker);
  const json = { id: (d.dlgId || '').trim() || `${npc}_${slug(d.text).split('_').slice(0, 2).join('_') || 'talk'}` };
  json.npc = npc;
  json.priority = +d.priority || 0;
  if ((d.dcond || '').trim()) json.condition = tokens(d.dcond).join(' ');
  checkCond(d.dcond).forEach((m) => warn.push(`условие запуска: ${m}`));
  json.start = 'n1';
  json.nodes = nodes;
  if (!(d.dlgId || '').trim()) warn.push(`id диалога не задан — взято «${json.id}»`);
  return { json, startId: start.id, warn };
}

export function buildAllDialogues(board = store.board) {
  const list = entries(board).map((e) => buildDialogue(board, e));
  const seen = new Map();
  for (const x of list) {
    if (seen.has(x.json.id)) x.warn.push(`id «${x.json.id}» уже занят другим диалогом`);
    seen.set(x.json.id, x);
  }
  return list;
}

export function collectTexts(board = store.board) {
  const set = new Set();
  for (const { json } of buildAllDialogues(board)) for (const n of json.nodes) {
    if (n.text) set.add(n.text);
    for (const c of n.choices || []) if (c.text) set.add(c.text);
  }
  return [...set];
}

// Предупреждения для вкладки «Проверка»
export function lintFormat(board = store.board) {
  const issues = [];
  for (const x of buildAllDialogues(board)) for (const m of x.warn) {
    if (/id диалога не задан/.test(m)) continue;
    issues.push({ id: x.startId, msg: `Диалог «${x.json.id}»: ${m}` });
  }
  return issues;
}

// ---------- окна экспорта ----------
const pretty = (o) => JSON.stringify(o, null, 2);
export function exportDialoguesDialog() {
  const list = buildAllDialogues();
  if (!list.length) { toast('На доске нет диалогов', 'err'); return; }
  const body = h('div', { class: 'dlg-export' },
    h('p', {}, `Найдено диалогов: ${list.length}. Один файл — один диалог. Начало диалога — реплика, в которую не входят стрелки от других реплик.`),
    list.map((x) => h('div', { class: 'dlg-row' },
      h('div', { class: 'grow' },
        h('b', { class: 'mono' }, `${x.json.id}.json`),
        h('div', { class: 'muted small' }, `npc: ${x.json.npc} · приоритет ${x.json.priority} · реплик: ${x.json.nodes.length}${x.json.condition ? ' · условие: ' + x.json.condition : ''}`),
        x.warn.length ? h('ul', { class: 'dlg-warn' }, x.warn.map((w) => h('li', {}, w))) : null),
      h('button', { class: 'ghost-btn', onClick: () => download(`${x.json.id}.json`, pretty(x.json)) }, '⤓ Скачать'))));
  modal('💬 Экспорт диалогов', body, {
    wide: true,
    actions: [
      { label: 'Собрать все тексты', onClick: () => { exportTexts(); return false; } },
      { label: `Скачать все (${list.length})`, primary: true, onClick: () => { list.forEach((x, i) => setTimeout(() => download(`${x.json.id}.json`, pretty(x.json)), i * 350)); return false; } },
    ],
  });
}

export function exportTexts() {
  const texts = collectTexts();
  if (!texts.length) { toast('Тексты не найдены', 'err'); return; }
  const q = (s) => '"' + s.replace(/"/g, '""') + '"';
  const csv = '﻿ru,en\n' + texts.map((t) => `${q(t)},""`).join('\n') + '\n';
  download(`texts_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
  toast(`Собрано строк: ${texts.length}`, 'ok');
}
