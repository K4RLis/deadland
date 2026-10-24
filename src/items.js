// Предметы, таблицы лута, рецепты крафта и задания выживания.
import { pickWeighted } from './rng.js';

// harvest: сколько ресурса за удар по дереву / камню / руде
export const FISTS = { name: 'Кулаки', cat: 'melee', dmg: 12, rate: 0.5, range: 2.1, harvest: { tree: 1, rock: 1, ore: 0 } };

export const ITEMS = {
  // ближний бой и инструменты
  knife: { name: 'Нож', cat: 'melee', stack: 1, dmg: 28, rate: 0.42, range: 2.3, harvest: { tree: 1, rock: 0, ore: 0 }, desc: 'Быстрый, но слабый.' },
  bat: { name: 'Бита', cat: 'melee', stack: 1, dmg: 42, rate: 0.75, range: 2.6, harvest: { tree: 1, rock: 1, ore: 0 } },
  axe: { name: 'Каменный топор', cat: 'melee', stack: 1, dmg: 32, rate: 0.8, range: 2.5, harvest: { tree: 4, rock: 1, ore: 0 }, desc: 'Рубит деревья вчетверо быстрее кулаков.' },
  pickaxe: { name: 'Каменная кирка', cat: 'melee', stack: 1, dmg: 28, rate: 0.85, range: 2.5, harvest: { tree: 1, rock: 4, ore: 2 }, desc: 'Добывает камень и железную руду.' },
  iaxe: { name: 'Железный топор', cat: 'melee', stack: 1, dmg: 46, rate: 0.75, range: 2.6, harvest: { tree: 7, rock: 1, ore: 0 } },
  ipick: { name: 'Железная кирка', cat: 'melee', stack: 1, dmg: 40, rate: 0.8, range: 2.6, harvest: { tree: 1, rock: 7, ore: 4 } },
  machete: { name: 'Мачете', cat: 'melee', stack: 1, dmg: 52, rate: 0.55, range: 2.5, harvest: { tree: 2, rock: 0, ore: 0 } },
  hammer: { name: 'Молоток', cat: 'melee', stack: 1, dmg: 18, rate: 0.6, range: 2.6, harvest: { tree: 1, rock: 1, ore: 0 }, repair: true, desc: 'ЛКМ по блоку — починить. ПКМ — разобрать свой блок и вернуть его.' },
  // огнестрел
  pistol: { name: 'Пистолет', cat: 'gun', stack: 1, dmg: 32, rate: 0.2, mag: 12, ammo: 'a9', reload: 1.3, spread: 0.014, recoil: 0.018, range: 160, auto: false, sound: 'pistol', zoom: 1.35 },
  smg: { name: 'Пистолет-пулемёт', cat: 'gun', stack: 1, dmg: 22, rate: 0.075, mag: 30, ammo: 'a9', reload: 1.8, spread: 0.032, recoil: 0.011, range: 140, auto: true, sound: 'smg', zoom: 1.35 },
  shotgun: { name: 'Дробовик', cat: 'gun', stack: 1, dmg: 15, pellets: 9, rate: 0.85, mag: 6, ammo: 'a12', reload: 2.4, spread: 0.075, recoil: 0.06, range: 60, auto: false, sound: 'shotgun', zoom: 1.25 },
  rifle: { name: 'Автомат', cat: 'gun', stack: 1, dmg: 38, rate: 0.105, mag: 30, ammo: 'a762', reload: 2.2, spread: 0.022, recoil: 0.017, range: 260, auto: true, sound: 'rifle', zoom: 1.7 },
  asval: { name: 'АС «Вал»', cat: 'gun', stack: 1, dmg: 36, rate: 0.083, mag: 20, ammo: 'a939', reload: 2.0, spread: 0.019, recoil: 0.013, range: 220, auto: true, sound: 'asval', zoom: 1.8, silent: true, desc: 'Бесшумный автомат: зомби слышат выстрелы только вблизи.' },
  sniper: { name: 'Снайперская винтовка', cat: 'gun', stack: 1, dmg: 150, rate: 1.3, mag: 5, ammo: 'a308', reload: 2.6, spread: 0.03, adsSpread: 0.0008, recoil: 0.08, range: 600, auto: false, sound: 'sniper', zoom: 5, scope: true },
  // патроны
  a9: { name: 'Патроны 9 мм', cat: 'ammo', stack: 120 },
  a12: { name: 'Дробь 12 кал.', cat: 'ammo', stack: 60 },
  a762: { name: 'Патроны 7,62', cat: 'ammo', stack: 120 },
  a308: { name: 'Патроны .308', cat: 'ammo', stack: 60 },
  a939: { name: 'Патроны 9×39', cat: 'ammo', stack: 100 },
  // еда и медицина
  bandage: { name: 'Бинт', cat: 'med', stack: 10, heal: 20, use: 1.6 },
  medkit: { name: 'Аптечка', cat: 'med', stack: 5, heal: 70, use: 3.5 },
  can: { name: 'Консервы', cat: 'food', stack: 8, food: 35, water: -2, use: 1.2 },
  chips: { name: 'Чипсы', cat: 'food', stack: 8, food: 15, water: -5, use: 0.9 },
  mre: { name: 'Сухпаёк', cat: 'food', stack: 5, food: 60, water: 5, use: 1.6 },
  water: { name: 'Бутылка воды', cat: 'food', stack: 6, water: 40, use: 1.0 },
  soda: { name: 'Газировка', cat: 'food', stack: 6, water: 25, food: 4, use: 0.9 },
  berries: { name: 'Ягоды', cat: 'food', stack: 20, food: 6, water: 4, use: 0.6 },
  potato: { name: 'Картофель', cat: 'food', stack: 20, food: 10, use: 0.8, desc: 'Можно посадить в грядку или запечь на костре.' },
  bpotato: { name: 'Печёный картофель', cat: 'food', stack: 20, food: 28, use: 0.9 },
  stew: { name: 'Похлёбка', cat: 'food', stack: 5, food: 45, water: 25, use: 1.4 },
  tea: { name: 'Травяной чай', cat: 'food', stack: 6, water: 35, heal: 5, use: 1.0 },
  // материалы
  wood: { name: 'Древесина', cat: 'mat', stack: 100 },
  stone: { name: 'Камень', cat: 'mat', stack: 100 },
  ore: { name: 'Железная руда', cat: 'mat', stack: 100, desc: 'Переплавь в кузнице.' },
  iron: { name: 'Железо', cat: 'mat', stack: 100 },
  scrap: { name: 'Металлолом', cat: 'mat', stack: 100 },
  fiber: { name: 'Волокно', cat: 'mat', stack: 100, desc: 'Из кустов. Из волокна делают ткань.' },
  cloth: { name: 'Ткань', cat: 'mat', stack: 50 },
  trophy: { name: 'Трофей босса', cat: 'mat', stack: 20, desc: 'Редкий материал с боссов. Нужен для лучших вещей.' },
  // строительство
  b_wood: { name: 'Деревянный блок', cat: 'block', stack: 50, block: 'wood' },
  b_wwall: { name: 'Деревянная стена', cat: 'block', stack: 50, block: 'wwall' },
  b_wwin: { name: 'Стена с окном', cat: 'block', stack: 50, block: 'wwin' },
  b_wfloor: { name: 'Деревянный пол', cat: 'block', stack: 50, block: 'wfloor' },
  b_wramp: { name: 'Деревянная рампа', cat: 'block', stack: 50, block: 'wramp' },
  b_door: { name: 'Деревянная дверь', cat: 'block', stack: 10, block: 'door' },
  b_mdoor: { name: 'Железная дверь', cat: 'block', stack: 10, block: 'mdoor' },
  b_stone: { name: 'Каменный блок', cat: 'block', stack: 50, block: 'stone' },
  b_metal: { name: 'Железный блок', cat: 'block', stack: 50, block: 'metal' },
  b_spikes: { name: 'Шипы', cat: 'block', stack: 20, block: 'spikes' },
  b_box: { name: 'Ящик для хранения', cat: 'block', stack: 5, block: 'box' },
  b_bed: { name: 'Спальник', cat: 'block', stack: 1, block: 'bed' },
  b_fire: { name: 'Костёр', cat: 'block', stack: 5, block: 'fire' },
  b_torch: { name: 'Факел', cat: 'block', stack: 20, block: 'torch' },
  b_bench: { name: 'Верстак', cat: 'block', stack: 2, block: 'bench' },
  b_forge: { name: 'Кузница', cat: 'block', stack: 2, block: 'forge' },
  b_farm: { name: 'Грядка', cat: 'block', stack: 10, block: 'farm' },
  b_collector: { name: 'Сборщик воды', cat: 'block', stack: 4, block: 'collector' },
};

