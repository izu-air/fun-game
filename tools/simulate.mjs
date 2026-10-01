// Headless-симуляция прогрессии: жадный игрок покупает самое выгодное — улучшение или пушку,
// сливает пушки и раздаёт лучшие котикам. Использует настоящие функции игры из src/state.js.
// Запуск: node tools/simulate.mjs [макс_минут]
import {
  squadDps, enemyHp, enemyDamage, enemyGold, upgradeCost, isMaxed, isBossStage, bonesForPrestige,
  gunInfo,
} from '../src/formulas.js';
import {
  createState, statsOf, buyGun, nextGunCost, mergeAll, equipBest,
} from '../src/state.js';
import {
  UPGRADES, ENEMIES_PER_STAGE, SPAWN_INTERVAL, BOSS_TIME_LIMIT, ENEMY_TYPES, MARCH_SPEED, SPAWN_GAP,
} from '../src/config.js';

const maxMinutes = Number(process.argv[2] ?? 120);
const BOSS_WALK_TIME = 300 / (ENEMY_TYPES.boss.speed + MARCH_SPEED);
const WALK_TIME = (SPAWN_GAP[0] + SPAWN_GAP[1]) / 2 / MARCH_SPEED;

// Средний множитель HP и золота обычной цели этапа (враги + препятствия).
function poolAverage(stage, field) {
  const pool = Object.values(ENEMY_TYPES).filter((t) => t.weight > 0 && (t.minStage ?? 1) <= stage);
  const total = pool.reduce((s, t) => s + t.weight, 0);
  return pool.reduce((s, t) => s + t.weight * t[field], 0) / total;
}

const state = createState();
let time = 0;
const reached = new Map([[1, 0]]);

function power(s) {
  const st = statsOf(s);
  return squadDps(st) * Math.sqrt(st.maxHp + st.regen * 10) * st.goldMult ** 0.7;
}

const clone = (s) => structuredClone(s);

function gunPurchase(s) {
  if (buyGun(s) < 0) return false;
  mergeAll(s);
  equipBest(s);
  return true;
}

// Жадно покупаем лучшее по «силе за золото».
function buyBest() {
  const base = power(state);
  let best = null;
  for (const key of Object.keys(UPGRADES)) {
    if (isMaxed(key, state.levels[key])) continue;
    const cost = upgradeCost(key, state.levels[key]);
    if (cost > state.gold) continue;
    const next = clone(state);
    next.levels[key]++;
    const value = (power(next) / base - 1) / cost;
    if (!best || value > best.value) best = { apply: () => { state.gold -= cost; state.levels[key]++; }, value };
  }
  const gunCostNow = nextGunCost(state);
  if (gunCostNow <= state.gold) {
    const next = clone(state);
    gunPurchase(next);
    // пушка ценна и сама по себе (будущие слияния), поэтому даём ей небольшой минимум ценности
    const value = Math.max(power(next) / base - 1, 0.02) / gunCostNow;
    if (!best || value > best.value) best = { apply: () => gunPurchase(state), value };
  }
  if (!best) return false;
  best.apply();
  return true;
}

function canBeatBoss(st, dps) {
  const killTime = enemyHp(state.stage, 'boss') / dps;
  if (killTime > BOSS_TIME_LIMIT) return false;
  const meleeTime = Math.max(0, killTime - BOSS_WALK_TIME);
  return enemyDamage(state.stage, 'boss') * meleeTime < st.maxHp + st.regen * meleeTime;
}

while (time < maxMinutes * 60) {
  while (buyBest());
  const st = statsOf(state);
  const dps = squadDps(st);
  const s = state.stage;
  if (isBossStage(s)) {
    if (canBeatBoss(st, dps)) {
      time += BOSS_WALK_TIME * 0.5 + enemyHp(s, 'boss') / dps;
      state.gold += enemyGold(s, 'boss') * st.goldMult;
      state.stage++;
    } else {
      const farm = s - 1;
      const perKill = Math.max(enemyHp(farm) * poolAverage(farm, 'hp') / dps, WALK_TIME, SPAWN_INTERVAL);
      time += 30;
      state.gold += (30 / perKill) * enemyGold(farm) * poolAverage(farm, 'gold') * st.goldMult;
    }
  } else {
    const perKill = Math.max(enemyHp(s) * poolAverage(s, 'hp') / dps, WALK_TIME, SPAWN_INTERVAL);
    time += perKill * ENEMIES_PER_STAGE;
    state.gold += ENEMIES_PER_STAGE * enemyGold(s) * poolAverage(s, 'gold') * st.goldMult;
    state.stage++;
  }
  state.maxStage = Math.max(state.maxStage, state.stage);
  if (!reached.has(state.stage)) reached.set(state.stage, time);
}

const fmt = (t) => `${(t / 60).toFixed(1)} мин`;
console.log('Этап → время достижения');
for (const s of [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100]) {
  if (reached.has(s)) console.log(`  ${String(s).padStart(3)} → ${fmt(reached.get(s))}`);
}
console.log(`Итог за ${maxMinutes} мин: этап ${state.stage}, косточек за перерождение: ${bonesForPrestige(state.stage)}`);
console.log('Пушки в руках:', state.slots.map((t) => (t ? gunInfo(t).name : '—')).join(', '), `| куплено: ${state.gunsBought}`);
console.log('Уровни:', state.levels);
