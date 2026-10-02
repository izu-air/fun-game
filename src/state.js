// Сохраняемое состояние игрока: прокачка, этапы, перерождение, оффлайн-доход.
import {
  UPGRADES, SKILLS, SAVE_KEY, SAVE_VERSION, OFFLINE_MAX_SECONDS, OFFLINE_EFFICIENCY,
  OFFLINE_MIN_SECONDS, SPAWN_INTERVAL, INVENTORY_SIZE, CATS, MAX_GUN_TIER, CASES, KEYS,
  JACKPOT_BONUS, GAME_SPEEDS, SPEED_UNLOCK, SKINS, QUEST_TYPES, ACTIVE_QUESTS,
} from './config.js';
import { CHAPTERS, HEROINES, TROPHY_KEYS } from './story.js';
import { initialQuests, newQuest, progressQuest } from './quests.js';
import {
  upgradeCost, isMaxed, bulkPurchase, squadStats, bonesForPrestige, idleGoldPerSecond,
  gunCost, buyTier, rollCaseBonus,
} from './formulas.js';

const starterSlots = () => [1, ...Array(CATS.length - 1).fill(0)];

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
    guns: Array(INVENTORY_SIZE).fill(0), // инвентарь: уровень пушки или 0
    slots: starterSlots(), // пушки в руках котиков отряда
    gunsBought: 0,
    keys: KEYS.start,
    pity: 0, // обычных кейсов подряд без крупного выигрыша
    speed: 1,
    sound: true,
    story: { seen: [], choices: {} }, // просмотренные сцены и выборы в главах ('spare' | 'trophy')
    skins: [], // полученные аниме-скины
    catSkins: CATS.map(() => null), // какой скин надет на каждого котика
    quests: initialQuests(),
    questsDone: 0,
    stats: { kills: 0, bossKills: 0, prestiges: 0, totalGold: 0, playTime: 0, merges: 0, bestGun: 1, casesOpened: 0, jackpots: 0, taps: 0, pets: 0, goldMice: 0 },
    lastSeen: Date.now(),
  };
}

export const statsOf = (state) => squadStats(state.levels, state.bones, state.slots, state.maxStage, state.catSkins);

// ---------- Сюжет ----------
export const hasSeen = (state, id) => state.story.seen.includes(id);

export function markSeen(state, id) {
  if (!hasSeen(state, id)) state.story.seen.push(id);
}

export const sparedCount = (state) => Object.values(state.story.choices).filter((c) => c === 'spare').length;

// Союзницы финала: пощажённые героини первых пяти глав.
export const allies = (state) => HEROINES.slice(0, CHAPTERS.length - 1).filter((_, i) => state.story.choices[i] === 'spare');

// Выбор после победы над героиней главы: скин в любом случае, за трофей — ещё и ключи сразу.
export function chooseChapter(state, chapter, choice) {
  if (state.story.choices[chapter]) return null;
  state.story.choices[chapter] = choice;
  const skin = HEROINES[chapter].skin;
  grantSkin(state, skin);
  const keys = choice === 'trophy' ? TROPHY_KEYS : 0;
  state.keys += keys;
  return { skin, keys };
}

// ---------- Скины ----------
export function grantSkin(state, key) {
  if (!SKINS[key] || state.skins.includes(key)) return false;
  state.skins.push(key);
  return true;
}

// Надевает скин на котика. Скин один на весь отряд: с другого котика он снимается.
// Повторное нажатие на надетый скин снимает его.
export function equipSkin(state, key, cat) {
  if (key !== null && !state.skins.includes(key)) return false;
  if (key !== null && state.catSkins[cat] === key) {
    state.catSkins[cat] = null;
    return true;
  }
  state.catSkins = state.catSkins.map((k) => (k === key ? null : k));
  state.catSkins[cat] = key;
  return true;
}

export { progressQuest };

// ---------- Оружие ----------
export const isSlotUnlocked = (state, i) => state.maxStage >= CATS[i].unlockStage;

function noteGun(state, tier) {
  state.stats.bestGun = Math.max(state.stats.bestGun, tier);
}

