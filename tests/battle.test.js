import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/battle.js';
import { createState } from '../src/state.js';

const run = (battle, seconds, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) battle.update(dt);
};

test('отряд проходит первый этап и получает золото', () => {
  const state = createState();
  const battle = new Battle(state);
  run(battle, 40);
  assert.ok(state.stage >= 2, `застрял на этапе ${state.stage}`);
  assert.ok(state.gold > 0);
  assert.ok(battle.scroll > 0, 'отряд двигался вперёд');
});

test('слабый отряд проваливает босса и откатывается назад', () => {
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

test('сильный отряд побеждает босса', () => {
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

test('препятствие останавливает отряд, пока его не разрушат', () => {
  const state = createState();
  state.slots = [0, 0, 0]; // без оружия — никто не стреляет
  const battle = new Battle(state);
  battle.nextSpawnIn = Infinity;
  battle.spawnEnemy('tree');
  run(battle, 15);
  assert.equal(battle.walking, false);
  assert.equal(battle.enemies.length, 1);
  const tree = battle.enemies[0];
  battle.hit(tree, tree.hp + 1, false, battle.squad);
  battle.update(1 / 30);
  assert.equal(battle.walking, true);
});

test('ящик может выронить пушку в арсенал', () => {
  const state = createState();
  const drops = [];
  const battle = new Battle(state, { onGunDrop: (tier, placed) => drops.push({ tier, placed }) });
  const random = Math.random;
  Math.random = () => 0; // гарантированный дроп
  try {
    battle.spawnEnemy('crate');
    const crate = battle.enemies.at(-1);
    battle.hit(crate, crate.hp + 1, false, battle.squad);
  } finally {
    Math.random = random;
  }
  assert.deepEqual(drops, [{ tier: 1, placed: true }]);
  assert.equal(state.guns.filter(Boolean).length, 1);
});

test('золотая мышь убегает, если её не подстрелить', () => {
  const state = createState();
  state.slots = [0, 0, 0];
  const battle = new Battle(state);
  battle.nextSpawnIn = Infinity;
  battle.spawnEnemy('goldMouse');
  run(battle, 12);
  assert.equal(battle.enemies.length, 0);
  assert.equal(battle.killed, 1, 'побег засчитывается в прогресс этапа');
  assert.equal(state.gold, 0);
});

test('три котика наносят больше урона, чем один', () => {
  const solo = createState();
  const team = createState();
  for (const s of [solo, team]) {
    s.stage = 9;
    s.maxStage = 20;
  }
  team.slots = [1, 1, 1];
  const a = new Battle(solo);
  const b = new Battle(team);
  run(a, 30);
  run(b, 30);
  assert.ok(b.squad.cats.filter(Boolean).length === 3);
  assert.ok(team.gold > solo.gold);
});

test('босс даёт ключ, каждый 10-й — два', () => {
  for (const [stage, expected] of [[5, 1], [10, 2]]) {
    const state = createState();
    state.stage = stage;
    state.maxStage = stage;
    const keys = state.keys;
    const battle = new Battle(state);
    const boss = battle.enemies.find((e) => e.isBoss) ?? (battle.spawnEnemy('boss'), battle.enemies.at(-1));
    battle.hit(boss, boss.hp + 1, false, battle.squad);
    assert.equal(state.keys - keys, expected, `этап ${stage}`);
  }
});

test('ускорение ×3 проходит этап примерно втрое быстрее', () => {
  const play = (speed) => {
    const state = createState();
    const battle = new Battle(state);
    let frames = 0;
    while (state.stage < 2 && frames < 10000) {
      for (let i = 0; i < speed; i++) battle.update(1 / 60);
      frames++;
    }
    return frames;
  };
  const normal = play(1);
  const fast = play(3);
  assert.ok(fast < normal / 2, `×1: ${normal} кадров, ×3: ${fast}`);
});
