// Минимальный MQTT 3.1.1 клиент поверх WebSocket (без внешних библиотек).
// Нужен для совместного доступа на статическом хостинге (GitHub Pages):
// браузеры подключаются к публичному MQTT-брокеру по wss:// и обмениваются сообщениями.

const te = new TextEncoder();
const td = new TextDecoder();

function str(s) {
  const b = te.encode(s);
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8; out[1] = b.length & 255; out.set(b, 2);
  return out;
}
function bin(b) {
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8; out[1] = b.length & 255; out.set(b, 2);
  return out;
}
function varint(n) {
  const out = [];
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0);
  return out;
}
function packet(type, flags, ...parts) {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const head = [(type << 4) | flags, ...varint(len)];
  const out = new Uint8Array(head.length + len);
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u16 = (n) => new Uint8Array([n >> 8, n & 255]);

export class MQTTClient {
  constructor(url, { clientId, username, password, will, keepalive = 30 } = {}) {
    this.url = url;
    this.opts = { clientId: clientId || 'gdb_' + Math.random().toString(36).slice(2, 12), username, password, will, keepalive };
    this.ls = {};
    this.buf = new Uint8Array(0);
    this.pid = 1;
    this.pending = new Map();
    this.connected = false;
  }
  on(ev, fn) { (this.ls[ev] ??= []).push(fn); return this; }
  emit(ev, ...a) { (this.ls[ev] || []).forEach((f) => f(...a)); }

  connect(timeout = 10000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (e) => { if (!done) { done = true; reject(e); } };
      const t = setTimeout(() => { fail(new Error('Брокер не ответил')); try { this.ws?.close(); } catch {} }, timeout);
      let ws;
      try { ws = new WebSocket(this.url, ['mqtt']); } catch (e) { clearTimeout(t); fail(e); return; }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(this._connectPacket());
      ws.onmessage = (e) => this._data(new Uint8Array(e.data));
      ws.onerror = () => { clearTimeout(t); fail(new Error('Не удалось подключиться к ' + this.url)); };
      ws.onclose = () => {
        clearTimeout(t);
        clearInterval(this.ping);
        const was = this.connected;
        this.connected = false;
        fail(new Error('Соединение закрыто'));
        if (was) this.emit('close');
      };
      this._onConnack = (code) => {
        clearTimeout(t);
        if (code !== 0) { fail(new Error('Брокер отклонил подключение (код ' + code + ')')); try { ws.close(); } catch {} return; }
        done = true;
        this.connected = true;
        this.ping = setInterval(() => this._send(packet(12, 0)), this.opts.keepalive * 1000 * 0.8);
        resolve();
        this.emit('connect');
      };
    });
  }
  _connectPacket() {
    const o = this.opts;
    let flags = 0x02; // clean session
    const payload = [str(o.clientId)];
    if (o.will) {
      flags |= 0x04 | (o.will.retain ? 0x20 : 0);
      payload.push(str(o.will.topic), bin(o.will.payload));
    }
    if (o.username) { flags |= 0x80; payload.push(str(o.username)); }
    if (o.password) { flags |= 0x40; payload.push(str(o.password)); }
    return packet(1, 0, str('MQTT'), new Uint8Array([4, flags]), u16(o.keepalive), ...payload);
  }
  _send(p) { if (this.ws?.readyState === 1) this.ws.send(p); }

  subscribe(filter) {
    const id = this.pid++ & 0xffff || 1;
    this._send(packet(8, 2, u16(id), str(filter), new Uint8Array([0])));
    return new Promise((res) => this.pending.set(id, res));
  }
  publish(topic, payload, { retain = false } = {}) {
    const body = typeof payload === 'string' ? te.encode(payload) : payload || new Uint8Array(0);
    this._send(packet(3, retain ? 1 : 0, str(topic), body));
  }
  end() {
    clearInterval(this.ping);
    try { this._send(packet(14, 0)); } catch {}
    this.connected = false;
    try { this.ws?.close(); } catch {}
  }

  _data(chunk) {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf); b.set(chunk, this.buf.length);
    this.buf = b;
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1, len = 0, i = 1, byte;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128 && i < 5);
      if (this.buf.length < i + len) return;
      const type = this.buf[0] >> 4, flags = this.buf[0] & 15;
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      this._packet(type, flags, body);
    }
  }
  _packet(type, flags, body) {
    switch (type) {
      case 2: this._onConnack?.(body[1]); break; // CONNACK
      case 3: { // PUBLISH
        const tl = (body[0] << 8) | body[1];
        const topic = td.decode(body.subarray(2, 2 + tl));
        const qos = (flags >> 1) & 3;
        const start = 2 + tl + (qos ? 2 : 0);
        if (qos === 1) this._send(packet(4, 0, body.subarray(2 + tl, 4 + tl))); // PUBACK
        this.emit('message', topic, body.slice(start), !!(flags & 1));
        break;
      }
      case 9: { const id = (body[0] << 8) | body[1]; this.pending.get(id)?.(); this.pending.delete(id); break; } // SUBACK
      default: break; // PINGRESP и прочее
    }
  }
}
