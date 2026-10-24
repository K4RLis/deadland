// Синтезированные звуки на WebAudio — никаких файлов, всё генерируется на лету.
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
    const o = this.out(pos, 25, 500);
    if (!o) return;
    const v = o.k;
    const P = {
      pistol: [0.22, 3200, 0.9, 140], smg: [0.16, 2800, 0.7, 120], rifle: [0.3, 2600, 1.0, 100],
      shotgun: [0.45, 1800, 1.2, 70], sniper: [0.6, 2200, 1.3, 60],
    }[kind] || [0.25, 2500, 1, 110];
    this.noiseBurst(o.node, P[0], P[1], 200, 0.7, P[2] * v);
    this.tone(o.node, 'sine', P[3], 40, P[0] * 0.8, 0.9 * v);
    if (pos) this.noiseBurst(o.node, P[0] * 2.5, 900, 120, 0.5, 0.15 * v, 'lowpass', 0.05);
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
  hurt() { if (!this.ctx) return; const o = this.out(null); this.tone(o.node, 'sawtooth', 220, 110, 0.18, 0.18); this.noiseBurst(o.node, 0.15, 700, 150, 1, 0.3); }
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
