// Плейтест: проигрывание диалоговых графов (тест уровня оставлен для совместимости, в интерфейсе не используется)
import { h, modal, toast } from './util.js';
import { store } from './store.js';
import { TILES, RARITY } from './widgets.js';
import { nodeOf } from './canvas.js';
import { newState, evalCond, applyActs, isPlayer } from './dialogfmt.js';

// ================= ДИАЛОГИ =================
function nodeView(it) {
  let d = it.data || {};
  if (it.type === 'card') {
    // карточка с компонентами: показываем первый «говорящий» компонент
    const pick = (t) => d.components?.find((c) => c.type === t)?.data;
    if (pick('quest')) return nodeView({ type: 'quest', data: pick('quest') });
    if (pick('item')) return nodeView({ type: 'loot', data: pick('item') });
    if (pick('character')) return nodeView({ type: 'character', data: pick('character') });
    const txt = d.components?.filter((c) => c.type === 'text' || c.type === 'header').map((c) => c.data.text).filter(Boolean).join('\n');
    return { speaker: d.title || '', text: txt || '…', cls: 'narr' };
  }
  switch (it.type) {
    case 'dialogue': return { speaker: d.speaker || '—', text: d.text || '' };
    case 'quest': return { speaker: '📜 Квест получен', text: `${d.title}\n${(d.objectives || []).map((o) => '• ' + o.t).join('\n')}${d.reward ? `\nНаграда: ${d.reward}` : ''}`, cls: 'sys' };
    case 'loot': return { speaker: '🎁 Получен предмет', text: `${d.icon || ''} ${d.name} (${RARITY[d.rarity]?.name || ''})\n${d.desc || ''}`, cls: 'sys' };
    case 'character': return { speaker: `${d.avatar || ''} ${d.name}`, text: d.notes || d.role || '' };
    default: return { speaker: '', text: d.text || d.title || d.name || '…', cls: 'narr' };
  }
}

