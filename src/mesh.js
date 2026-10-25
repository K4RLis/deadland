// Сборщик плоско-затенённой low-poly геометрии с цветами вершин.
// Все объекты чанка сливаются в один меш — один draw call на чанк.
import * as THREE from 'three';
import { textures, TRIPLANAR } from './textures.js';

const _c = new THREE.Color();
const linCache = new Map();

// hex sRGB -> линейный цвет [r, g, b] (с учётом color management three.js)
export function lin(hex) {
  let v = linCache.get(hex);
  if (!v) { _c.setHex(hex); v = [_c.r, _c.g, _c.b]; linCache.set(hex, v); }
  return v;
}

export function shade(col, f) {
  return [col[0] * f, col[1] * f, col[2] * f];
}

const _v = new THREE.Vector3();
const _rm = new THREE.Matrix4(), _re = new THREE.Euler();
// после загрузки на видеокарту копия массива в памяти браузера больше не нужна
function freeArray() { this.array = null; }

export class MeshBuilder {
  // facet — разброс яркости между треугольниками: гранёный «полигональный» вид.
  // flat — без нормалей и с компактными цветами (вдвое меньше памяти); материал тогда нужен с flatShading:
  // нормаль грани видеокарта считает сама
  // данные сразу пишутся в растущие типизированные массивы (у flat цвет — 16 бит), без промежуточных JS-массивов
  // tagged — у каждой вершины ещё и метка материала (атрибут aKind: 0 — ткань, 1 — кожа, 2 — прочее), текущая — this.tag
  constructor(facet = 0, flat = false, tagged = false) {
    this.facet = facet; this.k = 0; this.flat = flat; this.tagged = tagged; this.tag = 0;
    this.len = 0; this.cap = 0; this.p = null; this.n = null; this.c = null; this.t = null;
  }
  get empty() { return this.len === 0; }

  grow(need) {
    if (this.len + need <= this.cap) return;
    let cap = Math.max(9 * 1024, this.cap * 2);
    while (cap < this.len + need) cap *= 2;
    const p = new Float32Array(cap), c = this.flat ? new Uint16Array(cap) : new Float32Array(cap);
    if (this.p) { p.set(this.p.subarray(0, this.len)); c.set(this.c.subarray(0, this.len)); }
    if (!this.flat) { const n = new Float32Array(cap); if (this.n) n.set(this.n.subarray(0, this.len)); this.n = n; }
    if (this.tagged) { const t = new Uint8Array(cap / 3); if (this.t) t.set(this.t.subarray(0, this.len / 3)); this.t = t; }
    this.p = p; this.c = c; this.cap = cap;
  }

