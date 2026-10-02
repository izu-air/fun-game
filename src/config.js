// Все балансные константы игры в одном месте.

export const SAVE_KEY = 'meowGun.save.v1';
export const SAVE_VERSION = 3;

export const ENEMIES_PER_STAGE = 10;
export const BOSS_EVERY = 5;
export const BOSS_TIME_LIMIT = 30; // секунд
export const CHAPTER_BOSS_TIME_LIMIT = 45; // героиня главы сильнее и со способностями — даём больше времени
export const MAX_ALIVE_ENEMIES = 6;
export const SPAWN_INTERVAL = 0.8; // минимальное время убийства цели (для оффлайн-оценки)
export const MARCH_SPEED = 70; // скорость движения отряда, пикс/с
export const SPAWN_GAP = [110, 170]; // расстояние между целями на пути, пикс

export const OFFLINE_MAX_SECONDS = 8 * 60 * 60;
export const OFFLINE_EFFICIENCY = 0.5;
export const OFFLINE_MIN_SECONDS = 60;

export const PRESTIGE_MIN_STAGE = 25;
export const BONE_BONUS = 0.1; // +10% урона и золота за косточку

export const ENEMY = {
  baseHp: 6,
  hpGrowth: 1.26,
  baseDamage: 3,
  damageGrowth: 1.11,
  baseGold: 1.5,
  goldGrowth: 1.15,
  attackInterval: 1.0,
  boss: { hpMult: 15, damageMult: 3, goldMult: 8 },
};

// Типы врагов: множители относительно базовых значений этапа.
// size — полуширина силуэта, height — высота в долях size, reach — дистанция удара (пикс).
// Враги — воительницы Звёздной Академии (см. src/story.js).
export const ENEMY_TYPES = {
  ninja:  { name: 'Ниндзя', girl: true, hp: 0.7, damage: 0.7, gold: 0.8, speed: 78, size: 14, height: 3.4, reach: 30, weight: 5 },
  sword:  { name: 'Мечница', girl: true, hp: 1.0, damage: 1.0, gold: 1.0, speed: 55, size: 16, height: 3.4, reach: 36, weight: 4 },
  knight: { name: 'Рыцарша', girl: true, hp: 2.0, damage: 1.5, gold: 2.0, speed: 38, size: 19, height: 3.3, reach: 40, weight: 2, minStage: 4 },
  // Волшебница держит дистанцию и бросает магические сферы.
  mage:   { name: 'Волшебница', girl: true, hp: 0.9, damage: 0.8, gold: 1.4, speed: 45, size: 15, height: 3.4, weight: 2, minStage: 7,
    ranged: { range: 190, interval: 2.2, speed: 170 } },
  boss:   { name: 'Капитан', girl: true, hp: 1.0, damage: 1.0, gold: 1.0, speed: 22, size: 28, height: 3.3, reach: 56, weight: 0 },
  // Препятствия стоят на месте и не атакуют, но преграждают путь отряду.
  tree:  { name: 'Дерево', hp: 1.6, damage: 0, gold: 1.3, speed: 0, size: 30, weight: 4, obstacle: true, height: 2.6 },
  rock:  { name: 'Камень', hp: 2.4, damage: 0, gold: 1.8, speed: 0, size: 26, weight: 2, obstacle: true, minStage: 3, height: 1.35 },
  crate: { name: 'Ящик с оружием', hp: 1.2, damage: 0, gold: 0.5, speed: 0, size: 22, weight: 1, obstacle: true, minStage: 2, dropsGun: true, height: 1.7 },
  // Редкая золотая мышь: убегает назад, если не успеть подстрелить.
  goldMouse: { name: 'Золотая мышь', hp: 1.5, damage: 0, gold: 12, speed: 90, size: 18, weight: 0.25, minStage: 4, runner: true, height: 1.2 },
};

export const HERO = {
  baseDamage: 4, // урон пистолета 1-го уровня
  baseFireRate: 1.5,
  fireRatePerLevel: 0.08,
  baseHp: 60,
  hpPerLevel: 0.25,
  regenPerLevel: 0.0025, // доля от макс. HP в секунду
  critChancePerLevel: 0.0125,
  baseCritMult: 1.5,
  critMultPerLevel: 0.1,
  goldPerLevel: 0.1,
  milestoneEvery: 25, // каждые N уровней урон и HP удваиваются
  bulletSpeed: 620,
};

