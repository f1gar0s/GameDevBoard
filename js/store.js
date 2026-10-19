// Состояние доски, история (undo/redo) и сохранение в IndexedDB
import { uid, debounce } from './util.js';

// ---------- IndexedDB с запасным вариантом в памяти ----------
const mem = new Map();
let dbp = null;
function openDB() {
  if (!dbp) {
    dbp = new Promise((res) => {
      try {
        const r = indexedDB.open('gdboard', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('boards', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      } catch { res(null); }
    });
  }
  return dbp;
}
async function req(mode, fn, fallback) {
  const db = await openDB();
  if (!db) return fallback();
  return new Promise((res, rej) => {
    const t = db.transaction('boards', mode);
    const r = fn(t.objectStore('boards'));
    t.oncomplete = () => res(r?.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
export const DB = {
  all: () => req('readonly', (s) => s.getAll(), () => [...mem.values()]),
  get: (id) => req('readonly', (s) => s.get(id), () => mem.get(id)),
  put: (b) => req('readwrite', (s) => s.put(b), () => mem.set(b.id, structuredClone(b))),
  del: (id) => req('readwrite', (s) => s.delete(id), () => mem.delete(id)),
};

export function newBoard(name = 'Новая доска') {
  return { id: uid('b'), name, created: Date.now(), updated: Date.now(), items: {}, links: {}, assets: {}, view: { x: 0, y: 0, z: 1 } };
}

// ---------- Store ----------
export const store = {
  board: null,
  undoStack: [],
  redoStack: [],
  ls: {},
  on(ev, fn) { (this.ls[ev] ??= []).push(fn); },
  emit(ev, ...a) { (this.ls[ev] || []).forEach((f) => f(...a)); },

  load(board) {
    board.items ??= {}; board.links ??= {}; board.assets ??= {}; board.view ??= { x: 0, y: 0, z: 1 };
    this.board = board;
    this.undoStack = []; this.redoStack = [];
    this.emit('load', board);
  },
  get items() { return this.board.items; },
  get links() { return this.board.links; },
  item(id) { return this.board?.items[id]; },

  maxZ() { let m = 0; for (const i of Object.values(this.board.items)) m = Math.max(m, i.z || 0); return m; },
  minZ() { let m = 0; for (const i of Object.values(this.board.items)) m = Math.min(m, i.z || 0); return m; },

  upsert(item, opts = {}) {
    this.board.items[item.id] = item;
    this.emit('item', item, opts);
    this.touch(opts);
  },
  patch(id, patch, opts = {}) {
    const it = this.board.items[id];
    if (!it) return;
    const { data, ...rest } = patch;
    Object.assign(it, rest);
    if (data) it.data = { ...it.data, ...data };
    this.emit('item', it, opts);
    this.touch(opts);
  },
  remove(id, opts = {}) {
    if (!this.board.items[id]) return;
    delete this.board.items[id];
    for (const l of Object.values(this.board.links)) if (l.from === id || l.to === id) this.removeLink(l.id, opts);
    this.emit('remove', id, opts);
    this.touch(opts);
  },
  upsertLink(link, opts = {}) {
    this.board.links[link.id] = link;
    this.emit('link', link, opts);
    this.touch(opts);
  },
  patchLink(id, patch, opts = {}) {
    const l = this.board.links[id];
    if (!l) return;
    Object.assign(l, patch);
    this.emit('link', l, opts);
    this.touch(opts);
  },
  removeLink(id, opts = {}) {
    const l = this.board.links[id];
    if (!l) return;
    delete this.board.links[id];
    this.emit('unlink', l, opts);
    this.touch(opts);
  },
  addAsset(src, opts = {}) {
    for (const [k, v] of Object.entries(this.board.assets)) if (v === src) return k;
    const id = uid('a');
    this.board.assets[id] = src;
    this.emit('asset', id, src, opts);
    this.touch(opts);
    return id;
  },
  setAsset(id, src, opts = {}) {
    this.board.assets[id] = src;
    this.emit('asset', id, src, opts);
    this.touch(opts);
  },
  rename(name, opts = {}) {
    this.board.name = name;
    this.emit('rename', name, opts);
    this.touch(opts);
  },
  outgoing(id) { return Object.values(this.board.links).filter((l) => l.from === id); },
  incoming(id) { return Object.values(this.board.links).filter((l) => l.to === id); },

  // ----- история -----
  snapshot() { return JSON.stringify({ items: this.board.items, links: this.board.links }); },
  checkpoint() {
    const snap = this.snapshot();
    if (this.undoStack[this.undoStack.length - 1] === snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
  },
  restore(json) {
    const s = JSON.parse(json);
    const cur = this.board;
    for (const id of Object.keys(cur.links)) if (!s.links[id]) this.removeLink(id);
    for (const id of Object.keys(cur.items)) if (!s.items[id]) this.remove(id);
    for (const [id, it] of Object.entries(s.items)) if (JSON.stringify(cur.items[id]) !== JSON.stringify(it)) this.upsert(it);
    for (const [id, l] of Object.entries(s.links)) if (JSON.stringify(cur.links[id]) !== JSON.stringify(l)) this.upsertLink(l);
  },
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
    return true;
  },
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
    return true;
  },

  // ----- сохранение -----
  touch(opts = {}) {
    if (!this.board) return;
    this.board.updated = Date.now();
    if (!opts.nosave) this.save();
    this.emit('change');
  },
  save: debounce(function () {
    if (!store.board) return;
    store.emit('saving');
    DB.put(store.board).then(() => store.emit('saved')).catch((e) => { console.error(e); store.emit('save-error', e); });
  }, 400),
  saveNow() { if (this.board) return DB.put(this.board); },
};