export const CAT_NAMES = { melee: 'Ближний бой', gun: 'Оружие', ammo: 'Патроны', med: 'Медицина', food: 'Еда и вода', mat: 'Материалы', block: 'Постройка' };

// [id, вес, min, max]
export const LOOT = {
  house: [['can', 10, 1, 2], ['chips', 8, 1, 2], ['water', 10, 1, 2], ['soda', 6, 1, 1], ['bandage', 8, 1, 2], ['cloth', 9, 1, 3], ['potato', 5, 1, 3],
    ['knife', 3], ['bat', 2.5], ['hammer', 2], ['axe', 1.5], ['a9', 3, 6, 14], ['a12', 1.5, 2, 6], ['pistol', 1.2], ['shotgun', 0.4], ['scrap', 4, 1, 3], ['medkit', 0.8]],
  shop: [['can', 14, 1, 3], ['chips', 12, 1, 3], ['water', 14, 1, 3], ['soda', 10, 1, 2], ['mre', 2], ['bandage', 4, 1, 2], ['cloth', 3, 1, 2], ['potato', 6, 2, 4]],
  medical: [['bandage', 14, 1, 3], ['medkit', 8], ['water', 4], ['cloth', 5, 1, 3], ['tea', 3]],
  police: [['pistol', 6], ['shotgun', 3.5], ['smg', 1.5], ['a9', 10, 8, 20], ['a12', 7, 4, 10], ['bandage', 5, 1, 2], ['medkit', 2.5], ['bat', 2]],
  industrial: [['axe', 4], ['pickaxe', 4], ['hammer', 5], ['machete', 2], ['ipick', 0.8], ['iaxe', 0.8], ['scrap', 10, 2, 6], ['iron', 4, 1, 4], ['wood', 6, 4, 10], ['cloth', 3, 1, 3], ['water', 3]],
  military: [['rifle', 5], ['asval', 1.6], ['a939', 4, 10, 25], ['sniper', 1.5], ['smg', 3], ['shotgun', 3], ['a762', 10, 10, 30], ['a308', 4, 3, 8], ['a9', 5, 10, 20], ['a12', 4, 5, 10], ['medkit', 5], ['mre', 6], ['water', 4], ['iron', 3, 2, 5]],
  car: [['scrap', 8, 1, 4], ['water', 4], ['a9', 3, 4, 10], ['bandage', 3], ['chips', 3], ['pistol', 0.6], ['cloth', 3, 1, 2]],
  crash: [['rifle', 4], ['asval', 3], ['a939', 4, 15, 30], ['sniper', 2.5], ['a762', 6, 15, 30], ['a308', 4, 5, 10], ['medkit', 4], ['mre', 3], ['iron', 4, 3, 8]],
  zombie: [['cloth', 8, 1, 2], ['can', 2], ['water', 2], ['a9', 2, 3, 8], ['bandage', 2], ['scrap', 3, 1, 2], ['a762', 0.7, 4, 10], ['a12', 0.8, 2, 5]],
  boss: [['rifle', 5], ['asval', 4], ['a939', 5, 20, 40], ['sniper', 3], ['smg', 3], ['a762', 8, 30, 60], ['a308', 5, 10, 20], ['a12', 4, 10, 20], ['medkit', 6, 1, 3], ['iron', 6, 6, 14], ['ipick', 2], ['iaxe', 2], ['mre', 4, 1, 3]],
};

