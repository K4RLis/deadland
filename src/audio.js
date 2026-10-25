// Звуки на WebAudio: почти всё синтезируется на лету, выстрелы и урон — записанные сэмплы.
import { VERSION } from './config.js';

// Записанные звуки: id → файлы в assets/sfx (несколько файлов — варианты, играются вперемешку).
// Тишина в начале файла и слишком длинный хвост обрезаются при загрузке.
const SAMPLE_FILES = {
  pistol: ['pistol.wav'], smg: ['smg.wav'], shotgun: ['shotgun.wav'], rifle: ['rifle.wav'],
  asval: ['asval.wav'], sniper: ['sniper.mp3'], hurt: ['hurt.mp3'],
};
const MAX_LEN = { sniper: 2.2, hurt: 1.2 };

// убрать тишину перед звуком (порог 5% пика) и обрезать хвост длиннее maxLen с плавным затуханием
function trimBuffer(ctx, buf, maxLen) {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
  let pk = 0;
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i])); }
  if (pk <= 0) return buf;
  let on = n;
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); let i = 0; while (i < on && Math.abs(d[i]) < pk * 0.05) i++; on = i; }
  const start = Math.max(0, on - Math.round(sr * 0.002));
  const len = Math.min(n - start, Math.round(sr * maxLen));
  if (start === 0 && len === n) return buf;
  const cut = start + len < n;
  const fade = Math.max(Math.round(sr * 0.005), Math.min(Math.round(sr * 0.3), Math.round(len * 0.2)));
  const out = ctx.createBuffer(ch, len, sr);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c), o = out.getChannelData(c);
    for (let i = 0; i < len; i++) {
      let k = i < 32 && start > 0 ? i / 32 : 1;
      if (cut && len - i < fade) { const t = (len - i) / fade; k *= t * t; }
      o[i] = d[start + i] * k;
    }
  }
  return out;
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.vol = 0.7;
    this.lx = 0; this.ly = 0; this.lz = 0; this.lyaw = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.vol;
    this.comp = this.ctx.createDynamicsCompressor();
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbient();
    this.loadSamples();
  }

  loadSamples() {
    this.samples = {};
    for (const k in SAMPLE_FILES) for (const f of SAMPLE_FILES[k]) {
      // версия в адресе: после обновления игры браузер не возьмёт старый файл с тем же именем из кэша
      fetch('assets/sfx/' + f + '?v=' + (window.BUILD || VERSION))
        .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(b => this.ctx.decodeAudioData(b))
        .then(buf => { (this.samples[k] ||= []).push(trimBuffer(this.ctx, buf, MAX_LEN[k] || 1.6)); })
        .catch(e => console.warn('звук', f, e));
    }
  }

  // записанный звук с позиционированием; false — сэмпла пока нет
  sample(k, pos, ref, maxD, vol = 1) {
    const list = this.samples && this.samples[k];
    if (!list || !list.length) return false;
    const buf = list[Math.floor(Math.random() * list.length)];
    const o = this.out(pos, ref, maxD);
    if (!o) return true;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.96 + Math.random() * 0.08;
    const g = this.ctx.createGain();
    g.gain.value = vol * o.k;
    if (pos) {
      // вдали глушим верха
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2000 + 16000 * o.k;
      src.connect(f); f.connect(g);
    } else src.connect(g);
    g.connect(o.node);
    src.start();
    return true;
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  listener(x, y, z, yaw) { this.lx = x; this.ly = y; this.lz = z; this.lyaw = yaw; }

  // узел с громкостью и панорамой по позиции источника
  out(pos, ref = 10, maxD = 200) {
    const c = this.ctx;
    const g = c.createGain();
    if (!pos) { g.connect(this.master); return { node: g, k: 1 }; }
    const dx = pos.x - this.lx, dy = pos.y - this.ly, dz = pos.z - this.lz;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxD) return null;
    const k = Math.min(1, ref / (ref + d)) * (1 - d / maxD);
    // проекция направления на вектор «вправо» слушателя
    const hd = Math.hypot(dx, dz) || 1;
    const side = (dx * Math.cos(this.lyaw) - dz * Math.sin(this.lyaw)) / hd;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = Math.max(-0.9, Math.min(0.9, side * Math.min(1, d / 4)));
      g.connect(pan); pan.connect(this.master);
    } else g.connect(this.master);
    return { node: g, k };
  }

  noiseBurst(o, dur, f0, f1, q, vol, type = 'lowpass', t0 = 0) {
    const c = this.ctx, now = c.currentTime + t0;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, now);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    src.connect(f); f.connect(g); g.connect(o);
    src.start(now, Math.random() * 1.5, dur + 0.05);
  }

  tone(o, type, f0, f1, dur, vol, t0 = 0) {
    const c = this.ctx, now = c.currentTime + t0;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    osc.connect(g); g.connect(o);
    osc.start(now); osc.stop(now + dur + 0.05);
  }

  gun(kind, pos) {
    if (!this.ctx) return;
    if (kind === 'qbz') kind = 'rifle';
    if (this.sample(kind, pos, kind === 'asval' ? 14 : 25, kind === 'asval' ? 240 : 500, 0.9)) return;
    const o = this.out(pos, 25, 500);
    if (!o) return;
    const v = o.k;
    const P = {
      pistol: [0.22, 3200, 0.9, 140], smg: [0.16, 2800, 0.7, 120], rifle: [0.3, 2600, 1.0, 100],
      shotgun: [0.45, 1800, 1.2, 70], sniper: [0.6, 2200, 1.3, 60], asval: [0.12, 1600, 0.35, 90],
      rpg: [0.5, 1500, 1.1, 55],
    }[kind] || [0.25, 2500, 1, 110];
    this.noiseBurst(o.node, P[0], P[1], 200, 0.7, P[2] * v);
    this.tone(o.node, 'sine', P[3], 40, P[0] * 0.8, 0.9 * v);
    if (pos) this.noiseBurst(o.node, P[0] * 2.5, 900, 120, 0.5, 0.15 * v, 'lowpass', 0.05);
    // у РПГ после хлопка — шипение уходящей гранаты
    if (kind === 'rpg') { this.noise2(o.node, 1.1, 2400, 700, 0.9, 0.32 * v, 'bandpass', 0.06); this.noise2(o.node, 0.5, 600, 120, 0.7, 0.4 * v, 'lowpass', 0); }
  }

  // взрыв: удар, раскат с затуханием верхов, треск обломков
  explosion(pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 45, 1100);
    if (!o) return;
    const v = o.k, d = pos ? Math.hypot(pos.x - this.lx, pos.y - this.ly, pos.z - this.lz) : 0;
    const top = Math.max(500, 5200 - d * 9);
    this.tone(o.node, 'sine', 95, 26, 1.1, 1.3 * v);
    this.tone(o.node, 'triangle', 170, 38, 0.4, 0.55 * v);
    this.noise2(o.node, 0.35, top, 300, 0.7, 1.4 * v, 'lowpass', 0);
    this.noise2(o.node, 2.6, top * 0.45, 70, 0.6, 0.9 * v, 'lowpass', 0.03);
    for (let i = 0; i < 6; i++) this.noiseBurst(o.node, 0.05, 3200, 1400, 2, 0.12 * v, 'bandpass', 0.2 + Math.random() * 0.9);
  }

  // шум любой длины (буфер шума — 2 с, дальше по кругу)
  noise2(o, dur, f0, f1, q, vol, type, t0) {
    const c = this.ctx, now = c.currentTime + t0;
    const src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, now);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    src.connect(f); f.connect(g); g.connect(o);
    src.start(now, Math.random() * 1.8);
    src.stop(now + dur + 0.05);
  }

  dry(pos) { if (!this.ctx) return; const o = this.out(pos, 4, 30); if (o) this.tone(o.node, 'square', 1800, 900, 0.03, 0.15 * o.k); }
  reload(pos) {
    if (!this.ctx) return; const o = this.out(pos, 4, 30); if (!o) return;
    this.tone(o.node, 'square', 900, 500, 0.04, 0.12 * o.k, 0.0);
    this.tone(o.node, 'square', 700, 1200, 0.05, 0.12 * o.k, 0.35);
  }
  swing(pos) { if (!this.ctx) return; const o = this.out(pos, 4, 25); if (o) this.noiseBurst(o.node, 0.18, 600, 2400, 2, 0.25 * o.k, 'bandpass'); }
  hitFlesh(pos) { if (!this.ctx) return; const o = this.out(pos, 6, 40); if (o) { this.noiseBurst(o.node, 0.12, 500, 120, 1, 0.5 * o.k); this.tone(o.node, 'sine', 120, 60, 0.1, 0.4 * o.k); } }
  hitWood(pos) { if (!this.ctx) return; const o = this.out(pos, 6, 40); if (o) { this.noiseBurst(o.node, 0.08, 1800, 600, 3, 0.4 * o.k, 'bandpass'); this.tone(o.node, 'triangle', 300, 180, 0.08, 0.25 * o.k); } }
  hitStone(pos) { if (!this.ctx) return; const o = this.out(pos, 6, 40); if (o) { this.noiseBurst(o.node, 0.06, 4000, 1500, 2, 0.35 * o.k, 'highpass'); this.tone(o.node, 'square', 900, 400, 0.04, 0.1 * o.k); } }
  step(pos, snow) { if (!this.ctx) return; const o = this.out(pos, 3, 20); if (o) this.noiseBurst(o.node, 0.07, snow ? 1400 : 900, 300, 1, 0.07 * o.k); }
  pickup() { if (!this.ctx) return; const o = this.out(null); this.tone(o.node, 'triangle', 600, 1200, 0.08, 0.15); }
  click() { if (!this.ctx) return; const o = this.out(null); this.tone(o.node, 'square', 1200, 1000, 0.025, 0.06); }
  craft() { if (!this.ctx) return; const o = this.out(null); this.noiseBurst(o.node, 0.15, 1200, 400, 2, 0.25, 'bandpass'); this.tone(o.node, 'triangle', 500, 900, 0.12, 0.12, 0.1); }
  place(pos) { if (!this.ctx) return; const o = this.out(pos, 6, 40); if (o) { this.tone(o.node, 'sine', 160, 80, 0.12, 0.5 * o.k); this.noiseBurst(o.node, 0.1, 800, 200, 1, 0.25 * o.k); } }
  eat() { if (!this.ctx) return; const o = this.out(null); for (let i = 0; i < 3; i++) this.noiseBurst(o.node, 0.08, 1500, 500, 2, 0.15, 'bandpass', i * 0.18); }
  hurt() {
    if (!this.ctx) return;
    // несколько ударов подряд (толпа зомби) не накладываются в кашу
    const now = performance.now();
    if (now - (this.hurtT || -1e9) < 300) return;
    this.hurtT = now;
    if (this.sample('hurt', null, 1, 1, 0.85)) return;
    const o = this.out(null); this.tone(o.node, 'sawtooth', 220, 110, 0.18, 0.18); this.noiseBurst(o.node, 0.15, 700, 150, 1, 0.3);
  }
  levelUp() { if (!this.ctx) return; const o = this.out(null); [523, 659, 784, 1046].forEach((f, i) => this.tone(o.node, 'triangle', f, f, 0.18, 0.15, i * 0.09)); }
  alarm() { if (!this.ctx) return; const o = this.out(null); for (let i = 0; i < 4; i++) { this.tone(o.node, 'sawtooth', 300, 600, 0.45, 0.12, i * 0.5); } }

  groan(pos, pitch = 1, loud = false) {
    if (!this.ctx) return;
    const o = this.out(pos, loud ? 10 : 6, 60);
    if (!o) return;
    const c = this.ctx, now = c.currentTime;
    const dur = 0.6 + Math.random() * 0.6;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    const f = (80 + Math.random() * 50) * pitch;
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.2), now + dur);
    const lfo = c.createOscillator(); lfo.frequency.value = 6 + Math.random() * 6;
    const lg = c.createGain(); lg.gain.value = f * 0.08;
    lfo.connect(lg); lg.connect(osc.frequency);
    const flt = c.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 500 * pitch; flt.Q.value = 2.5;
    const g = c.createGain();
    const v = (loud ? 0.5 : 0.3) * o.k;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(v, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    osc.connect(flt); flt.connect(g); g.connect(o.node);
    osc.start(now); lfo.start(now); osc.stop(now + dur + 0.05); lfo.stop(now + dur + 0.05);
  }

  heli(pos) {
    if (!this.ctx) return;
    const o = this.out(pos, 40, 700);
    if (!o) return;
    for (let i = 0; i < 8; i++) this.noiseBurst(o.node, 0.09, 300, 90, 1, 0.5 * o.k, 'lowpass', i * 0.12);
  }

  startAmbient() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    this.windGain = c.createGain(); this.windGain.gain.value = 0.035;
    src.connect(f); f.connect(this.windGain); this.windGain.connect(this.master);
    src.start();
  }

  setWind(v) { if (this.windGain) this.windGain.gain.value = v; }
}
