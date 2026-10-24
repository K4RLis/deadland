// Столкновения: рельеф (карта высот) + коллайдеры AABB в пространственном хэше.
// Тела — вертикальные цилиндры (радиус, высота), умеют подниматься на ступеньки.
import * as C from './config.js';
import { clamp } from './rng.js';

export function topAt(c, x, z) {
  if (c.ramp < 0) return c.y1;
  let t;
  switch (c.ramp) {
    case 0: t = (z - c.z0) / (c.z1 - c.z0); break;
    case 1: t = (x - c.x0) / (c.x1 - c.x0); break;
    case 2: t = (c.z1 - z) / (c.z1 - c.z0); break;
    default: t = (c.x1 - x) / (c.x1 - c.x0);
  }
  return c.y0 + (c.y1 - c.y0) * clamp(t, 0, 1);
}

// луч против AABB; возвращает t входа и ось нормали
const rb = { t: 0, ax: 0, sg: 0 };
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxT) {
  let tmin = 0, tmax = maxT, ax = -1, sg = 0;
  if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) return null; }
  else {
    let t1 = (x0 - ox) / dx, t2 = (x1 - ox) / dx, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; ax = 0; sg = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return null; }
  else {
    let t1 = (y0 - oy) / dy, t2 = (y1 - oy) / dy, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; ax = 1; sg = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < z0 || oz > z1) return null; }
  else {
    let t1 = (z0 - oz) / dz, t2 = (z1 - oz) / dz, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; ax = 2; sg = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  rb.t = tmin; rb.ax = ax; rb.sg = sg;
  return rb;
}

export class Physics {
  constructor(world) {
    this.world = world;
    this.cs = 8;
    this.cells = new Map();
    this.qid = 1;
    this.tmp = [];
  }

  key(ix, iz) { return (ix + 1024) * 4096 + (iz + 1024); }

  add(c) {
    if (c.ramp === undefined) c.ramp = -1;
    c.off = c.off || false;
    c._q = 0;
    c._cells = [];
    const cs = this.cs;
    for (let ix = Math.floor(c.x0 / cs); ix <= Math.floor(c.x1 / cs); ix++)
      for (let iz = Math.floor(c.z0 / cs); iz <= Math.floor(c.z1 / cs); iz++) {
        const k = this.key(ix, iz);
        let a = this.cells.get(k); if (!a) this.cells.set(k, a = []);
        a.push(c); c._cells.push(k);
      }
  }

  remove(c) {
    if (!c._cells) return;
    for (const k of c._cells) {
      const a = this.cells.get(k);
      if (!a) continue;
      const i = a.indexOf(c);
      if (i >= 0) { a[i] = a[a.length - 1]; a.pop(); }
    }
    c._cells = null;
  }