const ITEM_COUNT = { house: [1, 3], shop: [2, 4], medical: [1, 3], police: [1, 3], industrial: [1, 3], military: [2, 4], car: [1, 2], crash: [3, 4], zombie: [1, 1], boss: [5, 7] };

export function makeItem(id, n = 1) {
  const def = ITEMS[id];
  const it = { id, n: Math.min(n, def.stack) };
  if (def.cat === 'gun') it.ammo = 0;
  return it;
}

export function rollLoot(tier, rand, mul = 1) {
  const table = LOOT[tier] || LOOT.house;
  const [a, b] = ITEM_COUNT[tier] || [1, 2];
  if (!table.length) return [];
  let n = a + Math.floor(rand() * (b - a + 1));
  if (mul < 1 && rand() > mul) n = Math.max(0, n - 1);
  if (mul > 1 && rand() < mul - 1) n += 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = pickWeighted(table.map(r => [r, r[1]]), rand);
    const cnt = e.length > 2 ? e[2] + Math.floor(rand() * (e[3] - e[2] + 1)) : 1;
    const it = makeItem(e[0], cnt);
    if (ITEMS[e[0]].cat === 'gun') it.ammo = Math.floor(rand() * (ITEMS[e[0]].mag + 1) * 0.6);
    out.push(it);
  }
  return out;
}

