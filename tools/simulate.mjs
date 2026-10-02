// Headless-симуляция прогрессии: жадный игрок покупает самое выгодное — улучшение или пушку,
// сливает пушки и раздаёт лучшие котикам. Использует настоящие функции игры из src/state.js.
// Запуск: node tools/simulate.mjs [макс_минут] [--prestige]
//   --prestige — перерождаться, когда прогресс встал (15 минут без нового рекорда).
import {
  squadDps, enemyHp, enemyDamage, enemyGold, upgradeCost, isMaxed, isBossStage, bonesForPrestige,
  gunInfo, bossDpsFactor, bossDamageFactor, poolAverage, TIME_PER_TARGET,
} from '../src/formulas.js';
import { heroineForStage, chapterForStage } from '../src/story.js';
import {
  createState, statsOf, buyGun, nextGunCost, mergeAll, equipBest, resolveMult, addResolve, clearResolve,
  chooseChapter, prestige,
} from '../src/state.js';
import {
  BONES, UPGRADES, ENEMIES_PER_STAGE, BOSS_TIME_LIMIT, CHAPTER_BOSS_TIME_LIMIT, ENEMY_TYPES, ARENA,
  AUTO_BOSS_DELAY,
} from '../src/config.js';

const maxMinutes = Number(process.argv[2] ?? 120);
const usePrestige = process.argv.includes('--prestige');
if (process.env.BONE_GROWTH) BONES.growth = Number(process.env.BONE_GROWTH); // для подбора баланса
const STUCK_MINUTES = 15;
let lastRecordAt = 0;
const prestiges = [];
// босс выходит из-за края арены и бежит к отряду через полкарты
const BOSS_WALK_TIME = (ARENA.width / 2) / ENEMY_TYPES.boss.speed;
const walls = []; // этапы, где отряд проваливал босса

const state = createState();
let time = 0;
const reached = new Map([[1, 0]]);

function power(s) {
  const st = statsOf(s);
  return squadDps(st) * Math.sqrt(st.maxHp + st.regen * 10) * st.goldMult ** 0.7;
}

// Лёгкая копия: только то, что меняют покупки и слияния (без сюжета и прочего).
const clone = (s) => ({
  ...s,
  levels: { ...s.levels },
  guns: [...s.guns],
  slots: [...s.slots],
  stats: { ...s.stats },
  quests: s.quests.map((q) => ({ ...q })),
});

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

// Героиня главы: способности снижают урон по ней, зато на бой даётся больше времени.
function bossFight(st) {
  const heroine = heroineForStage(state.stage);
  const dps = squadDps(st) * bossDpsFactor(heroine) * resolveMult(state);
  return { dps, limit: heroine ? CHAPTER_BOSS_TIME_LIMIT : BOSS_TIME_LIMIT };
}

function canBeatBoss(st) {
  const { dps, limit } = bossFight(st);
  const killTime = enemyHp(state.stage, 'boss') / dps;
  if (killTime > limit) return false;
  const meleeTime = Math.max(0, killTime - BOSS_WALK_TIME);
  const damage = enemyDamage(state.stage, 'boss') * bossDamageFactor(heroineForStage(state.stage));
  return damage * meleeTime < st.maxHp + st.regen * meleeTime;
}

while (time < maxMinutes * 60) {
  for (let n = 0; n < 3000 && buyBest(); n++);
  const st = statsOf(state);
  const dps = squadDps(st);
  const s = state.stage;
  if (isBossStage(s)) {
    if (canBeatBoss(st)) {
      time += BOSS_WALK_TIME * 0.5 + enemyHp(s, 'boss') / bossFight(st).dps;
      state.gold += enemyGold(s, 'boss') * st.goldMult;
      clearResolve(state, s);
      const ch = chapterForStage(s);
      if (ch >= 0 && !state.story.choices[ch]) {
        // героиня побеждена: щадим (союзницы в финале) и надеваем три последних костюма
        chooseChapter(state, ch, 'spare');
        state.catSkins = [...state.skins.slice(-3), null, null, null].slice(0, 3);
      }
      state.stage++;
    } else {
      // провал: упорство +10%, фарм предыдущего этапа и авто-повтор через AUTO_BOSS_DELAY
      if (!walls.includes(s)) walls.push(s);
      addResolve(state, s);
      const farm = s - 1;
      const perKill = Math.max(enemyHp(farm) * poolAverage(farm, 'hp') / dps, TIME_PER_TARGET);
      time += AUTO_BOSS_DELAY + bossFight(st).limit;
      state.gold += (AUTO_BOSS_DELAY / perKill) * enemyGold(farm) * poolAverage(farm, 'gold') * st.goldMult;
    }
  } else {
    const perKill = Math.max(enemyHp(s) * poolAverage(s, 'hp') / dps, TIME_PER_TARGET);
    time += perKill * ENEMIES_PER_STAGE;
    state.gold += ENEMIES_PER_STAGE * enemyGold(s) * poolAverage(s, 'gold') * st.goldMult;
    state.stage++;
  }
  if (state.stage > state.maxStage) lastRecordAt = time;
  state.maxStage = Math.max(state.maxStage, state.stage);
  if (!reached.has(state.stage)) reached.set(state.stage, time);
  if (usePrestige && time - lastRecordAt > STUCK_MINUTES * 60 && prestige(state) > 0) {
    prestiges.push(`${(time / 60).toFixed(0)} мин (рекорд ${[...reached.keys()].pop()}, косточек ${state.bones})`);
    lastRecordAt = time;
  }
}

const fmt = (t) => `${(t / 60).toFixed(1)} мин`;
console.log('Этап → время достижения');
for (const s of [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120]) {
  if (reached.has(s)) console.log(`  ${String(s).padStart(3)} → ${fmt(reached.get(s))}`);
}
console.log(`Итог за ${maxMinutes} мин: этап ${state.stage}, рекорд ${state.maxStage}, косточек за перерождение: ${bonesForPrestige(state.maxStage)}`);
if (usePrestige) console.log('Перерождения:', prestiges.join('; ') || 'нет');
console.log('Пушки в руках:', state.slots.map((t) => (t ? gunInfo(t).name : '—')).join(', '), `| куплено: ${state.gunsBought}`);
console.log('Боссы, на которых был провал:', walls.join(', ') || 'нет');
console.log('Уровни:', state.levels);
