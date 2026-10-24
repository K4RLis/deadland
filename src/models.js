// Low-poly модели: персонажи, зомби, предметы в руках, вертолёт, мешок с лутом. Иконки рендерятся из тех же моделей.
import * as THREE from 'three';
import { MeshBuilder, lin } from './mesh.js';

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
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const ICO = new THREE.IcosahedronGeometry(1, 0);
const CONE = new THREE.ConeGeometry(1, 1, 6);

export function part(parent, w, h, d, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, geo = BOX, em = 0) {
  const m = new THREE.Mesh(geo, M(hex, em));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
const cyl = (p, r, h, hex, x, y, z, rx = 0, ry = 0, rz = 0) => part(p, r, h, r, hex, x, y, z, rx, ry, rz, CYL);

// ---------- персонажи ----------
// Каждая часть тела — один меш с цветами вершин (боксы сливаются), чтобы зомби стоили мало draw calls.
const VC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const VC_GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
const limbCache = new Map();

function limb(parent, boxes, glow = false) {
  const key = (glow ? 'g' : '') + JSON.stringify(boxes);
  let geo = limbCache.get(key);
  if (!geo) {
    const mb = new MeshBuilder();
    for (const [w, h, d, hex, x, y, z] of boxes) mb.box(x - w / 2, y - h / 2, z - d / 2, x + w / 2, y + h / 2, z + d / 2, lin(hex));
    geo = mb.build();
    geo.userData.shared = true;
    limbCache.set(key, geo);
  }
  const m = new THREE.Mesh(geo, glow ? VC_GLOW : VC_MAT);
  m.castShadow = !glow;
  parent.add(m);
  return m;
}

export function makeHumanoid(o) {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const s = o.scale || 1;
  body.scale.setScalar(s);
  const wide = o.wide || 1;
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.13 * wide, 0.82, 0); legR.position.set(0.13 * wide, 0.82, 0);
  for (const l of [legL, legR]) {
    limb(l, [[0.22 * wide, 0.82, 0.25, o.pants, 0, -0.41, 0], [0.23 * wide, 0.12, 0.32, o.shoes || 0x2a2420, 0, -0.76, -0.03],
      [0.235 * wide, 0.035, 0.33, 0x1a1612, 0, -0.81, -0.03], [0.16 * wide, 0.12, 0.02, o.pants, 0, -0.42, -0.13],
      [0.225 * wide, 0.05, 0.255, o.shoes || 0x2a2420, 0, -0.66, 0]]);
    body.add(l);
  }
  const torso = [[0.54 * wide, 0.68, 0.3 * wide, o.shirt, 0, 1.16, 0],
    [0.3, 0.06, 0.32 * wide, o.sleeve ?? o.shirt, 0, 1.47, 0],
    [0.13, 0.12, 0.02, o.sleeve ?? o.shirt, -0.13 * wide, 1.28, -0.155 * wide],
    [0.13, 0.12, 0.02, o.sleeve ?? o.shirt, 0.13 * wide, 1.28, -0.155 * wide],
    [0.04, 0.5, 0.02, 0x2a2a2a, 0, 1.18, -0.152 * wide]];
  if (o.belt !== false) torso.push([0.55 * wide, 0.08, 0.31 * wide, 0x3a2a1e, 0, 0.84, 0], [0.07, 0.06, 0.02, 0xc8a040, 0, 0.84, -0.16 * wide]);
  limb(body, torso);
  const head = new THREE.Group();
  head.position.set(0, 1.5, 0);
  body.add(head);
  const hb = [[0.34, 0.34, 0.34, o.skin, 0, 0.17, 0], [0.06, 0.07, 0.05, o.skin, 0, 0.14, -0.19],
    [0.04, 0.08, 0.06, o.skin, -0.18, 0.17, 0.0], [0.04, 0.08, 0.06, o.skin, 0.18, 0.17, 0.0],
    [0.3, 0.05, 0.04, o.skin, 0, 0.02, -0.15]];
  if (o.hair != null) hb.push([0.36, 0.1, 0.36, o.hair, 0, 0.36, 0], [0.36, 0.22, 0.08, o.hair, 0, 0.24, 0.15]);
  if (o.helmet != null) hb.push([0.4, 0.14, 0.4, o.helmet, 0, 0.37, 0], [0.42, 0.04, 0.42, o.helmet, 0, 0.3, 0]);
  if (o.zombie) hb.push([0.14, 0.04, 0.02, 0x3a1010, 0, 0.08, -0.172]);
  const eye = o.eyes || 0x1a1a1a;
  const eyes = [[0.07, 0.05, 0.02, eye, -0.08, 0.2, -0.172], [0.07, 0.05, 0.02, eye, 0.08, 0.2, -0.172]];
  if (o.eyesGlow) limb(head, eyes, true); else hb.push(...eyes);
  limb(head, hb);
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.36 * wide, 1.44, 0); armR.position.set(0.36 * wide, 1.44, 0);
  for (const a of [armL, armR]) {
    limb(a, [[0.17, 0.6, 0.18, o.sleeve ?? o.shirt, 0, -0.27, 0], [0.15, 0.14, 0.16, o.skin, 0, -0.62, 0],
      [0.18, 0.05, 0.19, 0x2a2a2a, 0, -0.53, 0], [0.05, 0.07, 0.06, o.skin, 0, -0.6, -0.09], [0.18, 0.1, 0.19, o.sleeve ?? o.shirt, 0, 0.0, 0]]);
    body.add(a);
  }
  const hand = new THREE.Group();
  hand.position.set(0, -0.62, -0.02);
  armR.add(hand);
  g.userData = { body, head, legL, legR, armL, armR, hand, phase: Math.random() * 6, zombie: !!o.zombie };
  return g;
}

