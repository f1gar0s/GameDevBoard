// Совместный доступ, работающий на GitHub Pages (без своего сервера).
// Браузер подключается СРАЗУ К НЕСКОЛЬКИМ публичным MQTT-брокерам по wss:// (если какой-то
// заблокирован у провайдера, работают остальные), а с другими участниками дополнительно
// устанавливает прямое WebRTC-соединение — правки доходят мгновенно, без сервера посередине.
// Всё содержимое шифруется AES-GCM ключом из ссылки — брокер видит только шифротекст.
// Последнее состояние доски хранится на брокере («retained»-сообщения), поэтому комнату
// можно открыть по ссылке в любое время, даже если создатель офлайн.
import { store, DB } from './store.js';
import { uid, toast, throttle, debounce } from './util.js';
import { setRemoteCursor, removeRemoteCursor, clearRemoteCursors, screenToWorld, fitAll } from './canvas.js';
import { MQTTClient } from './mqtt.js';

export const BROKERS = {
  eclipse: { name: 'Eclipse (порт 443)', url: 'wss://mqtt.eclipseprojects.io:443/mqtt' },
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
  if (collab.active) send({ t: 'ping', user: { ...me, page: store.page } });
}
export function brokerSettings() {
  try { const v = JSON.parse(localStorage.getItem('gdb-broker') || 'null'); return v && v.id === 'custom' ? v : { id: 'auto' }; } catch { return { id: 'auto' }; }
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
  const broker = s.id === 'custom' ? 'u' + b64u(te.encode(s.url || '')) : 'all';
  return { id: b64u(crypto.getRandomValues(new Uint8Array(9))), key: b64u(crypto.getRandomValues(new Uint8Array(32))), broker };
}
export function roomLink(room) {
  return location.origin + location.pathname + '#/room/' + room.id + '.' + room.key + '.' + room.broker;
}
export function parseRoom(spec) {
  const [id, key, broker = 'all'] = spec.split('.');
  if (!id || !key || unb64u(key).length !== 32) throw new Error('Ссылка повреждена');
  return { id, key, broker };
}
// Свой сервер: если приложение открыто с нашего сервера (а не с GitHub Pages), рядом лежит
// server.json с адресом синхронизации. Тогда используем только его — без публичных брокеров.
let ownPromise = null;
export function ownServer() {
  if (!ownPromise) ownPromise = (async () => {
    if (!/^https?:$/.test(location.protocol) || location.hostname.endsWith('github.io')) return null;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch('server.json', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return null;
      const j = await r.json();
      if (!j?.mqtt) return null;
      const url = /^wss?:\/\//.test(j.mqtt) ? j.mqtt : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + (j.mqtt.startsWith('/') ? '' : '/') + j.mqtt;
      collab.own = { url, name: j.name || location.hostname };
      return collab.own;
    } catch { return null; }
  })();
  return ownPromise;
}
ownServer();

// Список брокеров комнаты: свой (из ссылки), сервер приложения или все публичные сразу
function brokersFor(room, own) {
  if (own && !room.broker?.startsWith('u')) return [{ id: 'self', name: own.name, url: own.url }];
  if (room.broker?.startsWith('u')) {
    const url = td.decode(unb64u(room.broker.slice(1)));
    const s = brokerSettings();
    return [{ id: 'custom', name: 'Свой брокер', url, username: s.url === url ? s.username : undefined, password: s.url === url ? s.password : undefined }];
  }
  return Object.entries(BROKERS).map(([id, b]) => ({ id, ...b }));
}

// ---------- состояние ----------
export const collab = { own: null, active: false, status: 'off', error: '', room: null, users: new Map(), synced: false, links: [], direct: 0 };
const ls = { presence: [], state: [] };
export const onPresence = (f) => ls.presence.push(f);
export const onState = (f) => ls.state.push(f);
const emitPresence = () => ls.presence.forEach((f) => f([...collab.users.values()]));
const emitState = () => ls.state.forEach((f) => f(collab));

