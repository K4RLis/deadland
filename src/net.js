// P2P-мультиплеер через WebRTC (PeerJS). Хост — один из игроков, остальные подключаются по коду комнаты.
// Сервер не нужен: PeerJS использует бесплатный публичный сервер только для «рукопожатия».
import { NET_PREFIX, MAX_PLAYERS } from './config.js';

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

export function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.online = false;
    this.conns = new Map();
    this.hostConn = null;
    this.nextPid = 2;
    this.code = null;
    this.onHostMsg = null;   // (pid, msg)
    this.onClientMsg = null; // (msg)
    this.onJoin = null;      // (pid, hello)
    this.onLeave = null;     // (pid)
    this.onHostLost = null;
    this.buffer = [];
  }

  static available() { return typeof window.Peer === 'function'; }

  host(code) {
    return new Promise((resolve, reject) => {
      if (!Net.available()) { reject(new Error('PeerJS не загрузился (нет интернета?)')); return; }
      this.isHost = true;
      this.code = code;
      const peer = new window.Peer(NET_PREFIX + code, { config: ICE, debug: 1 });
      this.peer = peer;
      let opened = false;
      const timer = setTimeout(() => { if (!opened) { reject(new Error('Сервер сигнализации не ответил')); } }, 15000);
      peer.on('open', () => { opened = true; clearTimeout(timer); this.online = true; resolve(code); });
      peer.on('error', e => {
        console.warn('peer error', e.type, e);
        if (!opened) { clearTimeout(timer); reject(e); }
      });
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (_) { /* ignore */ } }, 2000); });
      peer.on('connection', conn => this.accept(conn));
    });
  }

  accept(conn) {
    conn.on('data', d => {
      if (!conn.pid) {
        if (d && d.t === 'hello') {
          if (this.conns.size + 1 >= MAX_PLAYERS) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 600); return; }
          conn.pid = this.nextPid++;
          this.conns.set(conn.pid, conn);
          if (this.onJoin) this.onJoin(conn.pid, d);
        }
        return;
      }
      if (this.onHostMsg) {
        try { this.onHostMsg(conn.pid, d); } catch (e) { console.error(e); }
      }
    });
    const gone = () => {
      if (conn.pid && this.conns.get(conn.pid) === conn) {
        this.conns.delete(conn.pid);
        if (this.onLeave) this.onLeave(conn.pid);
      }
    };
    conn.on('close', gone);
    conn.on('error', e => { console.warn('conn error', e); gone(); });
    // ICE может отвалиться без события close
    conn.on('iceStateChanged', s => { if (s === 'failed' || s === 'closed') gone(); });
  }

  join(code, hello) {
    return new Promise((resolve, reject) => {
      if (!Net.available()) { reject(new Error('PeerJS не загрузился (нет интернета?)')); return; }
      this.isHost = false;
      this.code = code;
      const peer = new window.Peer(undefined, { config: ICE, debug: 1 });
      this.peer = peer;
      let welcomed = false;
      const timer = setTimeout(() => { if (!welcomed) { reject(new Error('Сервер не отвечает. Проверь код комнаты.')); this.close(); } }, 20000);
      peer.on('error', e => {
        console.warn('peer error', e.type, e);
        if (!welcomed) {
          clearTimeout(timer);
          reject(new Error(e.type === 'peer-unavailable' ? 'Комната ' + code + ' не найдена' : 'Ошибка сети: ' + e.type));
        }
      });
      peer.on('open', () => {
        const conn = peer.connect(NET_PREFIX + code, { reliable: true, serialization: 'json' });
        this.hostConn = conn;
        conn.on('open', () => conn.send(hello));
        conn.on('data', d => {
          if (!welcomed) {
            if (d.t === 'welcome') { welcomed = true; clearTimeout(timer); this.online = true; resolve(d); }
            else if (d.t === 'full') { clearTimeout(timer); reject(new Error('Сервер заполнен (максимум ' + MAX_PLAYERS + ' игроков)')); }
            return;
          }
          if (this.onClientMsg) { try { this.onClientMsg(d); } catch (e) { console.error(e); } }
          else this.buffer.push(d);
        });
        const lost = () => { if (welcomed && this.onHostLost) { const f = this.onHostLost; this.onHostLost = null; f(); } };
        conn.on('close', lost);
        conn.on('error', lost);
        conn.on('iceStateChanged', s => { if (s === 'failed' || s === 'closed') lost(); });
      });
    });
  }

  // после создания игры отдать накопленные сообщения
  drain() {
    const b = this.buffer;
    this.buffer = [];
    for (const d of b) { try { this.onClientMsg(d); } catch (e) { console.error(e); } }
  }

  send(pid, msg) {
    const c = this.conns.get(pid);
    if (c && c.open) { try { c.send(msg); } catch (e) { console.warn(e); } }
  }

  toHost(msg) {
    const c = this.hostConn;
    if (c && c.open) { try { c.send(msg); } catch (e) { console.warn(e); } }
  }

  kick(pid) {
    const c = this.conns.get(pid);
    if (c) { try { c.close(); } catch (_) { /* ignore */ } }
  }

  close() {
    try { if (this.peer) this.peer.destroy(); } catch (_) { /* ignore */ }
    this.peer = null; this.conns.clear(); this.hostConn = null; this.online = false;
  }
}
