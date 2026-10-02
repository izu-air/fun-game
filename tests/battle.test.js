import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, WORLD, SQUAD, FRONT_X } from '../src/battle.js';

import { createState, chooseChapter } from '../src/state.js';
import { ENEMY_TYPES, PET, CHAPTER_BOSS_TIME_LIMIT } from '../src/config.js';
import { ALLY_BOSS_WEAKEN } from '../src/story.js';

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

// ---------- Взаимодействия ----------
const quiet = (state) => {
  const battle = new Battle(state);
  battle.nextSpawnIn = Infinity; // никаких случайных врагов
  return battle;
};

test('удар лапкой по врагу наносит урон и считается в статистику', () => {
  const state = createState();
  const battle = quiet(state);
  const e = battle.spawnEnemy('knight', 300);
  const hp = e.hp;
  assert.equal(battle.tap(e.x, battle.aimY(e)), 'hit');
  assert.ok(e.hp < hp);
  assert.equal(state.stats.taps, 1);
  assert.equal(battle.tap(e.x, battle.aimY(e)), null, 'слишком частые удары игнорируются');
  battle.update(0.1);
  assert.equal(battle.tap(20, 20), 'miss', 'мимо врагов');
});

test('поглаженный котик стреляет быстрее, гладить можно не чаще раза в 10 с', () => {
  const state = createState();
  const battle = quiet(state);
  const x = SQUAD[0].x;
  const y = WORLD.groundY - 30;
  assert.equal(battle.tap(x, y), 'pet');
  assert.ok(battle.cats[0].happy > 0);
  assert.equal(state.stats.pets, 1);
  assert.equal(battle.tap(x, y), 'busy');
  // сравниваем частоту выстрелов
  const shots = (happy) => {
    const b = quiet(createState());
    b.spawnEnemy('knight', 300).hp = 1e12;
    if (happy) b.cats[0].happy = 100;
    let n = 0;
    b.events.sfx = (name) => { if (name === 'shot') n++; };
    for (let t = 0; t < 5; t += 1 / 60) b.update(1 / 60);
    return n;
  };
  assert.ok(shots(true) > shots(false));
  assert.ok(PET.cooldown > PET.duration);
});

test('волшебница держит дистанцию и бросает сферы, сферу можно сбить пальцем', () => {
  const state = createState();
  const battle = quiet(state);
  battle.state.slots = [0, 0, 0];
  const mage = battle.spawnEnemy('mage', 440);
  const hp = battle.hero.hp;
  for (let t = 0; t < 1.5; t += 1 / 60) battle.update(1 / 60);
  assert.equal(mage.x, FRONT_X + ENEMY_TYPES.mage.ranged.range, 'остановилась на дистанции');
  for (let t = 0; t < 6; t += 1 / 60) battle.update(1 / 60);
  assert.ok(battle.hero.hp < hp, 'сферы долетели');
  battle.orbs = [{ x: 300, y: 200, speed: 0, damage: 1, life: 5 }];
  battle.tapCd = 0;
  assert.equal(battle.tap(300, 200), 'orb');
  battle.update(1 / 60);
  assert.equal(battle.orbs.length, 0);
});

function chapterBattle(chapterStage, setup) {
  const state = createState();
  state.stage = chapterStage;
  state.maxStage = chapterStage;
  setup?.(state);
  const battle = new Battle(state);
  battle.update(1 / 60);
  const boss = battle.enemies.find((e) => e.isBoss);
  boss.x = 300;
  return { state, battle, boss };
}

test('героиня главы: больше времени на бой и своё имя', () => {
  const { battle, boss } = chapterBattle(10);
  assert.equal(boss.heroine.key, 'sakura');
  assert.ok(battle.bossTimer > CHAPTER_BOSS_TIME_LIMIT - 1);
  const { boss: captain } = chapterBattle(15);
  assert.equal(captain.heroine, null, 'на 5-м этапе главы — обычный капитан');
});

test('щит Рин блокирует пули, но не лапку', () => {
  const { battle, boss } = chapterBattle(40);
  assert.equal(boss.heroine.ability, 'shield');
  boss.shield = 2;
  const hp = boss.hp;
  battle.hit(boss, 100, false, battle.squad);
  assert.equal(boss.hp, hp);
  battle.hit(boss, 100, false, battle.squad, true);
  assert.equal(boss.hp, hp - 100);
});

test('Юки замораживает отряд — он перестаёт стрелять', () => {
  const { battle, boss } = chapterBattle(30);
  boss.hp = 1e12;
  boss.abilityCd = 0;
  battle.update(1 / 60);
  assert.ok(battle.freeze > 0);
  battle.bullets = [];
  battle.update(1 / 60);
  assert.equal(battle.bullets.length, 0);
});

test('Сакура лечится, Микото зовёт ниндзя (они не идут в зачёт этапа)', () => {
  const { battle, boss } = chapterBattle(10);
  boss.hp = boss.maxHp / 2;
  boss.abilityCd = 0;
  battle.update(1 / 60);
  assert.ok(boss.hp > boss.maxHp / 2);

  const m = chapterBattle(50);
  m.boss.abilityCd = 0;
  m.battle.update(1 / 60);
  const minions = m.battle.enemies.filter((e) => e.minion);
  assert.equal(minions.length, 2);
  m.battle.hit(minions[0], 1e12, false, m.battle.squad);
  assert.equal(m.battle.killed, 0);
});

test('пощажённые героини ослабляют Императрицу', () => {
  const alone = chapterBattle(60).boss;
  const helped = chapterBattle(60, (s) => {
    chooseChapter(s, 0, 'spare');
    chooseChapter(s, 1, 'spare');
    chooseChapter(s, 2, 'trophy');
  }).boss;
  assert.equal(alone.heroine.key, 'luna');
  assert.ok(Math.abs(helped.maxHp / alone.maxHp - (1 - 2 * ALLY_BOSS_WEAKEN)) < 1e-9);
});
