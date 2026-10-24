// Постройки: дома, магазины, полиция, склады, военная база, машины, место крушения.
// Локальные координаты: центр основания в (0,0,0), фасад (дверь) смотрит в +Z.
// Части: t:0 бокс, t:1 двускатная призма, t:3 произвольные треугольники.
import { shuffle } from './rng.js';

export const NOSOLID = 1, GLASS = 2, INVIS = 4;
const TH = 0.2;

export const CONTAINER_KINDS = {
  cabinet: { w: 1.0, h: 0.9, d: 0.5, color: 0x8a5a3a, name: 'Тумбочка' },
  fridge: { w: 0.8, h: 1.8, d: 0.7, color: 0xe6e6e2, name: 'Холодильник' },
  wardrobe: { w: 1.2, h: 2.0, d: 0.6, color: 0x6e4a2e, name: 'Шкаф' },
  shelf: { w: 1.8, h: 1.8, d: 0.5, color: 0x8f9396, name: 'Стеллаж' },
  crate: { w: 1.0, h: 1.0, d: 1.0, color: 0x9c7a48, name: 'Ящик' },
  mcrate: { w: 1.3, h: 0.8, d: 0.8, color: 0x4f5d3a, name: 'Военный ящик' },
  locker: { w: 0.7, h: 1.9, d: 0.5, color: 0x5a6e80, name: 'Шкафчик' },
  rack: { w: 1.6, h: 1.6, d: 0.4, color: 0x3a3a3a, name: 'Оружейная стойка' },
  trunk: { w: 1.7, h: 0.8, d: 0.7, color: null, name: 'Багажник' },
  case: { w: 1.0, h: 0.5, d: 0.7, color: 0xb8bcc0, name: 'Кейс с грузом' },
  radio: { w: 1.4, h: 1.0, d: 0.7, color: 0x4a5a3a, name: 'Военная рация' },
  counter: { w: 2.0, h: 1.0, d: 0.6, color: 0x7a6a5a, name: 'Касса' },
  medcab: { w: 1.0, h: 1.6, d: 0.45, color: 0xf0f0f0, name: 'Медицинский шкаф' },
};

export const PREFAB_SIZE = {
  house: [9, 8], house2: [10, 9], cabin: [6, 6], shop: [12, 10], police: [12, 10], clinic: [12, 10],
  warehouse: [16, 12], apartment: [12, 11], gas: [12, 14], barracks: [14, 8], tent: [5, 6],
  car: [2.2, 4.4], truck: [2.6, 6.6], crash: [8, 13], radio: [10, 6], helipad: [16, 16],
  tower: [4, 7], milfence: [124, 124], cratepile: [4, 3],
};

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

function bx(P, x0, y0, z0, x1, y1, z1, c, f = 0) {
  P.push({
    t: 0,
    a: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    b: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    c, solid: !(f & NOSOLID), glass: !!(f & GLASS), invis: !!(f & INVIS),
  });
}

function prism(P, x0, y0, z0, x1, y1, z1, c, ridgeX) {
  P.push({ t: 1, a: [x0, y0, z0], b: [x1, y1, z1], c, rx: ridgeX });
}

// стена вдоль X (z = const) с проёмами [{a, b, lo, hi, glass}]
function wallX(P, x0, x1, z, y0, y1, c, ops = []) {
  ops = ops.filter(o => o.b > x0 && o.a < x1).sort((p, q) => p.a - q.a);
  let cur = x0;
  for (const o of ops) {
    if (o.a > cur) bx(P, cur, y0, z - TH / 2, o.a, y1, z + TH / 2, c);
    if (o.lo > y0) bx(P, o.a, y0, z - TH / 2, o.b, o.lo, z + TH / 2, c);
    if (o.hi < y1) bx(P, o.a, o.hi, z - TH / 2, o.b, y1, z + TH / 2, c);
    if (o.glass) {
      bx(P, o.a, o.lo, z - 0.03, o.b, o.hi, z + 0.03, 'glass', GLASS);
      bx(P, o.a - 0.08, o.lo - 0.07, z - TH / 2 - 0.07, o.b + 0.08, o.lo, z + TH / 2 + 0.07, 'trim', NOSOLID);
      bx(P, o.a - 0.06, o.hi, z - TH / 2 - 0.03, o.b + 0.06, o.hi + 0.09, z + TH / 2 + 0.03, 'trim', NOSOLID);
      bx(P, (o.a + o.b) / 2 - 0.025, o.lo, z - 0.05, (o.a + o.b) / 2 + 0.025, o.hi, z + 0.05, 'trim', NOSOLID);
    } else if (o.lo <= y0 + 0.01 && o.hi < y1) {
      bx(P, o.a - 0.09, y0, z - TH / 2 - 0.04, o.a, o.hi + 0.09, z + TH / 2 + 0.04, 'trim', NOSOLID);
      bx(P, o.b, y0, z - TH / 2 - 0.04, o.b + 0.09, o.hi + 0.09, z + TH / 2 + 0.04, 'trim', NOSOLID);
      bx(P, o.a - 0.09, o.hi, z - TH / 2 - 0.04, o.b + 0.09, o.hi + 0.09, z + TH / 2 + 0.04, 'trim', NOSOLID);
    }
    cur = o.b;
  }
  if (cur < x1) bx(P, cur, y0, z - TH / 2, x1, y1, z + TH / 2, c);
}

