// Зомби: симуляция на хосте (ИИ, поиск пути, атаки блоков) и отрисовка у всех.
import * as THREE from 'three';
import * as C from './config.js';
import { ZOMBIE_LOOK, animate, animateDeath, makeNameTag, setLod } from './models.js';
import { angleLerp, clamp } from './rng.js';
import { topAt, rayBox } from './physics.js';

export const ZTYPES = {
  walker: { name: 'Ходок', hp: 100, walk: 0.9, run: 2.8, nightRun: 4.4, dmg: 12, rate: 1.3, blockDmg: 25, xp: 25, scale: 1, radius: 0.35, height: 1.8, pitch: 1, wide: 1 },
  runner: { name: 'Бегун', hp: 75, walk: 1.3, run: 5.0, nightRun: 6.1, dmg: 9, rate: 1.0, blockDmg: 15, xp: 35, scale: 0.95, radius: 0.33, height: 1.75, pitch: 1.3, wide: 1 },
  tank: { name: 'Громила', hp: 480, walk: 0.8, run: 2.2, nightRun: 3.1, dmg: 30, rate: 1.8, blockDmg: 95, xp: 120, scale: 1.35, radius: 0.55, height: 2.4, pitch: 0.65, wide: 1.4 },
  soldier: { name: 'Солдат', hp: 230, walk: 1.0, run: 3.1, nightRun: 4.7, dmg: 18, rate: 1.2, blockDmg: 35, xp: 60, scale: 1.05, radius: 0.36, height: 1.85, pitch: 0.9, wide: 1, armor: 0.25 },
  // боссы
  butcher: { name: 'Мясник', boss: true, hp: 2800, walk: 1.0, run: 3.3, nightRun: 4.0, dmg: 40, rate: 1.7, blockDmg: 450, xp: 900, scale: 2.1, radius: 0.85, height: 3.6, pitch: 0.45, wide: 1.5, armor: 0.2, reach: 2.6 },
  screamer: { name: 'Крикунья', boss: true, hp: 1500, walk: 1.2, run: 4.2, nightRun: 5.0, dmg: 24, rate: 1.1, blockDmg: 120, xp: 700, scale: 1.6, radius: 0.55, height: 2.8, pitch: 1.6, wide: 1, reach: 1.9 },
  leaper: { name: 'Прыгун', boss: true, hp: 1900, walk: 1.4, run: 6.2, nightRun: 7.0, dmg: 30, rate: 1.2, blockDmg: 160, xp: 800, scale: 1.75, radius: 0.6, height: 3.0, pitch: 0.8, wide: 1, armor: 0.1, reach: 2.0 },
};
export const ZT = ['walker', 'runner', 'tank', 'soldier', 'butcher', 'screamer', 'leaper'];
export const BOSS_RESPAWN = 900; // секунд до возрождения босса в логове
const ST = { idle: 0, wander: 1, investigate: 1, chase: 2, attack: 3 };

class Heap {
  constructor() { this.a = []; this.f = []; }
  push(i, f) {
    const a = this.a, F = this.f;
    a.push(i); F.push(f);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (F[p] <= F[k]) break;
      [a[p], a[k]] = [a[k], a[p]]; [F[p], F[k]] = [F[k], F[p]];
      k = p;
    }
  }
  pop() {
    const a = this.a, F = this.f;
    const top = a[0];
    const li = a.pop(), lf = F.pop();
    if (a.length) {
      a[0] = li; F[0] = lf;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < a.length && F[l] < F[m]) m = l;
        if (r < a.length && F[r] < F[m]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]]; [F[m], F[k]] = [F[k], F[m]];
        k = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

