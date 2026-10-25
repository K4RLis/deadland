// Конвертер готовых моделей оружия (FBX/OBJ) в компактный формат игры (assets/models/*.bin, читает src/gunmodels.js).
// Нужен three.js в node_modules рядом (npm i three@0.160.0 во временной папке), запуск:
//   node convert-model.mjs <модель.fbx|.obj> <выход.bin> <масштаб до метров> [файл.mtl]
// Все меши сливаются в одну индексную геометрию: позиции Int16 (в габаритах), нормали Int8, цвет — номер в палитре
// материалов. Ствол поворачивается из +z в −z (как у моделей игры).
import fs from 'fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

function load(file) {
  const buf = fs.readFileSync(file);
  if (file.toLowerCase().endsWith('.obj')) return new OBJLoader().parse(buf.toString('utf8'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new FBXLoader().parse(ab, '');
}

const [, , src, out, scaleArg, mtlPath] = process.argv;
const scale = +scaleArg;
const root = load(src);
root.updateMatrixWorld(true);

// цвета из .mtl (Kd — линейные), если загрузчик OBJ их не дал
const mtl = {};
if (mtlPath) {
  let cur = null;
  for (const line of fs.readFileSync(mtlPath, 'utf8').split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'newmtl') cur = p[1];
    else if (p[0] === 'Kd' && cur) mtl[cur] = [+p[1], +p[2], +p[3]];
  }
}
const colorOf = m => {
  if (mtl[m.name]) return mtl[m.name];
  return [m.color.r, m.color.g, m.color.b]; // уже линейные
};

const fix = new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
const P = [], N = [], C = [], palette = [], palKey = new Map();
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), nm = new THREE.Matrix3();
root.traverse(o => {
  if (!o.isMesh) return;
  const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
  const pos = g.attributes.position, nor = g.attributes.normal;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const m4 = fix.clone().multiply(o.matrixWorld);
  nm.getNormalMatrix(m4);
  const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
  for (const gr of groups) {
    const col = colorOf(mats[gr.materialIndex] || mats[0]);
    const key = col.map(v => v.toFixed(4)).join(',');
    if (!palKey.has(key)) { palKey.set(key, palette.length); palette.push(col); }
    const ci = palKey.get(key);
    for (let i = gr.start; i < gr.start + gr.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m4);
      _n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      P.push(_v.x, _v.y, _v.z); N.push(_n.x, _n.y, _n.z); C.push(ci);
    }
  }
});

// индексация: одинаковые (позиция, нормаль, цвет) — одна вершина
const box = new THREE.Box3();
for (let i = 0; i < P.length; i += 3) box.expandByPoint(_v.set(P[i], P[i + 1], P[i + 2]));
const mn = box.min, sz = box.getSize(new THREE.Vector3());
const q = (v, a, s) => Math.round(((v - a) / (s || 1)) * 65535) - 32768;
const map = new Map(), qp = [], qn = [], qc = [], idx = [];
for (let i = 0; i < C.length; i++) {
  const x = q(P[i * 3], mn.x, sz.x), y = q(P[i * 3 + 1], mn.y, sz.y), z = q(P[i * 3 + 2], mn.z, sz.z);
  const nx = Math.round(N[i * 3] * 127), ny = Math.round(N[i * 3 + 1] * 127), nz = Math.round(N[i * 3 + 2] * 127);
  const key = `${x},${y},${z},${nx},${ny},${nz},${C[i]}`;
  let k = map.get(key);
  if (k === undefined) { k = qc.length; map.set(key, k); qp.push(x, y, z); qn.push(nx, ny, nz); qc.push(C[i]); }
  idx.push(k);
}
const nv = qc.length, big = nv > 65535;
const arrays = [
  ['pos', new Int16Array(qp)], ['nor', new Int8Array(qn)], ['col', new Uint8Array(qc)],
  ['idx', big ? new Uint32Array(idx) : new Uint16Array(idx)],
];
const header = { v: 1, verts: nv, tris: idx.length / 3, min: mn.toArray(), size: sz.toArray(), palette, big, parts: {} };
let off = 0;
for (const [k, a] of arrays) { off = (off + 3) & ~3; header.parts[k] = [off, a.length]; off += a.byteLength; }
const hj = Buffer.from(JSON.stringify(header));
const hlen = (4 + hj.length + 3) & ~3;
const buf = Buffer.alloc(hlen + off);
buf.writeUInt32LE(hj.length, 0); hj.copy(buf, 4);
for (const [k, a] of arrays) Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(buf, hlen + header.parts[k][0]);
fs.writeFileSync(out, buf);
console.log(out, 'verts', nv, 'tris', header.tris, 'bytes', buf.length, 'size', sz.toArray().map(v => v.toFixed(3)), 'min', mn.toArray().map(v => v.toFixed(3)), 'palette', palette.length);
