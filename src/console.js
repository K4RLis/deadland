// Консоль тестового мира (клавиша Ё): телепорт, предметы, бессмертие, полёт, зомби, время суток и прочее.
import * as C from './config.js';
import { ITEMS, makeItem } from './items.js';
import { ZTYPES } from './zombies.js';
import { HOTBAR, INV_SIZE } from './inventory.js';
import { clamp } from './rng.js';

const low = s => String(s).toLowerCase().replace(/ё/g, 'е');
const onOff = v => (v ? 'вкл' : 'выкл');

// предмет по id или по названию: точное совпадение, иначе начало id или часть названия
function findItems(q) {
  if (ITEMS[q]) return [q];
  const k = low(q), ids = Object.keys(ITEMS);
  const exact = ids.filter(id => low(ITEMS[id].name) === k);
  return exact.length ? exact : ids.filter(id => id.startsWith(k) || low(ITEMS[id].name).includes(k));
}

function findZombie(q) {
  const k = low(q);
  if (ZTYPES[k]) return k;
  return Object.keys(ZTYPES).find(t => low(ZTYPES[t].name).startsWith(k)) || null;
}

// точка, куда смотрит игрок (луч до max м), или null
function aimPoint(g, max = 900) {
  const cam = g.camera;
  cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements, o = cam.position;
  const hit = g.physics.raycast(o.x, o.y, o.z, -e[8], -e[9], -e[10], max, {});
  if (!hit) return null;
  const back = Math.min(0.6, hit.t);
  return { x: hit.x + e[8] * back, y: hit.y + e[9] * back, z: hit.z + e[10] * back };
}

function teleport(g, x, z, y) {
  const P = g.player, L = C.HALF - 5;
  x = clamp(x, -L, L); z = clamp(z, -L, L);
  const ground = Math.max(g.world.height(x, z), C.SEA - 1.2);
  g.world.ensureAround(x, z, 1);
  P.pos.set(x, y != null ? Math.max(y, ground) : ground + 0.3, z);
  P.vel.set(0, 0, 0);
  P.landV = 0;
  return `${Math.round(x)} ${Math.round(z)}`;
}

// места для tp: города, база, логова боссов, места крушения, кровать, другие игроки
function places(g) {
  const w = g.world, out = [];
  for (const t of w.towns) out.push({ name: t.name, x: t.x, z: t.z });
  if (w.military) out.push({ name: 'Военная база', x: w.military.x, z: w.military.z });
  for (const l of w.lairs) out.push({ name: 'Логово: ' + ZTYPES[l.type].name, x: l.x, z: l.z });
  w.crashSites.forEach((c, i) => out.push({ name: 'Крушение ' + (i + 1), x: c.x, z: c.z }));
  const bed = g.bedPos();
  if (bed) out.push({ name: 'Кровать', x: bed.x, z: bed.z });
  for (const o of g.others.values()) out.push({ name: (g.roster.get(o.pid) || {}).name || 'Игрок', x: o.x, z: o.z });
  return out;
}

// host — команда меняет мир, поэтому доступна только хосту
export const COMMANDS = {
  help: { args: '[команда]', desc: 'список команд' },
  tp: { args: '[x z | место]', desc: 'телепорт: без аргументов — туда, куда смотришь; место — город, база, логово, кровать, игрок' },
  places: { desc: 'места для tp' },
  pos: { desc: 'координаты, биом, город' },
  give: { args: '<предмет> [кол-во]', desc: 'выдать предмет (id или часть названия)' },
  items: { args: '[фильтр]', desc: 'список предметов' },
  heal: { desc: 'полное здоровье, еда, вода и выносливость' },
  god: { desc: 'бессмертие вкл/выкл' },
  fly: { desc: 'полёт сквозь стены: WASD, пробел — вверх, C — вниз, Shift — быстрее' },
  speed: { args: '<множитель>', desc: 'скорость бега (1 — обычная)' },
  spawn: { args: '<тип> [кол-во]', desc: 'зомби или босс там, куда смотришь', host: true },
  killall: { desc: 'убить всех зомби', host: true },
  peace: { desc: 'новые зомби не появляются вкл/выкл', host: true },
  time: { args: '<час 0–24>', desc: 'время суток', host: true },
  day: { args: '<день>', desc: 'номер дня', host: true },
  horde: { desc: 'кровавая луна прямо сейчас', host: true },
  level: { args: '<уровень>', desc: 'уровень персонажа (открывает рецепты)' },
  xp: { args: '<опыт>', desc: 'добавить опыт' },
  free: { desc: 'бесплатный крафт без станций и уровня вкл/выкл' },
  clear: { desc: 'очистить рюкзак (панель и броня остаются)' },
  fps: { desc: 'счётчик кадров вкл/выкл' },
  save: { desc: 'сохранить мир' },
  cls: { desc: 'очистить консоль' },
};

