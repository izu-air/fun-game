import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, buyUpgrade, nextCost, prestige, canPrestige, applyOffline, serialize, deserialize,
  saveToStorage, loadFromStorage, buyGun, addGun, mergeGuns, mergeAll, equipGun, equipBest,
  nextGunCost, openCase, casePrice, caseBlocker, pityLeft, cycleSpeed, availableSpeeds, addKeys,
} from '../src/state.js';
import { rollCaseBonus, caseOdds } from '../src/formulas.js';
import {
  UPGRADES, OFFLINE_MAX_SECONDS, INVENTORY_SIZE, CATS, CASES, JACKPOT_BONUS, KEYS, MAX_GUN_TIER,
} from '../src/config.js';

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

// ---------- Кейсы и скорость ----------

test('шансы кейсов складываются в 100%', () => {
  for (const key of Object.keys(CASES)) {
    const sum = caseOdds(key).reduce((s, o) => s + o.chance, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, key);
  }
});

test('бросок кейса: крайние значения и гарантия', () => {
  assert.equal(rollCaseBonus('common', () => 0), 0);
  assert.equal(rollCaseBonus('common', () => 0.9999), JACKPOT_BONUS);
  assert.ok(rollCaseBonus('common', () => 0, 3) >= 3, 'гарантия отсекает мелкие исходы');
  assert.ok(rollCaseBonus('golden', () => 0) >= 1, 'золотой кейс всегда лучше Кузни');
});

test('распределение обычного кейса совпадает с заявленным', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const counts = {};
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const b = rollCaseBonus('common', rand);
    counts[b] = (counts[b] ?? 0) + 1;
  }
  for (const { bonus, chance } of caseOdds('common')) {
    assert.ok(Math.abs((counts[bonus] ?? 0) / n - chance) < 0.015, `бонус ${bonus}`);
  }
});

test('обычный кейс: платим золотом, получаем пушку, цена растёт', () => {
  const s = createState();
  s.gold = 1e6;
  const price = casePrice(s, 'common');
  const r = openCase(s, 'common', () => 0);
  assert.equal(s.gold, 1e6 - price);
  assert.equal(r.tier, 1);
  assert.equal(s.guns[r.index], 1);
  assert.ok(casePrice(s, 'common') > price);
  assert.equal(s.stats.casesOpened, 1);
});

test('кузня поднимает уровень пушек из кейса, но не выше максимума', () => {
  const s = createState();
  s.gold = 1e9;
  s.levels.forge = 3;
  assert.equal(openCase(s, 'common', () => 0.9999).tier, 4 + JACKPOT_BONUS);
  s.levels.forge = MAX_GUN_TIER;
  assert.equal(openCase(s, 'common', () => 0.9999).tier, MAX_GUN_TIER);
});

test('гарантия: 10-й обычный кейс подряд даёт +3 и выше', () => {
  const s = createState();
  s.gold = 1e12;
  for (let i = 0; i < CASES.common.pity.every - 1; i++) {
    assert.equal(openCase(s, 'common', () => 0).bonus, 0);
    s.guns.fill(0);
  }
  assert.equal(pityLeft(s), 1);
  const r = openCase(s, 'common', () => 0);
  assert.ok(r.forced);
  assert.ok(r.bonus >= CASES.common.pity.minBonus);
  assert.equal(pityLeft(s), CASES.common.pity.every, 'счётчик сбросился');
});

test('крупный выигрыш сбрасывает счётчик гарантии', () => {
  const s = createState();
  s.gold = 1e9;
  openCase(s, 'common', () => 0);
  openCase(s, 'common', () => 0.9999);
  assert.equal(s.pity, 0);
});

test('суперприз засчитывается в статистику', () => {
  const s = createState();
  s.gold = 1e9;
  assert.equal(openCase(s, 'common', () => 0.9999).jackpot, true);
  assert.equal(s.stats.jackpots, 1);
});

test('золотой кейс открывается ключом', () => {
  const s = createState();
  assert.equal(s.keys, KEYS.start);
  const r = openCase(s, 'golden', () => 0);
  assert.equal(r.tier, 2);
  assert.equal(s.keys, KEYS.start - 1);
  assert.equal(caseBlocker(s, 'golden'), 'keys');
  assert.equal(openCase(s, 'golden'), null);
  addKeys(s, 2);
  assert.equal(caseBlocker(s, 'golden'), null);
});

test('кейс не открывается в полный арсенал и ничего не списывает', () => {
  const s = createState();
  s.gold = 1e9;
  s.guns.fill(1);
  assert.equal(caseBlocker(s, 'common'), 'full');
  assert.equal(openCase(s, 'common'), null);
  assert.equal(s.gold, 1e9);
});

test('ключи и гарантия переживают перерождение', () => {
  const s = createState();
  s.maxStage = 40;
  s.keys = 5;
  s.pity = 4;
  prestige(s);
  assert.equal(s.keys, 5);
  assert.equal(s.pity, 4);
});

test('скорость: ×5 открывается после перерождения', () => {
  const s = createState();
  assert.deepEqual(availableSpeeds(s), [1, 2, 3]);
  assert.equal(cycleSpeed(s), 2);
  assert.equal(cycleSpeed(s), 3);
  assert.equal(cycleSpeed(s), 1);
  s.stats.prestiges = 1;
  s.speed = 3;
  assert.equal(cycleSpeed(s), 5);
  assert.equal(deserialize(serialize(s)).speed, 5);
  s.stats.prestiges = 0;
  assert.equal(deserialize(serialize(s)).speed, 1, 'недоступная скорость сбрасывается');
});
