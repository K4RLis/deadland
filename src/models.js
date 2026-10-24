// Low-poly модели: персонажи, зомби, предметы в руках, мешок с лутом. Иконки рендерятся из тех же моделей.
// Детали — боксы и «скруглённые» боксы (восьмигранное сечение, скошенные торцы); у каждой модели
// они сливаются в один меш с цветами вершин, поэтому подробность почти не стоит draw calls.
import * as THREE from 'three';
import { MeshBuilder, lin } from './mesh.js';

const matCache = new Map();
export function M(hex, emissive = 0) {
  const k = hex + ':' + emissive;
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex });
    if (emissive) { m.emissive = new THREE.Color(emissive); }
    matCache.set(k, m);
  }
  return m;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 20);
const CYL12 = new THREE.CylinderGeometry(1, 1, 1, 28);
const FRUST = new THREE.CylinderGeometry(0.7, 1, 1, 20);
const ICO = new THREE.IcosahedronGeometry(1, 2);
const ICO1 = new THREE.IcosahedronGeometry(1, 3);
const DODE = new THREE.DodecahedronGeometry(1, 2);
const CONE = new THREE.ConeGeometry(1, 1, 14);
const CONE8 = new THREE.ConeGeometry(1, 1, 18);
const PI2 = Math.PI / 2;

