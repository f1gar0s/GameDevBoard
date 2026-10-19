// Шаблоны досок для геймдева
import { uid } from './util.js';
import { WIDGETS } from './widgets.js';
import { migrateItems } from './tools.js';

function builder() {
  let z = 0, fz = 0;
  const items = [], links = [];
  const I = (type, x, y, data = {}, w, hh) => {
    const W = WIDGETS[type] || { w: 300, h: 200, data: () => ({}) }; // старые типы станут карточками при сборке
    const it = { id: uid('i'), type, x, y, w: w ?? W.w, h: hh ?? W.h, z: type === 'frame' ? -(++fz) : ++z, data: { ...W.data(), ...data } };
    items.push(it);
    return it;
  };
  const L = (a, b, label = '', extra = {}) => { const l = { id: uid('l'), from: a.id, to: b.id, label, ...extra }; links.push(l); return l; };
  return { I, L, out: () => ({ items, links }) };
}

const Y = '#fef08a', O = '#fdba74', R = '#fca5a5', P = '#c4b5fd', B = '#93c5fd', G = '#86efac', T = '#99f6e4';

export const TEMPLATES = [
  {
    id: 'gdd', name: 'Game Design Document', icon: '📘', color: '#7c5cff',
    desc: 'Концепция, core loop, персонажи, лут, прогрессия и арт — живой GDD на одной доске',
    build() {
      const { I, L, out } = builder();
      I('text', 0, -110, { text: '⚔ Project: Ashen Crown — GDD', size: 48 }, 900, 70);
      I('frame', 0, 0, { title: '1. Концепция', color: '#7c5cff' }, 900, 520);
      I('sticky', 30, 60, { text: 'Жанр: roguelite-экшен с изометрией', color: Y });
      I('sticky', 250, 60, { text: 'Платформы: PC, Switch', color: B });
      I('sticky', 470, 60, { text: 'ЦА: 16–30 лет, фанаты Hades и Dead Cells', color: G });
      I('sticky', 690, 60, { text: 'УТП: каждая смерть необратимо меняет мир', color: O }, 180, 200);
      I('sticky', 30, 290, { text: 'Питч одной фразой: «Падший рыцарь пробивается сквозь пепельное королевство, где его смерти становятся историей»', color: P }, 420, 200);
      I('sticky', 470, 290, { text: 'Фичи: 3 биома · 40 реликвий · система «Эхо смерти» · кооп на двоих', color: T }, 400, 200);

      I('frame', 960, 0, { title: '2. Core Loop', color: '#22d3a6' }, 720, 520);
      const a = I('shape', 1240, 60, { shape: 'ellipse', text: 'Исследуй', color: '#22d3a6' }, 170, 90);
      const b = I('shape', 1480, 220, { shape: 'ellipse', text: 'Сражайся', color: '#ef4444' }, 170, 90);
      const c = I('shape', 1240, 390, { shape: 'ellipse', text: 'Получай лут', color: '#f59e0b' }, 170, 90);
      const d = I('shape', 1000, 220, { shape: 'ellipse', text: 'Улучшайся', color: '#7c5cff' }, 170, 90);
      I('text', 1215, 240, { text: '30 сек – 3 мин', size: 18, bold: false, color: '#8b93a7' }, 220, 40);
      L(a, b); L(b, c); L(c, d); L(d, a);

      I('frame', 0, 580, { title: '3. Персонажи', color: '#ec4899' }, 960, 440);
      I('character', 30, 640, { name: 'Кайрон', role: 'Падший рыцарь · герой', avatar: '🛡', color: '#7c5cff', stats: [{ k: 'HP', v: 120 }, { k: 'ATK', v: 30 }, { k: 'DEF', v: 25 }, { k: 'SPD', v: 35 }], notes: 'Ищет искупления. Умеет парировать.' });
      I('character', 340, 640, { name: 'Морра', role: 'Ведьма пепла · союзник', avatar: '🔮', color: '#22d3a6', stats: [{ k: 'HP', v: 70 }, { k: 'ATK', v: 45 }, { k: 'DEF', v: 10 }, { k: 'SPD', v: 50 }], notes: 'Торгует проклятыми реликвиями.' });
      I('character', 650, 640, { name: 'Пепельный король', role: 'Финальный босс', avatar: '👑', color: '#ef4444', stats: [{ k: 'HP', v: 900 }, { k: 'ATK', v: 60 }, { k: 'DEF', v: 40 }, { k: 'SPD', v: 20 }], notes: '3 фазы. Призывает эхо прошлых смертей игрока.' });

      I('frame', 1020, 580, { title: '4. Предметы и лут', color: '#f59e0b' }, 960, 440);
      I('loot', 1050, 640, { icon: '🗡', name: 'Клинок рассвета', rarity: 'rare', kind: 'Оружие', price: 120, desc: '+15 ATK. Двойной урон по нежити.' });
      I('loot', 1330, 640, { icon: '🔥', name: 'Сердце феникса', rarity: 'legendary', kind: 'Реликвия', price: 999, desc: 'Один раз за забег воскрешает с 50% HP.' });
      I('loottable', 1590, 640, {}, 370, 330);

      I('frame', 0, 1080, { title: '5. Прогрессия', color: '#3b82f6' }, 960, 420);
      I('curve', 30, 1140, {}, 440, 330);
      I('curve', 500, 1140, { title: 'HP врагов по этажам', formula: 'Обычный: 40 + 12 * lvl\nЭлита: (40 + 12 * lvl) * 2.5', from: 1, to: 15 }, 430, 330);

      I('frame', 1020, 1080, { title: '6. Арт-направление', color: '#ec4899' }, 960, 420);
      I('palette', 1050, 1140, { title: 'Пепел и угли', colors: ['#0f0d0e', '#2b2321', '#5c4b44', '#e2572b', '#f6b042', '#ede4d3'] }, 420, 150);
      I('sticky', 1050, 1310, { text: 'Референсы: Hades, Darkest Dungeon, Blasphemous', color: O }, 260, 160);
      I('sprite', 1500, 1140, { name: 'hero_idle' }, 240, 330);
      return out();
    },
  },
  {
    id: 'sprint', name: 'Спринт / Канбан', icon: '🏃', color: '#3b82f6',
    desc: 'Колонки-фреймы со статусами: перетащите задачу — статус обновится сам',
    build() {
      const { I, out } = builder();
      I('text', 0, -120, { text: 'Спринт #4 — Вертикальный срез', size: 40 }, 800, 60);
      I('sticky', 900, -150, { text: '🎯 Цель спринта: играбельный первый биом с боссом', color: Y }, 420, 120);
      const cols = [['todo', 'К работе', '#64748b'], ['doing', 'В работе', '#3b82f6'], ['review', 'Проверка', '#f59e0b'], ['done', 'Готово', '#22c55e']];
      cols.forEach(([st, name, col], i) => I('frame', i * 360, 0, { title: name, color: col, status: st }, 330, 1280));
      const tasks = [
        ['todo', 'Анимации атаки героя', 'Art', 5, '@аня'], ['todo', 'Звук парирования', 'Audio', 2, '@макс'], ['todo', 'Диалоги ведьмы', 'Narrative', 3, '@лена'],
        ['doing', 'ИИ босса: фаза 2', 'Code', 8, '@игорь'], ['doing', 'Тайлсет пепельных пещер', 'Art', 5, '@аня'],
        ['review', 'Система реликвий', 'Code', 5, '@дима'], ['review', 'Баланс урона оружия', 'Design', 3, '@олег'],
        ['done', 'Управление и дэш', 'Code', 3, '@дима'], ['done', 'Главное меню', 'Design', 2, '@олег'],
      ];
      const y = { todo: 50, doing: 50, review: 50, done: 50 };
      const put = (st, data, hh) => { const ci = cols.findIndex((c) => c[0] === st); I('task', ci * 360 + 25, y[st], data, 280); y[st] += hh + 18; };
      for (const [st, title, tag, pts, who] of tasks) put(st, { title, tag, points: pts, assignee: who, status: st }, 268);
      put('todo', { kind: 'bug', title: 'Герой застревает в стене после дэша', priority: 'crit', tag: 'QA', points: 2, status: 'todo' }, 330);
      put('doing', { kind: 'bug', title: 'Утечка памяти при смене биома', priority: 'high', tag: 'QA', points: 3, status: 'doing', assignee: '@игорь' }, 330);
      return out();
    },
  },
  {
    id: 'dialogue', name: 'Ветвящийся диалог', icon: '💬', color: '#22d3a6',
    desc: 'Граф реплик с вариантами ответа. Нажмите ▶ Играть и пройдите его как игрок',
    build() {
      const { I, L, out } = builder();
      I('text', 0, -100, { text: 'Диалог: стражник у ворот', size: 36 }, 700, 56);
      I('sticky', 760, -150, { text: 'Подпись связи = вариант ответа игрока. Протяните ⟶ от реплики в пустое место, чтобы создать следующую.', color: T }, 360, 130);
      const g = I('dialogue', 0, 0, { speaker: 'Стражник', text: 'Стой! Ворота закрыты до рассвета. Кто ты такой?', dlgId: 'guard_gate', npc: 'guard' });
      const a = I('dialogue', 380, -220, { speaker: 'Стражник', text: 'Торговец, говоришь? Покажи товар — и, может, пропущу.' });
      const b = I('dialogue', 380, 20, { speaker: 'Стражник', text: 'Хм… монеты звенят убедительно. Проходи, но я тебя не видел.' });
      const c = I('dialogue', 380, 260, { speaker: 'Стражник', text: 'Дерзишь? Тогда отправляйся в темницу!' });
      const q = I('quest', 760, -260, { title: 'Контрабанда', giver: 'Стражник', objectives: [{ t: 'Пронести ящик мимо патруля', done: false }, { t: 'Доставить ящик на рынок', done: false }], reward: '150 🪙' });
      const a2 = I('dialogue', 760, 40, { speaker: 'Стражник', text: 'Город за воротами опасен. Держись подальше от рынка ночью.' });
      const c2 = I('dialogue', 760, 300, { speaker: 'Тюремщик', text: 'Добро пожаловать в подземелье, умник. Твой сосед — гоблин.' });
      L(g, a, 'Я торговец', { color: '#22d3a6' });
      L(g, b, '[Подкуп] Дать 50 золота', { color: '#22d3a6' });
      L(g, c, 'Не твоё дело', { color: '#22d3a6' });
      L(a, q, 'Показать ящик', { color: '#22d3a6' });
      L(a, a2, 'У меня ничего нет', { color: '#22d3a6' });
      L(b, a2, 'Спасибо', { color: '#22d3a6' });
      L(c, c2, 'Сдаться', { color: '#22d3a6' });
      return out();
    },
  },
  {
    id: 'npcdialog', name: 'Диалог с условиями', icon: '🐈', color: '#22d3a6',
    desc: 'Формат для игры: условия, действия, приоритет. Экспорт — один файл на диалог',
    build() {
      const { I, L, out } = builder();
      I('text', 0, -110, { text: 'Кот у библиотеки', size: 36 }, 600, 56);
      I('sticky', 700, -170, { text: 'В плейтесте введите give:cat_food в поле «Состояние игры», чтобы появился вариант «Покормить». ⚙ на реплике — условия и действия.', color: '#99f6e4' }, 380, 150);
      const n1 = I('dialogue', 0, 0, { speaker: 'cat', text: 'Мрр. Миска пустая — в библиотеку не пущу.', dlgId: 'cat_hungry', npc: 'cat', priority: 10, dcond: '!flag:cat_fed', showLogic: true }, 300, 380);
      const n2 = I('dialogue', 420, -40, { speaker: 'cat', text: 'Мур. Проходи.', actions: 'unlock:library_door', showLogic: true }, 280, 262);
      const end = I('shape', 460, 290, { shape: 'ellipse', text: 'Конец разговора', color: '#94a3b8' }, 200, 80);
      L(n1, n2, 'Покормить', { color: '#22d3a6', cond: 'item:cat_food', actions: 'take:cat_food set:cat_fed' });
      L(n1, end, 'Уйти', { color: '#22d3a6' });
      const m1 = I('dialogue', 0, 480, { speaker: 'cat', text: 'Мур-мур. Спасибо за ужин, человек.', dlgId: 'cat_fed', npc: 'cat', priority: 5, dcond: 'flag:cat_fed', showLogic: true }, 300, 380);
      const m2 = I('dialogue', 420, 520, { speaker: 'cat', text: 'Ночью я охраняю книги. Приходи днём.', showLogic: false });
      L(m1, m2, 'Можно погладить?', { color: '#22d3a6', cond: 'night' });
      L(m1, end, 'Пока', { color: '#22d3a6' });
      return out();
    },
  },
  {
    id: 'level', name: 'Дизайн уровня', icon: '🗺', color: '#f59e0b',
    desc: 'Тайловая карта, сгенерированная карта мира, цели и заметки по ритму',
    build() {
      const { I, out } = builder();
      I('frame', 0, 0, { title: 'Уровень 1-2: Затопленная крипта', color: '#f59e0b' }, 1180, 640);
      const cols = 24, rows = 14;
      const map = [
        '########################',
        '#P...#.........#......C#',
        '#....#..C......#..E....#',
        '#....#.....#####.......#',
        '#..........#...~~~.....#',
        '####.###...#...~~~..####',
        '#......#...D...........#',
        '#..K...#...#####...C...#',
        '#......#.......#.......#',
        '#.E....######..#..######',
        '#..............#.......#',
        '#~~~~....C.....E.......#',
        '#~~~~..........#......X#',
        '########################',
      ].join('');
      I('tilemap', 30, 60, { name: 'Крипта', cols, rows, cells: map }, 620, 520);
      I('quest', 690, 60, { title: 'Сердце крипты', giver: 'Призрак монаха', objectives: [{ t: 'Найти ключ', done: false }, { t: 'Открыть дверь', done: false }, { t: 'Добраться до выхода', done: false }], reward: 'Реликвия «Тихий шаг»' }, 270, 290);
      I('sticky', 990, 60, { text: 'Ритм: напряжение (лава, враги) → отдых (сокровищница) → кульминация', color: Y }, 170, 200);
      I('sticky', 690, 350, { text: 'Ключ спрятан до двери — игрок должен вернуться назад (бэктрекинг)', color: O }, 220, 200);
      I('sticky', 930, 350, { text: 'ЛКМ рисует тайлом, ПКМ стирает. ⚙ на карте — размер и экспорт PNG', color: G }, 220, 200);
      I('mapgen', 1260, 60, { style: 'medieval', seed: 424242, w: 120, h: 80 }, 460, 400);
      return out();
    },
  },
  {
    id: 'economy', name: 'Экономика и баланс', icon: '📈', color: '#7c5cff',
    desc: 'Кривые опыта и дохода, точка пересечения цен, таблицы дропа',
    build() {
      const { I, out } = builder();
      I('text', 0, -100, { text: 'Экономика v0.3', size: 40 }, 600, 60);
      I('curve', 0, 0, { title: 'Опыт и награды', formula: 'XP до уровня: 100 * lvl^1.6\nXP за квест: 60 * lvl^1.3', from: 1, to: 40 }, 480, 360);
      I('curve', 520, 0, { title: 'Доход vs цены', formula: 'Доход/час: 120 * lvl^1.2\nЦена брони: 50 * 1.15^lvl', from: 1, to: 40 }, 480, 360);
      I('curve', 1040, 0, { title: 'Шанс крита', formula: 'Крит %: clamp(5 + lvl * 0.8, 0, 50)', from: 1, to: 80 }, 420, 360);
      I('loottable', 0, 420, { title: 'Обычный враг', rows: [{ name: 'Ничего', w: 60, r: 'common' }, { name: '5–10 золота', w: 30, r: 'common' }, { name: 'Зелье', w: 9, r: 'uncommon' }, { name: 'Реликвия', w: 1, r: 'epic' }] });
      I('loottable', 420, 420, { title: 'Босс' , rows: [{ name: 'Редкое оружие', w: 50, r: 'rare' }, { name: 'Эпическая броня', w: 35, r: 'epic' }, { name: 'Легендарная реликвия', w: 15, r: 'legendary' }] });
      I('sticky', 840, 420, { text: '⚠ Цены брони обгоняют доход к ~38-му уровню — нужна новая статья дохода или скидки', color: R }, 260, 200);
      I('sticky', 1120, 420, { text: 'Цель: 1 уровень ≈ 12–15 минут игры', color: Y }, 200, 200);
      return out();
    },
  },
  {
    id: 'loop', name: 'Core Loop + мета', icon: '🔁', color: '#22d3a6',
    desc: 'Основной игровой цикл и мета-прогрессия поверх него',
    build() {
      const { I, L, out } = builder();
      I('text', 120, -100, { text: 'Игровые циклы', size: 40 }, 500, 60);
      const cx = 360, cy = 300, r = 220;
      const names = [['Найти цель', '#22d3a6'], ['Победить', '#ef4444'], ['Награда', '#f59e0b'], ['Прокачка', '#7c5cff'], ['Новые возможности', '#3b82f6']];
      const nodes = names.map(([t, c], i) => {
        const a = (i / names.length) * Math.PI * 2 - Math.PI / 2;
        return I('shape', Math.round(cx + Math.cos(a) * r - 85), Math.round(cy + Math.sin(a) * r - 45), { shape: 'ellipse', text: t, color: c }, 170, 90);
      });
      nodes.forEach((n, i) => L(n, nodes[(i + 1) % nodes.length]));
      I('text', cx - 90, cy - 20, { text: 'Core loop', size: 24, color: '#8b93a7' }, 180, 40);
      const m1 = I('shape', 900, 120, { shape: 'round', text: 'Забег', color: '#94a3b8' }, 200, 80);
      const m2 = I('shape', 900, 300, { shape: 'round', text: 'Хаб: улучшения', color: '#94a3b8' }, 200, 80);
      const m3 = I('shape', 900, 480, { shape: 'round', text: 'Открытие биома', color: '#94a3b8' }, 200, 80);
      L(m1, m2); L(m2, m3); L(m3, m1, 'мета-цикл', { dashed: true });
      I('sticky', 1160, 200, { text: 'Мета-цикл: часы. Core loop: секунды–минуты.', color: T });
      return out();
    },
  },
  {
    id: 'jam', name: 'Гейм-джем 48 ч', icon: '⚡', color: '#ef4444',
    desc: 'Тема, мозговой штурм, MVP против «если успеем» и план по часам',
    build() {
      const { I, out } = builder();
      I('frame', 0, 0, { title: 'Тема джема', color: '#ef4444' }, 420, 300);
      I('text', 30, 110, { text: '«Всё рушится»', size: 40 }, 360, 70);
      I('frame', 460, 0, { title: 'Мозговой штурм', color: '#f59e0b' }, 700, 300);
      ['Башня, которая рушится, пока строишь', 'Друзья-NPC забывают тебя', 'Гравитация слабеет каждые 10 сек', 'Город из карт'].forEach((t, i) =>
        I('sticky', 490 + i * 165, 60, { text: t, color: [Y, O, P, T][i] }, 150, 150));
      I('frame', 0, 340, { title: 'MVP (обязательно)', color: '#22c55e', status: '' }, 560, 360);
      I('frame', 600, 340, { title: 'Если успеем', color: '#94a3b8' }, 560, 360);
      ['Прыжок и падение', 'Рушащиеся платформы', 'Счёт высоты', 'Экран проигрыша'].forEach((t, i) => I('sticky', 30 + (i % 2) * 260, 400 + Math.floor(i / 2) * 145, { text: t, color: G }, 240, 130));
      ['Музыка', 'Таблица рекордов', 'Скины'].forEach((t, i) => I('sticky', 630 + (i % 2) * 260, 400 + Math.floor(i / 2) * 145, { text: t, color: '#e5e7eb' }, 240, 130));
      I('frame', 0, 760, { title: 'План на 48 часов', color: '#3b82f6' }, 1530, 330);
      [['0–6 ч: прототип', 'Code'], ['6–20 ч: механики', 'Code'], ['20–30 ч: арт', 'Art'], ['30–40 ч: звук и полиш', 'Audio'], ['40–48 ч: билд и сабмит', 'QA']].forEach(([t, tag], i) =>
        I('task', 25 + i * 300, 815, { title: t, tag, points: 1 }, 280, 250));
      return out();
    },
  },
  {
    id: 'retro', name: 'Ретро / Постмортем', icon: '🧭', color: '#ec4899',
    desc: 'Что получилось, что нет и что улучшить в следующем майлстоуне',
    build() {
      const { I, out } = builder();
      I('text', 0, -100, { text: 'Постмортем: альфа-версия', size: 40 }, 700, 60);
      const cols = [['👍 Что получилось', '#22c55e', G, ['Боевка ощущается сочно', 'Плейтесты каждую неделю']], ['👎 Что не получилось', '#ef4444', R, ['Кранч перед вехой', 'Поздно взялись за звук']], ['💡 Что улучшить', '#3b82f6', B, ['Заморозка фич за 2 недели', 'Аудио-дизайнер с первого дня']]];
      cols.forEach(([t, c, sc, notes], i) => {
        I('frame', i * 420, 0, { title: t, color: c }, 390, 520);
        notes.forEach((n, j) => I('sticky', i * 420 + 25 + (j % 2) * 175, 60 + Math.floor(j / 2) * 185, { text: n, color: sc }, 165, 165));
      });
      I('task', 0, 560, { title: 'Ввести feature freeze в план', tag: 'Design', points: 1, assignee: '@продюсер' });
      I('task', 290, 560, { title: 'Нанять аудио-дизайнера', tag: 'Audio', points: 2, assignee: '@лид' });
      return out();
    },
  },
];

// Шаблоны описаны в прежнем формате; при сборке они превращаются в карточки с компонентами
export function buildTemplate(t) {
  const { items, links } = t.build();
  const map = Object.fromEntries(items.map((i) => [i.id, i]));
  migrateItems(map);
  return { items: Object.values(map), links };
}
