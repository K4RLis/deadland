// Процедурные текстуры: рисуются при запуске в массивы (бесшовные, без файлов) и накладываются
// трипланарно — по трём проекциям координат, поэтому моделям не нужны UV-развёртки.
//  DETAIL — шум для мира (средний, мелкое зерно, крупные пятна, трещины);
//  SKIN — кожа (пятнистость, вены, синяки и гниль, кровь);
//  CLOTH — ткань (переплетение, грязь, потёртости, кровь).
import * as THREE from 'three';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// бесшовный value-noise: решётка с периодом period на квадрате size × size, плавная интерполяция
function lattice(size, period, seed) {
  const r = rng(seed), L = new Float32Array(period * period);
  for (let i = 0; i < L.length; i++) L[i] = r();
  const out = new Float32Array(size * size), k = period / size;
  for (let y = 0; y < size; y++) {
    const fy = y * k, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % period) * period, r1 = ((y0 + 1) % period) * period;
    for (let x = 0; x < size; x++) {
      const fx = x * k, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % period, c1 = (x0 + 1) % period;
      const a = L[r0 + c0] + (L[r0 + c1] - L[r0 + c0]) * sx;
      const b = L[r1 + c0] + (L[r1 + c1] - L[r1 + c0]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

// фрактальный шум: сумма октав с периодами periods, нормирован в 0..1
function fbm(size, periods, seed, gain = 0.55) {
  const out = new Float32Array(size * size);
  let amp = 1, tot = 0;
  periods.forEach((p, i) => {
    const l = lattice(size, p, seed + i * 101);
    for (let j = 0; j < out.length; j++) out[j] += l[j] * amp;
    tot += amp; amp *= gain;
  });
  let mn = 1e9, mx = -1e9;
  for (let j = 0; j < out.length; j++) { out[j] /= tot; mn = Math.min(mn, out[j]); mx = Math.max(mx, out[j]); }
  for (let j = 0; j < out.length; j++) out[j] = (out[j] - mn) / (mx - mn || 1);
  return out;
}

// «жилки»: гребни шума (1 − |2n − 1|) с искажением координат — сеть тонких линий
function ridges(size, periods, seed, sharp) {
  const n = fbm(size, periods, seed, 0.5), w1 = fbm(size, [4, 8], seed + 7), w2 = fbm(size, [4, 8], seed + 13);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const sx = (x + Math.round((w1[i] - 0.5) * size * 0.12) + size) % size, sy = (y + Math.round((w2[i] - 0.5) * size * 0.12) + size) % size;
    const v = 1 - Math.abs(n[sy * size + sx] * 2 - 1);
    out[i] = Math.max(0, (v - sharp) / (1 - sharp));
  }
  return out;
}

// пятна крови: неровный край (по шуму), вытянутые брызги с хвостиками по направлению удара, потёки вниз — бесшовно
function splatter(size, count, seed) {
  const r = rng(seed), out = new Float32Array(size * size), nz = fbm(size, [8, 16, 32, 64], seed + 5);
  const put = (x, y, v) => { const i = ((y % size + size) % size) * size + ((x % size + size) % size); if (v > out[i]) out[i] = v; };
  // пятно с рваным краем: порог по шуму сдвигает границу
  const blob = (cx, cy, rx, ry, a) => {
    const R = Math.ceil(Math.max(rx, ry) * 1.6) + 1;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx / rx, dy / ry);
      const i = (((cy + dy) % size + size) % size) * size + (((cx + dx) % size + size) % size);
      const v = (1 - d) * 2.2 + (nz[i] - 0.5) * 1.8;
      if (v > 0) put(cx + dx, cy + dy, Math.min(1, v) * a);
    }
  };
  for (let s = 0; s < count; s++) {
    const cx = Math.floor(r() * size), cy = Math.floor(r() * size), big = size * (0.025 + r() * 0.045), dir = r() * 6.283;
    blob(cx, cy, big * (0.8 + r() * 0.5), big * (0.7 + r() * 0.5), 0.95);
    // брызги: вытянуты вдоль направления, с хвостиком из капель
    for (let k = 0; k < 7; k++) {
      const a = dir + (r() - 0.5) * 1.6, d = big * (1.2 + r() * 1.8), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, sz = 1 + r() * big * 0.18;
      blob(Math.round(x), Math.round(y), sz * 1.8, sz, 0.85);
      for (let t = 1; t < 4; t++) blob(Math.round(x + Math.cos(a) * sz * t * 1.6), Math.round(y + Math.sin(a) * sz * t * 1.6), sz * (0.6 - t * 0.12), sz * (0.5 - t * 0.1), 0.7);
    }
    // потёки вниз от пятна
    for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
      let x = cx + Math.round((r() - 0.5) * big * 1.2);
      const len = big * (1.2 + r() * 3), w = 1 + r() * 1.8;
      for (let t = 0; t < len; t++) { blob(x, cy + t, w * (1 - t / len * 0.5), w, 0.8); if (r() < 0.08) x += r() < 0.5 ? -1 : 1; }
      blob(x, Math.round(cy + len), w * 1.4, w * 1.5, 0.85);
    }
  }
  return out;
}

