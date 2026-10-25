// Low-poly модели: персонажи, зомби, предметы в руках, мешок с лутом. Иконки рендерятся из тех же моделей.
// Детали — боксы и «скруглённые» боксы (восьмигранное сечение, скошенные торцы); у каждой модели
// они сливаются в один меш с цветами вершин, поэтому подробность почти не стоит draw calls.
import * as THREE from 'three';
import { MeshBuilder, lin } from './mesh.js';
import { gunGeo } from './gunmodels.js';
import { characterMaterial } from './textures.js';

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
const CYL = new THREE.CylinderGeometry(1, 1, 1, 48);
const CYL12 = new THREE.CylinderGeometry(1, 1, 1, 64);
const FRUST = new THREE.CylinderGeometry(0.7, 1, 1, 48);
const ICO = new THREE.IcosahedronGeometry(1, 4);
const ICO1 = new THREE.IcosahedronGeometry(1, 5);
const DODE = new THREE.DodecahedronGeometry(1, 3);
const CONE = new THREE.ConeGeometry(1, 1, 32);
const CONE8 = new THREE.ConeGeometry(1, 1, 32);
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
    if ((o.c ?? 0.25) > 0) SMOOTH.add(geo);
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

// выпуклый контур, сдвинутый внутрь на b (для скоса рёбер)
function insetPoly(pts, b) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
  const s = area > 0 ? 1 : -1;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], c = pts[(i + 1) % n];
    let e1z = p[0] - a[0], e1y = p[1] - a[1], e2z = c[0] - p[0], e2y = c[1] - p[1];
    const l1 = Math.hypot(e1z, e1y) || 1, l2 = Math.hypot(e2z, e2y) || 1;
    e1z /= l1; e1y /= l1; e2z /= l2; e2y /= l2;
    const n1z = -e1y * s, n1y = e1z * s, n2z = -e2y * s, n2y = e2z * s;
    const k = Math.max(0.3, 1 + n1z * n2z + n1y * n2y);
    return [p[0] + b * (n1z + n2z) / k, p[1] + b * (n1y + n2y) / k];
  });
}

// деталь по профилю со скошенными рёбрами: выпуклый контур [[z, y], ...] сбоку, толщина w по оси x, скос b
export function bext(parent, pts, w, b, hex, x = 0) {
  const mb = new MeshBuilder(), W = [1, 1, 1], n = pts.length;
  const inner = insetPoly(pts, b);
  const cz = pts.reduce((a, p) => a + p[0], 0) / n, cy = pts.reduce((a, p) => a + p[1], 0) / n, ctr = [x, cy, cz];
  const rings = [[x - w / 2, inner], [x - w / 2 + b, pts], [x + w / 2 - b, pts], [x + w / 2, inner]];
  for (const [xx, P] of [rings[0], rings[3]]) for (let i = 1; i + 1 < n; i++) mb.otri([xx, P[0][1], P[0][0]], [xx, P[i][1], P[i][0]], [xx, P[i + 1][1], P[i + 1][0]], ctr, W);
  for (let r = 0; r < 3; r++) {
    const [x0, A] = rings[r], [x1, B] = rings[r + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      mb.otri([x0, A[i][1], A[i][0]], [x1, B[i][1], B[i][0]], [x1, B[j][1], B[j][0]], ctr, W);
      mb.otri([x0, A[i][1], A[i][0]], [x1, B[j][1], B[j][0]], [x0, A[j][1], A[j][0]], ctr, W);
    }
  }
  const m = new THREE.Mesh(mb.build(), M(hex));
  m.castShadow = true;
  parent.add(m);
  return m;
}

// трубка от точки (z1, y1) до (z2, y2) в плоскости x
function tube(p, z1, y1, z2, y2, r, hex, x = 0) {
  const dz = z2 - z1, dy = y2 - y1;
  return part(p, r, Math.hypot(dz, dy), r, hex, x, (y1 + y2) / 2, (z1 + z2) / 2, Math.atan2(dz, dy), 0, 0, CYL);
}

// деталь по профилю: выпуклый контур [[z, y], ...] сбоку, выдавленный на толщину w по оси x
export function extrude(parent, pts, w, hex, x = 0) {
  const mb = new MeshBuilder(), W = [1, 1, 1], n = pts.length;
  const cz = pts.reduce((a, p) => a + p[0], 0) / n, cy = pts.reduce((a, p) => a + p[1], 0) / n, ctr = [x, cy, cz];
  const x0 = x - w / 2, x1 = x + w / 2;
  for (let i = 1; i + 1 < n; i++) {
    for (const xx of [x0, x1]) mb.otri([xx, pts[0][1], pts[0][0]], [xx, pts[i][1], pts[i][0]], [xx, pts[i + 1][1], pts[i + 1][0]], ctr, W);
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    mb.otri([x0, a[1], a[0]], [x1, a[1], a[0]], [x1, b[1], b[0]], ctr, W);
    mb.otri([x0, a[1], a[0]], [x1, b[1], b[0]], [x0, b[1], b[0]], ctr, W);
  }
  const m = new THREE.Mesh(mb.build(), M(hex));
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function sub(parent, x = 0, y = 0, z = 0, rx = 0, ry = 0, rzz = 0) {
  const s = new THREE.Group();
  s.position.set(x, y, z);
  s.rotation.set(rx, ry, rzz);
  parent.add(s);
  return s;
}

// ---------- слияние деталей ----------
const VC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
// предметы в руках — с лёгким бликом, металл и лак не выглядят матовой пластмассой
const VC_ITEM = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 42, specular: 0x2e2e2e });
const VC_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
// кожа рук от первого лица: мягкий, едва заметный блик
const VC_SKIN = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 16, specular: 0x1e1915 });
const flatCache = new WeakMap();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _na = new THREE.Vector3(), _nb = new THREE.Vector3(), _nc = new THREE.Vector3(), _nm = new THREE.Matrix3();
// цилиндры остаются гладкими (нормали вершин), остальное — гранёное
const SMOOTH = new Set([CYL, CYL12, FRUST]);

function flatGeo(geo) {
  let f = flatCache.get(geo);
  if (!f) { f = geo.index ? geo.toNonIndexed() : geo; flatCache.set(geo, f); }
  return f;
}

function bakeParts(g, facet = 0.06, shiny = false) {
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
    const na = SMOOTH.has(o.geometry) && geo.attributes.normal ? geo.attributes.normal.array : null;
    if (na) {
      _nm.getNormalMatrix(mw);
      for (let i = 0; i < pa.length; i += 9) {
        _a.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(mw);
        _b.set(pa[i + 3], pa[i + 4], pa[i + 5]).applyMatrix4(mw);
        _c.set(pa[i + 6], pa[i + 7], pa[i + 8]).applyMatrix4(mw);
        _na.set(na[i], na[i + 1], na[i + 2]).applyMatrix3(_nm).normalize();
        _nb.set(na[i + 3], na[i + 4], na[i + 5]).applyMatrix3(_nm).normalize();
        _nc.set(na[i + 6], na[i + 7], na[i + 8]).applyMatrix3(_nm).normalize();
        mb.triN(_a, _b, _c, _na, _nb, _nc, base);
      }
      return;
    }
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
  return { geo, glow, shiny };
}

