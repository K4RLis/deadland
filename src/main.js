// Точка входа: меню, профиль, запуск/подключение к миру, главный цикл.
import * as THREE from 'three';
import * as C from './config.js';
import { ITEMS } from './items.js';
import { renderIcons, PLAYER_COLORS } from './models.js';
import { loadGunModels } from './gunmodels.js';
import { loadHand } from './riggedhand.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { UI, buildSettings } from './ui.js';
import { Game, SAVE, loadCompleted } from './game.js';
import { Net, randomCode } from './net.js';
import { World } from './world.js';
import { ChunkRenderer } from './chunks.js';

const $ = id => document.getElementById(id);
const canvas = $('game');

// ---------- профиль ----------
function loadProfile() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(SAVE + 'profile') || 'null'); } catch (_) { p = null; }
  p = p || {};
  const names = ['Выживший', 'Сталкер', 'Бродяга', 'Егерь', 'Механик', 'Медик'];
  return {
    name: p.name || names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 90 + 10),
    color: p.color ?? PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)],
    settings: { ...C.DEFAULT_SETTINGS, ...(p.settings || {}) },
  };
}
const prof = loadProfile();
function saveProfile() {
  try { localStorage.setItem(SAVE + 'profile', JSON.stringify(prof)); } catch (_) { /* ignore */ }
}

// ---------- рендер и системы ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1) * prof.settings.scale);
renderer.setSize(innerWidth, innerHeight);

const input = new Input();
const sfx = new Sfx();
sfx.setVolume(prof.settings.volume);
// готовые модели оружия нужны раньше иконок
await Promise.all([loadGunModels(), loadHand()]);
const icons = renderIcons(Object.keys(ITEMS));
const ui = new UI(icons, sfx, canvas);
let game = null;

document.addEventListener('mousemove', e => {
  if (game && ui.captured) game.player.look(e.movementX, e.movementY, prof.settings.sens);
});
window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  if (game) game.resize();
  if (menuScene) { menuScene.camera.aspect = innerWidth / innerHeight; menuScene.camera.updateProjectionMatrix(); }
});
// сохраняемся, когда вкладку закрывают или сворачивают
window.addEventListener('beforeunload', () => { if (game) game.saveAll(false); });
window.addEventListener('pagehide', () => { if (game) game.saveAll(false); });
document.addEventListener('visibilitychange', () => { if (document.hidden && game) game.saveAll(false); });

// ---------- фон меню: облёт города ----------
let menuScene = null;
function buildMenuScene() {
  const level = C.makeLevel('normal');
  const world = new World(level, level.seed);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.BIOMES.forest.sky.day);
  scene.fog = new THREE.Fog(C.BIOMES.forest.sky.day, 120, 330);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x5a4a3a, 1.4));
  const sun = new THREE.DirectionalLight(0xffe2c0, 2.4);
  sun.position.set(200, 160, 120);
  scene.add(sun);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: C.WATER_COLOR, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  const fake = { world, scene, settings: { view: 3 } };
  const chunks = new ChunkRenderer(fake);
  const town = world.towns[0];
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 1200);
  menuScene = { world, scene, chunks, camera, town, t: 0.6 };
  $('menu').classList.add('over-game');
}

function menuFrame(dt) {
  if (!menuScene) { renderer.setClearColor(0x101315); renderer.clear(); return; }
  const m = menuScene;
  m.t += dt * 0.025;
  const r = m.town.r + 40;
  const x = m.town.x + Math.cos(m.t) * r, z = m.town.z + Math.sin(m.t) * r;
  const y = Math.max(m.world.height(x, z), 0) + 38;
  m.camera.position.set(x, y, z);
  m.camera.lookAt(m.town.x, m.town.h + 4, m.town.z);
  m.chunks.update(x, z, false);
  renderer.autoClear = true;
  renderer.render(m.scene, m.camera);
}

// ---------- меню ----------
$('m-ver').textContent = 'версия ' + C.VERSION + (window.BUILD && window.BUILD !== '__BUILD__' ? ' (' + window.BUILD + ')' : '') + ' · мир 3000×3000 м · до ' + C.MAX_PLAYERS + ' игроков';

