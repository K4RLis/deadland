// Отрисовка чанков: рельеф, деревья, камни, постройки — по одному мешу на слой.
// Цвета берутся из биома каждой точки, на границах биомов треугольники перемешиваются.
import * as THREE from 'three';
import * as C from './config.js';
import { MeshBuilder, lin, shade, PRIM, mat, addSurfaceDetail } from './mesh.js';
import { hash2 } from './rng.js';

const TREE_COLORS = {
  pine: [0x2f5d34, 0x356a3a, 0x2a5530], oak: [0x4f8a3a, 0x5a9440, 0x46803a], birch: [0x7fb24a, 0x8cbc52],
  snowpine: [0x2e5a3c, 0x325f40], dead: [0x6b5a4a], cactus: [0x4f8a44, 0x5a9a4c], palm: [0x5a9a3a],
};

// гранёные варианты примитивов: вершины смещены по хэшу позиции, поэтому меш остаётся цельным
function jittered(geo, amt, seed) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = hash2(seed, Math.round(x * 997) * 31 + Math.round(y * 991), Math.round(z * 983));
    const k = 1 + ((h & 1023) / 1023 - 0.5) * amt;
    p.setXYZ(i, x * k, y * (1 + (k - 1) * 0.6), z * k);
  }
  return g;
}

const GEO = {
  rocks: [0, 1, 2, 3].map(s => jittered(new THREE.IcosahedronGeometry(1, 5), 0.4, 100 + s)),
  crowns: [0, 1, 2].map(s => jittered(new THREE.IcosahedronGeometry(1, 3), 0.3, 200 + s)),
  cones: [0, 1].map(s => jittered(new THREE.ConeGeometry(1, 1, 20, 6), 0.16, 300 + s)),
  bush: [0, 1].map(s => jittered(new THREE.IcosahedronGeometry(1, 3), 0.35, 400 + s)),
  trunk: jittered(new THREE.CylinderGeometry(0.75, 1, 1, 16, 8), 0.08, 500),
};