  // цвет трёх вершин (у flat — в 16-битной шкале)
  putCol(o, r, g, b) {
    const c = this.c;
    if (this.flat) {
      r = Math.min(65535, Math.round(r * 65535)); g = Math.min(65535, Math.round(g * 65535)); b = Math.min(65535, Math.round(b * 65535));
    }
    c[o] = r; c[o + 1] = g; c[o + 2] = b; c[o + 3] = r; c[o + 4] = g; c[o + 5] = b; c[o + 6] = r; c[o + 7] = g; c[o + 8] = b;
    if (this.t) { const v = o / 3; this.t[v] = this.t[v + 1] = this.t[v + 2] = this.tag; }
  }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    this.grow(9);
    const o = this.len, p = this.p;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az; p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz; p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz;
    if (!this.flat) {
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const n = this.n;
      n[o] = nx; n[o + 1] = ny; n[o + 2] = nz; n[o + 3] = nx; n[o + 4] = ny; n[o + 5] = nz; n[o + 6] = nx; n[o + 7] = ny; n[o + 8] = nz;
    }
    let f = 1;
    if (this.facet) {
      let h = Math.imul(++this.k ^ 0x9e3779b9, 2654435761);
      h ^= h >>> 15;
      f = 1 + (((h >>> 0) & 255) / 255 - 0.5) * this.facet;
    }
    this.putCol(o, col[0] * f, col[1] * f, col[2] * f);
    this.len += 9;
  }

  // треугольник с нормалями вершин (гладкое затенение, без разброса яркости граней)
  triN(a, b, c, na, nb, nc, col) {
    this.grow(9);
    const o = this.len, p = this.p, n = this.n;
    p[o] = a.x; p[o + 1] = a.y; p[o + 2] = a.z; p[o + 3] = b.x; p[o + 4] = b.y; p[o + 5] = b.z; p[o + 6] = c.x; p[o + 7] = c.y; p[o + 8] = c.z;
    n[o] = na.x; n[o + 1] = na.y; n[o + 2] = na.z; n[o + 3] = nb.x; n[o + 4] = nb.y; n[o + 5] = nb.z; n[o + 6] = nc.x; n[o + 7] = nc.y; n[o + 8] = nc.z;
    this.putCol(o, col[0], col[1], col[2]);
    this.len += 9;
  }

  // треугольник по точкам-массивам [x, y, z] со своими нормалями вершин (гладкое затенение)
  triA(a, b, c, na, nb, nc, col) {
    this.grow(9);
    const o = this.len, p = this.p, n = this.n;
    p[o] = a[0]; p[o + 1] = a[1]; p[o + 2] = a[2]; p[o + 3] = b[0]; p[o + 4] = b[1]; p[o + 5] = b[2]; p[o + 6] = c[0]; p[o + 7] = c[1]; p[o + 8] = c[2];
    n[o] = na[0]; n[o + 1] = na[1]; n[o + 2] = na[2]; n[o + 3] = nb[0]; n[o + 4] = nb[1]; n[o + 5] = nb[2]; n[o + 6] = nc[0]; n[o + 7] = nc[1]; n[o + 8] = nc[2];
    this.putCol(o, col[0], col[1], col[2]);
    this.len += 9;
  }

  // четырёхугольник a-b-c-d против часовой стрелки (если смотреть снаружи)
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, col) {
    this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, col);
    this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, col);
  }

  box(x0, y0, z0, x1, y1, z1, col, noBottom = false) {
    const top = col, side = shade(col, 0.93), side2 = shade(col, 0.86);
    this.quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, top);
    if (!noBottom) this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, side2);
    this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, side);
    this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, side);
    this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, side2);
    this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, side2);
  }

  // коробка, у которой стены разбиты на горизонтальные полосы (обшивка / кладка)
  boxBanded(x0, y0, z0, x1, y1, z1, col, band, noBottom = true) {
    const n = Math.max(1, Math.round((y1 - y0) / band));
    const top = col;
    this.quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, top);
    if (!noBottom) this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, shade(col, 0.86));
    for (let k = 0; k < n; k++) {
      const a = y0 + (y1 - y0) * k / n, b = y0 + (y1 - y0) * (k + 1) / n;
      const f = k & 1 ? 0.95 : 1;
      const side = shade(col, 0.93 * f), side2 = shade(col, 0.86 * f);
      this.quad(x1, a, z1, x1, a, z0, x1, b, z0, x1, b, z1, side);
      this.quad(x0, a, z0, x0, a, z1, x0, b, z1, x0, b, z0, side);
      this.quad(x0, a, z1, x1, a, z1, x1, b, z1, x0, b, z1, side2);
      this.quad(x1, a, z0, x0, a, z0, x0, b, z0, x1, b, z0, side2);
    }
  }

  // «скруглённый» бокс с центром (cx, cy, cz): сечение со скруглёнными рёбрами, торцы со скруглением.
  // o.c — скругление вертикальных рёбер (доля меньшей стороны), o.b — скругление торцов, o.tx/o.tz — масштаб верхнего
  // сечения (сужение к верху), o.rx/o.ry/o.rz — поворот вокруг центра, o.q — точек на дуге угла (9),
  // o.a — колец на скруглении торца (7). Со скруглением затенение гладкое (нормали вершин), без него (c = 0) — гранёное
  rbox(cx, cy, cz, w, h, d, col, o = {}) {
    const m = Math.min(w, d), cf = o.c ?? 0.25;
    const c = m * cf;
    const bv = Math.min(h * 0.4, m * 0.4, Math.min(m, h) * (o.b ?? cf * 0.6));
    const tx = o.tx ?? 1, tz = o.tz ?? 1, Q = o.q ?? 9, A = o.a ?? 7;
    const ring = (y, ins) => {
      const t = (y + h / 2) / h, sx = 1 + (tx - 1) * t, sz = 1 + (tz - 1) * t;
      const hw = w / 2 - ins, hd = d / 2 - ins;
      let pts;
      if (c > 1e-5) {
        // углы скруглены дугой из Q точек (по умолчанию девять — через 11,25°)
        const k = Math.max(c * 0.3, c - ins * 0.414);
        pts = [];
        for (const [cx2, cz2, a0] of [[hw - k, -hd + k, -Math.PI / 2], [hw - k, hd - k, 0], [-hw + k, hd - k, Math.PI / 2], [-hw + k, -hd + k, Math.PI]]) {
          for (let q = 0; q < Q; q++) { const a = a0 + q * Math.PI / 2 / (Q - 1); pts.push([cx2 + Math.cos(a) * k, cz2 + Math.sin(a) * k]); }
        }
      } else pts = [[hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]];
      return pts.map(([x, z]) => [x * sx, y, z * sz]);
    };
    // торцы скруглены четвертью окружности: A колец (по умолчанию семь — через 15°)
    const arc = [...Array(A).keys()].map(i => { const a = i * Math.PI / 2 / (A - 1); return [1 - Math.sin(a), 1 - Math.cos(a)]; });
    const ys = bv > 1e-4
      ? [...arc.map(([ins, dy]) => [-h / 2 + bv * dy, bv * ins]), ...arc.slice().reverse().map(([ins, dy]) => [h / 2 - bv * dy, bv * ins])]
      : [[-h / 2, 0], [h / 2, 0]];
    let rot = null;
    if (o.rx || o.ry || o.rz) { _re.set(o.rx || 0, o.ry || 0, o.rz || 0); rot = _rm.makeRotationFromEuler(_re); }
    const R = ys.map(([y, ins]) => ring(y, ins).map(p => {
      _v.set(p[0], p[1], p[2]);
      if (rot) _v.applyMatrix4(rot);
      return [_v.x + cx, _v.y + cy, _v.z + cz];
    }));
    const ctr = [cx, cy, cz], n = R[0].length;
    if (c <= 1e-5 || this.flat) {
      for (let k = 0; k + 1 < R.length; k++) for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.otri(R[k][i], R[k][j], R[k + 1][j], ctr, col);
        this.otri(R[k][i], R[k + 1][j], R[k + 1][i], ctr, col);
      }
      for (const r of [R[0], R[R.length - 1]]) for (let i = 1; i + 1 < n; i++) this.otri(r[0], r[i], r[i + 1], ctr, col);
      return;
    }
    this.smoothRings(R, ctr, col, bv > 1e-4);
  }

  // сетка колец (замкнутых контуров) с гладкими нормалями: нормаль вершины — среднее нормалей соседних граней.
  // Торцы плоские; при скруглённых торцах (roundEnds) крайние кольца плавно переходят в торец
  smoothRings(R, ctr, col, roundEnds, caps = true) {
    const K = R.length, n = R[0].length;
    const N = R.map(r => r.map(() => [0, 0, 0]));
    // нормаль четырёхугольника — векторное произведение диагоналей. Обход колец у всей сетки одинаковый,
    // поэтому «наружу» решается один раз — по самой крупной грани среднего ряда (у длинных трубок
    // проверка «от центра» у концов ненадёжна)
    const QN = [];
    let best = -1, sign = 1;
    for (let k = 0; k + 1 < K; k++) {
      const row = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = R[k][i], b = R[k][j], e = R[k + 1][j], f = R[k + 1][i];
        const ux = e[0] - a[0], uy = e[1] - a[1], uz = e[2] - a[2], vx = f[0] - b[0], vy = f[1] - b[1], vz = f[2] - b[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-14) { row.push(null); continue; }
        row.push([nx / l, ny / l, nz / l]);
        if (k === (K - 1) >> 1 && l > best) {
          best = l;
          sign = nx * ((a[0] + e[0]) / 2 - ctr[0]) + ny * ((a[1] + e[1]) / 2 - ctr[1]) + nz * ((a[2] + e[2]) / 2 - ctr[2]) >= 0 ? 1 : -1;
        }
      }
      QN.push(row);
    }
    for (let k = 0; k + 1 < K; k++) for (let i = 0; i < n; i++) {
      const q = QN[k][i];
      if (!q) continue;
      q[0] *= sign; q[1] *= sign; q[2] *= sign;
      const j = (i + 1) % n;
      for (const v of [N[k][i], N[k][j], N[k + 1][j], N[k + 1][i]]) { v[0] += q[0]; v[1] += q[1]; v[2] += q[2]; }
    }
    // нормаль торца (формула Ньюэлла), наружу
    const capN = (r, other) => {
      let x = 0, y = 0, z = 0;
      for (let i = 0; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; x += (p[1] - q[1]) * (p[2] + q[2]); y += (p[2] - q[2]) * (p[0] + q[0]); z += (p[0] - q[0]) * (p[1] + q[1]); }
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      // наружу — от соседнего кольца
      const d = (r[0][0] - other[0][0]) * x + (r[0][1] - other[0][1]) * y + (r[0][2] - other[0][2]) * z;
      return d >= 0 ? [x, y, z] : [-x, -y, -z];
    };
    const ends = [[R[0], capN(R[0], R[1]), 0], [R[K - 1], capN(R[K - 1], R[K - 2]), K - 1]];
    if (roundEnds) for (const [, cn, k] of ends) for (const v of N[k]) { v[0] += cn[0]; v[1] += cn[1]; v[2] += cn[2]; }
    for (const r of N) for (const v of r) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; }
    for (let k = 0; k + 1 < K; k++) for (let i = 0; i < n; i++) {
      const qn = QN[k][i];
      if (!qn) continue;
      const j = (i + 1) % n, a = R[k][i], b = R[k][j], e = R[k + 1][j], f = R[k + 1][i];
      const na = N[k][i], nb = N[k][j], ne = N[k + 1][j], nf = N[k + 1][i];
      // порядок обхода — так, чтобы лицевая сторона смотрела наружу
      const fx = (b[1] - a[1]) * (e[2] - a[2]) - (b[2] - a[2]) * (e[1] - a[1]);
      const fy = (b[2] - a[2]) * (e[0] - a[0]) - (b[0] - a[0]) * (e[2] - a[2]);
      const fz = (b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0]);
      if (fx * qn[0] + fy * qn[1] + fz * qn[2] >= 0) { this.triA(a, b, e, na, nb, ne, col); this.triA(a, e, f, na, ne, nf, col); }
      else { this.triA(a, e, b, na, ne, nb, col); this.triA(a, f, e, na, nf, ne, col); }
    }
    if (caps) for (const [r, cn] of ends) for (let i = 1; i + 1 < n; i++) {
      const a = r[0], b = r[i], e = r[i + 1];
      const fx = (b[1] - a[1]) * (e[2] - a[2]) - (b[2] - a[2]) * (e[1] - a[1]);
      const fy = (b[2] - a[2]) * (e[0] - a[0]) - (b[0] - a[0]) * (e[2] - a[2]);
      const fz = (b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0]);
      if (fx * cn[0] + fy * cn[1] + fz * cn[2] >= 0) this.triA(a, b, e, cn, cn, cn, col); else this.triA(a, e, b, cn, cn, cn, col);
    }
  }

  // эллипсоид (суперэллипсоид при o.k < 1 — ближе к бруску) с центром (cx, cy, cz) и гладким затенением.
  // o.tx/o.tz — масштаб сечения вверху (сужение), o.rx/o.ry/o.rz — поворот, o.q — точек по кругу, o.a — колец
  ellip(cx, cy, cz, w, h, d, col, o = {}) {
    const k = o.k ?? 1, Q = o.q ?? 18, A = o.a ?? 11, tx = o.tx ?? 1, tz = o.tz ?? 1;
    const f = v => Math.sign(v) * Math.abs(v) ** k;
    let rot = null;
    if (o.rx || o.ry || o.rz) { _re.set(o.rx || 0, o.ry || 0, o.rz || 0); rot = _rm.makeRotationFromEuler(_re); }
    const R = [];
    for (let i = 0; i < A; i++) {
      const phi = Math.PI * i / (A - 1), sy = -Math.cos(phi), sr = Math.sin(phi), t = (sy + 1) / 2;
      const kx = 1 + (tx - 1) * t, kz = 1 + (tz - 1) * t, ring = [];
      for (let j = 0; j < Q; j++) {
        const th = 2 * Math.PI * j / Q;
        _v.set(f(Math.cos(th) * sr) * w / 2 * kx, f(sy) * h / 2, f(Math.sin(th) * sr) * d / 2 * kz);
        if (rot) _v.applyMatrix4(rot);
        ring.push([_v.x + cx, _v.y + cy, _v.z + cz]);
      }
      R.push(ring);
    }
    this.smoothRings(R, [cx, cy, cz], col, false, false);
  }

  // трубка от a до b (точки [x, y, z]) с радиусами ra → rb и скруглёнными концами: руки, ноги, шея, пальцы.
  // o.sx/o.sz — овал сечения (по осям, близким к x и z), o.bulge/o.bp — утолщение (мышца) и его место 0..1,
  // o.q — точек по кругу, o.n — колец вдоль, o.c — колец на скруглении конца
  tube(a, b, ra, rb, col, o = {}) {
    const Q = o.q ?? 14, NB = o.n ?? 6, NC = o.c ?? 3, sx = o.sx ?? 1, sz = o.sz ?? 1, bulge = o.bulge ?? 0, bp = o.bp ?? 0.4;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], L = Math.hypot(ux, uy, uz) || 1e-6;
    const u = [ux / L, uy / L, uz / L];
    // поперечные оси: v1 ближе к x, v2 ближе к z (для вертикальных конечностей — ровно x и z)
    let ref = [0, 0, 1];
    if (Math.abs(u[2]) > 0.9) ref = [0, 1, 0];
    let v1 = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]];
    const l1 = Math.hypot(...v1); v1 = v1.map(v => v / l1);
    if (v1[0] < 0 || (Math.abs(u[2]) > 0.9 && v1[1] < 0)) v1 = v1.map(v => -v);
    const v2 = [v1[1] * u[2] - v1[2] * u[1], v1[2] * u[0] - v1[0] * u[2], v1[0] * u[1] - v1[1] * u[0]];
    const rAt = t => (ra + (rb - ra) * t) * (1 + bulge * Math.exp(-(((t - bp) / 0.3) ** 2)));
    const ring = (along, r) => {
      const c = [a[0] + u[0] * along, a[1] + u[1] * along, a[2] + u[2] * along], out = [];
      for (let j = 0; j < Q; j++) {
        const th = 2 * Math.PI * j / Q, cs = Math.cos(th) * r * sx, sn = Math.sin(th) * r * sz;
        out.push([c[0] + v1[0] * cs + v2[0] * sn, c[1] + v1[1] * cs + v2[1] * sn, c[2] + v1[2] * cs + v2[2] * sn]);
      }
      return out;
    };
    const R = [];
    for (let i = 0; i <= NC; i++) { const ph = Math.PI / 2 * (1 - i / NC); R.push(ring(-Math.sin(ph) * ra, Math.cos(ph) * rAt(0))); }
    for (let i = 1; i < NB; i++) { const t = i / NB; R.push(ring(t * L, rAt(t))); }
    for (let i = 0; i <= NC; i++) { const ph = Math.PI / 2 * i / NC; R.push(ring(L + Math.sin(ph) * rb, Math.cos(ph) * rAt(1))); }
    this.smoothRings(R, [a[0] + u[0] * L / 2, a[1] + u[1] * L / 2, a[2] + u[2] * L / 2], col, false, false);
  }

  // треугольник выпуклого тела: разворачивается наружу от ctr, яркость — по наклону грани
  otri(a, b, c, ctr, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    const mx = (a[0] + b[0] + c[0]) / 3 - ctr[0], my = (a[1] + b[1] + c[1]) / 3 - ctr[1], mz = (a[2] + b[2] + c[2]) / 3 - ctr[2];
    const out = nx * mx + ny * my + nz * mz >= 0;
    const f = 0.9 + 0.1 * (out ? ny : -ny) / l;
    const cc = [col[0] * f, col[1] * f, col[2] * f];
    if (out) this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], cc);
    else this.tri(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], cc);
  }

  // треугольная призма (двускатная крыша) с рядами черепицы
  prism(x0, y0, z0, x1, y1, z1, col, ridgeX, rows = 16) {
    const s = shade(col, 0.9);
    const R = rows;
    // подшивка снизу — крышу видно и из-под свеса
    this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, shade(col, 0.62));
    if (ridgeX) {
      const zm = (z0 + z1) / 2;
      for (let k = 0; k < R; k++) {
        const t0 = k / R, t1 = (k + 1) / R, f = k & 1 ? 0.94 : 1;
        const ya = y0 + (y1 - y0) * t0, yb = y0 + (y1 - y0) * t1;
        const za = z1 + (zm - z1) * t0, zb = z1 + (zm - z1) * t1, wa = z0 + (zm - z0) * t0, wb = z0 + (zm - z0) * t1;
        this.quad(x0, ya, za, x1, ya, za, x1, yb, zb, x0, yb, zb, shade(col, f));
        this.quad(x1, ya, wa, x0, ya, wa, x0, yb, wb, x1, yb, wb, shade(s, f));
      }
      this.tri(x1, y0, z1, x1, y0, z0, x1, y1, zm, s);
      this.tri(x0, y0, z0, x0, y0, z1, x0, y1, zm, s);
      this.box(x0 - 0.05, y1 - 0.06, zm - 0.12, x1 + 0.05, y1 + 0.08, zm + 0.12, shade(col, 0.75), true);
    } else {
      const xm = (x0 + x1) / 2;
      for (let k = 0; k < R; k++) {
        const t0 = k / R, t1 = (k + 1) / R, f = k & 1 ? 0.94 : 1;
        const ya = y0 + (y1 - y0) * t0, yb = y0 + (y1 - y0) * t1;
        const xa = x1 + (xm - x1) * t0, xb = x1 + (xm - x1) * t1, va = x0 + (xm - x0) * t0, vb = x0 + (xm - x0) * t1;
        this.quad(xa, ya, z1, xa, ya, z0, xb, yb, z0, xb, yb, z1, shade(col, f));
        this.quad(va, ya, z0, va, ya, z1, vb, yb, z1, vb, yb, z0, shade(s, f));
      }
      this.tri(x0, y0, z1, x1, y0, z1, xm, y1, z1, s);
      this.tri(x1, y0, z0, x0, y0, z0, xm, y1, z0, s);
      this.box(xm - 0.12, y1 - 0.06, z0 - 0.05, xm + 0.12, y1 + 0.08, z1 + 0.05, shade(col, 0.75), true);
    }
  }

  // призма, заданная 6 вершинами в мировых координатах (повёрнутая крыша)
  prismPts(P, col) {
    // P: [a0,a1,a2, b0,b1,b2] — два треугольных торца (a — один торец, b — другой), каждый [x,y,z]
    const [a0, a1, a2, b0, b1, b2] = P;
    const s = shade(col, 0.9);
    this.quadSafe(a0, a2, b2, b0, col);
    this.quadSafe(a2, a1, b1, b2, s);
    this.triSafe(a0, a1, a2, s);
    this.triSafe(b0, b2, b1, s);
  }

  triSafe(a, b, c, col) {
    // ориентируем нормаль наружу от центра масс не можем — используем двусторонний вариант
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], col);
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], col);
  }

  quadSafe(a, b, c, d, col) {
    this.triSafe(a, b, c, col);
    this.triSafe(a, c, d, col);
  }

  // добавить неиндексированную геометрию three.js с матрицей
  geo(g, m, col) {
    const pa = g.attributes.position.array;
    for (let i = 0; i < pa.length; i += 9) {
      _v.set(pa[i], pa[i + 1], pa[i + 2]).applyMatrix4(m);
      const ax = _v.x, ay = _v.y, az = _v.z;
      _v.set(pa[i + 3], pa[i + 4], pa[i + 5]).applyMatrix4(m);
      const bx = _v.x, by = _v.y, bz = _v.z;
      _v.set(pa[i + 6], pa[i + 7], pa[i + 8]).applyMatrix4(m);
      this.tri(ax, ay, az, bx, by, bz, _v.x, _v.y, _v.z, col);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    const L = this.len;
    g.setAttribute('position', new THREE.BufferAttribute(this.p ? this.p.slice(0, L) : new Float32Array(0), 3));
    if (this.flat) {
      g.setAttribute('color', new THREE.BufferAttribute(this.c ? this.c.slice(0, L) : new Uint16Array(0), 3, true));
      g.computeBoundingSphere();
      for (const k in g.attributes) g.attributes[k].onUpload(freeArray);
      return g;
    } else {
      g.setAttribute('normal', new THREE.BufferAttribute(this.n ? this.n.slice(0, L) : new Float32Array(0), 3));
      g.setAttribute('color', new THREE.BufferAttribute(this.c ? this.c.slice(0, L) : new Float32Array(0), 3));
      if (this.tagged) g.setAttribute('aKind', new THREE.BufferAttribute(this.t ? this.t.slice(0, L / 3) : new Uint8Array(0), 1));
    }
    g.computeBoundingSphere();
    return g;
  }
}

