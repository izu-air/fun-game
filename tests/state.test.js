import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, buyUpgrade, nextCost, prestige, canPrestige, applyOffline, serialize, deserialize,
  saveToStorage, loadFromStorage,
} from '../src/state.js';
import { UPGRADES, OFFLINE_MAX_SECONDS } from '../src/config.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
}

test('покупка списывает золото и повышает уровень', () => {
  const s = createState();
  s.gold = 100;
  assert.equal(buyUpgrade(s, 'damage', 1), 1);
  assert.equal(s.levels.damage, 1);
  assert.equal(s.gold, 100 - UPGRADES.damage.baseCost);
});

test('без денег покупка не происходит', () => {
  const s = createState();
  assert.equal(buyUpgrade(s, 'damage', 1), 0);
  assert.equal(s.levels.damage, 0);
});

test('×10 покупает только если хватает на все 10', () => {
  const s = createState();
  const { cost } = nextCost(s, 'damage', 10);
  s.gold = cost - 1;
  assert.equal(buyUpgrade(s, 'damage', 10), 9);
  s.gold = 1e9;
  assert.equal(buyUpgrade(s, 'damage', 10), 10);
});

test('МАКС покупает сколько возможно', () => {
  const s = createState();
  s.gold = 1e6;
  const n = buyUpgrade(s, 'damage', 'max');
  assert.ok(n > 10);
  assert.ok(s.gold >= 0);
});

test('перерождение сбрасывает прогресс и даёт косточки', () => {
  const s = createState();
  s.maxStage = 40;
  s.stage = 40;
  s.gold = 1e6;
  s.levels.damage = 50;
  s.stats.kills = 123;
  assert.ok(canPrestige(s));
  const got = prestige(s);
  assert.ok(got > 0);
  assert.equal(s.bones, got);
  assert.equal(s.stage, 1);
  assert.equal(s.gold, 0);
  assert.equal(s.levels.damage, 0);
  assert.equal(s.stats.kills, 123);
  assert.equal(s.stats.prestiges, 1);
});

test('перерождение до 25 этапа невозможно', () => {
  const s = createState();
  s.maxStage = 20;
  assert.equal(prestige(s), 0);
});

test('оффлайн-доход начисляется и ограничен 8 часами', () => {
  const s = createState();
  s.stage = 10;
  const now = Date.now();
  s.lastSeen = now - 3600 * 1000;
  const hour = applyOffline(s, now);
  assert.ok(hour.gold > 0);
  assert.equal(Math.round(hour.seconds), 3600);

  const s2 = createState();
  s2.stage = 10;
  s2.lastSeen = now - 100 * 3600 * 1000;
  const capped = applyOffline(s2, now);
  assert.equal(capped.seconds, OFFLINE_MAX_SECONDS);
});

test('короткое отсутствие не даёт оффлайн-окна', () => {
  const s = createState();
  const now = Date.now();
  s.lastSeen = now - 10_000;
  assert.equal(applyOffline(s, now), null);
});

test('сохранение и загрузка — туда и обратно', () => {
  const s = createState();
  s.gold = 1234.5;
  s.bones = 7;
  s.stage = 17;
  s.maxStage = 22;
  s.levels.critChance = 12;
  const back = deserialize(serialize(s));
  assert.equal(back.gold, 1234.5);
  assert.equal(back.bones, 7);
  assert.equal(back.stage, 17);
  assert.equal(back.maxStage, 22);
  assert.equal(back.levels.critChance, 12);
});

test('битое сохранение превращается в новую игру', () => {
  assert.equal(deserialize('{не json').stage, 1);
  assert.equal(deserialize('null').gold, 0);
  const s = deserialize(JSON.stringify({ gold: -5, stage: 'x', levels: { fireRate: 999, damage: NaN } }));
  assert.equal(s.gold, 0);
  assert.equal(s.stage, 1);
  assert.equal(s.levels.fireRate, UPGRADES.fireRate.maxLevel);
  assert.equal(s.levels.damage, 0);
});

test('localStorage-обёртка', () => {
  const storage = memoryStorage();
  assert.equal(loadFromStorage(storage), null);
  const s = createState();
  s.gold = 77;
  assert.ok(saveToStorage(s, storage));
  assert.equal(loadFromStorage(storage).gold, 77);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadFromStorage(broken), null);
  assert.equal(saveToStorage(s, broken), false);
});
