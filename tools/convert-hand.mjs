// Конвертер готовой кисти со скелетом (FBX) в формат игры: assets/models/hand.bin (читает src/riggedhand.js)
// и текстуры hand_albedo.jpg (цвет × AO), hand_normal.jpg, hand_rough.jpg.
// Нужны three@0.160.0 и sharp в node_modules рядом (npm i three@0.160.0 sharp во временной папке), запуск:
//   node convert-hand.mjs <hand.fbx> <папка с текстурами> <папка assets/models> [имя меша]
// У присланной модели в анимации есть дорожки без ключей — штатный FBXLoader на них падает, поэтому
// используется его копия, где такие дорожки пропускаются (создаётся рядом при запуске).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import * as THREE from 'three';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const orig = fs.readFileSync(require.resolve('three/examples/jsm/loaders/FBXLoader.js'), 'utf8')
  .replace("from '../libs/fflate.module.js'", "from 'three/examples/jsm/libs/fflate.module.js'")
  .replace("from '../curves/NURBSCurve.js'", "from 'three/examples/jsm/curves/NURBSCurve.js'")
  .replace(/const (\w+Track) = (this\.generate\w+\([^;]*\));/g, 'let $1; try { $1 = $2; } catch (e) { $1 = undefined; }');
const patched = path.resolve('FBXLoaderPatched.mjs');
fs.writeFileSync(patched, orig);
const { FBXLoader } = await import('file://' + patched.split(path.sep).join('/'));
globalThis.window = { URL: { createObjectURL: () => 'blob:stub' } };
THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
function load(file) {
  const buf = fs.readFileSync(file);
  return new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
}

const [, , src, texDir, outDir, meshName = 'Hand_Low'] = process.argv;
const out = `${outDir}/hand.bin`;
const root = load(src);
root.updateMatrixWorld(true);
const mesh = root.getObjectByName(meshName);
const sk = mesh.skeleton;
const B = sk.bones.map(b => b.name);
const bindW = sk.boneInverses.map(m => m.clone().invert());
const P0 = n => new THREE.Vector3().setFromMatrixPosition(bindW[B.indexOf(n)]);
const wrist = P0('Root_joint'), midB = P0('MIDDLE_F_BASE_joint'), idxB = P0('INDEX_BASE_joint'), pinkB = P0('PINK_BASE_joint');
const midTip = P0('MIDDLE_F_UP_TOP_joint'), midMid = P0('MIDDLE_F_MID_joint'), thumbB = P0('THUMB_BASE_joint');
const f = midB.clone().sub(wrist).normalize();
let s = idxB.clone().sub(pinkB); s.addScaledVector(f, -s.dot(f)).normalize();
let n = new THREE.Vector3().crossVectors(f, s);
// сторона ладони: кончики пальцев в покое чуть согнуты к ладони; если нет — по большому пальцу
const tipOff = midTip.clone().sub(midB); tipOff.addScaledVector(f, -tipOff.dot(f));
const thOff = thumbB.clone().sub(wrist); thOff.addScaledVector(f, -thOff.dot(f));
let palmSign = tipOff.dot(n) > 0.002 * midB.distanceTo(wrist) ? 1 : tipOff.dot(n) < -0.002 * midB.distanceTo(wrist) ? -1 : (thOff.dot(n) > 0 ? 1 : -1);
const palmDir = n.clone().multiplyScalar(palmSign);
const zH = f.clone().negate(), yH = palmDir.clone().negate(), xH = new THREE.Vector3().crossVectors(yH, zH);
const R = new THREE.Matrix4().makeBasis(xH, yH, zH).transpose(); // мир → кисть
const c = midB.clone().lerp(wrist, 0.48);
const k = 0.096 / midB.distanceTo(wrist);
const T = new THREE.Matrix4().makeScale(k, k, k).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
const thumbH = thumbB.clone().applyMatrix4(T);
console.log('palmSign', palmSign, 'tip curl', tipOff.dot(n).toFixed(3), 'scale', k.toFixed(4), 'thumb x', thumbH.x.toFixed(3), thumbH.x < 0 ? 'RIGHT hand' : 'LEFT hand');

