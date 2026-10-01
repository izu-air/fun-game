// Все балансные константы игры в одном месте.

export const SAVE_KEY = 'meowGun.save.v1';
export const SAVE_VERSION = 1;

export const ENEMIES_PER_STAGE = 10;
export const BOSS_EVERY = 5;
export const BOSS_TIME_LIMIT = 30; // секунд
export const MAX_ALIVE_ENEMIES = 6;
export const SPAWN_INTERVAL = 0.8; // секунд между появлениями врагов

export const OFFLINE_MAX_SECONDS = 8 * 60 * 60;
export const OFFLINE_EFFICIENCY = 0.5;
export const OFFLINE_MIN_SECONDS = 60;

export const PRESTIGE_MIN_STAGE = 25;
export const BONE_BONUS = 0.1; // +10% урона и золота за косточку

export const ENEMY = {
  baseHp: 6,
  hpGrowth: 1.21,
  baseDamage: 3,
  damageGrowth: 1.11,
  baseGold: 1.5,
  goldGrowth: 1.15,
  attackInterval: 1.0,
  boss: { hpMult: 15, damageMult: 3, goldMult: 8 },
};

// Типы врагов: множители относительно базовых значений этапа.
export const ENEMY_TYPES = {
  mouse: { name: 'Мышь', hp: 0.7, damage: 0.7, gold: 0.8, speed: 75, size: 18, weight: 5 },
  rat:   { name: 'Крыса', hp: 1.0, damage: 1.0, gold: 1.0, speed: 55, size: 23, weight: 4 },
  dog:   { name: 'Пёс',  hp: 2.0, damage: 1.5, gold: 2.0, speed: 38, size: 30, weight: 2, minStage: 4 },
  boss:  { name: 'Босс', hp: 1.0, damage: 1.0, gold: 1.0, speed: 22, size: 54, weight: 0 },
};

export const HERO = {
  baseDamage: 4,
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
};

export const SKILLS = {
  volley: { name: 'Рыбный залп',    icon: '🐟', desc: 'Скорострельность ×3 на 6 с', duration: 6, cooldown: 30, unlockStage: 3, fireRateMult: 3 },
  rage:   { name: 'Кошачья ярость', icon: '😾', desc: 'Урон ×2.5 на 8 с',          duration: 8, cooldown: 45, unlockStage: 8, damageMult: 2.5 },
  purr:   { name: 'Мурчание',       icon: '💤', desc: 'Лечит 50% здоровья',        duration: 0, cooldown: 40, unlockStage: 15, healPct: 0.5 },
};

export const BIOMES = [
  { name: 'Сад',           sky: ['#8fd3ff', '#d9f2ff'], ground: '#6cbf4a', groundDark: '#4e9a33', decor: 'garden' },
  { name: 'Город',         sky: ['#ffb88c', '#ffe1c4'], ground: '#9a9a9a', groundDark: '#777777', decor: 'city' },
  { name: 'Крыши',       sky: ['#1d2b53', '#4b3b75'], ground: '#7a4b3a', groundDark: '#5a3528', decor: 'roofs' },
  { name: 'Космос',        sky: ['#05030f', '#24164a'], ground: '#5c5f7a', groundDark: '#3f4157', decor: 'space' },
];
export const STAGES_PER_BIOME = 10;