function wallZ(P, z0, z1, x, y0, y1, c, ops = []) {
  ops = ops.filter(o => o.b > z0 && o.a < z1).sort((p, q) => p.a - q.a);
  let cur = z0;
  for (const o of ops) {
    if (o.a > cur) bx(P, x - TH / 2, y0, cur, x + TH / 2, y1, o.a, c);
    if (o.lo > y0) bx(P, x - TH / 2, y0, o.a, x + TH / 2, o.lo, o.b, c);
    if (o.hi < y1) bx(P, x - TH / 2, o.hi, o.a, x + TH / 2, y1, o.b, c);
    if (o.glass) {
      bx(P, x - 0.03, o.lo, o.a, x + 0.03, o.hi, o.b, 'glass', GLASS);
      bx(P, x - TH / 2 - 0.07, o.lo - 0.07, o.a - 0.08, x + TH / 2 + 0.07, o.lo, o.b + 0.08, 'trim', NOSOLID);
      bx(P, x - TH / 2 - 0.03, o.hi, o.a - 0.06, x + TH / 2 + 0.03, o.hi + 0.09, o.b + 0.06, 'trim', NOSOLID);
      bx(P, x - 0.05, o.lo, (o.a + o.b) / 2 - 0.025, x + 0.05, o.hi, (o.a + o.b) / 2 + 0.025, 'trim', NOSOLID);
    }
    cur = o.b;
  }
  if (cur < z1) bx(P, x - TH / 2, y0, cur, x + TH / 2, y1, z1, c);
}

function spots(len, spacing = 3.4) {
  const n = Math.max(1, Math.floor(len / spacing));
  const s = len / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(-len / 2 + s * (i + 0.5));
  return out;
}

function slabHole(P, x0, z0, x1, z1, y0, y1, h, c) {
  if (h.z0 > z0) bx(P, x0, y0, z0, x1, y1, h.z0, c);
  if (h.z1 < z1) bx(P, x0, y0, h.z1, x1, y1, z1, c);
  if (h.x0 > x0) bx(P, x0, y0, h.z0, h.x0, y1, h.z1, c);
  if (h.x1 < x1) bx(P, h.x1, y0, h.z0, x1, y1, h.z1, c);
}

// Коробка здания: этажи, окна, дверь, лестницы с проёмами, крыша.
function shell(P, o) {
  const w = o.w, d = o.d, floors = o.floors || 1, fh = o.fh || 3.2;
  const hw = w / 2, hd = d / 2;
  const doorX = o.doorX ?? 0, doorW = o.doorW ?? 1.4, doorH = o.doorH ?? 2.2;
  const winLo = o.winLo ?? 0.9, winHi = o.winHi ?? 2.1, winW = o.winW ?? 1.2;
  const wall = o.wall || 'wall';
  bx(P, -hw - 0.15, -2.5, -hd - 0.15, hw + 0.15, 0.2, hd + 0.15, 'found');
  const holes = [], floorY = [];
  let top = 0;
  for (let f = 0; f < floors; f++) {
    const y0 = 0.2 + f * fh, y1 = y0 + fh - 0.2;
    floorY.push(y0);
    const lo = y0 + winLo, hi = Math.min(y0 + winHi, y1 - 0.2);
    const front = [], back = [], left = [], right = [];
    if (f === 0) front.push({ a: doorX - doorW / 2, b: doorX + doorW / 2, lo: y0, hi: y0 + doorH });
    if (o.win !== false) {
      for (const c of spots(w - 1, o.winSpacing || 3.4)) {
        if (f > 0 || Math.abs(c - doorX) > doorW / 2 + winW / 2 + 0.3) front.push({ a: c - winW / 2, b: c + winW / 2, lo, hi, glass: true });
        if (!o.noBackWin) back.push({ a: c - winW / 2, b: c + winW / 2, lo, hi, glass: true });
      }
      for (const c of spots(d - 1.6)) {
        const ww = Math.min(winW, 1.2);
        left.push({ a: c - ww / 2, b: c + ww / 2, lo, hi, glass: true });
        right.push({ a: c - ww / 2, b: c + ww / 2, lo, hi, glass: true });
      }
    }
    wallX(P, -hw, hw, hd - TH / 2, y0, y1, wall, front);
    wallX(P, -hw, hw, -hd + TH / 2, y0, y1, wall, back);
    wallZ(P, -hd + TH, hd - TH, -hw + TH / 2, y0, y1, wall, left);
    wallZ(P, -hd + TH, hd - TH, hw - TH / 2, y0, y1, wall, right);
    if (f < floors - 1) {
      // межэтажный пояс снаружи
      bx(P, -hw, y1, hd - TH, hw, y1 + 0.2, hd, 'trim');
      bx(P, -hw, y1, -hd, hw, y1 + 0.2, -hd + TH, 'trim');
      bx(P, -hw, y1, -hd + TH, -hw + TH, y1 + 0.2, hd - TH, 'trim');
      bx(P, hw - TH, y1, -hd + TH, hw, y1 + 0.2, hd - TH, 'trim');
      const leftSide = f % 2 === 0;
      const sx0 = leftSide ? -hw + TH : hw - TH - 1.2, sx1 = sx0 + 1.2;
      const n = Math.round(fh / 0.32), rise = fh / n, run = 0.4;
      const zs = hd - TH - 0.6;
      for (let i = 0; i < n; i++) bx(P, sx0, y0, zs - (i + 1) * run, sx1, y0 + (i + 1) * rise, zs - i * run, 'stairs');
      const hole = { x0: sx0, x1: sx1, z0: zs - n * run, z1: zs };
      holes.push({ f, ...hole });
      slabHole(P, -hw + TH, -hd + TH, hw - TH, hd - TH, y1, y1 + 0.2, hole, 'floor');
      const t2 = y1 + 0.2;
      const rx = leftSide ? sx1 : sx0;
      bx(P, rx - 0.04, t2, hole.z0 + 0.6, rx + 0.04, t2 + 1.0, hole.z1, 'trim');
      bx(P, sx0, t2, hole.z1 - 0.08, sx1, t2 + 1.0, hole.z1, 'trim');
    } else {
      bx(P, -hw, y1, -hd, hw, y1 + 0.2, hd, 'ceil');
      top = y1 + 0.2;
      if (o.roof === 'flat') {
        bx(P, -hw, top, hd - 0.25, hw, top + 0.5, hd, wall);
        bx(P, -hw, top, -hd, hw, top + 0.5, -hd + 0.25, wall);
        bx(P, -hw, top, -hd + 0.25, -hw + 0.25, top + 0.5, hd - 0.25, wall);
        bx(P, hw - 0.25, top, -hd + 0.25, hw, top + 0.5, hd - 0.25, wall);
        bx(P, -hw + 0.25, top, -hd + 0.25, hw - 0.25, top + 0.06, hd - 0.25, 'roof', NOSOLID);
      } else {
        const ridgeX = w >= d;
        const rh = Math.min(w, d) * 0.33;
        bx(P, -hw - 0.4, top - 0.08, -hd - 0.4, hw + 0.4, top + 0.02, hd + 0.4, 'trim', NOSOLID);
        prism(P, -hw - 0.35, top, -hd - 0.35, hw + 0.35, top + rh, hd + 0.35, 'roof', ridgeX);
        const cx0 = ridgeX ? hw * 0.45 : hw * 0.25, cz0 = ridgeX ? -hd * 0.25 : hd * 0.45;
        bx(P, cx0 - 0.3, top + rh * 0.3, cz0 - 0.3, cx0 + 0.3, top + rh + 0.7, cz0 + 0.3, 'brick', NOSOLID);
        bx(P, cx0 - 0.36, top + rh + 0.7, cz0 - 0.36, cx0 + 0.36, top + rh + 0.82, cz0 + 0.36, 'brick', NOSOLID);
      }
    }
  }
  // угловые пилястры
  const yt = top || 0.2 + floors * fh;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const xa = sx < 0 ? -hw - 0.06 : hw - 0.12, xb = sx < 0 ? -hw + 0.12 : hw + 0.06;
    const za = sz < 0 ? -hd - 0.06 : hd - 0.12, zb = sz < 0 ? -hd + 0.12 : hd + 0.06;
    bx(P, xa, 0.2, za, xb, yt, zb, 'trim', NOSOLID);
  }
  return { w, d, hw, hd, floorY, holes, fh, doorX, doorW, top };
}