function fromBaked({ geo, glow, shiny }) {
  const out = new THREE.Group();
  if (geo) { const m = new THREE.Mesh(geo, shiny === 'skin' ? VC_SKIN : shiny ? VC_ITEM : VC_MAT); m.castShadow = true; out.add(m); }
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

// материал детали для текстур персонажа: кожа (1) — по цветности, близкой к цвету кожи; кровь, раны, кость, ремни,
// пуговицы (2); остальное — ткань (0)
const OTHER_HEX = new Set([0x5a1212, 0x8a2420, 0xd8cfb4, 0x2a2622, 0xcfc6a6, 0xd8d2c0, 0xc8a040, 0x8a8e92, 0xe8e8e0]);
function partKind(hex, skin) {
  const c = h => { const r = (h >> 16) & 255, g = (h >> 8) & 255, b = h & 255, s = r + g + b || 1; return [r / s, g / s, b / s, s]; };
  const a = c(hex), k = c(skin);
  if (a[3] > 80 && Math.hypot(a[0] - k[0], a[1] - k[1], a[2] - k[2]) < 0.03) return 1;
  return OTHER_HEX.has(hex) ? 2 : 0;
}

// детали: [w, h, d, цвет, x, y, z, o] — без o бокс, с o — скруглённый бокс (MeshBuilder.rbox),
// o.s = 'e' — эллипсоид, o.s = 't' — трубка до точки o.to (w, d — диаметры начала и конца, h — длина).
// skin — цвет кожи персонажа: вершины получают метку материала (o.kind или по цвету)
function limbGeo(parts, glow, lite, skin = null) {
  const tag = skin != null && !glow;
  const key = (glow ? 'g' : '') + (lite ? 'l' : '') + (tag ? 's' + skin : '') + JSON.stringify(parts);
  let geo = limbCache.get(key);
  if (!geo) {
    const mb = new MeshBuilder(glow ? 0 : 0.07, false, tag);
    for (const [w, h, d, hex, x, y, z, o] of parts) {
      const sz = Math.max(w, h, d);
      if (lite && sz < 0.09) continue;
      if (tag) mb.tag = o && o.kind != null ? o.kind : partKind(hex, skin);
      const col = lin(hex), sh = o && o.s;
      if (sh === 'e') mb.ellip(x, y, z, w, h, d, col, lite ? { ...o, q: 8, a: 5 } : sz < 0.05 ? { q: 10, a: 7, ...o } : o);
      else if (sh === 't') mb.tube([x, y, z], o.to, w / 2, d / 2, col, lite ? { ...o, q: 6, n: 2, c: 1 } : o);
      else if (o) {
        const dens = sz < 0.05 ? { q: 4, a: 3 } : sz < 0.1 ? { q: 6, a: 4 } : null;
        mb.rbox(x, y, z, w, h, d, col, lite ? { ...o, c: 0, b: 0 } : dens ? { ...o, ...dens } : o);
      } else mb.box(x - w / 2, y - h / 2, z - d / 2, x + w / 2, y + h / 2, z + d / 2, col);
    }
    geo = mb.build();
    geo.userData.shared = true;
    limbCache.set(key, geo);
  }
  return geo;
}

// материалы персонажей с текстурами кожи и ткани (у зомби — грязь, вены, кровь)
const charMats = {};
function charMat(zombie) { return charMats[zombie] ||= characterMaterial(zombie); }

// ch — { mat, skin }: материал персонажа и цвет кожи (для меток материала); без него — простой материал
function limb(parent, parts, glow = false, ch = null) {
  const skin = ch ? ch.skin : null;
  const geo = limbGeo(parts, glow, false, skin);
  const m = new THREE.Mesh(geo, glow ? VC_GLOW : ch ? ch.mat : VC_MAT);
  m.castShadow = !glow;
  if (!glow) m.userData.lod = [geo, limbGeo(parts, false, true, skin)];
  parent.add(m);
  return m;
}

// переключить персонажа на упрощённую (far) или полную модель
export function setLod(g, far) {
  g.traverse(o => { const l = o.userData.lod; if (l) { o.geometry = l[far ? 1 : 0]; o.castShadow = !far; } });
}

const R = (c, more) => more ? { c, ...more } : { c };
const BLOOD = 0x5a1212, WOUND = 0x8a2420, BONE = 0xd8cfb4, STRAP = 0x2a2622;

// Скелет персонажа (в координатах тела, ступни на y = 0):
// таз (0.9) → позвоночник (0.94) → голова (1.5) с челюстью, плечи (1.44) → локти → кисти;
// таз → бёдра (0.82) → колени (0.4). Детали описаны в координатах старой «цельной» модели и сами
// раскладываются по суставам: что выше колена/локтя/поясницы — на верхний сегмент, ниже — на нижний.
const PELVIS = 0.9, SPINE = 0.94, HEAD = 1.5, SHOULDER = 1.44, HIP = 0.82, KNEE = 0.42, ELBOW = 0.34, JAW_Y = 0.115, JAW_Z = 0.02;
const shift = (p, dy, dz = 0) => { const q = p.slice(); q[5] += dy; q[6] += dz; return q; };

// o: skin, shirt, sleeve, pants, shoes, hair, beard, helmet, hardhat, vest, vestKind, pack, greaves, bare (голые руки), belt,
//    zombie, variant (0..3 — рваная одежда и раны), eyes, eyesGlow, scale, wide
export function makeHumanoid(o) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ'; // поворот по курсу снаружи — падение при смерти идёт вперёд в любую сторону
  const body = new THREE.Group();
  g.add(body);
  const s = o.scale || 1;
  body.scale.setScalar(s);
  const W = o.wide || 1;
  const zv = o.zombie ? (o.variant ?? Math.floor(Math.random() * 4)) : -1;
  const skin = o.skin, sk2 = dk(skin, 0.9), shirt = o.shirt, pants = o.pants, shoes = o.shoes || 0x2a2420;
  const sleeve = o.sleeve ?? shirt;
  const ch = { mat: charMat(!!o.zombie), skin };
  const lb = (p, parts, glow = false) => limb(p, parts, glow, ch);

  // суставы
  const hips = new THREE.Group(); hips.position.y = PELVIS; body.add(hips);
  const spine = new THREE.Group(); spine.position.y = SPINE - PELVIS; hips.add(spine);
  const head = new THREE.Group(); head.position.y = HEAD - SPINE; spine.add(head);
  const jaw = new THREE.Group(); jaw.position.set(0, JAW_Y, JAW_Z); head.add(jaw);
  const legL = new THREE.Group(), legR = new THREE.Group(), kneeL = new THREE.Group(), kneeR = new THREE.Group();
  legL.position.set(-0.13 * W, HIP - PELVIS, 0); legR.position.set(0.13 * W, HIP - PELVIS, 0);
  kneeL.position.y = -KNEE; kneeR.position.y = -KNEE;
  legL.add(kneeL); legR.add(kneeR); hips.add(legL); hips.add(legR);
  const armL = new THREE.Group(), armR = new THREE.Group(), elbowL = new THREE.Group(), elbowR = new THREE.Group();
  armL.position.set(-0.36 * W, SHOULDER - SPINE, 0); armR.position.set(0.36 * W, SHOULDER - SPINE, 0);
  elbowL.position.y = -ELBOW; elbowR.position.y = -ELBOW;
  armL.add(elbowL); armR.add(elbowR); spine.add(armL); spine.add(armR);
  const hand = new THREE.Group();
  hand.position.set(0, -0.62 + ELBOW, -0.02);
  elbowR.add(hand);

  // раскладка деталей по сегментам
  const addTorso = parts => {
    const lo = parts.filter(p => p[5] <= SPINE), hi = parts.filter(p => p[5] > SPINE);
    if (lo.length) lb(hips, lo.map(p => shift(p, -PELVIS)));
    if (hi.length) lb(spine, hi.map(p => shift(p, -SPINE)));
  };
  const addLeg = (leg, knee, parts) => {
    const up = parts.filter(p => p[5] > -KNEE + 0.01), dn = parts.filter(p => p[5] <= -KNEE + 0.01);
    if (up.length) lb(leg, up);
    if (dn.length) lb(knee, dn.map(p => shift(p, KNEE)));
  };
  const addArm = (arm, elbow, parts) => {
    const up = parts.filter(p => p[5] > -ELBOW), dn = parts.filter(p => p[5] <= -ELBOW);
    if (up.length) lb(arm, up);
    if (dn.length) lb(elbow, dn.map(p => shift(p, ELBOW)));
  };
  // к челюсти — мелкие детали ниже скул (рот, нижние зубы, борода); крупные (волосы) остаются на черепе
  const addHead = parts => {
    const isJaw = p => p[5] < 0.08 && p[1] <= 0.15 && Math.abs(p[4]) < 0.16;
    const sk = parts.filter(p => !isJaw(p)), jw = parts.filter(isJaw);
    if (sk.length) lb(head, sk);
    if (jw.length) lb(jaw, jw.map(p => shift(p, -JAW_Y, -JAW_Z)));
  };

  // ноги: бедро, колено, голень, ботинок со шнуровкой, накладные карманы
  for (const [l, kn, side] of [[legL, kneeL, -1], [legR, kneeR, 1]]) {
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
    else L.push([0.215 * W, 0.035, 0.245, dk(pants, 0.55), 0, -0.48, 0.0, R(0.3)], [0.06, 0.07, 0.014, WOUND, 0.02, -0.6, -0.116],
      [0.026, 0.15, 0.02, BONE, -0.02, -0.6, -0.114], [0.1 * W, 0.05, 0.014, dk(skin, 0.7), 0, -0.53, -0.112]);
    if (zv === 2) L.push([0.1 * W, 0.15, 0.014, BLOOD, 0.01, -0.13, -0.134]);
    if (zv === 3 && side > 0) L.push([0.11 * W, 0.07, 0.014, dk(skin, 0.85), 0, -0.44, -0.12]);
    if (o.zombie && !torn) L.push([0.05, 0.08, 0.014, BLOOD, side * 0.04, -0.3, -0.136]);
    if (o.greaves != null) {
      // наколенник, щиток на голени и ремешки
      const gv = o.greaves;
      L.push([0.215 * W, 0.12, 0.07, gv, 0, -0.44, -0.12, R(0.4)],
        [0.2 * W, 0.18, 0.04, dk(gv, 0.9), 0, -0.58, -0.113, R(0.3)],
        [0.235 * W, 0.025, 0.27, STRAP, 0, -0.37, 0.002], [0.21 * W, 0.025, 0.232, STRAP, 0, -0.62, 0.004]);
    }
    addLeg(l, kn, L);
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
  else T.push([0.53 * W, 0.045, 0.3 * W, dk(shirt, 0.82), 0, 0.96, 0, R(0.25)]);
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
    // ключицы и жилы на шее
    T.push([0.1, 0.018, 0.02, dk(skin, 0.82), -0.07, 1.47, -0.07], [0.1, 0.018, 0.02, dk(skin, 0.82), 0.07, 1.47, -0.07],
      [0.018, 0.06, 0.02, dk(skin, 0.8), -0.04, 1.51, -0.07], [0.018, 0.06, 0.02, dk(skin, 0.8), 0.04, 1.51, -0.07]);
  }
  addTorso(T);
  if (o.zombie && o.vest == null) {
    // рваный подол рубашки: лоскуты разной длины спереди и сзади, качаются вместе с корпусом
    const strips = [];
    [[-0.19, 0.09], [-0.07, 0.13], [0.06, 0.07], [0.18, 0.11]].forEach(([x, len], i) => {
      strips.push([0.07, len, 0.016, dk(shirt, 0.9), x * W, 0.97 - len / 2, fz + 0.004, R(0.2)]);
      strips.push([0.08, len * 0.8, 0.016, dk(shirt, 0.85), (x + 0.03) * W, 0.97 - len * 0.4, bz - 0.004 + (i & 1) * 0.002, R(0.2)]);
    });
    lb(spine, strips.map(p => shift(p, -SPINE)));
  }

  // голова: череп, челюсть, нос, уши, брови, глаза, рот, причёска / шлем
  const hb = [
    [0.33, 0.25, 0.33, skin, 0, 0.225, 0, R(0.32, { b: 0.18 })],
    [0.29, 0.12, 0.29, skin, 0, 0.07, -0.01, R(0.32, { b: 0.2, tx: 1.12, tz: 1.1 })],
    [0.04, 0.085, 0.065, sk2, -0.168, 0.18, 0.01, R(0.3)],
    [0.085, 0.022, 0.03, o.hair ?? dk(skin, 0.6), -0.075, 0.25, -0.165], [0.085, 0.022, 0.03, o.hair ?? dk(skin, 0.6), 0.075, 0.25, -0.165],
  ];
  if (!(o.zombie && zv === 1)) hb.push([0.04, 0.085, 0.065, sk2, 0.168, 0.18, 0.01, R(0.3)]);
  else hb.push([0.03, 0.04, 0.05, WOUND, 0.166, 0.17, 0.01]);
  // нос: у одного варианта зомби вместо носа тёмная впадина
  if (o.zombie && zv === 3) hb.push([0.042, 0.05, 0.012, 0x2a0a0a, 0, 0.152, -0.168]);
  else hb.push([0.045, 0.075, 0.05, sk2, 0, 0.15, -0.184, R(0.3, { tx: 0.7, tz: 0.8 })]);
  const eye = o.eyes || 0x2a2a2a;
  const glowEyes = [];
  if (o.zombie) {
    hb.push(
      [0.085, 0.06, 0.014, dk(skin, 0.45), -0.075, 0.205, -0.166], [0.085, 0.06, 0.014, dk(skin, 0.45), 0.075, 0.205, -0.166],
      [0.3, 0.032, 0.05, dk(skin, 0.86), 0, 0.247, -0.15, R(0.4)],
      [0.055, 0.05, 0.012, dk(skin, 0.7), -0.11, 0.128, -0.158], [0.055, 0.05, 0.012, dk(skin, 0.7), 0.11, 0.128, -0.158],
      [0.13, 0.05, 0.014, 0x2a0808, 0, 0.068, -0.165],
      [0.11, 0.014, 0.012, 0xcfc6a6, 0, 0.087, -0.17], [0.09, 0.012, 0.012, 0xcfc6a6, 0, 0.05, -0.168],
    );
    if (zv === 0) hb.push([0.07, 0.05, 0.014, WOUND, 0.08, 0.29, -0.163]);
    if (zv === 2) hb.push([0.012, 0.09, 0.07, WOUND, 0.165, 0.24, -0.04], [0.04, 0.03, 0.012, BLOOD, -0.06, 0.03, -0.155]);
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
    // у зомби волосы клочьями: проплешины
    if (o.zombie) hb.push([0.12, 0.014, 0.1, dk(skin, 0.92), 0.06, 0.402, -0.02, R(0.3)], [0.08, 0.014, 0.07, dk(skin, 0.88), -0.09, 0.398, 0.08, R(0.3)]);
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
  if (glowEyes.length) lb(head, glowEyes, true);
  addHead(hb);

  // руки: плечо, плечевая часть, локоть, предплечье, манжета, ладонь, четыре пальца, большой палец
  for (const [a, el, side] of [[armL, elbowL, -1], [armR, elbowR, 1]]) {
    const torn = zv === 0 && side > 0;
    const up = o.bare ? skin : sleeve, fore = o.bare || torn ? skin : sleeve;
    const A = [
      [0.19, 0.15, 0.2, up, 0, -0.03, 0, R(0.38)],
      [0.165, 0.28, 0.18, up, 0, -0.2, 0, R(0.28, { tx: 1.06, tz: 1.04 })],
      [0.155, 0.08, 0.17, o.bare ? skin : dk(sleeve, 0.88), 0, -0.355, 0, R(0.32)],
      [0.15, 0.17, 0.16, fore, 0, -0.45, 0, R(0.28, { tx: 1.06, tz: 1.05 })],
      [0.13, 0.07, 0.125, skin, 0, -0.55, 0, R(0.34)],
      [0.118, 0.1, 0.062, skin, 0, -0.615, -0.006, R(0.32, { tx: 1.04 })],
    ];
    // пальцы из двух фаланг, у зомби длиннее и скрючены, с тёмными ногтями; большой палец сбоку
    const zf = o.zombie, L1 = zf ? 0.058 : 0.048, L2 = zf ? 0.05 : 0.04, c1 = zf ? 0.4 : 0.22, c2 = zf ? 0.75 : 0.35;
    for (let f = 0; f < 4; f++) {
      const x = (f - 1.5) * 0.028, k = f === 3 ? 0.85 : f === 1 ? 1.06 : 1;
      const y0 = -0.662, z0 = -0.008, l1 = L1 * k, l2 = L2 * k;
      const y1 = y0 - Math.cos(c1) * l1, z1 = z0 - Math.sin(c1) * l1;
      A.push([0.026, l1 + 0.012, 0.027, sk2, x, y0 - Math.cos(c1) * l1 / 2, z0 - Math.sin(c1) * l1 / 2, R(0.45, { rx: c1 })]);
      A.push([0.023, l2 + 0.008, 0.024, sk2, x, y1 - Math.cos(c1 + c2) * l2 / 2, z1 - Math.sin(c1 + c2) * l2 / 2, R(0.45, { rx: c1 + c2 })]);
      if (zf) A.push([0.02, 0.014, 0.012, dk(skin, 0.45), x, y1 - Math.cos(c1 + c2) * l2 * 0.92, z1 - Math.sin(c1 + c2) * l2 * 0.92 + 0.008, R(0.4, { rx: c1 + c2 })]);
    }
    A.push([0.032, 0.05, 0.034, skin, -side * 0.062, -0.615, -0.028, R(0.45, { rz: side * 0.5, rx: 0.35 })]);
    A.push([0.027, 0.04, 0.029, sk2, -side * 0.078, -0.652, -0.045, R(0.45, { rz: side * 0.25, rx: 0.7 })]);
    if (!o.bare && !torn) A.push([0.165, 0.045, 0.175, dk(sleeve, 0.72), 0, -0.535, 0, R(0.3)]);
    if (o.bare) A.push([0.07, 0.03, 0.2, shirt, -side * 0.03, 0.04, 0, R(0.3)]);
    if (torn) A.push([0.17, 0.035, 0.185, dk(sleeve, 0.6), 0, -0.375, 0, R(0.3)], [0.05, 0.08, 0.012, WOUND, 0, -0.46, -0.083]);
    if (o.zombie && (o.bare || torn)) A.push([0.012, 0.12, 0.012, dk(skin, 0.72), side * 0.04, -0.47, -0.08], [0.012, 0.09, 0.012, dk(skin, 0.72), -side * 0.02, -0.44, -0.081]);
    if (zv === 2 && side < 0) A.push([0.012, 0.12, 0.07, BLOOD, -0.078, -0.44, 0]);
    if (!o.zombie && side < 0) A.push([0.012, 0.07, 0.09, o.patch ?? 0x3a6ab0, -0.096, -0.1, 0]);
    addArm(a, el, A);
  }

  g.userData = {
    body, hips, spine, head, jaw, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, hand,
    phase: Math.random() * 6, zombie: !!o.zombie, W, zv, kind: o.kind || 'walker',
    // характер походки зомби: хромая нога, одна безвольная рука, наклон головы
    limp: o.zombie ? [-1, 0, 1, 0][Math.floor(Math.random() * 4)] : 0,
    hang: o.zombie && Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0,
    tilt: o.zombie ? (Math.random() - 0.5) * 0.5 : 0,
    seed: Math.random() * 6,
    addTorso, addHead, addArm,
  };
  return g;
}


// ---------- зомби ----------
// Тело из гладких органических деталей на том же скелете, что у людей (анимации общие): эллипсоиды
// и сужающиеся трубки с мышцами. Пропорции настоящего человека, череп с впалыми глазницами и провалом
// носа, отвисшая челюсть с зубами, кисти со скрюченными пальцами, рваная одежда, раны, рёбра.
// Каждая деталь помечена: ткань (0), кожа (1), прочее (2) — шейдер накладывает текстуры кожи и ткани.
const TEETH = 0xcfc4a0, MOUTH = 0x1c0606, GUM = 0x5a1818;
const Ee = (w, h, d, hex, x, y, z, o = {}) => [w, h, d, hex, x, y, z, { s: 'e', ...o }];
const Tb = (a, b, ra, rb, hex, o = {}) => [ra * 2, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), rb * 2, hex, a[0], a[1], a[2], { s: 't', to: b, ...o }];
const SKINK = { kind: 1 }, CLOTHK = { kind: 0 }, OTHERK = { kind: 2 };