// поза: speed — скорость движения, aim — оружие в руках, atk — фаза атаки 0..1
export function animate(g, dt, speed, opts = {}) {
  const u = g.userData;
  u.phase += dt * (2 + speed * 2.2);
  const sw = Math.min(1, speed / 3) * 0.7;
  const s = Math.sin(u.phase);
  u.legL.rotation.x = s * sw;
  u.legR.rotation.x = -s * sw;
  if (u.zombie) {
    const atk = opts.atk || 0;
    const base = 1.35 + Math.sin(u.phase * 0.5) * 0.08;
    u.armL.rotation.x = base - atk * 1.6;
    u.armR.rotation.x = base - atk * 1.6 + Math.sin(u.phase * 0.7) * 0.1;
    u.armL.rotation.z = 0.08; u.armR.rotation.z = -0.08;
    u.body.rotation.x = -0.12;
    u.head.rotation.z = Math.sin(u.phase * 0.4) * 0.15;
  } else if (opts.aim) {
    u.armR.rotation.x = 1.45 + (opts.pitch || 0);
    u.armL.rotation.x = 1.35 + (opts.pitch || 0);
    u.armL.rotation.y = -0.5;
    u.head.rotation.x = (opts.pitch || 0) * 0.6;
  } else {
    u.armL.rotation.x = -s * sw * 0.8;
    u.armR.rotation.x = s * sw * 0.8 + (opts.swing || 0) * 1.8;
    u.armL.rotation.y = 0;
    u.head.rotation.x = (opts.pitch || 0) * 0.6;
  }
  if (opts.crouch) { u.body.position.y = -0.35; u.legL.rotation.x += 0.9; u.legR.rotation.x += 0.9; }
  else u.body.position.y = 0;
}

export const PLAYER_COLORS = [0x3b6fb6, 0xc0392b, 0x2f8f4e, 0xd68910, 0x8e44ad, 0x17a2b8, 0xe0e0e0, 0x333333, 0xc76f9a, 0x7a5a3a];
const SKINS = [0xf1c8a0, 0xe0ac80, 0xc68a5e, 0x8d5a3b];