function overlap(a, b) { return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]; }

// Расставить контейнеры и мебель вдоль стен
function furnish(P, C, info, rng, kinds, tier, perFloor, opts = {}) {
  const { hw, hd, floorY, holes, doorX, doorW } = info;
  const floors = opts.onlyGround ? 1 : floorY.length;
  for (let f = 0; f < floors; f++) {
    const y = floorY[f];
    const blocked = [];
    for (const h of holes) if (h.f === f || h.f === f - 1) blocked.push([h.x0 - 0.3, h.z0 - 0.7, h.x1 + 0.3, h.z1 + 0.7]);
    if (f === 0) blocked.push([doorX - doorW / 2 - 0.9, hd - 2.4, doorX + doorW / 2 + 0.9, hd + 1]);
    if (opts.blocked) blocked.push(...opts.blocked);
    const slots = [];
    for (const t of spots(info.w - 2.2, 1.7)) { slots.push({ wall: 'b', t }); slots.push({ wall: 'f', t }); }
    for (const t of spots(info.d - 2.2, 1.7)) { slots.push({ wall: 'l', t }); slots.push({ wall: 'r', t }); }
    shuffle(slots, rng);
    let placed = 0;
    const furn = opts.furniture ?? 1;
    let furnPlaced = 0;
    for (const s of slots) {
      const isCont = placed < perFloor;
      if (!isCont && furnPlaced >= furn) break;
      let kind, k;
      if (isCont) { kind = kinds[Math.floor(rng() * kinds.length)]; k = CONTAINER_KINDS[kind]; }
      else { kind = pick(opts.furnKinds || ['bed', 'table', 'sofa'], rng); k = FURN[kind]; }
      let cx, cz, swap = false;
      if (s.wall === 'b') { cx = s.t; cz = -hd + TH + k.d / 2 + 0.03; }
      else if (s.wall === 'f') { cx = s.t; cz = hd - TH - k.d / 2 - 0.03; }
      else if (s.wall === 'l') { swap = true; cz = s.t; cx = -hw + TH + k.d / 2 + 0.03; }
      else { swap = true; cz = s.t; cx = hw - TH - k.d / 2 - 0.03; }
      const rect = swap ? [cx - k.d / 2, cz - k.w / 2, cx + k.d / 2, cz + k.w / 2] : [cx - k.w / 2, cz - k.d / 2, cx + k.w / 2, cz + k.d / 2];
      if (rect[0] < -hw + TH - 0.01 || rect[2] > hw - TH + 0.01 || rect[1] < -hd + TH - 0.01 || rect[3] > hd - TH + 0.01) continue;
      if (blocked.some(b => overlap(b, rect))) continue;
      blocked.push([rect[0] - 0.25, rect[1] - 0.25, rect[2] + 0.25, rect[3] + 0.25]);
      if (isCont) { C.push({ kind, tier, x: cx, y, z: cz, swap }); placed++; }
      else { k.build(P, rect, y); furnPlaced++; }
    }
  }
}