// кисть зомби в системе локтя: ладонь к телу, пальцы из двух фаланг скрючены к ладони
function zHand(side, skin, nail, wy) {
  const P = [], sk2 = dk(skin, 0.9);
  P.push(Ee(0.032, 0.088, 0.074, skin, -side * 0.002, wy - 0.045, -0.004, { k: 0.8, ...SKINK }));
  P.push(Ee(0.046, 0.04, 0.062, skin, 0, wy + 0.004, 0, { ...SKINK }));
  [[-0.027, 1], [-0.009, 1.08], [0.009, 1.0], [0.026, 0.82]].forEach(([z, k], i) => {
    const c1 = 0.55 + i * 0.06, c2 = 0.85, l1 = 0.042 * k, l2 = 0.034 * k, r = 0.0088 * (k > 0.9 ? 1 : 0.88);
    const a = [-side * 0.004, wy - 0.088, z], b = [a[0] - side * Math.sin(c1) * l1, a[1] - Math.cos(c1) * l1, z];
    const c = [b[0] - side * Math.sin(c1 + c2) * l2, b[1] - Math.cos(c1 + c2) * l2, z];
    P.push(Tb(a, b, r, r * 0.92, sk2, { q: 8, n: 2, c: 2, ...SKINK }), Tb(b, c, r * 0.9, r * 0.75, sk2, { q: 8, n: 2, c: 2, ...SKINK }));
    P.push(Ee(r * 1.6, r * 1.4, r * 1.5, nail, c[0] - side * 0.002, c[1] + 0.002, z, { q: 8, a: 5, ...OTHERK }));
  });
  // большой палец: вперёд и к ладони
  const t0 = [-side * 0.012, wy - 0.035, -0.034], t1 = [-side * 0.022, wy - 0.068, -0.052], t2 = [-side * 0.034, wy - 0.088, -0.05];
  P.push(Tb(t0, t1, 0.012, 0.0105, skin, { q: 8, n: 2, c: 2, ...SKINK }), Tb(t1, t2, 0.0098, 0.008, sk2, { q: 8, n: 2, c: 2, ...SKINK }));
  return P;
}

// o: skin, shirt, sleeve, pants, shoes, hair, helmet, vest, bare (без рубашки), belt, variant (0..3 — раны и одежда),
//    eyes, eyesGlow, scale, wide, kind
export function makeZombie(o) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const body = new THREE.Group();
  g.add(body);
  const s = o.scale || 1;
  body.scale.setScalar(s);
  const W = o.wide || 1, D = 1 + (W - 1) * 0.7, Wl = 1 + (W - 1) * 0.6;
  const zv = o.variant ?? rnd(4);
  const skin = o.skin, sk2 = dk(skin, 0.86), rotC = mix(skin, 0x4a3a28, 0.4), sock = mix(dk(skin, 0.25), 0x200010, 0.3);
  const shirt = o.shirt, pants = o.pants, shoes = o.shoes || 0x2a2420, sleeve = o.sleeve ?? shirt;
  const bare = !!o.bare, nail = 0x2a2418;
  const top = bare ? skin : shirt, topK = bare ? SKINK : CLOTHK;
  const shortSleeve = bare || zv === 0 || zv === 2;
  const ch = { mat: charMat(true), skin };
  const lb = (p, parts, glow = false) => limb(p, parts, glow, ch);

  // суставы: таз 0.9, позвоночник 0.94, голова 1.5 (основание черепа), плечи 1.44, локти 1.14, бёдра 0.82, колени 0.4
  const hips = new THREE.Group(); hips.position.y = 0.9; body.add(hips);
  const spine = new THREE.Group(); spine.position.y = 0.04; hips.add(spine);
  const head = new THREE.Group(); head.position.y = 0.56; spine.add(head);
  const jaw = new THREE.Group(); jaw.position.set(0, 0.045, 0.012); head.add(jaw);
  const legL = new THREE.Group(), legR = new THREE.Group(), kneeL = new THREE.Group(), kneeR = new THREE.Group();
  legL.position.set(-0.095 * W, -0.08, 0); legR.position.set(0.095 * W, -0.08, 0);
  kneeL.position.y = -0.42; kneeR.position.y = -0.42;
  legL.add(kneeL); legR.add(kneeR); hips.add(legL); hips.add(legR);
  const armL = new THREE.Group(), armR = new THREE.Group(), elbowL = new THREE.Group(), elbowR = new THREE.Group();
  armL.position.set(-0.19 * W, 0.455, 0); armR.position.set(0.19 * W, 0.455, 0);
  elbowL.position.y = -0.3; elbowR.position.y = -0.3;
  armL.add(elbowL); armR.add(elbowR); spine.add(armL); spine.add(armR);
  const hand = new THREE.Group();
  hand.position.set(0, -0.27, -0.01);
  elbowR.add(hand);

  // таз
  const Hp = [
    Tb([0, -0.13, 0.005], [0, 0.1, 0], 0.158 * W, 0.142 * W, pants, { sz: 0.66 * D / W, q: 20, n: 5, ...CLOTHK }),
    Ee(0.14 * W, 0.14, 0.12 * D, pants, -0.07 * W, -0.07, 0.05 * D, CLOTHK), Ee(0.14 * W, 0.14, 0.12 * D, pants, 0.07 * W, -0.07, 0.05 * D, CLOTHK),
  ];
  if (o.belt !== false) Hp.push(Tb([0, 0.02, 0.002], [0, 0.058, 0.002], 0.152 * W, 0.152 * W, 0x3a2a1e, { sz: 0.67 * D / W, q: 20, n: 1, c: 1, ...OTHERK }), Ee(0.05, 0.036, 0.016, 0x8a7a50, 0, 0.04, -0.103 * D, { k: 0.6, ...OTHERK }));
  lb(hips, Hp);

  // корпус: живот, рёбра, лопатки, трапеции, плечи, шея, ключицы
  const fz = -0.104 * D;
  const Sp = [
    Tb([0, -0.06, 0.004], [0, 0.26, 0.006], 0.148 * W, 0.168 * W, top, { sz: 0.64 * D / W, bulge: -0.1, bp: 0.35, q: 22, n: 6, ...topK }),
    Tb([0, 0.2, 0.008], [0, 0.42, 0.015], 0.172 * W, 0.15 * W, top, { sz: 0.64 * D / W, bulge: 0.04, bp: 0.3, q: 22, n: 5, ...topK }),
    Ee(0.27 * W, 0.08, 0.13 * D, top, 0, 0.47, 0.018, { k: 0.9, ...topK }),
    // плечевой пояс: от корпуса к руке
    Ee(0.16 * W, 0.09, 0.12 * D, top, -0.13 * W, 0.455, 0.012, { k: 0.9, rz: 0.22, ...topK }),
    Ee(0.16 * W, 0.09, 0.12 * D, top, 0.13 * W, 0.455, 0.012, { k: 0.9, rz: -0.22, ...topK }),
    Tb([0, 0.44, 0.012], [0, 0.6, -0.006], 0.05 * Wl, 0.044 * Wl, skin, { q: 14, n: 3, ...SKINK }),
    // жилы на шее
    Tb([-0.026, 0.48, -0.035], [-0.02, 0.58, -0.03], 0.007, 0.005, sk2, { q: 8, n: 2, ...SKINK }),
    Tb([0.026, 0.48, -0.035], [0.02, 0.58, -0.03], 0.007, 0.005, sk2, { q: 8, n: 2, ...SKINK }),
  ];
  if (bare) Sp.push(Tb([-0.015, 0.465, -0.075 * D], [-0.13 * W, 0.48, -0.04], 0.009, 0.008, sk2, { q: 8, n: 2, ...SKINK }), Tb([0.015, 0.465, -0.075 * D], [0.13 * W, 0.48, -0.04], 0.009, 0.008, sk2, { q: 8, n: 2, ...SKINK }));
  if (bare || zv === 1) {
    // впалый живот и рёбра под кожей
    // рёбра дугой по грудной клетке: от грудины в сторону и вниз, к бокам тоньше
    const ribs = bare ? 4 : 3, side0 = bare ? [-1, 1] : [-1];
    for (const sd of side0) for (let i = 0; i < ribs; i++) {
      const y = 0.24 + i * 0.05, a = [sd * 0.03, y, fz - 0.004], m = [sd * 0.105 * W, y - 0.04, fz + 0.022], e = [sd * 0.155 * W, y - 0.085, -0.03 * D];
      Sp.push(Tb(a, m, 0.0068, 0.006, bare ? sk2 : BONE, { q: 8, n: 2, c: 2, ...(bare ? SKINK : OTHERK) }), Tb(m, e, 0.006, 0.004, bare ? sk2 : BONE, { q: 8, n: 2, c: 2, ...(bare ? SKINK : OTHERK) }));
    }
    if (!bare) Sp.push(Ee(0.11, 0.13, 0.026, 0x2e0606, -0.08, 0.3, fz + 0.016, OTHERK), Ee(0.125, 0.145, 0.016, dk(shirt, 0.55), -0.08, 0.3, fz + 0.022, CLOTHK));
    if (bare) Sp.push(Tb([0, 0.2, fz - 0.002], [0, 0.4, fz - 0.004], 0.012, 0.01, sk2, { q: 8, n: 3, ...SKINK }));
  }
  if (zv === 0) Sp.push(Ee(0.1, 0.08, 0.03, skin, 0.08, 0.12, fz + 0.012, SKINK), Ee(0.06, 0.045, 0.02, 0x7a1a14, 0.08, 0.12, fz + 0.002, OTHERK));
  if (zv === 3) Sp.push(Ee(0.2 * W, 0.08, 0.04, skin, 0, 0.02, fz + 0.02, SKINK), Ee(0.07, 0.04, 0.02, 0x7a1a14, -0.05, 0.03, fz + 0.005, OTHERK));
  if (o.vest != null) {
    const v = o.vest, vd = dk(v, 0.8);
    Sp.push(Ee(0.37 * W, 0.36, 0.27 * D, v, 0, 0.29, 0.005, { k: 0.72, ...CLOTHK }));
    for (const x of [-0.1, 0, 0.1]) Sp.push(Ee(0.085, 0.11, 0.05, vd, x * W, 0.2, -0.14 * D, { k: 0.6, ...CLOTHK }));
    Sp.push(Ee(0.07, 0.1, 0.045, vd, -0.11 * W, 0.37, -0.135 * D, { k: 0.6, ...CLOTHK }), Tb([-0.12 * W, 0.42, -0.14 * D], [-0.13 * W, 0.56, -0.13 * D], 0.005, 0.004, 0x1a1a1a, { q: 6, n: 2, ...OTHERK }));
  }
  // рваный подол: лоскуты разной длины
  if (!bare) [[-0.11, 0.08], [-0.035, 0.12], [0.04, 0.06], [0.11, 0.1]].forEach(([x, len], i) => {
    Sp.push(Ee(0.07, len, 0.014, dk(shirt, 0.92), x * W, -0.01 - len / 2 + 0.03, fz + 0.02, { k: 0.6, ...CLOTHK }));
    Sp.push(Ee(0.075, len * 0.8, 0.014, dk(shirt, 0.88), (x + 0.02) * W, -0.01 - len * 0.4 + 0.03, 0.1 * D - (i & 1) * 0.004, { k: 0.6, ...CLOTHK }));
  });
  lb(spine, Sp);

  // голова: череп, лицо, скулы, надбровья, впалые глазницы, провал носа, уши, зубы; челюсть — отдельно
  const Hd = [
    Ee(0.152, 0.2, 0.19, skin, 0, 0.118, 0.012, { k: 0.92, ...SKINK }),
    Ee(0.14, 0.15, 0.12, skin, 0, 0.12, 0.05, SKINK),
    Ee(0.122, 0.105, 0.1, skin, 0, 0.068, -0.03, { k: 0.9, tx: 1.06, ...SKINK }),
    Ee(0.052, 0.022, 0.03, skin, -0.03, 0.124, -0.07, SKINK), Ee(0.052, 0.022, 0.03, skin, 0.03, 0.124, -0.07, SKINK),
    Ee(0.04, 0.025, 0.034, skin, -0.045, 0.078, -0.05, SKINK), Ee(0.04, 0.025, 0.034, skin, 0.045, 0.078, -0.05, SKINK),
    Ee(0.042, 0.032, 0.03, sock, -0.031, 0.1, -0.062, SKINK), Ee(0.042, 0.032, 0.03, sock, 0.031, 0.1, -0.062, SKINK),
    Ee(0.062, 0.03, 0.045, MOUTH, 0, 0.034, -0.055, OTHERK),
    Ee(0.056, 0.009, 0.02, GUM, 0, 0.049, -0.069, OTHERK),
    Ee(0.02, 0.016, 0.01, MOUTH, 0, 0.066, -0.087, OTHERK),
  ];
  // верхние зубы по дуге: жёлтые, один выбит
  for (let i = 0; i < 6; i++) {
    if (i === 4 && zv % 2 === 0) continue;
    const x = (i - 2.5) * 0.0088;
    Hd.push(Ee(0.0075, 0.011 + (i % 2) * 0.002, 0.006, i === 1 ? 0xa89870 : TEETH, x, 0.04, -0.075 + Math.abs(x) * 0.4, { q: 8, a: 5, ...OTHERK }));
  }
  if (zv !== 3) Hd.push(Ee(0.016, 0.032, 0.018, skin, 0, 0.088, -0.083, { rx: 0.35, ...SKINK }));
  Hd.push(Ee(0.012, 0.046, 0.028, sk2, -0.077, 0.098, 0.012, SKINK));
  if (zv !== 1) Hd.push(Ee(0.012, 0.046, 0.028, sk2, 0.077, 0.098, 0.012, SKINK));
  else Hd.push(Ee(0.016, 0.03, 0.03, 0x7a1a14, 0.074, 0.095, 0.012, OTHERK));
  if (zv === 0) Hd.push(Ee(0.05, 0.04, 0.03, 0x6a1410, 0.045, 0.17, -0.04, OTHERK), Ee(0.03, 0.022, 0.02, BONE, 0.045, 0.172, -0.047, OTHERK));
  if (zv === 2) Hd.push(Ee(0.016, 0.07, 0.06, 0x7a1a14, 0.074, 0.13, 0.0, OTHERK));
  if (o.hair != null && o.helmet == null) {
    // волосы клочьями, с проплешинами
    const hr = o.hair;
    Hd.push(Ee(0.16, 0.15, 0.196, hr, 0, 0.152, 0.032, { k: 0.92, rx: -0.28, ...CLOTHK }));
    for (let i = 0; i < 6; i++) Hd.push(Tb([(i - 2.5) * 0.018, 0.16, 0.1], [(i - 2.5) * 0.02, 0.07 - (i % 2) * 0.03, 0.104], 0.006, 0.0025, hr, { q: 6, n: 2, ...CLOTHK }));
  } else if (o.helmet == null) Hd.push(Ee(0.07, 0.02, 0.07, rotC, -0.02, 0.212, 0.01, SKINK));
  if (o.helmet != null) {
    const hm = o.helmet;
    Hd.push(Ee(0.178, 0.1, 0.205, hm, 0, 0.19, 0.012, { k: 0.85, ...OTHERK }), Ee(0.195, 0.022, 0.222, dk(hm, 0.85), 0, 0.152, 0.012, { k: 0.8, ...OTHERK }),
      Tb([-0.08, 0.15, 0.0], [-0.06, 0.04, -0.03], 0.005, 0.005, 0x2a2a20, { q: 6, n: 2, ...OTHERK }), Tb([0.08, 0.15, 0.0], [0.06, 0.04, -0.03], 0.005, 0.005, 0x2a2a20, { q: 6, n: 2, ...OTHERK }));
  }
  lb(head, Hd);
  const eye = o.eyes || 0xd0d0b0;
  const eyes = [Ee(0.014, 0.012, 0.008, eye, -0.031, 0.1, -0.076, { q: 10, a: 6 }), Ee(0.014, 0.012, 0.008, eye, 0.031, 0.1, -0.076, { q: 10, a: 6 })];
  if (o.eyesGlow) lb(head, eyes, true); else lb(head, eyes);
  // челюсть: нижняя челюсть, подбородок, нижние зубы, рот, кровавые потёки
  const Jw = [
    Ee(0.106, 0.042, 0.095, skin, 0, -0.028, -0.028, { k: 0.88, tx: 0.86, ...SKINK }),
    Ee(0.042, 0.03, 0.032, skin, 0, -0.044, -0.07, SKINK),
    Ee(0.06, 0.02, 0.048, MOUTH, 0, -0.008, -0.05, OTHERK),
    Ee(0.052, 0.008, 0.02, GUM, 0, -0.012, -0.068, OTHERK),
    Tb([0.012, -0.022, -0.082], [0.014, -0.07, -0.078], 0.0045, 0.002, BLOOD, { q: 6, n: 2, ...OTHERK }),
    Tb([-0.015, -0.02, -0.08], [-0.016, -0.05, -0.076], 0.004, 0.002, BLOOD, { q: 6, n: 2, ...OTHERK }),
  ];
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.0082;
    Jw.push(Ee(0.007, 0.01, 0.0055, i === 3 ? 0xa89870 : TEETH, x, -0.004, -0.072 + Math.abs(x) * 0.4, { q: 8, a: 5, ...OTHERK }));
  }
  if (zv === 0) Jw.push(Ee(0.03, 0.03, 0.03, 0x7a1a14, 0.045, -0.015, -0.05, OTHERK));
  lb(jaw, Jw);

  // руки: плечо, локоть, предплечье с мышцами, запястье, кисть
  for (const [a, el, side] of [[armL, elbowL, -1], [armR, elbowR, 1]]) {
    const up = bare ? skin : sleeve, fore = shortSleeve ? skin : sleeve, Wa = 1 + (W - 1) * 0.8;
    const A = [
      Tb([0, 0.01, 0.004], [0, -0.3, 0], 0.052 * Wa, 0.04 * Wa, up, { bulge: 0.1, bp: 0.12, sx: 0.95, sz: 1.05, q: 16, ...(bare ? SKINK : CLOTHK) }),
      Ee(0.07 * Wa, 0.09, 0.095 * Wa, up, side * 0.01, -0.02, 0.002, { k: 0.95, ...(bare ? SKINK : CLOTHK) }),
    ];
    if (shortSleeve && !bare) A.push(Ee(0.11 * Wa, 0.05, 0.105 * Wa, dk(sleeve, 0.85), 0, -0.17, 0, { k: 0.8, ...CLOTHK }), Tb([0, -0.19, 0], [0, -0.3, 0], 0.041 * Wa, 0.039 * Wa, skin, { q: 12, n: 3, ...SKINK }));
    lb(a, A);
    const F = [
      Ee(0.075 * Wa, 0.075, 0.072 * Wa, fore, 0, 0, 0.01, fore === skin ? SKINK : CLOTHK),
      Tb([0, 0, 0], [0, -0.25, -0.005], 0.042 * Wa, 0.029 * Wa, fore, { bulge: 0.12, bp: 0.22, sx: 1.12, sz: 0.9, ...(fore === skin ? SKINK : CLOTHK) }),
      ...zHand(side, skin, nail, -0.262),
    ];
    if (fore !== skin) F.push(Tb([0, -0.2, -0.004], [0, -0.245, -0.005], 0.036 * Wa, 0.034 * Wa, dk(sleeve, 0.8), { q: 12, n: 2, ...CLOTHK }));
    if ((zv === 2 && side < 0) || (zv === 1 && side > 0)) F.push(Ee(0.035, 0.05, 0.02, 0x7a1a14, side * 0.03, -0.12, -0.022, OTHERK), Ee(0.018, 0.03, 0.012, BONE, side * 0.034, -0.125, -0.028, OTHERK));
    lb(el, F);
  }

  // ноги: бедро, колено, голень с икрой, штанина, ботинок
  for (const [l, kn, side] of [[legL, kneeL, -1], [legR, kneeR, 1]]) {
    const torn = (zv === 1 && side < 0) || (zv === 3 && side > 0);
    lb(l, [Tb([0, 0.04, 0.008], [0, -0.42, -0.005], 0.088 * Wl, 0.057 * Wl, pants, { bulge: 0.05, bp: 0.25, sx: 1.04, sz: 1.1, q: 16, ...CLOTHK })]);
    const low = torn ? skin : pants, lowK = torn ? SKINK : CLOTHK;
    const K = [
      Ee(0.08 * Wl, 0.075, 0.07 * Wl, pants, 0, 0, -0.014, CLOTHK),
      Tb([0, 0, 0], [0, -0.34, 0.01], 0.054 * Wl, 0.036 * Wl, low, { bulge: 0.1, bp: 0.28, sz: 1.12, ...lowK }),
      Ee(0.08 * Wl, 0.15, 0.075 * Wl, low, 0, -0.12, 0.026, lowK),
      Ee(0.095 * Wl, 0.075, 0.25 * Wl, shoes, 0, -0.368, -0.055, { k: 0.7, ...OTHERK }),
      Ee(0.1 * Wl, 0.022, 0.26 * Wl, 0x17130f, 0, -0.4, -0.055, { k: 0.6, ...OTHERK }),
      Ee(0.09 * Wl, 0.08, 0.1 * Wl, shoes, 0, -0.33, 0.0, { k: 0.75, ...OTHERK }),
    ];
    if (torn) K.push(Ee(0.11 * Wl, 0.05, 0.1 * Wl, dk(pants, 0.6), 0, -0.05, 0, { k: 0.7, ...CLOTHK }), Ee(0.04, 0.06, 0.02, 0x7a1a14, 0.01, -0.16, -0.05, OTHERK));
    else K.push(Ee(0.1 * Wl, 0.045, 0.1 * Wl, dk(pants, 0.85), 0, -0.3, 0.006, { k: 0.8, ...CLOTHK }));
    lb(kn, K);
  }

  // детали боссов и громилы (zExtras) — по старым координатам «цельной» модели, раскладываются по суставам
  const split = (parts, cut) => [parts.filter(p => p[5] > cut), parts.filter(p => p[5] <= cut)];
  const shift = (p, dy, dz = 0) => { const q = p.slice(); q[5] += dy; q[6] += dz; return q; };
  const addTorso = parts => {
    const [hi, lo] = split(parts, 0.94);
    if (lo.length) lb(hips, lo.map(p => shift(p, -0.9)));
    if (hi.length) lb(spine, hi.map(p => shift(p, -0.94)));
  };
  const addArm = (arm, elbow, parts) => {
    const [up, dn] = split(parts, -0.3);
    if (up.length) lb(arm, up);
    if (dn.length) lb(elbow, dn.map(p => shift(p, 0.3)));
  };
  const addHead = parts => lb(head, parts.map(p => shift(p, -0.06)));
  const addLeg = (leg, knee, parts) => {
    const [up, dn] = split(parts, -0.41);
    if (up.length) lb(leg, up);
    if (dn.length) lb(knee, dn.map(p => shift(p, 0.42)));
  };

  g.userData = {
    body, hips, spine, head, jaw, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, hand,
    phase: Math.random() * 6, zombie: true, W, zv, kind: o.kind || 'walker', real: true,
    limp: [-1, 0, 1, 0][Math.floor(Math.random() * 4)],
    hang: Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0,
    tilt: (Math.random() - 0.5) * 0.5,
    seed: Math.random() * 6,
    addTorso, addHead, addArm, addLeg, lb, skin,
  };
  return g;
}