// кирпич и доски по цвету вершины (линейный): кирпич — красно-коричневый, дерево — оранжево-коричневое
const PATTERNS = `
  #ifdef USE_COLOR
  {
    vec3 c = vColor;
    float rg = c.r / max(c.g, 0.002), gb = c.g / max(c.b, 0.002);
    float vert = 1.0 - smoothstep(0.3, 0.5, abs(wn.y));
    vec2 uv = abs(wn.x) > abs(wn.z) ? vWPos.zy : vWPos.xy;
    float near = 1.0 - smoothstep(30.0, 70.0, length(vViewPosition));
    if (vert > 0.0 && rg > 1.6 && rg < 4.2 && gb > 1.1 && gb < 1.85) {
      // кладка: кирпич 25 × 7,5 см, перевязка со сдвигом в полкирпича, швы 1 см
      float rv = uv.y / 0.075, row = floor(rv), u = uv.x / 0.25 + mod(row, 2.0) * 0.5;
      vec2 f = vec2(fract(u), fract(rv)), aa = fwidth(vec2(u, rv)) * 1.5;
      float brick = smoothstep(0.04, 0.04 + aa.x, min(f.x, 1.0 - f.x)) * smoothstep(0.12, 0.12 + aa.y, min(f.y, 1.0 - f.y));
      float h = fract(sin(dot(vec2(floor(u), row), vec2(12.9898, 78.233))) * 43758.5453);
      vec3 bc = diffuseColor.rgb * (0.84 + 0.3 * h), mc = mix(diffuseColor.rgb, vec3(0.4, 0.38, 0.35), 0.65);
      float k = vert * near * (1.0 - smoothstep(0.35, 0.7, max(aa.x, aa.y)));
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(mc, bc, brick), k);
    } else if (rg > 1.7 && rg < 4.0 && gb >= 1.85 && gb < 4.5) {
      // доски 16 см: на стенах вдоль, на полу — вдоль x; у каждой свой тон и волокна
      vec2 p = vert > 0.5 ? uv : vWPos.xz;
      float v = p.y / 0.16, fy = fract(v), aa = fwidth(v) * 1.5;
      float seam = smoothstep(0.05, 0.05 + aa, min(fy, 1.0 - fy));
      float h = fract(sin(floor(v) * 91.7) * 4375.5);
      float grain = texture2D(tDetail, vec2(p.x * 0.25 + h, v * 0.31)).g;
      vec3 wc = diffuseColor.rgb * (0.84 + 0.28 * h) * (0.86 + 0.28 * grain);
      float k = near * (1.0 - smoothstep(0.3, 0.6, aa));
      diffuseColor.rgb = mix(diffuseColor.rgb, wc * mix(0.55, 1.0, seam), k);
    }
  }
  #endif`;

