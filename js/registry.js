// Реестр компонентов карточек (по аналогии с компонентами Unity).
// Компоненты лежат в папке /components и перечислены в components/manifest.js.
// Компонент может наследовать другой: extends: 'text' — тогда в render/settings
// доступен ctx.base(), который вызывает логику родителя, а ваш код её дополняет.

const defs = new Map();
const resolved = new Map();

export function register(def) {
  if (!def?.type) throw new Error('У компонента нет поля type');
  defs.set(def.type, def);
  resolved.clear();
}

export function getComponent(type) {
  if (resolved.has(type)) return resolved.get(type);
  const d = defs.get(type);
  if (!d) return null;
  let r = d;
  if (d.extends) {
    const p = getComponent(d.extends);
    if (!p) console.warn(`Компонент «${type}» наследует неизвестный «${d.extends}»`);
    else {
      r = { ...p, hidden: false, ...d, parent: p };
      r.defaults = () => ({ ...(p.defaults?.() || {}), ...(d.defaults?.() || {}) });
    }
  }
  resolved.set(type, r);
  return r;
}

export const allComponents = () => [...defs.keys()].map(getComponent).filter((c) => c && !c.hidden);

// Вызов метода с поддержкой ctx.base() по цепочке наследования
export function callWithBase(def, method, ctx) {
  const own = def[method];
  if (!own) return null;
  // ищем ближайшего предка, у которого метод другой (свой)
  let p = def.parent;
  while (p && p[method] === own) p = p.parent;
  const base = p && p[method] ? () => callWithBase(p, method, ctx) : () => null;
  return own.call(def, { ...ctx, base });
}

export async function loadComponents() {
  let list = [];
  try { list = (await import('../components/manifest.js')).default; }
  catch (e) { console.error('Не найден components/manifest.js', e); }
  const failed = [];
  // загружаем по порядку: сначала базовые, потом наследники
  for (const f of list) {
    try { register((await import('../components/' + f)).default); }
    catch (e) { console.error('Компонент не загрузился:', f, e); failed.push(f); }
  }
  return failed;
}