export class ZombieSim {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.byId = new Map();
    this.nextId = 1;
    this.spawnT = 3;
    this.pathBudget = 0;
    this.spikeAcc = new Map();
  }

  spawn(type, x, z, opts = {}) {
    const T = ZTYPES[type], L = this.g.zParams(x, z);
    const y = this.g.world.height(x, z);
    const zb = {
      id: this.nextId++, type, ti: ZT.indexOf(type),
      pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(),
      radius: T.radius, height: T.height, step: 0.55, grounded: true,
      yaw: Math.random() * 6.28, hp: T.hp * L.hp, maxHp: T.hp * L.hp,
      state: 'idle', target: null, goal: null, memory: 0,
      thinkT: Math.random() * 0.3, atkT: 0.3, atkWind: 0, path: null, pathI: 0, repathT: 0,
      stuck: false, progT: 1, lastX: x, lastZ: z, wanderT: Math.random() * 4,
      horde: !!opts.horde, blockKey: null, sideT: 0, sideDir: 1, noPath: false, swing: 0,
      boss: !!T.boss, lair: opts.lair || null, specialT: 4 + Math.random() * 3, windT: 0, leapT: 0,
      mul: { dmg: L.dmg, speed: L.speed },
    };
    this.list.push(zb);
    this.byId.set(zb.id, zb);
    return zb;
  }

  remove(zb) {
    const i = this.list.indexOf(zb);
    if (i >= 0) this.list.splice(i, 1);
    this.byId.delete(zb.id);
  }

  pickType(p) {
    const L = this.g.zParams(p.x, p.z);
    const night = this.g.isNight();
    const mil = this.g.world.military;
    const inMil = mil && Math.hypot(p.x - mil.x, p.z - mil.z) < mil.r + 60;
    const r = Math.random();
    if (r < L.tank * (night ? 1.4 : 1)) return 'tank';
    if (r < L.tank + L.soldier * (inMil ? 8 : 1)) return 'soldier';
    if (r < L.tank + L.soldier * (inMil ? 8 : 1) + L.runner * (night ? 1.6 : 1)) return 'runner';
    return 'walker';
  }

  trySpawnNear(p, horde) {
    const g = this.g, w = g.world;
    const night = g.isNight();
    for (let k = 0; k < 6; k++) {
      const a = p.yaw + (Math.random() - 0.5) * (horde ? 6.28 : 2.6);
      const d = horde ? 28 + Math.random() * 25 : (night ? 34 : 44) + Math.random() * 40;
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (Math.abs(x) > C.HALF - 20 || Math.abs(z) > C.HALF - 20) continue;
      w.ensureAround(x, z, 1);
      const h = w.height(x, z);
      if (h < 0.6) continue;
      if (!g.physics.free(x, h, z, 0.6, 1.9)) continue;
      const zb = this.spawn(this.pickType(p), x, z, { horde });
      if (horde) { zb.state = 'chase'; zb.target = p.pid; zb.memory = 999; }
      return zb;
    }
    return null;
  }

  manageSpawns(players) {
    const g = this.g;
    const night = g.isNight();
    for (const p of players) {
      const L = g.zParams(p.x, p.z);
      let near = 0;
      for (const z of this.list) if ((z.pos.x - p.x) ** 2 + (z.pos.z - p.z) ** 2 < 110 * 110) near++;
      let target = L.count * (night ? 1.6 : 1);
      if (g.world.townAt(p.x, p.z)) target *= 1.4;
      // каждый прожитый день мир становится опаснее (до +70%)
      target *= 1 + Math.min(0.7, (g.day - 1) * 0.05);
      if (g.hordeActive) target += 10 + g.level.difficulty * 4 + Math.min(12, Math.floor(g.day / 7) * 3);
      target = Math.round(target);
      if (near < target && this.list.length < 110 && !g.peace) {
        const n = Math.min(target - near, g.hordeActive ? 3 : 2);
        for (let i = 0; i < n; i++) this.trySpawnNear(p, g.hordeActive);
      }
    }
    this.manageBosses(players);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i];
      let md = Infinity;
      for (const p of players) md = Math.min(md, Math.hypot(z.pos.x - p.x, z.pos.z - p.z));
      if (md > (z.boss ? 300 : z.horde ? 260 : 175)) this.remove(z);
    }
  }

  // боссы: появляются в логовах, когда рядом игрок; в кровавую луну приходят с ордой
  manageBosses(players) {
    const g = this.g, now = g.time;
    if (!this.lairState) this.lairState = g.world.lairs.map(() => ({ id: 0, respawn: 0 }));
    g.world.lairs.forEach((l, k) => {
      const st = this.lairState[k];
      if (st.id && this.byId.has(st.id)) return;
      st.id = 0;
      if (now < st.respawn) return;
      if (!players.some(p => Math.hypot(p.x - l.x, p.z - l.z) < 140)) return;
      g.world.ensureAround(l.x, l.z, 1);
      const zb = this.spawn(l.type, l.x, l.z, { lair: { x: l.x, z: l.z, k } });
      st.id = zb.id;
    });
    if (g.hordeActive && !this.hordeBossDone) {
      this.hordeBossDone = true;
      const n = Math.max(1, g.level.difficulty - 1);
      const types = ['butcher', 'screamer', 'leaper'];
      for (let i = 0; i < n && players.length; i++) {
        const p = players[Math.floor(Math.random() * players.length)];
        for (let t = 0; t < 8; t++) {
          const a = Math.random() * 6.28, d = 45 + Math.random() * 20;
          const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
          g.world.ensureAround(x, z, 1);
          if (g.world.height(x, z) < 0.6) continue;
          const zb = this.spawn(types[Math.floor(Math.random() * 3)], x, z, { horde: true });
          zb.state = 'chase'; zb.target = p.pid; zb.memory = 999;
          g.onBossAppear(zb);
          break;
        }
      }
    }
    if (!g.hordeActive) this.hordeBossDone = false;
  }

  onBossDied(zb) {
    if (zb.lair && this.lairState) this.lairState[zb.lair.k].respawn = this.g.time + BOSS_RESPAWN;
  }

  // зомби услышали шум (выстрел)
  noise(x, y, z, radius, pid) {
    for (const zb of this.list) {
      const d = Math.hypot(zb.pos.x - x, zb.pos.z - z);
      if (d < radius && zb.state !== 'chase') {
        zb.state = 'investigate';
        zb.goal = { x: x + (Math.random() - 0.5) * 6, y, z: z + (Math.random() - 0.5) * 6 };
        zb.memory = 20;
        if (d < radius * 0.4) { zb.state = 'chase'; zb.target = pid; zb.memory = 6; }
      }
    }
  }

  damage(id, dmg, pid) {
    const zb = this.byId.get(id);
    if (!zb) return null;
    const T = ZTYPES[zb.type];
    zb.hp -= dmg * (1 - (T.armor || 0));
    zb.state = 'chase'; zb.target = pid; zb.memory = zb.boss ? 30 : 10;
    if (zb.hp <= 0) { this.remove(zb); if (zb.boss) this.onBossDied(zb); return zb; }
    return null;
  }

  update(dt, players) {
    const g = this.g;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 1; this.manageSpawns(players); }
    this.pathBudget = 3;
    const byPid = new Map();
    for (const p of players) byPid.set(p.pid, p);
    for (const z of this.list) this.think(z, dt, players, byPid);
    // расталкивание
    const L = this.list;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const rr = a.radius + b.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6 && Math.abs(a.pos.y - b.pos.y) < 1.5) {
        const d = Math.sqrt(d2), k = (rr - d) / d * 0.5;
        a.pos.x -= dx * k; a.pos.z -= dz * k; b.pos.x += dx * k; b.pos.z += dz * k;
      }
    }
    for (const z of [...this.list]) this.move(z, dt);
  }

  think(z, dt, players, byPid) {
    const g = this.g;
    const night = g.isNight();
    z.thinkT -= dt;
    if (z.thinkT > 0) return;
    z.thinkT = 0.3 + Math.random() * 0.2;
    let best = null, bd = Infinity;
    for (const p of players) {
      const d = Math.hypot(p.x - z.pos.x, p.z - z.pos.z);
      let range = night ? 20 : 28;
      if (p.crouch) range *= 0.55;
      if (p.sprint) range = Math.max(range, 26);
      if (z.state === 'chase' && z.target === p.pid) range = 50;
      if (z.horde) range = 1000;
      if (Math.abs(p.y - z.pos.y) > 8) range *= 0.5;
      if (d < range && d < bd) { best = p; bd = d; }
    }
    if (best) {
      if (z.state !== 'chase') g.onZombieAlert(z);
      z.state = 'chase'; z.target = best.pid; z.memory = 6;
    } else if (z.state === 'chase') {
      z.memory -= 0.4;
      if (z.memory <= 0) { z.state = 'wander'; z.target = null; z.path = null; }
    } else if (z.state === 'investigate') {
      z.memory -= 0.4;
      if (z.memory <= 0 || (z.goal && Math.hypot(z.goal.x - z.pos.x, z.goal.z - z.pos.z) < 2)) z.state = 'wander';
    } else {
      z.wanderT -= 0.4;
      if (z.wanderT <= 0) {
        z.wanderT = 6 + Math.random() * 8;
        if (Math.random() < 0.35) { z.state = 'idle'; z.goal = null; }
        else {
          const a = Math.random() * 6.28, r = 6 + Math.random() * 14;
          z.state = 'wander';
          z.goal = { x: z.pos.x + Math.cos(a) * r, y: z.pos.y, z: z.pos.z + Math.sin(a) * r };
        }
      }
    }
    if (z.state === 'chase') {
      const p = byPid.get(z.target);
      if (p) z.goal = { x: p.x, y: p.y, z: p.z };
      else { z.state = 'wander'; z.target = null; }
    }
    // босс без цели возвращается к логову
    if (z.lair && z.state !== 'chase' && Math.hypot(z.pos.x - z.lair.x, z.pos.z - z.lair.z) > 25) {
      z.state = 'wander';
      z.goal = { x: z.lair.x + (Math.random() - 0.5) * 10, y: z.pos.y, z: z.lair.z + (Math.random() - 0.5) * 10 };
    }
  }

  // особые умения боссов; true — босс занят умением и стоит на месте
  bossSpecial(z, tp, d, dt) {
    const g = this.g;
    z.specialT -= dt;
    if (z.windT > 0) {
      z.windT -= dt;
      if (z.windT <= 0 && z.type === 'butcher') {
        // удар по земле: урон всем рядом и разрушение блоков
        g.bossFx('slam', z.pos.x, z.pos.y, z.pos.z);
        for (const p of g.hostAlivePlayers()) {
          const dd = Math.hypot(p.x - z.pos.x, p.z - z.pos.z);
          if (dd < 5.5 && Math.abs(p.y - z.pos.y) < 3) g.zombieHitPlayer(p.pid, 34 * (1 - dd / 9) * z.mul.dmg, z);
        }
        const i0 = Math.floor((z.pos.x - 4) / 2), i1 = Math.floor((z.pos.x + 4) / 2), j0 = Math.floor((z.pos.z - 4) / 2), j1 = Math.floor((z.pos.z + 4) / 2);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const b of [...g.blocks.column(i, j)]) g.zombieHitBlock(b, 220);
      }
      return true;
    }
    if (z.specialT > 0 || !tp) return false;
    if (z.type === 'butcher' && d < 5) { z.specialT = 6.5; z.windT = 0.8; z.swing = 0.8; return true; }
    if (z.type === 'screamer' && d < 45) {
      z.specialT = 13;
      g.bossFx('scream', z.pos.x, z.pos.y, z.pos.z);
      let n = 0;
      for (const o of this.list) if (o.summoner === z.id) n++;
      for (let k = 0; k < Math.min(4, 10 - n); k++) {
        const a = Math.random() * 6.28, r = 3 + Math.random() * 4;
        const x = z.pos.x + Math.cos(a) * r, zz = z.pos.z + Math.sin(a) * r;
        if (!g.physics.free(x, g.world.height(x, zz), zz, 0.4, 1.8)) continue;
        const m = this.spawn(Math.random() < 0.3 ? 'runner' : 'walker', x, zz);
        m.state = 'chase'; m.target = z.target; m.memory = 20; m.summoner = z.id;
      }
      return false;
    }
    if (z.type === 'leaper' && d > 6 && d < 22 && z.grounded) {
      z.specialT = 5;
      const dx = tp.x - z.pos.x, dz = tp.z - z.pos.z, l = Math.hypot(dx, dz) || 1;
      const sp = Math.min(17, d * 1.15);
      z.vel.x = dx / l * sp; z.vel.z = dz / l * sp; z.vel.y = 9;
      z.leapT = 0.9;
      g.bossFx('leap', z.pos.x, z.pos.y, z.pos.z);
      return false;
    }
    return false;
  }

  move(z, dt) {
    const g = this.g, T = ZTYPES[z.type], L = z.mul;
    const night = g.isNight();
    let speed = 0, tx = z.pos.x, tz = z.pos.z;
    z.anim = 0;
    let tp = null;
    if (z.state === 'chase') tp = g.hostPlayerPos(z.target);
    if (z.blockKey) {
      const b = g.blocks.byKey.get(z.blockKey);
      if (!b || !tp) z.blockKey = null;
      else {
        const bx = b.i * 2 + 1, bz = b.j * 2 + 1;
        const d = Math.hypot(bx - z.pos.x, bz - z.pos.z);
        if (d > 3.2) z.blockKey = null;
        else {
          z.yaw = angleLerp(z.yaw, Math.atan2(-(bx - z.pos.x), -(bz - z.pos.z)), Math.min(1, dt * 8));
          z.anim = 3;
          z.atkT -= dt;
          if (z.atkT <= 0) { z.atkT = T.rate; z.swing = 0.4; g.zombieHitBlock(b, T.blockDmg * L.dmg); }
          // иногда проверяем — может, путь уже открылся
          z.repathT -= dt;
          if (z.repathT <= 0 && this.pathBudget > 0) {
            this.pathBudget--; z.repathT = 4;
            const path = this.findPath(z, tp);
            if (path && path.reached) { z.path = path.pts; z.pathI = 0; z.blockKey = null; }
          }
          this.physicsStep(z, 0, 0, 0, dt);
          return;
        }
      }
    }
    if (z.boss && z.leapT > 0) { z.leapT -= dt; z.anim = 2; this.physicsStep(z, 0, 0, -1, dt); return; }
    if (z.boss && this.bossSpecial(z, tp, tp ? Math.hypot(tp.x - z.pos.x, tp.z - z.pos.z) : 99, dt)) { z.anim = 3; this.physicsStep(z, 0, 0, 0, dt); return; }
    if (tp) {
      const dx = tp.x - z.pos.x, dz = tp.z - z.pos.z, d = Math.hypot(dx, dz), dy = tp.y - z.pos.y;
      const reach = (T.reach || 1.2) + T.radius;
      if (d < reach && Math.abs(dy) < 1.9 * T.scale) {
        z.anim = 3;
        z.yaw = angleLerp(z.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 10));
        z.atkT -= dt;
        if (z.atkT <= 0 && z.atkWind <= 0) { z.atkWind = 0.4; z.atkT = T.rate; z.swing = 0.45; }
        if (z.atkWind > 0) {
          z.atkWind -= dt;
          if (z.atkWind <= 0 && d < reach + 0.5) g.zombieHitPlayer(z.target, T.dmg * L.dmg, z);
        }
        this.physicsStep(z, 0, 0, 0, dt);
        return;
      }
      tx = tp.x; tz = tp.z;
      speed = (night || g.hordeActive ? T.nightRun : T.run) * L.speed;
      z.anim = 2;
    } else if (z.goal && (z.state === 'wander' || z.state === 'investigate')) {
      tx = z.goal.x; tz = z.goal.z;
      speed = (z.state === 'investigate' ? T.run * 0.75 : T.walk) * L.speed;
      z.anim = z.state === 'investigate' ? 2 : 1;
      if (Math.hypot(tx - z.pos.x, tz - z.pos.z) < 1.2) { z.goal = null; speed = 0; z.anim = 0; }
    }
    if (speed > 0) {
      // следование по пути
      if (z.path) {
        const wp = z.path[z.pathI];
        if (wp) {
          if (Math.hypot(wp.x - z.pos.x, wp.z - z.pos.z) < 0.8) z.pathI++;
          const w2 = z.path[z.pathI];
          if (w2) { tx = w2.x; tz = w2.z; } else z.path = null;
        } else z.path = null;
      }
      // проверка застревания
      z.progT -= dt;
      if (z.progT <= 0) {
        const moved = Math.hypot(z.pos.x - z.lastX, z.pos.z - z.lastZ);
        z.stuck = moved < 0.45 * Math.min(speed, 2);
        z.lastX = z.pos.x; z.lastZ = z.pos.z; z.progT = 0.8;
      }
      z.repathT -= dt;
      if (z.stuck && z.repathT <= 0 && this.pathBudget > 0 && (z.state === 'chase' || z.state === 'investigate')) {
        this.pathBudget--;
        z.repathT = 2.5;
        z.stuck = false;
        const goal = tp || z.goal;
        const path = goal ? this.findPath(z, goal) : null;
        if (path && path.reached) { z.path = path.pts; z.pathI = 0; z.noPath = false; }
        else {
          z.noPath = true;
          if (path && path.pts.length > 2) { z.path = path.pts; z.pathI = 0; }
          if (z.wall && z.wall.kind === 'block' && tp) z.blockKey = z.wall.ref;
          else { z.sideT = 1.2; z.sideDir = Math.random() < 0.5 ? 1 : -1; }
        }
      }
      if (z.hitWall && z.wall && z.wall.kind === 'block' && tp && !z.path && z.noPath) z.blockKey = z.wall.ref;
      let dx = tx - z.pos.x, dz = tz - z.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      if (z.sideT > 0) {
        z.sideT -= dt;
        const sx = -dz * z.sideDir, sz = dx * z.sideDir;
        dx = dx * 0.3 + sx; dz = dz * 0.3 + sz;
        const l2 = Math.hypot(dx, dz) || 1; dx /= l2; dz /= l2;
      }
      // шипы замедляют и ранят
      const sp = g.blocks.spikesAt(z.pos.x, z.pos.y, z.pos.z);
      if (sp) {
        speed *= 0.4;
        g.zombieOnSpikes(z, sp, dt);
        if (!this.byId.has(z.id)) return;
      }
      if (z.pos.y < C.SEA - 1.2) speed *= 0.5;
      z.yaw = angleLerp(z.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 7));
      this.physicsStep(z, dx, dz, speed, dt);
    } else {
      this.physicsStep(z, 0, 0, 0, dt);
    }
  }

  physicsStep(z, dx, dz, speed, dt) {
    if (speed >= 0) {
      const k = Math.min(1, dt * 8);
      z.vel.x += (dx * speed - z.vel.x) * k;
      z.vel.z += (dz * speed - z.vel.z) * k;
    }
    this.g.physics.moveBody(z, dt);
    if (z.hitWall && z.wall && z.wall.kind !== 'block' && z.grounded && speed > 0 && z.wall.y1 - z.pos.y < 1.3) z.vel.y = 6.5;
    if (z.swing > 0) z.swing -= dt;
  }

  // A* по сетке 1 м вокруг зомби
  findPath(z, goal) {
    const N = 64, half = 32;
    const ox = Math.floor(z.pos.x) - half, oz = Math.floor(z.pos.z) - half;
    const gx = clamp(Math.floor(goal.x) - ox, 1, N - 2), gz = clamp(Math.floor(goal.z) - oz, 1, N - 2);
    const exact = gx === Math.floor(goal.x) - ox && gz === Math.floor(goal.z) - oz;
    const sx = half, sz = half;
    const st = new Uint8Array(N * N);
    const w = this.g.world, ph = this.g.physics;
    const free = (cx, cz) => {
      const i = cz * N + cx;
      if (st[i]) return st[i] === 1;
      const wx = ox + cx + 0.5, wz = oz + cz + 0.5;
      const gy = w.height(wx, wz);
      let ok = gy > -1.5;
      if (ok) {
        const list = ph.query(wx - 0.38, wz - 0.38, wx + 0.38, wz + 0.38);
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          if (c.y0 < gy + 1.6 && topAt(c, wx, wz) > gy + 0.6) { ok = false; break; }
        }
      }
      st[i] = ok ? 1 : 2;
      return ok;
    };
    const gs = new Float32Array(N * N).fill(Infinity);
    const par = new Int32Array(N * N).fill(-1);
    const closed = new Uint8Array(N * N);
    const h = (cx, cz) => { const ax = Math.abs(cx - gx), az = Math.abs(cz - gz); return Math.max(ax, az) + 0.414 * Math.min(ax, az); };
    const s = sz * N + sx, goalI = gz * N + gx;
    gs[s] = 0;
    st[s] = 1;
    const open = new Heap();
    open.push(s, h(sx, sz));
    let bestI = s, bestH = h(sx, sz), exp = 0, reached = false;
    while (open.size && exp < 1800) {
      const cur = open.pop();
      if (closed[cur]) continue;
      closed[cur] = 1; exp++;
      if (cur === goalI) { reached = true; bestI = cur; break; }
      const cx = cur % N, cz = (cur / N) | 0;
      const hh = h(cx, cz);
      if (hh < bestH) { bestH = hh; bestI = cur; }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const ni = nz * N + nx;
        if (closed[ni] || !free(nx, nz)) continue;
        if (dx && dz && (!free(cx + dx, cz) || !free(cx, cz + dz))) continue;
        const ng = gs[cur] + (dx && dz ? 1.414 : 1);
        if (ng < gs[ni]) { gs[ni] = ng; par[ni] = cur; open.push(ni, ng + h(nx, nz)); }
      }
    }
    const pts = [];
    let k = bestI;
    while (k !== -1 && k !== s) { pts.push({ x: ox + (k % N) + 0.5, z: oz + ((k / N) | 0) + 0.5 }); k = par[k]; }
    pts.reverse();
    const out = pts.filter((p, i) => i % 2 === 1 || i === pts.length - 1);
    return { pts: out, reached: reached && exact };
  }
}