// Кладёт пушку в первую свободную ячейку. Возвращает индекс или -1, если места нет.
export function addGun(state, tier) {
  const i = state.guns.indexOf(0);
  if (i === -1) return -1;
  state.guns[i] = tier;
  noteGun(state, tier);
  return i;
}

export const nextGunCost = (state) => gunCost(state.gunsBought);

export function buyGun(state) {
  const cost = nextGunCost(state);
  if (state.gold < cost || !state.guns.includes(0)) return -1;
  state.gold -= cost;
  state.gunsBought++;
  return addGun(state, buyTier(state.levels.forge ?? 0));
}

// ---------- Кейсы ----------
export function casePrice(state, key) {
  const c = CASES[key];
  return c.currency === 'gold' ? nextGunCost(state) * c.priceMult : c.price;
}

const wallet = (state, key) => (CASES[key].currency === 'gold' ? state.gold : state.keys);

// Почему кейс нельзя открыть прямо сейчас (или null, если можно).
export function caseBlocker(state, key) {
  if (!state.guns.includes(0)) return 'full';
  if (wallet(state, key) < casePrice(state, key)) return CASES[key].currency === 'gold' ? 'gold' : 'keys';
  return null;
}

// Сколько обычных кейсов осталось до гарантированного крупного выигрыша (1 — следующий).
export function pityLeft(state) {
  return CASES.common.pity.every - state.pity;
}

// Открывает кейс: списывает цену, кладёт пушку в инвентарь. Возвращает результат или null.
export function openCase(state, key, rand = Math.random) {
  if (caseBlocker(state, key)) return null;
  const c = CASES[key];
  const price = casePrice(state, key);
  if (c.currency === 'gold') {
    state.gold -= price;
    state.gunsBought += c.gunsBoughtStep;
  } else {
    state.keys -= price;
  }
  const forced = c.pity && pityLeft(state) <= 1;
  const bonus = rollCaseBonus(key, rand, forced ? c.pity.minBonus : 0);
  if (c.pity) state.pity = bonus >= c.pity.minBonus ? 0 : state.pity + 1;
  const tier = Math.min(MAX_GUN_TIER, buyTier(state.levels.forge ?? 0) + bonus);
  const index = addGun(state, tier);
  const jackpot = bonus >= JACKPOT_BONUS;
  state.stats.casesOpened++;
  progressQuest(state, 'cases');
  if (jackpot) state.stats.jackpots++;
  return { tier, bonus, jackpot, forced, index };
}

export function addKeys(state, n) {
  state.keys += n;
}

// ---------- Скорость игры ----------
export function availableSpeeds(state) {
  return GAME_SPEEDS.filter((s) => SPEED_UNLOCK[s] !== 'prestige' || state.stats.prestiges > 0);
}

export function cycleSpeed(state) {
  const speeds = availableSpeeds(state);
  const i = speeds.indexOf(state.speed);
  state.speed = speeds[(i + 1) % speeds.length];
  return state.speed;
}

// Сливает пушку из ячейки from в ячейку to (обе в инвентаре, одинакового уровня).
export function mergeGuns(state, from, to) {
  const g = state.guns;
  if (from === to || !g[from] || g[from] !== g[to] || g[to] >= MAX_GUN_TIER) return false;
  g[to] += 1;
  g[from] = 0;
  state.stats.merges++;
  progressQuest(state, 'merges');
  noteGun(state, g[to]);
  return true;
}

// Сливает все возможные пары, начиная с младших. Возвращает число слияний.
export function mergeAll(state) {
  let merges = 0;
  for (let tier = 1; tier < MAX_GUN_TIER; tier++) {
    const idx = state.guns.map((t, i) => (t === tier ? i : -1)).filter((i) => i >= 0);
    for (let k = 0; k + 1 < idx.length; k += 2) {
      if (mergeGuns(state, idx[k], idx[k + 1])) merges++;
    }
  }
  return merges;
}

