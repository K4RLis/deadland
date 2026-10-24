// Гранаты РПГ: полёт с разгоном и лёгким снижением, дымный след, взрыв при касании.
// Попадание ищет только стрелок (как и у пуль); остальные видят гранату и ждут от хоста сообщение о взрыве.
import * as THREE from 'three';
import * as C from './config.js';
import { rocketModel } from './models.js';

const V0 = 70, VMAX = 140, ACC = 150, GRAV = 2.2, LIFE = 5, TRAIL = 0.5;
const _d = new THREE.Vector3(), _t = new THREE.Vector3();

export class Rockets {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.seq = 0;
  }

  // выстрел этого игрока
  fire(o, dir) {
    const g = this.g, id = g.myId + ':' + (++this.seq);
    this.launch(id, o, dir, true);
    g.toHost({ t: 'rk', id, o: [+o.x.toFixed(2), +o.y.toFixed(2), +o.z.toFixed(2)], v: [+dir.x.toFixed(4), +dir.y.toFixed(4), +dir.z.toFixed(4)] });
  }

  launch(id, o, dir, own) {
    const mesh = rocketModel();
    this.g.scene.add(mesh);
    const r = { id, own, mesh, pos: new THREE.Vector3().copy(o), vel: new THREE.Vector3().copy(dir).normalize().multiplyScalar(V0), age: 0, dist: 0, trail: 0, wait: -1 };
    this.orient(r);
    this.list.push(r);
  }

  // модель смотрит носом (−z) по скорости
  orient(r) {
    r.mesh.position.copy(r.pos);
    r.mesh.lookAt(_t.copy(r.pos).sub(r.vel));
  }

  // взрыв чужой гранаты (пришёл от хоста)
  remote(id, p) {
    const i = this.list.findIndex(r => r.id === id);
    if (i >= 0) this.drop(i);
    this.g.blastFx(+p[0], +p[1], +p[2]);
  }

  drop(i) {
    this.g.scene.remove(this.list[i].mesh);
    this.list.splice(i, 1);
  }

  update(dt) {
    const g = this.g;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      if (r.wait >= 0) {
        // чужая граната уже во что-то врезалась: если хост молчит, взрываем сами
        r.wait -= dt;
        if (r.wait < 0) { this.drop(i); g.blastFx(r.pos.x, r.pos.y, r.pos.z); }
        continue;
      }
      r.age += dt;
      // через долю секунды включается маршевый двигатель
      const sp = r.vel.length();
      if (r.age > 0.12 && sp < VMAX) r.vel.multiplyScalar(Math.min(VMAX, sp + ACC * dt) / sp);
      r.vel.y -= GRAV * dt;
      const step = r.vel.length() * dt, p = r.pos;
      _d.copy(r.vel).normalize();
      let t = step, hit = false, zid = 0;
      const wh = g.physics.raycast(p.x, p.y, p.z, _d.x, _d.y, _d.z, step, { skip: c => c.kind === 'bush' || c.ghost });
      if (wh) { t = wh.t; hit = true; }
      if (r.own) {
        const zh = g.zviews.hitTest(p.x, p.y, p.z, _d.x, _d.y, _d.z, t);
        if (zh) { t = zh.t; zid = zh.id; hit = true; }
      }
      // о воду граната тоже рвётся
      if (!hit && _d.y < 0 && p.y + _d.y * t < C.SEA) { t = Math.max(0, (C.SEA - p.y) / _d.y); hit = true; }
      // дымный след вдоль пройденного отрезка — с 3 м от трубы, чтобы не застилать стрелку обзор
      r.dist += t;
      if (r.dist > 3) r.trail += Math.min(t, r.dist - 3);
      while (r.trail >= TRAIL) {
        r.trail -= TRAIL;
        const k = t - r.trail;
        g.fx.trail(p.x + _d.x * k, p.y + _d.y * k, p.z + _d.z * k);
      }
      p.addScaledVector(_d, t);
      if (!hit && r.age > LIFE) hit = true; // самоликвидатор
      if (hit) {
        p.addScaledVector(_d, -0.12);
        if (r.own) {
          this.drop(i);
          g.blastFx(p.x, p.y, p.z);
          g.netBoom(r.id, p, zid);
          if (zid) g.ui.hitmarker(false);
        }
        else { r.wait = 0.8; r.mesh.visible = false; }
        continue;
      }
      this.orient(r);
      for (const f of r.mesh.userData.flames) {
        const k = 0.75 + Math.random() * 0.5;
        f.m.scale.set(f.s.x * k, f.s.y * (0.7 + Math.random() * 0.7), f.s.z * k);
      }
    }
  }

  clear() { while (this.list.length) this.drop(this.list.length - 1); }
}