export function part(parent, w, h, d, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, geo = BOX, em = 0) {
  const m = new THREE.Mesh(geo, M(hex, em));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
const cyl = (p, r, h, hex, x, y, z, rx = 0, ry = 0, rz = 0, geo = CYL) => part(p, r, h, r, hex, x, y, z, rx, ry, rz, geo);
// цилиндр вдоль оси Z (стволы, трубки)
const cylZ = (p, r, len, hex, x, y, z, geo = CYL) => part(p, r, len, r, hex, x, y, z, PI2, 0, 0, geo);

// затемнить (f < 1) или осветлить цвет
export function dk(hex, f) {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}

// скруглённая деталь (см. MeshBuilder.rbox): o.c — скос рёбер, o.tx/o.tz — сужение к верху, o.rx.. — поворот
const rboxGeo = new Map();
export function rpart(parent, w, h, d, hex, x = 0, y = 0, z = 0, o = {}) {
  const key = w + ',' + h + ',' + d + JSON.stringify(o);
  let geo = rboxGeo.get(key);
  if (!geo) {
    const mb = new MeshBuilder();
    mb.rbox(0, 0, 0, w, h, d, [1, 1, 1], o);
    geo = mb.build();
    geo.userData.shared = true;
    rboxGeo.set(key, geo);
  }
  const m = new THREE.Mesh(geo, M(hex));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
const rp = rpart;
// длинная скруглённая деталь вдоль оси Z: w — ширина, len — длина, d — высота
const rz = (p, w, len, d, hex, x, y, z, o = {}) => rpart(p, w, len, d, hex, x, y, z, { c: 0.4, ...o, rx: PI2 });

export function sub(parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rzz = 0) {
  const s = new THREE.Group();
  s.position.set(x, y, z);
  s.rotation.set(rx, ry, rzz);
  parent.add(s);
  return s;
}

// ---------- слияние деталей ----------
const VC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const VC_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
const flatCache = new WeakMap();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

function flatGeo(geo) {
  let f = flatCache.get(geo);
  if (!f) { f = geo.index ? geo.toNonIndexed() : geo; flatCache.set(geo, f); }
  return f;
}

function bakeParts(g, facet = 0.06) {
  g.updateMatrixWorld(true);
  const mb = new MeshBuilder(facet), glow = [];
  g.traverse(o => {
    if (!o.isMesh) return;
    const em = o.material.emissive;
    if (em && (em.r || em.g || em.b)) {
      const m = new THREE.Mesh(o.geometry, o.material);
      o.matrixWorld.decompose(m.position, m.quaternion, m.scale);
      glow.push(m);
      return;
    }
    const geo = flatGeo(o.geometry), pa = geo.attributes.position.array;
    const ca = geo.attributes.color ? geo.attributes.color.array : null;
    const base = lin(o.material.color.getHex()), mw = o.matrixWorld;
    for (let i = 0; i < pa.length; i += 9) {
      _a.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(mw);
      _b.set(pa[i + 3], pa[i + 4], pa[i + 5]).applyMatrix4(mw);
      _c.set(pa[i + 6], pa[i + 7], pa[i + 8]).applyMatrix4(mw);
      const col = ca ? [base[0] * ca[i], base[1] * ca[i + 1], base[2] * ca[i + 2]] : base;
      mb.tri(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z, col);
    }
  });
  const geo = mb.empty ? null : mb.build();
  if (geo) geo.userData.shared = true;
  return { geo, glow };
}

function fromBaked({ geo, glow }) {
  const out = new THREE.Group();
  if (geo) { const m = new THREE.Mesh(geo, VC_MAT); m.castShadow = true; out.add(m); }
  for (const o of glow) out.add(o.clone());
  return out;
}

// слить группу деталей в один меш (светящиеся детали остаются отдельными)
export function bake(g, facet) { return fromBaked(bakeParts(g, facet)); }

// ---------- персонажи ----------
// Каждая часть тела — один меш с цветами вершин, чтобы зомби стоили мало draw calls.
// Деталь: [w, h, d, hex, x, y, z, opt] — без opt обычный бокс, с opt — скруглённый (MeshBuilder.rbox).
// Для дальних персонажей строится упрощённая копия: без мелочи и без скосов.
const limbCache = new Map();

function limbGeo(parts, glow, lite) {
  const key = (glow ? 'g' : '') + (lite ? 'l' : '') + JSON.stringify(parts);
  let geo = limbCache.get(key);
  if (!geo) {
    const mb = new MeshBuilder(glow ? 0 : 0.07);
    for (const [w, h, d, hex, x, y, z, o] of parts) {
      if (lite && Math.max(w, h, d) < 0.09) continue;
      if (o) mb.rbox(x, y, z, w, h, d, lin(hex), lite ? { ...o, c: 0, b: 0 } : o);
      else mb.box(x - w / 2, y - h / 2, z - d / 2, x + w / 2, y + h / 2, z + d / 2, lin(hex));
    }
    geo = mb.build();
    geo.userData.shared = true;
    limbCache.set(key, geo);
  }
  return geo;
}

function limb(parent, parts, glow = false) {
  const geo = limbGeo(parts, glow, false);
  const m = new THREE.Mesh(geo, glow ? VC_GLOW : VC_MAT);
  m.castShadow = !glow;
  if (!glow) m.userData.lod = [geo, limbGeo(parts, false, true)];
  parent.add(m);
  return m;
}

// переключить персонажа на упрощённую (far) или полную модель
export function setLod(g, far) {
  g.traverse(o => { const l = o.userData.lod; if (l) o.geometry = l[far ? 1 : 0]; });
}

const R = (c, more) => more ? { c, ...more } : { c };
const BLOOD = 0x5a1212, WOUND = 0x8a2420, BONE = 0xd8cfb4, STRAP = 0x2a2622;

// o: skin, shirt, sleeve, pants, shoes, hair, beard, helmet, vest, pack, bare (голые руки), belt,
//    zombie, variant (0..3 — рваная одежда и раны), eyes, eyesGlow, scale, wide
export function makeHumanoid(o) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const s = o.scale || 1;
  body.scale.setScalar(s);
  const W = o.wide || 1;
  const zv = o.zombie ? (o.variant ?? Math.floor(Math.random() * 4)) : -1;
  const skin = o.skin, sk2 = dk(skin, 0.9), shirt = o.shirt, pants = o.pants, shoes = o.shoes || 0x2a2420;
  const sleeve = o.sleeve ?? shirt;

  // ноги: бедро, колено, голень, ботинок со шнуровкой, накладные карманы
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.13 * W, 0.82, 0); legR.position.set(0.13 * W, 0.82, 0);
  for (const [l, side] of [[legL, -1], [legR, 1]]) {
    const torn = zv === 1 && side < 0;
    const L = [
      [0.23 * W, 0.44, 0.26, pants, 0, -0.2, 0, R(0.28, { tx: 1.06, tz: 1.04 })],
      [0.205 * W, 0.1, 0.235, dk(pants, 0.86), 0, -0.44, -0.004, R(0.32)],
      [0.195 * W, 0.26, 0.22, torn ? skin : pants, 0, -0.58, 0.004, R(0.28, { tx: 1.08, tz: 1.05 })],
      [0.02, 0.13, 0.12, dk(pants, 0.84), side * 0.122 * W, -0.25, 0.01, R(0.2)],
      [0.024, 0.024, 0.124, dk(pants, 0.7), side * 0.124 * W, -0.19, 0.01],
      [0.15 * W, 0.012, 0.012, dk(pants, 0.72), 0, -0.03, -0.134],
      [0.205 * W, 0.12, 0.23, shoes, 0, -0.73, 0.01, R(0.25)],
      [0.2 * W, 0.075, 0.3, shoes, 0, -0.77, -0.045, R(0.22)],
      [0.18 * W, 0.06, 0.07, dk(shoes, 0.82), 0, -0.775, -0.18, R(0.4, { tx: 0.9 })],
      [0.215 * W, 0.03, 0.33, 0x17130f, 0, -0.805, -0.045],
      [0.21 * W, 0.045, 0.07, 0x17130f, 0, -0.795, 0.09],
      [0.08 * W, 0.012, 0.014, 0xb4aa94, 0, -0.69, -0.107],
      [0.08 * W, 0.012, 0.014, 0xb4aa94, 0, -0.72, -0.107],
    ];
    if (!torn) L.push([0.212 * W, 0.04, 0.24, dk(pants, 0.8), 0, -0.668, 0.008, R(0.3)]);
    else L.push([0.215 * W, 0.035, 0.245, dk(pants, 0.55), 0, -0.48, 0.0, R(0.3)], [0.06, 0.07, 0.014, WOUND, 0.02, -0.6, -0.116]);
    if (zv === 2) L.push([0.1 * W, 0.15, 0.014, BLOOD, 0.01, -0.13, -0.134]);
    if (zv === 3 && side > 0) L.push([0.11 * W, 0.07, 0.014, dk(skin, 0.85), 0, -0.44, -0.12]);
    if (o.greaves != null) {
      // наколенник, щиток на голени и ремешки
      const gv = o.greaves;
      L.push([0.215 * W, 0.12, 0.07, gv, 0, -0.44, -0.12, R(0.4)],
        [0.2 * W, 0.18, 0.04, dk(gv, 0.9), 0, -0.58, -0.113, R(0.3)],
        [0.235 * W, 0.025, 0.27, STRAP, 0, -0.37, 0.002], [0.21 * W, 0.025, 0.232, STRAP, 0, -0.62, 0.004]);
    }
    limb(l, L);
    body.add(l);
  }

  // туловище: таз, живот, грудь с плечами, шея, воротник
  const fz = -0.152 * W, bz = 0.152 * W;
  const T = [
    [0.5 * W, 0.17, 0.28 * W, pants, 0, 0.9, 0, R(0.25)],
    [0.52 * W, 0.33, 0.29 * W, shirt, 0, 1.08, 0, R(0.22, { tx: 1.06, tz: 1.04 })],
    [0.552 * W, 0.25, 0.302 * W, shirt, 0, 1.365, 0, R(0.26, { tx: 0.95, tz: 0.94 })],
    [0.165, 0.07, 0.165, skin, 0, 1.5, 0.005, R(0.3)],
    [0.27, 0.045, 0.21 * W, dk(sleeve, 0.84), 0, 1.485, 0.005, R(0.4)],
    [0.48 * W, 0.012, 0.014, dk(shirt, 0.8), 0, 1.41, bz],
  ];
  if (o.vest == null) {
    // планка с пуговицами, у людей ещё нагрудные карманы
    T.push([0.035, 0.5, 0.018, dk(shirt, 0.84), 0, 1.2, fz]);
    for (const y of [1.4, 1.27, 1.14, 1.01]) T.push([0.02, 0.02, 0.012, 0xd8d2c0, 0, y, fz - 0.01]);
    if (!o.zombie) for (const x of [-0.13 * W, 0.13 * W]) T.push(
      [0.12, 0.1, 0.02, dk(shirt, 0.9), x, 1.3, fz, R(0.15)],
      [0.125, 0.03, 0.026, dk(shirt, 0.78), x, 1.36, fz - 0.001],
      [0.018, 0.018, 0.012, 0xd8d2c0, x, 1.355, fz - 0.016],
    );
  }
  if (o.belt !== false) T.push(
    [0.53 * W, 0.065, 0.3 * W, 0x3a2a1e, 0, 0.955, 0, R(0.25)],
    [0.075, 0.06, 0.02, 0xc8a040, 0, 0.955, -0.155 * W],
    [0.045, 0.03, 0.022, 0x3a2a1e, 0, 0.955, -0.156 * W],
  );
  else T.push([0.53 * W, 0.045, 0.3 * W, dk(shirt, 0.82), 0, 0.94, 0, R(0.25)]);
  if (!o.zombie && o.belt !== false) T.push([0.045, 0.17, 0.055, STRAP, 0.272 * W, 0.86, 0.04, R(0.3)], [0.05, 0.035, 0.06, 0x8a8e92, 0.272 * W, 0.96, 0.04]);
  if (o.vest != null) {
    // разгрузка: жилет, подсумки, рация с антенной, наплечные лямки
    const v = o.vest, vd = dk(v, 0.82), vz = -0.185 * W;
    T.push(
      [0.575 * W, 0.42, 0.335 * W, v, 0, 1.2, 0, R(0.18)],
      [0.11, 0.035, 0.32 * W, v, -0.16, 1.47, 0, R(0.3)], [0.11, 0.035, 0.32 * W, v, 0.16, 1.47, 0, R(0.3)],
      [0.4, 0.34, 0.04, vd, 0, 1.22, 0.185 * W, R(0.2)],
      [0.1, 0.05, 0.012, dk(v, 0.6), 0.13, 1.34, -0.172 * W],
      [0.07, 0.1, 0.05, vd, -0.16, 1.32, vz, R(0.2)], [0.012, 0.18, 0.012, 0x1a1a1a, -0.18, 1.45, -0.17 * W],
    );
    for (const x of [-0.15, 0, 0.15]) T.push([0.1, 0.13, 0.05, vd, x, 1.1, vz, R(0.2)], [0.105, 0.03, 0.055, dk(v, 0.7), x, 1.17, vz - 0.001]);
    if (o.vestKind === 'scrap') for (const [x, y] of [[-0.2, 1.38], [0.2, 1.38], [-0.24, 1.0], [0.24, 1.0], [0.0, 1.4], [0.2, 1.24]]) T.push([0.026, 0.026, 0.014, 0xb8bcc0, x * W, y, -0.172 * W]);
    if (o.vestKind === 'police') T.push([0.3, 0.06, 0.012, 0xe8e8e0, 0.04, 1.27, -0.173 * W], [0.3, 0.06, 0.012, 0xe8e8e0, 0, 1.25, 0.2 * W]);
  }
  if (o.pack != null) {
    // рюкзак со скаткой, лямки через плечи и грудная стяжка
    const p = o.pack, pd = dk(p, 0.82);
    T.push(
      [0.36, 0.4, 0.14, p, 0, 1.2, 0.222 * W, R(0.28)],
      [0.37, 0.1, 0.16, pd, 0, 1.37, 0.226 * W, R(0.35)],
      [0.035, 0.08, 0.012, STRAP, -0.08, 1.31, 0.307 * W], [0.035, 0.08, 0.012, STRAP, 0.08, 1.31, 0.307 * W],
      [0.24, 0.15, 0.05, pd, 0, 1.1, 0.31 * W, R(0.3)],
      [0.055, 0.26, 0.1, pd, -0.205, 1.17, 0.222 * W, R(0.35)], [0.055, 0.26, 0.1, pd, 0.205, 1.17, 0.222 * W, R(0.35)],
      [0.4, 0.09, 0.09, 0x5a6a48, 0, 0.965, 0.23 * W, R(0.45)],
      [0.05, 0.37, 0.016, STRAP, -0.12, 1.29, -0.159 * W], [0.05, 0.37, 0.016, STRAP, 0.12, 1.29, -0.159 * W],
      [0.05, 0.02, 0.33 * W, STRAP, -0.12, 1.49, 0.03], [0.05, 0.02, 0.33 * W, STRAP, 0.12, 1.49, 0.03],
      [0.26, 0.03, 0.016, STRAP, 0, 1.3, -0.161 * W], [0.04, 0.035, 0.02, 0x8a8e92, 0, 1.3, -0.168 * W],
    );
  }
  if (o.zombie) {
    T.push([0.17, 0.2, 0.014, BLOOD, -0.06, 1.3, bz + 0.003]);
    if (zv === 0) T.push([0.15, 0.11, 0.016, dk(shirt, 0.42), 0.09, 1.06, fz + 0.002], [0.09, 0.06, 0.018, WOUND, 0.09, 1.06, fz + 0.001]);
    if (zv === 1) {
      T.push([0.2, 0.17, 0.016, dk(skin, 0.75), -0.11, 1.3, fz - 0.001]);
      for (const y of [1.24, 1.29, 1.34]) T.push([0.17, 0.016, 0.02, BONE, -0.11, y, fz - 0.004]);
    }
    if (zv === 2) T.push([0.22, 0.2, 0.014, BLOOD, 0.07, 1.32, fz - 0.006], [0.04, 0.16, 0.014, BLOOD, 0.14, 1.16, fz - 0.002], [0.03, 0.1, 0.014, BLOOD, 0.02, 1.17, fz - 0.002]);
    if (zv === 3) T.push([0.3 * W, 0.1, 0.016, skin, 0, 1.0, fz + 0.004], [0.08, 0.05, 0.018, WOUND, -0.06, 1.0, fz + 0.003],
      [0.07, 0.06, 0.016, dk(shirt, 0.7), -0.16 * W, 1.03, fz + 0.002], [0.06, 0.05, 0.016, dk(shirt, 0.7), 0.15 * W, 1.03, fz + 0.002]);
  }
  limb(body, T);

  // голова: череп, челюсть, нос, уши, брови, глаза, рот, причёска / шлем
  const head = new THREE.Group();
  head.position.set(0, 1.5, 0);
  body.add(head);
  const hb = [
    [0.33, 0.25, 0.33, skin, 0, 0.225, 0, R(0.32, { b: 0.18 })],
    [0.29, 0.12, 0.29, skin, 0, 0.07, -0.01, R(0.32, { b: 0.2, tx: 1.12, tz: 1.1 })],
    [0.045, 0.075, 0.05, sk2, 0, 0.15, -0.184, R(0.3, { tx: 0.7, tz: 0.8 })],
    [0.04, 0.085, 0.065, sk2, -0.168, 0.18, 0.01, R(0.3)], [0.04, 0.085, 0.065, sk2, 0.168, 0.18, 0.01, R(0.3)],
    [0.085, 0.022, 0.03, o.hair ?? dk(skin, 0.6), -0.075, 0.25, -0.165], [0.085, 0.022, 0.03, o.hair ?? dk(skin, 0.6), 0.075, 0.25, -0.165],
  ];
  const eye = o.eyes || 0x2a2a2a;
  const glowEyes = [];
  if (o.zombie) {
    hb.push(
      [0.085, 0.06, 0.014, dk(skin, 0.45), -0.075, 0.205, -0.166], [0.085, 0.06, 0.014, dk(skin, 0.45), 0.075, 0.205, -0.166],
      [0.13, 0.05, 0.014, 0x2a0808, 0, 0.068, -0.165],
      [0.11, 0.014, 0.012, 0xcfc6a6, 0, 0.087, -0.17], [0.09, 0.012, 0.012, 0xcfc6a6, 0, 0.05, -0.168],
    );
    if (zv === 0) hb.push([0.07, 0.05, 0.014, WOUND, 0.08, 0.29, -0.163]);
    if (zv === 2) hb.push([0.012, 0.09, 0.07, WOUND, 0.165, 0.24, -0.04]);
    const pupils = [[0.04, 0.035, 0.01, eye, -0.075, 0.205, -0.175], [0.04, 0.035, 0.01, eye, 0.075, 0.205, -0.175]];
    if (o.eyesGlow) glowEyes.push(...pupils); else hb.push(...pupils);
  } else {
    hb.push(
      [0.07, 0.045, 0.012, 0xece8dc, -0.075, 0.205, -0.167], [0.07, 0.045, 0.012, 0xece8dc, 0.075, 0.205, -0.167],
      [0.032, 0.04, 0.01, eye, -0.072, 0.204, -0.173], [0.032, 0.04, 0.01, eye, 0.072, 0.204, -0.173],
      [0.09, 0.018, 0.012, dk(skin, 0.6), 0, 0.075, -0.166],
    );
  }
  if (o.hair != null) {
    const hr = o.hair;
    hb.push(
      [0.355, 0.085, 0.355, hr, 0, 0.36, 0.005, R(0.34, { b: 0.3, tx: 0.92, tz: 0.92 })],
      [0.35, 0.2, 0.085, hr, 0, 0.255, 0.142, R(0.3)],
      [0.035, 0.12, 0.2, hr, -0.168, 0.285, 0.05, R(0.3)], [0.035, 0.12, 0.2, hr, 0.168, 0.285, 0.05, R(0.3)],
      [0.3, 0.05, 0.05, hr, 0.025, 0.322, -0.152, R(0.3, { rz: 0.08 })],
    );
    if (o.beard) hb.push([0.29, 0.085, 0.05, hr, 0, 0.055, -0.15, R(0.35)], [0.1, 0.022, 0.02, hr, 0, 0.1, -0.174]);
  }
  if (o.helmet != null) {
    const hm = o.helmet;
    hb.push(
      [0.4, 0.15, 0.4, hm, 0, 0.365, 0, R(0.4, { b: 0.35, tx: 0.82, tz: 0.82 })],
      [0.43, 0.035, 0.43, dk(hm, 0.85), 0, 0.295, 0, R(0.35)],
      [0.016, 0.2, 0.022, 0x2a2a20, -0.172, 0.18, -0.03], [0.016, 0.2, 0.022, 0x2a2a20, 0.172, 0.18, -0.03],
      [0.22, 0.05, 0.04, 0x2a2a2a, 0, 0.345, -0.188, R(0.3)],
      [0.07, 0.035, 0.012, 0x3a5a6a, -0.055, 0.345, -0.209], [0.07, 0.035, 0.012, 0x3a5a6a, 0.055, 0.345, -0.209],
    );
  }
  if (o.hardhat) {
    hb.push(
      [0.39, 0.14, 0.39, 0xe0b020, 0, 0.37, 0, R(0.42, { b: 0.4, tx: 0.84, tz: 0.84 })],
      [0.42, 0.025, 0.47, 0xd0a018, 0, 0.3, -0.025, R(0.35)],
      [0.05, 0.03, 0.36, 0xf0c838, 0, 0.44, 0, R(0.3)],
    );
  }
  if (glowEyes.length) limb(head, glowEyes, true);
  limb(head, hb);

  // руки: плечо, плечевая часть, локоть, предплечье, манжета, ладонь, пальцы, большой палец
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.36 * W, 1.44, 0); armR.position.set(0.36 * W, 1.44, 0);
  for (const [a, side] of [[armL, -1], [armR, 1]]) {
    const torn = zv === 0 && side > 0;
    const up = o.bare ? skin : sleeve, fore = o.bare || torn ? skin : sleeve;
    const A = [
      [0.19, 0.15, 0.2, up, 0, -0.03, 0, R(0.38)],
      [0.165, 0.28, 0.18, up, 0, -0.2, 0, R(0.28, { tx: 1.06, tz: 1.04 })],
      [0.155, 0.08, 0.17, o.bare ? skin : dk(sleeve, 0.88), 0, -0.355, 0, R(0.32)],
      [0.15, 0.17, 0.16, fore, 0, -0.45, 0, R(0.28, { tx: 1.06, tz: 1.05 })],
      [0.125, 0.1, 0.14, skin, 0, -0.6, 0, R(0.28)],
      [0.118, 0.07, 0.128, sk2, 0, -0.675, 0.006, R(0.35)],
      [0.045, 0.085, 0.05, skin, -side * 0.02, -0.61, -0.08, R(0.35)],
    ];
    if (!o.bare && !torn) A.push([0.165, 0.045, 0.175, dk(sleeve, 0.72), 0, -0.535, 0, R(0.3)]);
    if (o.bare) A.push([0.07, 0.03, 0.2, shirt, -side * 0.03, 0.04, 0, R(0.3)]);
    if (torn) A.push([0.17, 0.035, 0.185, dk(sleeve, 0.6), 0, -0.375, 0, R(0.3)], [0.05, 0.08, 0.012, WOUND, 0, -0.46, -0.083]);
    if (o.zombie) A.push([0.12, 0.02, 0.13, dk(skin, 0.55), 0, -0.705, 0.006]);
    if (zv === 2 && side < 0) A.push([0.012, 0.12, 0.07, BLOOD, -0.078, -0.44, 0]);
    if (!o.zombie && side < 0) A.push([0.012, 0.07, 0.09, o.patch ?? 0x3a6ab0, -0.096, -0.1, 0]);
    limb(a, A);
    body.add(a);
  }
  const hand = new THREE.Group();
  hand.position.set(0, -0.62, -0.02);
  armR.add(hand);
  g.userData = { body, head, legL, legR, armL, armR, hand, phase: Math.random() * 6, zombie: !!o.zombie, W, zv };
  return g;
}