const FURN = {
  bed: { w: 2.0, d: 1.0, build(P, r, y) { bx(P, r[0], y, r[1], r[2], y + 0.45, r[3], 0xe8e2d6); bx(P, r[0] + 0.05, y + 0.45, r[1] + 0.05, r[2] - 0.05, y + 0.5, r[3] - 0.05, 0x5577aa, NOSOLID); } },
  table: { w: 1.4, d: 0.9, build(P, r, y) { bx(P, r[0], y + 0.7, r[1], r[2], y + 0.78, r[3], 0x7a5534); bx(P, r[0] + 0.1, y, r[1] + 0.1, r[2] - 0.1, y + 0.7, r[3] - 0.1, 0x6a4a2c); } },
  sofa: { w: 2.0, d: 0.9, build(P, r, y) { bx(P, r[0], y, r[1], r[2], y + 0.45, r[3], 0x7a3b3b); } },
  bench: { w: 2.0, d: 0.8, build(P, r, y) { bx(P, r[0], y, r[1], r[2], y + 0.45, r[3], 0x55603e); } },
};

// ---------- палитры ----------
const WALLS = [0xdcd2bc, 0xb9c6cf, 0xc99273, 0xa8b892, 0xe6e4dc, 0xd9c27a, 0xc4b4a0, 0xb07a6a];
const DESERT_WALLS = [0xd8c39a, 0xc9a77a, 0xe0d2b0, 0xb98d66, 0xd2b48c];
const ROOFS = [0x8e3b2f, 0x4b5763, 0x5e4433, 0x40604a, 0x7a3030, 0x6a6a72];
const SIGNS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x8e44ad];
const CARS = [0x8e2b2b, 0x2b4f8e, 0xc8c8c4, 0x2e2e2e, 0x5e7d3a, 0xc9a227, 0x7a5a3a, 0x3a6a6a];

function pal(rng, L, over = {}) {
  const snow = L.biome === 'snow';
  return {
    wall: pick(L.biome === 'desert' ? DESERT_WALLS : WALLS, rng), trim: 0xefeae0,
    roof: snow ? 0xf0f4f7 : pick(ROOFS, rng), floor: 0x8f6c49, stairs: 0x7a5a3c, found: 0x8b8680,
    ceil: 0xd8d4cc, glass: 0x9ccbe0, metal: 0x6f777e, dark: 0x2b2b2b, sign: pick(SIGNS, rng),
    white: 0xf2f2ee, red: 0xd03030, concrete: 0x9a9a96, mil: 0x5f6b45, mil2: 0x4a5536, brick: 0x8a4a3a,
    tent: snow ? 0xd9ddd5 : 0x6b7a4f, body: pick(CARS, rng), heli: 0x4d5a3c, scorch: 0x2a2622,
    fence: 0x7d8a7a, sand: 0xbca77a, yellow: 0xe8c547, blue: 0x1f4e9c,
    tire: 0x1c1c1c, chrome: 0xb8bcc0, lamp: 0xf2eed8, tail: 0xa82020, plate: 0xe6e6de,
    ...over,
  };
}

