// Совместный доступ, работающий на GitHub Pages (без своего сервера).
// Браузеры подключаются к публичному MQTT-брокеру по wss:// и обмениваются изменениями.
// Всё содержимое шифруется AES-GCM ключом из ссылки — брокер видит только шифротекст.
// Последнее состояние доски хранится на брокере («retained»-сообщения), поэтому комнату
// можно открыть по ссылке в любое время, даже если создатель офлайн.
import { store, DB } from './store.js';
import { uid, toast, throttle, debounce } from './util.js';
import { setRemoteCursor, removeRemoteCursor, clearRemoteCursors, screenToWorld, fitAll } from './canvas.js';
import { MQTTClient } from './mqtt.js';

export const BROKERS = {
  emqx: { name: 'EMQX (broker.emqx.io)', url: 'wss://broker.emqx.io:8084/mqtt' },
  hivemq: { name: 'HiveMQ (broker.hivemq.com)', url: 'wss://broker.hivemq.com:8884/mqtt' },
  mosquitto: { name: 'Mosquitto (test.mosquitto.org)', url: 'wss://test.mosquitto.org:8081/mqtt' },
};
const CHUNK = 60 * 1024;
const PREFIX = 'gdboard/v2/';
const COLORS = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee', '#f87171'];
const te = new TextEncoder(), td = new TextDecoder();

