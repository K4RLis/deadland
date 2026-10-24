// Генерация острова 3000×3000 м: рельеф, города, дороги, военная база, места крушения,
// деревья и камни по чанкам. Всё детерминировано по сиду — клиенты строят тот же мир.
import * as C from './config.js';
import { mulberry32, hash2, Simplex2, shuffle, pickWeighted, clamp, lerp, smooth } from './rng.js';
import { buildPrefab, PREFAB_SIZE, CONTAINER_KINDS } from './prefabs.js';

const TOWN_NAMES = ['Берёзовка', 'Каменка', 'Сосновый Бор', 'Ржавск', 'Тихий Ручей', 'Глухово', 'Заречье', 'Озёрск',
  'Кривая Балка', 'Пыльный Яр', 'Северск', 'Ясная Поляна', 'Волчья Падь', 'Морозово', 'Старый Порт', 'Светлый',
  'Красный Луч', 'Чернолесье', 'Дубки', 'Гнилушки'];

export function rot90(x, z, r) {
  switch (r & 3) {
    case 0: return [x, z];
    case 1: return [z, -x];
    case 2: return [-x, -z];
    default: return [-z, x];
  }
}

export class World {
  constructor(level, seed, opts = {}) {
    this.level = level;
    this.seed = seed >>> 0;
    const r = mulberry32(this.seed);
    this.nA = new Simplex2(r); this.nB = new Simplex2(r); this.nC = new Simplex2(r);
    this.hCache = new Map();
    this.flats = []; this.flatGrid = new Map();
    this.roads = []; this.roadGrid = new Map();
    this.towns = []; this.structs = []; this.structGrid = new Map();
    this.crashSites = []; this.military = null; this.spawns = []; this.lairs = [];
    this.chunks = new Map();
    this.depleted = new Set();
    this.onChunk = null;
    this.highways = [];
    if (opts.layout !== false) this.genLayout();
  }

  ckey(cx, cz) { return (cx + 64) * 128 + (cz + 64); }

  // ---------- рельеф ----------
  rawHeight(x, z) {
    const L = this.level;
    const ax = Math.abs(x) / C.HALF, az = Math.abs(z) / C.HALF;
    let e = Math.max(ax, az) * 0.6 + Math.hypot(ax, az) * 0.4 * 0.78;
    e += this.nB.noise(x / 420 + 5.1, z / 420 - 3.3) * 0.05;
    const mask = 1 - smooth(0.78, 0.95, e);
    const n = this.nA;
    let h = n.fbm(x / 900, z / 900, 4) * 24 + 13;
    const mMask = smooth(0.12, 0.55, this.nB.noise(x / 1400 + 7.3, z / 1400 - 2.1));
    const rr = 1 - Math.abs(n.fbm(x / 430 + 3.1, z / 430 + 1.7, 4));
    h += rr * rr * 72 * mMask * L.mountains;
    h += n.noise(x / 55, z / 55) * 1.3;
    const lake = this.nC.noise(x / 470 + 1.9, z / 470 + 8.2);
    if (lake > 0.5) h -= (lake - 0.5) * 95;
    if (L.biome === 'desert' && h > 6) {
      const t = (h - 6) / 9, f = t - Math.floor(t);
      h = 6 + (Math.floor(t) + smooth(0.3, 0.7, f)) * 9;
    }
    return h * mask + (mask - 1) * 32;
  }

  addFlat(x, z, r, h, kind) {
    const f = { x, z, r, h, kind };
    this.flats.push(f);
    const R = r + 50;
    for (let cx = Math.floor((x - R) / C.CHUNK); cx <= Math.floor((x + R) / C.CHUNK); cx++)
      for (let cz = Math.floor((z - R) / C.CHUNK); cz <= Math.floor((z + R) / C.CHUNK); cz++) {
        const k = this.ckey(cx, cz);
        let a = this.flatGrid.get(k); if (!a) this.flatGrid.set(k, a = []);
        a.push(f);
      }
    return f;
  }