let links = [], key = null, base = '', cid = '', boardId = null, seq = 0;
let dirty = false, applying = false, pingTimer = null, sweepTimer = null, syncTimer = null;
const online = () => links.filter((l) => l.client?.connected);
const anyOnline = () => links.some((l) => l.client?.connected);
function publish(topic, bytes, opts, only) { for (const l of only ? [only].filter((x) => x.client?.connected) : online()) { try { l.client.publish(topic, bytes, opts); } catch {} } }
function refreshStatus() {
  const was = collab.status;
  collab.status = !collab.active ? 'off' : anyOnline() ? 'online' : links.some((l) => l.status === 'connecting') && was !== 'reconnecting' ? 'connecting' : 'reconnecting';
  collab.links = links.map((l) => ({ id: l.id, name: l.name, status: l.status, rtt: l.rtt, err: l.err }));
  collab.direct = [...peers.values()].filter((p) => p.open).length;
  collab.error = anyOnline() ? '' : links.map((l) => l.err).filter(Boolean)[0] || '';
  emitState();
}
const blobs = new Map();   // путь → { meta, chunks }
const blobN = new Map();   // путь → число частей на брокере
const done = new Map();    // путь → версия, уже применённая
const appliedAt = new Map(); // путь → время применённой версии (старые копии с других брокеров игнорируем)

// ---------- отправка ----------
// Каждое сообщение уходит сразу по прямым каналам (WebRTC) и почти сразу — через брокеры.
// У сообщения есть номер (f + s), поэтому дубли, пришедшие разными путями, отбрасываются.
const queue = new Map();
let flushTimer = null;
function send(msg, { mqttOnly = false } = {}) {
  if (!collab.active) return;
  const m = { ...msg, f: cid, s: ++seq };
  if (!mqttOnly) rtcSend(m);
  if (!anyOnline()) return;
  const k = m.t === 'up' || m.t === 'cur' || m.t === 'lup' || m.t === 'tup' ? m.t + ':' + (m.item?.id || m.link?.id || m.node?.id || m.uid || '') : m.t + ':' + m.s;
  queue.set(k, m);
  // если со всеми участниками есть прямой канал, брокерам можно слать реже (они нужны для опоздавших)
  const delay = m.t === 'rtc' || m.t === 'hello' ? 0 : allDirect() ? 150 : 16;
  if (!flushTimer) flushTimer = setTimeout(flush, delay);
}
async function flush() {
  flushTimer = null;
  const msgs = [...queue.values()];
  queue.clear();
  if (!anyOnline() || !key) return;
  for (const m of msgs) {
    try { publish(base + 'live', await seal(key, te.encode(JSON.stringify(m)))); } catch (e) { console.warn(e); }
  }
}
// only — опубликовать только на одном брокере (догоняем сервер, который был недоступен)
async function putBlob(path, bytes, only = null) {
  if (only ? !only.client?.connected : !anyOnline()) return;
  const ct = await seal(key, await deflate(bytes));
  const ver = crypto.getRandomValues(new Uint32Array(1))[0];
  const n = Math.max(1, Math.ceil(ct.length / CHUNK));
  for (let i = 0; i < n; i++) {
    const part = ct.subarray(i * CHUNK, (i + 1) * CHUNK);
    const msg = new Uint8Array(8 + part.length);
    const dv = new DataView(msg.buffer);
    dv.setUint32(0, ver); dv.setUint32(4, i);
    msg.set(part, 8);
    if (!anyOnline()) return;
    publish(base + path + '/' + i, msg, { retain: true }, only);
    if (n > 2) await sleep(30); // не заваливаем публичный брокер пачкой сообщений
  }
  const at = Date.now();
  publish(base + path + '/meta', await seal(key, te.encode(JSON.stringify({ v: ver, n, at }))), { retain: true }, only);
  for (const l of only ? [only] : online()) {
    const old = l.blobN.get(path) || 0;
    for (let i = n; i < old; i++) publish(base + path + '/' + i, new Uint8Array(0), { retain: true }, l);
    l.blobN.set(path, n); l.metaAt.set(path, at);
  }
  blobN.set(path, n);
  done.set(path, ver);
  appliedAt.set(path, at);
}
function dropBlob(path) {
  for (const l of online()) {
    const n = l.blobN.get(path) || blobN.get(path) || 0;
    publish(base + path + '/meta', new Uint8Array(0), { retain: true }, l);
    for (let i = 0; i < n; i++) publish(base + path + '/' + i, new Uint8Array(0), { retain: true }, l);
    l.blobN.delete(path); l.metaAt.delete(path); blobs.delete(l.id + '|' + path);
  }
  blobN.delete(path); done.delete(path);
}
// Сервер переподключился (или был недоступен): докладываем ему то, чего у него нет или что устарело
async function repairLink(l) {
  if (!l.client?.connected || !collab.synced || store.board?.id !== boardId) return;
  if ((appliedAt.get('snap') || 1) > (l.metaAt.get('snap') || 0) || dirty) {
    const b = store.board;
    await putBlob('snap', te.encode(JSON.stringify({ name: b.name, items: b.items, links: b.links, tree: b.tree, at: Date.now(), by: me.name })), l);
  }
  const used = referencedAssets(store.board.items);
  for (const [id, src] of Object.entries(store.board.assets || {})) if (used.has(id) && !l.metaAt.has('asset/' + id)) await putBlob('asset/' + id, assetToBytes(src), l);
}