// поза: speed — скорость движения, aim — оружие в руках, atk — фаза атаки 0..1
export function animate(g, dt, speed, opts = {}) {
  const u = g.userData;
  u.phase += dt * (2 + speed * 2.2);
  const sw = Math.min(1, speed / 3) * 0.7;
  const s = Math.sin(u.phase);
  u.legL.rotation.x = s * sw;
  u.legR.rotation.x = -s * sw;
  if (u.zombie) {
    const atk = opts.atk || 0;
    const base = 1.35 + Math.sin(u.phase * 0.5) * 0.08;
    u.armL.rotation.x = base - atk * 1.6;
    u.armR.rotation.x = base - atk * 1.6 + Math.sin(u.phase * 0.7) * 0.1;
    u.armL.rotation.z = 0.08; u.armR.rotation.z = -0.08;
    u.body.rotation.x = -0.12;
    u.head.rotation.z = Math.sin(u.phase * 0.4) * 0.15;
  } else if (opts.aim) {
    u.armR.rotation.x = 1.45 + (opts.pitch || 0);
    u.armL.rotation.x = 1.35 + (opts.pitch || 0);
    u.armL.rotation.y = -0.5;
    u.head.rotation.x = (opts.pitch || 0) * 0.6;
  } else {
    u.armL.rotation.x = -s * sw * 0.8;
    u.armR.rotation.x = s * sw * 0.8 + (opts.swing || 0) * 1.8;
    u.armL.rotation.y = 0;
    u.head.rotation.x = (opts.pitch || 0) * 0.6;
  }
  if (opts.crouch) { u.body.position.y = -0.35; u.legL.rotation.x += 0.9; u.legR.rotation.x += 0.9; }
  else u.body.position.y = 0;
}

export const PLAYER_COLORS = [0x3b6fb6, 0xc0392b, 0x2f8f4e, 0xd68910, 0x8e44ad, 0x17a2b8, 0xe0e0e0, 0x333333, 0xc76f9a, 0x7a5a3a];
const SKINS = [0xf1c8a0, 0xe0ac80, 0xc68a5e, 0x8d5a3b];
const HAIRS = [0x3a2a1a, 0x1a1410, 0x8a6a3a, 0x5a3a22, 0xb89060];
const PACKS = [0x5a5a3e, 0x4a4036, 0x3a4a5a];

// как выглядит надетая броня
const ARMOR_LOOK = {
  hardhat: { hardhat: true }, helmet: { helmet: 0x4a5536 },
  jacket: { shirt: 0x5a4030, sleeve: 0x5a4030 }, scrapvest: { vest: 0x7a7f84, vestKind: 'scrap' },
  policevest: { vest: 0x2a3440, vestKind: 'police' }, milvest: { vest: 0x55603e },
  pants: { pants: 0x4a4436 }, greaves: { greaves: 0x7a7f84 }, kneepads: { greaves: 0x2e2e2a },
};

// look — надетая броня «голова,тело,ноги» (id предметов)
export function makePlayerModel(color, skinIdx = 0, look = '') {
  const i = Math.abs(skinIdx | 0);
  const o = {
    skin: SKINS[i % SKINS.length], shirt: color, pants: 0x34405a, shoes: 0x3a2a1e,
    hair: HAIRS[i % HAIRS.length], beard: i % 3 === 1, pack: PACKS[i % PACKS.length], patch: dk(color, 0.7),
  };
  for (const id of String(look).split(',')) if (ARMOR_LOOK[id]) Object.assign(o, ARMOR_LOOK[id]);
  return makeHumanoid(o);
}

// внешность обычных зомби — несколько готовых вариантов (каждый строит геометрию один раз)
const WALKERS = [
  { skin: 0x7d9a6b, shirt: 0x5a4a3a, pants: 0x3a3a44, hair: 0x2a2a20 },
  { skin: 0x8aa078, shirt: 0x6a6a5a, pants: 0x4a4030, hair: 0x4a3a28 },
  { skin: 0x748e66, shirt: 0x4a5a6a, pants: 0x2e3a4a, hair: 0x6a6a60 },
  { skin: 0x7d9a6b, shirt: 0x7a3a3a, pants: 0x3a3a44, hair: 0x1a1a18 },
  { skin: 0x8aa078, shirt: 0x3a4a3a, pants: 0x2e3a4a, hair: null },
  { skin: 0x748e66, shirt: 0x8a7a5a, pants: 0x4a4030, hair: 0x2a2a20 },
];
const rnd = n => Math.floor(Math.random() * n);

export const ZOMBIE_LOOK = {
  walker: () => { const i = rnd(WALKERS.length); return makeHumanoid({ zombie: true, ...WALKERS[i], variant: i % 4, eyes: 0xff3020, eyesGlow: true }); },
  runner: () => makeHumanoid({ zombie: true, skin: 0xa0b090, shirt: 0x6a2a2a, pants: 0x2a2a30, hair: null, bare: true, belt: false, variant: rnd(2) * 2, eyes: 0xffd020, eyesGlow: true, scale: 0.95 }),
  tank: () => zExtras(makeHumanoid({ zombie: true, skin: 0x6a8a5a, shirt: 0x4a4038, pants: 0x30302a, hair: null, belt: false, variant: 3, eyes: 0xff3020, eyesGlow: true, scale: 1.35, wide: 1.4 }), 'tank'),
  soldier: () => makeHumanoid({ zombie: true, skin: 0x7a9070, shirt: 0x55603e, sleeve: 0x4a5536, pants: 0x4a5536, shoes: 0x2a2620, helmet: 0x3e4a2e, vest: 0x5a6440, variant: rnd(4), eyes: 0xff3020, eyesGlow: true }),
  // боссы
  butcher: () => zExtras(makeHumanoid({ zombie: true, skin: 0x8a6a5a, shirt: 0xd8d0c0, sleeve: 0x8a6a5a, pants: 0x3a3028, hair: null, variant: 2, eyes: 0xffe020, eyesGlow: true, scale: 2.1, wide: 1.5 }), 'butcher'),
  screamer: () => zExtras(makeHumanoid({ zombie: true, skin: 0xc8c8b0, shirt: 0x4a2a5a, pants: 0x2a1a30, hair: 0xe0e0e0, belt: false, variant: 1, eyes: 0x60ff60, eyesGlow: true, scale: 1.6 }), 'screamer'),
  leaper: () => zExtras(makeHumanoid({ zombie: true, skin: 0x6a8a4a, shirt: 0x3a4a2a, pants: 0x2a3a20, hair: null, bare: true, variant: 0, eyes: 0xff3020, eyesGlow: true, scale: 1.75 }), 'leaper'),
};

// особые детали: брюхо и опухоли танка, фартук и тесак мясника, волосы и платье крикуньи, шипы и когти прыгуна
function zExtras(g, kind) {
  const u = g.userData, W = u.W;
  const claws = (hex, n, len) => {
    for (const a of [u.armL, u.armR]) {
      const C = [];
      for (let i = 0; i < n; i++) C.push([0.022, len, 0.03, hex, (i - (n - 1) / 2) * 0.04, -0.71 - len * 0.4, -0.02, R(0.3, { tx: 0.15, tz: 0.15, rx: Math.PI - 0.35 })]);
      limb(a, C);
    }
  };
  if (kind === 'tank') {
    limb(u.body, [
      [0.4 * W, 0.3, 0.12, dk(0x6a8a5a, 0.95), 0, 1.05, -0.17 * W, R(0.45, { b: 0.4 })],
      [0.06, 0.05, 0.03, WOUND, 0.08, 1.0, -0.235 * W],
      [0.14, 0.12, 0.1, 0x8aa070, 0.2 * W, 1.42, -0.06, R(0.45, { b: 0.45 })],
      [0.1, 0.09, 0.08, 0x8aa070, -0.12 * W, 1.18, 0.16 * W, R(0.45, { b: 0.45 })],
      [0.16 * W, 0.4, 0.02, STRAP, 0.12 * W, 1.2, -0.158 * W],
    ]);
    limb(u.head, [[0.12, 0.09, 0.1, 0x8aa070, 0.08, 0.34, 0.06, R(0.45, { b: 0.45 })]]);
  } else if (kind === 'butcher') {
    limb(u.body, [
      [0.48 * W, 0.66, 0.03, 0xcfc6b4, 0, 1.08, -0.162 * W, R(0.1)],
      [0.26 * W, 0.24, 0.034, 0x7a1616, 0.05, 1.0, -0.163 * W],
      [0.14 * W, 0.16, 0.034, 0x8a1c1c, -0.1, 1.28, -0.163 * W],
      [0.04, 0.2, 0.034, 0x7a1616, 0.12, 0.82, -0.163 * W], [0.03, 0.14, 0.034, 0x7a1616, -0.06, 0.85, -0.163 * W],
      [0.035, 0.03, 0.31 * W, STRAP, -0.13, 1.48, 0], [0.035, 0.03, 0.31 * W, STRAP, 0.13, 1.48, 0],
      [0.55 * W, 0.04, 0.31 * W, STRAP, 0, 1.12, 0, R(0.25)],
      [0.016, 0.1, 0.016, 0x9aa0a6, -0.24 * W, 0.86, -0.08], [0.05, 0.016, 0.016, 0x9aa0a6, -0.228 * W, 0.81, -0.08],
      [0.016, 0.1, 0.016, 0x9aa0a6, -0.26 * W, 0.86, 0.02], [0.05, 0.016, 0.016, 0x9aa0a6, -0.248 * W, 0.81, 0.02],
    ]);
    limb(u.head, [[0.02, 0.012, 0.3, 0x3a1414, 0.04, 0.352, 0], [0.07, 0.014, 0.012, 0x3a1414, 0.04, 0.353, -0.1],
      [0.07, 0.014, 0.012, 0x3a1414, 0.04, 0.353, -0.03], [0.07, 0.014, 0.012, 0x3a1414, 0.04, 0.353, 0.04], [0.07, 0.014, 0.012, 0x3a1414, 0.04, 0.353, 0.11]]);
    limb(u.hand, [
      [0.05, 0.2, 0.05, 0x3a2a1e, 0, -0.1, 0, R(0.35)],
      [0.054, 0.012, 0.012, 0xb8bcc0, 0, -0.06, 0], [0.054, 0.012, 0.012, 0xb8bcc0, 0, -0.13, 0],
      [0.055, 0.03, 0.055, 0xb8bcc0, 0, -0.21, 0, R(0.3)],
      [0.022, 0.2, 0.34, 0xb8bcc0, 0, -0.33, -0.1],
      [0.026, 0.035, 0.34, 0xe0e4e8, 0, -0.43, -0.1],
      [0.028, 0.07, 0.12, 0x7a1616, 0, -0.39, -0.19],
      [0.03, 0.035, 0.035, 0x1a1a1a, 0, -0.26, -0.22],
    ]);
  } else if (kind === 'screamer') {
    const hw = 0xe0e0d8, hw2 = 0xd0d0c8;
    limb(u.head, [
      [0.39, 0.52, 0.1, hw, 0, 0.08, 0.17, R(0.3)],
      [0.06, 0.44, 0.09, hw, -0.18, 0.1, 0.03, R(0.3)], [0.06, 0.44, 0.09, hw2, 0.18, 0.1, 0.03, R(0.3)],
      [0.05, 0.3, 0.03, hw2, -0.11, 0.16, -0.18, R(0.3)], [0.04, 0.24, 0.03, hw, 0.12, 0.19, -0.18, R(0.3)],
      [0.14, 0.12, 0.02, 0x1a0606, 0, 0.065, -0.168],
      [0.12, 0.016, 0.014, 0xcfc6a6, 0, 0.118, -0.172], [0.1, 0.016, 0.014, 0xcfc6a6, 0, 0.012, -0.17],
    ]);
    const S = [[0.54, 0.46, 0.34, 0x3a1e48, 0, 0.62, 0, R(0.25, { tx: 0.85, tz: 0.85 })]];
    for (const x of [-0.2, -0.07, 0.07, 0.2]) S.push([0.07, 0.12, 0.02, 0x2e1838, x, 0.36, -0.165], [0.07, 0.1, 0.02, 0x2e1838, x + 0.03, 0.37, 0.165]);
    limb(u.body, S);
    claws(0xd8d0b8, 3, 0.11);
  } else {
    const sp = [];
    for (let i = 0; i < 6; i++) sp.push([0.07 - i * 0.005, 0.2, 0.07, BONE, 0, 1.48 - i * 0.11, 0.2 * W, R(0.3, { tx: 0.08, tz: 0.08, rx: 0.9 })]);
    limb(u.body, sp);
    for (const a of [u.armL, u.armR]) limb(a, [[0.05, 0.14, 0.05, BONE, 0, -0.33, 0.12, R(0.3, { tx: 0.1, tz: 0.1, rx: 1.4 })]]);
    limb(u.head, [
      [0.22, 0.09, 0.12, dk(0x6a8a4a, 0.9), 0, 0.06, -0.19, R(0.3)],
      [0.025, 0.06, 0.025, BONE, -0.06, 0.0, -0.235, R(0.3, { tx: 0.1, tz: 0.1, rx: Math.PI })],
      [0.025, 0.06, 0.025, BONE, 0.06, 0.0, -0.235, R(0.3, { tx: 0.1, tz: 0.1, rx: Math.PI })],
    ]);
    claws(0xd8d0b8, 3, 0.15);
  }
  return g;
}