const RUN = {
  help(g, a, out) {
    if (a[0] && COMMANDS[a[0]]) { const c = COMMANDS[a[0]]; out(`${a[0]}${c.args ? ' ' + c.args : ''} — ${c.desc}`); return; }
    out('Команды (Tab — дополнить, ↑↓ — история, Ё или Esc — закрыть):', 'head');
    for (const k in COMMANDS) {
      const c = COMMANDS[k];
      out(`  ${k}${c.args ? ' ' + c.args : ''} — ${c.desc}${c.host && !g.isHost ? ' (только у хоста)' : ''}`);
    }
    out('Двойной клик по карте (M) — телепорт в эту точку.');
  },
  tp(g, a, out) {
    if (!a.length) {
      const p = aimPoint(g);
      if (!p) { out('Посмотри на землю или постройку (до 900 м).', 'err'); return; }
      out('Телепорт → ' + teleport(g, p.x, p.z, p.y));
      return;
    }
    const nums = a.map(Number);
    if (nums.every(n => Number.isFinite(n)) && (a.length === 2 || a.length === 3)) {
      out('Телепорт → ' + (a.length === 2 ? teleport(g, nums[0], nums[1]) : teleport(g, nums[0], nums[2], nums[1])));
      return;
    }
    const q = low(a.join(' '));
    const p = places(g).find(pl => low(pl.name).includes(q));
    if (!p) { out(`Не нашёл «${a.join(' ')}». places — список мест.`, 'err'); return; }
    out(`Телепорт: ${p.name} → ${teleport(g, p.x, p.z)}`);
  },
  places(g, a, out) {
    const P = g.player.pos;
    for (const p of places(g)) out(`  ${p.name} — ${Math.round(p.x)} ${Math.round(p.z)} (${Math.round(Math.hypot(p.x - P.x, p.z - P.z))} м)`);
  },
  pos(g, a, out) {
    const p = g.player.pos, t = g.world.townAt(p.x, p.z);
    out(`x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)} · ${C.BIOMES[g.biomeHere()].name}${t ? ' · ' + t.name : ''}`);
  },
  give(g, a, out) {
    if (!a.length) { out('give <предмет> [кол-во]. items — список предметов.', 'err'); return; }
    let n = 1;
    if (a.length > 1 && /^\d+$/.test(a[a.length - 1])) n = +a.pop();
    const ids = findItems(a.join(' '));
    if (!ids.length) { out(`Нет предмета «${a.join(' ')}». items — список.`, 'err'); return; }
    if (ids.length > 1) { out('Подходит несколько, уточни: ' + ids.slice(0, 12).map(id => `${id} (${ITEMS[id].name})`).join(', '), 'err'); return; }
    const id = ids[0], def = ITEMS[id];
    n = clamp(n, 1, 999);
    let left = n;
    while (left > 0) {
      const k = Math.min(left, def.stack);
      const it = makeItem(id, k);
      if (def.cat === 'gun') it.ammo = def.mag;
      const rest = g.inv.addItem(it, true);
      left -= k;
      if (rest) { g.dropItems([rest]); out('Рюкзак полон — остальное выпало на землю.'); break; }
    }
    out(`Выдано: ${def.name} ×${n}`);
  },
  items(g, a, out) {
    const q = low(a.join(' '));
    const ids = Object.keys(ITEMS).filter(id => !q || id.includes(q) || low(ITEMS[id].name).includes(q));
    if (!ids.length) { out('Ничего не нашлось.', 'err'); return; }
    for (const id of ids) out(`  ${id} — ${ITEMS[id].name}`);
  },
  heal(g, a, out) {
    const P = g.player;
    P.hp = P.maxHp; P.food = 100; P.water = 100; P.stamina = P.perks.stamina; P.dmgFlash = 0;
    out('Здоровье, еда, вода и выносливость — полные.');
  },
  god(g, a, out) { const P = g.player; P.god = !P.god; out('Бессмертие: ' + onOff(P.god)); },
  fly(g, a, out) {
    const P = g.player;
    P.fly = !P.fly;
    P.vel.set(0, 0, 0); P.landV = 0;
    out('Полёт: ' + onOff(P.fly) + (P.fly ? ' — WASD, пробел вверх, C вниз, Shift быстрее' : ''));
  },
  speed(g, a, out) {
    const P = g.player;
    P.speedMul = clamp(parseFloat(a[0]) || 1, 0.2, 10);
    out('Скорость ×' + P.speedMul);
  },
  spawn(g, a, out) {
    const type = findZombie(a[0] || 'walker');
    if (!type) { out('Типы: ' + Object.keys(ZTYPES).map(k => `${k} (${ZTYPES[k].name})`).join(', '), 'err'); return; }
    const n = clamp(parseInt(a[1], 10) || 1, 1, 30);
    let p = aimPoint(g, 150);
    if (!p) { const P = g.player; p = { x: P.pos.x - Math.sin(P.yaw) * 10, z: P.pos.z - Math.cos(P.yaw) * 10 }; }
    for (let i = 0; i < n; i++) {
      const r = i ? 1.6 * Math.sqrt(i) : 0, an = i * 2.4;
      g.zsim.spawn(type, p.x + Math.cos(an) * r, p.z + Math.sin(an) * r, {});
    }
    out(`${ZTYPES[type].name} ×${n}`);
  },
  killall(g, a, out) {
    let n = 0;
    for (const z of [...g.zsim.list]) {
      const dead = g.zsim.damage(z.id, 1e9, g.myId);
      if (dead) { g.killZombie(dead, g.myId); n++; }
    }
    out('Убито зомби: ' + n);
  },
  peace(g, a, out) { g.peace = !g.peace; out('Без новых зомби: ' + onOff(g.peace) + (g.peace ? '. Уже живых убирает killall.' : '')); },
  time(g, a, out) {
    const h = parseFloat(a[0]);
    if (!Number.isFinite(h)) {
      const m = Math.floor(g.dayTime * 1440);
      out(`Сейчас ${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}, день ${g.day}`);
      return;
    }
    g.dayTime = ((h % 24) + 24) % 24 / 24;
    out(`Время: ${a[0]}:00`);
  },
  day(g, a, out) {
    const d = parseInt(a[0], 10);
    if (!(d >= 1)) { out('day <номер дня>', 'err'); return; }
    g.day = d; g.lastDay = d;
    out('День ' + d);
  },
  horde(g, a, out) {
    if (g.day % C.HORDE_EVERY !== 0) g.day = Math.ceil(g.day / C.HORDE_EVERY) * C.HORDE_EVERY;
    g.lastDay = g.day;
    g.dayTime = 0.87;
    out(`Кровавая луна: день ${g.day}, ночь.`);
  },
  level(g, a, out) {
    const P = g.player, n = parseInt(a[0], 10);
    if (!(n >= 1)) { out('level <уровень>', 'err'); return; }
    P.level = clamp(n, 1, 60); P.xp = 0; P.hp = P.maxHp;
    g.ui.dirtyHud = true;
    out('Уровень ' + P.level);
  },
  xp(g, a, out) {
    const n = parseInt(a[0], 10);
    if (!(n > 0)) { out('xp <количество>', 'err'); return; }
    g.addXP(n);
    out(`+${n} опыта, уровень ${g.player.level}`);
  },
  free(g, a, out) { g.freeCraft = !g.freeCraft; out('Бесплатный крафт: ' + onOff(g.freeCraft)); },
  clear(g, a, out) {
    for (let i = HOTBAR; i < INV_SIZE; i++) g.inv.slots[i] = null;
    g.inv.changed();
    out('Рюкзак очищен.');
  },
  fps(g, a, out) { g.ui.showFps = !g.ui.showFps; out('Счётчик кадров: ' + onOff(g.ui.showFps)); },
  save(g, a, out) { g.saveAll(true); out('Сохранено.'); },
  cls(g) { g.ui.conClear(); },
};

