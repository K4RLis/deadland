// Строительство баз: блоки 2×2×2 м на горизонтальной сетке, по высоте — привязка к земле и соседям.
import * as THREE from 'three';
import { MeshBuilder, lin, shade, PRIM, mat } from './mesh.js';
import { ITEMS } from './items.js';

// station — блок работает как станция крафта
export const BLOCK_TYPES = {
  wood: { name: 'Деревянный блок', hp: 350, shape: 'cube', item: 'b_wood', mat: 'wood', color: 0x9a6a3e },
  wwall: { name: 'Деревянная стена', hp: 260, shape: 'panel', item: 'b_wwall', mat: 'wood', color: 0x9f7044 },
  wwin: { name: 'Стена с окном', hp: 200, shape: 'window', item: 'b_wwin', mat: 'wood', color: 0x9f7044 },
  wfloor: { name: 'Деревянный пол', hp: 250, shape: 'slab', item: 'b_wfloor', mat: 'wood', color: 0xa87a4a },
  wramp: { name: 'Деревянная рампа', hp: 300, shape: 'ramp', item: 'b_wramp', mat: 'wood', color: 0x9a6a3e },
  door: { name: 'Дверь', hp: 450, shape: 'door', item: 'b_door', mat: 'wood', color: 0x7a4f2a },
  mdoor: { name: 'Железная дверь', hp: 1600, shape: 'door', item: 'b_mdoor', mat: 'iron', color: 0x6a737c },
  stone: { name: 'Каменный блок', hp: 1100, shape: 'cube', item: 'b_stone', mat: 'stone', color: 0x8f8f8c },
  metal: { name: 'Железный блок', hp: 2600, shape: 'cube', item: 'b_metal', mat: 'iron', color: 0x6f7a84 },
  spikes: { name: 'Шипы', hp: 260, shape: 'spikes', item: 'b_spikes', mat: 'wood', color: 0x8a6a40 },
  box: { name: 'Ящик для хранения', hp: 300, shape: 'chest', item: 'b_box', mat: 'wood', color: 0xa0783f },
  bed: { name: 'Спальник', hp: 120, shape: 'bed', item: 'b_bed', mat: 'cloth', color: 0x3f6a9a },
  fire: { name: 'Костёр', hp: 150, shape: 'fire', item: 'b_fire', mat: 'wood', color: 0x5a3a20, station: 'fire', light: 1 },
  torch: { name: 'Факел', hp: 60, shape: 'torch', item: 'b_torch', mat: 'wood', color: 0x6a4a2a, light: 0.6 },
  bench: { name: 'Верстак', hp: 400, shape: 'bench', item: 'b_bench', mat: 'wood', color: 0x8a6038, station: 'bench' },
  forge: { name: 'Кузница', hp: 900, shape: 'forge', item: 'b_forge', mat: 'stone', color: 0x7a7672, station: 'forge', light: 0.5 },
  farm: { name: 'Грядка', hp: 200, shape: 'farm', item: 'b_farm', mat: 'wood', color: 0x7a5232 },
  collector: { name: 'Сборщик воды', hp: 250, shape: 'collector', item: 'b_collector', mat: 'wood', color: 0x6a5a48 },
};

export const GROW_DAYS = 0.3;   // время роста урожая в игровых сутках (~7 минут)

export const blockKey = (i, j, y0) => `${i},${j},${Math.round(y0 * 4)}`;
const colKey = (i, j) => `${i},${j}`;