async function publishSnapshot() {
  if (!anyOnline() || !store.board || store.board.id !== boardId) return;
  const b = store.board;
  const snap = { name: b.name, items: b.items, links: b.links, tree: b.tree, at: Date.now(), by: me.name };
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
  for (const [id, src] of Object.entries(store.board.assets || {})) if (used.has(id) && !online().every((l) => l.metaAt.has('asset/' + id))) await putBlob('asset/' + id, assetToBytes(src));
}

// ---------- приём ----------
async function onMessage(topic, payload, l) {
  if (!topic.startsWith(base)) return;
  const rest = topic.slice(base.length);
  try {
    if (rest === 'live') {
      if (!payload.length) return;
      handleLive(JSON.parse(td.decode(await unseal(key, payload))));
      return;
    }
    const cut = rest.lastIndexOf('/');
    const path = rest.slice(0, cut), part = rest.slice(cut + 1);
    // куски собираются отдельно для каждого брокера: на разных серверах могут лежать разные версии
    const bk = l.id + '|' + path;
    let bl = blobs.get(bk);
    if (!bl) blobs.set(bk, (bl = { meta: null, chunks: new Map() }));
    if (part === 'meta') {
      if (!payload.length) { blobs.delete(bk); l.blobN.delete(path); l.metaAt.delete(path); return; }
      bl.meta = JSON.parse(td.decode(await unseal(key, payload)));
      l.blobN.set(path, bl.meta.n); l.metaAt.set(path, bl.meta.at || 1);
      blobN.set(path, Math.max(blobN.get(path) || 0, bl.meta.n));
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
  if (m.at && (appliedAt.get(path) || 0) > m.at) return; // на другом брокере уже была более свежая версия
  for (let i = 0; i < m.n; i++) if (bl.chunks.get(i)?.v !== m.v) return;
  done.set(path, m.v);
  if (m.at) appliedAt.set(path, m.at);
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
  const same = JSON.stringify(b.items) === JSON.stringify(s.items) && JSON.stringify(b.links) === JSON.stringify(s.links) && (!s.tree || JSON.stringify(b.tree) === JSON.stringify(s.tree));
  if (!collab.synced) setTimeout(() => { publishAllAssets(); requestMissing(); }, 3000);
  collab.synced = true;
  clearTimeout(syncTimer);
  if (!same || b.name !== s.name) {
    const wasEmpty = !Object.keys(b.items).length;
    b.items = s.items || {}; b.links = s.links || {}; b.name = s.name || b.name;
    if (s.tree) b.tree = s.tree;
    if (wasEmpty) setTimeout(() => fitAll(false), 50);
    applying = true;
    store.load(b);
    store.rename(b.name, { remote: true });
    applying = false;
    DB.put(b);
  }
  emitState();
}
// Приём «живого» сообщения (через брокер или напрямую): отсев дублей и устаревших правок
const seen = new Map();
const lastSeq = new Map();
function handleLive(m) {
  if (!m || m.f === cid) return;
  const id = m.f + ':' + m.s;
  if (seen.has(id)) return;
  seen.set(id, 1);
  if (seen.size > 20000) for (const k of [...seen.keys()].slice(0, 5000)) seen.delete(k);
  if (m.t === 'up' || m.t === 'rm' || m.t === 'lup' || m.t === 'lrm' || m.t === 'tup' || m.t === 'trm') {
    const k = m.f + '|' + (m.item?.id || m.link?.id || m.node?.id || m.id);
    if ((lastSeq.get(k) || 0) > m.s) return; // более новая правка этого элемента уже пришла
    lastSeq.set(k, m.s);
  }
  if (m.t === 'rtc') { onSignal(m); return; }
  maybeConnectPeer(m.f);
  apply(m);
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
      case 'tup': store.setNode(m.node, o); break;
      case 'trm': store.removeNode(m.id, o); break;
      case 'cur': setRemoteCursor(m.uid, m); touchUser({ id: m.uid, name: m.name, color: m.color, cid: m.f, page: m.page }); break;
      case 'hello': { const isNew = !collab.users.has(m.user?.id); touchUser({ ...m.user, cid: m.f }); send({ t: 'ping', user: { ...me, page: store.page } }); if (isNew) toast(`${m.user.name} подключился`, 'ok', 1800); break; }
      case 'ping': touchUser({ ...m.user, cid: m.f }); break;
      case 'bye': closePeer(m.f); dropUser(m.uid); break;
      case 'need': answerNeed(m.ids || []); break;
    }
  } finally { applying = false; }
}
function touchUser(u) {
  if (!u?.id || u.id === me.id) return;
  const old = collab.users.get(u.id);
  collab.users.set(u.id, { ...old, ...u, seen: Date.now() });
  if (!old || (u.page && old.page !== u.page)) emitPresence();
}
function dropUser(id) {
  const u = collab.users.get(id);
  if (!u || id === me.id) return;
  collab.users.delete(id);
  removeRemoteCursor(id);
  if (u.cid) closePeer(u.cid);
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

// ---------- прямые соединения WebRTC (брокер нужен только для «знакомства») ----------
const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.sipnet.ru:3478' },
];
const peers = new Map();   // cid участника → { pc, dc, open, cands, remoteSet }
const failedAt = new Map();
const allDirect = () => { const others = [...collab.users.values()].filter((u) => u.id !== me.id); return others.length > 0 && others.every((u) => peers.get(u.cid)?.open); };
function rtcSend(m) {
  if (!peers.size) return;
  const str = JSON.stringify(m);
  if (str.length > 60000) return; // крупные сообщения — только через брокер
  for (const p of peers.values()) if (p.open) { try { p.dc.send(str); } catch {} }
}
function maybeConnectPeer(other) {
  if (!other || other === cid || peers.has(other) || typeof RTCPeerConnection === 'undefined') return;
  if (Date.now() - (failedAt.get(other) || 0) < 30000) return;
  if (cid < other) startPeer(other); // соединение начинает участник с меньшим id, второй ждёт предложение
}
function makePeer(other) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const p = { pc, dc: null, open: false, cands: [], remoteSet: false };
  peers.set(other, p);
  pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'rtc', to: other, cand: e.candidate.toJSON() }, { mqttOnly: true }); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { failedAt.set(other, Date.now()); closePeer(other); }
  };
  pc.ondatachannel = (e) => setupChannel(other, e.channel);
  return p;
}
function setupChannel(other, dc) {
  const p = peers.get(other);
  if (!p) return;
  p.dc = dc;
  dc.onopen = () => { p.open = true; refreshStatus(); };
  dc.onclose = () => { p.open = false; refreshStatus(); };
  dc.onmessage = (e) => { try { handleLive(JSON.parse(e.data)); } catch {} };
}
async function startPeer(other) {
  try {
    const p = makePeer(other);
    setupChannel(other, p.pc.createDataChannel('gdb', { ordered: true }));
    await p.pc.setLocalDescription(await p.pc.createOffer());
    send({ t: 'rtc', to: other, sdp: p.pc.localDescription.toJSON() }, { mqttOnly: true });
    setTimeout(() => { if (peers.get(other) === p && !p.open) { failedAt.set(other, Date.now()); closePeer(other); } }, 20000);
  } catch (e) { console.warn('rtc', e); closePeer(other); }
}
async function onSignal(m) {
  if (m.to !== cid || typeof RTCPeerConnection === 'undefined') return;
  try {
    let p = peers.get(m.f);
    if (m.sdp?.type === 'offer') {
      if (p) closePeer(m.f);
      p = makePeer(m.f);
      await p.pc.setRemoteDescription(m.sdp);
      p.remoteSet = true;
      for (const c of p.cands.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      send({ t: 'rtc', to: m.f, sdp: p.pc.localDescription.toJSON() }, { mqttOnly: true });
    } else if (m.sdp?.type === 'answer' && p && !p.remoteSet) {
      await p.pc.setRemoteDescription(m.sdp);
      p.remoteSet = true;
      for (const c of p.cands.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
    } else if (m.cand && p) {
      if (p.remoteSet) await p.pc.addIceCandidate(m.cand).catch(() => {});
      else p.cands.push(m.cand);
    }
  } catch (e) { console.warn('rtc signal', e); }
}
function closePeer(other) {
  const p = peers.get(other);
  if (!p) return;
  peers.delete(other);
  try { p.dc?.close(); } catch {}
  try { p.pc.close(); } catch {}
  refreshStatus();
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
  const own = await ownServer();
  if (!collab.active || boardId !== board.id) return;
  links = brokersFor(board.room, own).map((b) => ({ ...b, client: null, status: 'connecting', rtt: null, err: '', retryN: 0, retryTimer: null, blobN: new Map(), metaAt: new Map() }));
  refreshStatus(); emitPresence();
  // общие таймеры
  clearInterval(pingTimer); pingTimer = setInterval(() => send({ t: 'ping', user: { ...me, page: store.page } }), 10000);
  clearInterval(sweepTimer); sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, u] of collab.users) if (id !== me.id && now - (u.seen || 0) > 35000) dropUser(id);
  }, 5000);
  // если на брокерах нет сохранённой доски — значит, мы первые: выкладываем свою
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (!collab.synced && store.board?.id === boardId && anyOnline()) {
      collab.synced = true;
      if (Object.keys(store.board.items).length || dirty) await publishSnapshot();
      refreshStatus();
    }
    await publishAllAssets();
    setTimeout(requestMissing, 2500);
  }, 4000);
  await Promise.race([Promise.all(links.map(dialLink)), new Promise((r) => setTimeout(r, 8000))]);
}
async function dialLink(l) {
  if (!collab.active || !links.includes(l)) return;
  const will = { topic: base + 'live', payload: await seal(key, te.encode(JSON.stringify({ t: 'bye', uid: me.id, f: cid, s: 0 }))) };
  const client = new MQTTClient(l.url, { clientId: cid + '_' + l.id, username: l.username, password: l.password, will, keepalive: 30 });
  l.client = client; l.status = 'connecting'; refreshStatus();
  client.on('message', (t, p) => onMessage(t, p, l));
  client.on('close', () => {
    if (!collab.active || l.client !== client) return;
    l.status = 'error'; l.err = 'связь потеряна'; refreshStatus();
    retryLink(l);
  });
  const t0 = performance.now();
  try {
    await client.connect(9000);
    l.rtt = Math.round(performance.now() - t0);
    l.retryN = 0; l.status = 'online'; l.err = '';
    l.blobN.clear(); l.metaAt.clear();
    await client.subscribe(base + '#');
    refreshStatus();
    send({ t: 'hello', user: { ...me, page: store.page } });
    if (dirty) scheduleSnapshot();
    // через пару секунд (когда сервер пришлёт сохранённое) докладываем ему недостающее
    setTimeout(() => { if (l.client === client) repairLink(l).then(() => requestMissing()); }, 3000);
  } catch (e) {
    l.status = 'error'; l.err = e.message || 'недоступен';
    refreshStatus();
    retryLink(l);
  }
}
function retryLink(l) {
  clearTimeout(l.retryTimer);
  const delay = [2000, 4000, 8000, 15000, 30000, 60000][Math.min(l.retryN++, 5)];
  l.retryTimer = setTimeout(() => { if (collab.active && links.includes(l)) dialLink(l); }, delay);
}
// Ручная проверка связи (кнопка в окне «Совместно»)
export function redial() { for (const l of links) if (!l.client?.connected) { clearTimeout(l.retryTimer); l.retryN = 0; dialLink(l); } }

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
  clearInterval(pingTimer); clearInterval(sweepTimer); clearTimeout(syncTimer);
  const old = links, oldKey = key, topic = base + 'live';
  if (collab.active && oldKey) {
    rtcSend({ t: 'bye', uid: me.id, f: cid, s: ++seq });
    const bye = { t: 'bye', uid: me.id, f: cid, s: ++seq };
    seal(oldKey, te.encode(JSON.stringify(bye))).then((p) => { for (const l of old) if (l.client?.connected) try { l.client.publish(topic, p); } catch {} }).catch(() => {});
  }
  for (const l of old) {
    clearTimeout(l.retryTimer);
    const c = l.client;
    if (c) setTimeout(() => c.end(), 250);
  }
  links = [];
  queue.clear(); clearTimeout(flushTimer); flushTimer = null;
  blobs.clear(); blobN.clear(); done.clear(); appliedAt.clear();
  for (const k of [...peers.keys()]) closePeer(k);
  if (forget && store.board?.room) { delete store.board.room; DB.put(store.board); }
  collab.active = false; collab.status = 'off'; collab.room = null; collab.synced = false; collab.links = []; collab.direct = 0;
  collab.users.clear();
  clearRemoteCursors();
  boardId = null;
  seen.clear(); lastSeq.clear();
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
store.on('tree', (node, o) => { if (local(o)) { send({ t: 'tup', node }); changed(); } });
store.on('treerm', (id, o) => { if (local(o)) { send({ t: 'trm', id }); changed(); } });
store.on('page', (page) => { if (collab.active) { send({ t: 'ping', user: { ...me, page } }); collab.users.set(me.id, { ...collab.users.get(me.id), ...me, page, seen: Date.now() }); emitPresence(); } });
store.on('asset', (id, src, o) => { if (local(o)) putBlob('asset/' + id, assetToBytes(src)); });

export function trackCursor(vp) {
  const sendCur = throttle((x, y) => send({ t: 'cur', uid: me.id, name: me.name, color: me.color, x, y, page: store.page }), 40);
  vp.addEventListener('pointermove', (e) => {
    if (!collab.active || collab.status !== 'online') return;
    const p = screenToWorld(e.clientX, e.clientY);
    sendCur(Math.round(p.x), Math.round(p.y));
  });
}
window.addEventListener('beforeunload', () => { if (collab.active && dirty) publishSnapshot(); });
