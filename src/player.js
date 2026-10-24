// Локальный игрок: движение от первого лица, выносливость, голод, жажда, здоровье.
import * as THREE from 'three';
import * as C from './config.js';
import { perks } from './items.js';

export class Player {
  constructor(game) {
    this.g = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.radius = 0.36; this.height = 1.8; this.step = 0.55; this.grounded = false;
    this.yaw = 0; this.pitch = 0;
    this.hp = 100; this.stamina = 100; this.food = 100; this.water = 100;
    this.alive = true; this.crouch = false; this.sprint = false; this.swim = false; this.tired = false;
    this.sel = 0; this.xp = 0; this.level = 1;
    this.bobT = 0; this.stepDist = 0;
    this.bed = null;
    this.dmgFlash = 0;
    this.kills = 0;
    this.stats = {};
    this.quest = 0;
    this.jumpHeld = false;
  }

  get perks() { return perks(this.level); }
  get maxHp() { return this.perks.maxHp; }
  get eye() { return this.crouch ? 1.12 : 1.62; }

  update(dt) {
    const g = this.g, k = g.input.keys;
    if (!this.alive) return;
    const ctl = g.ui.captured && !g.ui.typing;
    let f = 0, s = 0;
    if (ctl) {
      if (k.has('KeyW')) f += 1;
      if (k.has('KeyS')) f -= 1;
      if (k.has('KeyD')) s += 1;
      if (k.has('KeyA')) s -= 1;
    }
    this.crouch = ctl && (k.has('KeyC') || k.has('ControlLeft'));
    const moving = f !== 0 || s !== 0;
    // выдохся — снова бежать можно, когда выносливость восстановится до 25 (иначе бег включался бы через кадр)
    if (this.stamina <= 1) this.tired = true;
    else if (this.stamina >= 25) this.tired = false;
    this.sprint = ctl && moving && f > 0 && k.has('ShiftLeft') && !this.tired && !this.crouch && g.weapons.ads < 0.3;
    let speed = this.crouch ? 2.0 : this.sprint ? 7.0 : 4.3;
    if (this.swim) speed *= 0.55;
    if (g.weapons.useT > 0) speed *= 0.5;
    if (g.weapons.ads > 0.5) speed *= 0.65;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * f + rx * s, wz = fz * f + rz * s;
    const l = Math.hypot(wx, wz);
    if (l > 0) { wx /= l; wz /= l; }
    const accel = this.grounded || this.swim ? 12 : 2.5;
    const kk = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * speed - this.vel.x) * kk;
    this.vel.z += (wz * speed - this.vel.z) * kk;
    const jump = ctl && k.has('Space');
    if (jump && !this.jumpHeld && (this.grounded || this.swim) && this.stamina > 6) {
      this.vel.y = this.swim ? 4.5 : 6.8;
      this.stamina -= 6;
      this.grounded = false;
    }
    this.jumpHeld = jump;
    this.height = this.crouch ? 1.25 : 1.8;
    this.gravity = this.swim ? 0.25 : 1;
    g.physics.moveBody(this, dt);
    // вода: держимся у поверхности
    const surf = C.SEA - 1.35;
    this.swim = this.pos.y < surf + 0.05;
    if (this.pos.y < surf) {
      this.vel.y += (surf - this.pos.y) * 25 * dt;
      this.vel.y *= Math.exp(-dt * 3);
    }
    if (this.landV < -13) this.damage((-this.landV - 13) * 5, 'fall');

    // характеристики
    const bw = g.world.biomeW(this.pos.x, this.pos.z, this._bw || (this._bw = {}));
    // в пустыне быстрее хочется пить, в снегах — есть (особенно ночью)
    const cold = 1 + bw.snow * (g.isNight() ? 0.6 : 0.3);
    this.food = Math.max(0, this.food - 0.04 * (this.sprint ? 1.6 : 1) * cold * dt);
    this.water = Math.max(0, this.water - 0.062 * (this.sprint ? 1.8 : 1) * (1 + bw.desert * 0.45) * dt);
    if (this.food <= 0 || this.water <= 0) this.damage(0.55 * dt, 'starve', true);
    else if (this.food > 50 && this.water > 50 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 0.12 * dt);
    const maxSt = this.perks.stamina;
    if (this.sprint) this.stamina = Math.max(0, this.stamina - 13 * dt);
    else this.stamina = Math.min(maxSt, this.stamina + (this.grounded ? 16 : 6) * dt);
    if (this.dmgFlash > 0) this.dmgFlash = Math.max(0, this.dmgFlash - dt * 1.5);

    // шаги
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hs > 0.5) {
      this.bobT += dt * hs * 1.6;
      this.stepDist += hs * dt;
      if (this.stepDist > (this.sprint ? 2.4 : 1.9)) { this.stepDist = 0; if (!this.crouch) g.sfx.step(null, g.biomeHere() === 'snow'); }
    }
  }

  updateCamera(cam) {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const bob = this.grounded ? Math.sin(this.bobT * 2) * 0.035 * Math.min(1, hs / 4) : 0;
    const eye = this.alive ? this.eye : 0.4;
    cam.position.set(this.pos.x, this.pos.y + eye + bob, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, this.alive ? 0 : 0.6, 'YXZ');
  }

  look(dx, dy, sens) {
    const k = 0.0022 * sens * (this.g.weapons.ads > 0.5 ? 1 / Math.max(1, this.g.weapons.zoomNow * 0.7) : 1);
    this.yaw -= dx * k;
    this.pitch -= dy * k;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
  }

  damage(n, src, silent) {
    if (!this.alive || n <= 0) return;
    // часть урона от зомби забирает броня
    if (src === 'zombie') n = this.g.armorAbsorb(n);
    this.hp -= n;
    if (!silent) { this.dmgFlash = Math.min(1, this.dmgFlash + n / 25); this.g.sfx.hurt(); }
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.g.onLocalDeath(src); }
  }

  spawnAt(x, y, z, yaw = 0) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.alive = true;
    this.grounded = false;
  }
}