// ---------- анимация ----------
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = t => t * t * (3 - 2 * t);

// поза: speed — скорость движения; opts: aim, pitch, swing, crouch (игроки); atk — фаза атаки 0..1 (−1 — нет), hit — вздрагивание 0..1 (зомби)
export function animate(g, dt, speed, opts = {}) {
  const u = g.userData;
  if (u.zombie) zombiePose(u, dt, speed, opts); else playerPose(u, dt, speed, opts);
}

function legsCycle(u, p, amp, knee, kneeBase, limp, extra = 0) {
  for (const [leg, kn, ph, side] of [[u.legL, u.kneeL, p, -1], [u.legR, u.kneeR, p + Math.PI, 1]]) {
    const drag = limp === side ? 0.5 : 1;
    leg.rotation.x = Math.sin(ph) * amp * drag + extra;
    kn.rotation.x = -Math.max(0, Math.cos(ph)) * knee * drag - kneeBase;
  }
}

function playerPose(u, dt, speed, o) {
  const st = Math.min(1, speed / 4.3), run = Math.max(0, Math.min(1, (speed - 4.5) / 2.5));
  u.phase += dt * (speed > 0.3 ? 2.4 + speed * 1.5 : 1.0);
  const p = u.phase, s = Math.sin(p);
  legsCycle(u, p, 0.5 * st + 0.3 * run, 0.85 * st + 0.6 * run, 0.04, 0);
  u.legL.rotation.z = 0; u.legR.rotation.z = 0;
  u.hips.position.y = PELVIS - Math.abs(s) * 0.025 * st;
  u.hips.rotation.set(0, s * 0.08 * st, 0);
  u.spine.rotation.set(-(0.04 * st + 0.18 * run), -s * 0.1 * st, 0);
  u.jaw.rotation.x = 0;
  const pitch = o.pitch || 0;
  if (o.aim) {
    u.armR.rotation.set(1.45 + pitch - u.spine.rotation.x, 0, 0); u.elbowR.rotation.x = 0.15;
    u.armL.rotation.set(1.3 + pitch - u.spine.rotation.x, -0.5, 0); u.elbowL.rotation.x = 0.45;
  } else {
    u.armL.rotation.set(-s * 0.5 * st, 0, 0.04);
    u.armR.rotation.set(s * 0.5 * st + (o.swing || 0) * 1.8, 0, -0.04);
    u.elbowL.rotation.x = 0.12 + 0.3 * st + 0.9 * run;
    u.elbowR.rotation.x = 0.12 + 0.3 * st + 0.9 * run + (o.swing || 0) * 0.4;
  }
  u.head.rotation.set(pitch * 0.6 - u.spine.rotation.x, 0, 0);
  if (o.crouch) {
    // присед: таз ниже, бёдра вперёд, колени согнуты — ступни остаются на земле
    u.hips.position.y -= 0.32;
    u.legL.rotation.x += 1.1; u.legR.rotation.x += 1.1;
    u.kneeL.rotation.x -= 1.75; u.kneeR.rotation.x -= 1.75;
    u.spine.rotation.x -= 0.25; u.head.rotation.x += 0.25;
  }
}