function geomFor(type) {
  const T = BLOCK_TYPES[type];
  const c = lin(T.color), dk = shade(c, 0.78);
  const mb = new MeshBuilder();
  switch (T.shape) {
    case 'cube':
      mb.box(-1, 0, -1, 1, 2, 1, c);
      if (type === 'wood') {
        for (const y of [0.66, 1.33]) mb.box(-1.01, y - 0.03, -1.01, 1.01, y + 0.03, 1.01, dk, true);
      } else if (type === 'stone') {
        mb.box(-1.01, 0.97, -1.01, 1.01, 1.03, 1.01, shade(c, 0.85), true);
        mb.box(-0.03, 0, -1.01, 0.03, 0.97, 1.01, shade(c, 0.85), true);
        mb.box(-1.01, 0, -0.03, 1.01, 0.97, 0.03, shade(c, 0.85), true);
      } else if (type === 'metal') {
        mb.box(-1.01, 1.85, -1.01, 1.01, 2.0, 1.01, shade(c, 1.15), true);
        mb.box(-1.01, 0, -1.01, 1.01, 0.15, 1.01, shade(c, 1.15), true);
        for (const x of [-0.6, 0.6]) mb.box(x - 0.04, 0.15, -1.02, x + 0.04, 1.85, 1.02, shade(c, 0.85), true);
      }
      break;
    case 'panel':
      mb.box(-1, 0, -0.12, 1, 2, 0.12, c);
      for (const x of [-0.95, 0, 0.95]) mb.box(x - 0.06, 0, -0.14, x + 0.06, 2, 0.14, dk, true);
      mb.box(-1, 0.95, -0.14, 1, 1.05, 0.14, dk, true);
      break;
    case 'window':
      mb.box(-1, 0, -0.12, 1, 0.8, 0.12, c);
      mb.box(-1, 1.6, -0.12, 1, 2, 0.12, c);
      mb.box(-1, 0.8, -0.12, -0.6, 1.6, 0.12, c);
      mb.box(0.6, 0.8, -0.12, 1, 1.6, 0.12, c);
      mb.box(-0.6, 0.8, -0.03, 0.6, 1.6, 0.03, lin(0x9ccbe0), true);
      mb.box(-0.03, 0.8, -0.05, 0.03, 1.6, 0.05, dk, true);
      break;
    case 'slab':
      mb.box(-1, 0, -1, 1, 0.3, 1, c);
      for (const x of [-0.5, 0, 0.5]) mb.box(x - 0.02, 0.3, -1, x + 0.02, 0.31, 1, dk, true);
      break;
    case 'ramp':
      mb.quad(-1, 0, -1, 1, 0, -1, 1, 2, 1, -1, 2, 1, c);
      mb.quad(1, 0, 1, -1, 0, 1, -1, 2, 1, 1, 2, 1, shade(c, 0.85));
      mb.tri(1, 0, -1, 1, 0, 1, 1, 2, 1, shade(c, 0.9));
      mb.tri(-1, 0, 1, -1, 0, -1, -1, 2, 1, shade(c, 0.9));
      mb.quad(-1, 0, 1, 1, 0, 1, 1, 0, -1, -1, 0, -1, dk);
      break;
    case 'door':
      mb.box(-1, 0, -0.1, 1, 2, 0.1, c);
      mb.box(-0.95, 0.15, -0.12, 0.95, 0.3, 0.12, dk, true);
      mb.box(-0.95, 1.7, -0.12, 0.95, 1.85, 0.12, dk, true);
      mb.box(0.65, 0.95, -0.16, 0.8, 1.05, 0.16, lin(0xd4a640), true);
      break;
    case 'spikes':
      mb.box(-1, 0, -1, 1, 0.12, 1, c);
      for (let a = -0.66; a <= 0.67; a += 0.66) for (let b = -0.66; b <= 0.67; b += 0.66) {
        mb.geo(PRIM.cone5, mat(a, 0.4, b, 0, a + b, 0, 0.14, 0.6, 0.14), lin(0xb8bcc0));
      }
      break;
    case 'chest':
      mb.box(-0.8, 0, -0.5, 0.8, 0.85, 0.5, c);
      mb.box(-0.82, 0.85, -0.52, 0.82, 1.0, 0.52, dk);
      mb.box(-0.1, 0.6, -0.54, 0.1, 0.85, -0.5, lin(0xd4a640), true);
      break;
    case 'bed':
      mb.box(-0.45, 0, -0.95, 0.45, 0.2, 0.95, c);
      mb.box(-0.4, 0.2, 0.55, 0.4, 0.3, 0.9, lin(0xe8e4da));
      break;
    case 'fire':
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * Math.PI * 2;
        mb.geo(PRIM.dodeca, mat(Math.cos(a) * 0.45, 0.08, Math.sin(a) * 0.45, 0, a, 0, 0.14, 0.1, 0.14), lin(0x7a7a78));
      }
      mb.geo(PRIM.box, mat(0, 0.12, 0, 0, 0.6, 0.3, 0.8, 0.1, 0.1), c);
      mb.geo(PRIM.box, mat(0, 0.12, 0, 0, -0.6, -0.3, 0.8, 0.1, 0.1), c);
      break;
    case 'torch':
      mb.box(-0.05, 0, -0.05, 0.05, 1.3, 0.05, c);
      mb.box(-0.08, 1.2, -0.08, 0.08, 1.35, 0.08, lin(0x3a2a1a));
      break;
    case 'bench':
      mb.box(-0.9, 0.85, -0.5, 0.9, 1.0, 0.5, c);
      for (const [x, z] of [[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.4], [0.8, 0.4]]) mb.box(x - 0.07, 0, z - 0.07, x + 0.07, 0.85, z + 0.07, dk);
      mb.box(-0.85, 0.3, -0.45, 0.85, 0.36, 0.45, dk);
      mb.box(-0.6, 1.0, -0.2, -0.2, 1.08, 0.2, lin(0x8a8e92));
      mb.box(0.2, 1.0, -0.1, 0.7, 1.05, 0.0, lin(0x5a5e62));
      mb.box(0.3, 1.0, 0.15, 0.4, 1.25, 0.25, lin(0xb04030));
      break;
    case 'forge':
      mb.box(-0.8, 0, -0.7, 0.8, 1.3, 0.7, c);
      mb.box(-0.85, 1.3, -0.75, 0.85, 1.45, 0.75, shade(c, 0.8));
      mb.box(-0.35, 1.45, -0.35, 0.35, 2.3, 0.35, shade(c, 0.9));
      mb.box(-0.4, 0.25, -0.72, 0.4, 0.75, -0.69, lin(0x1a1410), true);
      mb.box(0.85, 0, -0.3, 1.0, 0.9, 0.3, lin(0x4a4e52));
      break;
    case 'farm':
      mb.box(-0.95, 0, -0.95, 0.95, 0.35, 0.95, c);
      mb.box(-0.85, 0.35, -0.85, 0.85, 0.4, 0.85, lin(0x4a3424), true);
      break;
    case 'collector':
      mb.geo(PRIM.cyl8, mat(0, 0.55, 0, 0, 0, 0, 0.45, 1.1, 0.45), c);
      mb.geo(PRIM.cyl8, mat(0, 0.3, 0, 0, 0, 0, 0.47, 0.08, 0.47), shade(c, 0.7));
      mb.geo(PRIM.cyl8, mat(0, 0.85, 0, 0, 0, 0, 0.47, 0.08, 0.47), shade(c, 0.7));
      mb.geo(PRIM.cone6, mat(0, 1.35, 0, Math.PI, 0, 0, 0.75, 0.5, 0.75), lin(0x4a6a8a));
      break;
  }
  return mb.build();
}