export function makePlayerModel(color, skinIdx = 0) {
  return makeHumanoid({ skin: SKINS[skinIdx % SKINS.length], shirt: color, pants: 0x34405a, hair: 0x3a2a1a });
}

export const ZOMBIE_LOOK = {
  walker: () => makeHumanoid({ zombie: true, skin: 0x7d9a6b, shirt: [0x5a4a3a, 0x6a6a5a, 0x4a5a6a, 0x7a3a3a][Math.floor(Math.random() * 4)], pants: 0x3a3a44, hair: 0x2a2a20, eyes: 0xff3020, eyesGlow: 0x991000 }),
  runner: () => makeHumanoid({ zombie: true, skin: 0xa0b090, shirt: 0x6a2a2a, pants: 0x2a2a30, hair: null, eyes: 0xffd020, eyesGlow: 0x998000, scale: 0.95 }),
  tank: () => makeHumanoid({ zombie: true, skin: 0x6a8a5a, shirt: 0x4a4038, pants: 0x30302a, hair: null, eyes: 0xff3020, eyesGlow: 0x991000, scale: 1.35, wide: 1.4 }),
  soldier: () => makeHumanoid({ zombie: true, skin: 0x7a9070, shirt: 0x55603e, sleeve: 0x4a5536, pants: 0x4a5536, helmet: 0x3e4a2e, eyes: 0xff3020, eyesGlow: 0x991000 }),
  // боссы
  butcher: () => bossExtras(makeHumanoid({ zombie: true, skin: 0x8a6a5a, shirt: 0xd8d0c0, sleeve: 0x8a6a5a, pants: 0x3a3028, hair: null, eyes: 0xffe020, eyesGlow: 0xffa000, scale: 2.1, wide: 1.5 }), 'butcher'),
  screamer: () => bossExtras(makeHumanoid({ zombie: true, skin: 0xc8c8b0, shirt: 0x4a2a5a, pants: 0x2a1a30, hair: 0xe0e0e0, eyes: 0x60ff60, eyesGlow: 0x30c030, scale: 1.6 }), 'screamer'),
  leaper: () => bossExtras(makeHumanoid({ zombie: true, skin: 0x6a8a4a, shirt: 0x3a4a2a, pants: 0x2a3a20, hair: null, eyes: 0xff3020, eyesGlow: 0xff1000, scale: 1.75 }), 'leaper'),
};

// детали боссов: фартук мясника с тесаком, «волосы» крикуньи, шипы прыгуна
function bossExtras(g, kind) {
  const u = g.userData;
  if (kind === 'butcher') {
    limb(u.body, [[0.6, 0.55, 0.05, 0x9a2a2a, 0, 1.05, -0.24], [0.62, 0.05, 0.31, 0x3a2a1e, 0, 1.36, 0]]);
    limb(u.hand, [[0.05, 0.42, 0.04, 0x3a2a1e, 0, -0.12, 0], [0.04, 0.14, 0.36, 0xb8bcc0, 0, -0.38, -0.12]]);
  } else if (kind === 'screamer') {
    limb(u.head, [[0.4, 0.5, 0.12, 0xe0e0e0, 0, 0.1, 0.17], [0.16, 0.08, 0.03, 0x200808, 0, 0.06, -0.18]]);
  } else {
    limb(u.body, [[0.1, 0.2, 0.1, 0xd8d0b8, 0, 1.55, 0.18], [0.1, 0.2, 0.1, 0xd8d0b8, 0, 1.3, 0.2], [0.1, 0.2, 0.1, 0xd8d0b8, 0, 1.05, 0.2]]);
  }
  return g;
}

