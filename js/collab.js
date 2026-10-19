// Совместная работа в реальном времени через WebRTC (PeerJS), без собственного сервера
import { store } from './store.js';
import { uid, toast, throttle } from './util.js';
import { setRemoteCursor, removeRemoteCursor, clearRemoteCursors, screenToWorld } from './canvas.js';

const COLORS = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee', '#f87171'];
function loadMe() {
  let me;
  try { me = JSON.parse(localStorage.getItem('gdb-me') || 'null'); } catch {}
  if (!me) me = { id: uid('u'), name: 'Гость-' + Math.floor(Math.random() * 900 + 100), color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  return me;
}
export const me = loadMe();
export function setMyName(name) {
  me.name = name.slice(0, 24) || me.name;
  try { localStorage.setItem('gdb-me', JSON.stringify(me)); } catch {}
  broadcast({ t: 'user', user: me });
}

export const collab = { active: false, role: null, code: null, users: new Map() };
let peer = null;
const conns = new Map(); // peerId -> conn
const ls = { presence: [], init: [], state: [] };
export const onPresence = (f) => ls.presence.push(f);
export const onInit = (f) => ls.init.push(f);
export const onState = (f) => ls.state.push(f);
const emitPresence = () => ls.presence.forEach((f) => f([...collab.users.values()]));
const emitState = () => ls.state.forEach((f) => f(collab));

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.append(s);
  });
}
async function loadPeer() {
  if (window.Peer) return;
  try { await loadScript('https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js'); }
  catch { await loadScript('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js'); }
  if (!window.Peer) throw new Error('PeerJS не загрузился');
}

function send(conn, msg) { try { if (conn.open) conn.send(msg); } catch (e) { console.warn(e); } }
function broadcast(msg, except) {
  if (!collab.active) return;
  for (const [pid, c] of conns) if (pid !== except) send(c, msg);
}

function apply(msg) {
  const o = { remote: true };
  switch (msg.t) {
    case 'up': store.upsert(msg.item, o); break;
    case 'rm': store.remove(msg.id, o); break;
    case 'lup': store.upsertLink(msg.link, o); break;
    case 'lrm': store.removeLink(msg.id, o); break;
    case 'asset': store.setAsset(msg.id, msg.src, o); break;
    case 'rename': store.rename(msg.name, o); break;
    case 'cur': setRemoteCursor(msg.uid, msg); break;
    case 'user': collab.users.set(msg.user.id, msg.user); emitPresence(); break;
    case 'leave': collab.users.delete(msg.uid); removeRemoteCursor(msg.uid); emitPresence(); break;
  }
}

function setupConn(conn) {
  conns.set(conn.peer, conn);
  conn.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello' && collab.role === 'host') {
      conn._uid = msg.user.id;
      collab.users.set(msg.user.id, msg.user);
      send(conn, { t: 'init', board: store.board, users: [...collab.users.values()] });
      broadcast({ t: 'user', user: msg.user }, conn.peer);
      emitPresence();
      toast(`${msg.user.name} присоединился`, 'ok');
      return;
    }
    if (msg.t === 'init' && collab.role === 'guest') {
      collab.users.clear();
      msg.users.forEach((u) => collab.users.set(u.id, u));
      ls.init.forEach((f) => f(msg.board));
      emitPresence();
      return;
    }
    apply(msg);
    if (collab.role === 'host') broadcast(msg, conn.peer);
  });
  conn.on('close', () => {
    conns.delete(conn.peer);
    if (collab.role === 'host') {
      if (conn._uid) { const u = collab.users.get(conn._uid); collab.users.delete(conn._uid); removeRemoteCursor(conn._uid); broadcast({ t: 'leave', uid: conn._uid }); emitPresence(); if (u) toast(`${u.name} вышел`); }
    } else {
      toast('Сессия завершена хостом', 'err');
      leave();
    }
  });
}

export async function host() {
  if (collab.active) return collab.code;
  await loadPeer();
  return new Promise((res, rej) => {
    const code = Math.random().toString(36).slice(2, 8);
    peer = new window.Peer('gdboard-' + code, { debug: 1 });
    peer.on('open', () => {
      collab.active = true; collab.role = 'host'; collab.code = code;
      collab.users.clear(); collab.users.set(me.id, me);
      emitPresence(); emitState();
      res(code);
    });
    peer.on('connection', (conn) => setupConn(conn));
    peer.on('error', (e) => { console.warn(e); if (!collab.active) rej(e); else toast('Сеть: ' + e.type, 'err'); });
  });
}

export async function join(code) {
  await loadPeer();
  return new Promise((res, rej) => {
    peer = new window.Peer({ debug: 1 });
    const timer = setTimeout(() => { rej(new Error('Хост не отвечает')); leave(); }, 15000);
    peer.on('open', () => {
      const conn = peer.connect('gdboard-' + code, { reliable: true });
      setupConn(conn);
      conn.on('open', () => {
        collab.active = true; collab.role = 'guest'; collab.code = code;
        send(conn, { t: 'hello', user: me });
        emitState();
        const once = (b) => { clearTimeout(timer); res(b); ls.init.splice(ls.init.indexOf(once), 1); };
        ls.init.push(once);
      });
    });
    peer.on('error', (e) => { clearTimeout(timer); rej(e); leave(); });
  });
}

export function leave() {
  if (peer) { broadcast({ t: 'leave', uid: me.id }); try { peer.destroy(); } catch {} }
  peer = null;
  conns.clear();
  collab.active = false; collab.role = null; collab.code = null;
  collab.users.clear();
  clearRemoteCursors();
  emitPresence(); emitState();
}

// Транслируем локальные изменения
store.on('item', (it, o) => { if (!o.remote) broadcast({ t: 'up', item: it }); });
store.on('remove', (id, o) => { if (!o.remote) broadcast({ t: 'rm', id }); });
store.on('link', (l, o) => { if (!o.remote) broadcast({ t: 'lup', link: l }); });
store.on('unlink', (l, o) => { if (!o.remote) broadcast({ t: 'lrm', id: l.id }); });
store.on('asset', (id, src, o) => { if (!o.remote) broadcast({ t: 'asset', id, src }); });
store.on('rename', (name, o) => { if (!o.remote) broadcast({ t: 'rename', name }); });

export function trackCursor(vp) {
  const sendCur = throttle((x, y) => broadcast({ t: 'cur', uid: me.id, name: me.name, color: me.color, x, y }), 40);
  vp.addEventListener('pointermove', (e) => {
    if (!collab.active) return;
    const p = screenToWorld(e.clientX, e.clientY);
    sendCur(Math.round(p.x), Math.round(p.y));
  });
}
