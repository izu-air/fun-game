// Чистые функции баланса: без DOM и без состояния — их проверяют тесты и симуляция.
import {
  ENEMY, ENEMY_TYPES, HERO, UPGRADES, BOSS_EVERY, BONE_BONUS,
  PRESTIGE_MIN_STAGE, BIOMES, STAGES_PER_BIOME, GUN_FAMILIES, RARITIES, MAX_GUN_TIER,
  GUN_TIER_POWER, GUN_COST, CATS, CASES, SKINS, BOSS_ABILITIES, MARCH_SPEED, SPAWN_GAP, SPAWN_INTERVAL, BONES,
} from './config.js';

export const isBossStage = (stage) => stage % BOSS_EVERY === 0;

export function biomeFor(stage) {
  return BIOMES[Math.floor((stage - 1) / STAGES_PER_BIOME) % BIOMES.length];
}

// ---------- Враги ----------
export function enemyHp(stage, type = 'sword') {
  const base = ENEMY.baseHp * ENEMY.hpGrowth ** (stage - 1);
  const mult = type === 'boss' ? ENEMY.boss.hpMult : ENEMY_TYPES[type].hp;
  return base * mult;
}

export function enemyDamage(stage, type = 'sword') {
  const base = ENEMY.baseDamage * ENEMY.damageGrowth ** (stage - 1);
  const mult = type === 'boss' ? ENEMY.boss.damageMult : ENEMY_TYPES[type].damage;
  return base * mult;
}

export function enemyGold(stage, type = 'sword') {
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

// Базовые характеристики из улучшений и косточек (для пистолета 1-го уровня).
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

// ---------- Оружие ----------
export function gunInfo(tier) {
  const t = Math.max(1, Math.min(MAX_GUN_TIER, tier));
  const family = GUN_FAMILIES[Math.floor((t - 1) / RARITIES.length)];
  const rarity = RARITIES[(t - 1) % RARITIES.length];
  return {
    tier: t,
    family,
    rarity,
    name: `${family.name} ${(t - 1) % RARITIES.length + 1}★`,
    power: GUN_TIER_POWER ** (t - 1),
  };
}

export const gunCost = (bought) => Math.ceil(GUN_COST.base * GUN_COST.growth ** bought);

// Уровень покупаемой пушки зависит от прокачки Кузни.
export const buyTier = (forgeLevel) => Math.min(MAX_GUN_TIER, 1 + forgeLevel);

// ---------- Кейсы ----------
// Бросок бонуса к уровню пушки. minBonus > 0 — гарантия: выбираем только из исходов не ниже него.
export function rollCaseBonus(caseKey, rand = Math.random, minBonus = 0) {
  const pool = CASES[caseKey].odds.filter(([bonus]) => bonus >= minBonus);
  const total = pool.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [bonus, w] of pool) {
    r -= w;
    if (r < 0) return bonus;
  }
  return pool[pool.length - 1][0];
}

// Шансы для показа игроку: [{ bonus, chance }]
export function caseOdds(caseKey) {
  const odds = CASES[caseKey].odds;
  const total = odds.reduce((sum, [, w]) => sum + w, 0);
  return odds.map(([bonus, w]) => ({ bonus, chance: w / total }));
}

// ---------- Отряд ----------
// slots — массив уровней пушек в слотах (0 — пусто). Котик в слоте появляется, только если есть пушка.
// catSkins — ключи скинов на котиках (null — без костюма); бонус скина работает, пока котик в отряде.
export function squadStats(levels, bones, slots, maxStage = Infinity, catSkins = []) {
  const base = heroStats(levels, bones);
  const active = slots.map((tier, i) => tier > 0 && CATS[i] && CATS[i].unlockStage <= maxStage);
  const bonus = { teamDamage: 0, critChance: 0, fireRate: 0, gold: 0, maxHp: 0 };
  active.forEach((on, i) => {
    if (!on) return;
    const skin = SKINS[catSkins[i]]?.bonus ?? {};
    for (const k of Object.keys(bonus)) bonus[k] += (CATS[i][k] ?? 0) + (skin[k] ?? 0);
  });
  base.goldMult *= 1 + bonus.gold;
  base.maxHp *= 1 + bonus.maxHp;
  base.regen *= 1 + bonus.maxHp;
  const cats = slots.map((tier, i) => {
    if (!active[i]) return null;
    const gun = gunInfo(tier);
    return {
      gun,
      damage: base.damage * gun.power * gun.family.damage * (1 + bonus.teamDamage),
      fireRate: base.fireRate * gun.family.rate * (1 + bonus.fireRate),
      pellets: gun.family.pellets,
      pierce: gun.family.pierce,
      critChance: Math.min(0.75, base.critChance + bonus.critChance),
      critMult: base.critMult,
    };
  });
  return { ...base, cats };
}