// ---------- автообновление ----------
// При публикации в адреса всех файлов игры подставляется номер сборки (tools/stamp.py), поэтому для
// обновления хватает свежей страницы. Сверяем номер с version.txt; если вышла новая сборка — в меню
// перезагружаем страницу мимо кэша (один раз на сборку, без зацикливания), в игре — подсказываем выйти в меню.
const BUILD = window.BUILD && window.BUILD !== '__BUILD__' ? window.BUILD : null;
let updNotified = null;
async function checkUpdate() {
  if (!BUILD) return; // локальная разработка
  try {
    const r = await fetch('version.txt?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const v = (await r.text()).trim();
    if (!v || v === BUILD) return;
    if (game) {
      if (updNotified !== v) { updNotified = v; game.ui.toast('Вышло обновление игры — выйди в меню, оно установится само'); }
      return;
    }
    if (sessionStorage.getItem(SAVE + 'upd') === v) {
      // перезагрузка уже была, а страница всё ещё старая — даём обновить вручную
      $('m-ver').innerHTML = 'есть обновление · <a href="#" id="m-upd">обновить игру</a>';
      $('m-upd').onclick = e => { e.preventDefault(); sessionStorage.removeItem(SAVE + 'upd'); checkUpdate(); };
      return;
    }
    sessionStorage.setItem(SAVE + 'upd', v);
    $('m-ver').textContent = 'обновление игры…';
    const own = performance.getEntriesByType('resource').map(e => e.name).filter(u => u.startsWith(location.origin));
    await Promise.all([location.href.split('#')[0], ...own].map(u => fetch(u, { cache: 'reload' }).catch(() => null)));
    if (!game) location.reload();
  } catch (_) { /* нет сети — играем в том, что есть */ }
}
setTimeout(checkUpdate, 1500);
setInterval(checkUpdate, 120000);
const nameInput = $('m-name');
nameInput.value = prof.name;
nameInput.addEventListener('input', () => { prof.name = nameInput.value.trim().slice(0, 16) || 'Выживший'; saveProfile(); });

function renderSwatches() {
  const el = $('m-colors');
  el.innerHTML = '';
  for (const c of PLAYER_COLORS) {
    const i = document.createElement('i');
    i.style.background = '#' + c.toString(16).padStart(6, '0');
    if (c === prof.color) i.className = 'on';
    i.onclick = () => { prof.color = c; saveProfile(); renderSwatches(); };
    el.appendChild(i);
  }
}
renderSwatches();

function showPanel(name) {
  for (const p of ['levels', 'join', 'settings', 'help']) $('p-' + p).classList.toggle('hidden', p !== name);
  if (name === 'settings') buildSettings($('m-settings'), prof.settings, () => { saveProfile(); sfx.setVolume(prof.settings.volume); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1) * prof.settings.scale); renderer.setSize(innerWidth, innerHeight); });
  if (name === 'join') setTimeout(() => $('m-code').focus(), 0);
}
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { sfx.init(); sfx.click(); showPanel(b.dataset.go); }));

// ---------- мир и сложность ----------
const WKEY = SAVE + 'world:' + C.WORLD_ID;
let selDiff = prof.diff || 'normal';
function loadWorldSave() {
  try { return JSON.parse(localStorage.getItem(WKEY) || 'null'); } catch (_) { return null; }
}
function renderLevels() {
  const save = loadWorldSave();
  const el = $('m-diff');
  el.innerHTML = '';
  for (const d of C.DIFFICULTIES) {
    const b = document.createElement('button');
    b.className = 'btn small' + (selDiff === d.id ? ' on' : '');
    b.textContent = d.name;
    b.title = d.desc;
    b.onclick = () => { selDiff = d.id; prof.diff = d.id; saveProfile(); sfx.click(); renderLevels(); };
    el.appendChild(b);
  }
  const rec = +(localStorage.getItem(SAVE + 'record:' + C.WORLD_ID) || 0);
  const done = loadCompleted().includes(C.WORLD_ID);
  $('m-record').textContent = (C.DIFFICULTIES.find(d => d.id === selDiff) || {}).desc + (rec ? ` Рекорд: ${rec} дн.` : '') + (done ? ' Кровавая луна уже пережита.' : '');
  $('m-continue').disabled = !save;
  $('m-save-info').textContent = save
    ? `Сохранённый мир: день ${save.d}, построено блоков: ${(save.blocks || []).length}, сложность: ${(C.DIFFICULTIES.find(d => d.id === save.diff) || C.DIFFICULTIES[1]).name.toLowerCase()}. Код комнаты: ${save.code}.`
    : 'Сохранений нет. «Новый мир» создаст остров с нуля.';
  drawPreview();
}