// ---------- префабы ----------
const P_ = {
  house(rng, L) {
    const P = [], C = [];
    const info = shell(P, { w: 9, d: 8, floors: 1 });
    furnish(P, C, info, rng, ['cabinet', 'fridge', 'wardrobe', 'cabinet'], 'house', 3, { furniture: 2 });
    // крыльцо
    bx(P, -1.4, 0, 4, 1.4, 0.18, 5.0, 'found');
    return { P, C, pal: pal(rng, L) };
  },
  house2(rng, L) {
    const P = [], C = [];
    const info = shell(P, { w: 10, d: 9, floors: 2, doorX: 1.5 });
    furnish(P, C, info, rng, ['cabinet', 'fridge', 'wardrobe', 'cabinet', 'shelf'], 'house', 2, { furniture: 1 });
    bx(P, 0, 0, 4.5, 3, 0.18, 5.6, 'found');
    return { P, C, pal: pal(rng, L) };
  },
  cabin(rng, L) {
    const P = [], C = [];
    const info = shell(P, { w: 6, d: 6, floors: 1, fh: 3.0, winW: 0.9 });
    furnish(P, C, info, rng, ['cabinet', 'wardrobe', 'crate'], 'house', 2, { furniture: 1, furnKinds: ['bed', 'table'] });
    return { P, C, pal: pal(rng, L, { wall: 0x8a5f3c, trim: 0x6a4a2c, roof: L.biome === 'snow' ? 0xf0f4f7 : 0x4e3a2a, ceil: 0x7a5a3a }) };
  },
  shop(rng, L) {
    const P = [], C = [];
    shell(P, { w: 12, d: 10, floors: 1, fh: 4, roof: 'flat', winW: 2.4, winLo: 0.5, winHi: 3.0, doorW: 1.8, noBackWin: true });
    for (const [x, z] of [[-3, -0.6], [3, -0.6], [-3, -3.3], [3, -3.3]]) C.push({ kind: 'shelf', tier: 'shop', x, y: 0.2, z, swap: false });
    C.push({ kind: 'counter', tier: 'shop', x: 3.2, y: 0.2, z: 2.6, swap: false });
    C.push({ kind: 'fridge', tier: 'shop', x: -5.3, y: 0.2, z: 2.5, swap: true });
    bx(P, -3, 3.1, 5.0, 3, 3.75, 5.18, 'sign');
    return { P, C, pal: pal(rng, L) };
  },
  clinic(rng, L) {
    const P = [], C = [];
    const info = shell(P, { w: 12, d: 10, floors: 1, fh: 3.6, roof: 'flat', doorW: 1.8 });
    furnish(P, C, info, rng, ['medcab', 'medcab', 'cabinet'], 'medical', 4, { furniture: 2, furnKinds: ['bed', 'bed', 'table'] });
    bx(P, -0.35, 2.4, 5.0, 0.35, 3.4, 5.15, 'red');
    bx(P, -0.85, 2.55, 5.0, 0.85, 3.25, 5.15, 'red');
    return { P, C, pal: pal(rng, L, { wall: 0xeeeeea, trim: 0xd03030 }) };
  },
  police(rng, L) {
    const P = [], C = [];
    shell(P, { w: 12, d: 10, floors: 1, fh: 3.4, roof: 'flat', doorW: 1.6 });
    for (const x of [-4.5, -3.6, -2.7]) C.push({ kind: 'locker', tier: 'police', x, y: 0.2, z: -4.5, swap: false });
    C.push({ kind: 'rack', tier: 'police', x: 5.55, y: 0.2, z: -2.5, swap: true });
    C.push({ kind: 'cabinet', tier: 'police', x: 3.5, y: 0.2, z: -4.5, swap: false });
    C.push({ kind: 'locker', tier: 'police', x: -5.5, y: 0.2, z: 1.5, swap: true });
    bx(P, -6.02, 2.3, 4.98, 6.02, 2.65, 5.04, 'blue', NOSOLID);
    bx(P, -6.02, 2.3, -5.04, 6.02, 2.65, -4.98, 'blue', NOSOLID);
    bx(P, -0.8, 3.7, 3.6, 0, 4.0, 4.0, 'red');
    bx(P, 0, 3.7, 3.6, 0.8, 4.0, 4.0, 'blue');
    return { P, C, pal: pal(rng, L, { wall: 0xd0d8e0, trim: 0x1f4e9c }) };
  },
  warehouse(rng, L) {
    const P = [], C = [];
    shell(P, { w: 16, d: 12, floors: 1, fh: 6, doorW: 4, doorH: 4, winLo: 4, winHi: 5.3, winW: 1.6, roof: rng() < 0.5 ? 'flat' : 'gable' });
    const spots2 = shuffle([[-5, -3], [-3.6, -3], [-5, -1.5], [2, -3.5], [3.2, -3.5], [5.5, 0], [5.5, 1.3], [-5.5, 2.5], [0, -4.8]], rng);
    for (let i = 0; i < 6; i++) C.push({ kind: 'crate', tier: 'industrial', x: spots2[i][0], y: 0.2, z: spots2[i][1], swap: false });
    C.push({ kind: 'shelf', tier: 'industrial', x: 6.8, y: 0.2, z: -3.5, swap: true });
    return { P, C, pal: pal(rng, L, { wall: pick([0x8a9aa6, 0xa36b4f, 0x8f8a6a], rng), roof: L.biome === 'snow' ? 0xf0f4f7 : 0x5a6670 }) };
  },
  apartment(rng, L) {
    const P = [], C = [];
    const floors = 3 + (rng() < 0.45 ? 1 : 0);
    const info = shell(P, { w: 12, d: 11, floors, roof: 'flat', doorW: 1.6 });
    furnish(P, C, info, rng, ['cabinet', 'fridge', 'wardrobe', 'shelf'], 'house', 2, { furniture: 1 });
    bx(P, -1.6, 2.6, 5.5, 1.6, 2.8, 6.6, 'trim');
    return { P, C, pal: pal(rng, L, { wall: pick([0xb8b0a0, 0xc8a890, 0x9aa8b0, 0xd6d0c4, 0xa89888], rng) }) };
  },
  gas(rng, L) {
    const P = [], C = [];
    const i0 = P.length;
    shell(P, { w: 8, d: 6, floors: 1, fh: 3.4, roof: 'flat', winW: 2.0, winLo: 0.6, winHi: 2.6, doorW: 1.6, noBackWin: true });
    for (let i = i0; i < P.length; i++) { P[i].a[2] -= 4; P[i].b[2] -= 4; }
    C.push({ kind: 'shelf', tier: 'shop', x: -2.5, y: 0.2, z: -6.4, swap: false });
    C.push({ kind: 'shelf', tier: 'shop', x: 1.2, y: 0.2, z: -6.4, swap: false });
    C.push({ kind: 'counter', tier: 'shop', x: 2.4, y: 0.2, z: -2.2, swap: false });
    for (const [x, z] of [[-4.6, 1.2], [4.6, 1.2], [-4.6, 6.2], [4.6, 6.2]]) bx(P, x - 0.18, 0, z - 0.18, x + 0.18, 4.4, z + 0.18, 'trim');
    bx(P, -5.6, 4.4, 0.4, 5.6, 4.85, 7, 'sign');
    bx(P, -6, -1, 0.2, 6, 0.08, 7, 'concrete');
    for (const x of [-1.8, 1.8]) { bx(P, x - 0.4, 0.08, 3.3, x + 0.4, 1.6, 4.1, 'red'); bx(P, x - 0.3, 1.0, 3.25, x + 0.3, 1.4, 3.3, 'white', NOSOLID); }
    return { P, C, pal: pal(rng, L) };
  },
  barracks(rng, L) {
    const P = [], C = [];
    const info = shell(P, { w: 14, d: 8, floors: 1, fh: 3.2 });
    furnish(P, C, info, rng, ['locker', 'locker', 'mcrate'], 'military', 4, { furniture: 3, furnKinds: ['bed'] });
    return { P, C, pal: pal(rng, L, { wall: 0x6b7a4f, trim: 0x55603e, roof: L.biome === 'snow' ? 0xf0f4f7 : 0x4a5536 }) };
  },
  tent(rng, L) {
    const P = [], C = [];
    // скаты и задняя стенка, вход спереди открыт
    const tris = [
      [[-2.5, 0, 3], [-2.5, 0, -3], [0, 2.6, -3]], [[-2.5, 0, 3], [0, 2.6, -3], [0, 2.6, 3]],
      [[2.5, 0, -3], [2.5, 0, 3], [0, 2.6, 3]], [[2.5, 0, -3], [0, 2.6, 3], [0, 2.6, -3]],
      [[-2.5, 0, -3], [2.5, 0, -3], [0, 2.6, -3]],
    ];
    P.push({ t: 3, tris, c: 'tent', two: true });
    bx(P, -2.5, 0, -3, -1.7, 1.3, 3, 'tent', INVIS);
    bx(P, 1.7, 0, -3, 2.5, 1.3, 3, 'tent', INVIS);
    bx(P, -2.5, 0, -3.05, 2.5, 2.4, -2.9, 'tent', INVIS);
    bx(P, -2.4, -0.3, -3, 2.4, 0.05, 3, 'mil2', NOSOLID);
    C.push({ kind: 'mcrate', tier: 'military', x: -0.6, y: 0.05, z: -2.2, swap: false });
    if (rng() < 0.6) C.push({ kind: 'mcrate', tier: 'military', x: 0.9, y: 0.05, z: 0.3, swap: true });
    bx(P, -1.6, 0.05, -1.2, -0.8, 0.45, 1.8, 'mil');
    return { P, C, pal: pal(rng, L) };
  },
  car(rng, L) {
    const P = [], C = [];
    bx(P, -1.0, 0.35, -2.2, 1.0, 1.05, 2.2, 'body');
    bx(P, -0.9, 1.05, -1.1, 0.9, 1.5, 0.9, 'glass2');
    bx(P, -0.93, 1.5, -1.15, 0.93, 1.62, 0.95, 'body', NOSOLID);
    // капот и крышка багажника, стойки поверх стёкол, дворники
    bx(P, -0.95, 1.05, 0.92, 0.95, 1.09, 2.15, 'body', NOSOLID);
    bx(P, -0.95, 1.05, -2.15, 0.95, 1.08, -1.12, 'body', NOSOLID);
    for (const z of [0.88, -0.12, -1.08]) for (const s of [-1, 1]) bx(P, s * 0.85, 1.05, z - 0.05, s * 0.93, 1.5, z + 0.05, 'body', NOSOLID);
    bx(P, -0.6, 1.09, 0.93, -0.06, 1.11, 0.97, 'dark', NOSOLID);
    bx(P, 0.06, 1.09, 0.93, 0.6, 1.11, 0.97, 'dark', NOSOLID);
    // бамперы, решётка, номера, выхлоп
    bx(P, -1.04, 0.3, 2.18, 1.04, 0.52, 2.34, 'dark', NOSOLID);
    bx(P, -1.04, 0.3, -2.34, 1.04, 0.52, -2.18, 'dark', NOSOLID);
    bx(P, -0.5, 0.6, 2.2, 0.5, 0.92, 2.24, 'chrome', NOSOLID);
    for (const y of [0.66, 0.74, 0.82]) bx(P, -0.47, y, 2.235, 0.47, y + 0.04, 2.25, 'dark', NOSOLID);
    bx(P, -0.25, 0.36, 2.34, 0.25, 0.48, 2.36, 'plate', NOSOLID);
    bx(P, -0.25, 0.36, -2.36, 0.25, 0.48, -2.34, 'plate', NOSOLID);
    bx(P, 0.55, 0.26, -2.42, 0.65, 0.34, -2.2, 'dark', NOSOLID);
    for (const s of [-1, 1]) {
      bx(P, s * 0.56, 0.68, 2.2, s * 0.92, 0.93, 2.245, 'chrome', NOSOLID);
      bx(P, s * 0.6, 0.71, 2.24, s * 0.88, 0.9, 2.265, 'lamp', NOSOLID);
      bx(P, s * 0.6, 0.75, -2.24, s * 0.92, 0.95, -2.2, 'tail', NOSOLID);
      bx(P, s * 0.98, 1.06, 0.7, s * 1.2, 1.24, 0.84, 'body', NOSOLID);
      bx(P, s * 1.0, 0.82, 0.24, s * 1.035, 0.86, 0.44, 'chrome', NOSOLID);
      bx(P, s * 1.0, 0.82, -0.9, s * 1.035, 0.86, -0.7, 'chrome', NOSOLID);
      for (const z of [0.88, -0.1, -1.06]) bx(P, s * 0.995, 0.4, z - 0.015, s * 1.012, 1.05, z + 0.015, 'dark', NOSOLID);
      bx(P, s * 0.99, 0.35, -0.95, s * 1.015, 0.45, 0.95, 'dark', NOSOLID);
    }
    // колёса: восьмигранная шина, колпак, ступица; арки над ними
    for (const [x, z] of [[-1.02, 1.35], [1.02, 1.35], [-1.02, -1.35], [1.02, -1.35]]) {
      const o = Math.sign(x);
      bx(P, x - o * 0.03, 0.35, z - 0.44, x + o * 0.0, 0.8, z + 0.44, 'dark', NOSOLID);
      bx(P, x - 0.15, 0.1, z - 0.36, x + 0.15, 0.62, z + 0.36, 'tire', NOSOLID);
      bx(P, x - 0.15, 0, z - 0.26, x + 0.15, 0.72, z + 0.26, 'tire', NOSOLID);
      bx(P, x + o * 0.15, 0.18, z - 0.17, x + o * 0.17, 0.54, z + 0.17, 'chrome', NOSOLID);
      bx(P, x + o * 0.15, 0.23, z - 0.22, x + o * 0.17, 0.49, z + 0.22, 'chrome', NOSOLID);
      bx(P, x + o * 0.17, 0.31, z - 0.05, x + o * 0.19, 0.41, z + 0.05, 'dark', NOSOLID);
    }
    if (rng() < 0.6) bx(P, -0.6, 1.09, 1.0, 0.4, 1.1, 1.8, 'rust', NOSOLID);
    if (rng() < 0.4) { const rz0 = -1.9 + rng() * 0.6; bx(P, 0.995, 0.5, rz0, 1.014, 0.78, rz0 + 0.5, 'rust', NOSOLID); }
    C.push({ kind: 'trunk', tier: 'car', x: 0, y: 0.35, z: -1.95, swap: false });
    const body = pick(CARS, rng);
    return { P, C, pal: pal(rng, L, { body, glass2: 0x2f3d48, rust: 0x6a4a30 }) };
  },
  truck(rng, L) {
    const P = [], C = [];
    bx(P, -1.25, 0.5, 1.6, 1.25, 2.4, 3.3, 'mil');
    bx(P, -1.2, 1.5, 3.3, 1.2, 2.3, 3.35, 'glass2', NOSOLID);
    bx(P, -1.3, 0.5, -3.3, 1.3, 1.0, 1.6, 'mil2');
    bx(P, -1.3, 1.0, -3.3, -1.2, 1.6, 1.6, 'mil2');
    bx(P, 1.2, 1.0, -3.3, 1.3, 1.6, 1.6, 'mil2');
    P.push({ t: 1, a: [-1.3, 1.6, -3.3], b: [1.3, 2.9, 1.5], c: 'tent', rx: false });
    for (const [x, z] of [[-1.2, 2.4], [1.2, 2.4], [-1.2, -1.2], [1.2, -1.2], [-1.2, -2.5], [1.2, -2.5]]) {
      const o = Math.sign(x);
      bx(P, x - 0.2, 0.13, z - 0.45, x + 0.2, 0.77, z + 0.45, 'tire', NOSOLID);
      bx(P, x - 0.2, 0, z - 0.32, x + 0.2, 0.9, z + 0.32, 'tire', NOSOLID);
      bx(P, x + o * 0.2, 0.25, z - 0.2, x + o * 0.22, 0.65, z + 0.2, 'mil2', NOSOLID);
      bx(P, x + o * 0.22, 0.38, z - 0.07, x + o * 0.24, 0.52, z + 0.07, 'dark', NOSOLID);
    }
    // бампер, решётка, фары, зеркала, баки, ступени, выхлоп, запаска
    bx(P, -1.32, 0.35, 3.3, 1.32, 0.62, 3.5, 'dark', NOSOLID);
    bx(P, -0.7, 0.72, 3.3, 0.7, 1.42, 3.36, 'dark', NOSOLID);
    for (const y of [0.8, 0.95, 1.1, 1.25]) bx(P, -0.68, y, 3.355, 0.68, y + 0.06, 3.38, 'mil2', NOSOLID);
    bx(P, -0.2, 0.4, 3.5, 0.2, 0.52, 3.52, 'plate', NOSOLID);
    bx(P, 0.95, 2.4, 1.66, 1.07, 3.05, 1.78, 'dark', NOSOLID);
    bx(P, -0.45, 1.0, 1.25, 0.45, 1.75, 1.55, 'tire', NOSOLID);
    bx(P, -0.2, 1.22, 1.22, 0.2, 1.52, 1.25, 'mil2', NOSOLID);
    for (const s of [-1, 1]) {
      bx(P, s * 0.82, 0.95, 3.3, s * 1.12, 1.22, 3.39, 'lamp', NOSOLID);
      bx(P, s * 1.25, 1.65, 2.9, s * 1.48, 2.15, 2.98, 'dark', NOSOLID);
      bx(P, s * 1.25, 2.0, 2.94, s * 1.3, 2.05, 3.2, 'dark', NOSOLID);
      bx(P, s * 1.25, 0.55, -0.3, s * 1.42, 0.92, 0.9, 'mil2', NOSOLID);
      bx(P, s * 1.25, 0.88, 0.0, s * 1.43, 0.9, 0.3, 'dark', NOSOLID);
      bx(P, s * 1.25, 0.45, 2.0, s * 1.42, 0.52, 2.55, 'dark', NOSOLID);
      bx(P, s * 1.25, 0.5, 1.7, s * 1.265, 2.3, 1.75, 'dark', NOSOLID);
      bx(P, s * 1.25, 1.55, 2.0, s * 1.265, 2.25, 2.95, 'glass2', NOSOLID);
      bx(P, s * 1.25, 1.2, 2.2, s * 1.265, 1.27, 2.4, 'chrome', NOSOLID);
      bx(P, s * 0.95, 0.6, -3.36, s * 1.2, 0.75, -3.3, 'tail', NOSOLID);
    }
    C.push({ kind: 'mcrate', tier: 'military', x: 0, y: 1.0, z: -1.0, swap: true });
    return { P, C, pal: pal(rng, L, { glass2: 0x2f3d48 }) };
  },
  crash(rng, L) {
    const P = [], C = [];
    bx(P, -1.3, 0, -2.5, 1.3, 2.2, 2.6, 'heli');
    bx(P, -1.2, 0.9, 2.6, 1.2, 2.0, 3.4, 'glass', GLASS);
    bx(P, -1.2, 0.1, 2.6, 1.2, 0.9, 3.4, 'heli');
    bx(P, -0.3, 1.2, -8, 0.3, 1.8, -2.5, 'heli');
    bx(P, -0.08, 1.8, -8, 0.08, 3.2, -7, 'heli');
    bx(P, -6, 2.25, -0.15, 6, 2.33, 0.15, 'dark', NOSOLID);
    bx(P, 1.5, 0, 3, 2.1, 0.08, 7.5, 'dark', NOSOLID);
    bx(P, -1.6, 0, -1.8, -1.45, 0.25, 2.2, 'dark', NOSOLID);
    bx(P, -4, 0.01, -6, 4, 0.04, 6, 'scorch', NOSOLID);
    C.push({ kind: 'case', tier: 'crash', x: 2.6, y: 0.0, z: -0.6, swap: true });
    C.push({ kind: 'mcrate', tier: 'military', x: -2.8, y: 0.0, z: 1.2, swap: true });
    return { P, C, pal: pal(rng, L) };
  },
  radio(rng, L) {
    const P = [], C = [];
    const i0 = P.length;
    shell(P, { w: 5, d: 5, floors: 1, fh: 3.0, roof: 'flat', winW: 1.0 });
    for (let i = i0; i < P.length; i++) { P[i].a[0] -= 2.5; P[i].b[0] -= 2.5; }
    C.push({ kind: 'radio', tier: 'military', x: -2.5, y: 0.2, z: -1.75, swap: false });
    for (const [x, z] of [[1.6, -0.9], [3.4, -0.9], [1.6, 0.9], [3.4, 0.9]]) bx(P, x - 0.1, 0, z - 0.1, x + 0.1, 16, z + 0.1, 'metal');
    for (let y = 3; y <= 15; y += 4) {
      bx(P, 1.5, y, -1.0, 3.5, y + 0.12, -0.8, 'metal', NOSOLID);
      bx(P, 1.5, y, 0.8, 3.5, y + 0.12, 1.0, 'metal', NOSOLID);
      bx(P, 1.5, y, -1.0, 1.7, y + 0.12, 1.0, 'metal', NOSOLID);
      bx(P, 3.3, y, -1.0, 3.5, y + 0.12, 1.0, 'metal', NOSOLID);
    }
    bx(P, 1.5, 16, -1.0, 3.5, 16.2, 1.0, 'metal');
    bx(P, 2.45, 16.2, -0.05, 2.55, 21, 0.05, 'metal', NOSOLID);
    bx(P, 2.35, 21, -0.15, 2.65, 21.3, 0.15, 'red', NOSOLID);
    return { P, C, pal: pal(rng, L, { wall: 0x6b7a4f, trim: 0x55603e }) };
  },
  helipad(rng, L) {
    const P = [];
    bx(P, -8, -1, -8, 8, 0.15, 8, 'concrete');
    bx(P, -3, 0.15, -3.5, -2, 0.17, 3.5, 'white', NOSOLID);
    bx(P, 2, 0.15, -3.5, 3, 0.17, 3.5, 'white', NOSOLID);
    bx(P, -2, 0.15, -0.5, 2, 0.17, 0.5, 'white', NOSOLID);
    for (const [x, z] of [[-7.6, -7.6], [7.6, -7.6], [-7.6, 7.6], [7.6, 7.6]]) bx(P, x - 0.2, 0.15, z - 0.2, x + 0.2, 0.4, z + 0.2, 'yellow', NOSOLID);
    return { P, C: [], pal: pal(rng, L) };
  },
  tower(rng, L) {
    const P = [], C = [];
    for (const [x, z] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) bx(P, x - 0.15, 0, z - 0.15, x + 0.15, 7.4, z + 0.15, 'stairs');
    bx(P, -2, 4.6, -2, 2, 4.8, 2, 'floor');
    const n = 12, rise = 0.4, run = 0.4;
    for (let i = 0; i < n; i++) bx(P, -0.6, 0, 2 + (n - 1 - i) * run, 0.6, (i + 1) * rise, 2 + (n - i) * run, 'stairs');
    bx(P, -2, 4.8, -2, 2, 5.8, -1.92, 'stairs');
    bx(P, -2, 4.8, -1.92, -1.92, 5.8, 2, 'stairs');
    bx(P, 1.92, 4.8, -1.92, 2, 5.8, 2, 'stairs');
    bx(P, -2, 4.8, 1.92, -0.6, 5.8, 2, 'stairs');
    bx(P, 0.6, 4.8, 1.92, 2, 5.8, 2, 'stairs');
    bx(P, -2.3, 7.4, -2.3, 2.3, 7.6, 2.3, 'roof');
    C.push({ kind: 'mcrate', tier: 'military', x: -0.9, y: 4.8, z: -1.3, swap: false });
    return { P, C, pal: pal(rng, L, { stairs: 0x6a5038, floor: 0x7a5a3c, roof: L.biome === 'snow' ? 0xf0f4f7 : 0x4a5536 }) };
  },
  milfence(rng, L) {
    const P = [];
    const h = 62, gate = 5;
    const ops = [{ a: -gate, b: gate, lo: 0, hi: 3 }];
    const TH2 = TH;
    wallX(P, -h, h, h, 0, 2.6, 'fence', ops);
    wallX(P, -h, h, -h, 0, 2.6, 'fence', ops);
    wallZ(P, -h + TH2, h - TH2, -h, 0, 2.6, 'fence', ops);
    wallZ(P, -h + TH2, h - TH2, h, 0, 2.6, 'fence', ops);
    for (let t = -h; t <= h; t += 8) {
      if (Math.abs(t) < gate + 0.5) continue;
      for (const [x, z] of [[t, h], [t, -h], [h, t], [-h, t]]) bx(P, x - 0.15, 0, z - 0.15, x + 0.15, 3.0, z + 0.15, 'metal', NOSOLID);
    }
    return { P, C: [], pal: pal(rng, L) };
  },
  cratepile(rng, L) {
    const P = [], C = [];
    C.push({ kind: 'mcrate', tier: 'military', x: -0.8, y: 0, z: -0.4, swap: false });
    C.push({ kind: 'mcrate', tier: 'military', x: 0.8, y: 0, z: -0.4, swap: false });
    C.push({ kind: 'mcrate', tier: 'military', x: 0, y: 0.8, z: -0.4, swap: false });
    bx(P, -2, 0, 0.6, 2, 0.7, 1.4, 'sand');
    return { P, C, pal: pal(rng, L) };
  },
};

// biome — биом места постройки: от него зависят цвета стен и снег на крышах
export function buildPrefab(name, rng, biome) {
  const f = P_[name];
  if (!f) throw new Error('Неизвестный префаб ' + name);
  const r = f(rng, { biome });
  return { parts: r.P, conts: r.C, pal: r.pal };
}
