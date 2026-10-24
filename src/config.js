// Общие константы игры и описание уровней (карт).
export const VERSION = '1.0.0';
export const NET_PREFIX = 'mkrai-v1-';

export const WORLD_SIZE = 3000;          // метров по каждой стороне
export const HALF = WORLD_SIZE / 2;
export const CHUNK = 100;                // размер чанка, м
export const TSTEP = 4;                  // шаг сетки рельефа, м
export const SEG = CHUNK / TSTEP;
export const SEA = 0;                    // уровень воды
export const BLOCK = 2;                  // размер строительного блока, м
export const MAX_PLAYERS = 10;
export const DAY_SECONDS = 1440;         // 24 минуты = игровые сутки
export const HORDE_EVERY = 7;            // кровавая луна каждую 7-ю ночь
export const GRAVITY = 20;

export const LEVELS = [
  {
    id: 'valley', name: 'Зелёная долина', tag: 'Уровень 1', difficulty: 1, seed: 74121,
    desc: 'Хвойные леса, озёра и тихие деревни. Зомби медленные, еды хватает. Лучшее место, чтобы начать.',
    biome: 'forest',
    colors: {
      grass: 0x6fa54c, grass2: 0x5f9842, dirt: 0x8d6b45, sand: 0xd9c98f, rock: 0x8b8b88, snow: 0xf2f5f7,
      road: 0x4b4b4d, town: 0x85807a, water: 0x3f86bf, seabed: 0xb8a675,
    },
    sky: { day: 0x9fcff0, dusk: 0xe9a374, night: 0x0c1526 },
    trees: { density: 1.0, types: ['pine', 'pine', 'oak', 'birch'] },
    mountains: 0.85, snowLine: 70, towns: 12, cityR: 150, cabins: 34,
    zombie: { count: 8, hp: 1.0, dmg: 1.0, speed: 1.0, runner: 0.07, tank: 0.03, soldier: 0.02 },
    loot: 1.25,
  },
  {
    id: 'wastes', name: 'Выжженные земли', tag: 'Уровень 2', difficulty: 2, seed: 99173,
    desc: 'Пустыня, столовые горы и брошенные блокпосты. Бегуны встречаются чаще, воды мало.',
    biome: 'desert',
    colors: {
      grass: 0xcfae69, grass2: 0xc4a15c, dirt: 0xa5744c, sand: 0xe2cb90, rock: 0xb3734b, snow: 0xe9d3b3,
      road: 0x524c48, town: 0x948572, water: 0x3f93ab, seabed: 0xcdb07a,
    },
    sky: { day: 0xc4dbe9, dusk: 0xf0a362, night: 0x130f1d },
    trees: { density: 0.22, types: ['cactus', 'cactus', 'dead', 'palm'] },
    mountains: 1.15, snowLine: 999, towns: 11, cityR: 150, cabins: 26,
    zombie: { count: 11, hp: 1.25, dmg: 1.2, speed: 1.1, runner: 0.2, tank: 0.06, soldier: 0.06 },
    loot: 1.0,
  },
  {
    id: 'winter', name: 'Мёртвая зима', tag: 'Уровень 3', difficulty: 3, seed: 31337,
    desc: 'Заснеженные горы и огромный мёртвый город. Танки, орды и мало патронов. Только для опытных.',
    biome: 'snow',
    colors: {
      grass: 0xe9eff3, grass2: 0xdbe4eb, dirt: 0x8b7b6b, sand: 0xc9c1b1, rock: 0x6f7780, snow: 0xffffff,
      road: 0x3f4145, town: 0x9b9fa5, water: 0x2f6283, seabed: 0x8b8b81,
    },
    sky: { day: 0xc9d5df, dusk: 0xb9a1b1, night: 0x080c15 },
    trees: { density: 0.9, types: ['snowpine', 'snowpine', 'pine', 'dead'] },
    mountains: 1.5, snowLine: 18, towns: 12, cityR: 250, cabins: 30,
    zombie: { count: 14, hp: 1.6, dmg: 1.5, speed: 1.15, runner: 0.25, tank: 0.1, soldier: 0.08 },
    loot: 0.8,
  },
];

export function levelById(id) {
  return LEVELS.find(l => l.id === id) || LEVELS[0];
}

export const DEFAULT_SETTINGS = {
  view: 4,          // радиус прорисовки в чанках
  shadows: true,
  sens: 1.0,
  fov: 75,
  volume: 0.7,
  scale: 1.0,       // масштаб рендера
};