// ---------- отрисовка ----------
const _box = new THREE.Vector3();

export class ZombieViews {
  constructor(game) {
    this.g = game;
    this.map = new Map();
    this.group = new THREE.Group();
    game.scene.add(this.group);
  }

  sync(id, ti, x, y, z, yaw, st, hpf, snap) {
    let v = this.map.get(id);
    const now = performance.now();
    if (!v) {
      const type = ZT[ti] || 'walker';
      const mesh = ZOMBIE_LOOK[type]();
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      this.group.add(mesh);
      v = { id, type, T: ZTYPES[type], mesh, x, y, z, yaw, tx: x, ty: y, tz: z, tyaw: yaw, st, hpf, seen: now, dead: false, groanT: 2 + Math.random() * 8, atk: 0 };
      if (v.T.boss) {
        const tag = makeNameTag('☠ ' + v.T.name, '#ff6a50');
        tag.position.y = v.T.height / v.T.scale + 0.35;
        tag.scale.set(1.4, 0.35, 1);
        mesh.userData.body.add(tag);
      }
      this.map.set(id, v);
    }
    if (hpf < v.hpf - 0.001) v.hitT = 1; // попадание — зомби вздрагивает
    v.tx = x; v.ty = y; v.tz = z; v.tyaw = yaw; v.hpf = hpf; v.seen = now;
    if (st === 3 && v.st !== 3) v.atk = 0;
    if (st === 2 && v.st !== 2 && v.st !== 3) { this.g.sfx.groan(v.mesh.position, v.T.pitch, true); v.groanT = 3 + Math.random() * 5; }
    v.st = st;
    if (snap) { v.x = x; v.y = y; v.z = z; v.yaw = yaw; }
  }