// земля: трава (пучки, тон, выгоревшие пятна) и асфальт (зерно, трещины) — тоже по цвету вершины
const GROUND = `
  #ifdef USE_COLOR
  {
    vec3 c = vColor;
    float mx = max(c.r, max(c.g, c.b)), sat = (mx - min(c.r, min(c.g, c.b))) / max(mx, 0.001);
    float near = 1.0 - smoothstep(25.0, 70.0, length(vViewPosition));
    if (c.g > c.r * 1.12 && c.g > c.b * 1.25) {
      vec4 tuft = triTex(tDetail, vWPos + 2.3, wn, 2.2), blade = triTex(tDetail, vWPos + 5.1, wn, 6.5);
      diffuseColor.rgb *= (0.84 + 0.32 * tuft.r) * mix(1.0, 0.72 + 0.55 * blade.g, near);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.3, 1.12, 0.62), smoothstep(0.62, 0.9, big.b) * 0.55);
    } else if (sat < 0.2 && mx < 0.1) {
      vec4 a = triTex(tDetail, vWPos + 1.3, wn, 3.5), cr = triTex(tDetail, vWPos + 7.7, wn, 0.35);
      diffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * a.g, near) * (1.0 - smoothstep(0.2, 0.7, cr.a) * 0.55 * near);
    }
  }
  #endif`;

