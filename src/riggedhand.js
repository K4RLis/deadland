// Готовая кисть со скелетом (assets/models/hand.bin + текстуры, см. tools/convert-model.mjs): позы пальцев
// выставляются поворотом суставов вокруг оси сгиба и один раз запекаются в обычную сетку (скиннинг на процессоре).
// Система кисти та же, что у процедурной: центр ладони в начале координат, пальцы вдоль −z, тыльная сторона +y.
// Модель — правая кисть; левая получается зеркалом.
import * as THREE from 'three';
import { VERSION } from './config.js';

let D = null, MAT = null;
// средний цвет кожи на текстуре — для предплечья, чтобы на запястье не было шва
export const RIG_SKIN = 0xb98068;

export const rigReady = () => !!D;

export async function loadHand() {
  try {
    const v = window.BUILD || VERSION;
    const r = await fetch(`assets/models/hand.bin?v=${v}`);
    if (!r.ok) throw new Error(r.status);
    const parsed = parseHand(await r.arrayBuffer());
    const tl = new THREE.TextureLoader();
    const tex = n => new Promise((res, rej) => tl.load(`assets/models/${n}?v=${v}`, res, undefined, rej));
    const [alb, nrm, rgh] = await Promise.all([tex('hand_albedo.jpg'), tex('hand_normal.jpg'), tex('hand_rough.jpg')]);
    alb.colorSpace = THREE.SRGBColorSpace;
    for (const t of [alb, nrm, rgh]) t.anisotropy = 4;
    // текстура с запечённым затенением темнее процедурной кожи — материал чуть высветлен
    MAT = new THREE.MeshStandardMaterial({ map: alb, normalMap: nrm, roughnessMap: rgh, roughness: 1, metalness: 0 });
    MAT.color.setScalar(1.45);
    D = parsed;
  } catch (e) { console.warn('кисть', e); }
}

function parseHand(ab) {
  const dv = new DataView(ab), hl = dv.getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, hl)));
  const base = (4 + hl + 3) & ~3;
  const arr = (T, k) => new T(ab, base + h.parts[k][0], h.parts[k][1]);
  const qp = arr(Int16Array, 'pos'), pos = new Float32Array(qp.length);
  for (let i = 0; i < qp.length; i++) pos[i] = h.min[i % 3] + (qp[i] + 32768) / 65535 * h.size[i % 3];
  const qn = arr(Int8Array, 'nor'), nor = new Float32Array(qn.length);
  for (let i = 0; i < qn.length; i++) nor[i] = qn[i] / 127;
  const qu = arr(Uint16Array, 'uv'), uv = new Float32Array(qu.length);
  for (let i = 0; i < qu.length; i++) uv[i] = qu[i] / 65535;
  const W = h.bones.map(b => new THREE.Matrix4().fromArray(b.m));
  const names = h.bones.map(b => b.name), parent = h.bones.map(b => b.parent);
  const L = W.map((w, i) => parent[i] >= 0 ? W[parent[i]].clone().invert().multiply(w) : w.clone());
  // ось сгиба сустава (в его локальной системе): перпендикуляр к фаланге и к ладони (−y)
  const P = W.map(w => new THREE.Vector3().setFromMatrixPosition(w));
  const Q = W.map(w => { const q = new THREE.Quaternion(); w.decompose(new THREE.Vector3(), q, new THREE.Vector3()); return q; });
  const child = names.map((_, i) => parent.indexOf(i));
  const axis = (i, toward) => {
    const c = child[i];
    const d = (c >= 0 ? P[c].clone().sub(P[i]) : P[i].clone().sub(P[parent[i]])).normalize();
    const a = new THREE.Vector3().crossVectors(d, toward).normalize();
    return a.applyQuaternion(Q[i].clone().invert());
  };
  const idx = n => names.indexOf(n);
  const FING = ['INDEX', 'MIDDLE_F', 'RING', 'PINK'].map(f => ['BASE', 'MID', 'TOP'].map(s => idx(`${f}_${s}_joint`)));
  const palm = new THREE.Vector3(0, -1, 0);
  const flex = FING.map(ch => ch.map(i => axis(i, palm)));
  const spreadAx = FING.map(ch => new THREE.Vector3(0, 1, 0).applyQuaternion(Q[ch[0]].clone().invert()));
  // большой палец сгибается к ладони и к указательному
  const TH = ['BASE', 'MID', 'TOP'].map(s => idx(`THUMB_${s}_joint`));
  const toIdx = P[FING[0][0]].clone().sub(P[TH[0]]).normalize().add(palm).normalize();
  const tflex = TH.map(i => axis(i, toIdx));
  const tswing = new THREE.Vector3(0, 1, 0).applyQuaternion(Q[TH[0]].clone().invert());
  const ttwist = (() => { const d = P[TH[1]].clone().sub(P[TH[0]]).normalize(); return d.applyQuaternion(Q[TH[0]].clone().invert()); })();
  return {
    pos, nor, uv, skin: arr(Uint8Array, 'skin'), wgt: arr(Uint8Array, 'wgt'), idx: (h.big ? arr(Uint32Array, 'idx') : arr(Uint16Array, 'idx')),
    W, L, parent, FING, flex, spreadAx, TH, tflex, tswing, ttwist,
  };
}