// ---------- предметы ----------
const W = 0x1e1e1e, W2 = 0x2c2c2c, W3 = 0x3a3a3a, HOLE = 0x070707, WOOD = 0x8a5a32, WOOD2 = 0x6e4426,
  STEEL = 0xa8acb0, STEEL2 = 0x7a7e82, EDGE = 0xdfe3e7, BRASS = 0xc8a040, COPPER = 0xb87040;

// спусковой крючок со скобой; z — положение крючка, y — низ ствольной коробки
function trigger(g, z, y) {
  part(g, 0.008, 0.03, 0.008, W, 0, y - 0.012, z - 0.032);
  part(g, 0.008, 0.007, 0.054, W, 0, y - 0.028, z - 0.006);
  part(g, 0.006, 0.024, 0.007, W3, 0, y - 0.01, z, -0.35);
}

// пистолетная рукоять с наклоном назад; (y, z) — верх рукояти
function grip(g, y, z, hex, len = 0.11, w = 0.032, d = 0.05, rake = 0.28) {
  const s = sub(g, 0, y, z, -rake);
  rp(s, w, len, d, hex, 0, -len / 2, 0, { c: 0.3 });
  for (let i = 0; i < 4; i++) part(s, w + 0.003, 0.004, d * 0.7, dk(hex, 0.6), 0, -0.025 - i * len * 0.18, 0.002);
  return s;
}

function ammo(g, box, band, n, bul, tip, r, h) {
  rp(g, 0.12, 0.075, 0.09, box, 0, 0, 0, { c: 0.1, b: 0.05 });
  part(g, 0.124, 0.022, 0.094, dk(box, 0.72), 0, 0.028, 0);
  part(g, 0.06, 0.035, 0.094, band, 0, -0.006, 0);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * r * 2.4;
    cyl(g, r, h, bul, x, 0.04 + h / 2, 0.01);
    cyl(g, r * 1.05, h * 0.12, dk(bul, 0.8), x, 0.04 + h * 0.06, 0.01);
    if (tip) part(g, r, h * 0.45, r, tip, x, 0.04 + h + h * 0.22, 0.01, 0, 0, 0, CONE8);
  }
}

// жилет / куртка: корпус, вырез, лямки; kind — подсумки, заклёпки, надпись или рукава
function vestModel(g, c, kind) {
  rp(g, 0.2, 0.22, 0.08, c, 0, 0, 0, { c: 0.2 });
  part(g, 0.07, 0.045, 0.084, 0x1c1f22, 0, 0.09, 0);
  for (const x of [-0.07, 0.07]) rp(g, 0.05, 0.03, 0.085, c, x, 0.115, 0, { c: 0.3 });
  if (kind === 'jacket') {
    for (const s of [-1, 1]) rp(g, 0.06, 0.2, 0.07, c, s * 0.125, -0.01, 0, { c: 0.35, rz: s * 0.22 });
    part(g, 0.008, 0.18, 0.084, 0x8a8e92, 0, -0.02, 0);
    rp(g, 0.09, 0.03, 0.085, dk(c, 0.8), 0, 0.1, 0, { c: 0.4 });
    return;
  }
  for (const x of [-0.06, 0, 0.06]) rp(g, 0.05, 0.06, 0.025, dk(c, 0.8), x, -0.055, -0.05, { c: 0.2 });
  if (kind === 'scrap') for (const [x, y] of [[-0.08, 0.06], [0.08, 0.06], [-0.08, -0.09], [0.08, -0.09], [0, 0.03]]) part(g, 0.014, 0.014, 0.086, 0xb8bcc0, x, y, 0);
  if (kind === 'police') part(g, 0.15, 0.03, 0.084, 0xe8e8e0, 0, 0.03, 0);
}

// поножи / наколенники: две пары щитков с ремешками
function padsModel(g, c) {
  for (const x of [-0.05, 0.05]) {
    rp(g, 0.07, 0.07, 0.035, c, x, 0.05, 0, { c: 0.4 });
    rp(g, 0.06, 0.12, 0.028, dk(c, 0.88), x, -0.055, 0.004, { c: 0.3 });
    part(g, 0.074, 0.012, 0.04, STRAP, x, 0.0, 0.004);
  }
}

function axeLike(g, handle, head, edge, pick) {
  rz(g, 0.03, 0.66, 0.034, handle, 0, 0, -0.2);
  for (let i = 0; i < 4; i++) part(g, 0.036, 0.038, 0.014, dk(handle, 0.6), 0, 0, 0.06 + i * 0.018);
  part(g, 0.038, 0.04, 0.02, dk(handle, 0.8), 0, 0, 0.13);
  if (pick) {
    rp(g, 0.045, 0.055, 0.055, dk(head, 0.8), 0, 0, -0.48, { c: 0.3 });
    rp(g, 0.032, 0.21, 0.04, head, 0, 0.12, -0.47, { c: 0.25, tx: 0.3, tz: 0.25, rx: 0.25 });
    rp(g, 0.032, 0.2, 0.04, head, 0, -0.12, -0.47, { c: 0.25, tx: 0.7, tz: 0.15, rx: Math.PI - 0.25 });
    part(g, 0.008, 0.02, 0.012, edge, 0, 0.22, -0.445);
  } else {
    rp(g, 0.042, 0.065, 0.065, dk(head, 0.8), 0, 0, -0.46, { c: 0.3 });
    rp(g, 0.024, 0.12, 0.07, head, 0, 0.085, -0.46, { c: 0.1, b: 0.05, tx: 0.35, tz: 1.9 });
    part(g, 0.008, 0.012, 0.13, edge, 0, 0.148, -0.46);
    part(g, 0.04, 0.03, 0.05, dk(head, 0.7), 0, -0.045, -0.46);
  }
  part(g, 0.036, 0.04, 0.03, 0x4a3a28, 0, 0, -0.41);
}