// ---------- пользователь и настройки ----------
function loadMe() {
  let m;
  try { m = JSON.parse(localStorage.getItem('gdb-me') || 'null'); } catch {}
  if (!m) m = { id: uid('u'), name: 'Гость-' + Math.floor(Math.random() * 900 + 100), color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  return m;
}
export const me = loadMe();
export function setMyName(name) {
  me.name = (name || '').slice(0, 24).trim() || me.name;
  try { localStorage.setItem('gdb-me', JSON.stringify(me)); } catch {}
  if (collab.active) send({ t: 'ping', user: me });
}
export function brokerSettings() {
  try { return JSON.parse(localStorage.getItem('gdb-broker') || 'null') || { id: 'emqx' }; } catch { return { id: 'emqx' }; }
}
export function saveBrokerSettings(s) { try { localStorage.setItem('gdb-broker', JSON.stringify(s)); } catch {} }

// ---------- base64url и шифрование ----------
const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function importKey(k) { return crypto.subtle.importKey('raw', unb64u(k), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
async function unseal(key, bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
}
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
const deflate = (b) => pipe(b, new CompressionStream('deflate-raw'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// картинка передаётся байтами (а не base64-строкой) — на треть меньше трафика
function assetToBytes(src) {
  const m = /^data:([^;,]+);base64,/.exec(src);
  if (!m) return te.encode('S' + src);
  const bin = atob(src.slice(m[0].length));
  const head = te.encode('B' + m[1] + '\n');
  const out = new Uint8Array(head.length + bin.length);
  out.set(head);
  for (let i = 0; i < bin.length; i++) out[head.length + i] = bin.charCodeAt(i);
  return out;
}
function bytesToAsset(b) {
  if (b[0] === 66) { // 'B'
    const nl = b.indexOf(10);
    return 'data:' + td.decode(b.subarray(1, nl)) + ';base64,' + b64(b.subarray(nl + 1));
  }
  if (b[0] === 83) return td.decode(b.subarray(1)); // 'S'
  return td.decode(b); // старый формат — просто строка
}
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
// id всех картинок, на которые ссылаются элементы (поля asset на любой глубине)
function referencedAssets(items) {
  const out = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    for (const [k, x] of Object.entries(v)) { if (k === 'asset' && typeof x === 'string') out.add(x); else walk(x); }
  };
  walk(items);
  return out;
}
const inflate = (b) => pipe(b, new DecompressionStream('deflate-raw'));

// ---------- комната и ссылка ----------
export function newRoom() {
  const s = brokerSettings();
  const broker = s.id === 'custom' ? 'u' + b64u(te.encode(s.url || '')) : s.id || 'emqx';
  return { id: b64u(crypto.getRandomValues(new Uint8Array(9))), key: b64u(crypto.getRandomValues(new Uint8Array(32))), broker };
}
export function roomLink(room) {
  return location.origin + location.pathname + '#/room/' + room.id + '.' + room.key + '.' + room.broker;
}
export function parseRoom(spec) {
  const [id, key, broker = 'emqx'] = spec.split('.');
  if (!id || !key || unb64u(key).length !== 32) throw new Error('Ссылка повреждена');
  return { id, key, broker };
}
function brokerFor(room) {
  if (room.broker?.startsWith('u')) {
    const url = td.decode(unb64u(room.broker.slice(1)));
    const s = brokerSettings();
    return { url, username: s.url === url ? s.username : undefined, password: s.url === url ? s.password : undefined };
  }
  return { url: (BROKERS[room.broker] || BROKERS.emqx).url };
}

// ---------- состояние ----------
export const collab = { active: false, status: 'off', error: '', room: null, users: new Map(), synced: false };
const ls = { presence: [], state: [] };
export const onPresence = (f) => ls.presence.push(f);
export const onState = (f) => ls.state.push(f);
const emitPresence = () => ls.presence.forEach((f) => f([...collab.users.values()]));
const emitState = () => ls.state.forEach((f) => f(collab));

let client = null, key = null, base = '', cid = '', boardId = null;
let dirty = false, applying = false, retryTimer = null, retryN = 0, pingTimer = null, sweepTimer = null, syncTimer = null;
const blobs = new Map();   // путь → { meta, chunks }
const blobN = new Map();   // путь → число частей на брокере
const done = new Map();    // путь → версия, уже применённая

// ---------- отправка ----------
const queue = new Map();
let flushTimer = null;
function send(msg) {
  if (!client?.connected) return;
  const k = msg.t + ':' + (msg.item?.id || msg.link?.id || msg.id || '');
  queue.set(k, msg);
  if (!flushTimer) flushTimer = setTimeout(flush, 45);
}
async function flush() {
  flushTimer = null;
  const msgs = [...queue.values()];
  queue.clear();
  if (!client?.connected || !key) return;
  for (const m of msgs) {
    try { client.publish(base + 'live', await seal(key, te.encode(JSON.stringify({ ...m, f: cid })))); } catch (e) { console.warn(e); }
  }
}
async function putBlob(path, bytes) {
  if (!client?.connected) return;
  const ct = await seal(key, await deflate(bytes));
  const ver = crypto.getRandomValues(new Uint32Array(1))[0];
  const n = Math.max(1, Math.ceil(ct.length / CHUNK));
  for (let i = 0; i < n; i++) {
    const part = ct.subarray(i * CHUNK, (i + 1) * CHUNK);
    const msg = new Uint8Array(8 + part.length);
    const dv = new DataView(msg.buffer);
    dv.setUint32(0, ver); dv.setUint32(4, i);
    msg.set(part, 8);
    if (!client?.connected) return;
    client.publish(base + path + '/' + i, msg, { retain: true });
    if (n > 2) await sleep(30); // не заваливаем публичный брокер пачкой сообщений
  }
  client.publish(base + path + '/meta', await seal(key, te.encode(JSON.stringify({ v: ver, n }))), { retain: true });
  const old = blobN.get(path) || 0;
  for (let i = n; i < old; i++) client.publish(base + path + '/' + i, new Uint8Array(0), { retain: true });
  blobN.set(path, n);
  done.set(path, ver);
}
function dropBlob(path) {
  const n = blobN.get(path) || 0;
  client.publish(base + path + '/meta', new Uint8Array(0), { retain: true });
  for (let i = 0; i < n; i++) client.publish(base + path + '/' + i, new Uint8Array(0), { retain: true });
  blobN.delete(path); done.delete(path); blobs.delete(path);
}

async function publishSnapshot() {
  if (!client?.connected || !store.board || store.board.id !== boardId) return;
  const b = store.board;
  const snap = { name: b.name, items: b.items, links: b.links, at: Date.now(), by: me.name };
  await putBlob('snap', te.encode(JSON.stringify(snap)));
  dirty = false;
  // удалить с брокера картинки, на которые больше ничего не ссылается
  const json = JSON.stringify(b.items);
  for (const p of [...blobN.keys()]) if (p.startsWith('asset/') && !json.includes('"' + p.slice(6) + '"')) dropBlob(p);
  emitState();
}
const scheduleSnapshot = debounce(() => publishSnapshot(), 2500);
async function publishAllAssets() {
  const used = referencedAssets(store.board.items);
  for (const [id, src] of Object.entries(store.board.assets || {})) if (used.has(id) && !blobN.has('asset/' + id)) await putBlob('asset/' + id, assetToBytes(src));
}

// ---------- приём ----------
async function onMessage(topic, payload) {
  if (!topic.startsWith(base)) return;
  const rest = topic.slice(base.length);
  try {
    if (rest === 'live') {
      if (!payload.length) return;
      const m = JSON.parse(td.decode(await unseal(key, payload)));
      if (m.f === cid) return;
      apply(m);
      return;
    }
    const cut = rest.lastIndexOf('/');
    const path = rest.slice(0, cut), part = rest.slice(cut + 1);
    let bl = blobs.get(path);
    if (!bl) blobs.set(path, (bl = { meta: null, chunks: new Map() }));
    if (part === 'meta') {
      if (!payload.length) { blobs.delete(path); blobN.delete(path); return; }
      bl.meta = JSON.parse(td.decode(await unseal(key, payload)));
      blobN.set(path, bl.meta.n);
    } else {
      if (!payload.length) return;
      const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      bl.chunks.set(dv.getUint32(4), { v: dv.getUint32(0), data: payload.subarray(8) });
    }
    await tryAssemble(path, bl);
  } catch (e) {
    console.warn('collab', topic, e);
    if (e.name === 'OperationError') { collab.error = 'Не удалось расшифровать данные — неверный ключ в ссылке?'; emitState(); }
  }
}
async function tryAssemble(path, bl) {
  const m = bl.meta;
  if (!m || done.get(path) === m.v) return;
  for (let i = 0; i < m.n; i++) if (bl.chunks.get(i)?.v !== m.v) return;
  done.set(path, m.v);
  const parts = Array.from({ length: m.n }, (_, i) => bl.chunks.get(i).data);
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  const bytes = await inflate(await unseal(key, all));
  bl.chunks.clear();
  if (path === 'snap') applySnapshot(JSON.parse(td.decode(bytes)));
  else if (path.startsWith('asset/')) {
    const id = path.slice(6), src = bytesToAsset(bytes);
    recentAssets.set(id, Date.now());
    if (store.board?.id === boardId && store.board.assets[id] !== src) { applying = true; store.setAsset(id, src, { remote: true }); applying = false; }
  }
}
function applySnapshot(s) {
  if (!store.board || store.board.id !== boardId) return;
  if (dirty) { scheduleSnapshot(); return; } // у нас есть свои неотправленные правки — отправим их
  const b = store.board;
  const same = JSON.stringify(b.items) === JSON.stringify(s.items) && JSON.stringify(b.links) === JSON.stringify(s.links);
  if (!collab.synced) setTimeout(() => { publishAllAssets(); requestMissing(); }, 3000);
  collab.synced = true;
  clearTimeout(syncTimer);
  if (!same || b.name !== s.name) {
    const wasEmpty = !Object.keys(b.items).length;
    b.items = s.items || {}; b.links = s.links || {}; b.name = s.name || b.name;
    if (wasEmpty) setTimeout(() => fitAll(false), 50);
    applying = true;
    store.load(b);
    store.rename(b.name, { remote: true });
    applying = false;
    DB.put(b);
  }
  emitState();
}
function apply(m) {
  const o = { remote: true };
  applying = true;
  try {
    switch (m.t) {
      case 'up': store.upsert(m.item, o); checkMissingSoon(); break;
      case 'rm': store.remove(m.id, o); break;
      case 'lup': store.upsertLink(m.link, o); break;
      case 'lrm': store.removeLink(m.id, o); break;
      case 'rename': store.rename(m.name, o); break;
      case 'cur': setRemoteCursor(m.uid, m); touchUser({ id: m.uid, name: m.name, color: m.color }); break;
      case 'hello': touchUser(m.user); send({ t: 'ping', user: me }); toast(`${m.user.name} подключился`, 'ok', 1800); break;
      case 'ping': touchUser(m.user); break;
      case 'bye': dropUser(m.uid); break;
      case 'need': answerNeed(m.ids || []); break;
    }
  } finally { applying = false; }
}
function touchUser(u) {
  if (!u?.id || u.id === me.id) return;
  const had = collab.users.has(u.id);
  collab.users.set(u.id, { ...collab.users.get(u.id), ...u, seen: Date.now() });
  if (!had) emitPresence();
}
function dropUser(id) {
  const u = collab.users.get(id);
  if (!u || id === me.id) return;
  collab.users.delete(id);
  removeRemoteCursor(id);
  emitPresence();
}

// ---------- недостающие картинки: попросить у тех, у кого они есть ----------
const recentAssets = new Map(); // id → когда получили/отправили
const checkMissingSoon = debounce(() => requestMissing(), 4000);
function requestMissing() {
  if (!collab.active || collab.status !== 'online' || store.board?.id !== boardId) return;
  const need = [...referencedAssets(store.board.items)].filter((id) => !store.board.assets[id]);
  if (need.length) send({ t: 'need', ids: need.slice(0, 50) });
}
function answerNeed(ids) {
  const have = ids.filter((id) => store.board?.assets[id]);
  if (!have.length) return;
  // небольшая случайная задержка: если кто-то уже ответил, не дублируем
  setTimeout(async () => {
    for (const id of have) {
      if (Date.now() - (recentAssets.get(id) || 0) < 8000) continue;
      recentAssets.set(id, Date.now());
      await putBlob('asset/' + id, assetToBytes(store.board.assets[id]));
    }
  }, 300 + Math.random() * 1500);
}

// ---------- подключение ----------
export async function connectRoom(board) {
  if (collab.active && collab.room?.id === board.room?.id && boardId === board.id) return;
  leave(true);
  if (!board.room) return;
  collab.active = true; collab.room = board.room; collab.status = 'connecting'; collab.error = ''; collab.synced = false;
  collab.users.clear(); collab.users.set(me.id, { ...me, seen: Date.now() });
  boardId = board.id;
  base = PREFIX + board.room.id + '/';
  cid = me.id + '_' + Math.random().toString(36).slice(2, 7);
  key = await importKey(board.room.key);
  emitState(); emitPresence();
  await dial();
}
async function dial() {
  if (!collab.active) return;
  const br = brokerFor(collab.room);
  const will = { topic: base + 'live', payload: await seal(key, te.encode(JSON.stringify({ t: 'bye', uid: me.id, f: cid }))) };
  client = new MQTTClient(br.url, { clientId: cid, username: br.username, password: br.password, will, keepalive: 30 });
  client.on('message', onMessage);
  client.on('close', () => {
    if (!collab.active) return;
    collab.status = 'reconnecting'; emitState();
    retry();
  });
  try {
    await client.connect();
    retryN = 0;
    collab.status = 'online'; collab.error = ''; emitState();
    blobs.clear(); done.clear();
    await client.subscribe(base + '#');
    send({ t: 'hello', user: me });
    clearInterval(pingTimer); pingTimer = setInterval(() => send({ t: 'ping', user: me }), 10000);
    clearInterval(sweepTimer); sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, u] of collab.users) if (id !== me.id && now - (u.seen || 0) > 35000) dropUser(id);
    }, 5000);
    // если на брокере нет сохранённой доски — значит, мы первые: выкладываем свою
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      if (!collab.synced && store.board?.id === boardId) {
        collab.synced = true;
        if (Object.keys(store.board.items).length || dirty) await publishSnapshot();
        emitState();
      }
      // картинки, вставленные без связи, — выложить; чужих не хватает — попросить
      await publishAllAssets();
      setTimeout(requestMissing, 2500);
    }, 3500);
    if (dirty) scheduleSnapshot();
    if (collab.synced) setTimeout(() => { publishAllAssets(); requestMissing(); }, 4000); // после переподключения
  } catch (e) {
    collab.status = 'reconnecting';
    collab.error = e.message || 'ошибка сети';
    emitState();
    retry();
  }
}
function retry() {
  clearTimeout(retryTimer);
  const delay = [1000, 2000, 4000, 8000, 15000, 30000][Math.min(retryN++, 5)];
  retryTimer = setTimeout(() => { if (collab.active) dial(); }, delay);
}

