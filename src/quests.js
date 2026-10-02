// Задания: три активных одновременно, за выполнение — ключи и золото.
// Чистые функции над состоянием — без DOM, тестируются в Node.
import { QUEST_TYPES, ACTIVE_QUESTS, SKINS } from './config.js';

export function questTarget(type, done) {
  return Math.ceil(QUEST_TYPES[type].base * (1 + Math.floor(done / 6) * 0.5));
}

export function newQuest(type, done) {
  return { type, target: questTarget(type, done), progress: 0 };
}

// Случайный тип задания, которого сейчас нет среди активных.
function pickType(active, rand) {
  const free = Object.keys(QUEST_TYPES).filter((t) => !active.includes(t));
  return free[Math.floor(rand() * free.length)];
}

export function initialQuests(rand = Math.random) {
  const quests = [];
  while (quests.length < ACTIVE_QUESTS) quests.push(newQuest(pickType(quests.map((q) => q.type), rand), 0));
  return quests;
}

export const questText = (q) => QUEST_TYPES[q.type].text(q.target);
export const isQuestDone = (q) => q.progress >= q.target;

// Засчитать прогресс по всем активным заданиям этого типа.
export function progressQuest(state, type, n = 1) {
  for (const q of state.quests) {
    if (q.type === type && q.progress < q.target) q.progress = Math.min(q.target, q.progress + n);
  }
}

// Забрать награду. goldReward считает вызывающий (зависит от дохода отряда).
// Возвращает { keys, gold, skin } или null, если задание ещё не выполнено.
export function claimQuest(state, index, goldReward, rand = Math.random) {
  const q = state.quests[index];
  if (!q || !isQuestDone(q)) return null;
  const keys = QUEST_TYPES[q.type].keys;
  state.keys += keys;
  state.gold += goldReward;
  state.stats.totalGold += goldReward;
  state.questsDone++;
  let skin = null;
  for (const [key, s] of Object.entries(SKINS)) {
    if (s.questsNeeded && state.questsDone >= s.questsNeeded && !state.skins.includes(key)) {
      state.skins.push(key);
      skin = key;
    }
  }
  const others = state.quests.filter((_, i) => i !== index).map((x) => x.type);
  state.quests[index] = newQuest(pickType([...others, q.type], rand), state.questsDone);
  return { keys, gold: goldReward, skin };
}