// светящийся слой (огонь) — без освещения, виден ночью
function flameGeom(shape) {
  const mb = new MeshBuilder();
  if (shape === 'fire') {
    mb.geo(PRIM.cone5, mat(0, 0.45, 0, 0, 0, 0, 0.3, 0.7, 0.3), lin(0xff9a2a));
    mb.geo(PRIM.cone5, mat(0.1, 0.38, 0.05, 0, 1, 0, 0.18, 0.5, 0.18), lin(0xffd04a));
  } else if (shape === 'torch') {
    mb.geo(PRIM.cone5, mat(0, 1.5, 0, 0, 0, 0, 0.1, 0.3, 0.1), lin(0xffa030));
    mb.geo(PRIM.cone5, mat(0, 1.47, 0, 0, 1, 0, 0.06, 0.2, 0.06), lin(0xffe060));
  } else if (shape === 'forge') {
    mb.box(-0.35, 0.3, -0.71, 0.35, 0.7, -0.68, lin(0xff7a20), true);
    mb.geo(PRIM.cone5, mat(0, 0.55, -0.6, 0, 0, 0, 0.2, 0.4, 0.1), lin(0xffc040));
  }
  return mb.build();
}

function cropGeom() {
  const mb = new MeshBuilder();
  const leaf = lin(0x5a9a3a), leaf2 = lin(0x4a8a30);
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45], [0, 0]]) {
    mb.geo(PRIM.cone5, mat(x, 0.35, z, 0, x * 3, 0, 0.22, 0.7, 0.22), leaf);
    mb.geo(PRIM.box, mat(x, 0.45, z, 0.5, x + z, 0, 0.35, 0.03, 0.12), leaf2);
  }
  return mb.build();
}