// station: 'bench' — верстак, 'forge' — кузница, 'fire' — костёр (рядом, в 5 м)
export const STATION_NAMES = { bench: 'верстак', forge: 'кузница', fire: 'костёр' };
export const RECIPES = [
  { out: 'cloth', n: 1, cost: { fiber: 4 }, lvl: 1 },
  { out: 'bandage', n: 1, cost: { cloth: 2 }, lvl: 1 },
  { out: 'axe', n: 1, cost: { wood: 3, stone: 4 }, lvl: 1 },
  { out: 'pickaxe', n: 1, cost: { wood: 3, stone: 5 }, lvl: 1 },
  { out: 'hammer', n: 1, cost: { wood: 2, stone: 2 }, lvl: 1 },
  { out: 'b_wood', n: 1, cost: { wood: 4 }, lvl: 1 },
  { out: 'b_wwall', n: 1, cost: { wood: 2 }, lvl: 1 },
  { out: 'b_wwin', n: 1, cost: { wood: 2 }, lvl: 1 },
  { out: 'b_wfloor', n: 1, cost: { wood: 2 }, lvl: 1 },
  { out: 'b_wramp', n: 1, cost: { wood: 4 }, lvl: 1 },
  { out: 'b_door', n: 1, cost: { wood: 6 }, lvl: 1 },
  { out: 'b_fire', n: 1, cost: { wood: 3, stone: 3 }, lvl: 1 },
  { out: 'b_torch', n: 2, cost: { wood: 1, fiber: 1 }, lvl: 1 },
  { out: 'b_bed', n: 1, cost: { cloth: 5 }, lvl: 1 },
  { out: 'b_box', n: 1, cost: { wood: 10 }, lvl: 1 },
  { out: 'b_bench', n: 1, cost: { wood: 12, stone: 4 }, lvl: 1 },
  { out: 'bpotato', n: 1, cost: { potato: 1 }, lvl: 1, station: 'fire' },
  { out: 'tea', n: 1, cost: { fiber: 2, berries: 2 }, lvl: 1, station: 'fire' },
  { out: 'stew', n: 1, cost: { potato: 2, berries: 3 }, lvl: 2, station: 'fire' },
  { out: 'bat', n: 1, cost: { wood: 6 }, lvl: 2, station: 'bench' },
  { out: 'b_farm', n: 1, cost: { wood: 4, potato: 1 }, lvl: 2, station: 'bench' },
  { out: 'b_collector', n: 1, cost: { wood: 6, cloth: 2 }, lvl: 2, station: 'bench' },
  { out: 'b_forge', n: 1, cost: { stone: 20, wood: 4 }, lvl: 2, station: 'bench' },
  { out: 'b_spikes', n: 2, cost: { wood: 4, scrap: 2 }, lvl: 3, station: 'bench' },
  { out: 'b_stone', n: 1, cost: { stone: 5, wood: 1 }, lvl: 3, station: 'bench' },
  { out: 'iron', n: 1, cost: { ore: 2, wood: 1 }, lvl: 2, station: 'forge' },
  { out: 'iron', n: 1, cost: { scrap: 3 }, lvl: 2, station: 'forge' },
  { out: 'medkit', n: 1, cost: { bandage: 3, iron: 1 }, lvl: 4, station: 'bench' },
  { out: 'ipick', n: 1, cost: { iron: 5, wood: 2 }, lvl: 4, station: 'forge' },
  { out: 'iaxe', n: 1, cost: { iron: 5, wood: 2 }, lvl: 4, station: 'forge' },
  { out: 'machete', n: 1, cost: { iron: 4, wood: 1 }, lvl: 5, station: 'forge' },
  { out: 'b_metal', n: 1, cost: { iron: 3 }, lvl: 5, station: 'forge' },
  { out: 'b_mdoor', n: 1, cost: { iron: 6 }, lvl: 5, station: 'forge' },
  { out: 'a9', n: 10, cost: { iron: 1, scrap: 1 }, lvl: 5, station: 'bench' },
  { out: 'a12', n: 5, cost: { iron: 1, cloth: 1 }, lvl: 6, station: 'bench' },
  { out: 'pistol', n: 1, cost: { iron: 8, scrap: 4 }, lvl: 7, station: 'bench' },
  { out: 'a762', n: 10, cost: { iron: 2, scrap: 1 }, lvl: 8, station: 'bench' },
  { out: 'shotgun', n: 1, cost: { iron: 12, wood: 4 }, lvl: 9, station: 'bench' },
  { out: 'rifle', n: 1, cost: { iron: 18, trophy: 1 }, lvl: 12, station: 'bench' },
  { out: 'a308', n: 5, cost: { iron: 3 }, lvl: 12, station: 'bench' },
  { out: 'a939', n: 10, cost: { iron: 2, scrap: 2 }, lvl: 11, station: 'bench' },
  { out: 'asval', n: 1, cost: { iron: 20, trophy: 1, cloth: 2 }, lvl: 13, station: 'bench' },
  { out: 'sniper', n: 1, cost: { iron: 22, trophy: 2 }, lvl: 15, station: 'bench' },
];