let previewImg = null;
function drawPreview() {
  const cv = $('m-preview');
  const draw = () => {
    if (!previewImg) {
      const lvl = C.makeLevel('normal');
      const w = new World(lvl, lvl.seed, { layout: false });
      const N = 110;
      const ctx = cv.getContext('2d');
      previewImg = ctx.createImageData(N, N);
      const rgb = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const wx = -C.HALF + (i + 0.5) / N * C.WORLD_SIZE, wz = -C.HALF + (j + 0.5) / N * C.WORLD_SIZE;
        const h = w.rawHeight(wx, wz), hl = w.rawHeight(wx - 28, wz);
        const B = C.BIOMES[w.biomePick(wx, wz, ((i * 7 + j * 13) % 10) / 10)];
        const cl = B.colors;
        const c = h < -6 ? rgb(0x1d4a6e) : h < 0 ? rgb(C.WATER_COLOR) : h < 1.4 ? rgb(cl.sand) : h > B.snowLine ? rgb(cl.snow) : Math.abs(h - hl) > 9 ? rgb(cl.rock) : rgb(cl.grass);
        const k = h < 0 ? 1 : Math.max(0.7, Math.min(1.3, 1 + (h - hl) * 0.04));
        const o = (j * N + i) * 4;
        previewImg.data[o] = c[0] * k; previewImg.data[o + 1] = c[1] * k; previewImg.data[o + 2] = c[2] * k; previewImg.data[o + 3] = 255;
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = previewImg.width; tmp.height = previewImg.height;
    tmp.getContext('2d').putImageData(previewImg, 0, 0);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, cv.width, cv.height);
  };
  if (previewImg) draw(); else setTimeout(draw, 40);
}