export class ChunkRenderer {
  constructor(game) {
    this.g = game;
    this.world = game.world;
    this.live = new Map();
    // геометрия чанков без нормалей (MeshBuilder flat) — нормаль грани считает видеокарта
    this.matTerrain = addSurfaceDetail(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 3.2, 0.11);
    this.matObj = addSurfaceDetail(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 6, 0.07);
    this.matGlass = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.38, depthWrite: false });
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.cols = {};
    for (const b of C.BIOME_IDS) {
      const src = C.BIOMES[b].colors, out = {};
      for (const k in src) out[k] = lin(src[k]);
      this.cols[b] = out;
    }
    this.queue = [];
    this.lastCx = null; this.lastCz = null;
  }

  update(px, pz, force) {
    const R = this.g.settings.view;
    const cx = Math.floor(px / C.CHUNK), cz = Math.floor(pz / C.CHUNK);
    const lim = C.HALF / C.CHUNK;
    if (cx !== this.lastCx || cz !== this.lastCz || force) {
      this.lastCx = cx; this.lastCz = cz;
      const want = new Set();
      this.queue.length = 0;
      for (let i = cx - R; i <= cx + R; i++) for (let j = cz - R; j <= cz + R; j++) {
        if (i < -lim || j < -lim || i >= lim || j >= lim) continue;
        const dx = (i + 0.5) * C.CHUNK - px, dz = (j + 0.5) * C.CHUNK - pz;
        const d = Math.hypot(dx, dz);
        if (d > (R + 0.75) * C.CHUNK) continue;
        const key = this.world.ckey(i, j);
        want.add(key);
        if (!this.live.has(key)) this.queue.push({ i, j, key, d });
      }
      for (const [key, ch] of this.live) if (!want.has(key)) this.dispose(key, ch);
      this.queue.sort((a, b) => a.d - b.d);
    }
    // чанки строятся по шагам (рельеф, деревья, камни, трава, постройки), укладываясь в бюджет кадра
    const t0 = performance.now(), budget = force ? 2000 : 7;
    while (performance.now() - t0 < budget) {
      if (this.cur && !this.live.has(this.curKey)) this.cur = null; // чанк уже выгружен
      if (!this.cur) {
        const q = this.queue.shift();
        if (!q) break;
        if (this.live.has(q.key)) continue;
        this.cur = this.buildSteps(q.i, q.j, q.key); this.curKey = q.key;
      }
      if (this.cur.next().done) this.cur = null;
    }
  }

  pending() { return this.queue.length + (this.cur ? 1 : 0); }

  dispose(key, ch) {
    for (const m of ch.meshes) { m.geometry.dispose(); this.group.remove(m); }
    this.live.delete(key);
  }

  // сборка чанка по шагам (генератор); чанк сразу числится живым, чтобы его можно было выгрузить на полпути
  *buildSteps(cx, cz, key) {
    const d = this.world.chunk(cx, cz);
    const ch = { meshes: [], cx, cz };
    this.live.set(key, ch);
    const tb = new MeshBuilder(0, true);
    this.buildTerrain(tb, cx, cz);
    const terrain = new THREE.Mesh(tb.build(), this.matTerrain);
    terrain.receiveShadow = true;
    terrain.matrixAutoUpdate = false;
    ch.meshes.push(terrain);
    this.group.add(terrain);
    yield;
    yield* this.objectSteps(ch, d);
  }

  buildObjects(ch, d) { for (const _ of this.objectSteps(ch, d)); }

  *objectSteps(ch, d) {
    const ob = new MeshBuilder(0.16, true), gb = new MeshBuilder(0, true);
    for (const t of d.trees) if (!this.world.depleted.has(t.id)) this.addTree(ob, t);
    yield;
    for (const r of d.rocks) if (!this.world.depleted.has(r.id)) this.addRock(ob, r);
    for (const b of d.bushes) if (!this.world.depleted.has(b.id)) this.addBush(ob, b);
    yield;
    this.addGrass(ob, d);
    yield;
    ob.facet = 0.07;
    for (const s of d.structs) this.addStruct(ob, gb, s);
    yield;
    if (!ob.empty) {
      const m = new THREE.Mesh(ob.build(), this.matObj);
      m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false;
      m.userData.objects = true;
      ch.meshes.push(m); this.group.add(m);
    }
    if (!gb.empty) {
      const m = new THREE.Mesh(gb.build(), this.matGlass);
      m.matrixAutoUpdate = false;
      m.userData.objects = true;
      ch.meshes.push(m); this.group.add(m);
    }
  }

  // перестроить деревья/постройки чанка (после вырубки)
  rebuildObjects(cx, cz) {
    const key = this.world.ckey(cx, cz);
    const ch = this.live.get(key);
    if (!ch) return;
    // чанк ещё строится — сначала достраиваем
    if (this.cur && this.curKey === key) { while (!this.cur.next().done); this.cur = null; }
    ch.meshes = ch.meshes.filter(m => {
      if (m.userData.objects) { m.geometry.dispose(); this.group.remove(m); return false; }
      return true;
    });
    this.buildObjects(ch, this.world.chunk(cx, cz));
  }

  buildTerrain(mb, cx, cz) {
    const w = this.world, S = C.SEG, st = C.TSTEP;
    const N = S + 1;
    const H = new Float32Array(N * N), R = new Float32Array(N * N), T = new Float32Array(N * N), D = new Float32Array(N * N);
    const info = {};
    const ix0 = cx * S, iz0 = cz * S;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      w.pointInfo((ix0 + i) * st, (iz0 + j) * st, info);
      const k = j * N + i;
      const h = info.h + w.jit(ix0 + i, iz0 + j, info);
      H[k] = h; R[k] = info.road; T[k] = info.town; D[k] = info.dirt;
      const hk = (ix0 + i + 2048) * 4096 + (iz0 + j + 2048);
      if (!w.hCache.has(hk)) w.hCache.set(hk, h);
    }
    const cols = this.cols, road = cols.forest.road;
    const x0 = cx * C.CHUNK, z0 = cz * C.CHUNK;
    const pickCol = (a, b, e, xm, zm) => {
      const h = (H[a] + H[b] + H[e]) / 3;
      const rd = (R[a] + R[b] + R[e]) / 3, town = (T[a] + T[b] + T[e]) / 3, dirt = (D[a] + D[b] + D[e]) / 3;
      const dh = Math.max(H[a], H[b], H[e]) - Math.min(H[a], H[b], H[e]);
      const n = w.nA.noise(xm / 38, zm / 38);
      const hv = hash2(7, Math.floor(xm * 3), Math.floor(zm * 3));
      const bio = w.biomePick(xm, zm, ((hv >>> 10) & 1023) / 1023);
      const col = cols[bio];
      const jitter = 1 + ((hv & 255) / 255 - 0.5) * (rd > 0.55 ? 0.05 : 0.16);
      let c;
      if (rd > 0.55) c = road;
      else if (town > 0.55) c = n > 0.55 ? col.dirt : (n > 0 ? col.grass2 : col.grass);
      else if (h < 1.3) c = h < -0.8 ? col.seabed : col.sand;
      else if (dh > 2.4) c = col.rock;
      else if (h > C.BIOMES[bio].snowLine + n * 8) c = col.snow;
      else if (dirt > 0.5) c = col.dirt;
      else c = n > 0.15 ? col.grass2 : col.grass;
      return shade(c, jitter);
    };
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = j * N + i, b = a + 1, c = a + N, e = c + 1; // a=00 b=10 c=01 e=11
      const xa = x0 + i * st, za = z0 + j * st, xb = xa + st, zb = za + st;
      // треугольники: (00, 11, 10) и (00, 01, 11)
      const c1 = pickCol(a, e, b, xa + st * 0.66, za + st * 0.33);
      mb.tri(xa, H[a], za, xb, H[e], zb, xb, H[b], za, c1);
      const c2 = pickCol(a, c, e, xa + st * 0.33, za + st * 0.66);
      mb.tri(xa, H[a], za, xa, H[c], zb, xb, H[e], zb, c2);
    }
  }

  addTree(mb, t) {
    const s = t.s, x = t.x, y = t.y - 0.2, z = t.z;
    const cols = TREE_COLORS[t.type] || TREE_COLORS.pine;
    const vi = Math.floor((t.rot * 10) % 3);
    const leaf = lin(cols[vi % cols.length]);
    const trunk = lin(0x6b4a30);
    switch (t.type) {
      case 'pine':
      case 'snowpine': {
        mb.geo(GEO.trunk, mat(x, y + 1.6 * s, z, 0, t.rot, 0, 0.26 * s, 3.2 * s, 0.26 * s), trunk);
        const tiers = [[2.5, 2.4, 2.8], [2.1, 2.3, 4.0], [1.75, 2.1, 5.1], [1.35, 2.0, 6.2], [0.9, 1.9, 7.3]];
        tiers.forEach(([r, h, yy], k) => {
          const cg = GEO.cones[(vi + k) & 1];
          mb.geo(cg, mat(x, y + yy * s, z, 0, t.rot + k * 0.7, 0, r * s, h * s, r * s), shade(leaf, 1 - k * 0.04));
          if (t.type === 'snowpine') mb.geo(cg, mat(x, y + (yy + h * 0.24) * s, z, 0, t.rot + k, 0, r * 0.7 * s, h * 0.55 * s, r * 0.7 * s), lin(0xf2f6f8));
        });
        break;
      }
      case 'oak':
        mb.geo(GEO.trunk, mat(x, y + 1.7 * s, z, 0, t.rot, 0, 0.34 * s, 3.4 * s, 0.34 * s), trunk);
        mb.geo(PRIM.box, mat(x + 0.5 * s, y + 3.2 * s, z, 0, t.rot, -0.7, 0.16 * s, 1.4 * s, 0.16 * s), trunk);
        mb.geo(GEO.crowns[vi], mat(x, y + 4.8 * s, z, 0, t.rot, 0, 2.5 * s, 2.0 * s, 2.5 * s), leaf);
        mb.geo(GEO.crowns[(vi + 1) % 3], mat(x + 1.4 * s, y + 4.1 * s, z + 0.6 * s, 0.4, t.rot, 0, 1.5 * s, 1.3 * s, 1.5 * s), shade(leaf, 0.92));
        mb.geo(GEO.crowns[(vi + 2) % 3], mat(x - 1.1 * s, y + 4.4 * s, z - 0.7 * s, 0.2, t.rot + 1, 0, 1.4 * s, 1.2 * s, 1.4 * s), shade(leaf, 1.06));
        mb.geo(GEO.crowns[vi], mat(x + 0.2 * s, y + 5.9 * s, z - 0.3 * s, 0.1, t.rot + 2, 0, 1.3 * s, 1.0 * s, 1.3 * s), shade(leaf, 1.12));
        break;
      case 'birch':
        mb.geo(GEO.trunk, mat(x, y + 2.7 * s, z, 0, t.rot, 0, 0.18 * s, 5.4 * s, 0.18 * s), lin(0xe6e2d8));
        for (const hy of [1.4, 2.6, 3.8]) mb.geo(PRIM.box, mat(x, y + hy * s, z, 0, t.rot + hy, 0, 0.37 * s, 0.07 * s, 0.37 * s), lin(0x3a3632));
        mb.geo(GEO.crowns[vi], mat(x, y + 5.6 * s, z, 0, t.rot, 0, 1.6 * s, 2.3 * s, 1.6 * s), leaf);
        mb.geo(GEO.crowns[(vi + 1) % 3], mat(x + 0.6 * s, y + 4.7 * s, z, 0, t.rot, 0, 1.0 * s, 1.2 * s, 1.0 * s), shade(leaf, 0.9));
        break;
      case 'dead':
        mb.geo(GEO.trunk, mat(x, y + 2.5 * s, z, 0, t.rot, 0, 0.22 * s, 5 * s, 0.22 * s), lin(0x5f5246));
        mb.geo(PRIM.box, mat(x + 0.7 * s, y + 3.4 * s, z, 0, t.rot, 0.9, 0.16 * s, 1.8 * s, 0.16 * s), lin(0x5f5246));
        mb.geo(PRIM.box, mat(x - 0.5 * s, y + 4.1 * s, z, 0, t.rot + 1, -0.8, 0.14 * s, 1.4 * s, 0.14 * s), lin(0x5f5246));
        mb.geo(PRIM.box, mat(x, y + 2.2 * s, z + 0.5 * s, 0.9, t.rot + 2, 0, 0.1 * s, 1.0 * s, 0.1 * s), lin(0x5f5246));
        break;
      case 'cactus':
        mb.geo(PRIM.cyl8, mat(x, y + 1.9 * s, z, 0, t.rot, 0, 0.38 * s, 3.8 * s, 0.38 * s), leaf);
        mb.geo(PRIM.cyl8, mat(x + 0.75 * s, y + 1.9 * s, z, 0, t.rot, 1.5708, 0.2 * s, 0.9 * s, 0.2 * s), leaf);
        mb.geo(PRIM.cyl8, mat(x + 1.1 * s, y + 2.6 * s, z, 0, t.rot, 0, 0.2 * s, 1.5 * s, 0.2 * s), leaf);
        mb.geo(PRIM.cyl8, mat(x - 0.7 * s, y + 2.4 * s, z, 0, t.rot, 1.5708, 0.18 * s, 0.8 * s, 0.18 * s), leaf);
        mb.geo(PRIM.cyl8, mat(x - 1.0 * s, y + 3.0 * s, z, 0, t.rot, 0, 0.18 * s, 1.2 * s, 0.18 * s), leaf);
        mb.geo(PRIM.cone6, mat(x, y + 3.85 * s, z, 0, 0, 0, 0.12, 0.15, 0.12), lin(0xe85a8a));
        break;
      case 'palm':
        for (let k = 0; k < 4; k++) mb.geo(GEO.trunk, mat(x + k * 0.12 * s, y + (0.8 + k * 1.5) * s, z, 0, t.rot, -0.06 * k, 0.22 * s, 1.6 * s, 0.22 * s), shade(lin(0x8a6a48), 1 - k * 0.05));
        for (let k = 0; k < 6; k++) {
          const a = t.rot + k * 1.047;
          mb.geo(PRIM.box, mat(x + 0.5 * s + Math.cos(a) * 1.3 * s, y + 6.1 * s, z + Math.sin(a) * 1.3 * s, 0, -a, 0.4, 2.8 * s, 0.1 * s, 0.75 * s), leaf);
        }
        break;
      default:
        mb.geo(PRIM.cone6, mat(x, y + 3 * s, z, 0, 0, 0, 2 * s, 5 * s, 2 * s), leaf);
    }
  }

  addRock(mb, r) {
    const base = this.cols[r.bio || 'forest'].rock;
    const c = r.ore ? lin(0x5e5a58) : shade(base, 0.92 + (r.rot % 1) * 0.16);
    const g = GEO.rocks[Math.floor(r.rot * 7) & 3];
    mb.geo(g, mat(r.x, r.y + 0.2 * r.s, r.z, 0.3, r.rot, 0.2, 1.25 * r.s, 0.8 * r.s, 1.05 * r.s), c);
    if (r.s > 1.6) mb.geo(GEO.rocks[(Math.floor(r.rot * 7) + 1) & 3], mat(r.x + 0.9 * r.s, r.y + 0.1, r.z + 0.4 * r.s, 0, r.rot + 1, 0, 0.5 * r.s, 0.35 * r.s, 0.45 * r.s), shade(c, 0.94));
    if (r.ore) {
      for (let k = 0; k < 7; k++) {
        const a = r.rot + k * 0.9, rr = 0.85 * r.s;
        mb.geo(PRIM.ico, mat(r.x + Math.cos(a) * rr, r.y + (0.35 + (k % 3) * 0.18) * r.s, r.z + Math.sin(a) * rr * 0.85, a, k, 0, 0.22 * r.s, 0.18 * r.s, 0.22 * r.s), lin(k % 2 ? 0xb5642a : 0x9a4a22));
      }
    }
    if (r.bio === 'snow') mb.geo(GEO.rocks[(Math.floor(r.rot * 7) + 2) & 3], mat(r.x, r.y + 0.62 * r.s, r.z, 0, r.rot, 0, 0.9 * r.s, 0.25 * r.s, 0.75 * r.s), lin(0xf2f6f8));
  }

  addBush(mb, b) {
    const c = lin(b.bio === 'snow' ? 0x56705a : b.bio === 'desert' ? 0x8a8a4a : 0x4a7d36);
    const g = GEO.bush[Math.floor(b.x) & 1];
    mb.geo(g, mat(b.x, b.y + 0.35 * b.s, b.z, 0, b.x, 0, 0.95 * b.s, 0.6 * b.s, 0.95 * b.s), c);
    mb.geo(GEO.bush[(Math.floor(b.x) + 1) & 1], mat(b.x + 0.3 * b.s, b.y + 0.55 * b.s, b.z - 0.2 * b.s, 0.4, b.z, 0, 0.6 * b.s, 0.45 * b.s, 0.6 * b.s), shade(c, 1.1));
    if (b.bio === 'snow') mb.geo(g, mat(b.x, b.y + 0.62 * b.s, b.z, 0, b.z, 0, 0.7 * b.s, 0.22 * b.s, 0.7 * b.s), lin(0xf2f6f8));
    if (b.berry) {
      for (let k = 0; k < 8; k++) {
        const a = k * 0.8 + b.x;
        mb.geo(PRIM.ico, mat(b.x + Math.cos(a) * 0.75 * b.s, b.y + (0.3 + (k % 3) * 0.15) * b.s, b.z + Math.sin(a) * 0.75 * b.s, 0, 0, 0, 0.08, 0.08, 0.08), lin(k % 2 ? 0xc02030 : 0x3040a0));
      }
    }
  }

  // пучки травы, цветы и камешки — мелкие треугольники для «полигональности»
  addGrass(mb, d) {
    const w = this.world;
    let seed = (d.cx * 7349 + d.cz * 9151) | 0;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) | 0; return ((seed >>> 8) & 0xffff) / 0xffff; };
    const G = { forest: [lin(0x5f9a3a), lin(0x78b04a)], desert: [lin(0xb8a060), lin(0xa08848)] };
    const flowers = [lin(0xf0e050), lin(0xe8e8f0), lin(0xd05a8a), lin(0x6a8ae0)];
    const pebble = lin(0x8a8680);
    for (let i = 0; i < 500; i++) {
      const x = d.cx * C.CHUNK + rnd() * C.CHUNK, z = d.cz * C.CHUNK + rnd() * C.CHUNK;
      const r = rnd(), a0 = rnd() * 6.28, rb = rnd();
      const bio = w.biomePick(x, z, rb);
      if (bio === 'snow') continue;
      if (bio === 'desert' && r > 0.35) continue;
      const h = w.height(x, z);
      if (h < 1.6 || h > C.BIOMES.forest.snowLine - 4) continue;
      if (w.roadWeight(x, z) > 0.2 || w.flatWeight(x, z, 0) > 0.5) continue;
      if (r < 0.06) { mb.geo(GEO.rocks[i & 3], mat(x, h, z, a0, a0, 0, 0.18, 0.1, 0.15), shade(pebble, 0.9 + r)); continue; }
      const col = G[bio][r < 0.5 ? 0 : 1];
      for (let k = 0; k < 7; k++) {
        const a = a0 + k * 0.8976, bx = x + Math.cos(a) * 0.1, bz = z + Math.sin(a) * 0.1;
        const tx = x + Math.cos(a) * 0.38, tz = z + Math.sin(a) * 0.38;
        const px = -Math.sin(a) * 0.08, pz = Math.cos(a) * 0.08;
        const hh = 0.42 + r * 0.38 + (k & 1) * 0.1;
        // изогнутая травинка: нижний сегмент почти вертикален, верхний клонится наружу
        const mx = x + Math.cos(a) * 0.17, mz = z + Math.sin(a) * 0.17, my = h + hh * 0.55;
        const back = shade(col, 0.85);
        mb.quad(bx - px, h - 0.05, bz - pz, bx + px, h - 0.05, bz + pz, mx + px * 0.6, my, mz + pz * 0.6, mx - px * 0.6, my, mz - pz * 0.6, col);
        mb.tri(mx - px * 0.6, my, mz - pz * 0.6, mx + px * 0.6, my, mz + pz * 0.6, tx, h + hh, tz, col);
        mb.quad(bx + px, h - 0.05, bz + pz, bx - px, h - 0.05, bz - pz, mx - px * 0.6, my, mz - pz * 0.6, mx + px * 0.6, my, mz + pz * 0.6, back);
        mb.tri(mx + px * 0.6, my, mz + pz * 0.6, mx - px * 0.6, my, mz - pz * 0.6, tx, h + hh, tz, back);
      }
      if (bio === 'forest' && r > 0.82) {
        const fc = flowers[Math.floor(rnd() * flowers.length)];
        mb.geo(PRIM.ico, mat(x, h + 0.55, z, 0, 0, 0, 0.09, 0.07, 0.09), fc);
      }
    }
  }

  addStruct(mb, gb, s) {
    const inst = this.world.instStruct(s);
    for (const b of inst.boxes) {
      const bb = b.bb;
      const target = b.glass ? gb : mb;
      const tall = bb[4] - bb[1] > 1.1 && !b.glass && !b.cont && Math.min(bb[3] - bb[0], bb[5] - bb[2]) < 0.5;
      if (tall) target.boxBanded(bb[0], bb[1], bb[2], bb[3], bb[4], bb[5], lin(b.c), 0.14);
      else target.box(bb[0], bb[1], bb[2], bb[3], bb[4], bb[5], lin(b.c), true);
      if (b.cont) {
        // тёмная «дверца» контейнера сверху, чтобы читалось как мебель
        const h = bb[4] - bb[1];
        target.box(bb[0] + 0.04, bb[1] + h * 0.92, bb[2] + 0.04, bb[3] - 0.04, bb[4] + 0.01, bb[5] - 0.04, shade(lin(b.c), 0.75), true);
      }
    }
    for (const p of inst.prisms) {
      const bb = p.bb;
      mb.prism(bb[0], bb[1], bb[2], bb[3], bb[4], bb[5], lin(p.c), p.rx);
    }
    for (const t of inst.tris) {
      const [a, b, c] = t.v, col = lin(t.c);
      mb.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], col);
      if (t.two) mb.tri(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], shade(col, 0.8));
    }
  }
}
