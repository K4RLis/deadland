// Игровая сессия: связывает мир, игрока, зомби, строительство, сеть и интерфейс.
// Хост — авторитетный: зомби, контейнеры, блоки и время суток живут у него.
import * as THREE from 'three';
import * as C from './config.js';
import { World } from './world.js';
import { Physics, rayBox } from './physics.js';
import { ChunkRenderer } from './chunks.js';
import { Blocks, BLOCK_TYPES, colliderBox, unpackBlock } from './blocks.js';
import { Fx } from './fx.js';
import { Player } from './player.js';
import { Inventory, HOTBAR, INV_SIZE, ARMOR_AT } from './inventory.js';
import { Weapons } from './weapons.js';
import { Rockets } from './rockets.js';
import { ZombieSim, ZombieViews, ZTYPES, ZT } from './zombies.js';
import { ITEMS, makeItem, rollLoot, xpNeed, QUESTS, STATION_NAMES, canMount, cleanHeld, heldBase } from './items.js';
import { makePlayerModel, animate, makeNameTag, itemModel, makeBag, FITTED_GUNS, GUN_K } from './models.js';
import { smooth, clamp, angleLerp } from './rng.js';
import { MeshBuilder, lin, mat } from './mesh.js';

export const SAVE = 'mkrai:';

export function hordeAt(day, t) {
  return (t > 0.86 && day % C.HORDE_EVERY === 0) || (t < 0.2 && day > 1 && (day - 1) % C.HORDE_EVERY === 0);
}

function nextFrame() {
  return new Promise(r => {
    let done = false;
    const f = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(f);
    setTimeout(f, 60);
  });
}

const TOOLS = new Set(['axe', 'pickaxe', 'iaxe', 'ipick']);

// набор тестового мира
const TEST_KIT = ['pistol', 'smg', 'shotgun', 'rifle', 'qbz', 'asval', 'sniper', 'rpg', 'iaxe', 'ipick'];
const BLAST_R = 7; // радиус поражения гранаты РПГ, м
const TEST_ARMOR = ['helmet', 'milvest', 'kneepads'];
const TEST_SIGHTS = ['reddot', 'scope2', 'scope4'];

export class Game {
  constructor(o) {
    this.o = o;
    this.level = o.level; this.seed = o.seed;
    this.settings = o.settings; this.renderer = o.renderer;
    this.input = o.input; this.ui = o.ui; this.sfx = o.sfx; this.icons = o.icons;
    this.net = o.net; this.mode = o.mode;
    this.isHost = o.mode !== 'client'; this.solo = o.mode === 'solo';
    this.code = o.code || '';
    this.myName = o.name; this.myColor = o.color;
    this.myId = this.isHost ? 1 : o.welcome.id;
    this.roster = new Map();
    this.roster.set(this.myId, { name: this.myName, color: this.myColor });
    this.time = 0; this.dayTime = 0.3; this.day = 1; this.hordeActive = false;
    this.running = true;
    this.onQuit = o.onQuit;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.08, 1600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.setupSky();

    this.world = new World(this.level, this.seed);
    this.physics = new Physics(this.world);
    this.world.onChunk = d => { for (const c of d.colliders) this.physics.add(c); };
    this.fx = new Fx(this.scene);
    this.blocks = new Blocks(this);
    this.chunks = new ChunkRenderer(this);
    this.player = new Player(this);
    this.inv = new Inventory();
    this.weapons = new Weapons(this);
    this.rockets = new Rockets(this);
    this.zviews = new ZombieViews(this);
    this.zsim = this.isHost ? new ZombieSim(this) : null;
    this.others = new Map();
    this.hplayers = new Map();
    this.drops = new Map();
    this.store = new Map();
    this.openedOnce = new Set();
    this.nextDrop = 1;
    this.sendT = 0; this.snapT = 0; this.saveT = 45; this.hpFlushT = 0; this.dropGcT = 10;
    this.dirtyHp = new Set();
    this.flashOn = false;
    this.focus = null;
    this.lastDay = 0;
    for (const c of this.world.crashSites) this.fx.addSmoke(c.x, this.world.rawHeight(c.x, c.z) + 1.5, c.z);
  }