function toTexture(size, chans) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 4; c++) data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, chans[c] ? chans[c][i] : 1)) * 255);
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

let cache = null;
export function textures() {
  if (cache) return cache;
  const D = 256, S = 512, Cs = 256;
  // мир: средний шум, зерно, крупные пятна, трещины
  const detail = toTexture(D, [fbm(D, [8, 16, 32, 64], 11), fbm(D, [64, 128, 256], 23, 0.7), fbm(D, [2, 4, 8], 37), ridges(D, [8, 16, 32], 41, 0.9)]);
  // кожа: пятнистость, вены, синяки и гниль, кровь
  const mot = fbm(S, [8, 16, 32, 64, 128], 101, 0.6);
  const veins = ridges(S, [6, 12, 24, 48], 113, 0.86);
  const rot = fbm(S, [4, 8, 16], 127);
  for (let i = 0; i < rot.length; i++) rot[i] = Math.max(0, Math.min(1, (rot[i] - 0.55) / 0.25));
  const skin = toTexture(S, [mot, veins, rot, splatter(S, 5, 131)]);
  // ткань: переплетение нитей, грязь, потёртости, кровь
  const weave = new Float32Array(Cs * Cs), grain = fbm(Cs, [32, 64, 128], 201, 0.7);
  for (let y = 0; y < Cs; y++) for (let x = 0; x < Cs; x++) {
    const a = Math.sin(x / Cs * Math.PI * 2 * 64), b = Math.sin(y / Cs * Math.PI * 2 * 64);
    const over = ((Math.floor(x / Cs * 64) + Math.floor(y / Cs * 64)) & 1) ? a : b;
    weave[y * Cs + x] = 0.5 + 0.28 * over + (grain[y * Cs + x] - 0.5) * 0.5;
  }
  const dirt = fbm(Cs, [4, 8, 16, 32], 211);
  for (let i = 0; i < dirt.length; i++) dirt[i] = Math.max(0, Math.min(1, (dirt[i] - 0.35) / 0.5));
  const wear = fbm(Cs, [8, 16, 32], 223);
  for (let i = 0; i < wear.length; i++) wear[i] = Math.max(0, Math.min(1, (wear[i] - 0.62) / 0.2));
  const cloth = toTexture(Cs, [weave, dirt, wear, splatter(Cs, 3, 233)]);
  cache = { detail, skin, cloth };
  return cache;
}

// трипланарная выборка: веса по нормали, три проекции координат
export const TRIPLANAR = `
  vec4 triTex(sampler2D t, vec3 p, vec3 n, float sc) {
    vec3 w = pow(abs(n), vec3(4.0));
    w /= (w.x + w.y + w.z + 1e-5);
    return texture2D(t, p.yz * sc) * w.x + texture2D(t, p.xz * sc) * w.y + texture2D(t, p.xy * sc) * w.z;
  }`;

// материал персонажей: цвет вершин + текстуры кожи и ткани по атрибуту aKind (0 — ткань, 1 — кожа, 2 — прочее).
// У зомби кожа в венах, синяках и гнили, одежда грязная и в крови; у людей — чистые
export function characterMaterial(zombie) {
  const T = textures();
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: zombie ? 12 : 6, specular: zombie ? 0x1a1c18 : 0x0c0c0c });
  m.onBeforeCompile = sh => {
    sh.uniforms.tSkin = { value: T.skin };
    sh.uniforms.tCloth = { value: T.cloth };
    sh.uniforms.uZ = { value: zombie ? 1 : 0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind;\nvarying float vKind;\nvarying vec3 vOP;\nvarying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKind = aKind; vOP = transformed; vON = objectNormal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tSkin;\nuniform sampler2D tCloth;\nuniform float uZ;\nvarying float vKind;\nvarying vec3 vOP;\nvarying vec3 vON;\n' + TRIPLANAR)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vON);
          float far = 1.0 - smoothstep(25.0, 60.0, length(vViewPosition));
          if (vKind < 0.5) {
            vec4 c = triTex(tCloth, vOP, n, 7.0);
            vec4 c2 = triTex(tCloth, vOP + 3.1, n, 1.1);
            diffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * c.r, far);
            diffuseColor.rgb *= 1.0 - c2.g * (0.18 + 0.32 * uZ);
            diffuseColor.rgb *= 1.0 - c2.b * 0.22;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.008, 0.006), smoothstep(0.35, 0.7, c2.a) * uZ * 0.85);
          } else if (vKind < 1.5) {
            vec4 s = triTex(tSkin, vOP, n, 4.2);
            vec4 s2 = triTex(tSkin, vOP + 1.7, n, 1.0);
            diffuseColor.rgb *= 0.74 + 0.48 * s.r;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.5, 0.66), s2.b * (0.15 + 0.55 * uZ));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.05, 0.1), s.g * 0.7 * uZ * far);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.01, 0.008), smoothstep(0.35, 0.7, s2.a) * uZ * 0.75);
          } else {
            vec4 d = triTex(tSkin, vOP, n, 6.0);
            diffuseColor.rgb *= 0.85 + 0.3 * d.r;
          }
        }`);
  };
  m.customProgramCacheKey = () => 'char_' + (zombie ? 'z' : 'p');
  return m;
}
