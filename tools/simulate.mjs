// Headless-симуляция прогрессии: жадный игрок, который покупает самое выгодное улучшение.
// Запуск: node tools/simulate.mjs [макс_минут]
// Показывает, за сколько минут достигаются этапы — для настройки констант в src/config.js.
import {
  heroStats, expectedDps, enemyHp, enemyDamage, enemyGold, upgradeCost, isMaxed,
  isBossStage, bonesForPrestige,
} from '../src/formulas.js';
import { UPGRADES, ENEMIES_PER_STAGE, SPAWN_INTERVAL, BOSS_TIME_LIMIT, ENEMY_TYPES } from '../src/config.js';

const maxMinutes = Number(process.argv[2] ?? 120);
const BOSS_WALK_TIME = 420 / ENEMY_TYPES.boss.speed; // сколько секунд босс идёт до котика

const levels = Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0]));
let gold = 0;
let stage = 1;
let time = 0;
const reached = new Map([[1, 0]]);

// Ценность улучшения: относительный прирост «силы» за единицу золота.
function power(lv) {
  const s = heroStats(lv);
  // HP и регенерация ценны, но слабее урона; золото ускоряет всё.
  return expectedDps(s) * Math.sqrt(s.maxHp + s.regen * 10) * s.goldMult ** 0.7;
}

function buyBest() {
  let best = null;
  const base = power(levels);
  for (const key of Object.keys(UPGRADES)) {
    if (isMaxed(key, levels[key])) continue;
    const cost = upgradeCost(key, levels[key]);
    if (cost > gold) continue;
    const next = { ...levels, [key]: levels[key] + 1 };
    const value = (power(next) / base - 1) / cost;
    if (!best || value > best.value) best = { key, cost, value };
  }
  if (!best) return false;
  gold -= best.cost;
  levels[best.key]++;
  return true;
}

function canBeatBoss(stats) {
  const killTime = enemyHp(stage, 'boss') / expectedDps(stats);
  if (killTime > BOSS_TIME_LIMIT) return false;
  const meleeTime = Math.max(0, killTime - BOSS_WALK_TIME);
  return enemyDamage(stage, 'boss') * meleeTime < stats.maxHp + stats.regen * meleeTime;
}

while (time < maxMinutes * 60) {
  while (buyBest());
  const stats = heroStats(levels);
  const dps = expectedDps(stats);
  if (isBossStage(stage)) {
    if (canBeatBoss(stats)) {
      time += enemyHp(stage, 'boss') / dps;
      gold += enemyGold(stage, 'boss') * stats.goldMult;
      stage++;
    } else {
      // фармим предыдущий этап 30 секунд
      const farm = stage - 1;
      const perKill = Math.max(enemyHp(farm) / dps, SPAWN_INTERVAL);
      time += 30;
      gold += (30 / perKill) * enemyGold(farm) * stats.goldMult;
    }
  } else {
    const perKill = Math.max(enemyHp(stage) / dps, SPAWN_INTERVAL);
    time += perKill * ENEMIES_PER_STAGE;
    gold += ENEMIES_PER_STAGE * enemyGold(stage) * stats.goldMult;
    stage++;
  }
  if (!reached.has(stage)) reached.set(stage, time);
}

const fmt = (t) => `${(t / 60).toFixed(1)} мин`;
console.log('Этап → время достижения');
for (const s of [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100]) {
  if (reached.has(s)) console.log(`  ${String(s).padStart(3)} → ${fmt(reached.get(s))}`);
}
console.log(`Итог за ${maxMinutes} мин: этап ${stage}, косточек за перерождение: ${bonesForPrestige(stage)}`);
console.log('Уровни:', levels);