function zombiePose(u, dt, speed, o) {
  const K = u.kind, runner = K === 'runner' || K === 'leaper', heavy = K === 'tank' || K === 'butcher';
  const st = Math.min(1, speed / (runner ? 4.5 : 2.2));
  const fast = runner && speed > 2.5;
  u.phase += dt * (fast ? 3.2 + speed * 1.15 : heavy ? 1.1 + speed * 1.5 : 1.3 + speed * 1.8);
  const p = u.phase, s = Math.sin(p), t = performance.now() / 1000 + u.seed;
  // ноги: шаркающий шаг, одна нога волочится; у прыгуна — полуприсед
  const crouch = K === 'leaper' ? 1 : 0;
  legsCycle(u, p, (fast ? 0.8 : heavy ? 0.32 : 0.42) * st, (fast ? 1.4 : 0.6) * st, 0.1 + crouch * 0.9, u.limp, crouch * 0.45);
  u.legL.rotation.z = -(heavy ? 0.07 : 0.025); u.legR.rotation.z = heavy ? 0.07 : 0.025;
  // таз: проседает на шаге, валко раскачивается
  u.hips.position.y = PELVIS - Math.abs(s) * (fast ? 0.045 : 0.03) * st - crouch * 0.12 - (u.limp ? Math.max(0, Math.sin(p * 2)) * 0.015 * st : 0);
  u.hips.rotation.set(0, s * 0.1 * st, s * (heavy ? 0.1 : 0.06) * (0.3 + st));
  // спина: сутулость, раскачивание; голова смотрит вперёд, но болтается и заваливается набок
  const lean = (fast ? 0.45 : 0.24) + (heavy ? -0.04 : 0) + crouch * 0.4;
  u.spine.rotation.set(-(lean + Math.sin(p * 2) * 0.03 + Math.sin(t * 0.7) * 0.03 * (1 - st)), -s * 0.12 * st, -s * 0.08 * (0.4 + st) + u.tilt * 0.3);
  u.head.rotation.set(lean * 0.7 + Math.sin(t * 1.1) * 0.07, Math.sin(t * 0.4) * 0.22, u.tilt + Math.sin(t * 0.55) * 0.16);
  u.jaw.rotation.x = -(0.1 + Math.max(0, Math.sin(t * 2.3)) * 0.3);
  // руки
  let sL, sR, eL, eR, zL = 0.12, zR = -0.12;
  if (fast) { sL = 0.35 - s * 1.0; sR = 0.35 + s * 1.0; eL = eR = 1.15; zL = 0.25; zR = -0.25; }
  else if (heavy) { sL = 0.3 + Math.sin(p + 1) * 0.25 * st; sR = 0.3 + Math.sin(p + 1 + Math.PI) * 0.25 * st; eL = eR = 0.3; zL = 0.18; zR = -0.18; }
  else if (crouch) { sL = 0.9 + Math.sin(t * 1.3) * 0.08; sR = 0.95 + Math.sin(t * 1.1) * 0.08; eL = eR = 0.85; }
  else {
    // руки свисают и болтаются в такт шагу, локти чуть согнуты; когда игрок рядом — тянутся к нему
    const r = o.reach || 0;
    const hL = 0.08 - s * 0.32 * st + Math.sin(t * 0.9) * 0.04, hR = 0.08 + s * 0.32 * st + Math.sin(t * 1.1 + 1) * 0.04;
    sL = lerp(hL, 1.15 + Math.sin(p + 0.5) * 0.12 + Math.sin(t * 0.9) * 0.05, r);
    sR = lerp(hR, 1.05 + Math.sin(p + 2.2) * 0.12, r);
    eL = lerp(0.2 + Math.max(0, s) * 0.25 * st, 0.38, r); eR = lerp(0.24 + Math.max(0, -s) * 0.25 * st, 0.5, r);
    zL = lerp(0.06, 0.12, r); zR = -zL;
  }
  // безвольно висящая рука
  if (u.hang === -1 && !fast) { sL = 0.12 + s * 0.22 * st; eL = 0.12; zL = 0.04; }
  if (u.hang === 1 && !fast) { sR = 0.12 - s * 0.22 * st; eR = 0.12; zR = -0.04; }
  // атака: замах обеими руками, рывок корпусом и удар вниз с раскрытой пастью
  const a = o.atk;
  if (a != null && a >= 0) {
    let up, k;
    if (a < 0.45) { k = sstep(a / 0.45); up = 1; } else if (a < 0.62) { k = 1; up = 1 - sstep((a - 0.45) / 0.17); } else { k = 1 - sstep((a - 0.62) / 0.38); up = 0; }
    const sh = lerp(0.75, 2.3, up), el = lerp(0.15, 1.0, up);
    sL = lerp(sL, sh, k); sR = lerp(sR, sh + 0.08, k); eL = lerp(eL, el, k); eR = lerp(eR, el, k);
    zL = lerp(zL, 0.18, k); zR = lerp(zR, -0.18, k);
    u.spine.rotation.x += k * (up > 0.5 ? 0.12 : -0.42);
    u.head.rotation.x += k * (up > 0.5 ? -0.05 : 0.3);
    u.jaw.rotation.x = lerp(u.jaw.rotation.x, -0.6, k);
  }
  // попадание: корпус и голову отбрасывает назад
  const h = o.hit || 0;
  if (h > 0) { u.spine.rotation.x += 0.45 * h; u.head.rotation.x += 0.5 * h; sL -= 0.5 * h; sR -= 0.5 * h; }
  u.armL.rotation.set(sL, 0, zL); u.armR.rotation.set(sR, 0, zR);
  u.elbowL.rotation.x = eL; u.elbowR.rotation.x = eR;
}

// смерть: ноги подкашиваются, корпус оседает, и тело падает лицом вперёд
export function animateDeath(g, t) {
  const u = g.userData;
  const k = sstep(Math.min(1, t / 0.45));
  u.kneeL.rotation.x = -1.5 * k; u.kneeR.rotation.x = -1.3 * k;
  u.legL.rotation.x = 0.85 * k; u.legR.rotation.x = 0.7 * k;
  u.hips.position.y = PELVIS - 0.32 * k;
  u.spine.rotation.x = -0.55 * k; u.head.rotation.x = -0.4 * k;
  u.armL.rotation.set(lerp(u.armL.rotation.x, 0.25, k), 0, 0.15); u.armR.rotation.set(lerp(u.armR.rotation.x, 0.4, k), 0, -0.15);
  u.elbowL.rotation.x = 0.2; u.elbowR.rotation.x = 0.3;
  u.jaw.rotation.x = -0.45;
  g.rotation.x = -Math.min(1.42, Math.max(0, t - 0.3) * 4.2);
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
  { skin: 0x8b9a7a, shirt: 0x5a4a3a, pants: 0x3a3a44, hair: 0x2a2a20 },
  { skin: 0x9ca58c, shirt: 0x6a6a5a, pants: 0x4a4030, hair: 0x4a3a28 },
  { skin: 0x7f8c70, shirt: 0x4a5a6a, pants: 0x2e3a4a, hair: 0x6a6a60 },
  { skin: 0xa3a68e, shirt: 0x7a3a3a, pants: 0x3a3a44, hair: 0x1a1a18 },
  { skin: 0x86947a, shirt: 0x3a4a3a, pants: 0x2e3a4a, hair: null },
  { skin: 0x93a084, shirt: 0x8a7a5a, pants: 0x4a4030, hair: 0x2a2a20 },
];
const rnd = n => Math.floor(Math.random() * n);

export const ZOMBIE_LOOK = {
  walker: () => { const i = rnd(WALKERS.length); return makeZombie({ kind: 'walker', ...WALKERS[i], variant: i % 4, eyes: 0xff3020, eyesGlow: true }); },
  runner: () => makeZombie({ kind: 'runner', skin: 0xa0b090, shirt: 0x6a2a2a, pants: 0x2a2a30, hair: null, bare: true, belt: false, variant: rnd(2) * 2, eyes: 0xffd020, eyesGlow: true, scale: 0.95 }),
  tank: () => zExtras(makeZombie({ kind: 'tank', skin: 0x6a8a5a, shirt: 0x4a4038, pants: 0x30302a, hair: null, belt: false, variant: 3, eyes: 0xff3020, eyesGlow: true, scale: 1.35, wide: 1.4 }), 'tank'),
  soldier: () => makeZombie({ kind: 'soldier', skin: 0x7a9070, shirt: 0x55603e, sleeve: 0x4a5536, pants: 0x4a5536, shoes: 0x2a2620, helmet: 0x3e4a2e, vest: 0x5a6440, variant: rnd(4), eyes: 0xff3020, eyesGlow: true }),
  // боссы
  butcher: () => zExtras(makeZombie({ kind: 'butcher', skin: 0x8a6a5a, shirt: 0xd8d0c0, sleeve: 0x8a6a5a, pants: 0x3a3028, hair: null, variant: 2, eyes: 0xffe020, eyesGlow: true, scale: 2.1, wide: 1.5 }), 'butcher'),
  screamer: () => zExtras(makeZombie({ kind: 'screamer', skin: 0xc8c8b0, shirt: 0x4a2a5a, pants: 0x2a1a30, hair: 0xe0e0e0, belt: false, variant: 1, eyes: 0x60ff60, eyesGlow: true, scale: 1.6 }), 'screamer'),
  leaper: () => zExtras(makeZombie({ kind: 'leaper', skin: 0x6a8a4a, shirt: 0x3a4a2a, pants: 0x2a3a20, hair: null, bare: true, variant: 0, eyes: 0xff3020, eyesGlow: true, scale: 1.75 }), 'leaper'),
};