const BUILD = {
  pistol(g) {
    rp(g, 0.034, 0.042, 0.215, W2, 0, 0.032, -0.06, { c: 0.2, b: 0.12 });
    for (let i = 0; i < 5; i++) part(g, 0.037, 0.028, 0.004, W, 0, 0.034, 0.014 + i * 0.008);
    part(g, 0.005, 0.016, 0.044, HOLE, 0.016, 0.042, -0.052);
    part(g, 0.006, 0.012, 0.012, W, 0, 0.058, -0.154);
    part(g, 0.008, 0.012, 0.012, W, -0.009, 0.058, 0.03); part(g, 0.008, 0.012, 0.012, W, 0.009, 0.058, 0.03);
    cylZ(g, 0.011, 0.014, W, 0, 0.03, -0.172);
    cylZ(g, 0.0065, 0.004, HOLE, 0, 0.03, -0.179);
    rp(g, 0.031, 0.026, 0.165, W, 0, 0.0, -0.052, { c: 0.2 });
    part(g, 0.027, 0.009, 0.055, W, 0, -0.016, -0.11);
    for (let i = 0; i < 3; i++) part(g, 0.029, 0.004, 0.005, W3, 0, -0.016, -0.128 + i * 0.018);
    trigger(g, -0.01, -0.012);
    const gr = grip(g, -0.008, 0.032, W, 0.115, 0.031, 0.05);
    rp(gr, 0.035, 0.075, 0.036, 0x2a2420, 0, -0.058, 0.002, { c: 0.3 });
    part(gr, 0.034, 0.012, 0.054, W2, 0, -0.117, 0.002);
    part(g, 0.012, 0.016, 0.012, W, 0, 0.052, 0.05, -0.4);
    part(g, 0.004, 0.012, 0.018, W3, -0.017, 0.004, -0.02);
  },
  smg(g) {
    rp(g, 0.05, 0.072, 0.3, W2, 0, 0.0, -0.07, { c: 0.25, b: 0.15 });
    part(g, 0.026, 0.012, 0.2, W, 0, 0.042, -0.06);
    for (let i = 0; i < 6; i++) part(g, 0.028, 0.006, 0.006, W3, 0, 0.046, -0.15 + i * 0.03);
    part(g, 0.032, 0.03, 0.022, W, 0, 0.056, 0.05);
    cyl(g, 0.016, 0.034, W, 0, 0.072, 0.05, 0, 0, PI2);
    part(g, 0.006, 0.03, 0.02, W, -0.012, 0.055, -0.205); part(g, 0.006, 0.03, 0.02, W, 0.012, 0.055, -0.205);
    part(g, 0.004, 0.02, 0.008, W, 0, 0.05, -0.205);
    rp(g, 0.058, 0.058, 0.13, 0x262626, 0, -0.006, -0.17, { c: 0.38 });
    for (let i = 0; i < 4; i++) part(g, 0.06, 0.04, 0.006, W, 0, -0.006, -0.215 + i * 0.03);
    cylZ(g, 0.012, 0.13, W, 0, 0.005, -0.3);
    cylZ(g, 0.017, 0.035, W2, 0, 0.005, -0.355);
    cylZ(g, 0.007, 0.004, HOLE, 0, 0.005, -0.374);
    cylZ(g, 0.011, 0.16, W2, 0, 0.03, -0.17);
    part(g, 0.03, 0.01, 0.012, W3, -0.024, 0.03, -0.2);
    part(g, 0.005, 0.018, 0.05, HOLE, 0.026, 0.014, -0.06);
    part(g, 0.04, 0.03, 0.065, W2, 0, -0.045, -0.09);
    const mg = sub(g, 0, -0.055, -0.09, 0.14);
    rp(mg, 0.03, 0.16, 0.05, W, 0, -0.08, 0, { c: 0.25 });
    for (let i = 0; i < 3; i++) part(mg, 0.032, 0.006, 0.04, W3, 0, -0.04 - i * 0.04, 0);
    part(mg, 0.034, 0.012, 0.056, W2, 0, -0.163, 0);
    trigger(g, 0.0, -0.036);
    grip(g, -0.03, 0.04, W, 0.11, 0.034, 0.05);
    part(g, 0.004, 0.012, 0.014, W3, -0.026, -0.01, 0.02);
    part(g, 0.052, 0.06, 0.02, W, 0, -0.005, 0.088);
    part(g, 0.008, 0.008, 0.2, W3, -0.018, 0.0, 0.19); part(g, 0.008, 0.008, 0.2, W3, 0.018, 0.0, 0.19);
    rp(g, 0.05, 0.09, 0.018, W, 0, -0.02, 0.29, { c: 0.3 });
  },
  shotgun(g) {
    // помповое ружьё: ствол с вентилируемой планкой, подствольный магазин, деревянные помпа и приклад
    const S1 = 0x26282a, S2 = 0x34373a, WD = 0x6e4426, WD2 = 0x4e2e16, WDL = 0x7e5030;
    cylZ(g, 0.019, 0.58, S1, 0, 0.032, -0.4, CYL12);
    cylZ(g, 0.0205, 0.016, S2, 0, 0.032, -0.684, CYL12);
    cylZ(g, 0.013, 0.004, HOLE, 0, 0.032, -0.693, CYL12);
    part(g, 0.011, 0.005, 0.56, S1, 0, 0.0565, -0.4);
    for (let i = 0; i < 9; i++) part(g, 0.006, 0.006, 0.01, S1, 0, 0.0525, -0.66 + i * 0.065);
    part(g, 0.008, 0.008, 0.008, BRASS, 0, 0.064, -0.676, 0, 0, 0, ICO1);
    part(g, 0.005, 0.005, 0.005, 0xd8d8d0, 0, 0.061, -0.38, 0, 0, 0, ICO1);
    cylZ(g, 0.0155, 0.47, S1, 0, -0.012, -0.345, CYL12);
    cylZ(g, 0.017, 0.03, S2, 0, -0.012, -0.595, CYL12);
    for (const z of [-0.587, -0.603]) cylZ(g, 0.0175, 0.003, S1, 0, -0.012, z, CYL12);
    part(g, 0.004, 0.02, 0.016, S2, 0, -0.033, -0.597);
    rp(g, 0.046, 0.066, 0.016, S2, 0, 0.012, -0.555, { c: 0.4 });
    rz(g, 0.056, 0.2, 0.054, WD, 0, -0.014, -0.33, { c: 0.42 });
    for (let i = 0; i < 9; i++) rz(g, 0.058, 0.006, 0.056, WD2, 0, -0.014, -0.415 + i * 0.021, { c: 0.42 });
    for (const x of [-0.021, 0.021]) part(g, 0.004, 0.008, 0.2, S2, x, 0.0, -0.19);
    rp(g, 0.058, 0.08, 0.2, S1, 0, 0.012, 0, { c: 0.2, b: 0.25 });
    part(g, 0.06, 0.004, 0.16, S2, 0, 0.012, 0);
    part(g, 0.003, 0.028, 0.07, HOLE, 0.029, 0.026, -0.015);
    part(g, 0.003, 0.01, 0.05, 0x8a8e92, 0.0305, 0.034, -0.015);
    cylZ(g, 0.0075, 0.035, 0xb02020, 0.026, 0.019, -0.02);
    cylZ(g, 0.0078, 0.008, BRASS, 0.026, 0.019, 0.001);
    part(g, 0.03, 0.004, 0.08, HOLE, 0, -0.028, -0.01);
    rp(g, 0.042, 0.032, 0.13, 0x3a3d40, 0, -0.035, 0.03, { c: 0.3 });
    cyl(g, 0.006, 0.064, S2, 0, -0.024, 0.075, 0, 0, PI2);
    part(g, 0.008, 0.032, 0.008, S1, 0, -0.058, 0.008, 0.25);
    part(g, 0.008, 0.007, 0.056, S1, 0, -0.073, 0.04);
    part(g, 0.008, 0.028, 0.008, S1, 0, -0.06, 0.07, -0.3);
    part(g, 0.006, 0.026, 0.007, W3, 0, -0.05, 0.036, -0.3);
    const st = sub(g, 0, -0.008, 0.1, 0.13);
    rz(st, 0.044, 0.13, 0.064, WD, 0, -0.016, 0.065, { c: 0.42, tz: 1.15 });
    for (let i = 0; i < 4; i++) rz(st, 0.046, 0.005, 0.067, WD2, 0, -0.016, 0.03 + i * 0.022, { c: 0.42 });
    rz(st, 0.05, 0.22, 0.075, WDL, 0, -0.03, 0.235, { c: 0.38, tx: 1.08, tz: 1.75 });
    rz(st, 0.054, 0.024, 0.135, 0x1a1a1a, 0, -0.03, 0.357, { c: 0.4 });
    part(st, 0.006, 0.014, 0.01, S2, 0, -0.098, 0.3);
  },
  rifle(g) {
    rp(g, 0.054, 0.072, 0.36, W2, 0, 0.0, -0.03, { c: 0.15 });
    rp(g, 0.05, 0.03, 0.31, W3, 0, 0.044, 0.0, { c: 0.45, b: 0.3 });
    part(g, 0.032, 0.026, 0.05, W, 0, 0.045, -0.205);
    part(g, 0.026, 0.006, 0.075, W, 0, 0.061, -0.18);
    part(g, 0.005, 0.02, 0.085, HOLE, 0.027, 0.018, -0.03);
    part(g, 0.032, 0.012, 0.016, W3, 0.04, 0.022, -0.11);
    part(g, 0.004, 0.012, 0.12, W, 0.029, -0.002, -0.02);
    rp(g, 0.062, 0.056, 0.2, WOOD, 0, -0.008, -0.32, { c: 0.38 });
    part(g, 0.064, 0.008, 0.17, WOOD2, 0, -0.012, -0.32);
    rp(g, 0.042, 0.03, 0.17, WOOD, 0, 0.04, -0.3, { c: 0.45, b: 0.3 });
    cylZ(g, 0.011, 0.06, W, 0, 0.044, -0.41);
    part(g, 0.03, 0.036, 0.03, W, 0, 0.03, -0.44);
    cylZ(g, 0.012, 0.26, W, 0, 0.012, -0.52);
    part(g, 0.006, 0.006, 0.24, W3, 0, -0.012, -0.52);
    part(g, 0.022, 0.016, 0.03, W, 0, 0.022, -0.6);
    part(g, 0.004, 0.035, 0.01, W, -0.009, 0.045, -0.6); part(g, 0.004, 0.035, 0.01, W, 0.009, 0.045, -0.6);
    part(g, 0.003, 0.03, 0.006, W, 0, 0.042, -0.6);
    cylZ(g, 0.016, 0.055, W2, 0, 0.012, -0.665);
    part(g, 0.01, 0.006, 0.03, HOLE, 0, 0.027, -0.665);
    cylZ(g, 0.007, 0.004, HOLE, 0, 0.012, -0.694);
    part(g, 0.004, 0.02, 0.012, W, 0, -0.04, -0.045);
    const m1 = sub(g, 0, -0.035, -0.1, 0.16);
    rp(m1, 0.034, 0.1, 0.075, 0x7a3a1e, 0, -0.05, 0, { c: 0.2 });
    for (let i = 0; i < 2; i++) part(m1, 0.036, 0.006, 0.06, 0x5a2a14, 0, -0.03 - i * 0.035, 0);
    const m2 = sub(m1, 0, -0.098, 0, 0.26);
    rp(m2, 0.034, 0.1, 0.072, 0x7a3a1e, 0, -0.045, 0, { c: 0.2 });
    part(m2, 0.036, 0.006, 0.058, 0x5a2a14, 0, -0.035, 0);
    part(m2, 0.037, 0.012, 0.078, W, 0, -0.095, 0);
    trigger(g, -0.02, -0.036);
    grip(g, -0.03, 0.04, 0x3a2418, 0.11, 0.038, 0.055);
    const st = sub(g, 0, -0.008, 0.15, 0.1);
    rp(st, 0.05, 0.068, 0.12, WOOD, 0, -0.006, 0.06, { c: 0.38 });
    rp(st, 0.055, 0.12, 0.16, WOOD, 0, -0.03, 0.18, { c: 0.32 });
    part(st, 0.058, 0.125, 0.012, W, 0, -0.03, 0.266);
    part(st, 0.012, 0.014, 0.014, W3, 0, -0.095, 0.2);
  },
  asval(g) {
    // АС «Вал»: коробка с крышкой, цельный глушитель с цевьём, магазин на 20, скелетный приклад
    const C1 = 0x2a2c2a, C2 = 0x1c1d1c, C3 = 0x343734, PL = 0x2b2620, SL = 0x14120e;
    rp(g, 0.05, 0.068, 0.27, C1, 0, 0, -0.035, { c: 0.22, b: 0.2 });
    rz(g, 0.046, 0.25, 0.024, C3, 0, 0.042, -0.03, { c: 0.45, b: 0.35 });
    for (const z of [-0.12, 0.05]) for (const x of [-0.026, 0.026]) cyl(g, 0.005, 0.004, C3, x, 0.008, z, 0, 0, PI2);
    part(g, 0.004, 0.022, 0.07, HOLE, 0.026, 0.016, -0.03);
    part(g, 0.032, 0.012, 0.012, W3, 0.04, 0.02, -0.12);
    part(g, 0.012, 0.018, 0.016, W3, 0.056, 0.02, -0.12);
    part(g, 0.004, 0.016, 0.12, C2, 0.0275, -0.006, 0, 0.08);
    part(g, 0.009, 0.026, 0.13, C2, -0.03, 0.012, -0.05);
    // глушитель и цевьё с прорезями
    cylZ(g, 0.033, 0.4, C2, 0, 0.012, -0.37, CYL12);
    part(g, 0.033, 0.03, 0.033, C2, 0, 0.012, -0.585, -PI2, 0, 0, FRUST);
    cylZ(g, 0.011, 0.004, HOLE, 0, 0.012, -0.601, CYL12);
    for (const z of [-0.335, -0.545]) cylZ(g, 0.035, 0.012, C3, 0, 0.012, z, CYL12);
    cylZ(g, 0.038, 0.15, PL, 0, 0.012, -0.255, CYL12);
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) part(g, 0.006, 0.012, 0.022, SL, s * 0.036, 0.012, -0.3 + i * 0.032);
      part(g, 0.012, 0.006, 0.022, SL, 0, -0.025, -0.3 + i * 0.032);
    }
    // прицельные приспособления: целик на коробке, мушка с ушками у дула
    rp(g, 0.026, 0.02, 0.04, C2, 0, 0.06, -0.15, { c: 0.2 });
    for (const x of [-0.008, 0.008]) part(g, 0.007, 0.014, 0.006, C2, x, 0.076, -0.134);
    rp(g, 0.018, 0.016, 0.026, C2, 0, 0.05, -0.54, { c: 0.25 });
    part(g, 0.004, 0.02, 0.005, C2, 0, 0.066, -0.54);
    for (const x of [-0.009, 0.009]) part(g, 0.004, 0.022, 0.016, C2, x, 0.064, -0.54);
    // магазин на 20 патронов
    part(g, 0.04, 0.03, 0.06, C1, 0, -0.045, -0.1);
    part(g, 0.004, 0.022, 0.012, C2, 0, -0.045, -0.062);
    const m1 = sub(g, 0, -0.058, -0.1, 0.08);
    rp(m1, 0.03, 0.08, 0.062, C2, 0, -0.04, 0, { c: 0.22 });
    for (let i = 0; i < 2; i++) part(m1, 0.032, 0.006, 0.048, C3, 0, -0.022 - i * 0.03, 0);
    const m2 = sub(m1, 0, -0.078, 0, 0.12);
    rp(m2, 0.03, 0.06, 0.06, C2, 0, -0.03, 0, { c: 0.22 });
    rp(m2, 0.034, 0.012, 0.066, C1, 0, -0.064, 0, { c: 0.3 });
    // спуск, рукоять
    trigger(g, 0.0, -0.034);
    grip(g, -0.03, 0.05, 0x3a2e24, 0.11, 0.036, 0.052);
    // скелетный приклад: шарнир, две тяги, раскос, затыльник с резинкой
    rp(g, 0.05, 0.062, 0.024, C1, 0, -0.004, 0.11, { c: 0.25 });
    cylZ(g, 0.0075, 0.25, C2, 0, 0.026, 0.235);
    cylZ(g, 0.0075, 0.24, C2, 0, -0.036, 0.23);
    part(g, 0.012, 0.012, 0.13, C2, 0, -0.004, 0.24, -0.45);
    rp(g, 0.024, 0.12, 0.026, C2, 0, -0.005, 0.365, { c: 0.35 });
    rp(g, 0.028, 0.124, 0.012, 0x101010, 0, -0.005, 0.382, { c: 0.35 });
  },
  sniper(g) {
    const O = 0x3d4a33, O2 = 0x2f3a28;
    rp(g, 0.055, 0.07, 0.45, O, 0, -0.012, -0.105, { c: 0.32 });
    rp(g, 0.042, 0.04, 0.2, W2, 0, 0.035, -0.05, { c: 0.45, b: 0.3 });
    cylZ(g, 0.012, 0.05, W3, 0, 0.04, 0.07);
    const bh = sub(g, 0.02, 0.035, 0.055, 0, 0, -0.6);
    part(bh, 0.05, 0.008, 0.008, W3, 0.025, 0, 0);
    part(bh, 0.012, 0.012, 0.012, W, 0.052, 0, 0, 0, 0, 0, ICO1);
    // сплошной ствол от коробки до дульного тормоза
    cylZ(g, 0.016, 0.6, W, 0, 0.03, -0.43, CYL12);
    cylZ(g, 0.021, 0.06, W2, 0, 0.03, -0.74, CYL12);
    // оптика
    cylZ(g, 0.02, 0.3, W, 0, 0.1, -0.06, CYL12);
    cylZ(g, 0.03, 0.07, W, 0, 0.1, -0.24, CYL12);
    cylZ(g, 0.033, 0.02, W2, 0, 0.1, -0.27, CYL12);
    cylZ(g, 0.026, 0.05, W, 0, 0.1, 0.11, CYL12);
    cylZ(g, 0.027, 0.004, 0x203040, 0, 0.1, 0.136, CYL12);
    part(g, 0.026, 0.004, 0.026, 0x5a8ac0, 0, 0.1, -0.281, PI2, 0, 0, CYL12, 0x102850);
    cyl(g, 0.012, 0.03, W2, 0, 0.128, -0.06);
    cyl(g, 0.012, 0.03, W2, 0.028, 0.1, -0.06, 0, 0, PI2);
    for (const z of [-0.13, 0.03]) { part(g, 0.046, 0.05, 0.018, W, 0, 0.08, z); part(g, 0.046, 0.012, 0.018, W, 0, 0.122, z); }
    part(g, 0.03, 0.02, 0.2, W, 0, 0.06, -0.05);
    part(g, 0.034, 0.06, 0.07, W, 0, -0.07, -0.06);
    part(g, 0.036, 0.01, 0.074, W2, 0, -0.1, -0.06);
    trigger(g, 0.03, -0.047);
    grip(g, -0.04, 0.085, O, 0.1, 0.04, 0.055, 0.35);
    rp(g, 0.055, 0.14, 0.2, O, 0, -0.03, 0.22, { c: 0.3 });
    rp(g, 0.046, 0.03, 0.12, O2, 0, 0.05, 0.2, { c: 0.4 });
    rp(g, 0.058, 0.145, 0.022, 0x1a1a1a, 0, -0.03, 0.33, { c: 0.3 });
  },
  knife(g) {
    part(g, 0.01, 0.03, 0.15, STEEL, 0, 0.004, -0.125);
    part(g, 0.006, 0.01, 0.15, EDGE, 0, -0.014, -0.125);
    part(g, 0.012, 0.006, 0.09, STEEL2, 0, 0.01, -0.12);
    rp(g, 0.01, 0.06, 0.03, STEEL, 0, -0.003, -0.23, { c: 0.1, tx: 0.6, tz: 0.15, rx: -PI2 });
    part(g, 0.016, 0.05, 0.012, W, 0, -0.002, -0.046);
    rz(g, 0.026, 0.1, 0.034, 0x3a2a1e, 0, -0.002, 0.01);
    for (const z of [-0.015, 0.01, 0.035]) part(g, 0.028, 0.036, 0.006, 0x24180e, 0, -0.002, z);
    rp(g, 0.03, 0.036, 0.016, STEEL, 0, -0.002, 0.066, { c: 0.35 });
  },
  bat(g) {
    cylZ(g, 0.02, 0.3, 0x9a6a3a, 0, 0, 0.05);
    cylZ(g, 0.03, 0.02, 0x9a6a3a, 0, 0, 0.21);
    for (let i = 0; i < 5; i++) cylZ(g, 0.022, 0.025, 0x2a2a2a, 0, 0, 0.17 - i * 0.03);
    part(g, 0.04, 0.16, 0.04, 0xa87240, 0, 0, -0.17, PI2, 0, 0, FRUST);
    cylZ(g, 0.04, 0.42, 0xb07a44, 0, 0, -0.46);
    cylZ(g, 0.036, 0.02, 0x9a6a3a, 0, 0, -0.675);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05, z = -0.5 - (i % 3) * 0.05;
      part(g, 0.006, 0.08, 0.006, STEEL, Math.cos(a) * 0.045, Math.sin(a) * 0.045, z, 0, 0, a - PI2);
    }
  },
  axe(g) { axeLike(g, WOOD, STEEL, EDGE, false); },
  pickaxe(g) { axeLike(g, WOOD, STEEL, EDGE, true); },
  iaxe(g) { axeLike(g, 0x5a3a22, 0x9aa2aa, 0xe8ecf0, false); part(g, 0.044, 0.07, 0.07, 0x4a4e52, 0, 0, -0.46); },
  ipick(g) { axeLike(g, 0x5a3a22, 0x9aa2aa, 0xe8ecf0, true); },
  machete(g) {
    part(g, 0.009, 0.05, 0.34, STEEL, 0, 0.008, -0.23);
    part(g, 0.009, 0.064, 0.09, STEEL, 0, 0.015, -0.44);
    rp(g, 0.009, 0.05, 0.064, STEEL, 0, 0.015, -0.505, { c: 0.05, tx: 1, tz: 0.12, rx: -PI2 });
    part(g, 0.01, 0.01, 0.43, EDGE, 0, -0.016, -0.27);
    part(g, 0.03, 0.06, 0.012, W, 0, 0.0, -0.055);
    rz(g, 0.028, 0.12, 0.04, W, 0, 0, 0.01);
    for (const z of [-0.02, 0.03]) part(g, 0.032, 0.008, 0.008, BRASS, 0, 0, z);
  },
  hammer(g) {
    rz(g, 0.028, 0.42, 0.032, WOOD, 0, 0, -0.08);
    rz(g, 0.034, 0.12, 0.036, 0x2a2a2a, 0, 0, 0.07);
    rp(g, 0.044, 0.07, 0.05, 0x666a6e, 0, 0, -0.3, { c: 0.3 });
    cyl(g, 0.026, 0.05, 0x7a7e82, 0, 0.055, -0.3);
    cyl(g, 0.028, 0.008, 0x9aa0a6, 0, 0.082, -0.3);
    for (const x of [-0.011, 0.011]) rp(g, 0.014, 0.08, 0.03, 0x666a6e, x, -0.065, -0.29, { c: 0.2, tx: 0.5, tz: 0.4, rx: Math.PI - 0.3 });
  },
  hardhat(g) {
    rp(g, 0.2, 0.09, 0.2, 0xe0b020, 0, 0.03, 0, { c: 0.42, b: 0.4, tx: 0.82, tz: 0.82 });
    rp(g, 0.23, 0.014, 0.25, 0xd0a018, 0, -0.012, -0.012, { c: 0.35 });
    rp(g, 0.03, 0.02, 0.19, 0xf0c838, 0, 0.078, 0, { c: 0.3 });
  },
  helmet(g) {
    rp(g, 0.21, 0.1, 0.21, 0x4a5536, 0, 0.03, 0, { c: 0.42, b: 0.4, tx: 0.8, tz: 0.8 });
    rp(g, 0.23, 0.018, 0.23, 0x3e472e, 0, -0.018, 0, { c: 0.35 });
    rp(g, 0.12, 0.03, 0.03, 0x2a2a2a, 0, 0.025, -0.1, { c: 0.3 });
    for (const x of [-0.03, 0.03]) part(g, 0.035, 0.018, 0.008, 0x3a5a6a, x, 0.025, -0.116);
  },
  jacket(g) { vestModel(g, 0x5a4030, 'jacket'); },
  scrapvest(g) { vestModel(g, 0x7a7f84, 'scrap'); },
  policevest(g) { vestModel(g, 0x2a3440, 'police'); },
  milvest(g) { vestModel(g, 0x55603e, 'mil'); },
  pants(g) {
    for (const x of [-0.04, 0.04]) rp(g, 0.07, 0.22, 0.07, 0x4a4436, x, -0.03, 0, { c: 0.3 });
    rp(g, 0.16, 0.04, 0.075, 0x3a3428, 0, 0.09, 0, { c: 0.3 });
    for (const x of [-0.078, 0.078]) part(g, 0.012, 0.06, 0.05, 0x3a3428, x, -0.03, 0);
  },
  greaves(g) { padsModel(g, 0x7a7f84); },
  kneepads(g) { padsModel(g, 0x2e2e2a); },
  a9(g) { ammo(g, 0x6a5a3a, 0xd8d0b8, 3, BRASS, COPPER, 0.008, 0.03); },
  a12(g) { ammo(g, 0xa03030, 0xe8e0d0, 3, 0xb02020, null, 0.014, 0.05); },
  a762(g) { ammo(g, 0x4a5536, 0xd8c060, 3, BRASS, COPPER, 0.008, 0.05); },
  a308(g) { ammo(g, 0x2a3a4a, 0xd8d0b8, 2, BRASS, COPPER, 0.009, 0.065); },
  a939(g) { ammo(g, 0x3a3a2a, 0x8a3030, 3, BRASS, 0x3a3a3a, 0.01, 0.06); },
  bandage(g) {
    cyl(g, 0.05, 0.08, 0xf2f0e8, 0, 0, 0, 0, 0, PI2, CYL12);
    cyl(g, 0.018, 0.082, 0xb8b4a8, 0, 0, 0, 0, 0, PI2);
    for (const x of [-0.025, 0.025]) cyl(g, 0.051, 0.006, 0xd8d4c8, x, 0, 0, 0, 0, PI2, CYL12);
    part(g, 0.07, 0.005, 0.1, 0xeeece2, 0, -0.03, 0.07, -0.5);
  },
  medkit(g) {
    rp(g, 0.2, 0.14, 0.1, 0xf0f0f0, 0, 0, 0, { c: 0.15, b: 0.1 });
    part(g, 0.204, 0.008, 0.104, 0xc8c8c8, 0, 0.03, 0);
    part(g, 0.08, 0.025, 0.104, 0xd03030, 0, -0.01, 0); part(g, 0.025, 0.08, 0.104, 0xd03030, 0, -0.01, 0);
    part(g, 0.012, 0.03, 0.012, 0x3a3a3a, -0.05, 0.085, 0); part(g, 0.012, 0.03, 0.012, 0x3a3a3a, 0.05, 0.085, 0);
    part(g, 0.112, 0.014, 0.016, 0x3a3a3a, 0, 0.1, 0);
    part(g, 0.02, 0.02, 0.106, 0x8a8e92, -0.07, 0.03, 0); part(g, 0.02, 0.02, 0.106, 0x8a8e92, 0.07, 0.03, 0);
  },
  can(g) {
    cyl(g, 0.045, 0.1, 0xb8bcc0, 0, 0, 0, 0, 0, 0, CYL12);
    cyl(g, 0.046, 0.06, 0xc0392b, 0, 0, 0, 0, 0, 0, CYL12);
    cyl(g, 0.047, 0.008, 0xd8dce0, 0, 0.05, 0, 0, 0, 0, CYL12); cyl(g, 0.047, 0.008, 0xd8dce0, 0, -0.05, 0, 0, 0, 0, CYL12);
    part(g, 0.04, 0.02, 0.047, 0xf0e0b0, 0, 0, 0.0);
    part(g, 0.02, 0.004, 0.012, 0xd8dce0, 0.015, 0.056, 0);
  },
  chips(g) {
    rp(g, 0.12, 0.17, 0.04, 0xe8b830, 0, 0, 0, { c: 0.45, b: 0.4 });
    part(g, 0.122, 0.016, 0.02, 0xc89820, 0, 0.083, 0); part(g, 0.122, 0.016, 0.02, 0xc89820, 0, -0.083, 0);
    rp(g, 0.07, 0.06, 0.046, 0xc03020, 0, 0.015, 0, { c: 0.45 });
    part(g, 0.05, 0.012, 0.048, 0xf0f0f0, 0, -0.04, 0);
  },
  mre(g) {
    rp(g, 0.16, 0.1, 0.06, 0x6b7a4f, 0, 0, 0, { c: 0.25, b: 0.2 });
    part(g, 0.1, 0.03, 0.062, 0x3a3a2a, 0, 0.02, 0);
    part(g, 0.06, 0.012, 0.064, 0xe0d8b0, 0, -0.02, 0);
    part(g, 0.162, 0.012, 0.03, 0x5a6a40, 0, 0.052, 0);
  },
  water(g) {
    cyl(g, 0.04, 0.15, 0x6ab0e0, 0, -0.015, 0, 0, 0, 0, CYL12);
    part(g, 0.04, 0.03, 0.04, 0x7abce8, 0, 0.075, 0, 0, 0, 0, FRUST);
    cyl(g, 0.018, 0.02, 0x8ac8f0, 0, 0.095, 0);
    cyl(g, 0.02, 0.025, 0x2a6ab0, 0, 0.112, 0);
    cyl(g, 0.041, 0.05, 0xe8f0f4, 0, -0.01, 0, 0, 0, 0, CYL12);
    cyl(g, 0.0412, 0.02, 0x2a6ab0, 0, -0.01, 0, 0, 0, 0, CYL12);
  },
  soda(g) {
    cyl(g, 0.035, 0.12, 0xc0392b, 0, 0, 0, 0, 0, 0, CYL12);
    cyl(g, 0.036, 0.03, 0xf0f0f0, 0, 0.02, 0, 0, 0, 0, CYL12);
    cyl(g, 0.031, 0.01, 0xc8ccd0, 0, 0.064, 0, 0, 0, 0, CYL12); cyl(g, 0.031, 0.01, 0xc8ccd0, 0, -0.064, 0, 0, 0, 0, CYL12);
    part(g, 0.016, 0.004, 0.01, 0xd8dce0, 0.012, 0.07, 0);
  },
  wood(g) {
    for (const [y, z, c] of [[0, -0.03, 0x8a5a32], [0, 0.07, 0x7a4e2a], [0.08, 0.02, 0x946238]]) {
      cyl(g, 0.05, 0.3, c, 0, y, z, 0, 0, PI2);
      for (const x of [-0.151, 0.151]) cyl(g, 0.042, 0.004, 0xc8a070, x, y, z, 0, 0, PI2);
      cyl(g, 0.016, 0.006, 0xa07848, 0.152, y, z, 0, 0, PI2);
    }
  },
  stone(g) { part(g, 0.12, 0.09, 0.11, 0x8b8b88, 0, 0, 0, 0.3, 0.4, 0, DODE); part(g, 0.05, 0.04, 0.05, 0x7a7a78, 0.07, -0.03, 0.03, 0.5, 0.2, 0, ICO); },
  scrap(g) {
    part(g, 0.16, 0.02, 0.1, 0x7a7f84, 0, 0, 0, 0, 0.3);
    part(g, 0.1, 0.018, 0.08, 0x8a6a4a, 0.02, 0.02, 0.02, 0.1, -0.4);
    part(g, 0.04, 0.12, 0.04, 0x8a5a3a, 0.03, 0.05, 0, 0, 0, 0.4);
    cyl(g, 0.05, 0.03, 0x6a6e72, -0.04, 0.03, 0.02);
    cyl(g, 0.02, 0.032, 0x3a3a3a, -0.04, 0.031, 0.02);
    for (const [x, z] of [[0.06, 0.03], [-0.06, -0.03], [0.05, -0.04]]) cyl(g, 0.008, 0.016, 0xa8acb0, x, 0.016, z, 0, 0, 0, CONE);
  },
  cloth(g) {
    rp(g, 0.16, 0.05, 0.12, 0xd8d0b8, 0, 0, 0, { c: 0.3, b: 0.4 });
    rp(g, 0.15, 0.04, 0.11, 0xb8a888, 0, 0.045, 0, { c: 0.3, b: 0.4 });
    part(g, 0.162, 0.006, 0.004, 0x8a7a5a, 0, 0.0, 0.06);
  },
  b_wood(g) { part(g, 0.16, 0.16, 0.16, 0x9a6a3e); part(g, 0.162, 0.02, 0.162, 0x7a5030, 0, 0.03, 0); part(g, 0.162, 0.02, 0.162, 0x7a5030, 0, -0.04, 0); },
  b_wfloor(g) { part(g, 0.18, 0.04, 0.18, 0xa87a4a); for (const x of [-0.045, 0.045]) part(g, 0.006, 0.042, 0.182, 0x7a5030, x, 0, 0); },
  b_wramp(g) { part(g, 0.16, 0.02, 0.2, 0x9a6a3e, 0, 0.0, 0, 0.7); part(g, 0.16, 0.02, 0.16, 0x7a5030, 0, -0.07, 0); },
  b_door(g) { part(g, 0.12, 0.2, 0.025, 0x7a4f2a); part(g, 0.1, 0.012, 0.028, 0x5a3a1e, 0, 0.05, 0); part(g, 0.1, 0.012, 0.028, 0x5a3a1e, 0, -0.05, 0); part(g, 0.02, 0.02, 0.03, 0xd4a640, 0.04, 0, 0); },
  b_stone(g) { part(g, 0.16, 0.16, 0.16, 0x8f8f8f); part(g, 0.162, 0.008, 0.162, 0x6f6f6f, 0, 0.02, 0); part(g, 0.008, 0.08, 0.162, 0x6f6f6f, 0.02, 0.06, 0); },
  b_metal(g) { part(g, 0.16, 0.16, 0.16, 0x6f7a84); part(g, 0.165, 0.03, 0.165, 0x8a96a0, 0, 0.04, 0); for (const [x, y] of [[-0.06, -0.06], [0.06, -0.06]]) part(g, 0.02, 0.02, 0.166, 0x9aa4ae, x, y, 0); },
  b_spikes(g) { part(g, 0.18, 0.03, 0.18, 0x8a6a40); for (const [x, z] of [[-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05], [0.05, 0.05], [0, 0]]) part(g, 0.025, 0.12, 0.025, 0xc0c4c8, x, 0.07, z, 0, 0, 0, CONE); },
  b_box(g) { part(g, 0.18, 0.12, 0.12, 0xa0783f); part(g, 0.185, 0.02, 0.125, 0x6a4a2a, 0, 0.03, 0); part(g, 0.02, 0.03, 0.01, 0xd4a640, 0, 0.02, -0.065); },
  b_bed(g) { cyl(g, 0.05, 0.18, 0x3f6a9a, 0, 0, 0, 0, 0, PI2); for (const x of [-0.05, 0.05]) cyl(g, 0.052, 0.012, 0x2a2622, x, 0, 0, 0, 0, PI2); },
  b_fire(g) { part(g, 0.04, 0.04, 0.2, 0x6a4a2a, 0, 0, 0, 0, 0.5); part(g, 0.04, 0.04, 0.2, 0x6a4a2a, 0, 0, 0, 0, -0.5); for (let i = 0; i < 6; i++) part(g, 0.03, 0.025, 0.03, 0x7a7672, Math.cos(i) * 0.09, -0.01, Math.sin(i) * 0.09, 0, i, 0, ICO); part(g, 0.06, 0.1, 0.06, 0xff8a20, 0, 0.06, 0, 0, 0, 0, CONE, 0xff6a00); },
  b_wwall(g) { part(g, 0.18, 0.18, 0.03, 0x9f7044); part(g, 0.02, 0.18, 0.035, 0x7a5030, 0, 0, 0); part(g, 0.18, 0.012, 0.034, 0x7a5030, 0, 0.04, 0); },
  b_wwin(g) { part(g, 0.18, 0.18, 0.03, 0x9f7044); part(g, 0.1, 0.07, 0.035, 0x9ccbe0, 0, 0.01, 0); part(g, 0.012, 0.07, 0.037, 0x7a5030, 0, 0.01, 0); },
  b_mdoor(g) { part(g, 0.12, 0.2, 0.025, 0x6a737c); part(g, 0.1, 0.012, 0.028, 0x8a96a0, 0, 0.06, 0); part(g, 0.02, 0.02, 0.03, 0xd4a640, 0.04, 0, 0); },
  b_torch(g) { part(g, 0.02, 0.18, 0.02, 0x6a4a2a); part(g, 0.03, 0.03, 0.03, 0xa89070, 0, 0.08, 0); part(g, 0.035, 0.05, 0.035, 0xff9a2a, 0, 0.11, 0, 0, 0, 0, CONE, 0xff6a00); },
  b_bench(g) { part(g, 0.2, 0.025, 0.11, 0x8a6038, 0, 0.04, 0); part(g, 0.02, 0.08, 0.02, 0x6a4628, -0.08, 0, 0.04); part(g, 0.02, 0.08, 0.02, 0x6a4628, 0.08, 0, -0.04); part(g, 0.02, 0.08, 0.02, 0x6a4628, -0.08, 0, -0.04); part(g, 0.05, 0.02, 0.04, 0x8a8e92, -0.04, 0.06, 0); part(g, 0.012, 0.012, 0.06, 0x5a3a22, 0.05, 0.06, 0, 0, 0.5); },
  b_forge(g) { part(g, 0.16, 0.14, 0.14, 0x7a7672); part(g, 0.06, 0.08, 0.06, 0x6a6662, 0, 0.1, 0); part(g, 0.162, 0.01, 0.142, 0x5a5652, 0, 0.02, 0); part(g, 0.08, 0.05, 0.01, 0xff7a20, 0, -0.02, -0.072, 0, 0, 0, BOX, 0xff4000); },
  b_farm(g) { part(g, 0.2, 0.05, 0.2, 0x7a5232); part(g, 0.18, 0.01, 0.18, 0x4a3220, 0, 0.026, 0); part(g, 0.04, 0.08, 0.04, 0x5a9a3a, 0, 0.06, 0, 0, 0, 0, CONE); part(g, 0.03, 0.06, 0.03, 0x6aaa4a, 0.05, 0.05, 0.04, 0, 0, 0, CONE); },
  b_collector(g) { cyl(g, 0.06, 0.14, 0x6a5a48, 0, 0, 0, 0, 0, 0, CYL12); for (const y of [-0.04, 0.04]) cyl(g, 0.062, 0.01, 0x4a3e30, 0, y, 0, 0, 0, 0, CYL12); part(g, 0.1, 0.05, 0.1, 0x4a6a8a, 0, 0.09, 0, Math.PI, 0, 0, CONE); },
  berries(g) {
    for (const [x, y, z, c] of [[-0.03, 0, 0, 0xc02030], [0.03, 0.01, 0.01, 0x3040a0], [0, 0.05, -0.01, 0xc02030], [0.04, -0.03, 0, 0xc02030], [-0.04, -0.03, 0.02, 0x3040a0], [0, -0.01, 0.03, 0xa01828]]) part(g, 0.04, 0.04, 0.04, c, x, y, z, 0, 0, 0, ICO1);
    part(g, 0.06, 0.01, 0.03, 0x4a8a30, 0, 0.08, 0, 0, 0, 0.3); part(g, 0.05, 0.01, 0.025, 0x3a7a28, -0.03, 0.075, 0.01, 0, 0.8, -0.3);
    part(g, 0.006, 0.05, 0.006, 0x5a4a2a, 0, 0.06, 0);
  },
  potato(g) { rp(g, 0.09, 0.06, 0.07, 0xb08850, 0, 0, 0, { c: 0.45, b: 0.45, ry: 0.4 }); for (const [x, z] of [[0.02, 0.036], [-0.025, 0.03], [0.035, -0.02]]) part(g, 0.008, 0.008, 0.008, 0x7a5a30, x, 0.01, z); },
  bpotato(g) { rp(g, 0.09, 0.06, 0.07, 0x7a5028, 0, 0, 0, { c: 0.45, b: 0.45, ry: 0.4 }); rp(g, 0.05, 0.02, 0.04, 0xf0d070, 0, 0.032, 0, { c: 0.45 }); part(g, 0.06, 0.006, 0.006, 0x3a2410, 0, 0.025, 0.02); },
  stew(g) {
    cyl(g, 0.08, 0.06, 0x5a5e62, 0, 0, 0, 0, 0, 0, CYL12);
    cyl(g, 0.082, 0.01, 0x7a7e82, 0, 0.03, 0, 0, 0, 0, CYL12);
    cyl(g, 0.07, 0.01, 0xa06030, 0, 0.026, 0, 0, 0, 0, CYL12);
    for (const [x, z] of [[0.02, 0.01], [-0.03, -0.02], [0.01, -0.035]]) part(g, 0.016, 0.012, 0.016, 0xe0b060, x, 0.032, z);
    for (const x of [-0.09, 0.09]) part(g, 0.02, 0.012, 0.03, 0x3a3a3a, x, 0.02, 0);
  },
  tea(g) {
    cyl(g, 0.045, 0.09, 0xe8e4da, 0, 0, 0, 0, 0, 0, CYL12);
    cyl(g, 0.04, 0.01, 0x8a5a2a, 0, 0.042, 0, 0, 0, 0, CYL12);
    part(g, 0.012, 0.05, 0.012, 0xe8e4da, 0.058, 0, 0); part(g, 0.02, 0.012, 0.012, 0xe8e4da, 0.05, 0.022, 0); part(g, 0.02, 0.012, 0.012, 0xe8e4da, 0.05, -0.022, 0);
    part(g, 0.046, 0.012, 0.046, 0xc04030, 0, -0.02, 0);
  },
  ore(g) { part(g, 0.13, 0.1, 0.12, 0x5e5a58, 0, 0, 0, 0.3, 0.4, 0, DODE); part(g, 0.05, 0.05, 0.05, 0xb5642a, 0.05, 0.03, 0.03, 0, 0, 0, ICO); part(g, 0.04, 0.04, 0.04, 0x9a4a22, -0.05, 0.02, -0.02, 0, 0, 0, ICO); part(g, 0.03, 0.03, 0.03, 0xc8783a, 0.0, 0.07, -0.03, 0.4, 0, 0, ICO); },
  iron(g) {
    rp(g, 0.16, 0.05, 0.07, 0x9aa2aa, 0, 0, 0, { c: 0.1, b: 0.1, tx: 0.85, tz: 0.8 });
    rp(g, 0.16, 0.05, 0.07, 0x8a9298, 0.02, 0.05, 0.0, { c: 0.1, b: 0.1, tx: 0.85, tz: 0.8 });
    part(g, 0.06, 0.004, 0.03, 0x6a7278, 0.02, 0.076, 0);
  },
  fiber(g) { for (let i = 0; i < 7; i++) part(g, 0.012, 0.18, 0.012, i & 1 ? 0x8aa050 : 0x9ab060, (i - 3) * 0.015, 0, (i % 3 - 1) * 0.01, 0, 0, (i - 3) * 0.1); part(g, 0.08, 0.02, 0.03, 0x7a6a3a, 0, -0.02, 0); },
  trophy(g) {
    part(g, 0.1, 0.12, 0.08, 0x8a1a1a, 0, 0, 0, 0.3, 0.3, 0, ICO1, 0x400000);
    part(g, 0.03, 0.08, 0.03, 0xe8e0c8, 0.05, 0.06, 0, 0, 0, -0.4, CONE);
    part(g, 0.025, 0.07, 0.025, 0xe8e0c8, -0.05, 0.05, 0.01, 0, 0, 0.5, CONE);
    rp(g, 0.12, 0.025, 0.1, 0x3a2a1e, 0, -0.075, 0, { c: 0.3 });
  },
};

