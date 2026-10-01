// Сохраняемое состояние игрока: прокачка, этапы, перерождение, оффлайн-доход.
import {
  UPGRADES, SKILLS, SAVE_KEY, SAVE_VERSION, OFFLINE_MAX_SECONDS, OFFLINE_EFFICIENCY,
  OFFLINE_MIN_SECONDS, SPAWN_INTERVAL,
} from './config.js';
import {
  upgradeCost, isMaxed, bulkPurchase, heroStats, bonesForPrestige, idleGoldPerSecond,
} from './formulas.js';

export function createState() {
  return {
    version: SAVE_VERSION,
    gold: 0,
    bones: 0,
    stage: 1,
    maxStage: 1,
    autoAdvance: true,
    autoSkills: false,
    levels: Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0])),
    stats: { kills: 0, bossKills: 0, prestiges: 0, totalGold: 0, playTime: 0 },
    lastSeen: Date.now(),
  };
}

export const statsOf = (state) => heroStats(state.levels, state.bones);

export function addGold(state, amount) {
  state.gold += amount;
  state.stats.totalGold += amount;
}

// amount: 1, 10 или 'max'. Возвращает число купленных уровней.
export function buyUpgrade(state, key, amount = 1) {
  const level = state.levels[key];
  if (isMaxed(key, level)) return 0;
  const limit = amount === 'max' ? Infinity : amount;
  const { count, cost } = bulkPurchase(key, level, state.gold, limit);
  if (count === 0) return 0;
  state.gold -= cost;
  state.levels[key] += count;
  return count;
}

export function nextCost(state, key, amount = 1) {
  const level = state.levels[key];
  if (amount === 'max') {
    const { count, cost } = bulkPurchase(key, level, state.gold);
    return count > 0 ? { count, cost } : { count: 1, cost: upgradeCost(key, level) };
  }
  const max = UPGRADES[key].maxLevel ?? Infinity;
  let cost = 0;
  let count = 0;
  for (; count < amount && level + count < max; count++) cost += upgradeCost(key, level + count);
  return { count, cost };
}

export function isSkillUnlocked(state, key) {
  return state.maxStage >= SKILLS[key].unlockStage;
}

export function canPrestige(state) {
  return bonesForPrestige(state.maxStage) > 0;
}

export function prestige(state) {
  const gained = bonesForPrestige(state.maxStage);
  if (gained <= 0) return 0;
  const fresh = createState();
  Object.assign(state, {
    ...fresh,
    bones: state.bones + gained,
    autoSkills: state.autoSkills,
    stats: { ...state.stats, prestiges: state.stats.prestiges + 1 },
  });
  return gained;
}

// Начисляет доход за время отсутствия. Возвращает { seconds, gold } или null.
export function applyOffline(state, now = Date.now()) {
  const elapsed = Math.min((now - state.lastSeen) / 1000, OFFLINE_MAX_SECONDS);
  state.lastSeen = now;
  if (!(elapsed >= OFFLINE_MIN_SECONDS)) return null;
  const gold = idleGoldPerSecond(state.stage, statsOf(state), SPAWN_INTERVAL) * elapsed * OFFLINE_EFFICIENCY;
  addGold(state, gold);
  return { seconds: elapsed, gold };
}

// ---------- Сохранение ----------
export function serialize(state) {
  return JSON.stringify({ ...state, lastSeen: Date.now() });
}

// Восстанавливает сохранение поверх свежего состояния, отбрасывая мусор.
export function deserialize(json) {
  const fresh = createState();
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return fresh;
  }
  if (!data || typeof data !== 'object') return fresh;
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  const state = {
    ...fresh,
    gold: num(data.gold, 0),
    bones: Math.floor(num(data.bones, 0)),
    stage: Math.max(1, Math.floor(num(data.stage, 1))),
    autoAdvance: data.autoAdvance !== false,
    autoSkills: data.autoSkills === true,
    lastSeen: num(data.lastSeen, Date.now()),
  };
  state.maxStage = Math.max(state.stage, Math.floor(num(data.maxStage, 1)));
  for (const key of Object.keys(UPGRADES)) {
    const lvl = Math.floor(num(data.levels?.[key], 0));
    state.levels[key] = Math.min(lvl, UPGRADES[key].maxLevel ?? lvl);
  }
  for (const key of Object.keys(fresh.stats)) {
    state.stats[key] = num(data.stats?.[key], 0);
  }
  return state;
}

export function saveToStorage(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(SAVE_KEY, serialize(state));
    return true;
  } catch {
    return false;
  }
}

export function loadFromStorage(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    return raw ? deserialize(raw) : null;
  } catch {
    return null;
  }
}

export function clearStorage(storage = globalThis.localStorage) {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    /* хранилище недоступно — нечего удалять */
  }
}