// особые детали: брюхо и опухоли танка, фартук и тесак мясника, волосы и платье крикуньи, шипы и когти прыгуна
function zExtras(g, kind) {
  const u = g.userData, W = u.W, D = 1 + (W - 1) * 0.7, L = u.lb, fz = -0.104 * D, skin = u.skin;
  const claws = (hex, n, len) => {
    for (const [el, side] of [[u.elbowL, -1], [u.elbowR, 1]]) {
      const C = [];
      for (let i = 0; i < n; i++) {
        const z = (i - (n - 1) / 2) * 0.02;
        C.push(Tb([-side * 0.012, -0.352, z], [-side * 0.04, -0.352 - len, z - 0.012], 0.0065, 0.0008, hex, { q: 8, n: 3, c: 1, ...OTHERK }));
      }
      L(el, C);
    }
  };
  if (kind === 'tank') {
    // вываленное брюхо в разорванной рубахе, наросты на плече, спине и голове, ремень через грудь
    L(u.spine, [
      Ee(0.3 * W, 0.24, 0.17 * D, skin, 0, 0.08, fz + 0.02, { ...SKINK }),
      Ee(0.06, 0.05, 0.03, 0x7a1a14, 0.06, 0.06, fz - 0.06, OTHERK),
      Ee(0.13, 0.11, 0.11, mix(skin, 0x9ab07a, 0.4), 0.15 * W, 0.44, -0.02, SKINK),
      Ee(0.11, 0.1, 0.09, mix(skin, 0x9ab07a, 0.4), -0.09 * W, 0.26, 0.1 * D, SKINK),
      Tb([-0.12 * W, 0.44, fz + 0.01], [0.13 * W, 0.04, fz - 0.005], 0.014, 0.014, STRAP, { q: 8, n: 4, ...OTHERK }),
    ]);
    L(u.head, [Ee(0.08, 0.07, 0.08, mix(skin, 0x9ab07a, 0.4), 0.05, 0.19, 0.05, SKINK)]);
  } else if (kind === 'butcher') {
    // фартук по фигуре (грудь и подол), лямки, крюки на поясе, швы на черепе, тесак в руке
    const ap = 0xcfc6b4;
    L(u.spine, [
      Ee(0.3 * W, 0.42, 0.022, ap, 0, 0.2, fz - 0.004, { k: 0.8, ...CLOTHK }),
      Tb([-0.09 * W, 0.4, fz + 0.005], [-0.08 * W, 0.5, 0.02], 0.012, 0.012, STRAP, { q: 8, n: 3, ...OTHERK }),
      Tb([0.09 * W, 0.4, fz + 0.005], [0.08 * W, 0.5, 0.02], 0.012, 0.012, STRAP, { q: 8, n: 3, ...OTHERK }),
    ]);
    L(u.hips, [
      Ee(0.3 * W, 0.36, 0.02, ap, 0, -0.16, -0.112 * D, { k: 0.8, tx: 1.15, ...CLOTHK }),
      Tb([-0.15 * W, 0.04, -0.03], [-0.16 * W, -0.06, -0.035], 0.006, 0.006, 0x9aa0a6, { q: 6, n: 2, ...OTHERK }),
      Tb([-0.16 * W, -0.06, -0.035], [-0.14 * W, -0.075, -0.06], 0.006, 0.002, 0x9aa0a6, { q: 6, n: 2, ...OTHERK }),
    ]);
    const st = [];
    for (let i = 0; i < 5; i++) st.push(Tb([-0.05, 0.215 - Math.abs(i - 2) * 0.004, -0.05 + i * 0.03], [0.05, 0.215 - Math.abs(i - 2) * 0.004, -0.05 + i * 0.03], 0.0035, 0.0035, 0x3a1414, { q: 6, n: 2, ...OTHERK }));
    st.push(Tb([0, 0.22, -0.07], [0, 0.22, 0.09], 0.004, 0.004, 0x3a1414, { q: 6, n: 4, ...OTHERK }));
    L(u.head, st);
    // тесак: деревянная рукоять с заклёпками, тяжёлое лезвие с заточкой, ржавчина и кровь у кромки
    L(u.hand, [
      Tb([0, 0.0, 0], [0, -0.2, 0], 0.024, 0.026, 0x3a2a1e, { q: 12, n: 3, ...OTHERK }),
      Ee(0.03, 0.012, 0.012, 0xb8bcc0, 0, -0.06, 0, OTHERK), Ee(0.03, 0.012, 0.012, 0xb8bcc0, 0, -0.13, 0, OTHERK),
      Ee(0.02, 0.24, 0.34, 0x9aa0a6, 0, -0.33, -0.1, { k: 0.35, ...OTHERK }),
      Ee(0.012, 0.03, 0.33, 0xe0e4e8, 0, -0.44, -0.1, { k: 0.4, ...OTHERK }),
      Ee(0.022, 0.09, 0.15, 0x5a0c0c, 0, -0.41, -0.2, { k: 0.7, ...OTHERK }),
      Ee(0.022, 0.06, 0.06, 0x6a4a30, 0, -0.27, 0.02, { k: 0.7, ...OTHERK }),
    ]);
  } else if (kind === 'screamer') {
    // длинные седые космы до пояса, рваное платье, когти
    const hw = 0xe0e0d8, hw2 = 0xc8c8c0, dress = 0x3a1e48;
    const H = [
      Ee(0.17, 0.2, 0.2, hw, 0, 0.15, 0.03, { k: 0.92, rx: -0.2, ...CLOTHK }),
      Ee(0.17, 0.34, 0.07, hw, 0, -0.02, 0.09, { k: 0.8, ...CLOTHK }),
    ];
    for (let i = 0; i < 7; i++) {
      const x = (i - 3) * 0.026, side = Math.abs(i - 3) > 2;
      H.push(Tb([x, 0.16, side ? 0.0 : 0.08], [x * 1.2, -0.12 - (i % 3) * 0.05, side ? -0.02 : 0.1], 0.012, 0.004, i & 1 ? hw : hw2, { q: 6, n: 3, ...CLOTHK }));
    }
    L(u.head, H);
    const S = [Tb([0, 0.06, 0], [0, -0.62, 0.01], 0.17, 0.27, dress, { sz: 0.75, q: 20, n: 6, c: 1, ...CLOTHK })];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * 6.283, x = Math.sin(a) * 0.24, z = Math.cos(a) * 0.19;
      S.push(Ee(0.07, 0.14 + (i % 3) * 0.04, 0.012, dk(dress, 0.85), x, -0.66 - (i % 3) * 0.02, z, { k: 0.6, ry: a, ...CLOTHK }));
    }
    L(u.hips, S);
    claws(0xd8d0b8, 4, 0.08);
  } else {
    // прыгун: гребень позвонков, костяные шипы на локтях, удлинённая пасть с клыками, когти
    const sp = [];
    for (let i = 0; i < 7; i++) sp.push(Ee(0.035, 0.03, 0.045, BONE, 0, 0.46 - i * 0.075, 0.1 * D + 0.012 - Math.abs(i - 3) * 0.004, { ...OTHERK }));
    L(u.spine, sp);
    for (const [arm, side] of [[u.armL, -1], [u.armR, 1]]) L(arm, [Tb([side * 0.01, -0.27, 0.03], [side * 0.02, -0.3, 0.13], 0.018, 0.003, BONE, { q: 8, n: 3, ...OTHERK })]);
    L(u.jaw, [
      Ee(0.11, 0.05, 0.12, skin, 0, -0.035, -0.045, { k: 0.9, ...SKINK }),
      Tb([-0.028, -0.008, -0.088], [-0.03, 0.03, -0.092], 0.0065, 0.001, BONE, { q: 6, n: 3, ...OTHERK }),
      Tb([0.028, -0.008, -0.088], [0.03, 0.03, -0.092], 0.0065, 0.001, BONE, { q: 6, n: 3, ...OTHERK }),
    ]);
    L(u.head, [
      Tb([-0.028, 0.05, -0.078], [-0.03, 0.005, -0.084], 0.006, 0.001, BONE, { q: 6, n: 3, ...OTHERK }),
      Tb([0.028, 0.05, -0.078], [0.03, 0.005, -0.084], 0.006, 0.001, BONE, { q: 6, n: 3, ...OTHERK }),
    ]);
    claws(0xd8d0b8, 4, 0.11);
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

// тела вращения гранаты ПГ-7В: профиль [радиус, высота от хвоста], ось — +y (носом вперёд после поворота)
const lathe = pts => { const geo = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), 64); SMOOTH.add(geo); return geo; };
const PG7_HEAD = lathe([[0, 0], [0.021, 0], [0.024, 0.004], [0.042, 0.05], [0.0425, 0.058], [0.0425, 0.15], [0.041, 0.165], [0.037, 0.195], [0.031, 0.225], [0.024, 0.25], [0.016, 0.272], [0.0105, 0.285], [0, 0.285]]);
const PG7_FUZE = lathe([[0, 0], [0.0105, 0], [0.0098, 0.018], [0.0084, 0.034], [0.0062, 0.042], [0.003, 0.045], [0, 0.0455]]);

// граната ПГ-7В: z0 — откуда начинается видимая часть, летит в −z.
// open — оперение раскрыто (в полёте), иначе лопасти сложены вдоль маршевого двигателя
function pg7(g, y, z0, open) {
  const OL = 0x5a6440, OL2 = 0x454c30, AL = 0xb4b8bc;
  // маршевый двигатель
  cylZ(g, 0.021, 0.07, OL2, 0, y, z0 - 0.035, CYL12);
  cylZ(g, 0.0222, 0.006, dk(OL2, 0.75), 0, y, z0 - 0.012, CYL12);
  // кумулятивная часть: тело вращения, полоса маркировки, взрыватель
  part(g, 1, 1, 1, OL, 0, y, z0 - 0.07, -PI2, 0, 0, PG7_HEAD);
  cylZ(g, 0.0429, 0.01, 0x1c1c1a, 0, y, z0 - 0.07 - 0.1, CYL12);
  cylZ(g, 0.0429, 0.004, 0xb8a040, 0, y, z0 - 0.07 - 0.135, CYL12);
  part(g, 1, 1, 1, AL, 0, y, z0 - 0.07 - 0.285, -PI2, 0, 0, PG7_FUZE);
  if (!open) return;
  // хвост: стартовый двигатель, сопло, четыре лопасти, пламя
  cylZ(g, 0.021, 0.42, OL2, 0, y, z0 + 0.21, CYL12);
  part(g, 0.024, 0.05, 0.024, 0x2a2a28, 0, y, z0 + 0.445, -PI2, 0, 0, FRUST);
  for (let i = 0; i < 4; i++) {
    const a = i * PI2 + Math.PI / 4, s = sub(g, 0, y, z0 + 0.38, 0, 0, a);
    bext(s, [[-0.05, 0.02], [0.04, 0.02], [0.05, 0.075], [-0.01, 0.075]], 0.003, 0.0008, 0x3a4028);
  }
  part(g, 0.028, 0.2, 0.028, 0xffb040, 0, y, z0 + 0.57, PI2, 0, 0, CONE, 0xff7a10);
  part(g, 0.014, 0.12, 0.014, 0xfff0b0, 0, y, z0 + 0.53, PI2, 0, 0, CONE, 0xffe080);
}

// РПГ-7: ствол с утолщённой казённой частью и деревянными накладками, УСМ с рукоятью, ПГО-7 слева,
// раструб сзади. Ось трубы — y = 0.1, дуло — z = −0.56, раструб — до z = 0.395 (длина 0,95 м, как у настоящего)
function rpgModel(g, loaded) {
  const ST = 0x2c3034, ST2 = 0x3a3f44, ST3 = 0x202326, WD = 0x8a4a2a, WD2 = 0x6a3620, Y = 0.1;
  // ствол: дульная часть, кольцо, казённая часть под накладками, задняя часть, двойной раструб
  cylZ(g, 0.024, 0.34, ST, 0, Y, -0.39, CYL12);
  cylZ(g, 0.0275, 0.016, ST2, 0, Y, -0.552, CYL12);
  cylZ(g, 0.0175, 0.003, HOLE, 0, Y, -0.5615, CYL12);
  cylZ(g, 0.033, 0.36, ST, 0, Y, -0.04, CYL12);
  cylZ(g, 0.027, 0.12, ST, 0, Y, 0.24, CYL12);
  part(g, 0.042, 0.05, 0.042, ST2, 0, Y, 0.325, -PI2, 0, 0, FRUST);
  part(g, 0.058, 0.045, 0.058, ST2, 0, Y, 0.3725, -PI2, 0, 0, FRUST);
  cylZ(g, 0.0545, 0.004, dk(ST2, 0.8), 0, Y, 0.393, CYL12);
  cylZ(g, 0.05, 0.002, HOLE, 0, Y, 0.3962, CYL12);
  // деревянные накладки спереди и сзади от УСМ: хомуты, волокна
  cylZ(g, 0.042, 0.19, WD, 0, Y, -0.13, CYL12);
  cylZ(g, 0.042, 0.16, WD, 0, Y, 0.1, CYL12);
  for (const z of [-0.222, -0.038, 0.024, 0.176]) cylZ(g, 0.0438, 0.008, ST3, 0, Y, z, CYL12);
  for (const a of [-2.2, -1.1, -0.35, 0.45, 1.3, 2.5]) {
    const x = Math.sin(a) * 0.0421, y = Y + Math.cos(a) * 0.0421;
    part(g, 0.003, 0.17, 0.003, WD2, x, y, -0.13, PI2, 0, 0);
    part(g, 0.003, 0.14, 0.003, WD2, x, y, 0.1, PI2, 0, 0);
  }
  // мушка (откидная) и целик
  part(g, 0.014, 0.012, 0.03, ST3, 0, Y + 0.029, -0.5);
  part(g, 0.004, 0.034, 0.006, ST3, 0, Y + 0.05, -0.5);
  for (const x of [-0.006, 0.006]) part(g, 0.003, 0.02, 0.012, ST3, x, Y + 0.042, -0.5);
  part(g, 0.02, 0.012, 0.03, ST3, 0, Y + 0.039, -0.006);
  part(g, 0.016, 0.03, 0.004, ST2, 0, Y + 0.058, -0.004, -0.25);
  // ударно-спусковой механизм, рукоять, спуск, курок, предохранитель
  rp(g, 0.032, 0.034, 0.072, ST3, 0, Y - 0.042, -0.008, { c: 0.3 });
  grip(g, Y - 0.056, 0.016, 0x2a2420, 0.105, 0.032, 0.048, 0.22);
  trigger(g, -0.026, Y - 0.056);
  part(g, 0.008, 0.014, 0.012, ST2, 0.019, Y - 0.034, 0.012);
  part(g, 0.006, 0.006, 0.016, ST2, -0.019, Y - 0.046, -0.02);
  // ПГО-7: кронштейн, корпус, объектив, окуляр с наглазником, барабанчики
  part(g, 0.03, 0.018, 0.05, ST3, -0.038, Y + 0.014, -0.006);
  rp(g, 0.032, 0.052, 0.13, 0x24282a, -0.068, Y + 0.036, 0, { c: 0.28 });
  cylZ(g, 0.016, 0.03, ST3, -0.068, Y + 0.046, -0.078, CYL12);
  part(g, 0.013, 0.003, 0.013, 0x5a8ac0, -0.068, Y + 0.046, -0.0935, PI2, 0, 0, CYL12, 0x102850);
  cylZ(g, 0.014, 0.04, ST3, -0.068, Y + 0.046, 0.085, CYL12);
  cylZ(g, 0.019, 0.035, 0x141414, -0.068, Y + 0.046, 0.12, CYL12);
  cyl(g, 0.009, 0.012, ST2, -0.068, Y + 0.067, -0.012);
  cyl(g, 0.008, 0.01, ST2, -0.088, Y + 0.036, 0.012, 0, 0, PI2);
  // антабки ремня
  part(g, 0.006, 0.018, 0.012, ST3, 0, Y - 0.032, -0.45);
  part(g, 0.006, 0.018, 0.012, ST3, 0, Y - 0.035, 0.215);
  if (loaded) pg7(g, Y, -0.56, false);
}

