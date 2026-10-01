import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, buyUpgrade, nextCost, prestige, canPrestige, applyOffline, serialize, deserialize,
  saveToStorage, loadFromStorage, buyGun, addGun, mergeGuns, mergeAll, equipGun, equipBest,
  nextGunCost,
} from '../src/state.js';
import { UPGRADES, OFFLINE_MAX_SECONDS, INVENTORY_SIZE, CATS } from '../src/config.js';

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

test('новая игра: у Рыжика стартовый пистолет, инвентарь пуст', () => {
  const s = createState();
  assert.equal(s.slots[0], 1);
  assert.equal(s.guns.length, INVENTORY_SIZE);
  assert.ok(s.guns.every((g) => g === 0));
});

test('покупка пушки дорожает, кузня повышает уровень', () => {
  const s = createState();
  s.gold = 1e6;
  const c0 = nextGunCost(s);
  const i = buyGun(s);
  assert.equal(s.guns[i], 1);
  assert.ok(nextGunCost(s) > c0);
  s.levels.forge = 2;
  assert.equal(s.guns[buyGun(s)], 3);
});

test('нельзя купить пушку без денег или в полный арсенал', () => {
  const s = createState();
  assert.equal(buyGun(s), -1);
  s.gold = 1e9;
  s.guns.fill(1);
  assert.equal(buyGun(s), -1);
});

test('слияние только одинаковых пушек', () => {
  const s = createState();
  addGun(s, 2);
  addGun(s, 2);
  addGun(s, 3);
  assert.equal(mergeGuns(s, 0, 2), false);
  assert.equal(mergeGuns(s, 0, 1), true);
  assert.equal(s.guns[1], 3);
  assert.equal(s.guns[0], 0);
  assert.equal(s.stats.bestGun, 3);
  assert.equal(mergeGuns(s, 1, 1), false);
});

test('слить всё: 4 пистолета превращаются в одну пушку 3-го уровня', () => {
  const s = createState();
  for (let k = 0; k < 4; k++) addGun(s, 1);
  assert.equal(mergeAll(s), 3);
  assert.deepEqual(s.guns.filter(Boolean), [3]);
});

test('экипировка меняет пушки местами и уважает закрытые слоты', () => {
  const s = createState();
  addGun(s, 4);
  assert.equal(equipGun(s, 0, 0), true);
  assert.equal(s.slots[0], 4);
  assert.equal(s.guns[0], 1);
  assert.equal(equipGun(s, 0, 2), false, 'Уголёк ещё не в отряде');
});

test('лучшее снаряжение раздаётся открытым котикам', () => {
  const s = createState();
  s.maxStage = CATS[1].unlockStage;
  [2, 5, 3].forEach((t) => addGun(s, t));
  equipBest(s);
  assert.deepEqual(s.slots, [5, 3, 0]);
  assert.deepEqual(s.guns.filter(Boolean).sort(), [1, 2]);
});

test('перерождение сбрасывает оружие к стартовому', () => {
  const s = createState();
  s.maxStage = 40;
  addGun(s, 7);
  s.slots = [9, 8, 0];
  s.gunsBought = 30;
  prestige(s);
  assert.deepEqual(s.slots, [1, 0, 0]);
  assert.ok(s.guns.every((g) => g === 0));
  assert.equal(s.gunsBought, 0);
});

test('сохранение первой версии получает стартовый пистолет', () => {
  const old = JSON.stringify({ version: 1, gold: 50, stage: 7, maxStage: 9, levels: { damage: 3 } });
  const s = deserialize(old);
  assert.deepEqual(s.slots, [1, 0, 0]);
  assert.equal(s.levels.forge, 0);
  assert.equal(s.stats.bestGun, 1);
});

test('оружие сохраняется и восстанавливается', () => {
  const s = createState();
  addGun(s, 12);
  s.slots = [6, 2, 0];
  const back = deserialize(serialize(s));
  assert.equal(back.guns[0], 12);
  assert.deepEqual(back.slots, [6, 2, 0]);
  const bad = deserialize(JSON.stringify({ guns: [999, -1, 'x'], slots: [3] }));
  assert.equal(bad.guns[0], 30);
  assert.equal(bad.guns[1], 0);
  assert.deepEqual(bad.slots, [3, 0, 0]);
});