// выполнить строку консоли; out(text, class) — вывод
export function runCommand(g, line, out) {
  const a = line.trim().split(/\s+/);
  const cmd = low(a.shift() || '').replace(/^\//, '');
  if (!cmd) return;
  if (!g.level.test) { out('Консоль работает только в тестовом мире.', 'err'); return; }
  const c = COMMANDS[cmd];
  if (!c) { out(`Нет команды «${cmd}». help — список.`, 'err'); return; }
  if (c.host && !g.isHost) { out('Эта команда меняет мир — она есть только у хоста.', 'err'); return; }
  try { RUN[cmd](g, a, out); } catch (e) { out('Ошибка: ' + e.message, 'err'); }
}

// подпись варианта в подсказке: у предметов и зомби — с названием
export function describe(line, s) {
  const cmd = low(line.replace(/^\s+/, '').split(/\s+/)[0]);
  if (cmd === 'give' && ITEMS[s]) return `${s} (${ITEMS[s].name})`;
  if (cmd === 'spawn' && ZTYPES[s]) return `${s} (${ZTYPES[s].name})`;
  return s;
}

// варианты дополнения для последнего слова
export function complete(g, line) {
  const parts = line.replace(/^\s+/, '').split(/\s+/);
  if (parts.length <= 1) { const p = low(parts[0] || ''); return Object.keys(COMMANDS).filter(k => k.startsWith(p)); }
  const cmd = low(parts[0]), q = low(parts.slice(1).join(' '));
  let pool = [];
  if (cmd === 'give') pool = Object.keys(ITEMS);
  else if (cmd === 'spawn') pool = Object.keys(ZTYPES);
  else if (cmd === 'tp') pool = places(g).map(p => p.name);
  else if (cmd === 'help') pool = Object.keys(COMMANDS);
  const names = s => (cmd === 'give' ? [s, ITEMS[s].name] : cmd === 'spawn' ? [s, ZTYPES[s].name] : [s]);
  const starts = pool.filter(s => names(s).some(n => low(n).startsWith(q)));
  const has = q ? pool.filter(s => !starts.includes(s) && names(s).some(n => low(n).includes(q))) : [];
  return [...starts, ...has].slice(0, 14);
}