  // возвращает общий массив — использовать сразу
  query(x0, z0, x1, z1) {
    const out = this.tmp; out.length = 0;
    const id = ++this.qid, cs = this.cs;
    for (let ix = Math.floor(x0 / cs); ix <= Math.floor(x1 / cs); ix++)
      for (let iz = Math.floor(z0 / cs); iz <= Math.floor(z1 / cs); iz++) {
        const a = this.cells.get(this.key(ix, iz));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const c = a[i];
          if (c._q === id || c.off) continue;
          c._q = id;
          if (c.x1 > x0 && c.x0 < x1 && c.z1 > z0 && c.z0 < z1) out.push(c);
        }
      }
    return out;
  }

  pushOut(b, p, r, H, step) {
    const list = this.query(p.x - r, p.z - r, p.x + r, p.z + r);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.ghost || c.y0 >= p.y + H - 0.02) continue;
      const cx = clamp(p.x, c.x0, c.x1), cz = clamp(p.z, c.z0, c.z1);
      if (topAt(c, cx, cz) <= p.y + step) continue;
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), k = (r - d) / d;
        p.x += dx * k; p.z += dz * k;
      } else {
        const l = p.x - c.x0, rr = c.x1 - p.x, f = p.z - c.z0, bk = c.z1 - p.z;
        const m = Math.min(l, rr, f, bk);
        if (m === l) p.x = c.x0 - r; else if (m === rr) p.x = c.x1 + r; else if (m === f) p.z = c.z0 - r; else p.z = c.z1 + r;
      }
      b.hitWall = true; b.wall = c;
    }
  }

  moveBody(b, dt) {
    const r = b.radius, H = b.height, step = b.step;
    const p = b.pos, v = b.vel;
    const ck = Math.floor(p.x / C.CHUNK) * 1000 + Math.floor(p.z / C.CHUNK);
    if (b._ck !== ck) { b._ck = ck; this.world.ensureAround(p.x, p.z, 1); }
    b.hitWall = false; b.wall = null;
    const hsp = Math.hypot(v.x, v.z) * dt;
    const n = Math.min(10, Math.max(1, Math.ceil(hsp / (r * 0.7))));
    const sdt = dt / n;
    for (let s = 0; s < n; s++) {
      p.x += v.x * sdt; p.z += v.z * sdt;
      this.pushOut(b, p, r, H, step);
    }
    const lim = C.HALF - 3;
    if (p.x < -lim) p.x = -lim; else if (p.x > lim) p.x = lim;
    if (p.z < -lim) p.z = -lim; else if (p.z > lim) p.z = lim;

    v.y -= C.GRAVITY * dt * (b.gravity ?? 1);
    let ny = p.y + v.y * dt;
    let ground = this.world.height(p.x, p.z);
    b.support = null;
    const rs = r * 0.7;
    const list = this.query(p.x - rs, p.z - rs, p.x + rs, p.z + rs);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.ghost) continue;
      const cx = clamp(p.x, c.x0, c.x1), cz = clamp(p.z, c.z0, c.z1);
      const dx = p.x - cx, dz = p.z - cz;
      if (dx * dx + dz * dz > rs * rs) continue;
      const top = topAt(c, clamp(p.x, c.x0, c.x1), clamp(p.z, c.z0, c.z1));
      if (top <= p.y + step + 0.01 && top > ground) { ground = top; b.support = c; }
      if (v.y > 0 && c.y0 >= p.y + H - 0.05 && ny + H > c.y0) { ny = c.y0 - H; v.y = 0; }
    }
    b.landV = 0;
    if (ny <= ground) {
      if (!b.grounded) b.landV = v.y;
      ny = ground; if (v.y < 0) v.y = 0; b.grounded = true;
    } else if (b.grounded && v.y <= 0 && p.y - ground < 0.5) {
      ny = ground; v.y = 0; b.grounded = true;
    } else b.grounded = false;
    p.y = ny;
    b.groundY = ground;
  }

  // свободно ли место для тела (для спавна)
  free(x, y, z, r, H) {
    const list = this.query(x - r, z - r, x + r, z + r);
    for (const c of list) if (!c.ghost && c.y1 > y + 0.4 && c.y0 < y + H) return false;
    return true;
  }

  rayTerrain(ox, oy, oz, dx, dy, dz, maxD) {
    const w = this.world;
    let d0 = oy - w.height(ox, oz);
    if (d0 < 0) return 0;
    let prev = 0, t = 0;
    while (t < maxD) {
      const stepLen = Math.max(0.7, Math.min(8, d0 * 0.45));
      t = Math.min(maxD, t + stepLen);
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      const d = y - w.height(x, z);
      if (d < 0) {
        let a = prev, b = t;
        for (let i = 0; i < 10; i++) {
          const m = (a + b) / 2;
          if (oy + dy * m - w.height(ox + dx * m, oz + dz * m) < 0) b = m; else a = m;
        }
        return b;
      }
      prev = t; d0 = d;
    }
    return Infinity;
  }

  // луч по коллайдерам и рельефу. opts.skip(c) — пропустить коллайдер
  raycast(ox, oy, oz, dx, dy, dz, maxD, opts = {}) {
    let best = maxD, hit = null, nax = -1, nsg = 0;
    const cs = this.cs;
    let ix = Math.floor(ox / cs), iz = Math.floor(oz / cs);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? Math.abs(cs / dx) : Infinity;
    const tdz = Math.abs(dz) > 1e-9 ? Math.abs(cs / dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? (dx > 0 ? (ix + 1) * cs - ox : ox - ix * cs) / Math.abs(dx) : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? (dz > 0 ? (iz + 1) * cs - oz : oz - iz * cs) / Math.abs(dz) : Infinity;
    const id = ++this.qid;
    let t = 0, guard = 0;
    while (t <= best && guard++ < 400) {
      const a = this.cells.get(this.key(ix, iz));
      if (a) for (let i = 0; i < a.length; i++) {
        const c = a[i];
        if (c._q === id || c.off) continue;
        c._q = id;
        if (opts.skip && opts.skip(c)) continue;
        const h = rayBox(ox, oy, oz, dx, dy, dz, c.x0, c.y0, c.z0, c.x1, c.y1, c.z1, best);
        if (h && h.t < best) { best = h.t; hit = c; nax = h.ax; nsg = h.sg; }
      }
      if (tmx < tmz) { t = tmx; tmx += tdx; ix += stepX; } else { t = tmz; tmz += tdz; iz += stepZ; }
    }
    let kind = hit ? hit.kind : null;
    if (!opts.noTerrain) {
      const tt = this.rayTerrain(ox, oy, oz, dx, dy, dz, best);
      if (tt < best) { best = tt; hit = null; kind = 'terrain'; nax = 1; nsg = 1; }
    }
    if (!kind) return null;
    const n = [0, 0, 0];
    if (nax >= 0) n[nax] = nsg;
    return { t: best, c: hit, kind, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best, n };
  }
}
