import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialQuests, progressQuest, claimQuest, questTarget, isQuestDone, questText } from '../src/quests.js';
import { createState, addGun, mergeGuns, openCase } from '../src/state.js';
import { ACTIVE_QUESTS, QUEST_TYPES, SKINS } from '../src/config.js';

const seq = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test('стартовые задания: три разных типа', () => {
  for (let k = 0; k < 20; k++) {
    const qs = initialQuests();
    assert.equal(qs.length, ACTIVE_QUESTS);
    assert.equal(new Set(qs.map((q) => q.type)).size, ACTIVE_QUESTS);
    assert.ok(qs.every((q) => q.progress === 0 && q.target > 0));
  }
});

test('прогресс не превышает цель и засчитывается только своему типу', () => {
  const s = createState();
  s.quests = [{ type: 'taps', target: 3, progress: 0 }, { type: 'kills', target: 5, progress: 0 }, { type: 'pets', target: 2, progress: 0 }];
  progressQuest(s, 'taps', 10);
  progressQuest(s, 'pets');
  assert.deepEqual(s.quests.map((q) => q.progress), [3, 0, 1]);
  assert.ok(isQuestDone(s.quests[0]));
  assert.match(questText(s.quests[1]), /5/);
});

test('награда: ключи, золото, новое задание другого типа', () => {
  const s = createState();
  s.quests = [{ type: 'bosses', target: 1, progress: 1 }, { type: 'kills', target: 5, progress: 0 }, { type: 'pets', target: 2, progress: 0 }];
  const keys = s.keys;
  assert.equal(claimQuest(s, 1, 100), null, 'невыполненное задание забрать нельзя');
  const r = claimQuest(s, 0, 100, seq(0));
  assert.equal(r.keys, QUEST_TYPES.bosses.keys);
  assert.equal(s.keys, keys + QUEST_TYPES.bosses.keys);
  assert.equal(s.gold, 100);
  assert.equal(s.questsDone, 1);
  const types = s.quests.map((q) => q.type);
  assert.equal(new Set(types).size, ACTIVE_QUESTS);
  assert.notEqual(types[0], 'bosses', 'то же задание сразу не повторяется');
});

test('цели заданий растут каждые 6 выполненных', () => {
  assert.equal(questTarget('kills', 0), QUEST_TYPES.kills.base);
  assert.equal(questTarget('kills', 5), QUEST_TYPES.kills.base);
  assert.equal(questTarget('kills', 6), Math.ceil(QUEST_TYPES.kills.base * 1.5));
});

test('костюм «Звезда сцены» за 8 заданий', () => {
  const s = createState();
  let skin = null;
  for (let i = 0; i < SKINS.idol.questsNeeded; i++) {
    s.quests[0].progress = s.quests[0].target;
    skin = claimQuest(s, 0, 0).skin ?? skin;
  }
  assert.equal(skin, 'idol');
  assert.ok(s.skins.includes('idol'));
});

test('слияние и кейсы засчитываются в задания', () => {
  const s = createState();
  s.quests = [{ type: 'merges', target: 5, progress: 0 }, { type: 'cases', target: 2, progress: 0 }, { type: 'pets', target: 2, progress: 0 }];
  addGun(s, 1);
  addGun(s, 1);
  mergeGuns(s, 0, 1);
  s.gold = 1e6;
  openCase(s, 'common', () => 0);
  assert.equal(s.quests[0].progress, 1);
  assert.equal(s.quests[1].progress, 1);
});
