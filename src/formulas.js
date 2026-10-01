// Чистые функции баланса: без DOM и без состояния — их проверяют тесты и симуляция.
import {
  ENEMY, ENEMY_TYPES, HERO, UPGRADES, BOSS_EVERY, BONE_BONUS,
  PRESTIGE_MIN_STAGE, BIOMES, STAGES_PER_BIOME,
} from './config.js';

export const isBossStage = (stage) => stage % BOSS_EVERY === 0;

export function biomeFor(stage) {
  return BIOMES[Math.floor((stage - 1) / STAGES_PER_BIOME) % BIOMES.length];
}

// ---------- Враги ----------
export function enemyHp(stage, type = 'rat') {
  const base = ENEMY.baseHp * ENEMY.hpGrowth ** (stage - 1);
  const mult = type === 'boss' ? ENEMY.boss.hpMult : ENEMY_TYPES[type].hp;
  return base * mult;
}

export function enemyDamage(stage, type = 'rat') {
  const base = ENEMY.baseDamage * ENEMY.damageGrowth ** (stage - 1);
  const mult = type === 'boss' ? ENEMY.boss.damageMult : ENEMY_TYPES[type].damage;
  return base * mult;
}

export function enemyGold(stage, type = 'rat') {
  const base = ENEMY.baseGold * ENEMY.goldGrowth ** (stage - 1);
  const mult = type === 'boss' ? ENEMY.boss.goldMult : ENEMY_TYPES[type].gold;
  return base * mult;
}

// Выбор типа врага по весам; rand — функция [0,1) для детерминированных тестов.
export function pickEnemyType(stage, rand = Math.random) {
  const pool = Object.entries(ENEMY_TYPES)
    .filter(([, t]) => t.weight > 0 && (t.minStage ?? 1) <= stage);
  const total = pool.reduce((s, [, t]) => s + t.weight, 0);
  let r = rand() * total;
  for (const [key, t] of pool) {
    r -= t.weight;
    if (r < 0) return key;
  }
  return pool[pool.length - 1][0];
}

// ---------- Улучшения ----------
export function upgradeCost(key, level) {
  const u = UPGRADES[key];
  return Math.ceil(u.baseCost * u.growth ** level);
}

export function isMaxed(key, level) {
  const max = UPGRADES[key].maxLevel;
  return max !== undefined && level >= max;
}

// Сколько уровней можно купить на gold (не больше limit) и сколько это стоит.
export function bulkPurchase(key, level, gold, limit = Infinity) {
  const max = UPGRADES[key].maxLevel ?? Infinity;
  let count = 0;
  let cost = 0;
  while (count < limit && level + count < max) {
    const next = upgradeCost(key, level + count);
    if (cost + next > gold) break;
    cost += next;
    count++;
  }
  return { count, cost };
}

const milestone = (level) => 2 ** Math.floor(level / HERO.milestoneEvery);

export const boneMultiplier = (bones) => 1 + bones * BONE_BONUS;

// Итоговые характеристики котика из уровней улучшений и косточек.
export function heroStats(levels, bones = 0) {
  const l = (k) => levels[k] ?? 0;
  const maxHp = HERO.baseHp * (1 + HERO.hpPerLevel * l('maxHp')) * milestone(l('maxHp'));
  return {
    damage: HERO.baseDamage * (1 + l('damage')) * milestone(l('damage')) * boneMultiplier(bones),
    fireRate: HERO.baseFireRate + HERO.fireRatePerLevel * l('fireRate'),
    maxHp,
    regen: maxHp * HERO.regenPerLevel * l('regen'),
    critChance: Math.min(0.5, HERO.critChancePerLevel * l('critChance')),
    critMult: HERO.baseCritMult + HERO.critMultPerLevel * l('critDamage'),
    goldMult: (1 + HERO.goldPerLevel * l('goldBonus')) * boneMultiplier(bones),
  };
}

// Средний урон в секунду с учётом критов.
export function expectedDps(stats, damageMult = 1, fireRateMult = 1) {
  const critFactor = 1 + stats.critChance * (stats.critMult - 1);
  return stats.damage * damageMult * stats.fireRate * fireRateMult * critFactor;
}

// ---------- Перерождение ----------
export function bonesForPrestige(maxStage) {
  if (maxStage < PRESTIGE_MIN_STAGE) return 0;
  return Math.floor(((maxStage - 20) / 5) ** 1.6);
}

// ---------- Оффлайн-доход ----------
// Приблизительное золото в секунду при фарме обычного этапа.
export function idleGoldPerSecond(stage, stats, spawnInterval) {
  const farmStage = isBossStage(stage) ? Math.max(1, stage - 1) : stage;
  const killTime = Math.max(enemyHp(farmStage) / expectedDps(stats), spawnInterval);
  return (enemyGold(farmStage) * stats.goldMult) / killTime;
}

// ---------- Форматирование чисел ----------
const SUFFIXES = ['', 'K', 'M', 'B', 'T'];
function suffixFor(tier) {
  if (tier < SUFFIXES.length) return SUFFIXES[tier];
  // aa, ab, ... для очень больших чисел
  const i = tier - SUFFIXES.length;
  return String.fromCharCode(97 + (Math.floor(i / 26) % 26)) + String.fromCharCode(97 + (i % 26));
}

export function formatNumber(n) {
  if (!Number.isFinite(n)) return '∞';
  if (n < 0) return '-' + formatNumber(-n);
  if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
  let tier = Math.floor(Math.log10(n) / 3);
  let scaled = n / 1000 ** tier;
  const digitsFor = (v) => (v < 10 ? 2 : v < 100 ? 1 : 0);
  // 999.96K не должно превращаться в «1000K»
  if (Number(scaled.toFixed(digitsFor(scaled))) >= 1000) {
    tier++;
    scaled /= 1000;
  }
  return scaled.toFixed(digitsFor(scaled)) + suffixFor(tier);
}

export function formatDuration(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин ${s % 60} с`;
  return `${s} с`;
}