// Открыть совместный доступ к текущей доске (создать комнату)
export async function shareBoard() {
  const b = store.board;
  if (!b) return null;
  b.room = newRoom();
  await DB.put(b);
  dirty = true;
  await connectRoom(b);
  // ждём подключения и выкладываем доску
  for (let i = 0; i < 60 && collab.status !== 'online'; i++) await new Promise((r) => setTimeout(r, 200));
  if (collab.status === 'online') {
    collab.synced = true;
    clearTimeout(syncTimer);
    await publishSnapshot();
    await publishAllAssets();
  }
  return b.room;
}

// Отключиться (forget — забыть комнату у этой доски)
export function leave(silent = false, forget = false) {
  clearTimeout(retryTimer); clearInterval(pingTimer); clearInterval(sweepTimer); clearTimeout(syncTimer);
  if (client) {
    if (client.connected && key) { try { flush(); } catch {} send({ t: 'bye', uid: me.id }); flush(); }
    const c = client;
    setTimeout(() => c.end(), 150);
  }
  client = null;
  if (forget && store.board?.room) { delete store.board.room; DB.put(store.board); }
  collab.active = false; collab.status = 'off'; collab.room = null; collab.synced = false;
  collab.users.clear();
  clearRemoteCursors();
  boardId = null;
  if (!silent) { emitPresence(); emitState(); }
}
export async function syncNow() { if (collab.active) { await publishSnapshot(); toast('Доска сохранена в комнате', 'ok', 1500); } }

