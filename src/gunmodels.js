// Готовые модели оружия (сконвертированы из FBX/OBJ в assets/models/*.bin, см. tools/convert-model.mjs).
// Формат: u32 длина JSON-заголовка, JSON, выравнивание до 4, затем массивы: позиции Int16 в габаритах модели,
// нормали Int8, номер цвета в палитре материалов (линейные RGB), индексы.
import * as THREE from 'three';
import { VERSION } from './config.js';

// предмет → файл модели
export const GUN_FILES = { rifle: 'ak47', asval: 'asval', qbz: 'qbz191' };
const geos = {};

export function loadGunModels() {
  return Promise.all(Object.entries(GUN_FILES).map(async ([id, f]) => {
    try {
      const r = await fetch(`assets/models/${f}.bin?v=${window.BUILD || VERSION}`);
      if (!r.ok) throw new Error(r.status);
      geos[id] = parseModel(await r.arrayBuffer());
    } catch (e) { console.warn('модель', f, e); }
  }));
}

export function gunGeo(id) { return geos[id] || null; }

export function parseModel(ab) {
  const dv = new DataView(ab), hl = dv.getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 4, hl)));
  const base = (4 + hl + 3) & ~3;
  const arr = (T, k) => new T(ab, base + h.parts[k][0], h.parts[k][1]);
  const qp = arr(Int16Array, 'pos'), qc = arr(Uint8Array, 'col');
  const pos = new Float32Array(qp.length), col = new Float32Array(qp.length);
  for (let i = 0; i < qp.length; i++) pos[i] = h.min[i % 3] + (qp[i] + 32768) / 65535 * h.size[i % 3];
  for (let i = 0; i < qc.length; i++) { const c = h.palette[qc[i]]; col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(arr(Int8Array, 'nor').slice(), 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute((h.big ? arr(Uint32Array, 'idx') : arr(Uint16Array, 'idx')).slice(), 1));
  g.computeBoundingSphere();
  return g;
}