export const UPGRADES = {
  damage:     { name: 'Урон',             icon: '🔫', baseCost: 5,  growth: 1.16 },
  fireRate:   { name: 'Скорострельность', icon: '⚡', baseCost: 12, growth: 1.21, maxLevel: 60 },
  maxHp:      { name: 'Здоровье',         icon: '❤️', baseCost: 8,  growth: 1.16 },
  regen:      { name: 'Регенерация',      icon: '💚', baseCost: 20, growth: 1.19, maxLevel: 40 },
  critChance: { name: 'Шанс крита',       icon: '🎯', baseCost: 30, growth: 1.24, maxLevel: 40 },
  critDamage: { name: 'Сила крита',       icon: '💥', baseCost: 40, growth: 1.22 },
  goldBonus:  { name: 'Жадность',         icon: '💰', baseCost: 25, growth: 1.25 },
  forge:      { name: 'Кузня',            icon: '⚒️', baseCost: 500, growth: 6, maxLevel: 12 },
};

// ---------- Взаимодействия ----------
export const TAP = {
  dpsShare: 0.25, // удар лапкой = 25% урона отряда в секунду
  cooldown: 0.08, // не чаще ~12 ударов в секунду
  radius: 70, // насколько близко к врагу нужно нажать
};
export const PET = {
  duration: 6, // сколько секунд котик доволен
  cooldown: 10, // как часто одного котика можно гладить
  fireRateMult: 1.25,
};

// ---------- Аниме-скины котиков ----------
// Скин надевается на одного котика; бонус действует, пока этот котик в отряде с пушкой.
export const SKINS = {
  samurai:  { name: 'Самурай лепестков', from: 'Сакура',  bonus: { teamDamage: 0.08 }, desc: '+8% урона отряду' },
  kunoichi: { name: 'Куноичи пустыни',   from: 'Аяме',    bonus: { critChance: 0.04 }, desc: '+4% шанс крита' },
  snowmage: { name: 'Снежный маг',       from: 'Юки',     bonus: { fireRate: 0.08 },   desc: '+8% скорострельности' },
  mecha:    { name: 'Мех-пилот',         from: 'Рин',     bonus: { maxHp: 0.25 },      desc: '+25% здоровья отряда' },
  kitsune:  { name: 'Кицунэ',            from: 'Микото',  bonus: { gold: 0.15 },       desc: '+15% золота' },
  moonlord: { name: 'Лунный владыка',    from: 'Луна',    bonus: { teamDamage: 0.15, critChance: 0.03 }, desc: '+15% урона и +3% крита' },
  idol:     { name: 'Звезда сцены',      from: 'задания', bonus: { gold: 0.1, fireRate: 0.04 }, desc: '+10% золота и +4% скорострельности',
    questsNeeded: 8 },
};

// ---------- Задания ----------
// base — цель первого задания; цели растут на 50% каждые 6 выполненных заданий.
export const QUEST_TYPES = {
  kills:     { base: 30, keys: 1, text: (n) => `Победи ${n} воительниц` },
  taps:      { base: 40, keys: 1, text: (n) => `Нанеси ${n} ударов лапкой` },
  obstacles: { base: 15, keys: 1, text: (n) => `Разрушь ${n} препятствий` },
  merges:    { base: 5,  keys: 1, text: (n) => `Слей ${n} пушек` },
  pets:      { base: 5,  keys: 1, text: (n) => `Погладь котиков ${n} раз` },
  cases:     { base: 2,  keys: 2, text: (n) => `Открой ${n} кейса` },
  bosses:    { base: 2,  keys: 2, text: (n) => `Победи ${n} боссов` },
  goldMice:  { base: 1,  keys: 2, text: (n) => `Поймай золотую мышь: ${n}` },
};
export const ACTIVE_QUESTS = 3;
export const QUEST_GOLD_SECONDS = 45; // золото в награду = столько секунд дохода

// ---------- Оружие ----------
// 30 уровней: 6 семейств × 5 редкостей. Каждое слияние двух одинаковых пушек даёт уровень +1.
export const GUN_FAMILIES = [
  { key: 'pistol',  name: 'Пистолет',  rate: 1.0, damage: 1.0,  pellets: 1, pierce: 0 },
  { key: 'smg',     name: 'Автомат',   rate: 2.2, damage: 0.52, pellets: 1, pierce: 0 },
  { key: 'shotgun', name: 'Дробовик',  rate: 0.75, damage: 0.48, pellets: 3, pierce: 0 },
  { key: 'rifle',   name: 'Винтовка',  rate: 1.1, damage: 1.05, pellets: 1, pierce: 0 },
  { key: 'sniper',  name: 'Снайперка', rate: 0.45, damage: 2.7, pellets: 1, pierce: 1 },
  { key: 'minigun', name: 'Миниган',   rate: 4.5, damage: 0.28, pellets: 1, pierce: 0 },
];
export const RARITIES = [
  { name: 'обычный',     color: '#b8c0cc' },
  { name: 'необычный',   color: '#5bd16a' },
  { name: 'редкий',      color: '#4aa8ff' },
  { name: 'эпический',   color: '#b46cff' },
  { name: 'легендарный', color: '#ffb800' },
];
export const MAX_GUN_TIER = GUN_FAMILIES.length * RARITIES.length;
export const GUN_TIER_POWER = 1.75; // множитель урона за уровень пушки
export const GUN_COST = { base: 15, growth: 1.09 }; // цена n-й купленной пушки
export const INVENTORY_SIZE = 12;
export const CRATE_GUN_CHANCE = 0.6;