const BUILD = {
  rpg(g) { rpgModel(g, true); },
  rpg_e(g) { rpgModel(g, false); },
  // выстрел ПГ-7В целиком: граната со сложенным оперением и пороховой заряд
  rocket(g) {
    pg7(g, 0, 0.1, false);
    cylZ(g, 0.021, 0.36, 0x454c30, 0, 0, 0.28, CYL12);
    cylZ(g, 0.024, 0.2, 0x8a7a52, 0, 0, 0.3, CYL12);
    for (const z of [0.21, 0.39]) cylZ(g, 0.0245, 0.01, 0x5a4e34, 0, 0, z, CYL12);
  },
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
    // АС «Вал»: размеры близки к настоящему (875 мм с прикладом). Ось ствола — y = 0.012, дуло — z = −0.485.
    const BL = 0x26292c, BL2 = 0x303438, BL3 = 0x1c1e20, RV = 0x50555a, PL = 0x6e3a2c, PL2 = 0x4c2519, RUB = 0x161616, Y0 = 0.012;
    // интегрированный глушитель: корпус, торец с отверстием, пояски
    cylZ(g, 0.0215, 0.32, BL, 0, Y0, -0.322, CYL12);
    cylZ(g, 0.0205, 0.008, BL2, 0, Y0, -0.486, CYL12);
    cylZ(g, 0.0078, 0.004, HOLE, 0, Y0, -0.4905, CYL12);
    cylZ(g, 0.0222, 0.012, BL2, 0, Y0, -0.47, CYL12);
    cylZ(g, 0.0222, 0.01, BL2, 0, Y0, -0.29, CYL12);
    // мушка: хомут на глушителе, основание, намушник с ушками, столбик
    cylZ(g, 0.0232, 0.022, BL3, 0, Y0, -0.452, CYL12);
    bext(g, [[-0.462, Y0 + 0.02], [-0.442, Y0 + 0.02], [-0.446, Y0 + 0.034], [-0.458, Y0 + 0.034]], 0.014, 0.002, BL3);
    for (const x of [-0.0075, 0.0075]) bext(g, [[-0.46, Y0 + 0.03], [-0.444, Y0 + 0.03], [-0.446, Y0 + 0.052], [-0.458, Y0 + 0.052]], 0.0035, 0.0008, BL3, x);
    part(g, 0.003, 0.016, 0.004, BL3, 0, Y0 + 0.042, -0.452);
    // цевьё из полимера «слива»: охватывает глушитель, снизу глубже, с продольной выемкой
    cylZ(g, 0.027, 0.133, PL, 0, Y0, -0.2185, CYL12);
    part(g, 0.027, 0.012, 0.027, PL, 0, Y0, -0.291, -PI2, 0, 0, FRUST);
    bext(g, [[-0.285, Y0], [-0.152, Y0], [-0.152, -0.044], [-0.27, -0.03], [-0.285, -0.018]], 0.054, 0.007, PL);
    for (const s of [-1, 1]) bext(g, [[-0.262, -0.002], [-0.168, -0.002], [-0.168, -0.022], [-0.262, -0.016]], 0.003, 0.001, PL2, s * 0.0262);
    // секторный целик: колодка, наклонная планка, хомутик, прорезь
    bext(g, [[-0.17, 0.036], [-0.118, 0.036], [-0.122, 0.05], [-0.166, 0.05]], 0.03, 0.003, BL3);
    rp(g, 0.024, 0.004, 0.06, BL2, 0, 0.054, -0.142, { c: 0.15, rx: -0.06 });
    rp(g, 0.028, 0.012, 0.012, BL3, 0, 0.057, -0.154, { c: 0.25 });
    for (const x of [-0.0085, 0.0085]) part(g, 0.006, 0.012, 0.006, BL3, x, 0.061, -0.116);
    // ствольная коробка: штампованный корпус, крышка с рёбрами и кнопкой, выштамповки и заклёпки
    bext(g, [[-0.152, 0.024], [0.098, 0.024], [0.098, -0.03], [0.07, -0.042], [-0.152, -0.042]], 0.034, 0.003, BL);
    rz(g, 0.032, 0.236, 0.02, BL2, 0, 0.032, -0.03, { c: 0.48, b: 0.45 });
    for (let i = 0; i < 5; i++) rz(g, 0.0328, 0.004, 0.0205, BL3, 0, 0.032, 0.03 + i * 0.012, { c: 0.48, b: 0.45 });
    bext(g, [[0.088, 0.026], [0.1, 0.026], [0.1, 0.044], [0.093, 0.044]], 0.012, 0.002, BL3);
    for (const s of [-1, 1]) {
      bext(g, [[-0.12, 0.016], [0.06, 0.016], [0.06, -0.026], [-0.12, -0.026]], 0.002, 0.0006, BL2, s * 0.0176);
      for (const [z, y] of [[-0.14, 0.012], [-0.128, -0.002], [-0.14, -0.016], [0.078, 0.01], [0.09, -0.006], [0.078, -0.022]]) cyl(g, 0.0035, 0.005, RV, s * 0.0175, y, z, 0, 0, PI2);
      rp(g, 0.004, 0.012, 0.03, BL2, s * 0.0168, -0.031, -0.1, { c: 0.5, b: 0.5 });
    }
    // правый бок: окно выброса, рукоятка затвора, флажок предохранителя-переводчика
    part(g, 0.003, 0.014, 0.06, HOLE, 0.0186, 0.012, 0.01);
    cyl(g, 0.005, 0.034, BL2, 0.034, 0.018, -0.035, 0, 0, PI2);
    part(g, 0.011, 0.011, 0.011, BL2, 0.052, 0.018, -0.035, 0, 0, 0, ICO1);
    bext(g, [[-0.034, 0.002], [0.074, 0.01], [0.074, 0.0], [-0.034, -0.008]], 0.003, 0.0008, BL3, 0.0195);
    part(g, 0.009, 0.012, 0.006, BL3, 0.0235, -0.003, -0.034);
    cyl(g, 0.006, 0.004, BL3, 0.0198, 0.005, 0.074, 0, 0, PI2);
    // левый бок: планка под оптику
    bext(g, [[-0.11, 0.008], [0.03, 0.008], [0.03, -0.012], [-0.11, -0.012]], 0.005, 0.0012, BL2, -0.0195);
    for (const y of [0.003, -0.007]) part(g, 0.002, 0.002, 0.136, BL3, -0.0222, y, -0.04);
    for (let i = 0; i < 6; i++) part(g, 0.002, 0.016, 0.003, BL3, -0.0222, -0.002, -0.1 + i * 0.024);
    // горловина магазина и защёлка
    bext(g, [[-0.136, -0.042], [-0.066, -0.042], [-0.07, -0.058], [-0.132, -0.058]], 0.036, 0.003, BL);
    bext(g, [[-0.062, -0.044], [-0.054, -0.044], [-0.052, -0.07], [-0.058, -0.072]], 0.012, 0.0015, BL3);
    // магазин 9×39 на 20 патронов: три изогнутые секции с рёбрами и пятка
    const m1 = sub(g, 0, -0.056, -0.101, 0.1);
    bext(m1, [[-0.03, 0], [0.03, 0], [0.029, -0.046], [-0.031, -0.046]], 0.03, 0.003, PL);
    const m2 = sub(m1, 0, -0.044, -0.001, 0.1);
    bext(m2, [[-0.031, 0.001], [0.029, 0.001], [0.028, -0.046], [-0.032, -0.046]], 0.03, 0.003, PL);
    const m3 = sub(m2, 0, -0.044, -0.001, 0.1);
    bext(m3, [[-0.032, 0.001], [0.028, 0.001], [0.027, -0.03], [-0.033, -0.03]], 0.03, 0.003, PL);
    bext(m3, [[-0.036, -0.026], [0.031, -0.026], [0.031, -0.04], [-0.036, -0.04]], 0.034, 0.003, PL2);
    for (const mm of [m1, m2]) for (const s of [-1, 1]) bext(mm, [[-0.02, -0.007], [0.017, -0.007], [0.017, -0.038], [-0.02, -0.038]], 0.003, 0.001, PL2, s * 0.0155);
    // штампованная спусковая скоба и крючок
    rp(g, 0.012, 0.03, 0.007, BL2, 0, -0.058, -0.049, { c: 0.3 });
    rp(g, 0.012, 0.007, 0.066, BL2, 0, -0.075, -0.017, { c: 0.3, rx: 0.06 });
    rp(g, 0.012, 0.02, 0.007, BL2, 0, -0.066, 0.014, { c: 0.3 });
    rp(g, 0.006, 0.024, 0.007, BL3, 0, -0.053, -0.025, { c: 0.3, rx: -0.35 });
    // рукоять как у АК-74: скруглённая, с бороздками по бокам
    const gr = sub(g, 0, -0.04, 0.036, -0.28);
    bext(gr, [[-0.022, 0.004], [0.026, 0.004], [0.03, -0.04], [0.028, -0.104], [-0.018, -0.108], [-0.024, -0.06]], 0.032, 0.008, PL);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) part(gr, 0.002, 0.07, 0.003, PL2, s * 0.0159, -0.056, -0.012 + i * 0.008);
    // шарнир складного приклада с осью и кнопкой
    bext(g, [[0.096, 0.02], [0.13, 0.016], [0.13, -0.036], [0.096, -0.04]], 0.036, 0.004, BL2);
    cyl(g, 0.007, 0.05, BL3, -0.019, -0.01, 0.118);
    cyl(g, 0.006, 0.006, RV, 0.0195, -0.01, 0.112, 0, 0, PI2);
    // рама приклада из гнутой трубки и затыльник: стальная пластина и резиновая накладка
    const T = 0.0062;
    tube(g, 0.13, 0.004, 0.368, -0.008, T, BL2);
    tube(g, 0.13, -0.03, 0.368, -0.118, T, BL2);
    tube(g, 0.368, -0.008, 0.368, -0.118, T, BL2);
    for (const [z, y] of [[0.368, -0.008], [0.368, -0.118]]) part(g, T, T, T, BL2, 0, y, z, 0, 0, 0, ICO1);
    bext(g, [[0.366, 0.004], [0.378, 0.006], [0.38, -0.128], [0.366, -0.13]], 0.034, 0.004, BL2);
    bext(g, [[0.378, 0.006], [0.388, 0.004], [0.394, -0.03], [0.395, -0.1], [0.389, -0.128], [0.378, -0.128]], 0.036, 0.006, RUB);
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

// готовые модели (assets/models): масштаб, сдвиг (прицельная линия — на 0,1 выше начала координат, как ждёт
// прицеливание), подъём самых тёмных цветов, чтобы чёрный пластик и воронение не сливались в силуэт
// и все они увеличены в GUN_K раз — в руках так нагляднее; прицельная линия при этом остаётся на 0,1
export const GUN_K = 1.3;
export const gunFitY = y => y * GUN_K - 0.1 * (GUN_K - 1);
const GUN_FIT = {
  rifle: { s: 1, off: [0, -0.033, 0], lift: 0.006 },
  qbz: { s: 1, off: [0, -0.057, 0], lift: 0.016 },
  asval: { s: 0.885, off: [0, -0.02, 0], lift: 0.006 },
};

function fittedGun(geo, f) {
  const g = geo.clone();
  g.scale(f.s, f.s, f.s);
  g.translate(...f.off);
  g.scale(GUN_K, GUN_K, GUN_K);
  g.translate(0, -0.1 * (GUN_K - 1), 0);
  const c = g.attributes.color;
  for (let i = 0; i < c.array.length; i++) c.array[i] = c.array[i] + f.lift * (1 - c.array[i]);
  g.computeBoundingSphere();
  g.userData.shared = true;
  return { geo: g, glow: [], shiny: true };
}

const itemCache = new Map();
export function itemModel(id) {
  const key = BUILD[id] || GUN_FIT[id] ? id : 'scrap';
  let c = itemCache.get(key);
  if (!c) {
    const lg = GUN_FIT[key] && gunGeo(key);
    if (lg) c = fittedGun(lg, GUN_FIT[key]);
    else {
      const g = new THREE.Group();
      (BUILD[key] || BUILD.rifle)(g);
      c = bakeParts(g, 0.04, true);
    }
    itemCache.set(key, c);
  }
  return fromBaked(c);
}

// летящая граната: оперение раскрыто, сзади пламя (светящиеся детали — отдельными мешами)
let rocketBaked = null;
export function rocketModel() {
  if (!rocketBaked) { const g = new THREE.Group(); pg7(g, 0, 0, true); rocketBaked = bakeParts(g, 0.04, true); }
  const m = fromBaked(rocketBaked);
  m.userData.flames = m.children.slice(1).map(f => ({ m: f, s: f.scale.clone() }));
  return m;
}

// ---------- руки от первого лица ----------
// Кисть собрана как настоящая: ладонь с подушками и сухожилиями, костяшки, пальцы по фалангам (капсулы
// со сгибом в каждом суставе), ногти, большой палец со своей осью вращения. Всё с гладким затенением.
// Система кисти: пальцы вдоль −z, тыльная сторона +y, ладонь −y, запястье +z;
// side = 1 — правая (большой палец у −x), −1 — левая.

