// Общие утилиты
export const uid = (p = '') =>
  p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) e.style.setProperty(sk, sv);
        else e.style[sk] = sv;
      }
    }
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function throttle(fn, ms) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now();
    clearTimeout(t);
    if (now - last >= ms) { last = now; fn(...a); }
    else t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last));
  };
}

export function download(name, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function toast(msg, kind = 'info', ms = 2600) {
  const root = document.getElementById('toasts');
  const t = h('div', { class: `toast ${kind}` }, msg);
  root.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

export function modal(title, body, { actions = [], wide = false, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const wrap = h('div', { class: 'modal-wrap', onPointerdown: (e) => { if (e.target === wrap) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', title: 'Закрыть', onClick: close }, '✕')),
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) =>
        h('button', { class: 'btn ' + (a.primary ? 'primary' : ''), onClick: () => { if (a.onClick?.() !== false) close(); } }, a.label))) : null
    ));
  root.append(wrap);
  document.addEventListener('keydown', onKey, true);
  return { close, el: wrap };
}

export function prompt2(title, value = '', placeholder = '') {
  return new Promise((res) => {
    const inp = h('input', { class: 'input', value, placeholder });
    let done = false;
    const m = modal(title, inp, {
      actions: [
        { label: 'Отмена', onClick: () => { done = true; res(null); } },
        { label: 'OK', primary: true, onClick: () => { done = true; res(inp.value); } },
      ],
      onClose: () => { if (!done) res(null); },
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; res(inp.value); m.close(); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}

export function isTyping() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

export function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

export async function compress(str) {
  const cs = new CompressionStream('deflate-raw');
  const buf = await new Response(new Blob([str]).stream().pipeThrough(cs)).arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decompress(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ds = new DecompressionStream('deflate-raw');
  return await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
}

export function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'только что';
  if (d < 3600) return `${Math.floor(d / 60)} мин назад`;
  if (d < 86400) return `${Math.floor(d / 3600)} ч назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

// ---------- YouTube ----------
// Разбор ссылки YouTube: watch?v=, youtu.be/, shorts/, embed/, live/ + время старта (t=1m30s, t=90, start=90)
export function parseYouTube(s) {
  const t = String(s || '').trim();
  const m = t.match(/^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:[^\s#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})(\S*)$/i);
  if (!m) return null;
  let start = 0;
  const tm = (m[2] || '').match(/[?&#](?:t|start)=([0-9hms]+)/);
  if (tm) {
    const v = tm[1];
    if (/^\d+$/.test(v)) start = +v;
    else { const p = v.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/); start = (+p[1] || 0) * 3600 + (+p[2] || 0) * 60 + (+p[3] || 0); }
  }
  return { id: m[1], start, url: t };
}
// Название ролика (без ключей API, через noembed); при ошибке — null
export async function youTubeTitle(url) {
  try {
    const r = await fetch('https://noembed.com/embed?url=' + encodeURIComponent(url));
    const j = await r.json();
    return j.title || null;
  } catch { return null; }
}

// ---------- картинки ----------
// Большие фото уменьшаются и пережимаются (быстрее синхронизация и меньше места);
// маленькие картинки и пиксель-арт остаются без потерь, GIF — как есть.
export async function imageFileToDataURL(file, { max = 1600, quality = 0.85 } = {}) {
  const src = await readFileAsDataURL(file);
  if (/gif|svg/.test(file.type)) return src;
  let img;
  try { img = await loadImage(src); } catch { return src; }
  const big = Math.max(img.width, img.height);
  if (big <= max && file.size < 350 * 1024) return src;
  const k = Math.min(1, max / big);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  let out = cv.toDataURL('image/webp', quality);
  if (!out.startsWith('data:image/webp')) out = cv.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
  return out.length < src.length ? out : src;
}