// Задания выживания — подсказывают, что делать дальше, и дают опыт
export const QUESTS = [
  { id: 'wood', text: 'Добудь 20 древесины (бей деревья)', stat: 'wood', need: 20, xp: 30 },
  { id: 'stone', text: 'Добудь 15 камня (бей камни)', stat: 'stone', need: 15, xp: 30 },
  { id: 'tool', text: 'Скрафти топор или кирку (Tab)', stat: 'tool', need: 1, xp: 40 },
  { id: 'fiber', text: 'Собери 8 волокна с кустов', stat: 'fiber', need: 8, xp: 30 },
  { id: 'bench', text: 'Построй верстак', stat: 'place_bench', need: 1, xp: 60 },
  { id: 'base', text: 'Поставь 20 строительных блоков', stat: 'place', need: 20, xp: 100 },
  { id: 'kill', text: 'Убей 25 зомби', stat: 'kills', need: 25, xp: 100 },
  { id: 'ore', text: 'Добудь 10 железной руды киркой', stat: 'ore', need: 10, xp: 60 },
  { id: 'forge', text: 'Построй кузницу и выплавь железо', stat: 'iron', need: 1, xp: 100 },
  { id: 'farm', text: 'Посади грядку и собери урожай', stat: 'harvest', need: 1, xp: 120 },
  { id: 'horde', text: 'Переживи кровавую луну (7-я ночь)', stat: 'horde', need: 1, xp: 400 },
  { id: 'boss', text: 'Убей босса (логова отмечены на карте)', stat: 'boss', need: 1, xp: 400 },
  { id: 'day14', text: 'Проживи 14 дней', stat: 'day', need: 14, xp: 500 },
  { id: 'boss3', text: 'Убей 3 боссов', stat: 'boss', need: 3, xp: 800 },
  { id: 'day28', text: 'Проживи 28 дней', stat: 'day', need: 28, xp: 1500 },
];

// опыт: сколько нужно до следующего уровня
export function xpNeed(level) { return 100 + (level - 1) * 80; }

export function perks(level) {
  return {
    maxHp: 100 + (level - 1) * 3,
    melee: 1 + (level - 1) * 0.025,
    gun: 1 + (level - 1) * 0.02,
    stamina: 100 + (level - 1) * 2,
  };
}
