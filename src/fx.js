// Частицы (кровь, щепки, пыль, дым), трассеры и вспышки выстрелов.
import * as THREE from 'three';

const MAXP = 600;

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
    this.flashT = 0;
    this.emitters = [];
  }

  spawn(x, y, z, vx, vy, vz, life, size, hex, grav = 1, drag = 0.5) {
    if (this.ps.length >= MAXP) this.ps.shift();
    this.ps.push({ x, y, z, vx, vy, vz, life, max: life, size, col: hex, grav, drag, rx: Math.random() * 6, ry: Math.random() * 6 });
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

  muzzle(pos) {
    this.flash.position.copy(pos);
    this.flash.intensity = 30;
    this.flashT = 0.05;
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
    let n = 0;
    const m = this.m, q = this.q, e = this.e, c = this.c;
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life -= dt;
      if (p.life <= 0) { this.ps.splice(i, 1); continue; }
      p.vy -= 9.8 * p.grav * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += dt * 4; p.ry += dt * 3;
    }
    const vp = this.vp || (this.vp = new THREE.Vector3()), vs = this.vs || (this.vs = new THREE.Vector3());
    for (const p of this.ps) {
      const s = p.size * (p.grav < 0 ? 1 + (1 - p.life / p.max) * 2.5 : Math.min(1, p.life / p.max * 2));
      e.set(p.rx, p.ry, 0);
      q.setFromEuler(e);
      m.compose(vp.set(p.x, p.y, p.z), q, vs.set(s, s, s));
      this.mesh.setMatrixAt(n, m);
      c.setHex(p.col);
      this.mesh.setColorAt(n, c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t -= dt;
      if (t.t <= 0) { this.scene.remove(t.l); t.l.geometry.dispose(); this.tracers.splice(i, 1); }
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
  }
}