// геометрия в позе привязки (мир), затем в систему кисти
const g = mesh.geometry.index ? mesh.geometry : mesh.geometry;
const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
const M = T.clone().multiply(mesh.bindMatrix);
const Nm = new THREE.Matrix3().getNormalMatrix(M);
const v = new THREE.Vector3(), nn = new THREE.Vector3();
const PP = [], NN = [], UV = [], SI = [], SW = [];
for (let i = 0; i < pos.count; i++) {
  v.fromBufferAttribute(pos, i).applyMatrix4(M); PP.push(v.x, v.y, v.z);
  nn.fromBufferAttribute(nor, i).applyMatrix3(Nm).normalize(); NN.push(nn.x, nn.y, nn.z);
  UV.push(uv.getX(i), uv.getY(i));
  const ws = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)], is = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
  const tot = ws.reduce((a, b) => a + b, 0) || 1;
  let q = ws.map(w => Math.round(w / tot * 255)); q[0] += 255 - q.reduce((a, b) => a + b, 0);
  SI.push(...is); SW.push(...q);
}
// индексы: у FBX-меша вершины уже не общие — сливаем одинаковые
const map = new Map(), qp = [], qn = [], qu = [], qs = [], qw = [], idx = [];
const box = new THREE.Box3();
for (let i = 0; i < PP.length; i += 3) box.expandByPoint(v.set(PP[i], PP[i + 1], PP[i + 2]));
const mn = box.min, sz = box.getSize(new THREE.Vector3());
const qq = (x, a, s2) => Math.round((x - a) / (s2 || 1) * 65535) - 32768;
const count = PP.length / 3;
const order = g.index ? Array.from(g.index.array) : [...Array(count).keys()];
for (const i of order) {
  const key = [qq(PP[i * 3], mn.x, sz.x), qq(PP[i * 3 + 1], mn.y, sz.y), qq(PP[i * 3 + 2], mn.z, sz.z), Math.round(NN[i * 3] * 127), Math.round(NN[i * 3 + 1] * 127), Math.round(NN[i * 3 + 2] * 127), Math.round(UV[i * 2] * 65535), Math.round(UV[i * 2 + 1] * 65535)].join(',');
  let j = map.get(key);
  if (j === undefined) {
    j = qs.length / 4; map.set(key, j);
    qp.push(qq(PP[i * 3], mn.x, sz.x), qq(PP[i * 3 + 1], mn.y, sz.y), qq(PP[i * 3 + 2], mn.z, sz.z));
    qn.push(Math.round(NN[i * 3] * 127), Math.round(NN[i * 3 + 1] * 127), Math.round(NN[i * 3 + 2] * 127));
    qu.push(Math.round(Math.min(1, Math.max(0, UV[i * 2])) * 65535), Math.round(Math.min(1, Math.max(0, UV[i * 2 + 1])) * 65535));
    qs.push(...SI.slice(i * 4, i * 4 + 4)); qw.push(...SW.slice(i * 4, i * 4 + 4));
  }
  idx.push(j);
}
// кости: родитель и мировая матрица привязки в системе кисти
const bones = sk.bones.map((b, i) => ({
  name: b.name,
  parent: B.indexOf(b.parent && b.parent.name),
  m: Array.from(T.clone().multiply(bindW[i]).elements).map(x => +x.toFixed(6)),
}));
const nv = qs.length / 4, big = nv > 65535;
const arrays = [['pos', new Int16Array(qp)], ['nor', new Int8Array(qn)], ['uv', new Uint16Array(qu)], ['skin', new Uint8Array(qs)], ['wgt', new Uint8Array(qw)], ['idx', big ? new Uint32Array(idx) : new Uint16Array(idx)]];
const uvMin = Math.min(...UV), uvMax = Math.max(...UV);
const header = { v: 1, verts: nv, tris: idx.length / 3, min: mn.toArray(), size: sz.toArray(), big, bones, parts: {}, right: thumbH.x < 0 };
let off = 0;
for (const [kk, a] of arrays) { off = (off + 3) & ~3; header.parts[kk] = [off, a.length]; off += a.byteLength; }
const hj = Buffer.from(JSON.stringify(header));
const hlen = (4 + hj.length + 3) & ~3;
const buf = Buffer.alloc(hlen + off);
buf.writeUInt32LE(hj.length, 0); hj.copy(buf, 4);
for (const [kk, a] of arrays) Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(buf, hlen + header.parts[kk][0]);
fs.writeFileSync(out, buf);
console.log(out, 'verts', nv, 'tris', header.tris, 'bytes', buf.length, 'box', mn.toArray().map(x => x.toFixed(3)), sz.toArray().map(x => x.toFixed(3)), 'uv', uvMin.toFixed(3), uvMax.toFixed(3), 'bones', bones.length);

// текстуры (в своём блоке — имена переменных пересекаются с частью про сетку)
{
const TX = n => `${texDir}/${n}`;
// цвет × AO, 1024, JPEG
const ao = await sharp(TX('lambert1_Mixed_AO.png')).resize(1024, 1024).greyscale().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
const alb = await sharp(TX('lambert1_Base_Color.png')).resize(1024, 1024).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const px = alb.data, a = ao.data, ach = ao.info.channels;
let r = 0, g = 0, b = 0, n = 0;
for (let i = 0, j = 0; i < px.length; i += 3, j += ach) {
  const k = 0.35 + 0.65 * a[j] / 255;
  px[i] = Math.round(px[i] * k); px[i + 1] = Math.round(px[i + 1] * k); px[i + 2] = Math.round(px[i + 2] * k);
  if (px[i] + px[i + 1] + px[i + 2] > 60) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
}
await sharp(px, { raw: { width: 1024, height: 1024, channels: 3 } }).jpeg({ quality: 86, mozjpeg: true }).toFile(`${outDir}/hand_albedo.jpg`);
await sharp(TX('lambert1_Normal_OpenGL.png')).resize(1024, 1024).toColourspace('srgb').removeAlpha().jpeg({ quality: 90, mozjpeg: true }).toFile(`${outDir}/hand_normal.jpg`);
await sharp(TX('lambert1_Roughness.png')).resize(512, 512).greyscale().jpeg({ quality: 85, mozjpeg: true }).toFile(`${outDir}/hand_rough.jpg`);
const hex = ((Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n)).toString(16).padStart(6, '0');
console.log('mean skin #' + hex);
}
