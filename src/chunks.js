// Отрисовка чанков: рельеф, деревья, камни, постройки — по одному мешу на слой.
import * as THREE from 'three';
import * as C from './config.js';
import { MeshBuilder, lin, shade, PRIM, mat } from './mesh.js';
import { hash2 } from './rng.js';

const TREE_COLORS = {
  pine: [0x2f5d34, 0x356a3a, 0x2a5530], oak: [0x4f8a3a, 0x5a9440, 0x46803a], birch: [0x7fb24a, 0x8cbc52],
  snowpine: [0x2e5a3c, 0x325f40], dead: [0x6b5a4a], cactus: [0x4f8a44, 0x5a9a4c], palm: [0x5a9a3a],
};

export class ChunkRenderer {
  constructor(game) {
    this.g = game;
    this.world = game.world;
    this.live = new Map();
    this.matTerrain = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.matObj = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.matGlass = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false });
    this.group = new THREE.Group();
    game.scene.add(this.group);
    const L = this.world.level.colors;
    this.col = {};
    for (const k in L) this.col[k] = lin(L[k]);
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
    // строим несколько чанков за кадр, укладываясь в бюджет времени
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < (force ? 2000 : 7)) {
      const q = this.queue.shift();
      if (!this.live.has(q.key)) this.build(q.i, q.j, q.key);
    }
  }

  pending() { return this.queue.length; }

  dispose(key, ch) {
    for (const m of ch.meshes) { m.geometry.dispose(); this.group.remove(m); }
    this.live.delete(key);
  }

  build(cx, cz, key) {
    const w = this.world;
    const d = w.chunk(cx, cz);
    const ch = { meshes: [], cx, cz };
    const tb = new MeshBuilder();
    this.buildTerrain(tb, cx, cz);
    const terrain = new THREE.Mesh(tb.build(), this.matTerrain);
    terrain.receiveShadow = true;
    terrain.matrixAutoUpdate = false;
    ch.meshes.push(terrain);
    this.group.add(terrain);
    this.buildObjects(ch, d);
    this.live.set(key, ch);
  }

  buildObjects(ch, d) {
    const ob = new MeshBuilder(0.16), gb = new MeshBuilder();
    for (const t of d.trees) if (!this.world.depleted.has(t.id)) this.addTree(ob, t);
    for (const r of d.rocks) if (!this.world.depleted.has(r.id)) this.addRock(ob, r);
    for (const b of d.bushes) if (!this.world.depleted.has(b.id)) this.addBush(ob, b);
    this.addGrass(ob, d);
    ob.facet = 0.07;
    for (const s of d.structs) this.addStruct(ob, gb, s);
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
    const col = this.col, L = w.level;
    const x0 = cx * C.CHUNK, z0 = cz * C.CHUNK;
    const pickCol = (a, b, e, xm, zm) => {
      const h = (H[a] + H[b] + H[e]) / 3;
      const road = (R[a] + R[b] + R[e]) / 3, town = (T[a] + T[b] + T[e]) / 3, dirt = (D[a] + D[b] + D[e]) / 3;
      const dh = Math.max(H[a], H[b], H[e]) - Math.min(H[a], H[b], H[e]);
      const n = w.nA.noise(xm / 38, zm / 38);
      const jitter = 1 + ((hash2(7, Math.floor(xm * 3), Math.floor(zm * 3)) & 255) / 255 - 0.5) * (road > 0.55 ? 0.05 : 0.16);
      let c;
      if (road > 0.55) c = col.road;
      else if (town > 0.55) c = n > 0.55 ? col.dirt : (n > 0 ? col.grass2 : col.grass);
      else if (h < 1.3) c = h < -0.8 ? col.seabed : col.sand;
      else if (dh > 2.8) c = col.rock;
      else if (h > L.snowLine + n * 8) c = col.snow;
      else if (dirt > 0.5) c = col.dirt;
      else c = n > 0.15 ? col.grass2 : col.grass;
      return jitter === 1 ? c : shade(c, jitter);
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
    const leaf = lin(cols[Math.floor((t.rot * 10) % cols.length)]);
    const trunk = lin(0x6b4a30);
    switch (t.type) {
      case 'pine':
      case 'snowpine': {
        mb.geo(PRIM.cyl5, mat(x, y + 1.5 * s, z, 0, t.rot, 0, 0.26 * s, 3 * s, 0.26 * s), trunk);
        const tiers = [[2.3, 3.2, 3.4], [1.75, 2.8, 5.2], [1.15, 2.4, 6.9]];
        for (const [r, h, yy] of tiers) {
          mb.geo(PRIM.cone6, mat(x, y + yy * s, z, 0, t.rot, 0, r * s, h * s, r * s), leaf);
          if (t.type === 'snowpine') mb.geo(PRIM.cone6, mat(x, y + (yy + h * 0.22) * s, z, 0, t.rot, 0, r * 0.72 * s, h * 0.6 * s, r * 0.72 * s), lin(0xf2f6f8));
        }
        break;
      }
      case 'oak':
        mb.geo(PRIM.cyl5, mat(x, y + 1.7 * s, z, 0, t.rot, 0, 0.32 * s, 3.4 * s, 0.32 * s), trunk);
        mb.geo(PRIM.ico, mat(x, y + 4.7 * s, z, 0, t.rot, 0, 2.6 * s, 2.2 * s, 2.6 * s), leaf);
        mb.geo(PRIM.ico, mat(x + 1.2 * s, y + 4.0 * s, z + 0.6 * s, 0.4, t.rot, 0, 1.5 * s, 1.3 * s, 1.5 * s), shade(leaf, 0.92));
        break;
      case 'birch':
        mb.geo(PRIM.cyl5, mat(x, y + 2.6 * s, z, 0, t.rot, 0, 0.18 * s, 5.2 * s, 0.18 * s), lin(0xe6e2d8));
        mb.geo(PRIM.ico, mat(x, y + 5.6 * s, z, 0, t.rot, 0, 1.6 * s, 2.5 * s, 1.6 * s), leaf);
        break;
      case 'dead':
        mb.geo(PRIM.cyl5, mat(x, y + 2.5 * s, z, 0, t.rot, 0, 0.22 * s, 5 * s, 0.22 * s), lin(0x5f5246));
        mb.geo(PRIM.box, mat(x + 0.7 * s, y + 3.4 * s, z, 0, t.rot, 0.9, 0.16 * s, 1.8 * s, 0.16 * s), lin(0x5f5246));
        mb.geo(PRIM.box, mat(x - 0.5 * s, y + 4.1 * s, z, 0, t.rot + 1, -0.8, 0.14 * s, 1.4 * s, 0.14 * s), lin(0x5f5246));
        break;
      case 'cactus':
        mb.geo(PRIM.cyl6, mat(x, y + 1.9 * s, z, 0, t.rot, 0, 0.38 * s, 3.8 * s, 0.38 * s), leaf);
        mb.geo(PRIM.cyl6, mat(x + 0.75 * s, y + 1.9 * s, z, 0, t.rot, 1.5708, 0.2 * s, 0.9 * s, 0.2 * s), leaf);
        mb.geo(PRIM.cyl6, mat(x + 1.1 * s, y + 2.6 * s, z, 0, t.rot, 0, 0.2 * s, 1.5 * s, 0.2 * s), leaf);
        mb.geo(PRIM.cyl6, mat(x - 0.7 * s, y + 2.4 * s, z, 0, t.rot, 1.5708, 0.18 * s, 0.8 * s, 0.18 * s), leaf);
        mb.geo(PRIM.cyl6, mat(x - 1.0 * s, y + 3.0 * s, z, 0, t.rot, 0, 0.18 * s, 1.2 * s, 0.18 * s), leaf);
        break;
      case 'palm':
        mb.geo(PRIM.cyl5, mat(x, y + 3 * s, z, 0.12, t.rot, 0.1, 0.22 * s, 6 * s, 0.22 * s), lin(0x8a6a48));
        for (let k = 0; k < 5; k++) {
          const a = t.rot + k * 1.2566;
          mb.geo(PRIM.box, mat(x + Math.cos(a) * 1.2 * s, y + 5.9 * s, z + Math.sin(a) * 1.2 * s, 0, -a, 0.35, 2.6 * s, 0.12 * s, 0.7 * s), leaf);
        }
        break;
      default:
        mb.geo(PRIM.cone6, mat(x, y + 3 * s, z, 0, 0, 0, 2 * s, 5 * s, 2 * s), leaf);
    }
  }

  addRock(mb, r) {
    const c = r.ore ? lin(0x5e5a58) : shade(this.col.rock, 0.92 + (r.rot % 1) * 0.16);
    mb.geo(PRIM.dodeca, mat(r.x, r.y + 0.2 * r.s, r.z, 0.3, r.rot, 0.2, 1.25 * r.s, 0.8 * r.s, 1.05 * r.s), c);
    if (r.ore) {
      // рыжие прожилки железа
      for (let k = 0; k < 6; k++) {
        const a = r.rot + k * 1.05, rr = 0.85 * r.s;
        mb.geo(PRIM.ico, mat(r.x + Math.cos(a) * rr, r.y + (0.35 + (k % 3) * 0.18) * r.s, r.z + Math.sin(a) * rr * 0.85, a, k, 0, 0.22 * r.s, 0.18 * r.s, 0.22 * r.s), lin(k % 2 ? 0xb5642a : 0x9a4a22));
      }
    }
  }

  addBush(mb, b) {
    const L = this.world.level;
    const c = lin(L.biome === 'snow' ? 0x56705a : L.biome === 'desert' ? 0x8a8a4a : 0x4a7d36);
    mb.geo(PRIM.ico, mat(b.x, b.y + 0.35 * b.s, b.z, 0, b.x, 0, 0.95 * b.s, 0.6 * b.s, 0.95 * b.s), c);
    mb.geo(PRIM.ico, mat(b.x + 0.3 * b.s, b.y + 0.55 * b.s, b.z - 0.2 * b.s, 0.4, b.z, 0, 0.6 * b.s, 0.45 * b.s, 0.6 * b.s), shade(c, 1.1));
    if (b.berry) {
      for (let k = 0; k < 7; k++) {
        const a = k * 0.9 + b.x;
        mb.geo(PRIM.ico, mat(b.x + Math.cos(a) * 0.75 * b.s, b.y + (0.3 + (k % 3) * 0.15) * b.s, b.z + Math.sin(a) * 0.75 * b.s, 0, 0, 0, 0.08, 0.08, 0.08), lin(k % 2 ? 0xc02030 : 0x3040a0));
      }
    }
  }

  // пучки травы и цветы — мелкие треугольники для «полигональности»
  addGrass(mb, d) {
    const L = this.world.level;
    if (L.biome === 'snow') return;
    const w = this.world;
    let seed = (d.cx * 7349 + d.cz * 9151) | 0;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) | 0; return ((seed >>> 8) & 0xffff) / 0xffff; };
    const g1 = lin(L.biome === 'desert' ? 0xb8a060 : 0x5f9a3a), g2 = lin(L.biome === 'desert' ? 0xa08848 : 0x78b04a);
    const flowers = [lin(0xf0e050), lin(0xe8e8f0), lin(0xd05a8a)];
    const n = L.biome === 'desert' ? 40 : 110;
    for (let i = 0; i < n; i++) {
      const x = d.cx * C.CHUNK + rnd() * C.CHUNK, z = d.cz * C.CHUNK + rnd() * C.CHUNK;
      const r = rnd(), a0 = rnd() * 6.28;
      const h = w.height(x, z);
      if (h < 1.6 || h > L.snowLine - 4) continue;
      if (w.roadWeight(x, z) > 0.2 || w.flatWeight(x, z, 0) > 0.5) continue;
      const col = r < 0.5 ? g1 : g2;
      for (let k = 0; k < 3; k++) {
        const a = a0 + k * 2.1, bx = x + Math.cos(a) * 0.12, bz = z + Math.sin(a) * 0.12;
        const tx = x + Math.cos(a) * 0.35, tz = z + Math.sin(a) * 0.35;
        const px = -Math.sin(a) * 0.09, pz = Math.cos(a) * 0.09;
        const hh = 0.45 + r * 0.35;
        mb.tri(bx - px, h - 0.05, bz - pz, bx + px, h - 0.05, bz + pz, tx, h + hh, tz, col);
        mb.tri(bx + px, h - 0.05, bz + pz, bx - px, h - 0.05, bz - pz, tx, h + hh, tz, shade(col, 0.85));
      }
      if (r > 0.85) {
        const fc = flowers[Math.floor(rnd() * 3)];
        mb.geo(PRIM.ico, mat(x, h + 0.55, z, 0, 0, 0, 0.09, 0.07, 0.09), fc);
      }
    }
  }

  addStruct(mb, gb, s) {
    const inst = this.world.instStruct(s);
    for (const b of inst.boxes) {
      const bb = b.bb;
      const target = b.glass ? gb : mb;
      target.box(bb[0], bb[1], bb[2], bb[3], bb[4], bb[5], lin(b.c), true);
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