  kill(id) {
    const v = this.map.get(id);
    if (!v || v.dead) return;
    v.dead = true; v.deadT = 0;
    this.g.sfx.groan(v.mesh.position, v.T.pitch * 0.8, true);
  }

  remove(id) {
    const v = this.map.get(id);
    if (!v) return;
    this.group.remove(v.mesh);
    this.map.delete(id);
  }

  clear() { for (const id of [...this.map.keys()]) this.remove(id); }

  update(dt) {
    const now = performance.now();
    const cam = this.g.camera.position;
    for (const v of this.map.values()) {
      if (v.dead) {
        v.deadT += dt;
        animateDeath(v.mesh, v.deadT);
        if (v.deadT > 5) v.mesh.position.y -= dt * 0.5;
        if (v.deadT > 7) this.remove(v.id);
        continue;
      }
      if (now - v.seen > 1600) { this.remove(v.id); continue; }
      const k = 1 - Math.exp(-dt * 12);
      const ox = v.x, oz = v.z;
      v.x += (v.tx - v.x) * k; v.y += (v.ty - v.y) * k; v.z += (v.tz - v.z) * k;
      v.yaw = angleLerp(v.yaw, v.tyaw, k);
      const sp = Math.hypot(v.x - ox, v.z - oz) / Math.max(dt, 1e-4);
      v.mesh.position.set(v.x, v.y, v.z);
      v.mesh.rotation.y = v.yaw;
      const d = Math.hypot(v.x - cam.x, v.z - cam.z);
      v.mesh.visible = d < 170;
      const far = d > (v.T.boss ? 70 : 32);
      if (v.far !== far) { v.far = far; setLod(v.mesh, far); }
      if (v.st === 3) v.atk = (v.atk + dt / Math.max(0.7, v.T.rate)) % 1; else v.atk = 0; // один замах — один удар
      v.hitT = Math.max(0, (v.hitT || 0) - dt * 4);
      // гонится и близко — тянет руки вперёд, иначе они свисают
      v.reach = (v.reach || 0) + (((v.st === 2 && d < 7) ? 1 : 0) - (v.reach || 0)) * Math.min(1, dt * 3);
      if (v.mesh.visible && d < 90) animate(v.mesh, dt, sp, { atk: v.st === 3 ? v.atk : -1, hit: v.hitT, reach: v.reach });
      v.groanT -= dt;
      if (v.groanT <= 0) {
        v.groanT = 4 + Math.random() * 9;
        if (d < 45) this.g.sfx.groan(v.mesh.position, v.T.pitch, false);
      }
    }
  }

  // попадание луча в зомби: тело — AABB, голова — сфера
  hitTest(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    for (const v of this.map.values()) {
      if (v.dead) continue;
      const s = v.T.scale, wd = 0.3 * s * v.T.wide;
      if (Math.abs(v.x - ox) > maxT + 3 || Math.abs(v.z - oz) > maxT + 3) continue;
      // голова
      const hy = v.y + 1.66 * s, hr = 0.24 * s;
      const cx = v.x - ox, cy = hy - oy, cz = v.z - oz;
      const tc = cx * dx + cy * dy + cz * dz;
      if (tc > 0 && tc < maxT) {
        const d2 = cx * cx + cy * cy + cz * cz - tc * tc;
        if (d2 < hr * hr) {
          const t = tc - Math.sqrt(hr * hr - d2);
          if (!best || t < best.t) best = { id: v.id, t, head: true };
        }
      }
      const r = rayBox(ox, oy, oz, dx, dy, dz, v.x - wd, v.y, v.z - wd, v.x + wd, v.y + 1.48 * s, v.z + wd, best ? best.t : maxT);
      if (r && (!best || r.t < best.t)) best = { id: v.id, t: r.t, head: false };
    }
    return best;
  }
}
