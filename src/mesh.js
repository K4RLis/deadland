// Сборщик плоско-затенённой low-poly геометрии с цветами вершин.
// Все объекты чанка сливаются в один меш — один draw call на чанк.
import * as THREE from 'three';

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

export class MeshBuilder {
  // facet — разброс яркости между треугольниками: гранёный «полигональный» вид
  constructor(facet = 0) { this.p = []; this.n = []; this.c = []; this.facet = facet; this.k = 0; }
  get empty() { return this.p.length === 0; }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    let f = 1;
    if (this.facet) {
      let h = Math.imul(++this.k ^ 0x9e3779b9, 2654435761);
      h ^= h >>> 15;
      f = 1 + (((h >>> 0) & 255) / 255 - 0.5) * this.facet;
    }
    const r = col[0] * f, g = col[1] * f, b = col[2] * f;
    this.c.push(r, g, b, r, g, b, r, g, b);
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

  // треугольная призма (двускатная крыша) внутри ограничивающего бокса
  prism(x0, y0, z0, x1, y1, z1, col, ridgeX) {
    const s = shade(col, 0.9);
    if (ridgeX) {
      const zm = (z0 + z1) / 2;
      this.quad(x0, y0, z1, x1, y0, z1, x1, y1, zm, x0, y1, zm, col);
      this.quad(x1, y0, z0, x0, y0, z0, x0, y1, zm, x1, y1, zm, s);
      this.tri(x1, y0, z1, x1, y0, z0, x1, y1, zm, s);
      this.tri(x0, y0, z0, x0, y0, z1, x0, y1, zm, s);
    } else {
      const xm = (x0 + x1) / 2;
      this.quad(x1, y0, z1, x1, y0, z0, xm, y1, z0, xm, y1, z1, col);
      this.quad(x0, y0, z0, x0, y0, z1, xm, y1, z1, xm, y1, z0, s);
      this.tri(x0, y0, z1, x1, y0, z1, xm, y1, z1, s);
      this.tri(x1, y0, z0, x0, y0, z0, xm, y1, z0, s);
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
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// Общие неиндексированные примитивы
export const PRIM = {
  cone6: new THREE.ConeGeometry(1, 1, 6, 1).toNonIndexed(),
  cone5: new THREE.ConeGeometry(1, 1, 5, 1).toNonIndexed(),
  cyl5: new THREE.CylinderGeometry(1, 1, 1, 5, 1).toNonIndexed(),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6, 1).toNonIndexed(),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1).toNonIndexed(),
  ico: new THREE.IcosahedronGeometry(1, 0).toNonIndexed(),
  dodeca: new THREE.DodecahedronGeometry(1, 0).toNonIndexed(),
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