// смешать два цвета: t = 0 — a, 1 — b
function mix(a, b, t) {
  const c = k => Math.round(((a >> k) & 255) * (1 - t) + ((b >> k) & 255) * t);
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

const smoothCache = new Map();
function cachedGeo(key, make) {
  let g = smoothCache.get(key);
  if (!g) { g = make(); SMOOTH.add(g); smoothCache.set(key, g); }
  return g;
}

// капсула: радиус r, длина цилиндрической части len, ось — y
const capsGeo = (r, len) => cachedGeo(`c${r.toFixed(4)}:${len.toFixed(4)}`, () => new THREE.CapsuleGeometry(r, Math.max(0.0005, len), 8, 22));

// «скруглённый брусок» (суперэллипсоид): k = 1 — эллипсоид, меньше — ближе к бруску;
// tx/ty — сужение сечения к +z. Нормали считаются точно (градиент поверхности), без шва
function blobGeo(w, h, d, k, tx, ty) {
  return cachedGeo(`b${[w, h, d, k, tx, ty].map(v => v.toFixed(4)).join(',')}`, () => {
    const g = new THREE.SphereGeometry(1, 32, 22);
    const P = g.attributes.position, Nn = g.attributes.normal, m = 2 / k;
    const a = w / 2, b = h / 2, c = d / 2;
    const f = (v, s) => Math.sign(v) * Math.abs(v) ** k * s;
    const gr = (v, s) => Math.sign(v) * Math.abs(v / s) ** (m - 1) / s;
    for (let i = 0; i < P.count; i++) {
      let x = f(P.getX(i), a), y = f(P.getY(i), b);
      const z = f(P.getZ(i), c);
      let nx = gr(x, a), ny = gr(y, b);
      const nz = gr(z, c);
      const t = z / d + 0.5, sx = 1 + (tx - 1) * t, sy = 1 + (ty - 1) * t;
      x *= sx; y *= sy; nx /= sx; ny /= sy;
      const l = Math.hypot(nx, ny, nz) || 1;
      P.setXYZ(i, x, y, z);
      Nn.setXYZ(i, nx / l, ny / l, nz / l);
    }
    return g;
  });
}

// усечённый конус вдоль +z от 0 до len (радиусы r0 → r1), без торцов
const coneGeo = (r0, r1, len) => cachedGeo(`f${[r0, r1, len].map(v => v.toFixed(4)).join(',')}`, () => {
  const g = new THREE.CylinderGeometry(r1, r0, len, 40, 6, true);
  g.rotateX(PI2);
  g.translate(0, 0, len / 2);
  return g;
});

// складка рукава: тор вокруг оси z
const foldGeo = (R, t) => cachedGeo(`t${R.toFixed(4)}:${t.toFixed(4)}`, () => new THREE.TorusGeometry(R, t, 10, 48));

function blob(p, w, h, d, hex, x, y, z, o = {}) {
  const m = new THREE.Mesh(blobGeo(w, h, d, o.k ?? 0.7, o.tx ?? 1, o.ty ?? 1), M(hex));
  m.position.set(x, y, z);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  p.add(m);
  return m;
}

// фаланга: капсула радиуса r от сустава (начало координат) вдоль −z на длину len; sx/sy — овал сечения.
// У концевой фаланги (tip) скругление заканчивается ровно на кончике
function phal(p, r, len, hex, tip, sx = 1.08, sy = 0.9) {
  const cyl = tip ? Math.max(0.001, len - r) : len;
  const m = new THREE.Mesh(capsGeo(r, cyl), M(hex));
  m.rotation.x = PI2;
  m.scale.set(sx, 1, sy);
  m.position.z = -cyl / 2;
  p.add(m);
  return m;
}

// пальцы правой руки: x и z костяшки, радиус, длины фаланг, развод (у левой — зеркально)
const FINGERS = [
  { x: -0.0285, z: -0.043, r: 0.0091, L: [0.041, 0.024, 0.02], spl: -0.07 },
  { x: -0.0095, z: -0.046, r: 0.0094, L: [0.045, 0.028, 0.021], spl: -0.01 },
  { x: 0.0095, z: -0.044, r: 0.0089, L: [0.042, 0.026, 0.02], spl: 0.05 },
  { x: 0.027, z: -0.038, r: 0.0077, L: [0.033, 0.02, 0.018], spl: 0.12 },
];
const PHAL_R = [1, 0.93, 0.86];

// кисть в позе pose: curl — сгиб каждого пальца по суставам [осн, сред, конц] (рад, к ладони),
// spread — развод пальцев, thumb — { yaw: отвод, pitch: к ладони, roll: разворот ногтя, c: сгибы [пясть, осн, конц] }
function hand(p, side, skin, pose) {
  const h = new THREE.Group();
  p.add(h);
  const palm = mix(skin, 0xf0c2ac, 0.14), knuckle = mix(skin, 0xc4826c, 0.14), nail = mix(skin, 0xf8e2dc, 0.62), crease = mix(skin, 0x9a5a48, 0.16);
  // ладонь: к запястью уже и тоньше; невысокие подушки под пальцами, у большого пальца и у мизинца
  blob(h, 0.082, 0.027, 0.094, skin, 0, 0, 0, { k: 0.6, tx: 0.8, ty: 0.88 });
  blob(h, 0.074, 0.01, 0.024, palm, 0.001 * side, -0.0085, -0.034, { k: 0.85 });
  blob(h, 0.03, 0.02, 0.056, palm, -side * 0.02, -0.0065, 0.014, { k: 0.85, ry: side * 0.3 });
  blob(h, 0.022, 0.012, 0.058, palm, side * 0.028, -0.0072, 0.008, { k: 0.85 });
  // костяшки на тыльной стороне
  for (const F of FINGERS) blob(h, 0.019, 0.012, 0.02, knuckle, F.x * side, 0.0075, F.z + 0.004, { k: 0.9 });
  // пальцы
  FINGERS.forEach((F, i) => {
    const c = pose.curl[i];
    let j = sub(h, F.x * side, 0.001, F.z, 0, -F.spl * side * (pose.spread ?? 1), 0);
    for (let s = 0; s < 3; s++) {
      const r = F.r * PHAL_R[s], L = F.L[s];
      j = sub(j, 0, 0, s ? -F.L[s - 1] : 0, -(c[s] || 0), 0, 0);
      phal(j, r, L, skin, s === 2);
      // складка на сгибе и ноготь
      if (s) blob(j, r * 1.9, r * 1.2, r * 0.5, crease, 0, -r * 0.2, r * 0.05, { k: 0.9 });
      if (s === 2) blob(j, r * 1.45, r * 0.4, L * 0.6, nail, 0, r * 0.76, -L * 0.6, { k: 0.72, rx: -0.06 });
    }
  });
  // большой палец: своя ось — отведён в сторону и развёрнут ногтем наружу
  const T = pose.thumb || {};
  const t0 = sub(h, -side * 0.02, -0.007, 0.03, 0, (T.yaw ?? 0.55) * side, 0);
  const t1 = sub(t0, 0, 0, 0, -(T.pitch ?? 0.35), 0, 0);
  let j = sub(t1, 0, 0, 0, 0, 0, (T.roll ?? 1.0) * side);
  const TL = [0.04, 0.03, 0.027], TR = [0.0142, 0.0108, 0.0098], tc = T.c || [0, 0.2, 0.2];
  for (let s = 0; s < 3; s++) {
    j = sub(j, 0, 0, s ? -TL[s - 1] : 0, -(tc[s] || 0), 0, 0);
    phal(j, TR[s], TL[s], skin, s === 2, 1.1, 0.95);
    if (s === 2) blob(j, TR[s] * 1.5, TR[s] * 0.4, TL[s] * 0.58, nail, 0, TR[s] * 0.8, -TL[s] * 0.6, { k: 0.72, rx: -0.06 });
  }
  return h;
}

// повернуть группу так, чтобы её оси x, y, z смотрели вдоль данных векторов
function basis(g, xv, yv, zv) {
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...xv), new THREE.Vector3(...yv), new THREE.Vector3(...zv)));
}

// точка запястья кисти в системе её родителя
function wristOf(h) {
  h.updateMatrix();
  return new THREE.Vector3(0, -0.002, 0.05).applyMatrix4(h.matrix);
}

// предплечье: запястье, кожа, подвёрнутая манжета и рукав со складками; группа смотрит вдоль +z от запястья к локтю
function forearm(p, skin, sleeve, x, y, z, rx, ry) {
  const a = sub(p, x, y, z, rx, ry, 0);
  const cuff = dk(sleeve, 0.78), fold = dk(sleeve, 0.86);
  blob(a, 0.06, 0.03, 0.07, skin, 0, 0, 0.01, { k: 0.8, tx: 0.92 });
  const fa = new THREE.Mesh(coneGeo(0.0245, 0.033, 0.12), M(skin));
  fa.scale.set(1.18, 0.82, 1);
  fa.position.z = 0.0;
  a.add(fa);
  const cf = new THREE.Mesh(coneGeo(0.039, 0.042, 0.04), M(cuff));
  cf.scale.set(1.12, 0.92, 1);
  cf.position.z = 0.06;
  a.add(cf);
  const lip = new THREE.Mesh(foldGeo(0.039, 0.0055), M(cuff));
  lip.scale.set(1.12, 0.92, 1);
  lip.position.z = 0.061;
  a.add(lip);
  const sl = new THREE.Mesh(coneGeo(0.043, 0.053, 0.4), M(sleeve));
  sl.scale.set(1.12, 0.94, 1);
  sl.position.z = 0.095;
  a.add(sl);
  [[0.15, 0.12], [0.22, -0.16], [0.3, 0.1], [0.39, -0.08]].forEach(([fz, tilt], i) => {
    const r = 0.043 + (fz - 0.095) / 0.4 * 0.01;
    const f = new THREE.Mesh(foldGeo(r, 0.0042 + (i & 1) * 0.001), M(fold));
    f.scale.set(1.12, 0.94, 1);
    f.position.z = fz;
    f.rotation.x = tilt;
    a.add(f);
  });
}

// правая кисть на пистолетной рукояти (рамка наклонена вместе с рукоятью):
// ладонь справа и сзади рукояти, пальцы обхватывают переднюю грань, указательный — у спуска, большой — слева на рамке
function gripHand(p, skin, sleeve, y, z, rake) {
  const G = sub(p, 0, y, z, -rake);
  const h = hand(G, 1, skin, {
    curl: [[0.55, 0.85, 0.35], [1.45, 1.3, 0.55], [1.5, 1.3, 0.55], [1.5, 1.25, 0.5]], spread: 0.25,
    thumb: { yaw: 0.85, pitch: 0.55, roll: 1.25, c: [0.25, 0.35, 0.15] },
  });
  h.position.set(0.033, -0.05, 0.016);
  basis(h, [0, -1, 0], [1, 0, 0], [0, 0, 1]);
  const w = wristOf(h);
  forearm(G, skin, sleeve, w.x, w.y, w.z, 0.35 + rake, 0.22);
}

// левая кисть под цевьём: ладонь снизу-слева, пальцы обхватывают правую сторону, большой палец вдоль левой
function supportHand(p, skin, sleeve, y, z) {
  const S = sub(p, 0, y, z);
  const h = hand(S, -1, skin, {
    curl: [[1.0, 0.75, 0.4], [1.05, 0.8, 0.4], [1.1, 0.8, 0.4], [1.15, 0.8, 0.4]], spread: 0.2,
    thumb: { yaw: 0.35, pitch: 0.05, roll: 1.0, c: [0, 0.15, 0.1] },
  });
  h.position.set(-0.018, -0.012, 0.004);
  basis(h, [0, 0, -1], [0, -1, 0], [-1, 0, 0]);
  h.rotateZ(-0.35);
  const w = wristOf(h);
  forearm(S, skin, sleeve, w.x, w.y, w.z, 0.45, -0.6);
}

// кулак вокруг рукояти, идущей вдоль z: тыльная сторона справа, пальцы снизу, большой палец сверху
function fistOnHandle(p, skin, sleeve, z) {
  const Hd = sub(p, 0, 0, z);
  const h = hand(Hd, 1, skin, {
    curl: [[1.35, 1.45, 0.75], [1.4, 1.5, 0.75], [1.45, 1.5, 0.75], [1.5, 1.45, 0.7]], spread: 0.15,
    thumb: { yaw: 0.6, pitch: 0.75, roll: 1.2, c: [0.3, 0.45, 0.3] },
  });
  h.position.set(0.03, 0.006, 0);
  basis(h, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  h.rotateX(0.5);
  const w = wristOf(h);
  forearm(Hd, skin, sleeve, w.x, w.y, w.z, 0.45, 0.25);
}

// раскрытая ладонь вверх под едой, лекарствами и блоками
function palmHand(p, skin, sleeve, y) {
  const P = sub(p, 0.02, y, 0.03);
  const h = hand(P, 1, skin, {
    curl: [[0.18, 0.22, 0.1], [0.15, 0.2, 0.1], [0.2, 0.22, 0.1], [0.28, 0.25, 0.12]], spread: 1,
    thumb: { yaw: 0.65, pitch: 0.25, roll: 1.0, c: [0, 0.1, 0.1] },
  });
  h.position.set(0, -0.006, -0.005);
  basis(h, [-1, 0, 0], [0, -1, 0], [0, 0, 1]);
  const w = wristOf(h);
  forearm(P, skin, sleeve, w.x, w.y, w.z, 0.5, 0.2);
}

const VM_GRIP = { pistol: [-0.008, 0.032, 0.28], smg: [-0.03, 0.04, 0.28], shotgun: [-0.004, 0.125, 0.95], rifle: [0.0, -0.01, 0.32], qbz: [-0.018, -0.026, 0.46], asval: [0.023, -0.008, 0.36], sniper: [-0.04, 0.085, 0.35], rpg: [0.044, 0.016, 0.22], rpg_e: [0.044, 0.016, 0.22] };
const VM_SUPPORT = { smg: [-0.05, -0.17], shotgun: [-0.056, -0.33], rifle: [0.02, -0.31], qbz: [0.004, -0.27], asval: [0.042, -0.215], sniper: [-0.062, -0.22], rpg: [0.043, -0.15], rpg_e: [0.043, -0.15] };
// точки хвата у увеличенных готовых моделей
for (const id in GUN_FIT) {
  const gr = VM_GRIP[id], sp = VM_SUPPORT[id];
  VM_GRIP[id] = [gunFitY(gr[0]), gr[1] * GUN_K, gr[2]];
  VM_SUPPORT[id] = [gunFitY(sp[0]), sp[1] * GUN_K];
}
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
  return fromBaked(bakeParts(g, 0, 'skin'));
}

// кулак в стойке: пальцы сжаты в ладонь, большой палец поверх среднего и указательного, костяшки вперёд
export function makeFist(side, skin, sleeve) {
  const g = new THREE.Group();
  const h = hand(g, side, skin, {
    curl: [[1.5, 1.75, 0.95], [1.55, 1.8, 0.95], [1.55, 1.75, 0.95], [1.5, 1.7, 0.9]], spread: 0.1,
    thumb: { yaw: 0.15, pitch: 0.55, roll: 1.35, c: [0.25, 0.95, 0.7] },
  });
  h.scale.setScalar(1.15);
  // сжатая кисть ниже раскрытой — поднимаем, чтобы в стойке кулаки были видны целиком
  h.position.set(0, 0.055, 0.01);
  h.rotation.set(0.18, 0, 0);
  const w = wristOf(h);
  forearm(g, skin, sleeve, w.x, w.y, w.z, 0.62, 0);
  return fromBaked(bakeParts(g, 0, 'skin'));
}

export const GUN_IDS = new Set(['pistol', 'smg', 'shotgun', 'rifle', 'qbz', 'asval', 'sniper', 'rpg', 'rpg_e', 'knife', 'bat', 'axe', 'pickaxe', 'iaxe', 'ipick', 'machete', 'hammer']);

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