export function playDialogue(startId) {
  if (!store.item(startId)) return;
  const trail = [];
  const snaps = [];
  const vias = [];
  let st = newState();
  let ignore = false;
  let typing = null;
  const body = h('div', { class: 'vn' });
  let curEl = null;
  const mark = (id) => {
    curEl?.classList.remove('playing');
    curEl = nodeOf(id);
    curEl?.classList.add('playing');
  };
  const clone = (x) => ({ ...x, flags: new Set(x.flags), items: new Set(x.items), quests: new Set(x.quests), unlocked: new Set(x.unlocked), events: [...x.events] });
  const onKey = (e) => {
    if (e.target.closest?.('input, select')) return;
    if (/^[1-9]$/.test(e.key)) { body.querySelectorAll('.vn-choice:not(:disabled)')[+e.key - 1]?.click(); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (typing) typing(); else { const cs = body.querySelectorAll('.vn-choice:not(:disabled)'); if (cs.length === 1) cs[0].click(); } }
    else if (e.key === 'Backspace') body.querySelector('.vn-back')?.click();
  };
  document.addEventListener('keydown', onKey);
  modal('▶ Плейтест диалога', body, { wide: true, onClose: () => { document.removeEventListener('keydown', onKey); curEl?.classList.remove('playing'); } });

  const restart = () => { trail.length = 0; snaps.length = 0; vias.length = 0; st = newState(); show(startId); };

  function statePanel(rerender) {
    const chips = [];
    st.flags.forEach((f) => chips.push(['flag', f, () => st.flags.delete(f)]));
    st.items.forEach((f) => chips.push(['item', f, () => st.items.delete(f)]));
    st.quests.forEach((f) => chips.push(['quest', f, () => st.quests.delete(f)]));
    st.unlocked.forEach((f) => chips.push(['unlock', f, () => st.unlocked.delete(f)]));
    const add = h('input', { class: 'f mono st-add', placeholder: 'give:cat_food, set:флаг…' });
    add.onkeydown = (e) => { if (e.key === 'Enter') { applyActs(add.value, st); rerender(); } e.stopPropagation(); };
    const day = h('select', { class: 'sel' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('option', { value: d, selected: st.day === d }, d)));
    day.onchange = () => { st.day = day.value; rerender(); };
    return h('div', { class: 'vn-state' },
      h('span', { class: 'muted small' }, 'Состояние игры:'),
      chips.length ? chips.map(([k, v, del]) => h('button', { class: 'st-chip st-' + k, title: 'Убрать', onClick: () => { del(); rerender(); } }, `${k}:${v} ×`)) : h('span', { class: 'muted small' }, 'пусто'),
      st.damage ? h('span', { class: 'st-chip st-dmg' }, `урон ${st.damage}`) : null,
      st.events.length ? h('span', { class: 'st-chip st-event', title: st.events.join(', ') }, `событий: ${st.events.length}`) : null,
      add, day,
      h('label', { class: 'st-tog' }, h('input', { type: 'checkbox', checked: st.night, onChange: (e) => { st.night = e.target.checked; rerender(); } }), 'ночь'),
      h('label', { class: 'st-tog' }, h('input', { type: 'checkbox', checked: ignore, onChange: (e) => { ignore = e.target.checked; rerender(); } }), 'игнорировать условия'));
  }

  function show(id, viaActs = '') {
    const it = store.item(id);
    if (!it) return;
    snaps.push(clone(st));
    vias.push(viaActs);
    trail.push(id);
    mark(id);
    const fired = [...(viaActs ? applyActs(viaActs, st) : []), ...(it.type === 'dialogue' ? applyActs(it.data.actions, st) : [])];
    const v = nodeView(it);
    const textEl = h('div', { class: 'vn-text' });
    const outs = store.outgoing(id).map((l) => ({ l, t: store.item(l.to) })).filter((x) => x.t);
    const choices = h('div', { class: 'vn-choices' });
    const stateBox = h('div');
    const renderChoices = () => {
      choices.replaceChildren();
      stateBox.replaceChildren(statePanel(() => { renderChoices(); }));
      if (!outs.length) {
        choices.append(h('div', { class: 'vn-end' }, '— Конец разговора —'),
          h('button', { class: 'vn-choice', onClick: restart }, '↺ Сначала'));
        return;
      }
      let n = 0;
      outs.forEach(({ l, t }) => {
        let label = l.label;
        if (!label) label = t.type === 'dialogue' && isPlayer(t) ? t.data.text : 'Далее →';
        const ok = ignore || evalCond(l.cond, st);
        choices.append(h('button', {
          class: 'vn-choice' + (ok ? '' : ' locked'), disabled: !ok,
          title: l.cond ? 'Условие: ' + l.cond : null,
          onClick: () => show(t.id, l.actions || ''),
        }, h('b', {}, ok ? ++n : '🔒'), ' ', label || '…',
          l.cond ? h('span', { class: 'ch-tag cond' }, '? ' + l.cond) : null,
          l.actions ? h('span', { class: 'ch-tag act' }, '⚡ ' + l.actions) : null));
      });
    };
    const full = v.text;
    let i = 0;
    const tick = setInterval(() => {
      i += 2;
      textEl.textContent = full.slice(0, i);
      if (i >= full.length) finish();
    }, 18);
    const finish = () => { clearInterval(tick); textEl.textContent = full; typing = null; renderChoices(); };
    typing = finish;
    textEl.addEventListener('click', () => typing?.());
    const startCond = trail.length === 1 && it.data?.dcond ? it.data.dcond : '';
    body.replaceChildren(
      startCond ? h('div', { class: 'vn-cond ' + (evalCond(startCond, snaps[0]) ? 'ok' : 'bad') }, `Условие запуска «${startCond}»: ${evalCond(startCond, snaps[0]) ? 'выполнено' : 'сейчас НЕ выполнено — в игре диалог бы не запустился'}`) : null,
      h('div', { class: 'vn-scene ' + (v.cls || '') },
        v.speaker ? h('div', { class: 'vn-speaker' }, v.speaker) : null,
        textEl,
        fired.length ? h('div', { class: 'vn-acts' }, '⚡ ', fired.join('  ')) : null),
      choices,
      stateBox,
      h('div', { class: 'vn-foot' },
        h('button', { class: 'ghost-btn vn-back', disabled: trail.length < 2, onClick: () => { trail.pop(); snaps.pop(); vias.pop(); const prev = trail.pop(); st = snaps.pop(); show(prev, vias.pop()); } }, '← Назад'),
        h('span', { class: 'muted' }, `Шаг ${trail.length} · клавиши 1–9, Enter, Backspace`),
        h('button', { class: 'ghost-btn', onClick: restart }, '↺ Заново')));
  }
  show(startId);
}

// Анализ диалоговых графов: тупики и недостижимые реплики
export function lintDialogues() {
  const dl = Object.values(store.items).filter((i) => i.type === 'dialogue');
  const issues = [];
  for (const d of dl) {
    const inc = store.incoming(d.id).length, out = store.outgoing(d.id).length;
    if (!d.data.text?.trim()) issues.push({ id: d.id, msg: 'Пустая реплика' });
    if (!inc && !out) issues.push({ id: d.id, msg: 'Реплика ни с чем не связана' });
    const outs = store.outgoing(d.id);
    if (outs.length > 1 && outs.some((l) => !l.label)) issues.push({ id: d.id, msg: 'Есть вариант ответа без подписи' });
  }
  return issues;
}

