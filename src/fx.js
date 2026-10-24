// Частицы (кровь, щепки, пыль, дым, огонь), трассеры, вспышки выстрелов и взрывы.
import * as THREE from 'three';

const MAXP = 1000, MAXG = 400;

export class Fx {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAXP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
    this.ps = [];
    // светящиеся частицы (огонь, искры): без освещения, к концу темнеют и уменьшаются
    const gmat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.gmesh = new THREE.InstancedMesh(geo, gmat, MAXG);
    this.gmesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gmesh.frustumCulled = false;
    this.gmesh.count = 0;
    this.gmesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.gmesh);
    this.gs = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.c = new THREE.Color();
    this.tracers = [];
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85 });
    this.tracerGeo = tg;
    this.flash = new THREE.PointLight(0xffc070, 0, 14, 2);
    scene.add(this.flash);
    this.flashT = 0; this.flashDur = 0.05; this.flashI = 0;
    this.emitters = [];
  }

  // delay — через сколько секунд частица появится (дым взрыва идёт после огня)
  spawn(x, y, z, vx, vy, vz, life, size, hex, grav = 1, drag = 0.5, delay = 0) {
    if (this.ps.length >= MAXP) this.ps.shift();
    this.ps.push({ x, y, z, vx, vy, vz, life, max: life, size, col: hex, grav, drag, delay, rx: Math.random() * 6, ry: Math.random() * 6 });
  }

  glow(x, y, z, vx, vy, vz, life, size, hex, grav = 0, drag = 1) {
    if (this.gs.length >= MAXG) this.gs.shift();
    this.gs.push({ x, y, z, vx, vy, vz, life, max: life, size, col: hex, grav, drag, delay: 0, rx: Math.random() * 6, ry: Math.random() * 6 });
  }

  burst(x, y, z, n, hex, speed = 3, size = 0.08, life = 0.6, grav = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + speed * 0.4, Math.sin(a) * Math.cos(e) * s, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), hex, grav);
    }
  }

  blood(x, y, z) { this.burst(x, y, z, 12, 0x9a1010, 3.2, 0.07, 0.7); }
  impact(x, y, z, kind) {
    const col = kind === 'tree' ? 0x8a5a32 : kind === 'rock' || kind === 'terrain' ? 0x8a8070 : kind === 'block' ? 0x9a6a3e : 0xaaaaaa;
    this.burst(x, y, z, 6, col, 2.2, 0.06, 0.45);
  }

  tracer(a, b) {
    const g = this.tracerGeo.clone();
    const p = g.attributes.position.array;
    p[0] = a.x; p[1] = a.y; p[2] = a.z; p[3] = b.x; p[4] = b.y; p[5] = b.z;
    g.attributes.position.needsUpdate = true;
    const l = new THREE.Line(g, this.tracerMat);
    l.frustumCulled = false;
    this.scene.add(l);
    this.tracers.push({ l, t: 0.06 });
  }

  muzzle(pos) { this.flashAt(pos.x, pos.y, pos.z, 30, 14, 0.05); }

  // вспышка света; dur — за сколько секунд гаснет
  flashAt(x, y, z, intensity, dist, dur) {
    if (this.flashT > 0 && this.flashI * this.flashT / this.flashDur > intensity) return;
    this.flash.position.set(x, y, z);
    this.flash.distance = dist;
    this.flashI = intensity; this.flashDur = dur; this.flashT = dur;
    this.flash.intensity = intensity;
  }

  // дымный след гранаты
  trail(x, y, z) {
    const R = Math.random, c = [0xc8c8c4, 0xb4b4b0, 0xa0a09c][Math.floor(R() * 3)];
    this.spawn(x, y, z, (R() - 0.5) * 0.4, 0.15 + R() * 0.3, (R() - 0.5) * 0.4, 1.3 + R() * 0.9, 0.16 + R() * 0.08, c, -0.012, 1.4);
    if (R() < 0.5) this.glow(x, y, z, 0, 0, 0, 0.06, 0.12, 0xffb050, 0, 0);
  }

  // реактивная струя назад из трубы РПГ
  backblast(x, y, z, dx, dz) {
    const R = Math.random;
    for (let i = 0; i < 16; i++) {
      const s = 4 + R() * 8;
      this.spawn(x, y, z, dx * s + (R() - 0.5) * 3, (R() - 0.3) * 1.6, dz * s + (R() - 0.5) * 3, 1.2 + R() * 1.2, 0.3 + R() * 0.25, R() < 0.5 ? 0xb0aca4 : 0x8a8680, -0.02, 2.5);
    }
    for (let i = 0; i < 6; i++) this.glow(x, y, z, dx * 6 + (R() - 0.5) * 2, (R() - 0.5), dz * 6 + (R() - 0.5) * 2, 0.12, 0.25, 0xffa040, 0, 3);
  }

  // взрыв: вспышка, огненный шар, искры, комья земли, клубы дыма, пыль по земле (на воде — брызги)
  blast(x, y, z, water) {
    const R = Math.random;
    this.flashAt(x, y + 0.6, z, 900, 55, 0.4);
    for (let i = 0; i < 46; i++) {
      const a = R() * 6.283, e = R() * 2 - 1, c = Math.sqrt(1 - e * e), s = 1.5 + R() * 6.5;
      this.glow(x, y + 0.2, z, Math.cos(a) * c * s, e * s * 0.7 + 1.5, Math.sin(a) * c * s, 0.35 + R() * 0.4, 0.6 + R() * 0.7, [0xfff0b0, 0xffc040, 0xff8a20, 0xff5a10][i & 3], -0.05, 4);
    }
    for (let i = 0; i < 30; i++) {
      const a = R() * 6.283, e = R() * 1.6 - 0.3, c = Math.cos(e), s = 9 + R() * 16;
      this.glow(x, y + 0.2, z, Math.cos(a) * c * s, Math.sin(e) * s + 3, Math.sin(a) * c * s, 0.35 + R() * 0.55, 0.05 + R() * 0.04, 0xffd070, 0.7, 0.8);
    }
    for (let i = 0; i < 34; i++) {
      const a = R() * 6.283, s = 4 + R() * 10;
      const col = water ? (R() < 0.5 ? 0xe8f0f4 : 0xa8c8dc) : [0x4a3a2a, 0x5a5048, 0x3a3632, 0x6a5a48][i & 3];
      this.spawn(x, y + 0.2, z, Math.cos(a) * s * 0.6, 4 + R() * (water ? 14 : 9), Math.sin(a) * s * 0.6, 1 + R() * 1.2, water ? 0.12 + R() * 0.12 : 0.07 + R() * 0.1, col, 1, 0.3);
    }
    for (let i = 0; i < 26; i++) {
      const a = R() * 6.283, s = 0.6 + R() * 2.8, gr = Math.floor(R() * 4);
      this.spawn(x + (R() - 0.5) * 2, y + R() * 1.5, z + (R() - 0.5) * 2, Math.cos(a) * s, 1 + R() * 2.4, Math.sin(a) * s, 3 + R() * 3, 0.5 + R() * 0.45, water ? 0xd8e2e8 : 0x3a3a38 + gr * 0x0d0d0c, -0.025, 1.4, 0.15 + R() * 0.3);
    }
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * 6.283 + R() * 0.2, s = 6 + R() * 4;
      this.spawn(x, y + 0.15, z, Math.cos(a) * s, 0.3 + R() * 0.5, Math.sin(a) * s, 1.4 + R(), 0.35 + R() * 0.3, water ? 0xe0eaf0 : 0x8a7a62, -0.012, 2.2, 0.05);
    }
  }

  // постоянный дым (место крушения)
  addSmoke(x, y, z) { this.emitters.push({ x, y, z, t: 0 }); }

  update(dt, camPos) {
    for (const em of this.emitters) {
      if (Math.abs(em.x - camPos.x) > 300 || Math.abs(em.z - camPos.z) > 300) continue;
      em.t -= dt;
      if (em.t <= 0) {
        em.t = 0.12;
        const g = 0x2a2a2a + Math.floor(Math.random() * 3) * 0x111111;
        this.spawn(em.x + (Math.random() - 0.5) * 2, em.y, em.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.4, 2 + Math.random(), (Math.random() - 0.5) * 0.4, 5, 0.9 + Math.random() * 0.6, g, -0.02, 0.1);
      }
    }
    this.step(this.ps, dt);
    this.step(this.gs, dt);
    this.draw(this.mesh, this.ps, false);
    this.draw(this.gmesh, this.gs, true);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      if (t.t <= 0) { this.scene.remove(t.l); t.l.geometry.dispose(); this.tracers.splice(i, 1); }
    }
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = this.flashT > 0 ? this.flashI * Math.min(1, this.flashT / this.flashDur * 1.5) : 0; }
  }

  step(ps, dt) {
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.vy -= 9.8 * p.grav * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k;
      if (p.grav <= 0) p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += dt * 4; p.ry += dt * 3;
    }
  }

  // дым (grav < 0) растёт и расплывается; огонь растёт и гаснет по яркости; остальное к концу уменьшается
  draw(mesh, ps, glow) {
    const m = this.m, q = this.q, e = this.e, c = this.c;
    const vp = this.vp || (this.vp = new THREE.Vector3()), vs = this.vs || (this.vs = new THREE.Vector3());
    let n = 0;
    for (const p of ps) {
      if (p.delay > 0) continue;
      const f = p.life / p.max;
      const s = p.size * (p.grav < 0 ? (glow ? (0.6 + (1 - f) * 1.6) * Math.min(1, f * 3) : 1 + (1 - f) * 2.5) : Math.min(1, f * 2));
      e.set(p.rx, p.ry, 0);
      q.setFromEuler(e);
      m.compose(vp.set(p.x, p.y, p.z), q, vs.set(s, s, s));
      mesh.setMatrixAt(n, m);
      c.setHex(p.col);
      if (glow) c.multiplyScalar(0.45 + 0.55 * f);
      mesh.setColorAt(n, c);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