export function colliderBox(b) {
  const T = BLOCK_TYPES[b.type];
  const x = b.i * 2, z = b.j * 2, y = b.y0;
  const odd = b.rot & 1;
  switch (T.shape) {
    case 'slab': return [x, y, z, x + 2, y + 0.3, z + 2];
    case 'door': return odd ? [x + 0.9, y, z, x + 1.1, y + 2, z + 2] : [x, y, z + 0.9, x + 2, y + 2, z + 1.1];
    case 'panel':
    case 'window': return odd ? [x + 0.88, y, z, x + 1.12, y + 2, z + 2] : [x, y, z + 0.88, x + 2, y + 2, z + 1.12];
    case 'spikes': return [x, y, z, x + 2, y + 0.35, z + 2];
    case 'chest':
    case 'bench': return odd ? [x + 0.5, y, z + 0.1, x + 1.5, y + 1, z + 1.9] : [x + 0.1, y, z + 0.5, x + 1.9, y + 1, z + 1.5];
    case 'forge': return [x + 0.2, y, z + 0.2, x + 1.8, y + 1.45, z + 1.8];
    case 'bed': return odd ? [x + 0.05, y, z + 0.55, x + 1.95, y + 0.25, z + 1.45] : [x + 0.55, y, z + 0.05, x + 1.45, y + 0.25, z + 1.95];
    case 'fire': return [x + 0.5, y, z + 0.5, x + 1.5, y + 0.35, z + 1.5];
    case 'torch': return [x + 0.85, y, z + 0.85, x + 1.15, y + 1.5, z + 1.15];
    case 'farm': return [x + 0.05, y, z + 0.05, x + 1.95, y + 0.4, z + 1.95];
    case 'collector': return [x + 0.5, y, z + 0.5, x + 1.5, y + 1.4, z + 1.5];
    default: return [x, y, z, x + 2, y + 2, z + 2];
  }
}