const itemCache = new Map();
export function itemModel(id) {
  const key = BUILD[id] ? id : 'scrap';
  let c = itemCache.get(key);
  if (!c) {
    const g = new THREE.Group();
    BUILD[key](g);
    c = bakeParts(g);
    itemCache.set(key, c);
  }
  return fromBaked(c);
}

// ---------- руки от первого лица ----------
// предплечье: запястье, манжета, рукав со складками; локальная ось +Z — от запястья к локтю
function forearm(p, skin, sleeve, x, y, z, rx, ry) {
  const a = sub(p, x, y, z, rx, ry, 0);
  rz(a, 0.052, 0.09, 0.046, skin, 0, 0, 0.035);
  rz(a, 0.078, 0.045, 0.072, dk(sleeve, 0.6), 0, 0, 0.09);
  rz(a, 0.082, 0.4, 0.078, sleeve, 0, 0, 0.31, { c: 0.38, tx: 1.15, tz: 1.12 });
  for (const t of [0.22, 0.55]) rz(a, 0.082 * (1 + 0.15 * t) + 0.006, 0.014, 0.078 * (1 + 0.12 * t) + 0.006, dk(sleeve, 0.82), 0, 0, 0.11 + 0.4 * t, { c: 0.38 });
}

// правая кисть на пистолетной рукояти (рамка наклонена вместе с рукоятью)
function gripHand(p, skin, sleeve, y, z, rake) {
  const h = sub(p, 0, y, z, -rake), s2 = dk(skin, 0.88);
  rp(h, 0.06, 0.085, 0.07, skin, 0.004, -0.055, 0.008, { c: 0.38 });
  for (let i = 0; i < 3; i++) rp(h, 0.062, 0.022, 0.024, s2, 0.004, -0.04 - i * 0.024, -0.03, { c: 0.45 });
  rz(h, 0.018, 0.06, 0.018, skin, 0.022, -0.006, -0.045);
  rz(h, 0.018, 0.055, 0.02, skin, -0.03, -0.014, -0.02);
  forearm(h, skin, sleeve, 0.004, -0.07, 0.04, 0.35 + rake, 0.22);
}