const cache = new Map(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _n = new THREE.Vector3();

// поза — как у процедурной кисти: curl[палец] = [осн, сред, конц] (рад), spread; большой палец — pose.rt
export function riggedHand(side, pose) {
  if (!D) return null;
  const key = side + JSON.stringify(pose);
  let geo = cache.get(key);
  if (!geo) { geo = bake(side, pose); cache.set(key, geo); }
  const m = new THREE.Mesh(geo, MAT);
  m.userData.keep = true;
  return m;
}

// мировые матрицы суставов в позе
function posedWorlds(pose) {
  const n = D.W.length, Lp = D.L.map(l => l.clone());
  const rot = (i, ax, a) => { if (a) Lp[i].multiply(_m.makeRotationFromQuaternion(_q.setFromAxisAngle(ax, a))); };
  D.FING.forEach((ch, f) => {
    const c = pose.curl[f] || [0, 0, 0];
    rot(ch[0], D.spreadAx[f], (f - 1.4) * -0.07 * ((pose.spread ?? 1) - 1));
    ch.forEach((i, s) => rot(i, D.flex[f][s], c[s] || 0));
  });
  // большой палец: у этой модели свои параметры (pose.rt): swing — к ладони вокруг её нормали,
  // twist — разворот вдоль пальца, flex — сгиб в трёх суставах
  const rt = pose.rt || { swing: 0, twist: 0, flex: [0, 0.15, 0.15] };
  rot(D.TH[0], D.tswing, rt.swing || 0);
  rot(D.TH[0], D.ttwist, rt.twist || 0);
  rot(D.TH[0], D.tflex[0], rt.flex[0] || 0);
  rot(D.TH[1], D.tflex[1], rt.flex[1] || 0);
  rot(D.TH[2], D.tflex[2], rt.flex[2] || 0);
  const Wp = new Array(n);
  for (let i = 0; i < n; i++) Wp[i] = D.parent[i] >= 0 ? null : Lp[i].clone();
  const done = i => { if (!Wp[i]) Wp[i] = done(D.parent[i]).clone().multiply(Lp[i]); return Wp[i]; };
  for (let i = 0; i < n; i++) done(i);
  return Wp;
}

// для подбора поз: положение суставов
export function _joints(pose) {
  if (!D) return null;
  const Wp = posedWorlds(pose), out = {};
  D.FING.forEach((ch, f) => {
    ch.forEach((i, s) => { out['f' + f + s] = new THREE.Vector3().setFromMatrixPosition(Wp[i]).toArray(); });
    // кончик пальца — сустав за TOP
    const tip = D.parent.indexOf(ch[2]);
    if (tip >= 0) out['f' + f + '3'] = new THREE.Vector3().setFromMatrixPosition(Wp[tip]).toArray();
  });
  D.TH.forEach((i, s) => { out['t' + s] = new THREE.Vector3().setFromMatrixPosition(Wp[i]).toArray(); });
  // кончик большого пальца — следующий сустав за TOP
  const tip = D.parent.indexOf(D.TH[2]);
  if (tip >= 0) out.tip = new THREE.Vector3().setFromMatrixPosition(Wp[tip]).toArray();
  return out;
}

function bake(side, pose) {
  const n = D.W.length, Wp = posedWorlds(pose), S = new Array(n);
  for (let i = 0; i < n; i++) S[i] = Wp[i].clone().multiply(D.W[i].clone().invert());
  const vc = D.pos.length / 3, P = new Float32Array(vc * 3), N = new Float32Array(vc * 3);
  const mx = side < 0 ? -1 : 1;
  for (let v = 0; v < vc; v++) {
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 4; k++) {
      const w = D.wgt[v * 4 + k] / 255;
      if (!w) continue;
      const e = S[D.skin[v * 4 + k]].elements;
      _v.set(D.pos[v * 3], D.pos[v * 3 + 1], D.pos[v * 3 + 2]);
      _n.set(D.nor[v * 3], D.nor[v * 3 + 1], D.nor[v * 3 + 2]);
      px += w * (e[0] * _v.x + e[4] * _v.y + e[8] * _v.z + e[12]);
      py += w * (e[1] * _v.x + e[5] * _v.y + e[9] * _v.z + e[13]);
      pz += w * (e[2] * _v.x + e[6] * _v.y + e[10] * _v.z + e[14]);
      nx += w * (e[0] * _n.x + e[4] * _n.y + e[8] * _n.z);
      ny += w * (e[1] * _n.x + e[5] * _n.y + e[9] * _n.z);
      nz += w * (e[2] * _n.x + e[6] * _n.y + e[10] * _n.z);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    P[v * 3] = px * mx; P[v * 3 + 1] = py; P[v * 3 + 2] = pz;
    N[v * 3] = nx / l * mx; N[v * 3 + 1] = ny / l; N[v * 3 + 2] = nz / l;
  }
  const idx = D.idx.slice();
  if (side < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(D.uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.userData.shared = true;
  return g;
}