// ---------- предметы ----------
const W = 0x1e1e1e, W2 = 0x2c2c2c, WOOD = 0x8a5a32, STEEL = 0xa8acb0;
const BUILD = {
  pistol(g) { part(g, 0.035, 0.045, 0.21, W2, 0, 0.03, -0.06); part(g, 0.03, 0.12, 0.05, W, 0, -0.04, 0.02, 0.25); part(g, 0.014, 0.014, 0.04, W, 0, 0.035, -0.18); },
  smg(g) { part(g, 0.05, 0.08, 0.34, W2, 0, 0, -0.08); part(g, 0.035, 0.17, 0.045, W, 0, -0.11, -0.12); part(g, 0.035, 0.11, 0.05, W, 0, -0.08, 0.04, 0.3); part(g, 0.02, 0.02, 0.12, W, 0, 0.01, -0.3); part(g, 0.03, 0.05, 0.16, W, 0, 0.0, 0.16); },
  shotgun(g) { part(g, 0.045, 0.045, 0.78, W2, 0, 0.02, -0.3); part(g, 0.055, 0.055, 0.2, WOOD, 0, -0.03, -0.36); part(g, 0.06, 0.08, 0.2, W, 0, -0.01, 0.06); part(g, 0.06, 0.13, 0.32, WOOD, 0, -0.06, 0.28, -0.15); },
  rifle(g) { part(g, 0.055, 0.09, 0.42, W2, 0, 0, -0.05); part(g, 0.06, 0.07, 0.22, WOOD, 0, -0.005, -0.33); part(g, 0.022, 0.022, 0.26, W, 0, 0.015, -0.55); part(g, 0.042, 0.19, 0.075, W, 0, -0.13, -0.08, -0.3); part(g, 0.04, 0.11, 0.05, WOOD, 0, -0.09, 0.08, 0.3); part(g, 0.055, 0.11, 0.28, WOOD, 0, -0.04, 0.3, -0.1); },
  asval(g) {
    part(g, 0.05, 0.085, 0.36, 0x2a2c2a, 0, 0, -0.04);
    cyl(g, 0.034, 0.36, 0x1c1d1c, 0, 0.012, -0.38, Math.PI / 2);
    cyl(g, 0.037, 0.04, 0x2e302e, 0, 0.012, -0.22, Math.PI / 2);
    part(g, 0.04, 0.15, 0.06, 0x3a2e24, 0, -0.1, -0.09, -0.22);
    part(g, 0.04, 0.11, 0.05, 0x1c1d1c, 0, -0.08, 0.08, 0.3);
    part(g, 0.02, 0.02, 0.26, 0x1c1d1c, 0, 0.03, 0.24);
    part(g, 0.02, 0.02, 0.26, 0x1c1d1c, 0, -0.04, 0.24);
    part(g, 0.025, 0.1, 0.03, 0x1c1d1c, 0, -0.005, 0.37);
    part(g, 0.012, 0.03, 0.02, 0x1c1d1c, 0, 0.055, -0.14);
  },
  a939(g) { part(g, 0.12, 0.08, 0.09, 0x3a3a2a); part(g, 0.1, 0.02, 0.07, 0xd4a640, 0, 0.05, 0); },
  sniper(g) { part(g, 0.055, 0.08, 0.5, 0x3d4a33, 0, 0, -0.05); part(g, 0.025, 0.025, 0.45, W, 0, 0.015, -0.5); cyl(g, 0.03, 0.3, W, 0, 0.09, -0.08, Math.PI / 2); part(g, 0.06, 0.13, 0.32, 0x3d4a33, 0, -0.05, 0.32, -0.1); part(g, 0.04, 0.1, 0.05, W, 0, -0.08, 0.1, 0.3); },
  knife(g) { part(g, 0.012, 0.035, 0.18, STEEL, 0, 0, -0.14); part(g, 0.025, 0.035, 0.11, W, 0, 0, 0.0); },
  bat(g) { part(g, 0.05, 0.05, 0.32, 0x9a6a3a, 0, 0, 0.05); part(g, 0.075, 0.075, 0.5, 0xb07a44, 0, 0, -0.36); },
  axe(g) { part(g, 0.035, 0.035, 0.62, WOOD, 0, 0, -0.18); part(g, 0.025, 0.16, 0.12, STEEL, 0, 0.06, -0.46); },
  pickaxe(g) { part(g, 0.035, 0.035, 0.62, WOOD, 0, 0, -0.18); part(g, 0.03, 0.04, 0.42, STEEL, 0, 0.0, -0.48, Math.PI / 2); },
  machete(g) { part(g, 0.012, 0.06, 0.45, STEEL, 0, 0.01, -0.26); part(g, 0.028, 0.04, 0.12, W, 0, 0, 0.02); },
  hammer(g) { part(g, 0.03, 0.03, 0.4, WOOD, 0, 0, -0.08); part(g, 0.05, 0.05, 0.16, 0x666a6e, 0, 0.0, -0.3, Math.PI / 2); },
  a9(g) { part(g, 0.12, 0.07, 0.09, 0x6a5a3a); part(g, 0.1, 0.02, 0.07, 0xd4a640, 0, 0.045, 0); },
  a12(g) { part(g, 0.12, 0.08, 0.1, 0xa03030); part(g, 0.1, 0.02, 0.08, 0xd4a640, 0, 0.05, 0); },
  a762(g) { part(g, 0.13, 0.08, 0.1, 0x4a5536); part(g, 0.11, 0.02, 0.08, 0xd4a640, 0, 0.05, 0); },
  a308(g) { part(g, 0.13, 0.08, 0.1, 0x2a3a4a); part(g, 0.11, 0.02, 0.08, 0xd4a640, 0, 0.05, 0); },
  bandage(g) { cyl(g, 0.05, 0.08, 0xf2f0e8, 0, 0, 0, 0, 0, Math.PI / 2); },
  medkit(g) { part(g, 0.2, 0.14, 0.1, 0xf0f0f0); part(g, 0.08, 0.025, 0.104, 0xd03030, 0, 0, 0); part(g, 0.025, 0.08, 0.104, 0xd03030, 0, 0, 0); },
  can(g) { cyl(g, 0.045, 0.1, 0xb8bcc0); cyl(g, 0.046, 0.06, 0xc0392b); },
  chips(g) { part(g, 0.12, 0.17, 0.04, 0xe8b830); part(g, 0.06, 0.06, 0.045, 0xc03020, 0, 0.01, 0); },
  mre(g) { part(g, 0.16, 0.1, 0.06, 0x6b7a4f); part(g, 0.1, 0.03, 0.062, 0x3a3a2a, 0, 0.02, 0); },
  water(g) { cyl(g, 0.04, 0.18, 0x6ab0e0); cyl(g, 0.02, 0.03, 0x2a6ab0, 0, 0.1, 0); },
  soda(g) { cyl(g, 0.035, 0.12, 0xc0392b); cyl(g, 0.036, 0.03, 0xf0f0f0, 0, 0.02, 0); },
  wood(g) { cyl(g, 0.05, 0.3, 0x8a5a32, 0, 0, -0.03, 0, 0, Math.PI / 2); cyl(g, 0.05, 0.3, 0x7a4e2a, 0, 0, 0.07, 0, 0, Math.PI / 2); cyl(g, 0.05, 0.3, 0x946238, 0, 0.08, 0.02, 0, 0, Math.PI / 2); },
  stone(g) { part(g, 0.13, 0.1, 0.12, 0x8b8b88, 0, 0, 0, 0.3, 0.4, 0, ICO); },
  scrap(g) { part(g, 0.16, 0.03, 0.1, 0x7a7f84, 0, 0, 0, 0, 0.3); part(g, 0.04, 0.12, 0.04, 0x8a5a3a, 0.03, 0.05, 0, 0, 0, 0.4); cyl(g, 0.05, 0.03, 0x6a6e72, -0.04, 0.03, 0.02); },
  cloth(g) { part(g, 0.16, 0.05, 0.12, 0xd8d0b8); part(g, 0.15, 0.04, 0.11, 0xb8a888, 0, 0.045, 0); },
  b_wood(g) { part(g, 0.16, 0.16, 0.16, 0x9a6a3e); part(g, 0.162, 0.02, 0.162, 0x7a5030, 0, 0.03, 0); },
  b_wfloor(g) { part(g, 0.18, 0.04, 0.18, 0xa87a4a); },
  b_wramp(g) { part(g, 0.16, 0.02, 0.2, 0x9a6a3e, 0, 0.0, 0, 0.7); part(g, 0.16, 0.02, 0.16, 0x7a5030, 0, -0.07, 0); },
  b_door(g) { part(g, 0.12, 0.2, 0.025, 0x7a4f2a); part(g, 0.02, 0.02, 0.03, 0xd4a640, 0.04, 0, 0); },
  b_stone(g) { part(g, 0.16, 0.16, 0.16, 0x8f8f8f); },
  b_metal(g) { part(g, 0.16, 0.16, 0.16, 0x6f7a84); part(g, 0.165, 0.03, 0.165, 0x8a96a0, 0, 0.04, 0); },
  b_spikes(g) { part(g, 0.18, 0.03, 0.18, 0x8a6a40); for (const [x, z] of [[-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05], [0.05, 0.05]]) part(g, 0.025, 0.12, 0.025, 0xc0c4c8, x, 0.07, z, 0, 0, 0, CONE); },
  b_box(g) { part(g, 0.18, 0.12, 0.12, 0xa0783f); part(g, 0.185, 0.02, 0.125, 0x6a4a2a, 0, 0.03, 0); },
  b_bed(g) { cyl(g, 0.05, 0.18, 0x3f6a9a, 0, 0, 0, 0, 0, Math.PI / 2); },
  b_fire(g) { part(g, 0.04, 0.04, 0.2, 0x6a4a2a, 0, 0, 0, 0, 0.5); part(g, 0.04, 0.04, 0.2, 0x6a4a2a, 0, 0, 0, 0, -0.5); part(g, 0.06, 0.1, 0.06, 0xff8a20, 0, 0.06, 0, 0, 0, 0, CONE, 0xff6a00); },
  iaxe(g) { part(g, 0.035, 0.035, 0.66, 0x5a3a22, 0, 0, -0.2); part(g, 0.025, 0.2, 0.14, 0x9aa2aa, 0, 0.07, -0.5); part(g, 0.026, 0.06, 0.04, 0xd8dde2, 0, 0.17, -0.5); },
  ipick(g) { part(g, 0.035, 0.035, 0.66, 0x5a3a22, 0, 0, -0.2); part(g, 0.035, 0.05, 0.5, 0x9aa2aa, 0, 0.0, -0.52, Math.PI / 2); },
  berries(g) { for (const [x, y, c] of [[-0.03, 0, 0xc02030], [0.03, 0.01, 0x3040a0], [0, 0.05, 0xc02030], [0.04, -0.03, 0xc02030], [-0.04, -0.03, 0x3040a0]]) part(g, 0.04, 0.04, 0.04, c, x, y, 0, 0, 0, 0, ICO); part(g, 0.06, 0.01, 0.03, 0x4a8a30, 0, 0.08, 0); },
  potato(g) { part(g, 0.09, 0.06, 0.07, 0xb08850, 0, 0, 0, 0.2, 0.4, 0, ICO); },
  bpotato(g) { part(g, 0.09, 0.06, 0.07, 0x7a5028, 0, 0, 0, 0.2, 0.4, 0, ICO); part(g, 0.05, 0.02, 0.04, 0xf0d070, 0, 0.04, 0); },
  stew(g) { cyl(g, 0.08, 0.06, 0x5a5e62); cyl(g, 0.07, 0.01, 0xa06030, 0, 0.03, 0); },
  tea(g) { cyl(g, 0.045, 0.09, 0xe8e4da); cyl(g, 0.04, 0.01, 0x8a5a2a, 0, 0.045, 0); },
  ore(g) { part(g, 0.13, 0.1, 0.12, 0x5e5a58, 0, 0, 0, 0.3, 0.4, 0, ICO); part(g, 0.05, 0.05, 0.05, 0xb5642a, 0.05, 0.03, 0.03, 0, 0, 0, ICO); part(g, 0.04, 0.04, 0.04, 0x9a4a22, -0.05, 0.02, -0.02, 0, 0, 0, ICO); },
  iron(g) { part(g, 0.16, 0.05, 0.07, 0x9aa2aa); part(g, 0.16, 0.05, 0.07, 0x8a9298, 0.02, 0.05, 0.0); },
  fiber(g) { for (let i = 0; i < 5; i++) part(g, 0.012, 0.18, 0.012, 0x9ab060, (i - 2) * 0.02, 0, 0, 0, 0, (i - 2) * 0.15); part(g, 0.08, 0.02, 0.02, 0x7a6a3a, 0, -0.02, 0); },
  trophy(g) { part(g, 0.1, 0.12, 0.08, 0x8a1a1a, 0, 0, 0, 0.3, 0.3, 0, ICO, 0x400000); part(g, 0.03, 0.08, 0.03, 0xe8e0c8, 0.05, 0.06, 0, 0, 0, -0.4, CONE); },
  b_wwall(g) { part(g, 0.18, 0.18, 0.03, 0x9f7044); part(g, 0.02, 0.18, 0.035, 0x7a5030, 0, 0, 0); },
  b_wwin(g) { part(g, 0.18, 0.18, 0.03, 0x9f7044); part(g, 0.1, 0.07, 0.035, 0x9ccbe0, 0, 0.01, 0); },
  b_mdoor(g) { part(g, 0.12, 0.2, 0.025, 0x6a737c); part(g, 0.02, 0.02, 0.03, 0xd4a640, 0.04, 0, 0); },
  b_torch(g) { part(g, 0.02, 0.18, 0.02, 0x6a4a2a); part(g, 0.035, 0.05, 0.035, 0xff9a2a, 0, 0.1, 0, 0, 0, 0, CONE, 0xff6a00); },
  b_bench(g) { part(g, 0.2, 0.025, 0.11, 0x8a6038, 0, 0.04, 0); part(g, 0.02, 0.08, 0.02, 0x6a4628, -0.08, 0, 0.04); part(g, 0.02, 0.08, 0.02, 0x6a4628, 0.08, 0, -0.04); part(g, 0.05, 0.02, 0.04, 0x8a8e92, -0.04, 0.06, 0); },
  b_forge(g) { part(g, 0.16, 0.14, 0.14, 0x7a7672); part(g, 0.06, 0.08, 0.06, 0x6a6662, 0, 0.1, 0); part(g, 0.08, 0.05, 0.01, 0xff7a20, 0, -0.02, -0.072, 0, 0, 0, BOX, 0xff4000); },
  b_farm(g) { part(g, 0.2, 0.05, 0.2, 0x7a5232); part(g, 0.04, 0.08, 0.04, 0x5a9a3a, 0, 0.06, 0, 0, 0, 0, CONE); },
  b_collector(g) { cyl(g, 0.06, 0.14, 0x6a5a48); part(g, 0.1, 0.05, 0.1, 0x4a6a8a, 0, 0.09, 0, Math.PI, 0, 0, CONE); },
};

export function itemModel(id) {
  const g = new THREE.Group();
  (BUILD[id] || BUILD.scrap)(g);
  return g;
}

export const GUN_IDS = new Set(['pistol', 'smg', 'shotgun', 'rifle', 'asval', 'sniper', 'knife', 'bat', 'axe', 'pickaxe', 'iaxe', 'ipick', 'machete', 'hammer']);

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
export function makeBag() {
  const g = new THREE.Group();
  part(g, 0.6, 0.45, 0.4, 0x6a5232, 0, 0.22, 0);
  part(g, 0.62, 0.08, 0.42, 0x4a3a22, 0, 0.42, 0);
  part(g, 0.08, 0.5, 0.42, 0x3a2e1c, 0, 0.23, 0);
  return g;
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