// детальная текстура поверхности (см. textures.js): крупные пятна, оттенки, зерно и трещины по мировым
// координатам, трипланарно; мелкие детали гаснут с расстоянием. scale — плотность, amp — сила.
// patterns: true — для построек (по цвету узнаются кирпич и дерево), 'ground' — для земли (трава, асфальт)
export function addSurfaceDetail(material, scale = 3, amp = 0.09, patterns = false) {
  const T = textures();
  material.onBeforeCompile = shader => {
    shader.uniforms.uDetail = { value: new THREE.Vector2(scale, amp) };
    shader.uniforms.tDetail = { value: T.detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform vec2 uDetail;
        uniform sampler2D tDetail;
        ${TRIPLANAR}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
          float fade = 1.0 - smoothstep(18.0, 80.0, length(vViewPosition));
          vec4 big = triTex(tDetail, vWPos, wn, uDetail.x * 0.06);
          vec4 fine = triTex(tDetail, vWPos + 0.37, wn, uDetail.x * 0.42);
          float v = (big.r - 0.5) * 1.1 + (big.b - 0.5) * 0.9 + ((fine.g - 0.5) * 0.9 - fine.a * 0.7) * fade;
          diffuseColor.rgb *= 1.0 + v * uDetail.y * 1.7;
          ${patterns === 'ground' ? GROUND : patterns ? PATTERNS : ''}
        }`);
  };
  material.customProgramCacheKey = () => 'detail2_' + scale + '_' + amp + (patterns ? '_p' : '');
  return material;
}

// Общие неиндексированные примитивы
export const PRIM = {
  cone6: new THREE.ConeGeometry(1, 1, 14, 3).toNonIndexed(),
  cone5: new THREE.ConeGeometry(1, 1, 5, 1).toNonIndexed(),
  cyl5: new THREE.CylinderGeometry(1, 1, 1, 5, 1).toNonIndexed(),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6, 1).toNonIndexed(),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 18, 3).toNonIndexed(),
  ico: new THREE.IcosahedronGeometry(1, 2),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function mat(x, y, z, rx, ry, rz, sx, sy, sz) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s);
}