// левая кисть снизу под цевьём: ладонь, пальцы справа, большой палец слева
function supportHand(p, skin, sleeve, y, z) {
  const h = sub(p, 0, y, z), s2 = dk(skin, 0.88);
  rp(h, 0.07, 0.03, 0.085, skin, -0.006, 0, 0, { c: 0.4 });
  for (let i = 0; i < 4; i++) rp(h, 0.018, 0.05, 0.02, s2, 0.034, 0.018, -0.032 + i * 0.021, { c: 0.4 });
  rp(h, 0.018, 0.04, 0.06, skin, -0.04, 0.014, 0.005, { c: 0.4 });
  forearm(h, skin, sleeve, -0.02, -0.01, 0.03, 0.45, -0.6);
}

// кулак вокруг рукояти, идущей вдоль Z
function fistOnHandle(p, skin, sleeve, z) {
  const h = sub(p, 0, 0, z), s2 = dk(skin, 0.88);
  rp(h, 0.062, 0.07, 0.085, skin, 0.006, -0.006, 0, { c: 0.4 });
  for (let i = 0; i < 4; i++) rp(h, 0.02, 0.026, 0.02, s2, -0.026, -0.018, -0.03 + i * 0.02, { c: 0.45 });
  rp(h, 0.022, 0.02, 0.06, skin, -0.016, 0.03, -0.012, { c: 0.4 });
  forearm(h, skin, sleeve, 0.012, -0.03, 0.04, 0.45, 0.25);
}