  // ---------- небо, свет, вода ----------
  setupSky() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a4a3a, 1.3);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sun.castShadow = this.settings.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 500;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    s.add(this.sun); s.add(this.sun.target);
    this.moon = new THREE.DirectionalLight(0x8aa4d8, 0);
    s.add(this.moon); s.add(this.moon.target);
    s.fog = new THREE.Fog(0x9fcff0, 120, 420);
    this.flash = new THREE.SpotLight(0xfff1d8, 0, 55, 0.5, 0.45, 1.1);
    this.flash.position.set(0.25, -0.15, 0);
    this.camera.add(this.flash);
    this.flash.target.position.set(0.1, -0.3, -6);
    this.camera.add(this.flash.target);
    const wc = C.WATER_COLOR;
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200, 1, 1), new THREE.MeshLambertMaterial({ color: wc, transparent: true, opacity: 0.82 }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = C.SEA - 0.25;
    s.add(this.water);
    // гранёные волны вокруг игрока (плоское затенение — каждый треугольник бликует отдельно);
    // высоту волн считает вершинный шейдер, процессор их не трогает
    const wg = new THREE.PlaneGeometry(640, 640, 128, 128);
    wg.rotateX(-Math.PI / 2);
    const wm = new THREE.MeshPhongMaterial({ color: wc, transparent: true, opacity: 0.84, flatShading: true, shininess: 80, specular: 0x5a7a9a });
    this.waveT = { value: 0 };
    wm.onBeforeCompile = sh => {
      sh.uniforms.uWaveT = this.waveT;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWaveT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
            transformed.y += sin(wp.x * 0.21 + uWaveT * 1.6) * 0.13 + sin(wp.z * 0.17 + uWaveT * 1.25) * 0.11 + sin((wp.x + wp.z) * 0.33 + uWaveT * 2.1) * 0.05;
          }`);
    };
    this.waves = new THREE.Mesh(wg, wm);
    this.waves.position.y = C.SEA;
    this.waves.frustumCulled = false;
    s.add(this.waves);
    const N = 1400, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(a) * 1000; pos[i * 3 + 1] = Math.abs(u) * 1000 + 30; pos[i * 3 + 2] = r * Math.sin(a) * 1000;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false }));
    s.add(this.stars);
    // низкополигональные солнце и луна
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(40, 8), new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog: false }));
    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(26, 7), new THREE.MeshBasicMaterial({ color: 0xdfe6f0, fog: false }));
    s.add(this.sunDisc); s.add(this.moonDisc);
    this.skyCol = new THREE.Color();
    this._c1 = new THREE.Color(); this._c2 = new THREE.Color();
    // гранёный небесный купол: цвет каждого треугольника считается от высоты и направления на солнце
    const dg = new THREE.IcosahedronGeometry(1000, 9);
    dg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(dg.attributes.position.count * 3), 3));
    this.dome = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.dome.renderOrder = -10;
    s.add(this.dome);
    this.domeT = 0;
    // облака из полигонов: одна плитка 1200×1200 м, 3×3 копии вокруг игрока
    const cb = new MeshBuilder(0.1);
    let sd = 991;
    const rnd = () => { sd = (Math.imul(sd, 1103515245) + 12345) | 0; return ((sd >>> 8) & 0xffff) / 0xffff; };
    const cloudGeo = [0, 1, 2].map(k => new THREE.IcosahedronGeometry(1, 4));
    for (let i = 0; i < 16; i++) {
      const cx = rnd() * 1200 - 600, cz = rnd() * 1200 - 600, cy = 190 + rnd() * 50;
      const n = 4 + Math.floor(rnd() * 5), size = 18 + rnd() * 22;
      for (let k = 0; k < n; k++) {
        const ox = (rnd() - 0.5) * size * 2.2, oz = (rnd() - 0.5) * size * 1.2, r = size * (0.5 + rnd() * 0.6);
        cb.geo(cloudGeo[k % 3], mat(cx + ox, cy + rnd() * 6, cz + oz, 0, rnd() * 6, 0, r, r * 0.42, r * 0.8), lin(0xffffff));
      }
    }
    const cgeo = cb.build();
    this.cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });
    this.clouds = [];
    for (let k = 0; k < 9; k++) {
      const m = new THREE.Mesh(cgeo, this.cloudMat);
      m.renderOrder = -5;
      s.add(m);
      this.clouds.push(m);
    }
    this._sd = new THREE.Vector3(); this._hz = new THREE.Color(); this._zn = new THREE.Color(); this._gl = new THREE.Color(); this._tc = new THREE.Color();
  }

  updateWaves(cp) {
    const wx = Math.round(cp.x / 10) * 10, wz = Math.round(cp.z / 10) * 10;
    this.waves.position.x = wx; this.waves.position.z = wz;
    this.waveT.value = this.time;
  }

  // угол солнца: день (рассвет..закат) — половина круга, ночь — вторая половина
  sunAngle(t) {
    const D0 = C.SUNRISE, D1 = C.SUNSET;
    if (t >= D0 && t <= D1) return (t - D0) / (D1 - D0) * Math.PI;
    const n = (t - D1 + 1) % 1;
    return Math.PI + n / (1 - (D1 - D0)) * Math.PI;
  }

  isNight() { return this.dayTime < C.SUNRISE - 0.015 || this.dayTime > C.SUNSET + 0.015; }

  // смесь параметров биомов в точке × сложность мира
  zParams(x, z) {
    const w = this.world.biomeW(x, z, this._zw || (this._zw = {}));
    const d = this.level.diff.zombie, out = {};
    for (const k of ['count', 'hp', 'dmg', 'speed', 'runner', 'tank', 'soldier']) {
      out[k] = C.BIOMES.forest.zombie[k] * w.forest + C.BIOMES.desert.zombie[k] * w.desert + C.BIOMES.snow.zombie[k] * w.snow;
      if (d[k]) out[k] *= d[k];
    }
    return out;
  }

  lootMul(x, z) {
    const w = this.world.biomeW(x, z, this._lw || (this._lw = {}));
    return (C.BIOMES.forest.loot * w.forest + C.BIOMES.desert.loot * w.desert + C.BIOMES.snow.loot * w.snow) * this.level.diff.loot;
  }

  biomeHere() { return this.world.biomeAt(this.player.pos.x, this.player.pos.z); }
  now() { return this.day + this.dayTime; }

  updateSky() {
    const t = this.dayTime;
    const ang = this.sunAngle(t);
    const sy = Math.sin(ang), sx = Math.cos(ang);
    const day = smooth(-0.08, 0.2, sy);
    const dusk = Math.max(0, 1 - Math.abs(sy - 0.03) / 0.25);
    const cp = this.camera.position;
    // цвета неба — смесь биомов вокруг игрока
    const bw = this.world.biomeW(cp.x, cp.z, this._sbw || (this._sbw = {}));
    const mix = (key, out) => {
      out.setRGB(0, 0, 0);
      for (const b of C.BIOME_IDS) { this._tc.setHex(C.BIOMES[b].sky[key]); out.r += this._tc.r * bw[b]; out.g += this._tc.g * bw[b]; out.b += this._tc.b * bw[b]; }
      return out;
    };
    const hz = this._hz, zn = this._zn, gl = this._gl;
    mix('night', hz);
    hz.lerp(mix('day', this._c1), day);
    hz.lerp(mix('dusk', this._c2), dusk * 0.6);
    zn.copy(mix('night', this._c1)).multiplyScalar(0.6);
    zn.lerp(mix('zenith', this._c2), day);
    gl.copy(mix('dusk', this._c1));
    if (this.hordeActive) { hz.lerp(this._c1.setHex(0x5a0a08), 0.55); zn.lerp(this._c1.setHex(0x2a0404), 0.6); gl.setHex(0xd02010); }
    const underwater = cp.y < C.SEA - 0.1;
    const c = this.skyCol.copy(hz);
    if (underwater) c.setHex(0x1a4a6a);
    this.scene.background = c;
    this.scene.fog.color.copy(c);
    const far = this.settings.view * C.CHUNK * 0.98;
    this.scene.fog.far = underwater ? 30 : far * (0.72 + day * 0.28);
    this.scene.fog.near = underwater ? 2 : far * 0.3;
    // купол
    this.dome.position.copy(cp);
    this.domeT -= 1;
    if (this.domeT <= 0) {
      this.domeT = 6;
      const sd = this._sd.set(sx, sy, 0.35).normalize();
      const pos = this.dome.geometry.attributes.position, col = this.dome.geometry.attributes.color;
      const pa = pos.array, ca = col.array;
      for (let i = 0; i < pa.length; i += 9) {
        const x = (pa[i] + pa[i + 3] + pa[i + 6]) / 3000, y = (pa[i + 1] + pa[i + 4] + pa[i + 7]) / 3000, z = (pa[i + 2] + pa[i + 5] + pa[i + 8]) / 3000;
        const l = Math.hypot(x, y, z) || 1;
        const h = y / l;
        const k = smooth(0.0, 0.65, h);
        let r = hz.r + (zn.r - hz.r) * k, g = hz.g + (zn.g - hz.g) * k, bl = hz.b + (zn.b - hz.b) * k;
        // свечение у солнца на рассвете и закате
        const dd = Math.max(0, (x * sd.x + y * sd.y + z * sd.z) / l);
        const glow = Math.pow(dd, 6) * (0.25 + dusk * 0.9) * (sy > -0.2 ? 1 : 0);
        r += (gl.r - r) * Math.min(1, glow); g += (gl.g - g) * Math.min(1, glow); bl += (gl.b - bl) * Math.min(1, glow);
        if (h < 0) { r *= 0.85; g *= 0.85; bl *= 0.85; }
        for (let v = 0; v < 3; v++) { ca[i + v * 3] = r; ca[i + v * 3 + 1] = g; ca[i + v * 3 + 2] = bl; }
      }
      col.needsUpdate = true;
    }
    // облака плывут по ветру
    const T = 1200, drift = this.time * 3.5;
    const ox = Math.floor((cp.x - drift) / T) * T + drift, oz = Math.floor(cp.z / T) * T;
    let k = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) this.clouds[k++].position.set(ox + i * T + T / 2, 0, oz + j * T + T / 2);
    this.cloudMat.opacity = 0.55 + 0.37 * day;
    const p = this.player.pos;
    const dir = this._sd.set(sx, Math.max(0.08, sy), 0.35).normalize();
    this.sun.position.set(p.x + dir.x * 160, p.y + dir.y * 160, p.z + dir.z * 160);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.intensity = 2.7 * day;
    this.sun.color.setHex(dusk > 0.45 ? 0xffb878 : 0xfff2dd);
    this.sun.castShadow = this.settings.shadows && day > 0.05;
    this.moon.position.set(p.x - dir.x * 160, p.y + Math.max(0.3, -sy) * 160, p.z - dir.z * 160);
    this.moon.target.position.set(p.x, p.y, p.z);
    this.moon.intensity = 0.5 * (1 - day);
    this.hemi.intensity = 0.28 + 1.2 * day;
    this.hemi.color.setHex(this.hordeActive ? 0xff9a90 : dusk > 0.5 ? 0xffd8b8 : 0xcfe6ff);
    this.stars.position.copy(cp);
    this.stars.material.opacity = Math.max(0, 1 - day * 1.6) * (this.hordeActive ? 0.4 : 1);
    this.sunDisc.position.set(cp.x + sx * 900, cp.y + sy * 900, cp.z + 0.35 * 900);
    this.sunDisc.lookAt(cp);
    this.sunDisc.visible = sy > -0.1;
    this.sunDisc.material.color.setHex(dusk > 0.5 ? 0xffc080 : 0xfff2c8);
    this.moonDisc.position.set(cp.x - sx * 900, cp.y - sy * 900, cp.z - 0.35 * 900);
    this.moonDisc.lookAt(cp);
    this.moonDisc.visible = sy < 0.1;
    this.moonDisc.material.color.setHex(this.hordeActive ? 0xd03020 : 0xdfe6f0);
    this.water.position.x = Math.round(cp.x / 40) * 40;
    this.water.position.z = Math.round(cp.z / 40) * 40;
    this.updateWaves(cp);
    this.flash.intensity = this.flashOn && this.player.alive ? 70 : 0;
    this.weapons.hemi.intensity = 0.3 + 1.3 * day + (this.flashOn ? 0.5 : 0);
    this.weapons.sun.intensity = 0.2 + 1.85 * day;
    this.sfx.setWind(0.02 + (1 - day) * 0.02 + bw.snow * 0.035);
  }


  // ---------- запуск ----------
  async init(progress) {
    const P = this.player;
    if (this.isHost) this.loadWorld();
    else {
      const w = this.o.welcome;
      this.dayTime = w.tm; this.day = w.d; this.hordeActive = !!w.h;
      for (const [pid, name, color] of w.roster) this.roster.set(pid, { name, color });
      for (const d of w.drops || []) this.addDropView(d[0], d[1], d[2], d[3]);
      this.net.onClientMsg = m => this.clientHandle(m);
      this.net.onHostLost = () => this.hostLost();
      this.net.drain();
    }
    if (this.isHost && this.net) {
      this.net.onHostMsg = (pid, m) => this.hostHandle(pid, m);
      this.net.onJoin = (pid, hello) => this.playerJoined(pid, hello);
      this.net.onLeave = pid => this.playerLeft(pid);
    }
    const ps = this.loadPlayer();
    if (!ps) {
      const s = this.findSpawn();
      P.spawnAt(s.x, s.y, s.z, s.yaw);
      // стартовый набор — в рюкзак, чтобы в руках были кулаки
      for (const [id, n] of [['bandage', 2], ['water', 1], ['can', 1], ['b_torch', 2]]) this.inv.addItem(makeItem(id, n), false);
    }
    if (this.level.test) this.giveTestKit();
    this.lastDay = this.day;
    this.world.ensureAround(P.pos.x, P.pos.z, 1);
    this.chunks.update(P.pos.x, P.pos.z, false);
    const total = Math.max(1, this.chunks.pending());
    while (this.chunks.pending() > 0) {
      const t0 = performance.now();
      while (this.chunks.pending() > 0 && performance.now() - t0 < 40) this.chunks.update(P.pos.x, P.pos.z, false);
      progress(1 - this.chunks.pending() / total, 'Строим окрестности… осталось чанков: ' + this.chunks.pending());
      await nextFrame();
    }
    this.blocks.flush();
    this.startMapImage();
    this.ui.attach(this);
    this.applySettings('all');
    if (this.isHost && !this.solo) this.ui.feed(`Комната открыта. Код: <b>${this.code}</b>`);
    this.ui.toast(this.level.name + ' — день ' + this.day);
    this.ui.feed('Чат — <b>Enter</b>' + (this.level.test ? ', команды — через <b>/</b> в чате или в консоли (<b>Ё</b>): <b>/help</b>, <b>/tp</b>, <b>/boss</b>…; двойной клик по карте — телепорт' : ''));
  }

  // появление на пляже: сначала лесные берега (там безопаснее), потом пустынные; лицом к острову
  findSpawn() {
    const w = this.world;
    const pool = w.spawns.filter(s => s.biome === 'forest');
    const list = pool.length >= 4 ? pool : w.spawns.filter(s => s.biome !== 'snow').concat(pool);
    const from = list.length ? list : w.spawns;
    for (let k = 0; k < 40; k++) {
      const s = from[Math.floor(Math.random() * from.length)];
      const x = s.x + (Math.random() - 0.5) * 8, z = s.z + (Math.random() - 0.5) * 8;
      w.ensureAround(x, z, 1);
      const y = w.height(x, z);
      if (y < 0.4) continue;
      if (k < 30 && w.normalY(x, z) < 0.8) continue;
      if (!this.physics.free(x, y, z, 0.6, 1.9)) continue;
      return { x, y: y + 0.1, z, yaw: Math.atan2(x, z) };
    }
    const s = from[0];
    return { x: s.x, y: Math.max(w.height(s.x, s.z), 0) + 2, z: s.z, yaw: Math.atan2(s.x, s.z) };
  }

  applySettings(k) {
    const s = this.settings, r = this.renderer;
    if (k === 'all' || k === 'scale') { r.setPixelRatio(Math.min(2, devicePixelRatio || 1) * s.scale); r.setSize(innerWidth, innerHeight); }
    if (k === 'all' || k === 'view') this.chunks.update(this.player.pos.x, this.player.pos.z, true);
    if (k === 'all' || k === 'volume') this.sfx.setVolume(s.volume);
    if (k === 'all' || k === 'fov') { this.camera.fov = s.fov; this.camera.updateProjectionMatrix(); }
    if (this.o.onSettings) this.o.onSettings();
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  // ---------- кадр ----------
  frame(dt, render = true) {
    if (!this.running) return;
    // в одиночной игре пауза останавливает мир
    if (this.solo && (this.ui.panel === 'pause' || this.ui.panel === 'victory')) { if (render) this.render(); return; }
    this.time += dt;
    this.handleKeys();
    this.updateTime(dt);
    this.player.update(dt);
    this.weapons.update(dt);
    this.rockets.update(dt);
    this.player.updateCamera(this.camera);
    const cp = this.camera.position;
    this.sfx.listener(cp.x, cp.y, cp.z, this.player.yaw);
    this.updateInteract();
    if (this.isHost) this.hostUpdate(dt);
    else this.clientUpdate(dt);
    this.zviews.update(dt);
    this.updateOthers(dt);
    this.blocks.update(dt, cp);
    this.fx.update(dt, cp);
    this.chunks.update(this.player.pos.x, this.player.pos.z, false);
    this.updateSky();
    this.stepMapImage(3);
    if (this.day !== this.lastDay) this.onNewDay();
    if (!render) return;
    this.ui.update(dt);
    this.render();
  }

  render() {
    const r = this.renderer;
    r.autoClear = true;
    r.render(this.scene, this.camera);
    if (this.weapons.root.visible) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.weapons.scene, this.weapons.cam);
    }
  }

  handleKeys() {
    const inp = this.input, ui = this.ui, P = this.player;
    ui.handleKeys(inp.pressed);
    if (!ui.captured || ui.typing || ui.panel) return;
    for (let i = 0; i < 8; i++) if (inp.pressed.has('Digit' + (i + 1))) this.select(i);
    if (inp.wheel) this.select((P.sel + inp.wheel + 8) % 8);
    if (inp.pressed.has('KeyF')) { this.flashOn = !this.flashOn; this.sfx.click(); }
    if (inp.pressed.has('KeyE') && this.focus) this.act(this.focus);
    if (inp.pressed.has('KeyQ')) this.dropFromInv(P.sel);
  }

  select(i) {
    if (this.player.sel === i) return;
    this.player.sel = i;
    this.weapons.buildRot = 0;
    this.ui.dirtyHud = true;
  }

  updateTime(dt) {
    const prev = this.dayTime;
    this.dayTime += dt / C.DAY_SECONDS;
    if (this.dayTime >= 1) { this.dayTime -= 1; if (this.isHost) this.day++; }
    if (!this.isHost) return;
    const h = hordeAt(this.day, this.dayTime);
    if (h !== this.hordeActive) {
      this.hordeActive = h;
      this.broadcastAll({ t: 'horde', on: h ? 1 : 0 });
    }
    if (this.day % C.HORDE_EVERY === 0 && prev < 0.5 && this.dayTime >= 0.5) this.broadcastAll({ t: 'note', text: 'Сегодня ночью кровавая луна. Готовьте базу!', big: 1 });
  }

  onNewDay() {
    this.lastDay = this.day;
    if (this.player.alive) {
      this.setStat('day', this.day);
      const key = SAVE + 'record:' + this.level.id;
      const rec = +(localStorage.getItem(key) || 0);
      if (this.day > rec) { try { localStorage.setItem(key, String(this.day)); } catch (_) { /* ignore */ } }
    }
    this.ui.toast('Наступил день ' + this.day);
    this.saveAll(false);
  }

  // автосохранение каждые 30 с, на рассвете, при сворачивании вкладки и выходе
  saveAll(manual) {
    this.saveT = 30;
    const ok = this.savePlayer() && (!this.isHost || this.saveWorld());
    if (!ok) this.ui.toast('Не удалось сохранить: в браузере закончилось место');
    else this.ui.savedNote(this.isHost ? (manual ? 'Мир сохранён' : 'Автосохранение мира') : 'Персонаж сохранён');
    return ok;
  }

  // ---------- задания и статистика ----------
  stat(k, n = 1) {
    const S = this.player.stats;
    S[k] = (S[k] || 0) + n;
    this.checkQuests();
  }

  setStat(k, v) {
    const S = this.player.stats;
    S[k] = Math.max(S[k] || 0, v);
    this.checkQuests();
  }

  quest() { return QUESTS[this.player.quest] || null; }

  checkQuests() {
    const P = this.player;
    for (let guard = 0; guard < QUESTS.length; guard++) {
      const q = QUESTS[P.quest];
      if (!q || (P.stats[q.stat] || 0) < q.need) return;
      P.quest++;
      this.ui.toast('Задание выполнено: ' + q.text + ' (+' + q.xp + ' опыта)', true);
      this.sfx.levelUp();
      this.addXP(q.xp);
    }
  }

  // ---------- сеть: общие ----------
  toHost(m) {
    if (this.isHost) this.hostHandle(this.myId, m);
    else this.net.toHost(m);
  }

  sendTo(pid, m) {
    if (pid === this.myId) this.clientHandle(m);
    else if (this.net) this.net.send(pid, m);
  }

  broadcastAll(m, except) {
    if (this.net && this.net.isHost) for (const pid of this.net.conns.keys()) if (pid !== except) this.net.send(pid, m);
    if (except !== this.myId) this.clientHandle(m);
  }

  // ---------- хост ----------
  playerJoined(pid, hello) {
    const name = String(hello.name || 'Игрок').slice(0, 16).replace(/[<>]/g, '') || 'Игрок';
    const color = Number(hello.color) || 0x888888;
    this.roster.set(pid, { name, color });
    this.hplayers.set(pid, { pid, name, color, x: 0, y: -999, z: 0, yaw: 0, pitch: 0, w: '', f: 0, hp: 100, alive: false });
    const drops = [];
    for (const d of this.drops.values()) drops.push([d.id, d.x, d.y, d.z]);
    this.net.send(pid, {
      t: 'welcome', id: pid, level: this.level.id, diff: this.level.diff.id, test: !!this.level.test, seed: this.seed, code: this.code,
      tm: this.dayTime, d: this.day, h: this.hordeActive ? 1 : 0,
      roster: [...this.roster].map(([p, r]) => [p, r.name, r.color]), drops, ver: C.VERSION,
    });
    const bl = this.blocks.serialize();
    for (let i = 0; i < bl.length; i += 300) this.net.send(pid, { t: 'wb', b: bl.slice(i, i + 300) });
    const dep = [...this.world.depleted];
    for (let i = 0; i < dep.length; i += 800) this.net.send(pid, { t: 'wd', d: dep.slice(i, i + 800) });
    this.broadcastAll({ t: 'pjoin', pid, name, color }, pid);
  }

  playerLeft(pid) {
    const r = this.roster.get(pid);
    this.hplayers.delete(pid);
    for (const c of this.store.values()) c.viewers && c.viewers.delete(pid);
    if (r) this.broadcastAll({ t: 'pleave', pid });
  }

  hostAlivePlayers() {
    const out = [];
    const P = this.player;
    if (P.alive) out.push({ pid: this.myId, x: P.pos.x, y: P.pos.y, z: P.pos.z, yaw: P.yaw, crouch: P.crouch, sprint: P.sprint });
    for (const p of this.hplayers.values()) if (p.alive && p.y > -500) out.push({ pid: p.pid, x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: !!(p.f & 1), sprint: !!(p.f & 4) });
    return out;
  }

  hostPlayerPos(pid) {
    if (pid === this.myId) return this.player.alive ? this.player.pos : null;
    const p = this.hplayers.get(pid);
    return p && p.alive && p.y > -500 ? p : null;
  }

  hostUpdate(dt) {
    const players = this.hostAlivePlayers();
    for (const p of players) if (p.pid !== this.myId) this.world.ensureAround(p.x, p.z, 1);
    this.zsim.update(dt, players);
    for (const z of this.zsim.list) this.zviews.sync(z.id, z.ti, z.pos.x, z.pos.y, z.pos.z, z.yaw, z.anim | 0, z.hp / z.maxHp, true);
    this.snapT -= dt;
    if (this.snapT <= 0 && this.net && this.net.conns.size) {
      this.snapT = 0.1;
      const P = this.player;
      const all = [[this.myId, +P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2), +P.yaw.toFixed(3), +P.pitch.toFixed(2), this.weapons.lookKey, this.myFlags(), Math.round(P.hp), this.armorLook()]];
      for (const p of this.hplayers.values()) if (p.y > -500) all.push([p.pid, p.x, p.y, p.z, p.yaw, p.pitch, p.w, p.f, p.hp, p.ar || '']);
      for (const pid of this.net.conns.keys()) {
        const me = this.hplayers.get(pid);
        const zs = [];
        for (const z of this.zsim.list) {
          if (me && (z.pos.x - me.x) ** 2 + (z.pos.z - me.z) ** 2 > 200 * 200) continue;
          zs.push([z.id, z.ti, +z.pos.x.toFixed(2), +z.pos.y.toFixed(2), +z.pos.z.toFixed(2), +z.yaw.toFixed(2), z.anim | 0, Math.round(z.hp / z.maxHp * 100)]);
        }
        this.net.send(pid, { t: 'snap', z: zs, p: all.filter(a => a[0] !== pid), tm: +this.dayTime.toFixed(5), d: this.day, h: this.hordeActive ? 1 : 0 });
      }
    }
    this.hpFlushT -= dt;
    if (this.hpFlushT <= 0 && this.dirtyHp.size) {
      this.hpFlushT = 0.3;
      const list = [];
      for (const k of this.dirtyHp) { const b = this.blocks.byKey.get(k); if (b) list.push([k, Math.round(b.hp)]); }
      this.dirtyHp.clear();
      if (list.length) this.broadcastAll({ t: 'bHp', l: list }, this.myId);
    }
    this.dropGcT -= dt;
    if (this.dropGcT <= 0) {
      this.dropGcT = 15;
      for (const [cid, c] of this.store) if (c.zombie && this.time - c.t > 420) { this.store.delete(cid); this.broadcastAll({ t: 'dDel', id: +cid.slice(1) }); }
    }
    this.saveT -= dt;
    if (this.saveT <= 0) this.saveAll(false);
  }

  myFlags() {
    const P = this.player;
    return (P.crouch ? 1 : 0) | (P.alive ? 0 : 2) | (P.sprint ? 4 : 0) | (this.flashOn ? 8 : 0) | (this.weapons.swingT > 0.35 ? 16 : 0);
  }

  hostHandle(pid, m) {
    if (!m || typeof m.t !== 'string') return;
    const hp = this.hplayers.get(pid);
    const pname = () => (this.roster.get(pid) || {}).name || '';
    switch (m.t) {
      case 'st':
        if (!hp || !Array.isArray(m.p)) return;
        hp.x = +m.p[0]; hp.y = +m.p[1]; hp.z = +m.p[2]; hp.yaw = +m.p[3]; hp.pitch = +m.p[4];
        hp.w = cleanHeld(m.w); hp.f = m.f | 0; hp.hp = m.hp | 0;
        hp.ar = typeof m.ar === 'string' ? m.ar.slice(0, 60) : '';
        hp.alive = !(hp.f & 2);
        this.syncOther([pid, hp.x, hp.y, hp.z, hp.yaw, hp.pitch, hp.w, hp.f, hp.hp, hp.ar]);
        break;
      case 'hitZ': {
        const z = this.zsim.damage(m.id, Math.min(400, +m.d || 0), pid);
        if (z) this.killZombie(z, pid);
        break;
      }
      case 'shot': {
        const o = m.o;
        if (!Array.isArray(o)) return;
        const r = m.w === 'asval' ? 22 : m.w === 'sniper' ? 130 : m.w === 'pistol' ? 70 : m.w === 'shotgun' ? 90 : 100;
        this.zsim.noise(o[0], o[1], o[2], r, pid);
        this.broadcastAll({ t: 'shot', pid, o: m.o, e: m.e, w: m.w }, pid);
        break;
      }
      case 'rk': {
        const o = m.o, v = m.v;
        if (!Array.isArray(o) || !Array.isArray(v) || o.length !== 3 || v.length !== 3 || ![...o, ...v].every(Number.isFinite)) return;
        this.zsim.noise(o[0], o[1], o[2], 110, pid);
        this.broadcastAll({ t: 'rk', pid, id: String(m.id).slice(0, 40), o, v }, pid);
        break;
      }
      case 'boom': {
        const p = m.p;
        if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) return;
        this.blastHost(pid, p[0], p[1], p[2], m.z | 0, clamp(+m.k || 1, 1, 2.5));
        this.broadcastAll({ t: 'boom', pid, id: String(m.id).slice(0, 40), p }, pid);
        break;
      }
      case 'bPlace': {
        const T = BLOCK_TYPES[m.type];
        if (!T) return;
        if (!this.blocks.canPlace(m.i | 0, m.j | 0, +m.y0)) { this.sendTo(pid, { t: 'give', id: T.item, n: 1 }); return; }
        this.broadcastAll({ t: 'bSet', b: { i: m.i | 0, j: m.j | 0, y0: Math.round(+m.y0 * 4) / 4, type: m.type, rot: m.rot & 3, hp: T.hp, open: false, owner: pname(), pt: m.type === 'farm' ? this.now() : null } });
        break;
      }
      case 'bHit': {
        const b = this.blocks.byKey.get(m.key);
        if (b) this.damageBlockHost(b, Math.min(200, +m.d || 0));
        break;
      }
      case 'bRepair': {
        const b = this.blocks.byKey.get(m.key);
        if (!b) return;
        const max = BLOCK_TYPES[b.type].hp;
        b.hp = Math.min(max, b.hp + max * 0.25);
        this.blocks.setHp(b.key, b.hp);
        this.dirtyHp.add(b.key);
        break;
      }
      case 'bDel': {
        const b = this.blocks.byKey.get(m.key);
        if (!b) return;
        if (b.owner && b.owner !== pname()) { this.sendTo(pid, { t: 'note', text: 'Это блок игрока ' + b.owner }); return; }
        this.removeBlockHost(b, false);
        this.sendTo(pid, { t: 'give', id: BLOCK_TYPES[b.type].item, n: 1 });
        break;
      }
      case 'bDoor': {
        const b = this.blocks.byKey.get(m.key);
        if (b && BLOCK_TYPES[b.type].shape === 'door') this.broadcastAll({ t: 'bDoor', key: b.key, open: b.open ? 0 : 1 });
        break;
      }
      case 'harvest': {
        const b = this.blocks.byKey.get(m.key);
        if (!b || b.type !== 'farm' || b.pt == null || this.blocks.growth(b, this.now()) < 1) return;
        this.sendTo(pid, { t: 'give', id: 'potato', n: 3 + (Math.random() < 0.4 ? 1 : 0), stat: 'harvest' });
        this.sendTo(pid, { t: 'give', id: 'fiber', n: 1 });
        this.broadcastAll({ t: 'bPt', key: b.key, pt: this.now() });
        break;
      }
      case 'cOpen': {
        const c = this.getStore(m.cid);
        if (!c) return;
        c.viewers.add(pid);
        this.sendTo(pid, { t: 'cData', cid: m.cid, items: c.items, name: c.name, open: 1 });
        break;
      }
      case 'cClose': { const c = this.store.get(m.cid); if (c) c.viewers.delete(pid); break; }
      case 'cTake': {
        const c = this.store.get(m.cid);
        if (!c) return;
        let k = m.i | 0;
        if (!c.items[k] || c.items[k].id !== m.id) k = c.items.findIndex(it => it && it.id === m.id);
        if (k < 0) return;
        const [it] = c.items.splice(k, 1);
        this.sendTo(pid, { t: 'cGot', item: it });
        this.contChanged(m.cid, c);
        break;
      }
      case 'cPut': {
        const c = this.getStore(m.cid);
        const it = m.item;
        if (!it || !ITEMS[it.id]) return;
        if (!c) { this.sendTo(pid, { t: 'cRet', item: it }); return; }
        const st = ITEMS[it.id].stack;
        let n = it.n | 0;
        if (st > 1) for (const s of c.items) { if (n <= 0) break; if (s.id === it.id && s.n < st) { const k = Math.min(n, st - s.n); s.n += k; n -= k; } }
        if (n > 0) {
          if (c.items.length >= c.cap) this.sendTo(pid, { t: 'cRet', item: { ...it, n } });
          else c.items.push({ ...it, n });
        }
        this.contChanged(m.cid, c);
        break;
      }
      case 'drop': {
        if (!Array.isArray(m.items) || !Array.isArray(m.p)) return;
        const items = m.items.filter(it => it && ITEMS[it.id] && it.n > 0);
        if (items.length) this.hostDrop(m.p[0], m.p[1], m.p[2], items, m.death ? 'Рюкзак: ' + pname() : 'Выброшенные вещи', false);
        break;
      }
      case 'node':
        if (typeof m.id === 'string' && !this.world.depleted.has(m.id)) this.broadcastAll({ t: 'node', id: m.id });
        break;
      case 'chat': {
        const r = this.roster.get(pid) || { name: '?', color: 0xffffff };
        const text = String(m.text || '').slice(0, 120);
        if (text) this.broadcastAll({ t: 'chat', name: r.name, color: r.color, text });
        break;
      }
      case 'dead': {
        if (hp) hp.alive = false;
        this.broadcastAll({ t: 'feed', html: `☠ <b>${escapeHtml(pname() || '?')}</b> погиб` });
        break;
      }
      case 'respawn': if (hp) hp.alive = true; break;
    }
  }

  killZombie(z, by) {
    const T = ZTYPES[z.type];
    this.broadcastAll({ t: 'zDie', id: z.id, by, ti: z.ti });
    if (T.boss) {
      const items = rollLoot('boss', Math.random, 1);
      items.push(makeItem('trophy', 1 + (Math.random() < 0.5 ? 1 : 0)));
      this.hostDrop(z.pos.x, z.pos.y, z.pos.z, items, 'Трофеи: ' + T.name, false);
      const who = by ? (this.roster.get(by) || {}).name : '';
      this.broadcastAll({ t: 'note', text: `Босс «${T.name}» повержен${who ? ' — ' + who : ''}! Трофеи на месте гибели.`, big: 1 });
    } else if (Math.random() < 0.16) {
      const items = rollLoot('zombie', Math.random, this.lootMul(z.pos.x, z.pos.z));
      if (items.length) this.hostDrop(z.pos.x, z.pos.y, z.pos.z, items, 'Останки зомби', true);
    }
  }

  getStore(cid) {
    if (typeof cid !== 'string') return null;
    let c = this.store.get(cid);
    if (cid[0] === 's') {
      const info = this.world.containerInfo(cid);
      if (!info) return null;
      if (!c || (c.items.length === 0 && this.time - c.t > 1500)) {
        const items = rollLoot(info.tier, Math.random, this.lootMul((info.bb[0] + info.bb[3]) / 2, (info.bb[2] + info.bb[5]) / 2));
        c = { items, t: this.time, viewers: c ? c.viewers : new Set(), name: info.name, cap: 12 };
        this.store.set(cid, c);
      }
    } else if (cid.startsWith('b:')) {
      const b = this.blocks.byKey.get(cid.slice(2));
      if (!b) return null;
      const coll = b.type === 'collector';
      if (!c) { c = { items: [], t: this.time, viewers: new Set(), name: coll ? 'Сборщик воды' : 'Ящик для хранения', cap: coll ? 6 : 24, fill: this.time }; this.store.set(cid, c); }
      if (coll) {
        // сборщик понемногу наполняет бутылки (быстрее в дождливой зиме, медленнее в пустыне)
        const per = this.world.biomeAt(b.i * 2, b.j * 2) === 'desert' ? 360 : 200;
        c.fill = c.fill ?? this.time;
        while (this.time - c.fill > per) {
          c.fill += per;
          const w = c.items.find(i => i.id === 'water' && i.n < ITEMS.water.stack);
          if (w) w.n++; else if (c.items.length < c.cap) c.items.push(makeItem('water', 1)); else { c.fill = this.time; break; }
        }
      }
    }
    return c || null;
  }

  contChanged(cid, c) {
    for (const v of c.viewers) this.sendTo(v, { t: 'cData', cid, items: c.items, name: c.name });
    if (cid[0] === 'd' && c.items.length === 0) {
      this.store.delete(cid);
      this.broadcastAll({ t: 'dDel', id: +cid.slice(1) });
    }
  }

  hostDrop(x, y, z, items, name, zombie) {
    for (const d of this.drops.values()) {
      if (Math.hypot(d.x - x, d.z - z) < 1.5 && Math.abs(d.y - y) < 1.5) {
        const c = this.store.get('d' + d.id);
        if (c && !c.zombie && c.items.length + items.length <= c.cap) { c.items.push(...items); this.contChanged('d' + d.id, c); return; }
      }
    }
    const id = this.nextDrop++;
    const gy = Math.max(this.world.height(x, z), y);
    this.store.set('d' + id, { items, t: this.time, viewers: new Set(), name, cap: 40, zombie });
    this.broadcastAll({ t: 'dAdd', id, x: +x.toFixed(2), y: +gy.toFixed(2), z: +z.toFixed(2) });
  }

  damageBlockHost(b, dmg) {
    b.hp -= dmg;
    if (b.hp <= 0) this.removeBlockHost(b, true);
    else { this.blocks.setHp(b.key, b.hp); this.dirtyHp.add(b.key); }
  }

  removeBlockHost(b, broke) {
    const cid = 'b:' + b.key;
    const c = this.store.get(cid);
    if (c) {
      this.store.delete(cid);
      for (const v of c.viewers) this.sendTo(v, { t: 'cData', cid, items: [], name: c.name, gone: 1 });
      if (c.items.length) this.hostDrop(b.i * 2 + 1, b.y0, b.j * 2 + 1, c.items, 'Содержимое ящика', false);
    }
    this.broadcastAll({ t: 'bDel', key: b.key, broke: broke ? 1 : 0 });
  }

  // события зомби (вызываются симуляцией на хосте)
  onZombieAlert() { }

  onBossAppear(z) {
    this.broadcastAll({ t: 'note', text: `С ордой идёт босс — «${ZTYPES[z.type].name}»!`, big: 1 });
  }

  bossFx(k, x, y, z) {
    this.broadcastAll({ t: 'bfx', k, p: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)] });
  }

  // взрыв гранаты на хосте: урон зомби, игрокам (и самому стрелку) и постройкам; укрытие гасит большую часть
  blastHost(pid, x, y, z, zid, k) {
    const R = BLAST_R;
    this.zsim.noise(x, y, z, 170, pid);
    const cover = (tx, ty, tz) => {
      const dx = tx - x, dy = ty - y, dz = tz - z, d = Math.hypot(dx, dy, dz);
      if (d < 0.5) return 1;
      const h = this.physics.raycast(x, y, z, dx / d, dy / d, dz / d, d - 0.4, { skip: c => c.kind === 'bush' || c.kind === 'glass' || c.ghost });
      return h ? 0.3 : 1;
    };
    for (const zb of [...this.zsim.list]) {
      const cy = zb.pos.y + zb.height * 0.5;
      const d = Math.max(0, Math.hypot(zb.pos.x - x, cy - y, zb.pos.z - z) - zb.radius);
      if (d > R) continue;
      let dmg = 380 * (1 - d / R) * (zb.id === zid ? 1 : cover(zb.pos.x, cy, zb.pos.z));
      if (zb.id === zid) dmg += 250;
      const dead = this.zsim.damage(zb.id, dmg * k, pid);
      if (dead) this.killZombie(dead, pid);
    }
    for (const p of this.hostAlivePlayers()) {
      const d = Math.hypot(p.x - x, p.y + 0.9 - y, p.z - z);
      if (d > R) continue;
      const dmg = 95 * (1 - d / R) ** 1.4 * cover(p.x, p.y + 0.9, p.z);
      if (dmg < 1) continue;
      if (p.pid === this.myId) this.player.damage(dmg, 'blast');
      else if (this.net) this.net.send(p.pid, { t: 'pHit', d: Math.round(dmg), s: 'blast' });
    }
    const RB = R * 0.7;
    for (const b of [...this.blocks.byKey.values()]) {
      const d = Math.max(0, Math.hypot(b.i * 2 + 1 - x, b.y0 + 1 - y, b.j * 2 + 1 - z) - 1);
      if (d <= RB) this.damageBlockHost(b, 300 * (1 - d / RB));
    }
  }

  // взрыв у всех: эффекты, звук и тряска камеры по расстоянию (урон считает хост)
  blastFx(x, y, z) {
    const water = y < C.SEA + 0.8 && this.world.height(x, z) < C.SEA;
    this.fx.blast(x, y, z, water);
    this.sfx.explosion({ x, y, z });
    const cp = this.camera.position, d = Math.hypot(cp.x - x, cp.y - y, cp.z - z);
    this.player.shake = Math.max(this.player.shake, Math.max(0, 1 - d / 50) ** 1.5 * 1.4);
  }

  netBoom(id, p, zid) {
    this.toHost({ t: 'boom', id, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], z: zid || 0, k: +this.player.perks.gun.toFixed(2) });
  }

  zombieHitPlayer(pid, dmg) {
    if (pid === this.myId) this.player.damage(dmg, 'zombie');
    else if (this.net) this.net.send(pid, { t: 'pHit', d: Math.round(dmg) });
  }

  zombieHitBlock(b, dmg) {
    this.damageBlockHost(b, dmg);
    this.sfx.hitWood({ x: b.i * 2 + 1, y: b.y0 + 1, z: b.j * 2 + 1 });
  }

  zombieOnSpikes(z, sp, dt) {
    z.hp -= 32 * dt;
    sp.hp -= 6 * dt;
    if (sp.hp <= 0) this.removeBlockHost(sp, true);
    else { this.blocks.setHp(sp.key, sp.hp); this.dirtyHp.add(sp.key); }
    if (z.hp <= 0) { this.zsim.remove(z); if (z.boss) this.zsim.onBossDied(z); this.killZombie(z, 0); }
  }

  // ---------- клиент ----------
  clientUpdate(dt) {
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / 15;
      const P = this.player;
      this.net.toHost({ t: 'st', p: [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2), +P.yaw.toFixed(3), +P.pitch.toFixed(2)], w: this.weapons.lookKey, f: this.myFlags(), hp: Math.round(P.hp), ar: this.armorLook() });
    }
    this.saveT -= dt;
    if (this.saveT <= 0) this.saveAll(false);
  }

  clientHandle(m) {
    if (!m || !this.running) return;
    switch (m.t) {
      case 'snap':
        this.dayTime = m.tm; this.day = m.d; this.hordeActive = !!m.h;
        for (const z of m.z) this.zviews.sync(z[0], z[1], z[2], z[3], z[4], z[5], z[6], z[7] / 100, false);
        for (const p of m.p) this.syncOther(p);
        break;
      case 'zDie': {
        this.zviews.kill(m.id);
        const T = ZTYPES[ZT[m.ti]];
        if (m.by === this.myId) {
          this.player.kills++;
          this.addXP(T ? T.xp : 20);
          this.stat('kills');
          if (T && T.boss) this.stat('boss');
        }
        break;
      }
      case 'pHit': this.player.damage(+m.d || 0, m.s === 'blast' ? 'blast' : 'zombie'); break;
      case 'tpTo':
        if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite)) {
          const P = this.player, [x, y, z] = m.p;
          this.world.ensureAround(x, z, 1);
          P.pos.set(x, Math.max(y, this.world.height(x, z) + 0.1), z);
          P.vel.set(0, 0, 0); P.landV = 0;
          this.ui.toast('Вас телепортировал ' + String(m.by || 'хост').slice(0, 16));
        }
        break;
      case 'rk':
        if (m.pid !== this.myId && Array.isArray(m.o) && Array.isArray(m.v)) {
          const o = new THREE.Vector3(+m.o[0], +m.o[1], +m.o[2]), v = new THREE.Vector3(+m.v[0], +m.v[1], +m.v[2]);
          this.sfx.gun('rpg', o);
          this.fx.muzzle(o);
          this.fx.backblast(o.x - v.x * 1.5, o.y - 0.1, o.z - v.z * 1.5, -v.x, -v.z);
          this.rockets.launch(m.id, o, v, false);
        }
        break;
      case 'boom': if (m.pid !== this.myId && Array.isArray(m.p)) this.rockets.remote(m.id, m.p); break;
      case 'shot':
        if (m.pid !== this.myId && Array.isArray(m.o)) {
          const o = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
          this.sfx.gun(ITEMS[m.w] ? ITEMS[m.w].sound : 'pistol', o);
          if (Array.isArray(m.e)) this.fx.tracer(o, new THREE.Vector3(m.e[0], m.e[1], m.e[2]));
          this.fx.muzzle(o);
        }
        break;
      case 'bfx': {
        const [x, y, z] = m.p;
        const pos = { x, y: y + 1, z };
        if (m.k === 'slam') { this.fx.burst(x, y + 0.3, z, 40, 0x8a7a60, 7, 0.25, 1.1); this.sfx.gun('shotgun', pos); this.sfx.groan(pos, 0.4, true); }
        else if (m.k === 'scream') { this.sfx.groan(pos, 2.2, true); this.sfx.groan(pos, 1.8, true); this.ui.toast('Крикунья зовёт зомби!'); }
        else if (m.k === 'leap') { this.sfx.groan(pos, 0.8, true); this.fx.burst(x, y + 0.2, z, 16, 0x8a7a60, 4, 0.2, 0.8); }
        break;
      }
      case 'bSet': {
        const b = this.blocks.set(m.b);
        if (b) this.sfx.place({ x: b.i * 2 + 1, y: b.y0 + 1, z: b.j * 2 + 1 });
        break;
      }
      case 'wb': for (const a of m.b) this.blocks.set(unpackBlock(a)); break;
      case 'wd': for (const id of m.d) this.applyDeplete(id); break;
      case 'bDel': {
        const b = this.blocks.removeKey(m.key, !m.broke);
        if (b && m.broke) this.sfx.hitWood({ x: b.i * 2 + 1, y: b.y0 + 1, z: b.j * 2 + 1 });
        break;
      }
      case 'bHp':
        for (const [k, h] of m.l) {
          const b = this.blocks.byKey.get(k);
          if (b && h < b.hp - 1 && Math.hypot(b.i * 2 + 1 - this.player.pos.x, b.j * 2 + 1 - this.player.pos.z) < 40) this.sfx.hitWood({ x: b.i * 2 + 1, y: b.y0 + 1, z: b.j * 2 + 1 });
          this.blocks.setHp(k, h);
        }
        break;
      case 'bDoor': this.blocks.setDoor(m.key, !!m.open); this.sfx.hitWood(this.blockPos(m.key)); break;
      case 'bPt': this.blocks.setPlanted(m.key, m.pt); break;
      case 'give':
        if (ITEMS[m.id]) {
          const left = this.inv.add(m.id, m.n || 1);
          if (left) this.dropItems([left]);
          this.ui.pickupNote(m.id, m.n || 1);
          if (m.stat) this.stat(m.stat);
        }
        break;
      case 'cData':
        if (m.open) {
          this.ui.openContainer(m.cid, m.name, m.items);
          if (m.cid[0] === 's' && !this.openedOnce.has(m.cid)) { this.openedOnce.add(m.cid); this.addXP(2); }
        } else if (m.gone && this.ui.contCid === m.cid) { this.ui.closePanel(); this.ui.toast('Ящик сломан'); }
        else this.ui.updateContainer(m.cid, m.items);
        break;
      case 'cGot': {
        const left = this.inv.addItem(m.item, false);
        this.sfx.pickup();
        this.ui.pickupNote(m.item.id, m.item.n - (left ? left.n : 0));
        if (left) { this.ui.toast('Нет места — предмет выброшен'); this.dropItems([left]); }
        break;
      }
      case 'cRet': { const left = this.inv.addItem(m.item, false); if (left) this.dropItems([left]); this.ui.toast('В контейнере нет места'); break; }
      case 'node': this.applyDeplete(m.id); break;
      case 'dAdd': this.addDropView(m.id, m.x, m.y, m.z); break;
      case 'dDel': this.removeDropView(m.id); break;
      case 'chat': this.ui.chat(m.name, m.text, m.color); break;
      case 'feed': this.ui.feed(m.html); break;
      case 'note': this.ui.toast(m.text, !!m.big); if (m.big) this.sfx.alarm(); break;
      case 'pjoin':
        this.roster.set(m.pid, { name: m.name, color: m.color });
        this.ui.feed(`<b>${escapeHtml(m.name)}</b> присоединился`);
        break;
      case 'pleave': {
        const r = this.roster.get(m.pid);
        this.roster.delete(m.pid);
        this.removeOther(m.pid);
        if (r) this.ui.feed(`<b>${escapeHtml(r.name)}</b> вышел`);
        break;
      }
      case 'horde':
        this.hordeActive = !!m.on;
        if (m.on) { this.ui.toast('КРОВАВАЯ ЛУНА! Орда идёт за вами', true); this.sfx.alarm(); }
        else this.onHordeSurvived();
        break;
    }
  }

  // пережили кровавую луну — уровень пройден
  onHordeSurvived() {
    if (!this.player.alive) { this.ui.toast('Кровавая луна закончилась'); return; }
    this.stat('horde');
    this.addXP(250);
    const done = loadCompleted();
    if (!done.includes(this.level.id)) {
      done.push(this.level.id);
      try { localStorage.setItem(SAVE + 'completed', JSON.stringify(done)); } catch (_) { /* ignore */ }
      this.ui.showVictory(`Вы пережили первую кровавую луну (сложность: ${escapeHtml(this.level.diff.name.toLowerCase())})!<br>Убито зомби: <b>${this.player.kills}</b> · уровень персонажа: <b>${this.player.level}</b>` +
        `<br><br>Дальше опаснее: орды приходят каждые 7 дней и растут. Пустыня и снега — зоны посложнее, но с лучшим лутом. Сможете прожить 28 дней?`);
    } else this.ui.toast('Вы пережили кровавую луну!', true);
  }

  hostLost() {
    if (!this.running) return;
    this.savePlayer();
    this.quit(false, 'Соединение с хостом потеряно. Прогресс персонажа сохранён.');
  }

  // ---------- другие игроки ----------
  syncOther(a) {
    const [pid, x, y, z, yaw, pitch, w, f, hp, ar = ''] = a;
    if (pid === this.myId) return;
    let o = this.others.get(pid);
    const r = this.roster.get(pid) || { name: 'Игрок', color: 0x888888 };
    if (o && o.ar !== ar) {
      // сменилась броня — пересобираем модель, бирку с именем переносим
      const old = o.mesh, mesh = makePlayerModel(r.color, pid, ar);
      mesh.position.copy(old.position); mesh.rotation.copy(old.rotation);
      old.remove(o.tag); mesh.add(o.tag);
      this.scene.remove(old); this.scene.add(mesh);
      o.mesh = mesh; o.ar = ar; o.w = null;
    }
    if (!o) {
      const mesh = makePlayerModel(r.color, pid, ar);
      const tag = makeNameTag(r.name);
      tag.position.y = 2.2;
      mesh.add(tag);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      o = { pid, mesh, tag, x, y, z, yaw, tx: x, ty: y, tz: z, tyaw: yaw, pitch: 0, w: null, f: 0, hp, seen: 0, ar };
      this.others.set(pid, o);
    }
    o.tx = x; o.ty = y; o.tz = z; o.tyaw = yaw; o.pitch = pitch; o.f = f; o.hp = hp; o.seen = performance.now();
    if (o.w !== w) {
      o.w = w;
      const hand = o.mesh.userData.hand;
      while (hand.children.length) hand.remove(hand.children[0]);
      const id = heldBase(w);
      if (id && ITEMS[id]) {
        const im = itemModel(w);
        im.rotation.x = -Math.PI / 2;
        if (ITEMS[id].cat === 'block') im.scale.setScalar(2);
        // готовые модели оружия увеличены для вида от первого лица — у других игроков почти натуральный размер
        if (FITTED_GUNS.has(id)) im.scale.setScalar(1.12 / GUN_K);
        hand.add(im);
      }
    }
  }

  removeOther(pid) {
    const o = this.others.get(pid);
    if (!o) return;
    this.scene.remove(o.mesh);
    this.others.delete(pid);
  }

  updateOthers(dt) {
    const now = performance.now();
    for (const o of this.others.values()) {
      if (now - o.seen > 4000) { this.removeOther(o.pid); continue; }
      const k = 1 - Math.exp(-dt * 14);
      const ox = o.x, oz = o.z;
      o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.z += (o.tz - o.z) * k;
      o.yaw = angleLerp(o.yaw, o.tyaw, k);
      const sp = Math.hypot(o.x - ox, o.z - oz) / Math.max(dt, 1e-4);
      o.mesh.position.set(o.x, o.y, o.z);
      o.mesh.rotation.y = o.yaw;
      const dead = !!(o.f & 2);
      o.mesh.rotation.x = dead ? -Math.PI / 2 : 0;
      o.tag.visible = !dead;
      const wd = o.w && ITEMS[heldBase(o.w)], aim = !!wd && wd.cat === 'gun';
      o.sw = (o.sw || 0) + (((o.f & 16) ? 1 : 0) - (o.sw || 0)) * Math.min(1, dt * 14);
      animate(o.mesh, dt, dead ? 0 : sp, { aim, pitch: o.pitch, crouch: !!(o.f & 1), swing: o.sw * 0.9 });
    }
  }

  mapPlayers() {
    const out = [{ me: true, x: this.player.pos.x, z: this.player.pos.z }];
    for (const o of this.others.values()) {
      const r = this.roster.get(o.pid);
      out.push({ x: o.x, z: o.z, name: r ? r.name : '?', color: r ? r.color : 0x888888 });
    }
    return out;
  }

  compassMarkers() {
    const out = [];
    const P = this.player;
    for (const l of this.world.lairs) if (Math.hypot(l.x - P.pos.x, l.z - P.pos.z) < 500) out.push({ x: l.x, z: l.z, color: '#c03020' });
    const bed = this.bedPos();
    if (bed) out.push({ x: bed.x, z: bed.z, color: '#6ab0ff' });
    for (const o of this.others.values()) {
      const r = this.roster.get(o.pid);
      out.push({ x: o.x, z: o.z, color: '#' + (r ? r.color : 0x888888).toString(16).padStart(6, '0') });
    }
    return out;
  }

  nearestBoss() {
    let best = null, bd = 75;
    for (const v of this.zviews.map.values()) {
      if (v.dead || !v.T.boss) continue;
      const d = Math.hypot(v.x - this.player.pos.x, v.z - this.player.pos.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  objectiveHTML() {
    const P = this.player;
    const toHorde = (C.HORDE_EVERY - (this.day % C.HORDE_EVERY)) % C.HORDE_EVERY;
    let h = `<b>Выживание · день ${this.day}</b>`;
    if (this.hordeActive) h += `<span class="horde">Кровавая луна! Держите оборону до рассвета.</span><br>`;
    else if (toHorde === 0) h += `Кровавая луна — <b style="display:inline;color:#ff6a50">сегодня ночью</b><br>`;
    else h += `До кровавой луны: ${toHorde} ${toHorde === 1 ? 'день' : toHorde < 5 ? 'дня' : 'дней'}<br>`;
    const q = this.quest();
    if (q) h += `<div class="q">Задание: ${escapeHtml(q.text)}<br><i>${Math.min(q.need, Math.floor(P.stats[q.stat] || 0))} / ${q.need}</i></div>`;
    else h += `<div class="q">Все задания выполнены. Живите как можно дольше!</div>`;
    return h;
  }

  stationOK(kind) {
    if (!kind) return true;
    const p = this.player.pos;
    return this.blocks.stationNear(kind, p.x, p.y, p.z);
  }

  // ---------- взаимодействие ----------
  updateInteract() {
    const P = this.player, ui = this.ui;
    let best = null;
    if (P.alive && !ui.panel) {
      const cam = this.camera;
      const o = cam.position;
      const f = this._fwd || (this._fwd = new THREE.Vector3());
      cam.getWorldDirection(f);
      let bt = 3.2;
      for (const c of this.world.containersNear(P.pos.x, P.pos.z)) {
        const b = c.bb;
        const h = rayBox(o.x, o.y, o.z, f.x, f.y, f.z, b[0] - 0.05, b[1], b[2] - 0.05, b[3] + 0.05, b[4] + 0.05, b[5] + 0.05, bt);
        if (h && h.t < bt) { bt = h.t; best = { type: 'cont', c }; }
      }
      for (const d of this.drops.values()) {
        if (Math.abs(d.x - P.pos.x) > 5 || Math.abs(d.z - P.pos.z) > 5) continue;
        const h = rayBox(o.x, o.y, o.z, f.x, f.y, f.z, d.x - 0.5, d.y - 0.1, d.z - 0.5, d.x + 0.5, d.y + 0.75, d.z + 0.5, bt);
        if (h && h.t < bt) { bt = h.t; best = { type: 'drop', d }; }
      }
      const pi = Math.floor(P.pos.x / 2), pj = Math.floor(P.pos.z / 2);
      const useful = { door: 1, mdoor: 1, box: 1, bed: 1, farm: 1, collector: 1, bench: 1, forge: 1, fire: 1 };
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
        for (const b of this.blocks.column(pi + di, pj + dj)) {
          if (!useful[b.type]) continue;
          const bb = colliderBox(b);
          const h = rayBox(o.x, o.y, o.z, f.x, f.y, f.z, bb[0] - 0.05, bb[1], bb[2] - 0.05, bb[3] + 0.05, bb[4] + 0.1, bb[5] + 0.05, bt);
          if (h && h.t < bt) { bt = h.t; best = { type: b.type, b }; }
        }
      }
      if (best) {
        const wh = this.physics.raycast(o.x, o.y, o.z, f.x, f.y, f.z, bt, { skip: c => c.kind === 'glass' || c.kind === 'bush' });
        if (wh && wh.t < bt - 0.12 && !(best.b && wh.c && wh.c.ref === best.b.key)) best = null;
      }
      // вода из озера
      if (!best && (P.swim || f.y < -0.05)) {
        const t = P.swim ? 0 : (C.SEA - o.y) / f.y;
        if (t >= 0 && t < 4) {
          const px = o.x + f.x * t, pz = o.z + f.z * t;
          if (P.swim || this.world.height(px, pz) < C.SEA - 0.15) {
            const wh = this.physics.raycast(o.x, o.y, o.z, f.x, f.y, f.z, t, { skip: c => c.kind === 'bush' });
            if (!wh) best = { type: 'water' };
          }
        }
      }
    }
    this.focus = best;
    let text = null;
    if (best) {
      const k = best.type;
      if (k === 'cont') text = `<b>[E]</b> Обыскать: ${escapeHtml(best.c.name)}`;
      else if (k === 'drop') text = `<b>[E]</b> Обыскать вещи`;
      else if (k === 'door' || k === 'mdoor') text = `<b>[E]</b> ${best.b.open ? 'Закрыть' : 'Открыть'} дверь`;
      else if (k === 'box') text = `<b>[E]</b> Открыть ящик`;
      else if (k === 'collector') text = `<b>[E]</b> Сборщик воды — забрать бутылки`;
      else if (k === 'bench' || k === 'forge' || k === 'fire') text = `<b>[E]</b> ${k === 'bench' ? 'Верстак' : k === 'forge' ? 'Кузница' : 'Костёр'} — открыть крафт`;
      else if (k === 'bed') text = this.player.bed === best.b.key ? 'Твоя точка возрождения' : `<b>[E]</b> Сделать точкой возрождения`;
      else if (k === 'water') text = `<b>[E]</b> Попить воды`;
      else if (k === 'farm') {
        const gr = this.blocks.growth(best.b, this.now());
        text = gr >= 1 ? `<b>[E]</b> Собрать урожай` : `Картофель растёт: ${Math.floor(gr * 100)}%`;
      }
    }
    const pr = document.getElementById('prompt');
    if (text !== this._promptText) {
      this._promptText = text;
      pr.style.display = text ? 'block' : 'none';
      if (text) pr.innerHTML = text;
    }
  }

  act(f) {
    const P = this.player;
    switch (f.type) {
      case 'cont': this.toHost({ t: 'cOpen', cid: f.c.cid }); break;
      case 'drop': this.toHost({ t: 'cOpen', cid: 'd' + f.d.id }); break;
      case 'box':
      case 'collector': this.toHost({ t: 'cOpen', cid: 'b:' + f.b.key }); break;
      case 'door':
      case 'mdoor': this.toHost({ t: 'bDoor', key: f.b.key }); break;
      case 'bed': P.bed = f.b.key; this.ui.toast('Точка возрождения сохранена'); this.sfx.click(); break;
      case 'bench':
      case 'forge':
      case 'fire': this.ui.openInv(); break;
      case 'water':
        P.water = Math.min(100, P.water + 15);
        this.sfx.eat();
        break;
      case 'farm':
        if (this.blocks.growth(f.b, this.now()) >= 1) this.toHost({ t: 'harvest', key: f.b.key });
        break;
    }
  }

  closeContainer(cid) { this.toHost({ t: 'cClose', cid }); }

  takeFromContainer(cid, i, item) {
    if (!item) return;
    if (this.inv.room(item.id) < item.n) { this.ui.toast('Нет места в рюкзаке'); return; }
    this.toHost({ t: 'cTake', cid, i, id: item.id });
  }

  takeAll(cid, items) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it && this.inv.room(it.id) >= it.n) this.toHost({ t: 'cTake', cid, i, id: it.id });
    }
  }

  putToContainer(cid, idx) {
    const it = this.inv.takeSlot(idx);
    if (!it) return;
    this.toHost({ t: 'cPut', cid, item: it });
    this.sfx.click();
  }

  dropItems(items) {
    const P = this.player;
    this.toHost({ t: 'drop', items, p: [P.pos.x - Math.sin(P.yaw) * 0.9, P.pos.y, P.pos.z - Math.cos(P.yaw) * 0.9] });
  }

  dropFromInv(i) {
    const it = this.inv.takeSlot(i);
    if (!it) return;
    this.dropItems([it]);
    this.sfx.click();
  }

  quickUse(i) {
    const it = this.inv.slots[i];
    if (!it) return;
    const def = ITEMS[it.id];
    const P = this.player;
    if (def.cat === 'armor') {
      if (this.inv.toggleArmor(i)) this.sfx.click(); else this.ui.toast('Рюкзак полон');
      return;
    }
    // прицел — на оружие в руках
    if (def.cat === 'sight') {
      const gun = this.inv.slots[P.sel];
      if (gun && canMount(gun.id, it.id)) {
        this.inv.move(i, P.sel);
        this.sfx.click();
        this.ui.toast(`${def.name}: на ${ITEMS[gun.id].name}`);
      } else this.ui.toast('Возьми в руки пистолет, ПП или автомат — или перетащи прицел на оружие');
      return;
    }
    if (def.cat === 'food' || def.cat === 'med') {
      if (def.heal) P.hp = Math.min(P.maxHp, P.hp + def.heal);
      if (def.food) P.food = clamp(P.food + def.food, 0, 100);
      if (def.water) P.water = clamp(P.water + def.water, 0, 100);
      this.inv.takeSlot(i, 1);
      this.sfx.eat();
    } else if (i >= 8) {
      let t = -1;
      for (let k = 0; k < 8; k++) if (!this.inv.slots[k]) { t = k; break; }
      this.inv.move(i, t >= 0 ? t : P.sel);
    } else this.select(i);
  }

  craft(r) {
    const P = this.player, free = this.freeCraft; // free — бесплатный крафт из консоли тестового мира
    if (!free && (P.level < r.lvl || !this.inv.hasAll(r.cost))) return false;
    if (!free && !this.stationOK(r.station)) { this.ui.toast('Нужно стоять рядом: ' + STATION_NAMES[r.station]); return false; }
    if (!free) for (const id in r.cost) this.inv.remove(id, r.cost[id]);
    const left = this.inv.add(r.out, r.n);
    if (left) this.dropItems([left]);
    this.sfx.craft();
    this.addXP(3);
    if (TOOLS.has(r.out)) this.stat('tool');
    if (r.out === 'iron') this.stat('iron', r.n);
    return true;
  }

  // сложить в контейнер всё из рюкзака (хотбар не трогаем)
  putAll(cid) {
    let n = 0;
    for (let i = HOTBAR; i < INV_SIZE; i++) if (this.inv.slots[i]) { this.putToContainer(cid, i); n++; }
    if (!n) this.ui.toast('Рюкзак пуст');
  }

  // броня забирает часть урона; сломанная пропадает
  armorAbsorb(n) {
    const r = this.inv.absorb(n);
    for (const name of r.broke) this.ui.toast('Броня сломалась: ' + name);
    return r.n;
  }

  // что надето — для модели игрока у остальных: «голова,тело,ноги»
  armorLook() {
    return ['head', 'body', 'legs'].map(k => (this.inv.slots[ARMOR_AT[k]] || {}).id || '').join(',');
  }

  addXP(n) {
    const P = this.player;
    P.xp += n;
    let up = false;
    while (P.xp >= xpNeed(P.level)) { P.xp -= xpNeed(P.level); P.level++; up = true; P.hp = Math.min(P.maxHp, P.hp + 10); }
    if (up) { this.ui.toast('Новый уровень: ' + P.level + '! Открыты новые рецепты', true); this.sfx.levelUp(); }
  }

  hitZombie(id, dmg, head, point) {
    this.fx.blood(point.x, point.y, point.z);
    this.ui.hitmarker(head);
    if (head) this.sfx.headshot();
    this.toHost({ t: 'hitZ', id, d: Math.round(dmg) });
  }

  netShot(o, e, w) {
    this.toHost({ t: 'shot', o: [+o.x.toFixed(2), +o.y.toFixed(2), +o.z.toFixed(2)], e: e ? [+e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2)] : null, w });
  }

  netDeplete(id) { this.toHost({ t: 'node', id }); }

  applyDeplete(id) {
    if (this.world.depleted.has(id)) return;
    this.world.depleted.add(id);
    const m = /^[trou](-?\d+)_(-?\d+)_/.exec(id);
    if (!m) return;
    const cx = +m[1], cz = +m[2];
    const d = this.world.chunks.get(this.world.ckey(cx, cz));
    if (d) {
      const c = d.colliders.find(c => c.ref === id);
      if (c) this.physics.remove(c);
      this.chunks.rebuildObjects(cx, cz);
    }
  }

  placeBlock(t, type, rot) {
    this.toHost({ t: 'bPlace', i: t.i, j: t.j, y0: t.y0, type, rot });
    this.stat('place');
    if (type === 'bench') this.stat('place_bench');
  }

  damageBlock(key, d) { this.toHost({ t: 'bHit', key, d: Math.round(d) }); }

  repairBlock(key) {
    const b = this.blocks.byKey.get(key);
    if (!b) return;
    const T = BLOCK_TYPES[b.type];
    if (b.hp >= T.hp) { this.ui.toast('Блок цел'); return; }
    const mat = this.blocks.materialCost(b.type);
    if (this.inv.count(mat) < 1) { this.ui.toast('Для починки нужен материал: ' + ITEMS[mat].name); return; }
    this.inv.remove(mat, 1);
    this.toHost({ t: 'bRepair', key });
  }

  dismantleBlock(key) { this.toHost({ t: 'bDel', key }); }

  blockPos(key) {
    const b = this.blocks.byKey.get(key);
    return b ? { x: b.i * 2 + 1, y: b.y0 + 1, z: b.j * 2 + 1 } : null;
  }

  bedBlock() {
    const b = this.player.bed && this.blocks.byKey.get(this.player.bed);
    return b && b.type === 'bed' ? b : null;
  }

  bedPos() { const b = this.bedBlock(); return b ? { x: b.i * 2 + 1, z: b.j * 2 + 1 } : null; }

  bodyInCell(t) {
    const x0 = t.i * 2, z0 = t.j * 2, y0 = t.y0;
    const test = (x, y, z, r, h) => x + r > x0 && x - r < x0 + 2 && z + r > z0 && z - r < z0 + 2 && y + h > y0 && y < y0 + 2;
    const P = this.player;
    if (test(P.pos.x, P.pos.y, P.pos.z, P.radius, P.height)) return true;
    for (const o of this.others.values()) if (test(o.x, o.y, o.z, 0.36, 1.8)) return true;
    return false;
  }

  sendChat(text) { this.toHost({ t: 'chat', text }); }

  // хост притягивает игрока к себе (команды tphere / tpall)
  adminTeleport(pid) {
    const P = this.player, a = Math.random() * 6.283;
    const p = [+(P.pos.x + Math.cos(a) * 1.5).toFixed(2), +(P.pos.y + 0.2).toFixed(2), +(P.pos.z + Math.sin(a) * 1.5).toFixed(2)];
    this.sendTo(pid, { t: 'tpTo', p, by: (this.roster.get(this.myId) || {}).name || 'хост' });
  }

  // ---------- лут на земле ----------
  addDropView(id, x, y, z) {
    if (this.drops.has(id)) return;
    const mesh = makeBag();
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.random() * 6;
    this.scene.add(mesh);
    this.drops.set(id, { id, x, y, z, mesh });
    if (id >= this.nextDrop) this.nextDrop = id + 1;
  }

  removeDropView(id) {
    const d = this.drops.get(id);
    if (!d) return;
    this.scene.remove(d.mesh);
    this.drops.delete(id);
    if (this.ui.contCid === 'd' + id) this.ui.closePanel();
  }

  // ---------- тестовый мир ----------
  // все стволы и железные инструменты на панели; пропавшие (например, из старого сохранения) выдаются заново
  giveTestKit() {
    const inv = this.inv;
    // армейская броня — сразу надета
    for (const id of TEST_ARMOR) {
      const at = ARMOR_AT[ITEMS[id].slot];
      if (!inv.slots[at] && inv.count(id) <= 0) { inv.slots[at] = makeItem(id, 1); inv.changed(); }
    }
    // прицелы — в рюкзак, если ни в рюкзаке, ни на оружии их нет
    for (const id of TEST_SIGHTS) {
      if (inv.count(id) > 0 || inv.slots.some(s => s && s.sight === id)) continue;
      inv.addItem(makeItem(id, 1), false);
    }
    const missing = TEST_KIT.filter(id => inv.count(id) <= 0);
    if (!missing.length) return;
    // освобождаем панель под стволы: прочие вещи с неё уходят в рюкзак
    for (let i = 0; i < HOTBAR; i++) {
      const s = inv.slots[i];
      if (!s || TEST_KIT.includes(s.id)) continue;
      inv.slots[i] = null;
      const left = inv.addItem(s, false);
      if (left) inv.slots[i] = left;
    }
    for (const id of missing) {
      const it = makeItem(id, 1);
      if (ITEMS[id].cat === 'gun') it.ammo = ITEMS[id].mag;
      inv.addItem(it, true);
    }
    // стволы — на панель: инструменты уступают место и уходят в рюкзак
    for (let i = HOTBAR; i < INV_SIZE; i++) {
      const s = inv.slots[i];
      if (!s || ITEMS[s.id].cat !== 'gun') continue;
      let j = HOTBAR - 1;
      while (j >= 0 && inv.slots[j] && ITEMS[inv.slots[j].id].cat === 'gun') j--;
      if (j < 0) break;
      inv.slots[i] = inv.slots[j]; inv.slots[j] = s;
    }
    inv.changed();
  }

  // ---------- смерть ----------
  onLocalDeath(src) {
    const P = this.player;
    // в тестовом мире вещи остаются при игроке
    const keep = !!this.level.test;
    const items = keep ? [] : this.inv.all();
    if (!keep) this.inv.clear();
    if (items.length) this.toHost({ t: 'drop', items, p: [P.pos.x, P.pos.y, P.pos.z], death: 1 });
    this.toHost({ t: 'dead' });
    this.weapons.equip(null);
    const why = { zombie: 'Вас загрызли зомби.', fall: 'Вы разбились при падении.', starve: 'Вы умерли от голода и жажды.', blast: 'Вас разорвало взрывом.' }[src] || 'Вы погибли.';
    this.ui.showDeath(why + (keep ? ' В тестовом мире вещи остаются при вас.' : ' Ваши вещи остались в рюкзаке на месте гибели.'), !!this.bedBlock());
  }

  respawn(atBed) {
    const P = this.player;
    const b = atBed ? this.bedBlock() : null;
    if (b) P.spawnAt(b.i * 2 + 1, b.y0 + 0.4, b.j * 2 + 1, P.yaw);
    else { const s = this.findSpawn(); P.spawnAt(s.x, s.y, s.z, s.yaw); }
    P.hp = P.maxHp; P.food = Math.max(P.food, 70); P.water = Math.max(P.water, 70); P.stamina = P.perks.stamina;
    if (this.level.test) this.giveTestKit();
    else { this.inv.add('bandage', 1); this.inv.add('water', 1); }
    this.toHost({ t: 'respawn' });
    this.ui.panel = null;
  }

  // ---------- карта мира ----------
  startMapImage() {
    const N = 300;
    this.mapImage = document.createElement('canvas');
    this.mapImage.width = N; this.mapImage.height = N;
    this.mapN = N; this.mapRow = 0;
    this.mapH = new Float32Array(N * N);
    this.mapB = new Uint8Array(N * N);
    this.mapDone = false;
  }

  stepMapImage(budget) {
    if (this.mapDone || !this.mapH) return;
    const N = this.mapN, w = this.world, t0 = performance.now();
    while (this.mapRow < N && performance.now() - t0 < budget) {
      const j = this.mapRow++;
      const z = -C.HALF + (j + 0.5) * C.WORLD_SIZE / N;
      for (let i = 0; i < N; i++) {
        const x = -C.HALF + (i + 0.5) * C.WORLD_SIZE / N;
        this.mapH[j * N + i] = w.applyFlats(x, z, w.rawHeight(x, z), null);
        this.mapB[j * N + i] = C.BIOME_IDS.indexOf(w.biomePick(x, z, ((i * 7 + j * 13) % 10) / 10));
      }
    }
    if (this.mapRow < N) return;
    this.mapDone = true;
    const ctx = this.mapImage.getContext('2d');
    const img = ctx.createImageData(N, N);
    const H = this.mapH;
    const rgb = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
    const pals = C.BIOME_IDS.map(b => { const L = C.BIOMES[b].colors; return { grass: rgb(L.grass), sand: rgb(L.sand), rock: rgb(L.rock), snow: rgb(L.snow), snowLine: C.BIOMES[b].snowLine }; });
    const water = rgb(C.WATER_COLOR), deep = rgb(0x1d4a6e);
    const cell = C.WORLD_SIZE / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h = H[j * N + i];
      const hl = H[j * N + Math.max(0, i - 1)], hu = H[Math.max(0, j - 1) * N + i];
      const slope = Math.hypot(h - hl, h - hu) / cell;
      const cs = pals[this.mapB[j * N + i]];
      let c;
      if (h < -6) c = deep; else if (h < 0) c = water;
      else if (h < 1.4) c = cs.sand;
      else if (slope > 0.6) c = cs.rock;
      else if (h > cs.snowLine) c = cs.snow;
      else c = cs.grass;
      const shadeK = h < 0 ? 1 : clamp(1 + ((h - hl) + (h - hu)) * 0.06, 0.7, 1.25);
      const k = (j * N + i) * 4;
      img.data[k] = clamp(c[0] * shadeK, 0, 255); img.data[k + 1] = clamp(c[1] * shadeK, 0, 255); img.data[k + 2] = clamp(c[2] * shadeK, 0, 255); img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mapH = null; this.mapB = null;
    if (this.ui.panel === 'map') this.ui.drawMap();
  }

  // ---------- сохранения ----------
  worldKey() { return SAVE + 'world:' + this.level.id; }
  playerKey() { return SAVE + 'player:' + this.level.id + ':' + (this.isHost ? 'host' : this.code); }

  saveWorld() {
    if (!this.isHost) return true;
    const storage = {};
    for (const [cid, c] of this.store) if (cid.startsWith('b:') && c.items.length) storage[cid] = c.items;
    const drops = [];
    for (const d of this.drops.values()) {
      const c = this.store.get('d' + d.id);
      if (c && c.items.length && !c.zombie) drops.push([d.x, d.y, d.z, c.items, c.name]);
    }
    const lairs = this.zsim && this.zsim.lairState ? this.zsim.lairState.map(s => Math.max(0, s.respawn - this.time)) : [];
    const data = { v: 3, diff: this.level.diff.id, seed: this.seed, code: this.code, tm: this.dayTime, d: this.day, blocks: this.blocks.serialize(), depleted: [...this.world.depleted], storage, drops, lairs };
    try { localStorage.setItem(this.worldKey(), JSON.stringify(data)); } catch (e) { console.warn('save failed', e); return false; }
    return true;
  }

  loadWorld() {
    const data = this.o.worldSave;
    if (!data) return;
    this.dayTime = data.tm ?? 0.3; this.day = data.d ?? 1;
    for (const id of data.depleted || []) this.world.depleted.add(id);
    for (const a of data.blocks || []) this.blocks.set(unpackBlock(a));
    for (const cid in data.storage || {}) this.store.set(cid, { items: data.storage[cid], t: 0, viewers: new Set(), name: 'Ящик для хранения', cap: 24 });
    for (const [x, y, z, items, name] of data.drops || []) {
      const id = this.nextDrop++;
      this.store.set('d' + id, { items, t: 0, viewers: new Set(), name: name || 'Вещи', cap: 40 });
      this.addDropView(id, x, y, z);
    }
    if (Array.isArray(data.lairs) && this.zsim) this.zsim.lairState = this.world.lairs.map((_, k) => ({ id: 0, respawn: data.lairs[k] || 0 }));
    this.hordeActive = hordeAt(this.day, this.dayTime);
  }

  savePlayer() {
    const P = this.player;
    const data = { pos: [P.pos.x, P.pos.y, P.pos.z], yaw: P.yaw, hp: P.hp, food: P.food, water: P.water, xp: P.xp, level: P.level, kills: P.kills, inv: this.inv.serialize(), bed: P.bed, alive: P.alive, sel: P.sel, stats: P.stats, quest: P.quest };
    try { localStorage.setItem(this.playerKey(), JSON.stringify(data)); } catch (e) { console.warn('save failed', e); return false; }
    // уровень персонажа общий для всех миров
    try { localStorage.setItem(SAVE + 'char', JSON.stringify({ xp: P.xp, level: P.level })); } catch (_) { /* ignore */ }
    return true;
  }

  loadPlayer() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(this.playerKey()) || 'null'); } catch (_) { data = null; }
    const P = this.player;
    try {
      const ch = JSON.parse(localStorage.getItem(SAVE + 'char') || 'null');
      if (ch) { P.level = ch.level || 1; P.xp = ch.xp || 0; }
    } catch (_) { /* ignore */ }
    if (data) { P.stats = data.stats || {}; P.quest = data.quest || 0; P.kills = data.kills || 0; P.bed = data.bed || null; }
    if (!data || !data.alive) return false;
    P.spawnAt(data.pos[0], data.pos[1] + 0.3, data.pos[2], data.yaw || 0);
    P.hp = data.hp; P.food = data.food; P.water = data.water; P.sel = data.sel || 0;
    if (data.level > P.level) { P.level = data.level; P.xp = data.xp; }
    this.inv.load(data.inv);
    return true;
  }

  quit(save = true, message) {
    if (!this.running) return;
    if (save) { this.savePlayer(); this.saveWorld(); }
    this.running = false;
    this.ui.detach();
    if (this.net) this.net.close();
    this.dispose();
    if (this.onQuit) this.onQuit(message);
  }

  dispose() {
    this.scene.traverse(o => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    });
    this.scene.clear();
  }
}

export function loadCompleted() {
  try { return JSON.parse(localStorage.getItem(SAVE + 'completed') || '[]'); } catch (_) { return []; }
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