export function squadDps(squad, damageMult = 1, fireRateMult = 1) {
  return squad.cats.reduce((sum, c) => (c ? sum + expectedDps(c, damageMult, fireRateMult) * c.pellets : sum), 0);
}

// Во сколько раз способности героини снижают урон отряда по ней (для симуляции баланса и подсказок).
// Щит и заморозка выключают урон на долю времени, уворот — на долю пуль, лечение и вытягивание
// отматывают часть урона назад, призванные ниндзя отвлекают на себя пули.
export function bossDpsFactor(heroine) {
  if (!heroine) return 1;
  const cfg = BOSS_ABILITIES[heroine.ability];
  let f = 1;
  if (cfg.evade) f *= 1 - (heroine.evadeChance ?? cfg.evade);
  if (cfg.shield) f *= 1 - cfg.shield.duration / cfg.shield.every;
  if (cfg.freeze) f *= 1 - cfg.freeze.duration / cfg.freeze.every;
  if (cfg.heal) f *= 1 - cfg.heal.amount * 2; // ~2 срабатывания за типичный бой
  if (cfg.drain) f *= 1 - cfg.drain.healPct * 2;
  if (cfg.summon) f *= 0.85;
  return f;
}

// Во сколько раз способности героини увеличивают урон по отряду (ярость, лезвия ветра, вытягивание).
export function bossDamageFactor(heroine) {
  if (!heroine) return 1;
  const cfg = BOSS_ABILITIES[heroine.ability];
  let f = 1;
  if (cfg.oni) f *= 1 + (cfg.oni.attackMult * cfg.oni.damageMult - 1) * (1 - cfg.oni.below); // ярость на второй половине боя
  if (cfg.volley) f *= 1 + cfg.volley.count * cfg.volley.damage / cfg.volley.every; // лезвия, которые не сбили
  if (cfg.drain) f *= 1.15;
  return f;
}

// ---------- Перерождение ----------
export function bonesForPrestige(maxStage) {
  if (maxStage < PRESTIGE_MIN_STAGE) return 0;
  // степенной рост + экспоненциальный: иначе здоровье врагов (×1.26 за этап) обгоняет перерождения
  return Math.floor(((maxStage - 20) / 5) ** BONES.exponent * BONES.growth ** (maxStage - PRESTIGE_MIN_STAGE));
}

// ---------- Оффлайн-доход ----------
// Сколько секунд отряд в среднем идёт до следующей цели.
export const WALK_TIME = (SPAWN_GAP[0] + SPAWN_GAP[1]) / 2 / MARCH_SPEED;

// Средний множитель поля (hp / gold) по всем целям, которые встречаются на этапе.
export function poolAverage(stage, field) {
  const pool = Object.values(ENEMY_TYPES).filter((t) => t.weight > 0 && (t.minStage ?? 1) <= stage);
  const total = pool.reduce((s, t) => s + t.weight, 0);
  return pool.reduce((s, t) => s + t.weight * t[field], 0) / total;
}

// Приблизительное золото в секунду при фарме обычного этапа (для оффлайн-дохода и наград).
// Время на цель — не меньше времени ходьбы до неё: так в начале игры доход не завышается.
export function idleGoldPerSecond(stage, squad) {
  const farmStage = isBossStage(stage) ? Math.max(1, stage - 1) : stage;
  const dps = Math.max(squadDps(squad), 1e-9);
  const perTarget = Math.max((enemyHp(farmStage) * poolAverage(farmStage, 'hp')) / dps, WALK_TIME, SPAWN_INTERVAL);
  return (enemyGold(farmStage) * poolAverage(farmStage, 'gold') * squad.goldMult) / perTarget;
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
