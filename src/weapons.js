// Предмет в руках: стрельба, ближний бой, добыча ресурсов, еда/лечение, установка блоков.
import * as THREE from 'three';
import { ITEMS, FISTS } from './items.js';
import { itemModel, part } from './models.js';
import { BLOCK_TYPES } from './blocks.js';

const MUZZLE = { pistol: -0.2, smg: -0.37, shotgun: -0.7, rifle: -0.69, asval: -0.57, sniper: -0.74 };
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3(), _e = new THREE.Vector3();

export class Weapons {
  constructor(game) {
    this.g = game;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.position.set(0.5, 1, 0.8);
    this.scene.add(this.sun);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.hold = new THREE.Group();
    this.root.add(this.hold);
    this.curId = undefined;
    this.model = null;
    this.cool = 0; this.reloadT = 0; this.reloadMax = 1; this.swingT = 0; this.recoil = 0; this.ads = 0;
    this.useT = 0; this.useMax = 1; this.useIdx = -1;
    this.meleePending = null;
    this.equipT = 0; this.bobT = 0;
    this.harvestHits = new Map();
    this.buildRot = 0;
    this.zoomNow = 1;
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.9, depthWrite: false });
    this.flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), flashMat);
    this.flash.visible = false;
    this.flashT = 0;
    this.lastAmmoUi = -1;
    this.fists = null;
    this.punchSide = 1;
  }

  equip(id) {
    this.curId = id;
    if (this.model) { this.hold.remove(this.model); }
    this.model = new THREE.Group();
    const def = id ? ITEMS[id] : null;
    if (id) {
      const m = itemModel(id);
      if (def.cat === 'block') m.scale.setScalar(1.3);
      else if (def.cat !== 'gun' && def.cat !== 'melee') { m.scale.setScalar(0.55); m.rotation.set(0.3, 0.6, 0); }
      this.model.add(m);
    }
    // руки
    const skin = 0xe0ac80, sleeve = this.g.myColor || 0x3b6fb6;
    this.fists = null;
    if (!def) {
      // два кулака в стойке: кисть, костяшки, большой палец, рукав с манжетой
      this.fists = [];
      for (const side of [1, -1]) {
        const h = new THREE.Group();
        part(h, 0.1, 0.095, 0.12, skin, 0, 0, 0);
        part(h, 0.102, 0.035, 0.05, 0xc8946a, 0, 0.034, -0.045);
        part(h, 0.03, 0.04, 0.065, skin, -side * 0.058, -0.012, -0.015);
        part(h, 0.085, 0.085, 0.34, sleeve, 0, -0.1, 0.19, 0.62);
        part(h, 0.092, 0.092, 0.05, 0x2a2a2a, 0, -0.03, 0.065, 0.62);
        h.scale.setScalar(0.85);
        this.model.add(h);
        this.fists.push({ g: h, side });
      }
    } else if (def.cat === 'melee' || def.cat === 'gun') {
      part(this.model, 0.085, 0.085, 0.42, sleeve, 0.0, -0.08, 0.26, 0.15);
      part(this.model, 0.08, 0.08, 0.09, skin, 0.0, -0.05, 0.03);
    } else {
      part(this.model, 0.085, 0.085, 0.42, sleeve, 0.04, -0.12, 0.25, 0.2);
      part(this.model, 0.08, 0.08, 0.09, skin, 0.02, -0.08, 0.04);
    }
    if (def && def.cat === 'gun') { this.flash.position.set(0, 0.03, MUZZLE[id] ?? -0.4); this.model.add(this.flash); }
    this.model.traverse(o => { o.castShadow = false; });
    this.hold.add(this.model);
    this.equipT = 0.3;
    this.reloadT = 0; this.useT = 0; this.swingT = 0; this.meleePending = null;
    this.g.blocks.hideGhost();
  }

  get def() { return this.curId ? ITEMS[this.curId] : null; }

  update(dt) {
    const g = this.g, P = g.player, inv = g.inv, inp = g.input;
    const slot = inv.slots[P.sel];
    const id = slot ? slot.id : null;
    if (id !== this.curId) this.equip(id);
    const def = this.def;
    const ctl = g.ui.captured && !g.ui.typing && P.alive;
    this.cool -= dt;
    if (this.equipT > 0) this.equipT -= dt;
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }

    // прицеливание
    const wantAds = ctl && inp.rmb && def && def.cat === 'gun' && this.reloadT <= 0 && !P.sprint;
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 12);
    const zoom = def && def.cat === 'gun' ? def.zoom : 1;
    this.zoomNow = 1 + (zoom - 1) * this.ads;
    const fov = g.settings.fov / this.zoomNow;
    if (Math.abs(g.camera.fov - fov) > 0.01) { g.camera.fov = fov; g.camera.updateProjectionMatrix(); }
    const scoped = def && def.scope && this.ads > 0.85;
    g.ui.setScope(scoped);
    this.root.visible = !scoped && P.alive;

    // перезарядка
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0 && slot && def && def.cat === 'gun') {
        const need = def.mag - slot.ammo;
        const k = Math.min(need, inv.count(def.ammo));
        if (k > 0) { inv.remove(def.ammo, k); slot.ammo += k; }
      }
    }
    if (ctl && inp.pressed.has('KeyR') && def && def.cat === 'gun' && this.reloadT <= 0) this.startReload(def, slot);

    // использование еды/медицины — удерживать ЛКМ
    if (this.useT > 0) {
      if (!ctl || !inp.lmb || this.useIdx !== P.sel || !slot) this.useT = 0;
      else {
        this.useT -= dt;
        if (this.useT <= 0) this.finishUse(slot);
      }
    }

    // ближний бой с задержкой удара
    if (this.meleePending) {
      this.meleePending.t -= dt;
      if (this.meleePending.t <= 0) { const d = this.meleePending.def; this.meleePending = null; this.doMelee(d); }
    }
    if (this.swingT > 0) this.swingT = Math.max(0, this.swingT - dt / (def && def.rate ? def.rate : 0.5));

    // строительство
    if (def && def.cat === 'block' && ctl) this.updateBuild(def, slot);
    else g.blocks.hideGhost();

    // атака
    if (ctl && (inp.lmb) && this.cool <= 0 && this.equipT <= 0 && this.useT <= 0) {
      const wantAuto = def && def.cat === 'gun' && def.auto;
      if (inp.lmbPressed || wantAuto || (def && def.cat === 'melee') || !def) {
        if (!def) this.melee(FISTS);
        else if (def.cat === 'melee') this.melee(def);
        else if (def.cat === 'gun') this.fire(def, slot);
        else if ((def.cat === 'food' || def.cat === 'med') && inp.lmbPressed) this.startUse(def);
      }
    }
    // молоток: ПКМ — разобрать
    if (ctl && def && def.repair && inp.rmbPressed) this.dismantle();

    this.animate(dt, def, slot);
    if (def && def.cat === 'gun' && slot) {
      const key = slot.ammo * 1000 + inv.count(def.ammo);
      if (key !== this.lastAmmoUi) { this.lastAmmoUi = key; g.ui.dirtyHud = true; }
    }
  }

  camVectors() {
    const cam = this.g.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    _r.set(e[0], e[1], e[2]);
    _u.set(e[4], e[5], e[6]);
    _f.set(-e[8], -e[9], -e[10]);
    _o.copy(cam.position);
  }

  trace(o, d, range) {
    const g = this.g;
    const zh = g.zviews.hitTest(o.x, o.y, o.z, d.x, d.y, d.z, range);
    const wh = g.physics.raycast(o.x, o.y, o.z, d.x, d.y, d.z, zh ? zh.t : range, { skip: c => c.kind === 'glass' || c.kind === 'bush' });
    if (wh) return { t: wh.t, world: wh };
    if (zh) return { t: zh.t, zid: zh.id, head: zh.head };
    return { t: range };
  }

  startReload(def, slot) {
    if (!slot || slot.ammo >= def.mag) return;
    if (this.g.inv.count(def.ammo) <= 0) { this.g.ui.toast('Нет патронов: ' + ITEMS[def.ammo].name); return; }
    this.reloadT = this.reloadMax = def.reload;
    this.g.sfx.reload(null);
  }

  fire(def, slot) {
    const g = this.g, P = g.player;
    if (this.reloadT > 0) return;
    if (slot.ammo <= 0) {
      g.sfx.dry(null);
      this.cool = 0.3;
      if (g.inv.count(def.ammo) > 0) this.startReload(def, slot);
      else g.ui.toast('Нет патронов');
      return;
    }
    slot.ammo--;
    this.cool = def.rate;
    this.camVectors();
    const hs = Math.hypot(P.vel.x, P.vel.z);
    let sp = this.ads > 0.5 ? (def.adsSpread ?? def.spread * 0.35) : def.spread;
    sp *= (hs > 1 ? 1.7 : 1) * (P.crouch ? 0.7 : 1) * (P.grounded ? 1 : 2.2);
    const pellets = def.pellets || 1;
    let firstEnd = null;
    const muzzle = _e.copy(_o).addScaledVector(_f, 0.7).addScaledVector(_r, this.ads > 0.5 ? 0.02 : 0.16).addScaledVector(_u, this.ads > 0.5 ? -0.06 : -0.13);
    let hitAny = false;
    for (let i = 0; i < pellets; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * sp;
      _d.copy(_f).addScaledVector(_r, Math.cos(a) * rr).addScaledVector(_u, Math.sin(a) * rr).normalize();
      const h = this.trace(_o, _d, def.range);
      const end = _o.clone().addScaledVector(_d, h.t);
      if (h.zid) {
        const fall = h.t > def.range * 0.5 ? 0.75 : 1;
        g.hitZombie(h.zid, def.dmg * (h.head ? 2.2 : 1) * P.perks.gun * fall, h.head, end);
        hitAny = true;
      } else if (h.world) {
        g.fx.impact(end.x, end.y, end.z, h.world.kind);
      }
      if (i === 0) firstEnd = end;
      if (i === 0 || Math.random() < 0.3) g.fx.tracer(muzzle, end);
    }
    g.fx.muzzle(muzzle);
    this.flash.visible = true; this.flash.rotation.z = Math.random() * 3; this.flashT = 0.05;
    g.sfx.gun(def.sound, null);
    g.netShot(_o, firstEnd, this.curId);
    const rk = (this.ads > 0.5 ? 0.55 : 1) * (P.crouch ? 0.7 : 1);
    P.pitch = Math.min(1.55, P.pitch + def.recoil * rk);
    P.yaw += (Math.random() - 0.5) * def.recoil * 0.6 * rk;
    this.recoil = 1;
    if (!hitAny) return;
  }

  melee(def) {
    this.cool = def.rate;
    this.swingT = 1;
    if (def === FISTS) this.punchSide = -this.punchSide;
    this.g.sfx.swing(null);
    // удар засчитывается в момент, когда кулак/лезвие на пике движения
    this.meleePending = { t: def.rate * 0.27, def };
  }

  doMelee(def) {
    const g = this.g, P = g.player;
    this.camVectors();
    const range = def.range;
    let zh = g.zviews.hitTest(_o.x, _o.y, _o.z, _f.x, _f.y, _f.z, range);
    if (!zh) {
      // «широкий» удар — ближайший зомби в конусе
      let best = null;
      for (const v of g.zviews.map.values()) {
        if (v.dead) continue;
        const cx = v.x - _o.x, cy = v.y + 1.1 * v.T.scale - _o.y, cz = v.z - _o.z;
        const d = Math.hypot(cx, cy, cz);
        if (d > range + 0.6 * v.T.scale) continue;
        const dot = (cx * _f.x + cy * _f.y + cz * _f.z) / (d || 1);
        if (dot > 0.82 && (!best || d < best.t)) best = { id: v.id, t: d, head: false };
      }
      zh = best;
    }
    const wh = g.physics.raycast(_o.x, _o.y, _o.z, _f.x, _f.y, _f.z, range);
    if (zh && (!wh || zh.t < wh.t + 0.3)) {
      const p = _o.clone().addScaledVector(_f, Math.min(zh.t, range));
      g.hitZombie(zh.id, def.dmg * P.perks.melee, false, p);
      g.sfx.hitFlesh(null);
      return;
    }
    if (!wh) return;
    if (wh.kind === 'tree' || wh.kind === 'rock' || wh.kind === 'ore' || wh.kind === 'bush') this.harvest(wh, def);
    else if (wh.kind === 'block') {
      if (def.repair) g.repairBlock(wh.c.ref);
      else g.damageBlock(wh.c.ref, def.dmg * 0.6);
      g.fx.impact(wh.x, wh.y, wh.z, 'block');
      g.sfx.hitWood(null);
    } else {
      g.fx.impact(wh.x, wh.y, wh.z, wh.kind);
      g.sfx.hitStone(null);
    }
  }

  // добыча: дерево → древесина, камень → камень, руда → железная руда, куст → волокно и ягоды
  harvest(wh, def) {
    const g = this.g, kind = wh.kind, id = wh.c.ref;
    const H = def.harvest || {};
    g.fx.impact(wh.x, wh.y, wh.z, kind === 'ore' ? 'rock' : kind === 'bush' ? 'tree' : kind);
    if (kind === 'tree' || kind === 'bush') g.sfx.hitWood(null); else g.sfx.hitStone(null);
    const gains = [];
    let amt = 1, max = 4;
    if (kind === 'tree') { amt = H.tree || 0; max = 12; if (amt) gains.push(['wood', amt]); }
    else if (kind === 'rock') {
      amt = H.rock || 0; max = 14;
      if (amt) gains.push(['stone', amt]);
      if (H.ore && Math.random() < 0.2) gains.push(['ore', 1]);
    } else if (kind === 'ore') { amt = H.ore || 0; max = 12; if (amt) gains.push(['ore', amt], ['stone', 1]); }
    else {
      gains.push(['fiber', 1 + (Math.random() < 0.5 ? 1 : 0)]);
      if (/^u/.test(id) && wh.c.berry !== false) {
        const bush = g.world.findBush(id);
        if (bush && bush.berry) gains.push(['berries', 1 + (Math.random() < 0.4 ? 1 : 0)]);
        if (Math.random() < 0.08) gains.push(['potato', 1]);
      }
    }
    if (!amt) { g.ui.toast(kind === 'tree' ? 'Этим не срубить дерево' : kind === 'ore' ? 'Руду добывают киркой' : 'Нужна кирка или кулаки'); return; }
    let full = false;
    for (const [it, n] of gains) {
      const left = g.inv.add(it, n);
      if (left) full = true; else g.ui.pickupNote(it, n);
      g.stat(it, n);
    }
    if (full) g.ui.toast('Инвентарь полон');
    g.addXP(1);
    const hits = (this.harvestHits.get(id) || 0) + amt;
    if (hits >= max) {
      this.harvestHits.delete(id);
      g.netDeplete(id);
      g.fx.burst(wh.x, wh.y, wh.z, 25, kind === 'tree' || kind === 'bush' ? 0x5a8a3a : 0x8a8a88, 4, 0.2, 1);
    } else this.harvestHits.set(id, hits);
  }

  startUse(def) {
    const P = this.g.player;
    if (def.cat === 'med' && P.hp >= P.maxHp - 0.5) { this.g.ui.toast('Здоровье и так полное'); return; }
    this.useT = this.useMax = def.use || 1;
    this.useIdx = P.sel;
  }

  finishUse(slot) {
    const g = this.g, P = g.player, def = ITEMS[slot.id];
    if (def.heal) P.hp = Math.min(P.maxHp, P.hp + def.heal);
    if (def.food) P.food = Math.max(0, Math.min(100, P.food + def.food));
    if (def.water) P.water = Math.max(0, Math.min(100, P.water + def.water));
    g.inv.takeSlot(P.sel, 1);
    g.sfx.eat();
    this.useT = 0;
  }

  updateBuild(def, slot) {
    const g = this.g, P = g.player, inp = g.input;
    this.camVectors();
    if (inp.pressed.has('KeyR')) this.buildRot = (this.buildRot + 1) & 3;
    const hit = g.physics.raycast(_o.x, _o.y, _o.z, _f.x, _f.y, _f.z, 7, { skip: c => c.kind === 'bush' || c.ghost });
    if (!hit) { g.blocks.hideGhost(); return; }
    const t = g.blocks.target(hit);
    if (!t) { g.blocks.hideGhost(); return; }
    const base = g.world.facingRot(_f.x, _f.z);
    const rot = (base + this.buildRot) & 3;
    const cx = t.i * 2 + 1, cz = t.j * 2 + 1;
    let ok = g.blocks.canPlace(t.i, t.j, t.y0) && Math.hypot(cx - _o.x, t.y0 + 1 - _o.y, cz - _o.z) < 7.5;
    if (ok && BLOCK_TYPES[def.block].shape !== 'spikes' && g.bodyInCell(t)) ok = false;
    g.blocks.showGhost(t, def.block, rot, ok);
    if (inp.lmb && this.cool <= 0 && ok) {
      this.cool = 0.25;
      g.placeBlock(t, def.block, rot);
      g.inv.takeSlot(P.sel, 1);
      this.swingT = 0.6;
    }
  }

  dismantle() {
    const g = this.g;
    this.camVectors();
    const hit = g.physics.raycast(_o.x, _o.y, _o.z, _f.x, _f.y, _f.z, 4, { noTerrain: true });
    if (!hit || hit.kind !== 'block') return;
    g.dismantleBlock(hit.c.ref);
  }

  // кулаки: стойка, поочерёдные прямые удары, покачивание при ходьбе и беге
  animateFists(dt, P, moving) {
    const p = this.swingT > 0 ? 1 - this.swingT : 1;
    let ext = 0;
    if (this.swingT > 0) ext = p < 0.22 ? easeOut(p / 0.22) : 1 - easeInOut((p - 0.22) / 0.78);
    const run = P.sprint ? 1 : 0;
    for (const f of this.fists) {
      const s = f.side;
      const active = s === this.punchSide;
      const e = active ? ext : 0;
      const back = active ? 0 : ext * 0.5;
      const bob = moving ? Math.sin(this.bobT + (s > 0 ? 0 : Math.PI)) : 0;
      let x = 0.2 * s, y = -0.215 + (s < 0 ? -0.012 : 0), z = -0.47;
      x += bob * 0.012 * (1 + run);
      y += Math.abs(bob) * 0.012 * (1 + run * 2) - run * 0.05;
      z += bob * 0.04 * run;
      // прямой удар: кулак уходит вперёд к центру экрана
      x -= s * 0.16 * e;
      y += 0.075 * e;
      z -= 0.3 * e;
      z += back * 0.06; y -= back * 0.02;
      f.g.position.set(x, y, z);
      f.g.rotation.set(0.12 + 0.2 * e - run * 0.2, s * (0.22 - 0.32 * e), s * (-0.12 + 0.25 * e));
    }
  }

  animate(dt, def, slot) {
    const g = this.g, P = g.player;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    const moving = hs > 0.5 && P.grounded;
    if (moving) this.bobT += dt * (P.sprint ? 11 : 7);
    const cat = def ? def.cat : 'fist';
    const ads = this.ads;
    let px = 0.22, py = -0.22, pz = -0.42, rx = 0, ry = 0, rz = 0;
    if (cat === 'gun') {
      px = 0.2 * (1 - ads); py = -0.2 * (1 - ads) - 0.1 * ads; pz = -0.42 * (1 - ads) - 0.3 * ads;
    } else if (cat === 'melee') {
      px = 0.3; py = -0.3; pz = -0.48; rx = 0.25; ry = 0.15;
    } else if (cat === 'fist') {
      px = 0.2; py = -0.26; pz = -0.4;
    } else if (cat === 'block') { px = 0.28; py = -0.28; pz = -0.5; ry = 0.6; }
    else { px = 0.26; py = -0.25; pz = -0.5; }
    const bob = 1 - ads * 0.9;
    px += Math.sin(this.bobT) * 0.012 * bob;
    py += Math.abs(Math.cos(this.bobT)) * 0.012 * bob;
    if (P.sprint && cat === 'gun') { rx -= 0.35; ry += 0.6; px -= 0.05; py -= 0.04; }
    // отдача
    this.recoil *= Math.exp(-dt * 14);
    pz += this.recoil * 0.06; rx += this.recoil * 0.12;
    // перезарядка
    if (this.reloadT > 0) {
      const p = 1 - this.reloadT / this.reloadMax;
      const k = Math.sin(p * Math.PI);
      py -= k * 0.16; rx -= k * 0.6; rz += k * 0.3;
    }
    // взмах оружием: замах вверх-вправо, удар по диагонали вниз-влево, возврат
    if (this.swingT > 0 && cat === 'melee') {
      const p = 1 - this.swingT;
      let a, b, c;
      if (p < 0.2) { a = easeOut(p / 0.2); b = 0; c = 0; }
      else if (p < 0.42) { a = 1; b = easeInOut((p - 0.2) / 0.22); c = 0; }
      else { a = 1; b = 1; c = easeInOut((p - 0.42) / 0.58); }
      const wx = 0.06 * a - 0.3 * b, wy = 0.1 * a - 0.22 * b, wz = 0.06 * a - 0.2 * b;
      const wrx = 0.6 * a - 1.85 * b, wry = 0.25 * b, wrz = -0.35 * a + 0.95 * b;
      const k = 1 - c;
      px += wx * k; py += wy * k; pz += wz * k;
      rx += wrx * k; ry += wry * k; rz += wrz * k;
    } else if (this.swingT > 0 && cat === 'block') {
      const p = 1 - this.swingT, k = Math.sin(p * Math.PI);
      rx -= k * 0.5; pz -= k * 0.1;
    }
    // еда
    if (this.useT > 0) {
      const p = 1 - this.useT / this.useMax;
      py += 0.1; px -= 0.12; pz += 0.1; rx += 0.4 + Math.sin(p * 30) * 0.05;
    }
    if (this.equipT > 0) py -= this.equipT * 0.8;
    if (this.fists) { this.animateFists(dt, P, moving); px = 0; py = this.equipT > 0 ? -this.equipT * 0.8 : 0; pz = 0; rx = ry = rz = 0; }
    this.hold.position.set(px, py, pz);
    this.hold.rotation.set(rx, ry, rz);
    this.cam.aspect = g.camera.aspect;
    this.cam.updateProjectionMatrix();
  }
}