export class Blocks {
  constructor(game) {
    this.g = game;
    this.byKey = new Map();
    this.cols = new Map();
    this.meshes = {};
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.flameMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.dirty = new Set();
    this.geoms = {};
    this.flames = {};
    for (const t in BLOCK_TYPES) {
      this.geoms[t] = geomFor(t);
      const sh = BLOCK_TYPES[t].shape;
      if (sh === 'fire' || sh === 'torch' || sh === 'forge') this.flames[t] = flameGeom(sh);
    }
    this.cropGeo = cropGeom();
    this.crops = new THREE.InstancedMesh(this.cropGeo, this.mat, 512);
    this.crops.count = 0; this.crops.frustumCulled = false; this.crops.castShadow = true;
    game.scene.add(this.crops);
    this.cropT = 0;
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x40ff60, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghost = new THREE.Mesh(this.geoms.wood, this.ghostMat);
    this.ghost.visible = false;
    game.scene.add(this.ghost);
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xff9040, 0, 18, 1.6);
      l.visible = false;
      game.scene.add(l);
      this.lights.push(l);
    }
    this.lightT = 0;
    this.m4 = new THREE.Matrix4();
    this.c = new THREE.Color();
  }

  ensureMesh(type, need) {
    let m = this.meshes[type];
    if (m && m.userData.cap >= need) return m;
    const cap = Math.max(64, Math.ceil(need * 1.5));
    if (m) { this.g.scene.remove(m); m.dispose(); if (m.userData.flame) { this.g.scene.remove(m.userData.flame); m.userData.flame.dispose(); } }
    m = new THREE.InstancedMesh(this.geoms[type], this.mat, cap);
    m.userData.cap = cap;
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    this.g.scene.add(m);
    if (this.flames[type]) {
      const f = new THREE.InstancedMesh(this.flames[type], this.flameMat, cap);
      f.frustumCulled = false; f.count = 0;
      this.g.scene.add(f);
      m.userData.flame = f;
    }
    this.meshes[type] = m;
    return m;
  }

  matrixFor(b, m4) {
    const cx = b.i * 2 + 1, cz = b.j * 2 + 1;
    m4.makeRotationY(b.rot * Math.PI / 2);
    m4.setPosition(cx, b.y0, cz);
    if (BLOCK_TYPES[b.type].shape === 'door' && b.open) {
      const h = new THREE.Matrix4().makeTranslation(-1, 0, 0);
      const r = new THREE.Matrix4().makeRotationY(Math.PI / 2);
      const h2 = new THREE.Matrix4().makeTranslation(1, 0, 0);
      m4.multiply(h).multiply(r).multiply(h2);
    }
    return m4;
  }

  rebuild(type) {
    const list = [];
    for (const b of this.byKey.values()) if (b.type === type) list.push(b);
    const m = this.ensureMesh(type, list.length);
    const max = BLOCK_TYPES[type].hp;
    list.forEach((b, i) => {
      this.matrixFor(b, this.m4);
      m.setMatrixAt(i, this.m4);
      const k = 0.55 + 0.45 * Math.max(0, b.hp / max);
      this.c.setRGB(k, k, k);
      m.setColorAt(i, this.c);
      if (m.userData.flame) m.userData.flame.setMatrixAt(i, this.m4);
    });
    m.count = list.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (m.userData.flame) { m.userData.flame.count = list.length; m.userData.flame.instanceMatrix.needsUpdate = true; }
    if (type === 'farm') this.cropT = 0;
  }

  flush() {
    for (const t of this.dirty) this.rebuild(t);
    this.dirty.clear();
  }

  column(i, j) { return this.cols.get(colKey(i, j)) || []; }

  set(d) {
    const key = blockKey(d.i, d.j, d.y0);
    const old = this.byKey.get(key);
    if (old) this.removeKey(key, true);
    const T = BLOCK_TYPES[d.type];
    if (!T) return null;
    const b = { key, type: d.type, i: d.i, j: d.j, y0: Math.round(d.y0 * 4) / 4, rot: d.rot | 0, hp: d.hp ?? T.hp, open: !!d.open, owner: d.owner || '', pt: d.pt ?? null };
    const bb = colliderBox(b);
    b.col = { x0: bb[0], y0: bb[1], z0: bb[2], x1: bb[3], y1: bb[4], z1: bb[5], kind: 'block', ref: key, ramp: T.shape === 'ramp' ? b.rot : -1, off: b.open, ghost: T.shape === 'torch' };
    this.g.physics.add(b.col);
    this.byKey.set(key, b);
    const ck = colKey(b.i, b.j);
    let col = this.cols.get(ck); if (!col) this.cols.set(ck, col = []);
    col.push(b);
    this.dirty.add(b.type);
    return b;
  }

  removeKey(key, silent) {
    const b = this.byKey.get(key);
    if (!b) return null;
    this.g.physics.remove(b.col);
    this.byKey.delete(key);
    const col = this.cols.get(colKey(b.i, b.j));
    if (col) { const i = col.indexOf(b); if (i >= 0) col.splice(i, 1); }
    this.dirty.add(b.type);
    if (!silent && this.g.fx) this.g.fx.burst(b.i * 2 + 1, b.y0 + 1, b.j * 2 + 1, 20, BLOCK_TYPES[b.type].color, 4, 0.18, 0.9);
    return b;
  }

  setHp(key, hp) {
    const b = this.byKey.get(key);
    if (!b) return;
    b.hp = hp;
    this.dirty.add(b.type);
  }

  setDoor(key, open) {
    const b = this.byKey.get(key);
    if (!b) return;
    b.open = open;
    b.col.off = open;
    this.dirty.add(b.type);
  }

  setPlanted(key, pt) {
    const b = this.byKey.get(key);
    if (b) { b.pt = pt; this.cropT = 0; }
  }

  canPlace(i, j, y0) {
    for (const b of this.column(i, j)) if (Math.abs(b.y0 - y0) < 1.99) return false;
    return true;
  }

  // целевая ячейка для установки по результату луча
  target(hit) {
    const w = this.g.world;
    if (hit.kind === 'block') {
      const b = this.byKey.get(hit.c.ref);
      if (!b) return null;
      const n = hit.n;
      if (n[1] > 0) return { i: b.i, j: b.j, y0: b.y0 + 2 };
      if (n[1] < 0) return { i: b.i, j: b.j, y0: b.y0 - 2 };
      if (n[0] !== 0) return { i: b.i + n[0], j: b.j, y0: b.y0 };
      if (n[2] !== 0) return { i: b.i, j: b.j + n[2], y0: b.y0 };
      return null;
    }
    const px = hit.x + hit.n[0] * 0.05, pz = hit.z + hit.n[2] * 0.05;
    const i = Math.floor(px / 2), j = Math.floor(pz / 2);
    let y0;
    if (hit.kind !== 'terrain' && hit.n[1] > 0) y0 = Math.round(hit.y * 4) / 4;
    else {
      const x = i * 2, z = j * 2;
      const hs = [w.height(x, z), w.height(x + 2, z), w.height(x, z + 2), w.height(x + 2, z + 2), w.height(x + 1, z + 1)];
      y0 = Math.floor(Math.min(...hs) * 4) / 4;
    }
    let best = null, bd = 1.01;
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const b of this.column(i + di, j + dj)) {
        for (const cand of [b.y0, b.y0 + 2, b.y0 - 2]) {
          const d = Math.abs(cand - y0);
          if (d < bd) { bd = d; best = cand; }
        }
      }
    }
    if (best !== null) y0 = best;
    return { i, j, y0 };
  }

  showGhost(t, type, rot, ok) {
    if (!t) { this.ghost.visible = false; return; }
    this.ghost.geometry = this.geoms[type];
    this.ghost.visible = true;
    this.ghost.position.set(t.i * 2 + 1, t.y0 + 0.005, t.j * 2 + 1);
    this.ghost.rotation.set(0, rot * Math.PI / 2, 0);
    this.ghostMat.color.setHex(ok ? 0x40ff60 : 0xff4030);
  }

  hideGhost() { this.ghost.visible = false; }

  spikesAt(x, y, z) {
    const i = Math.floor(x / 2), j = Math.floor(z / 2);
    for (const b of this.column(i, j)) if (b.type === 'spikes' && y >= b.y0 - 0.3 && y <= b.y0 + 0.8) return b;
    return null;
  }

  // есть ли рядом станция крафта
  stationNear(kind, x, y, z, r = 5) {
    const i0 = Math.floor((x - r) / 2), i1 = Math.floor((x + r) / 2), j0 = Math.floor((z - r) / 2), j1 = Math.floor((z + r) / 2);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      for (const b of this.column(i, j)) {
        if (BLOCK_TYPES[b.type].station !== kind) continue;
        if (Math.hypot(b.i * 2 + 1 - x, b.y0 - y, b.j * 2 + 1 - z) <= r + 1) return true;
      }
    }
    return false;
  }

  growth(b, now) {
    if (b.pt == null) return 0;
    return Math.max(0, Math.min(1, (now - b.pt) / GROW_DAYS));
  }

  update(dt, camPos) {
    this.flush();
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.5;
      const fires = [];
      for (const b of this.byKey.values()) {
        const L = BLOCK_TYPES[b.type].light;
        if (!L) continue;
        const d = Math.hypot(b.i * 2 + 1 - camPos.x, b.j * 2 + 1 - camPos.z);
        if (d < 80) fires.push([d, b, L]);
      }
      fires.sort((a, b) => a[0] - b[0]);
      this.lights.forEach((l, k) => {
        const f = fires[k];
        if (f) {
          l.visible = true;
          const tall = f[1].type === 'torch' ? 1.6 : 0.9;
          l.position.set(f[1].i * 2 + 1, f[1].y0 + tall, f[1].j * 2 + 1);
          l.userData.k = f[2];
        } else l.visible = false;
      });
    }
    const t = performance.now() / 1000;
    for (const l of this.lights) if (l.visible) l.intensity = (9 + Math.sin(t * 13 + l.position.x) * 1.5 + Math.sin(t * 7.3) * 1.2) * (l.userData.k || 1);
    // посевы
    this.cropT -= dt;
    if (this.cropT <= 0) {
      this.cropT = 2;
      const now = this.g.day + this.g.dayTime;
      let n = 0;
      for (const b of this.byKey.values()) {
        if (b.type !== 'farm' || b.pt == null || n >= 512) continue;
        const gr = this.growth(b, now);
        const s = 0.15 + gr * 0.85;
        this.m4.makeScale(s, s * (gr >= 1 ? 1.15 : 1), s);
        this.m4.setPosition(b.i * 2 + 1, b.y0 + 0.38, b.j * 2 + 1);
        this.crops.setMatrixAt(n, this.m4);
        this.c.setRGB(gr >= 1 ? 1.25 : 0.8 + gr * 0.3, gr >= 1 ? 1.1 : 1, gr >= 1 ? 0.5 : 0.85);
        this.crops.setColorAt(n, this.c);
        n++;
      }
      this.crops.count = n;
      this.crops.instanceMatrix.needsUpdate = true;
      if (this.crops.instanceColor) this.crops.instanceColor.needsUpdate = true;
    }
  }

  serialize() {
    const out = [];
    for (const b of this.byKey.values()) out.push([b.type, b.i, b.j, Math.round(b.y0 * 4), b.rot, Math.round(b.hp), b.open ? 1 : 0, b.owner, b.pt]);
    return out;
  }

  materialCost(type) {
    const m = BLOCK_TYPES[type].mat;
    return ITEMS[m] ? m : 'wood';
  }
}

export function unpackBlock(a) {
  return { type: a[0], i: a[1], j: a[2], y0: a[3] / 4, rot: a[4], hp: a[5], open: !!a[6], owner: a[7], pt: a[8] ?? null };
}
