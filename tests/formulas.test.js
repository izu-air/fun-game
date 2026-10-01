import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enemyHp, enemyGold, upgradeCost, bulkPurchase, heroStats, expectedDps, bonesForPrestige,
  formatNumber, formatDuration, isBossStage, pickEnemyType, biomeFor, isMaxed,
  gunInfo, gunCost, buyTier, squadStats, squadDps,
} from '../src/formulas.js';
import { UPGRADES, BIOMES, MAX_GUN_TIER, CATS } from '../src/config.js';

test('HP и золото врагов растут с этапом', () => {
  assert.ok(enemyHp(2) > enemyHp(1));
  assert.ok(enemyGold(10) > enemyGold(9));
  assert.equal(enemyHp(5, 'boss'), enemyHp(5) * 15);
});

test('босс каждые 5 этапов', () => {
  assert.equal(isBossStage(5), true);
  assert.equal(isBossStage(10), true);
  assert.equal(isBossStage(7), false);
});

test('цена улучшения растёт экспоненциально', () => {
  assert.equal(upgradeCost('damage', 0), UPGRADES.damage.baseCost);
  assert.ok(upgradeCost('damage', 10) > upgradeCost('damage', 9));
});

test('оптовая покупка не тратит больше, чем есть', () => {
  const { count, cost } = bulkPurchase('damage', 0, 100);
  assert.ok(count > 1);
  assert.ok(cost <= 100);
  assert.ok(cost + upgradeCost('damage', count) > 100);
  assert.deepEqual(bulkPurchase('damage', 0, 1000, 3).count, 3);
});

test('оптовая покупка уважает максимальный уровень', () => {
  const max = UPGRADES.fireRate.maxLevel;
  assert.equal(bulkPurchase('fireRate', max - 2, 1e30).count, 2);
  assert.equal(isMaxed('fireRate', max), true);
  assert.equal(isMaxed('damage', 10_000), false);
});

test('урон удваивается каждые 25 уровней', () => {
  const at24 = heroStats({ damage: 24 }).damage;
  const at25 = heroStats({ damage: 25 }).damage;
  assert.ok(at25 / at24 > 2);
});

test('косточки увеличивают урон и золото на 10% каждая', () => {
  const base = heroStats({});
  const boosted = heroStats({}, 5);
  assert.ok(Math.abs(boosted.damage / base.damage - 1.5) < 1e-9);
  assert.ok(Math.abs(boosted.goldMult / base.goldMult - 1.5) < 1e-9);
});

test('шанс крита ограничен 50%', () => {
  assert.equal(heroStats({ critChance: 1000 }).critChance, 0.5);
});

test('DPS учитывает криты и баффы', () => {
  const s = { damage: 10, fireRate: 2, critChance: 0.5, critMult: 3 };
  assert.equal(expectedDps(s), 10 * 2 * 2);
  assert.equal(expectedDps(s, 2, 3), 10 * 2 * 2 * 6);
});

test('косточки за перерождение', () => {
  assert.equal(bonesForPrestige(24), 0);
  assert.ok(bonesForPrestige(25) >= 1);
  assert.ok(bonesForPrestige(60) > bonesForPrestige(40));
});

test('форматирование чисел', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(5.5), '5.5');
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(1500), '1.50K');
  assert.equal(formatNumber(2_340_000), '2.34M');
  assert.equal(formatNumber(999_999), '1.00M');
  assert.equal(formatNumber(1e15), '1.00aa');
  assert.equal(formatNumber(Infinity), '∞');
});

test('форматирование времени', () => {
  assert.equal(formatDuration(42), '42 с');
  assert.equal(formatDuration(125), '2 мин 5 с');
  assert.equal(formatDuration(3 * 3600 + 120), '3 ч 2 мин');
});

test('псы не появляются на первых этапах', () => {
  for (let i = 0; i < 200; i++) {
    assert.notEqual(pickEnemyType(1, () => i / 200), 'dog');
  }
  const seen = new Set(Array.from({ length: 200 }, (_, i) => pickEnemyType(10, () => i / 200)));
  assert.ok(seen.has('dog') && seen.has('mouse') && seen.has('rat'));
});

test('биомы сменяются каждые 10 этапов', () => {
  assert.equal(biomeFor(1), BIOMES[0]);
  assert.equal(biomeFor(10), BIOMES[0]);
  assert.equal(biomeFor(11), BIOMES[1]);
  assert.equal(biomeFor(BIOMES.length * 10 + 1), BIOMES[0]);
});

test('уровни оружия: семейства и редкость', () => {
  assert.equal(gunInfo(1).family.key, 'pistol');
  assert.equal(gunInfo(1).rarity.name, 'обычный');
  assert.equal(gunInfo(5).rarity.name, 'легендарный');
  assert.equal(gunInfo(6).family.key, 'smg');
  assert.equal(gunInfo(MAX_GUN_TIER).family.key, 'minigun');
  assert.ok(gunInfo(10).power > gunInfo(9).power);
});

test('каждое слияние строго усиливает пушку', () => {
  const dps = (tier) => squadDps(squadStats({}, 0, [tier, 0, 0]));
  for (let t = 1; t < MAX_GUN_TIER; t++) {
    assert.ok(dps(t + 1) > dps(t) * 1.3, `уровень ${t} → ${t + 1}`);
  }
});

test('цена пушек и кузня', () => {
  assert.ok(gunCost(10) > gunCost(0));
  assert.equal(buyTier(0), 1);
  assert.equal(buyTier(3), 4);
  assert.equal(buyTier(1000), MAX_GUN_TIER);
});

test('отряд: котик появляется только с пушкой и после открытия', () => {
  const squad = squadStats({}, 0, [1, 0, 3], CATS[2].unlockStage - 1);
  assert.ok(squad.cats[0]);
  assert.equal(squad.cats[1], null);
  assert.equal(squad.cats[2], null, 'Уголёк ещё не открыт');
  const later = squadStats({}, 0, [1, 0, 3], CATS[2].unlockStage);
  assert.ok(later.cats[2]);
});

test('бонусы котиков работают на весь отряд', () => {
  const solo = squadStats({}, 0, [1, 0, 0], 100);
  const duo = squadStats({}, 0, [1, 1, 0], 100);
  assert.ok(Math.abs(solo.cats[0].damage / squadStats({}, 0, [0, 1, 0], 100).cats[1].damage - 1.1) < 1e-9, 'лидерский бонус Рыжика');
  assert.ok(duo.cats[0].critChance > solo.cats[0].critChance, 'бонус Снежка');
});

test('дробовик стреляет дробью, снайперка пробивает', () => {
  const shotgun = squadStats({}, 0, [11, 0, 0]).cats[0];
  assert.equal(shotgun.pellets, 3);
  const sniper = squadStats({}, 0, [21, 0, 0]).cats[0];
  assert.equal(sniper.pierce, 1);
});
