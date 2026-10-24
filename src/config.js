// Общие константы игры, биомы острова и уровни сложности.
export const VERSION = '1.3.5';
export const NET_PREFIX = 'mkrai-v1-';

export const WORLD_SIZE = 3000;          // метров по каждой стороне
export const HALF = WORLD_SIZE / 2;
export const CHUNK = 100;                // размер чанка, м
export const SEG = 45;                   // клеток рельефа по стороне чанка (в каждой 2 треугольника)
export const TSTEP = CHUNK / SEG;        // шаг сетки рельефа, м
export const SEA = 0;                    // уровень воды
export const BLOCK = 2;                  // размер строительного блока, м
export const MAX_PLAYERS = 10;
export const DAY_SECONDS = 1200;         // 20 минут = игровые сутки
export const SUNRISE = 0.22;             // доли суток: рассвет и закат
export const SUNSET = 0.84;
export const HORDE_EVERY = 7;            // кровавая луна каждую 7-ю ночь
export const GRAVITY = 20;
export const WORLD_ID = 'island';
export const WORLD_SEED = 74121;

// Биомы одного большого острова: север — снега, центр — леса, юг — пустыня.
// danger — уровень опасности зоны: сильнее зомби, но и лут лучше.
export const BIOMES = {
  forest: {
    name: 'Лес', danger: 1,
    colors: {
      grass: 0x6fa54c, grass2: 0x5f9842, dirt: 0x8d6b45, sand: 0xd9c98f, rock: 0x8b8b88, snow: 0xf2f5f7,
      road: 0x4b4b4d, town: 0x85807a, seabed: 0xb8a675,
    },
    sky: { day: 0x9fcff0, zenith: 0x5a9ad8, dusk: 0xe9a374, night: 0x0c1526 },
    trees: { density: 1.0, types: ['pine', 'pine', 'oak', 'birch'] },
    mountains: 0.85, snowLine: 70,
    zombie: { count: 8, hp: 1.0, dmg: 1.0, speed: 1.0, runner: 0.07, tank: 0.03, soldier: 0.02 },
    loot: 1.15,
  },
  desert: {
    name: 'Пустыня', danger: 2,
    colors: {
      grass: 0xcfae69, grass2: 0xc4a15c, dirt: 0xa5744c, sand: 0xe2cb90, rock: 0xb3734b, snow: 0xe9d3b3,
      road: 0x524c48, town: 0x948572, seabed: 0xcdb07a,
    },
    sky: { day: 0xc4dbe9, zenith: 0x6aa0d0, dusk: 0xf0a362, night: 0x130f1d },
    trees: { density: 0.22, types: ['cactus', 'cactus', 'dead', 'palm'] },
    mountains: 1.0, snowLine: 999,
    zombie: { count: 11, hp: 1.25, dmg: 1.2, speed: 1.1, runner: 0.2, tank: 0.06, soldier: 0.06 },
    loot: 1.1,
  },
  snow: {
    name: 'Снега', danger: 3,
    colors: {
      grass: 0xe9eff3, grass2: 0xdbe4eb, dirt: 0x8b7b6b, sand: 0xc9c1b1, rock: 0x6f7780, snow: 0xffffff,
      road: 0x3f4145, town: 0x9b9fa5, seabed: 0x8b8b81,
    },
    sky: { day: 0xc9d5df, zenith: 0x7a9cc0, dusk: 0xb9a1b1, night: 0x080c15 },
    trees: { density: 0.9, types: ['snowpine', 'snowpine', 'pine', 'dead'] },
    mountains: 1.5, snowLine: -999,
    zombie: { count: 13, hp: 1.55, dmg: 1.4, speed: 1.12, runner: 0.24, tank: 0.1, soldier: 0.08 },
    loot: 1.3,
  },
};
export const BIOME_IDS = ['forest', 'desert', 'snow'];
export const WATER_COLOR = 0x3f86bf;

export const DIFFICULTIES = [
  { id: 'easy', name: 'Лёгкая', level: 1, desc: 'Меньше зомби, они слабее. Лута больше.', zombie: { count: 0.75, hp: 0.8, dmg: 0.7, speed: 0.95 }, loot: 1.3 },
  { id: 'normal', name: 'Нормальная', level: 2, desc: 'Как задумано.', zombie: { count: 1, hp: 1, dmg: 1, speed: 1 }, loot: 1 },
  { id: 'hard', name: 'Тяжёлая', level: 3, desc: 'Больше зомби, они злее и быстрее. Лута меньше.', zombie: { count: 1.35, hp: 1.3, dmg: 1.35, speed: 1.08 }, loot: 0.85 },
];

// описание мира для генератора и игры; test — тестовый мир: тот же остров, отдельное сохранение,
// бесконечные патроны и все стволы со старта
export function makeLevel(diffId = 'normal', test = false) {
  const d = DIFFICULTIES.find(x => x.id === diffId) || DIFFICULTIES[1];
  return {
    id: test ? 'test' : WORLD_ID, name: test ? 'Тестовый мир' : 'Остров', seed: WORLD_SEED, diff: d, difficulty: d.level,
    towns: 15, cabins: 40, test, infAmmo: test,
  };
}

export const DEFAULT_SETTINGS = {
  view: 4,          // радиус прорисовки в чанках
  shadows: true,
  sens: 1.0,
  fov: 75,
  volume: 0.7,
  scale: 1.0,       // масштаб рендера
};
