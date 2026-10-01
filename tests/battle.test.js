import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/battle.js';
import { createState } from '../src/state.js';

const run = (battle, seconds, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) battle.update(dt);
};

test('котик проходит первый этап и получает золото', () => {
  const state = createState();
  const battle = new Battle(state);
  run(battle, 40);
  assert.ok(state.stage >= 2, `застрял на этапе ${state.stage}`);
  assert.ok(state.gold > 0);
  assert.ok(state.stats.kills >= 10);
});

test('слабый котик проваливает босса и откатывается назад', () => {
  const state = createState();
  state.stage = 5;
  state.maxStage = 5;
  const messages = [];
  const battle = new Battle(state, { onStageFail: (m) => messages.push(m) });
  run(battle, 40);
  assert.equal(state.autoAdvance, false);
  assert.ok(state.stage <= 4);
  assert.ok(messages.length >= 1);
});

test('вызов босса снова включает продвижение', () => {
  const state = createState();
  state.stage = 4;
  state.maxStage = 5;
  state.autoAdvance = false;
  const battle = new Battle(state);
  battle.challengeBoss();
  assert.equal(state.autoAdvance, true);
  assert.equal(state.stage, 5);
  assert.equal(battle.isBoss, true);
});

test('сильный котик побеждает босса', () => {
  const state = createState();
  state.stage = 5;
  state.maxStage = 5;
  state.levels.damage = 60;
  state.levels.maxHp = 30;
  const battle = new Battle(state);
  run(battle, 35);
  assert.ok(state.stage >= 6);
  assert.equal(state.stats.bossKills, 1);
});

test('навыки: откат, бафф и блокировка до нужного этапа', () => {
  const state = createState();
  const battle = new Battle(state);
  assert.equal(battle.cast('volley'), false, 'залп закрыт на 1 этапе');
  state.maxStage = 20;
  assert.equal(battle.cast('volley'), true);
  assert.ok(battle.buffs.volley > 0);
  assert.equal(battle.cast('volley'), false, 'на откате');
  battle.hero.hp = 1;
  assert.equal(battle.cast('purr'), true);
  assert.ok(battle.hero.hp > 1);
});

test('авто-навыки срабатывают сами', () => {
  const state = createState();
  state.maxStage = 20;
  state.autoSkills = true;
  const battle = new Battle(state);
  run(battle, 3);
  assert.ok(battle.cooldowns.volley > 0);
});