  applyFlats(x, z, h, out) {
    const list = this.flatGrid.get(this.ckey(Math.floor(x / C.CHUNK), Math.floor(z / C.CHUNK)));
    let town = 0, dirt = 0;
    if (list) for (const f of list) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d > f.r + 45) continue;
      const w = 1 - smooth(f.r, f.r + 45, d);
      h = lerp(h, f.h, w);
      const g = 1 - smooth(f.r - 6, f.r + 4, d);
      if (f.kind === 'town' || f.kind === 'mil') town = Math.max(town, g); else dirt = Math.max(dirt, g);
    }
    if (out) { out.town = town; out.dirt = dirt; }
    return h;
  }

  // полная информация о точке: высота + вес дороги/города
  pointInfo(x, z, out) {
    let h = this.rawHeight(x, z);
    let road = 0, rh = 0;
    const cell = this.roadGrid.get(this.ckey(Math.floor(x / C.CHUNK), Math.floor(z / C.CHUNK)));
    if (cell) for (const s of cell) {
      const t = clamp(((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.len2, 0, 1);
      const px = s.ax + s.dx * t, pz = s.az + s.dz * t;
      const d = Math.hypot(x - px, z - pz);
      const w = 1 - smooth(s.w * 0.5, s.w * 0.5 + 7, d);
      if (w > road) { road = w; rh = s.ha + (s.hb - s.ha) * t; }
    }
    if (road > 0) h = lerp(h, rh, road);
    h = this.applyFlats(x, z, h, out);
    if (out) { out.h = h; out.road = road; }
    return h;
  }

  // небольшой детерминированный «излом» вершин — даёт гранёный low-poly рельеф (не на дорогах и в городах)
  jit(ix, iz, info) {
    if (info.h < 1.2) return 0;
    const k = (1 - info.road) * (1 - Math.max(info.town, info.dirt));
    if (k <= 0) return 0;
    return (((hash2(this.seed ^ 0x51ed, ix, iz) & 1023) / 1023) - 0.5) * 1.1 * k;
  }

  vh(ix, iz) {
    const key = (ix + 2048) * 4096 + (iz + 2048);
    let h = this.hCache.get(key);
    if (h === undefined) {
      if (this.hCache.size > 500000) this.hCache.clear();
      const o = this._vo || (this._vo = {});
      h = this.pointInfo(ix * C.TSTEP, iz * C.TSTEP, o) + this.jit(ix, iz, o);
      this.hCache.set(key, h);
    }
    return h;
  }

  // высота по треугольникам сетки (совпадает с отрисованным мешем)
  height(x, z) {
    const fx = x / C.TSTEP, fz = z / C.TSTEP;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const h00 = this.vh(ix, iz), h11 = this.vh(ix + 1, iz + 1);
    if (u > v) { const h10 = this.vh(ix + 1, iz); return h00 + (h10 - h00) * u + (h11 - h10) * v; }
    const h01 = this.vh(ix, iz + 1);
    return h00 + (h11 - h01) * u + (h01 - h00) * v;
  }

  normalY(x, z) {
    const a = this.height(x - 1, z), b = this.height(x + 1, z), c = this.height(x, z - 1), d = this.height(x, z + 1);
    const nx = a - b, nz = c - d, ny = 2;
    return ny / Math.hypot(nx, ny, nz);
  }

  roadWeight(x, z) {
    const cell = this.roadGrid.get(this.ckey(Math.floor(x / C.CHUNK), Math.floor(z / C.CHUNK)));
    let road = 0;
    if (cell) for (const s of cell) {
      const t = clamp(((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.len2, 0, 1);
      const d = Math.hypot(x - (s.ax + s.dx * t), z - (s.az + s.dz * t));
      road = Math.max(road, 1 - smooth(s.w * 0.5, s.w * 0.5 + 4, d));
    }
    return road;
  }

  flatWeight(x, z, pad = 12) {
    const list = this.flatGrid.get(this.ckey(Math.floor(x / C.CHUNK), Math.floor(z / C.CHUNK)));
    let w = 0;
    if (list) for (const f of list) {
      const d = Math.hypot(x - f.x, z - f.z);
      w = Math.max(w, 1 - smooth(f.r, f.r + pad, d));
    }
    return w;
  }

  // ---------- раскладка мира ----------
  genLayout() {
    const L = this.level, rng = mulberry32(this.seed ^ 0x9e3779b9);
    const names = shuffle(TOWN_NAMES.slice(), rng);

    // города
    let tries = 0;
    while (this.towns.length < L.towns && tries++ < 5000) {
      const city = this.towns.length === 0;
      const r = city ? L.cityR : 55 + rng() * 45;
      const lim = C.HALF * 0.74 - r;
      const x = (rng() * 2 - 1) * lim, z = (rng() * 2 - 1) * lim;
      const h = this.rawHeight(x, z);
      if (h < 4 || h > 48) continue;
      let ok = true;
      for (const t of this.towns) if (Math.hypot(t.x - x, t.z - z) < t.r + r + 230) { ok = false; break; }
      if (!ok) continue;
      let mn = h, mx = h, sum = h;
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        const hh = this.rawHeight(x + Math.cos(a) * r * 0.8, z + Math.sin(a) * r * 0.8);
        mn = Math.min(mn, hh); mx = Math.max(mx, hh); sum += hh;
        if (hh < 0.5) ok = false;
      }
      if (!ok || mx - mn > (city ? 45 : 20) + tries * 0.006) continue;
      const town = { id: this.towns.length, name: names[this.towns.length % names.length], x, z, r, h: Math.max(4, sum / 9), city, kind: 'town' };
      if (city) town.name = L.biome === 'snow' ? 'Мёртвый город' : (L.biome === 'desert' ? 'Песчаногорск' : 'Новоград');
      this.towns.push(town);
      this.addFlat(x, z, r, town.h, 'town');
    }

    // военная база
    tries = 0;
    while (!this.military && tries++ < 4000) {
      const r = 64;
      const lim = C.HALF * 0.7 - r;
      const x = (rng() * 2 - 1) * lim, z = (rng() * 2 - 1) * lim;
      const h = this.rawHeight(x, z);
      if (h < 4 || h > 45) continue;
      if (this.towns.some(t => Math.hypot(t.x - x, t.z - z) < t.r + r + 200)) continue;
      let bad = false;
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; if (this.rawHeight(x + Math.cos(a) * r, z + Math.sin(a) * r) < 1) bad = true; }
      if (bad) continue;
      this.military = { name: 'Военная база', x, z, r, h, kind: 'mil' };
      this.addFlat(x, z, r + 4, h, 'mil');
    }

    // логова боссов: центр большого города, военная база и случайный городок
    this.lairs = [];
    if (this.towns[0]) this.lairs.push({ type: 'butcher', x: this.towns[0].x + 12, z: this.towns[0].z + 12 });
    if (this.military) this.lairs.push({ type: 'leaper', x: this.military.x - 10, z: this.military.z + 20 });
    if (this.towns.length > 3) { const t = this.towns[1 + Math.floor(rng() * (this.towns.length - 1))]; this.lairs.push({ type: 'screamer', x: t.x + 8, z: t.z - 8 }); }

    // дороги между городами (минимальное остовное дерево + несколько петель)
    const nodes = this.towns.slice();
    if (this.military) nodes.push(this.military);
    const inTree = [nodes[0]], rest = nodes.slice(1), edges = [];
    while (rest.length) {
      let best = null, bd = Infinity, bi = -1;
      for (const a of inTree) for (let i = 0; i < rest.length; i++) {
        const d = Math.hypot(a.x - rest[i].x, a.z - rest[i].z);
        if (d < bd) { bd = d; best = [a, rest[i]]; bi = i; }
      }
      edges.push(best); inTree.push(rest[bi]); rest.splice(bi, 1);
    }
    for (const a of nodes) {
      const near = nodes.filter(b => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
      const b = near[1];
      if (b && rng() < 0.45 && !edges.some(e => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) edges.push([a, b]);
    }
    this.highways = [];
    for (const [a, b] of edges) this.highways.push(this.addRoad(a, b, 8, rng));

    // улицы и дома
    for (const t of this.towns) this.layoutTown(t, rng);
    if (this.military) this.layoutMilitary(this.military, rng);

    // заправки у трасс
    let gas = 0;
    for (let i = 0; i < 40 && gas < 6; i++) {
      const road = this.highways[Math.floor(rng() * this.highways.length)];
      if (!road || road.length < 6) continue;
      const k = 2 + Math.floor(rng() * (road.length - 4));
      const s = road[k];
      const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
      const len = Math.sqrt(s.len2);
      const side = rng() < 0.5 ? 1 : -1;
      const nx = -s.dz / len * side, nz = s.dx / len * side;
      const x = mx + nx * 15, z = mz + nz * 15;
      if (this.nearFlat(x, z, 40)) continue;
      const rot = this.facingRot(-nx, -nz);
      const h = (s.ha + s.hb) / 2;
      this.addFlat(x, z, 11, h, 'dirt');
      this.addStruct('gas', x, z, rot, h);
      gas++;
    }

    // места крушения (цель уровня)
    tries = 0;
    while (this.crashSites.length < 3 && tries++ < 3000) {
      const lim = C.HALF * 0.72;
      const x = (rng() * 2 - 1) * lim, z = (rng() * 2 - 1) * lim;
      const h = this.rawHeight(x, z);
      if (h < 3 || h > 60) continue;
      if (this.nearFlat(x, z, 120)) continue;
      if (this.crashSites.some(c => Math.hypot(c.x - x, c.z - z) < 700)) continue;
      this.addFlat(x, z, 10, h, 'dirt');
      const s = this.addStruct('crash', x, z, Math.floor(rng() * 4), h);
      this.crashSites.push({ x, z, struct: s.id });
    }

    // хижины в глуши
    tries = 0;
    let cabins = 0;
    while (cabins < L.cabins && tries++ < 3000) {
      const lim = C.HALF * 0.78;
      const x = (rng() * 2 - 1) * lim, z = (rng() * 2 - 1) * lim;
      const h = this.rawHeight(x, z);
      if (h < 3 || h > 75) continue;
      if (this.nearFlat(x, z, 60) || this.roadWeight(x, z) > 0) continue;
      const hs = [this.rawHeight(x + 8, z), this.rawHeight(x - 8, z), this.rawHeight(x, z + 8), this.rawHeight(x, z - 8)];
      if (Math.max(...hs) - Math.min(...hs) > 7) continue;
      this.addFlat(x, z, 7, h, 'dirt');
      this.addStruct(rng() < 0.85 ? 'cabin' : 'house', x, z, Math.floor(rng() * 4), h);
      cabins++;
    }

    // брошенные машины на трассах
    for (const road of this.highways) for (const s of road) {
      if (rng() > 0.045) continue;
      const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
      if (this.nearFlat(mx, mz, 10)) continue;
      const len = Math.sqrt(s.len2);
      const off = (rng() < 0.5 ? -1 : 1) * 1.9;
      const x = mx - s.dz / len * off, z = mz + s.dx / len * off;
      this.addStruct('car', x, z, this.facingRot(s.dx, s.dz) + (rng() < 0.5 ? 2 : 0), (s.ha + s.hb) / 2);
    }

    // точки появления — окраины городов
    for (const t of this.towns) {
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 20; k++) {
          const a = rng() * Math.PI * 2, d = t.r + 25 + rng() * 50;
          const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
          if (Math.abs(x) > C.HALF - 60 || Math.abs(z) > C.HALF - 60) continue;
          if (this.rawHeight(x, z) < 2) continue;
          this.spawns.push({ x, z });
          break;
        }
      }
    }
    if (!this.spawns.length) this.spawns.push({ x: 0, z: 0 });
  }

  nearFlat(x, z, pad) {
    for (const f of this.flats) if (Math.hypot(f.x - x, f.z - z) < f.r + pad) return true;
    return false;
  }

  facingRot(dx, dz) {
    if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
    return dz > 0 ? 0 : 2;
  }

  addRoad(a, b, width, rng) {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(2, Math.ceil(len / 20));
    const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
    const amp = Math.min(90, len * 0.08), off = rng() * 100;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const o = this.nB.noise(off + t * len / 380, 3.7) * amp * Math.sin(Math.PI * t);
      const x = a.x + (b.x - a.x) * t + nx * o, z = a.z + (b.z - a.z) * t + nz * o;
      let h = (this.rawHeight(x, z) * 2 + this.rawHeight(x + 9, z) + this.rawHeight(x - 9, z) + this.rawHeight(x, z + 9) + this.rawHeight(x, z - 9)) / 6;
      h = this.applyFlats(x, z, h, null);
      pts.push({ x, z, h: Math.max(h, 1.6) });
    }
    for (let p = 0; p < 4; p++) for (let i = 1; i < n; i++) pts[i].h = (pts[i - 1].h + 2 * pts[i].h + pts[i + 1].h) / 4;
    const segs = [];
    for (let i = 0; i < n; i++) segs.push(this.addSeg(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z, pts[i].h, pts[i + 1].h, width));
    return segs;
  }

  addSeg(ax, az, bx, bz, ha, hb, w) {
    const dx = bx - ax, dz = bz - az;
    const s = { ax, az, bx, bz, dx, dz, len2: Math.max(1e-6, dx * dx + dz * dz), ha, hb, w };
    this.roads.push(s);
    const pad = w / 2 + 8;
    for (let cx = Math.floor((Math.min(ax, bx) - pad) / C.CHUNK); cx <= Math.floor((Math.max(ax, bx) + pad) / C.CHUNK); cx++)
      for (let cz = Math.floor((Math.min(az, bz) - pad) / C.CHUNK); cz <= Math.floor((Math.max(az, bz) + pad) / C.CHUNK); cz++) {
        const k = this.ckey(cx, cz);
        let arr = this.roadGrid.get(k); if (!arr) this.roadGrid.set(k, arr = []);
        arr.push(s);
      }
    return s;
  }

  addStruct(name, x, z, rot, y) {
    const [w, d] = PREFAB_SIZE[name];
    const odd = rot & 1;
    const s = {
      id: this.structs.length, name, x, z, y, rot: rot & 3,
      hw: (odd ? d : w) / 2, hd: (odd ? w : d) / 2,
      seed: hash2(this.seed, this.structs.length * 7919 + 13, Math.floor(x) ^ Math.floor(z)),
    };
    this.structs.push(s);
    const k = this.ckey(Math.floor(x / C.CHUNK), Math.floor(z / C.CHUNK));
    let a = this.structGrid.get(k); if (!a) this.structGrid.set(k, a = []);
    a.push(s);
    return s;
  }

  layoutTown(t, rng) {
    const streets = [];
    const sw = 9;
    if (t.city) {
      const step = 46;
      for (let s = -Math.floor(t.r / step) * step; s <= t.r; s += step) {
        const ext = Math.sqrt(Math.max(0, t.r * t.r - s * s)) - 4;
        if (ext < 30) continue;
        streets.push({ axis: 'x', c: t.z + s, a: t.x - ext, b: t.x + ext });
        streets.push({ axis: 'z', c: t.x + s, a: t.z - ext, b: t.z + ext });
      }
    } else {
      const off = (rng() - 0.5) * 10;
      streets.push({ axis: 'x', c: t.z + off, a: t.x - t.r, b: t.x + t.r });
      streets.push({ axis: 'z', c: t.x - off, a: t.z - t.r * 0.85, b: t.z + t.r * 0.85 });
      if (t.r > 80) streets.push({ axis: 'x', c: t.z + off + 48 * (rng() < 0.5 ? 1 : -1), a: t.x - t.r * 0.7, b: t.x + t.r * 0.7 });
    }
    const rects = [];
    for (const s of streets) {
      if (s.axis === 'x') { this.addSeg(s.a, s.c, s.b, s.c, t.h, t.h, sw); rects.push([s.a, s.c - sw / 2, s.b, s.c + sw / 2]); }
      else { this.addSeg(s.c, s.a, s.c, s.b, t.h, t.h, sw); rects.push([s.c - sw / 2, s.a, s.c + sw / 2, s.b]); }
    }
    const weights = t.city
      ? [['apartment', 34], ['shop', 14], ['police', 6], ['clinic', 6], ['warehouse', 7], ['house2', 14], ['house', 8]]
      : [['house', 40], ['house2', 22], ['shop', 10], ['police', 5], ['clinic', 4], ['warehouse', 8]];
    let hasPolice = false, hasShop = false;
    const lots = [];
    for (const s of streets) {
      for (const side of [-1, 1]) {
        let pos = s.a + 6;
        while (pos < s.b - 6) {
          let name = pickWeighted(weights, rng);
          if (!hasPolice && lots.length === 3) name = 'police';
          if (!hasShop && lots.length === 1) name = 'shop';
          const [w, d] = PREFAB_SIZE[name];
          let x, z, rot, ex, ez;
          if (s.axis === 'x') {
            rot = side > 0 ? 2 : 0;
            x = pos + w / 2; z = s.c + side * (sw / 2 + 2.5 + d / 2);
            ex = w / 2; ez = d / 2;
          } else {
            rot = side > 0 ? 3 : 1;
            z = pos + w / 2; x = s.c + side * (sw / 2 + 2.5 + d / 2);
            ex = d / 2; ez = w / 2;
          }
          const rect = [x - ex, z - ez, x + ex, z + ez];
          const far = Math.max(Math.hypot(rect[0] - t.x, rect[1] - t.z), Math.hypot(rect[2] - t.x, rect[3] - t.z), Math.hypot(rect[0] - t.x, rect[3] - t.z), Math.hypot(rect[2] - t.x, rect[1] - t.z));
          const pad = [rect[0] - 1.5, rect[1] - 1.5, rect[2] + 1.5, rect[3] + 1.5];
          if (far < t.r - 3 && !rects.some(r => r[0] < pad[2] && r[2] > pad[0] && r[1] < pad[3] && r[3] > pad[1])) {
            rects.push(rect);
            lots.push(this.addStruct(name, x, z, rot, t.h));
            if (name === 'police') hasPolice = true;
            if (name === 'shop') hasShop = true;
            pos += w + 3 + rng() * 5;
          } else pos += 4;
        }
      }
      // машины на улицах
      const len = s.b - s.a;
      const cars = Math.floor(len / 45);
      for (let i = 0; i < cars; i++) {
        if (rng() < 0.4) continue;
        const p = s.a + 8 + rng() * (len - 16), o = (rng() < 0.5 ? -1 : 1) * 2.2;
        if (s.axis === 'x') this.addStruct('car', p, s.c + o, rng() < 0.5 ? 1 : 3, t.h);
        else this.addStruct('car', s.c + o, p, rng() < 0.5 ? 0 : 2, t.h);
      }
    }
    t.lots = lots.length;
  }

  layoutMilitary(m, rng) {
    const add = (n, dx, dz, rot) => this.addStruct(n, m.x + dx, m.z + dz, rot, m.h);
    add('milfence', 0, 0, 0);
    const hp = add('helipad', 30, 30, 0);
    const rs = add('radio', -32, -36, 0);
    add('barracks', -36, 10, 1);
    add('barracks', -36, 32, 1);
    add('tent', 8, -34, 0); add('tent', 18, -34, 0); add('tent', 28, -34, 0); add('tent', 38, -34, 0);
    add('cratepile', 2, 6, 0); add('cratepile', 12, -12, 1);
    add('tower', -54, -54, 0); add('tower', 54, -54, 0); add('tower', -54, 54, 2); add('tower', 54, 54, 2);
    add('truck', -6, 40, 0); add('truck', 2, 40, 0); add('truck', 34, 2, 1);
    this.addSeg(m.x - 62, m.z, m.x + 62, m.z, m.h, m.h, 8);
    this.addSeg(m.x, m.z - 62, m.x, m.z + 62, m.h, m.h, 8);
    m.helipad = { x: hp.x, z: hp.z, y: m.h };
    m.radio = rs.id;
  }

  // ---------- экземпляры построек ----------
  instStruct(s) {
    if (s._inst) return s._inst;
    const def = buildPrefab(s.name, mulberry32(s.seed), this.level);
    const boxes = [], prisms = [], tris = [], colliders = [], conts = [];
    const r = s.rot;
    const col = c => (typeof c === 'number' ? c : (def.pal[c] ?? 0xff00ff));
    const wb = (a, b) => {
      const [x0, z0] = rot90(a[0], a[2], r), [x1, z1] = rot90(b[0], b[2], r);
      return [Math.min(x0, x1) + s.x, a[1] + s.y, Math.min(z0, z1) + s.z, Math.max(x0, x1) + s.x, b[1] + s.y, Math.max(z0, z1) + s.z];
    };
    for (const p of def.parts) {
      if (p.t === 0) {
        const bb = wb(p.a, p.b);
        if (!p.invis) boxes.push({ bb, c: col(p.c), glass: p.glass });
        if (p.solid) colliders.push({ x0: bb[0], y0: bb[1], z0: bb[2], x1: bb[3], y1: bb[4], z1: bb[5], kind: p.glass ? 'glass' : 'static', ramp: -1 });
      } else if (p.t === 1) {
        prisms.push({ bb: wb(p.a, p.b), c: col(p.c), rx: (r & 1) ? !p.rx : p.rx });
      } else if (p.t === 3) {
        for (const t of p.tris) {
          tris.push({ v: t.map(v => { const [x, z] = rot90(v[0], v[2], r); return [x + s.x, v[1] + s.y, z + s.z]; }), c: col(p.c), two: p.two });
        }
      }
    }
    def.conts.forEach((c, i) => {
      const k = CONTAINER_KINDS[c.kind];
      const w = c.swap ? k.d : k.w, d = c.swap ? k.w : k.d;
      const bb = wb([c.x - w / 2, c.y, c.z - d / 2], [c.x + w / 2, c.y + k.h, c.z + d / 2]);
      const cont = { cid: `s${s.id}_${i}`, kind: c.kind, tier: c.tier, bb, name: k.name, sid: s.id };
      conts.push(cont);
      if (k.color != null) {
        boxes.push({ bb, c: k.color, cont: true });
        colliders.push({ x0: bb[0], y0: bb[1], z0: bb[2], x1: bb[3], y1: bb[4], z1: bb[5], kind: 'static', ramp: -1 });
      }
    });
    s._inst = { boxes, prisms, tris, colliders, conts };
    return s._inst;
  }

  containerInfo(cid) {
    const m = /^s(\d+)_(\d+)$/.exec(cid);
    if (!m) return null;
    const s = this.structs[+m[1]];
    if (!s) return null;
    return this.instStruct(s).conts[+m[2]] || null;
  }

  // ---------- данные чанков ----------
  chunk(cx, cz) {
    const key = this.ckey(cx, cz);
    let d = this.chunks.get(key);
    if (d) return d;
    const L = this.level;
    d = { cx, cz, key, trees: [], rocks: [], bushes: [], structs: this.structGrid.get(key) || [], colliders: [], conts: [] };
    this.chunks.set(key, d);
    const rng = mulberry32(hash2(this.seed, cx, cz));
    const x0 = cx * C.CHUNK, z0 = cz * C.CHUNK;
    const desert = L.biome === 'desert';
    const tries = Math.round(75 * L.trees.density);
    for (let i = 0; i < tries; i++) {
      const x = x0 + rng() * C.CHUNK, z = z0 + rng() * C.CHUNK;
      const r1 = rng(), r2 = rng(), r3 = rng();
      if (Math.abs(x) > C.HALF - 2 || Math.abs(z) > C.HALF - 2) continue;
      const fn = this.nC.noise(x / 260 + 11, z / 260 - 7);
      const p = desert ? 0.5 : smooth(-0.4, 0.3, fn);
      if (r1 > p) continue;
      const h = this.height(x, z);
      if (h < 1.6) continue;
      if (this.flatWeight(x, z, 10) > 0 || this.roadWeight(x, z) > 0) continue;
      const id = `t${cx}_${cz}_${i}`;
      if (this.depleted.has(id)) continue;
      let type = L.trees.types[Math.floor(r2 * L.trees.types.length)];
      if (h > L.snowLine + 8 && type !== 'dead' && !desert) type = 'snowpine';
      if (h > 95 && r2 < 0.6) continue;
      const s = 0.8 + r3 * 0.6;
      d.trees.push({ id, x, y: h, z, type, s, rot: r2 * 6.283 });
      const tw = type === 'cactus' ? 0.4 : 0.32;
      d.colliders.push({ x0: x - tw * s, y0: h - 1, z0: z - tw * s, x1: x + tw * s, y1: h + 7 * s, z1: z + tw * s, kind: 'tree', ref: id, ramp: -1 });
    }
    const rockTries = desert ? 10 : 7;
    for (let i = 0; i < rockTries; i++) {
      const x = x0 + rng() * C.CHUNK, z = z0 + rng() * C.CHUNK;
      const r1 = rng(), r2 = rng(), r3 = rng();
      if (r1 > 0.6) continue;
      if (Math.abs(x) > C.HALF - 2 || Math.abs(z) > C.HALF - 2) continue;
      const h = this.height(x, z);
      if (h < 0.5) continue;
      if (this.flatWeight(x, z, 6) > 0 || this.roadWeight(x, z) > 0) continue;
      // железная руда чаще в горах
      const ore = r3 < (h > 32 ? 0.45 : 0.16) * (desert ? 1.4 : 1);
      const id = `${ore ? 'o' : 'r'}${cx}_${cz}_${i}`;
      if (this.depleted.has(id)) continue;
      const s = 0.9 + r2 * 1.4;
      d.rocks.push({ id, x, y: h, z, s, rot: r3 * 6.283, ore });
      d.colliders.push({ x0: x - 0.9 * s, y0: h - 1, z0: z - 0.8 * s, x1: x + 0.9 * s, y1: h + 0.75 * s, z1: z + 0.8 * s, kind: ore ? 'ore' : 'rock', ref: id, ramp: -1 });
    }
    for (let i = 0; i < 26; i++) {
      const x = x0 + rng() * C.CHUNK, z = z0 + rng() * C.CHUNK;
      const r1 = rng(), r2 = rng();
      if (r1 > (desert ? 0.18 : 0.5)) continue;
      const h = this.height(x, z);
      if (h < 1.5 || h > L.snowLine + 20) continue;
      if (this.flatWeight(x, z, 4) > 0 || this.roadWeight(x, z) > 0) continue;
      const id = `u${cx}_${cz}_${i}`;
      if (this.depleted.has(id)) continue;
      const s = 0.6 + r2 * 0.7;
      // каждый третий куст — ягодный; любой куст даёт волокно
      const berry = !desert && (i % 3 === 0);
      d.bushes.push({ id, x, y: h, z, s, berry });
      d.colliders.push({ x0: x - 0.7 * s, y0: h, z0: z - 0.7 * s, x1: x + 0.7 * s, y1: h + 0.9 * s, z1: z + 0.7 * s, kind: 'bush', ref: id, ramp: -1, ghost: true });
    }
    for (const s of d.structs) {
      const inst = this.instStruct(s);
      for (const c of inst.colliders) d.colliders.push(c);
      for (const c of inst.conts) d.conts.push(c);
    }
    if (this.onChunk) this.onChunk(d);
    return d;
  }

  ensureAround(x, z, r = 1) {
    const cx = Math.floor(x / C.CHUNK), cz = Math.floor(z / C.CHUNK);
    const lim = C.HALF / C.CHUNK;
    for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
      if (i < -lim || j < -lim || i >= lim || j >= lim) continue;
      if (!this.chunks.has(this.ckey(i, j))) this.chunk(i, j);
    }
  }

  // ближайшие к точке контейнеры (для взаимодействия)
  containersNear(x, z) {
    const out = [];
    const cx = Math.floor(x / C.CHUNK), cz = Math.floor(z / C.CHUNK);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const d = this.chunks.get(this.ckey(i, j));
      if (!d) continue;
      for (const c of d.conts) {
        const mx = (c.bb[0] + c.bb[3]) / 2, mz = (c.bb[2] + c.bb[5]) / 2;
        if (Math.abs(mx - x) < 5 && Math.abs(mz - z) < 5) out.push(c);
      }
    }
    return out;
  }

  findBush(id) {
    const m = /^u(-?\d+)_(-?\d+)_/.exec(id);
    if (!m) return null;
    const d = this.chunks.get(this.ckey(+m[1], +m[2]));
    return d ? d.bushes.find(b => b.id === id) : null;
  }

  townAt(x, z) {
    for (const t of this.towns) if (Math.hypot(t.x - x, t.z - z) < t.r + 20) return t;
    if (this.military && Math.hypot(this.military.x - x, this.military.z - z) < this.military.r + 10) return this.military;
    return null;
  }
}