// ---------- локальные изменения → в комнату ----------
const local = (o) => collab.active && !o.remote && !applying && store.board?.id === boardId;
const changed = () => { dirty = true; scheduleSnapshot(); };
store.on('item', (it, o) => { if (local(o)) { send({ t: 'up', item: it }); changed(); } });
store.on('remove', (id, o) => { if (local(o)) { send({ t: 'rm', id }); changed(); } });
store.on('link', (l, o) => { if (local(o)) { send({ t: 'lup', link: l }); changed(); } });
store.on('unlink', (l, o) => { if (local(o)) { send({ t: 'lrm', id: l.id }); changed(); } });
store.on('rename', (name, o) => { if (local(o)) { send({ t: 'rename', name }); changed(); } });
store.on('asset', (id, src, o) => { if (local(o)) putBlob('asset/' + id, assetToBytes(src)); });

export function trackCursor(vp) {
  const sendCur = throttle((x, y) => send({ t: 'cur', uid: me.id, name: me.name, color: me.color, x, y }), 70);
  vp.addEventListener('pointermove', (e) => {
    if (!collab.active || collab.status !== 'online') return;
    const p = screenToWorld(e.clientX, e.clientY);
    sendCur(Math.round(p.x), Math.round(p.y));
  });
}
window.addEventListener('beforeunload', () => { if (collab.active && dirty) publishSnapshot(); });