$('m-new').onclick = () => {
  if (loadWorldSave() && !confirm('Начать заново? Сохранённый мир будет удалён.')) return;
  startHost(C.makeLevel(selDiff), false);
};
$('m-continue').onclick = () => { const sv = loadWorldSave(); if (sv) startHost(C.makeLevel(sv.diff || 'normal'), true); };
// тестовый мир хранится отдельно и продолжается, если уже был создан
if (!$('m-test')) {
  const b = document.createElement('button');
  b.className = 'btn'; b.id = 'm-test'; b.textContent = 'Тестовый мир ∞';
  $('m-continue').after(b);
}
$('m-test').onclick = () => {
  let sv = null;
  try { sv = JSON.parse(localStorage.getItem(SAVE + 'world:test') || 'null'); } catch (_) { sv = null; }
  startHost(C.makeLevel(sv ? sv.diff || 'normal' : selDiff, true), !!sv);
};
$('m-join').onclick = () => joinGame($('m-code').value);
$('m-code').addEventListener('keydown', e => { e.stopPropagation(); if (e.code === 'Enter') joinGame($('m-code').value); });
$('m-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('msg-ok').onclick = () => $('msgbox').classList.add('hidden');

function message(title, text) {
  $('msg-title').textContent = title;
  $('msg-text').textContent = text;
  $('msgbox').classList.remove('hidden');
}

function showMenu(msg) {
  $('menu').classList.remove('hidden');
  $('loading').classList.add('hidden');
  renderLevels();
  showPanel('levels');
  if (msg) message('Игра завершена', msg);
}

function setLoading(p, text, title) {
  $('loading').classList.remove('hidden');
  if (title) $('load-title').textContent = title;
  $('load-bar').style.width = Math.round(p * 100) + '%';
  if (text) $('load-text').textContent = text;
}
// кадр ожидания при загрузке; в фоновой вкладке rAF не приходит — страхуемся таймером
const frame = () => new Promise(r => {
  let done = false;
  const f = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(f);
  setTimeout(f, 60);
});

async function startHost(level, cont) {
  sfx.init();
  const online = $('m-online').checked;
  const wkey = SAVE + 'world:' + level.id;
  let save = null;
  if (cont) { try { save = JSON.parse(localStorage.getItem(wkey) || 'null'); } catch (_) { save = null; } }
  else {
    localStorage.removeItem(wkey);
    localStorage.removeItem(SAVE + 'player:' + level.id + ':host');
  }
  let code = (save && save.code) || randomCode();
  setLoading(0.02, 'Подготовка…', level.name);
  await frame();
  let net = null, mode = 'solo';
  if (online) {
    setLoading(0.05, 'Открываем комнату для друзей…');
    net = new Net();
    try { await net.host(code); mode = 'host'; }
    catch (e) {
      net.close(); net = null;
      if (e && e.type === 'unavailable-id') {
        code = randomCode();
        net = new Net();
        try { await net.host(code); mode = 'host'; } catch (_) { net.close(); net = null; }
      }
      if (!net) message('Без сети', 'Не удалось открыть комнату (нет интернета или сервер сигнализации недоступен). Мир запущен в одиночном режиме.');
    }
  }
  await bootGame({ level, seed: save ? save.seed : level.seed, mode, net, code, worldSave: save });
}

async function joinGame(raw) {
  sfx.init();
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const st = $('m-join-status');
  if (code.length !== 5) { st.textContent = 'Код комнаты — 5 символов.'; return; }
  st.textContent = 'Подключение…';
  setLoading(0.05, 'Ищем комнату ' + code + '…', 'Подключение');
  const net = new Net();
  try {
    const w = await net.join(code, { t: 'hello', name: prof.name, color: prof.color, ver: C.VERSION });
    const level = C.makeLevel(w.diff || 'normal', !!w.test);
    st.textContent = '';
    await bootGame({ level, seed: w.seed, mode: 'client', net, code, welcome: w });
  } catch (e) {
    net.close();
    $('loading').classList.add('hidden');
    st.textContent = (e && e.message) || 'Не удалось подключиться';
  }
}

async function bootGame(o) {
  setLoading(0.1, 'Генерация острова 3000×3000 м: рельеф, города, дороги…', o.level.name);
  await frame();
  try {
    game = new Game({
      ...o, settings: prof.settings, renderer, input, ui, sfx, icons, name: prof.name, color: prof.color,
      onQuit: msg => { game = null; showMenu(msg); setTimeout(checkUpdate, 300); },
      onSettings: saveProfile,
    });
    await game.init((p, text) => setLoading(0.15 + p * 0.85, text));
  } catch (e) {
    console.error(e);
    if (o.net) o.net.close();
    game = null;
    $('loading').classList.add('hidden');
    message('Ошибка', 'Не удалось запустить мир: ' + (e && e.message));
    return;
  }
  $('loading').classList.add('hidden');
  $('menu').classList.add('hidden');
  $('click-to-play').classList.remove('hidden');
}

// ---------- главный цикл ----------
// Видимая вкладка — requestAnimationFrame. Свёрнутая — тикер в Web Worker (его браузер не замораживает),
// чтобы хост продолжал симулировать зомби и слать снапшоты друзьям.
let last = performance.now();
function tick(render) {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  if (dt <= 0.001) return;
  last = now;
  try {
    if (game) game.frame(dt, render);
    else if (render) menuFrame(dt);
  } catch (e) { console.error(e); }
  input.endFrame();
}
function loop() {
  requestAnimationFrame(loop);
  tick(true);
}
try {
  const src = 'setInterval(function(){postMessage(0)}, 50);';
  const ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  ticker.onmessage = () => { if (performance.now() - last > 120) tick(!document.hidden); };
} catch (e) { console.warn('ticker', e); }

showMenu();
requestAnimationFrame(loop);
setTimeout(() => { try { buildMenuScene(); } catch (e) { console.warn(e); } }, 50);

// для отладки из консоли
window.__mk = {
  get game() { return game; }, C,
  step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) { if (game) game.frame(dt); else menuFrame(dt); input.endFrame(); } },
};