// Меняет местами пушку из инвентаря и пушку в слоте котика.
export function equipGun(state, invIndex, slot) {
  if (!isSlotUnlocked(state, slot) || !state.guns[invIndex]) return false;
  [state.guns[invIndex], state.slots[slot]] = [state.slots[slot], state.guns[invIndex]];
  return true;
}

// Раздаёт лучшие пушки открытым котикам, остальное — в инвентарь.
export function equipBest(state) {
  const all = [...state.guns, ...state.slots].filter((t) => t > 0).sort((a, b) => b - a);
  const open = state.slots.map((_, i) => isSlotUnlocked(state, i));
  const before = state.slots.join();
  state.slots = state.slots.map((_, i) => (open[i] ? all.shift() ?? 0 : 0));
  state.guns = Array(INVENTORY_SIZE).fill(0);
  all.forEach((t, i) => { state.guns[i] = t; });
  return state.slots.join() !== before;
}

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
    sound: state.sound,
    speed: state.speed,
    keys: state.keys, // ключи, гарантию, сюжет, скины и задания перерождение не сжигает
    pity: state.pity,
    story: state.story,
    skins: state.skins,
    catSkins: state.catSkins,
    quests: state.quests,
    questsDone: state.questsDone,
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
    sound: data.sound !== false,
    gunsBought: Math.floor(num(data.gunsBought, 0)),
    keys: Math.floor(num(data.keys, KEYS.start)),
    pity: Math.min(CASES.common.pity.every - 1, Math.floor(num(data.pity, 0))),
    speed: GAME_SPEEDS.includes(data.speed) ? data.speed : 1,
    lastSeen: num(data.lastSeen, Date.now()),
  };
  const tier = (v) => Math.min(MAX_GUN_TIER, Math.floor(num(v, 0)));
  if (Array.isArray(data.guns)) {
    for (let i = 0; i < INVENTORY_SIZE; i++) state.guns[i] = tier(data.guns[i]);
  }
  if (Array.isArray(data.slots)) {
    state.slots = state.slots.map((_, i) => tier(data.slots[i]));
  }
  // Сохранение из первой версии без оружия — выдаём стартовый пистолет.
  if (!state.slots.some((t) => t > 0) && !state.guns.some((t) => t > 0)) state.slots = starterSlots();
  state.maxStage = Math.max(state.stage, Math.floor(num(data.maxStage, 1)));
  for (const key of Object.keys(UPGRADES)) {
    const lvl = Math.floor(num(data.levels?.[key], 0));
    state.levels[key] = Math.min(lvl, UPGRADES[key].maxLevel ?? lvl);
  }
  for (const key of Object.keys(fresh.stats)) {
    state.stats[key] = num(data.stats?.[key], fresh.stats[key]);
  }
  if (!availableSpeeds(state).includes(state.speed)) state.speed = 1;

  // Сюжет, скины и задания (появились в версии 3).
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  state.story.seen = strings(data.story?.seen);
  for (const [ch, choice] of Object.entries(data.story?.choices ?? {})) {
    if (CHAPTERS[ch] && (choice === 'spare' || choice === 'trophy')) state.story.choices[ch] = choice;
  }
  state.skins = [...new Set(strings(data.skins).filter((k) => SKINS[k]))];
  if (Array.isArray(data.catSkins)) {
    state.catSkins = state.catSkins.map((_, i) => {
      const k = data.catSkins[i];
      return state.skins.includes(k) && data.catSkins.indexOf(k) === i ? k : null;
    });
  }
  state.questsDone = Math.floor(num(data.questsDone, 0));
  if (Array.isArray(data.quests) && data.quests.length === ACTIVE_QUESTS
    && data.quests.every((q) => QUEST_TYPES[q?.type])
    && new Set(data.quests.map((q) => q.type)).size === ACTIVE_QUESTS) {
    state.quests = data.quests.map((q) => {
      const fresh = newQuest(q.type, state.questsDone);
      const target = Math.max(1, Math.floor(num(q.target, fresh.target)));
      return { type: q.type, target, progress: Math.min(target, Math.floor(num(q.progress, 0))) };
    });
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