// раскрытая ладонь под едой, лекарствами и блоками
function palmHand(p, skin, sleeve, y) {
  const h = sub(p, 0.02, y, 0.03), s2 = dk(skin, 0.88);
  rp(h, 0.075, 0.035, 0.09, skin, 0, 0, 0, { c: 0.4 });
  for (let i = 0; i < 4; i++) rp(h, 0.018, 0.03, 0.026, s2, -0.027 + i * 0.018, 0.012, -0.05, { c: 0.4 });
  rp(h, 0.018, 0.035, 0.05, skin, -0.044, 0.016, -0.01, { c: 0.4 });
  forearm(h, skin, sleeve, 0, -0.01, 0.045, 0.5, 0.2);
}

const VM_GRIP = { pistol: [-0.008, 0.032, 0.28], smg: [-0.03, 0.04, 0.28], shotgun: [-0.004, 0.125, 0.95], rifle: [-0.03, 0.04, 0.28], asval: [-0.03, 0.05, 0.28], sniper: [-0.04, 0.085, 0.35] };
const VM_SUPPORT = { smg: [-0.05, -0.17], shotgun: [-0.056, -0.33], rifle: [-0.051, -0.32], asval: [-0.041, -0.26], sniper: [-0.062, -0.22] };
const VM_HANDLE = { knife: 0.01, bat: 0.1, axe: 0.08, pickaxe: 0.08, iaxe: 0.08, ipick: 0.08, machete: 0.01, hammer: 0.07 };

// руки для предмета в руках: оружие держат двумя руками, холодное — кулаком за рукоять
export function makeViewArms(id, cat, skin, sleeve) {
  const g = new THREE.Group();
  if (cat === 'gun') {
    const [y, z, rake] = VM_GRIP[id] || VM_GRIP.rifle;
    gripHand(g, skin, sleeve, y, z, rake);
    const sp = VM_SUPPORT[id];
    if (sp) supportHand(g, skin, sleeve, sp[0], sp[1]);
  } else if (cat === 'melee') fistOnHandle(g, skin, sleeve, VM_HANDLE[id] ?? 0.03);
  else palmHand(g, skin, sleeve, cat === 'block' ? -0.15 : -0.065);
  return bake(g);
}

// кулак в стойке: костяшки, складки пальцев, большой палец поперёк, запястье и рукав
export function makeFist(side, skin, sleeve) {
  const h = new THREE.Group();
  rp(h, 0.1, 0.09, 0.115, skin, 0, 0, 0, { c: 0.22, b: 0.15 });
  for (let i = 0; i < 4; i++) rp(h, 0.026, 0.03, 0.04, dk(skin, 0.92), (i - 1.5) * 0.024, 0.03, -0.048, { c: 0.3, b: 0.2 });
  for (let i = 0; i < 3; i++) part(h, 0.004, 0.05, 0.01, dk(skin, 0.7), (i - 1) * 0.024, -0.012, -0.058);
  rp(h, 0.034, 0.032, 0.075, skin, -side * 0.05, -0.022, -0.022, { c: 0.3 });
  rp(h, 0.085, 0.07, 0.07, skin, 0, -0.012, 0.07, { c: 0.3 });
  forearm(h, skin, sleeve, 0, -0.03, 0.08, 0.62, 0);
  return bake(h);
}

export const GUN_IDS = new Set(['pistol', 'smg', 'shotgun', 'rifle', 'asval', 'sniper', 'knife', 'bat', 'axe', 'pickaxe', 'iaxe', 'ipick', 'machete', 'hammer']);

// иконки: рендер каждой модели в маленький canvas
export function renderIcons(ids) {
  const size = 96;
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(size, size);
  r.setPixelRatio(1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
  const dl = new THREE.DirectionalLight(0xffffff, 2.4);
  dl.position.set(1, 2, 1.5);
  scene.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  const out = {};
  const box = new THREE.Box3(), v = new THREE.Vector3(), c = new THREE.Vector3();
  for (const id of ids) {
    const m = itemModel(id);
    if (GUN_IDS.has(id)) {
      // ствол вправо, лёгкий наклон к камере
      m.rotation.set(0, -Math.PI / 2, 0);
      const wrap = new THREE.Group();
      wrap.add(m);
      wrap.rotation.set(0.35, 0, 0.12);
      scene.add(wrap);
      m.userData.wrap = wrap;
    } else { m.rotation.set(0.5, 0.65, 0); scene.add(m); }
    const obj = m.userData.wrap || m;
    obj.updateMatrixWorld(true);
    box.setFromObject(obj);
    box.getSize(v); box.getCenter(c);
    const rad = Math.max(v.x, v.y, v.z) * 0.62;
    const dist = rad / Math.tan(THREE.MathUtils.degToRad(15)) + 0.05;
    cam.position.set(c.x, c.y, c.z + dist);
    cam.lookAt(c);
    r.render(scene, cam);
    out[id] = r.domElement.toDataURL();
    scene.remove(obj);
  }
  r.dispose();
  r.forceContextLoss?.();
  return out;
}

// ---------- прочее ----------
// мешок с вещами погибшего: завязка, заплатки, лямка
let bagBaked = null;
export function makeBag() {
  if (!bagBaked) {
    const g = new THREE.Group();
    rp(g, 0.6, 0.42, 0.42, 0x6a5232, 0, 0.21, 0, { c: 0.38, b: 0.45, tx: 0.8, tz: 0.8 });
    rp(g, 0.3, 0.12, 0.24, 0x5a4428, 0, 0.46, 0, { c: 0.4, tx: 0.7, tz: 0.7 });
    rp(g, 0.34, 0.04, 0.27, 0x3a2e1c, 0, 0.41, 0, { c: 0.4 });
    rp(g, 0.2, 0.08, 0.16, 0x6a5232, 0, 0.55, 0, { c: 0.45, b: 0.5, tx: 1.4, tz: 1.4 });
    part(g, 0.06, 0.12, 0.02, 0x3a2e1c, 0.12, 0.34, -0.17, 0.3, 0, 0.2);
    part(g, 0.16, 0.14, 0.02, 0x8a7048, -0.12, 0.18, -0.202, 0, 0, 0.1);
    part(g, 0.1, 0.1, 0.02, 0x4a5a3a, 0.16, 0.14, 0.198, 0, 0, -0.15);
    part(g, 0.08, 0.5, 0.02, 0x3a2e1c, -0.25, 0.22, 0, 0, 0, 0.12);
    bagBaked = bakeParts(g);
  }
  return fromBaked(bagBaked);
}

export function makeNameTag(text, color = '#ffffff') {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const x = cv.getContext('2d');
  x.font = '600 30px Rubik, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = Math.min(250, x.measureText(text).width + 24);
  x.fillStyle = 'rgba(10,12,14,0.55)';
  x.fillRect(128 - w / 2, 12, w, 40);
  x.fillStyle = color;
  x.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.scale.set(1.6, 0.4, 1);
  return sp;
}