// ---------- Кейсы ----------
// odds: [бонус к уровню пушки относительно Кузни, вес]. Бонус ≥ jackpotBonus — суперприз.
export const CASES = {
  common: {
    name: 'Обычный кейс', icon: '📦', currency: 'gold',
    priceMult: 3, // цена = 3 × цена обычной пушки
    gunsBoughtStep: 2, // открытие дорожает так же, как покупка двух пушек
    odds: [[0, 60], [1, 25], [2, 10], [3, 4], [5, 1]],
    pity: { every: 10, minBonus: 3 }, // каждый 10-й кейс без крупного выигрыша — гарантированно +3 и выше
  },
  golden: {
    name: 'Золотой кейс', icon: '🎁', currency: 'keys', price: 1,
    odds: [[1, 50], [2, 30], [3, 14], [4, 5], [6, 1]],
  },
};
export const JACKPOT_BONUS = 5;
export const KEYS = { boss: 1, bigBoss: 2, goldMouseChance: 0.25, start: 1 }; // bigBoss — каждый 10-й этап

// ---------- Скорость игры ----------
export const GAME_SPEEDS = [1, 2, 3, 5];
export const SPEED_UNLOCK = { 5: 'prestige' }; // ×5 — награда за первое перерождение

// ---------- Отряд ----------
export const CATS = [
  { key: 'ryzhik', name: 'Рыжик', fur: '#f4a442', furDark: '#d9822b', belly: '#fff1dc', band: '#e63946',
    bonus: 'Лидер: +10% урона отряду', unlockStage: 1, teamDamage: 0.1, emoji: '😼' },
  { key: 'snezhok', name: 'Снежок', fur: '#eef1f6', furDark: '#b9c2d0', belly: '#ffffff', band: '#3a86ff',
    bonus: 'Меткий глаз: +5% шанс крита', unlockStage: 6, critChance: 0.05, emoji: '😺' },
  { key: 'ugolek', name: 'Уголёк', fur: '#3b3b46', furDark: '#22222a', belly: '#5a5a68', band: '#2ec27e',
    bonus: 'Быстрые лапки: +15% скорострельности', unlockStage: 16, fireRate: 0.15, emoji: '😾' },
];

export const SKILLS = {
  volley: { name: 'Рыбный залп',    icon: '🐟', desc: 'Скорострельность ×3 на 6 с', duration: 6, cooldown: 30, unlockStage: 3, fireRateMult: 3 },
  rage:   { name: 'Кошачья ярость', icon: '😾', desc: 'Урон ×2.5 на 8 с',          duration: 8, cooldown: 45, unlockStage: 8, damageMult: 2.5 },
  purr:   { name: 'Мурчание',       icon: '💤', desc: 'Лечит 50% здоровья',        duration: 0, cooldown: 40, unlockStage: 15, healPct: 0.5 },
};

export const BIOMES = [
  { name: 'Лес',     sky: ['#8fd3ff', '#d9f2ff'], ground: '#6cbf4a', groundDark: '#4e9a33', decor: 'garden', tree: '#3f8f3a' },
  { name: 'Пустыня', sky: ['#ffb88c', '#ffe1c4'], ground: '#e2b66b', groundDark: '#c99a4e', decor: 'desert', tree: '#5f9e4a' },
  { name: 'Снежные горы', sky: ['#a9c7e8', '#eef5ff'], ground: '#f2f6fb', groundDark: '#c9d6e6', decor: 'snow', tree: '#2f6f5a' },
  { name: 'Город',   sky: ['#ff9e7a', '#ffd9b8'], ground: '#9a9a9a', groundDark: '#777777', decor: 'city', tree: '#4c8a3c' },
  { name: 'Крыши',   sky: ['#1d2b53', '#4b3b75'], ground: '#7a4b3a', groundDark: '#5a3528', decor: 'roofs', tree: '#2e5a3a' },
  { name: 'Космос',  sky: ['#05030f', '#24164a'], ground: '#5c5f7a', groundDark: '#3f4157', decor: 'space', tree: '#6a4fa0' },
];
export const STAGES_PER_BIOME = 10;