// ================= ТЕСТ УРОВНЯ =================
export function testLevel(id) {
  const it = store.item(id);
  if (!it) return;
  const d = it.data;
  const grid = [];
  for (let r = 0; r < d.rows; r++) grid.push(d.cells.slice(r * d.cols, (r + 1) * d.cols).split(''));
  let start = null;
  const enemies = [];
  let totalCoins = 0;
  grid.forEach((row, r) => row.forEach((ch, c) => {
    if (ch === 'P') { start = { r, c }; row[c] = '.'; }
    if (ch === 'E') { enemies.push({ r, c, r0: r, c0: c }); row[c] = '.'; }
    if (ch === 'C') totalCoins++;
  }));
  if (!start) { toast('Поставьте на карту старт игрока (@)', 'err'); return; }
  const orig = grid.map((r) => [...r]);
  const cell = Math.max(14, Math.min(36, Math.floor(Math.min(820 / d.cols, 480 / d.rows))));
  const cv = h('canvas', { width: d.cols * cell, height: d.rows * cell, class: 'lvl-canvas', tabindex: 0 });
  const hud = h('div', { class: 'lvl-hud' });
  const msg = h('div', { class: 'lvl-msg' });
  const st = { p: { ...start }, coins: 0, keys: 0, deaths: 0, t0: performance.now(), won: false, flash: 0 };
  const reset = (full) => {
    st.p = { ...start };
    enemies.forEach((e) => { e.r = e.r0; e.c = e.c0; });
    if (full) { grid.forEach((row, r) => row.forEach((_, c) => (row[c] = orig[r][c]))); st.coins = 0; st.keys = 0; st.deaths = 0; st.t0 = performance.now(); st.won = false; msg.textContent = ''; msg.className = 'lvl-msg'; }
  };
  const passable = (r, c, forEnemy) => {
    if (r < 0 || c < 0 || r >= d.rows || c >= d.cols) return false;
    const ch = grid[r][c];
    if (ch === '#') return false;
    if (ch === 'D') return !forEnemy && st.keys > 0;
    if (forEnemy && (ch === '~' || ch === 'X')) return false;
    return true;
  };
  const die = (why) => { st.deaths++; st.flash = 1; msg.textContent = why; msg.className = 'lvl-msg bad'; reset(false); };
  const step = (dr, dc) => {
    if (st.won) return;
    const r = st.p.r + dr, c = st.p.c + dc;
    if (!passable(r, c)) return;
    if (grid[r][c] === 'D') { st.keys--; grid[r][c] = '.'; msg.textContent = 'Дверь открыта'; msg.className = 'lvl-msg'; }
    st.p = { r, c };
    const ch = grid[r][c];
    if (ch === 'C') { st.coins++; grid[r][c] = '.'; }
    if (ch === 'K') { st.keys++; grid[r][c] = '.'; msg.textContent = 'Ключ подобран'; msg.className = 'lvl-msg'; }
    if (ch === '~') return die('Сгорел в лаве! ☠');
    if (enemies.some((e) => e.r === r && e.c === c)) return die('Пойман врагом! ☠');
    if (ch === 'X') {
      st.won = true;
      const t = ((performance.now() - st.t0) / 1000).toFixed(1);
      msg.textContent = `🏁 Уровень пройден за ${t} с · монеты ${st.coins}/${totalCoins} · смертей ${st.deaths}`;
      msg.className = 'lvl-msg good';
    }
  };
  const enemyTimer = setInterval(() => {
    if (st.won) return;
    for (const e of enemies) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      // враги немного тянутся к игроку
      dirs.sort(() => Math.random() - 0.5);
      if (Math.random() < 0.45) dirs.sort((a, b) => Math.abs(e.r + a[0] - st.p.r) + Math.abs(e.c + a[1] - st.p.c) - (Math.abs(e.r + b[0] - st.p.r) + Math.abs(e.c + b[1] - st.p.c)));
      for (const [dr, dc] of dirs) if (passable(e.r + dr, e.c + dc, true)) { e.r += dr; e.c += dc; break; }
      if (e.r === st.p.r && e.c === st.p.c) { die('Пойман врагом! ☠'); break; }
    }
  }, 420);
  const KEYS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], KeyW: [-1, 0], KeyS: [1, 0], KeyA: [0, -1], KeyD: [0, 1] };
  const onKey = (e) => {
    if (KEYS[e.code]) { e.preventDefault(); step(...KEYS[e.code]); }
    if (e.code === 'KeyR') reset(true);
  };
  document.addEventListener('keydown', onKey);
  let raf;
  const g = cv.getContext('2d');
  const draw = (t) => {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let r = 0; r < d.rows; r++) for (let c = 0; c < d.cols; c++) {
      const ch = grid[r][c];
      g.fillStyle = ch === '#' ? TILES['#'].color : ch === '~' ? (Math.sin(t / 200 + c) > 0 ? '#dc2626' : '#b91c1c') : TILES['.'].color;
      g.fillRect(c * cell, r * cell, cell, cell);
      if (ch === '#') { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(c * cell, r * cell, cell, 3); }
      g.font = `${Math.floor(cell * 0.7)}px system-ui, sans-serif`;
      if (ch === 'C') { g.fillStyle = '#facc15'; g.beginPath(); g.arc(c * cell + cell / 2, r * cell + cell / 2 + Math.sin(t / 250 + c + r) * 2, cell * 0.22, 0, 7); g.fill(); }
      if (ch === 'K') { const x = c * cell, y = r * cell; g.fillStyle = '#fb923c'; g.beginPath(); g.arc(x + cell * 0.35, y + cell / 2, cell * 0.17, 0, 7); g.fill(); g.fillRect(x + cell * 0.45, y + cell * 0.45, cell * 0.38, cell * 0.1); g.fillRect(x + cell * 0.72, y + cell * 0.5, cell * 0.08, cell * 0.16); }
      if (ch === 'D') { g.fillStyle = '#a16207'; g.fillRect(c * cell + 3, r * cell + 2, cell - 6, cell - 4); g.fillStyle = '#facc15'; g.fillRect(c * cell + cell - 9, r * cell + cell / 2, 3, 3); }
      if (ch === 'X') { const x = c * cell, y = r * cell; g.fillStyle = '#e5e7eb'; g.fillRect(x + cell * 0.28, y + cell * 0.15, cell * 0.08, cell * 0.72); g.fillStyle = Math.sin(t / 200) > 0 ? '#a78bfa' : '#c4b5fd'; g.beginPath(); g.moveTo(x + cell * 0.36, y + cell * 0.15); g.lineTo(x + cell * 0.8, y + cell * 0.3); g.lineTo(x + cell * 0.36, y + cell * 0.48); g.fill(); }
    }
    const blob = (c, r, col, bob) => {
      const x = c * cell, y = r * cell + bob;
      g.fillStyle = col;
      g.beginPath(); g.roundRect ? g.roundRect(x + cell * 0.14, y + cell * 0.14, cell * 0.72, cell * 0.72, cell * 0.2) : g.rect(x + cell * 0.14, y + cell * 0.14, cell * 0.72, cell * 0.72); g.fill();
      g.fillStyle = '#fff'; g.fillRect(x + cell * 0.3, y + cell * 0.34, cell * 0.14, cell * 0.18); g.fillRect(x + cell * 0.56, y + cell * 0.34, cell * 0.14, cell * 0.18);
      g.fillStyle = '#0b0d12'; g.fillRect(x + cell * 0.34, y + cell * 0.4, cell * 0.07, cell * 0.1); g.fillRect(x + cell * 0.6, y + cell * 0.4, cell * 0.07, cell * 0.1);
    };
    for (const e of enemies) blob(e.c, e.r, '#ef4444', Math.sin(t / 150 + e.c0) * 1.5);
    blob(st.p.c, st.p.r, st.won ? '#facc15' : '#22d3a6', st.won ? Math.sin(t / 80) * 3 : 0);
    if (st.flash > 0) { g.fillStyle = `rgba(239,68,68,${st.flash * 0.4})`; g.fillRect(0, 0, cv.width, cv.height); st.flash = Math.max(0, st.flash - 0.04); }
    const time = st.won ? '' : ` · ⏱ ${((performance.now() - st.t0) / 1000).toFixed(0)} с`;
    hud.textContent = `🪙 ${st.coins}/${totalCoins} · 🔑 ${st.keys} · ☠ ${st.deaths}${time}`;
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  const pad = h('div', { class: 'dpad' },
    [['▲', -1, 0, 'u'], ['◀', 0, -1, 'l'], ['▶', 0, 1, 'r'], ['▼', 1, 0, 'd']].map(([l, dr, dc, cls]) =>
      h('button', { class: 'dp ' + cls, onPointerdown: (e) => { e.preventDefault(); step(dr, dc); } }, l)));
  const body = h('div', { class: 'lvl' }, hud, h('div', { class: 'lvl-stage' }, cv), msg,
    h('div', { class: 'lvl-foot' }, h('span', { class: 'muted' }, 'WASD / стрелки — движение · R — рестарт · 🔑 открывает дверь · лава и 👾 убивают'), pad,
      h('button', { class: 'ghost-btn', onClick: () => reset(true) }, '↺ Рестарт')));
  modal(`▶ Тест уровня: ${d.name}`, body, { wide: true, onClose: () => { cancelAnimationFrame(raf); clearInterval(enemyTimer); document.removeEventListener('keydown', onKey); } });
  setTimeout(() => cv.focus(), 50);
}
