import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, WORLD } from '../src/battle.js';
import { createState, chooseChapter } from '../src/state.js';
import { CHAPTER_BOSS_TIME_LIMIT, ARENA, DASH } from '../src/config.js';
import { ALLY_BOSS_WEAKEN } from '../src/story.js';

const run = (battle, seconds, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) battle.update(dt);
};

// Бой без случайных волн: враги появляются только по команде теста.
const quiet = (state) => {
  const battle = new Battle(state);
  battle.spawnCd = Infinity;
  battle.crateCd = Infinity;
  battle.chestCd = Infinity;
  return battle;
};

// ---------- Ход боя ----------
test('на автопилоте отряд проходит первый этап, собирает монеты и золото', () => {
  const state = createState();
  const battle = new Battle(state);
  run(battle, 40);
  assert.ok(state.stage >= 2, `застрял на этапе ${state.stage}`);
  assert.ok(state.gold > 0);
  assert.ok(state.stats.coins > 0, 'монеты подобраны');
});

test('враги появляются за краями арены и бегут к котикам', () => {
  const state = createState();
  const battle = quiet(state);
  state.slots = [0, 0, 0]; // никто не стреляет
  battle.refresh();
  for (let i = 0; i < 30; i++) {
    const p = battle.edgePoint();
    const outside = p.x < 0 || p.x > WORLD.width || p.y < 30 || p.y > WORLD.height;
    assert.ok(outside, `${p.x}, ${p.y}`);
  }
  const e = battle.spawnEnemy('sword', { x: -20, y: 100 });
  const before = Math.hypot(e.x - battle.leader.x, e.y - battle.leader.y);
  battle.input.lastAt = battle.time; // «ручное» управление без цели — отряд стоит
  run(battle, 1);
  const after = Math.hypot(e.x - battle.leader.x, e.y - battle.leader.y);
  assert.ok(after < before - 30);
});

test('слабый отряд проваливает босса и откатывается назад', () => {
  const state = createState();
  state.stage = 5;
  state.maxStage = 5;
  state.autoBoss = false; // проверяем сам провал, без авто-повтора
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
});

test('ускорение ×3 проходит этап примерно втрое быстрее', () => {
  const play = (speed) => {
    const state = createState();
    const battle = new Battle(state);
    let frames = 0;
    while (state.stage < 2 && frames < 20000) {
      for (let i = 0; i < speed; i++) battle.update(1 / 60);
      frames++;
    }
    return frames;
  };
  const normal = play(1);
  const fast = play(3);
  assert.ok(fast < normal / 2, `×1: ${normal} кадров, ×3: ${fast}`);
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
  assert.equal(b.activeCats.length, 3);
  assert.ok(team.gold > solo.gold);
});

// ---------- Управление ----------
test('ведущий бежит к указателю, остальные идут за ним змейкой', () => {
  const state = createState();
  state.maxStage = 20;
  state.slots = [1, 1, 1];
  const battle = quiet(state);
  battle.refresh();
  battle.setTarget(400, 120);
  for (let t = 0; t < 3; t += 1 / 30) {
    battle.setTarget(400, 120); // курсор над ареной
    battle.update(1 / 30);
  }
  const [a, b, c] = battle.activeCats.map((i) => battle.cats[i]);
  assert.ok(Math.hypot(a.x - 400, a.y - 120) < 8, 'ведущий дошёл');
  const gap = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(gap > ARENA.followGap * 0.6 && gap < ARENA.followGap * 1.6, `зазор ${gap}`);
  assert.ok(Math.hypot(b.x - c.x, b.y - c.y) > ARENA.followGap * 0.6);
});

test('клавиши двигают отряд, котики не выходят за арену', () => {
  const state = createState();
  const battle = quiet(state);
  battle.setKeys(1, 0);
  run(battle, 10);
  assert.ok(battle.leader.x <= WORLD.width - ARENA.margin + 0.01);
  assert.ok(battle.leader.x > WORLD.width - ARENA.margin - 2);
});

test('рывок: бросок вперёд, неуязвимость и перезарядка', () => {
  const state = createState();
  const battle = quiet(state);
  battle.setKeys(1, 0);
  battle.update(1 / 60);
  const x0 = battle.leader.x;
  assert.equal(battle.dashNow(), true);
  assert.equal(battle.dashNow(), false, 'перезарядка');
  run(battle, DASH.duration, 1 / 120);
  assert.ok(battle.leader.x - x0 > DASH.distance * 0.8);
  const hp = battle.hero.hp;
  assert.equal(battle.damageSquad(10, 0), false, 'во время рывка урон не проходит');
  assert.equal(battle.hero.hp, hp);
  assert.equal(state.stats.dashes, 1);
});

test('без управления включается автопилот: котики убегают от врага', () => {
  const state = createState();
  state.slots = [0, 0, 0];
  const battle = quiet(state);
  battle.refresh();
  const L = battle.leader;
  const e = battle.spawnEnemy('knight', { x: L.x + 40, y: L.y });
  e.speed = 0;
  run(battle, 1);
  assert.ok(battle.leader.x < e.x - 60, 'отошёл от врага');
  state.autopilot = false;
  const x = battle.leader.x;
  run(battle, 1);
  assert.equal(battle.leader.x, x, 'без автопилота стоит');
});

// ---------- Добыча ----------
test('монеты рассыпаются по земле, притягиваются к котику и сами прилетают со временем', () => {
  const state = createState();
  const battle = quiet(state);
  battle.dropCoin(battle.leader.x + 200, battle.leader.y, 5);
  battle.input.lastAt = battle.time; // стоим на месте
  run(battle, 1);
  assert.equal(state.gold, 0, 'далеко — сама не подбирается');
  battle.dropCoin(battle.leader.x + 20, battle.leader.y, 7);
  for (let t = 0; t < 1; t += 1 / 30) {
    battle.input.lastAt = battle.time;
    battle.update(1 / 30);
  }
  assert.equal(state.gold, 7, 'рядом — притянулась');
  for (let t = 0; t < ARENA.coinAutoCollect + 2; t += 1 / 30) {
    battle.input.lastAt = battle.time;
    battle.update(1 / 30);
  }
  assert.equal(state.gold, 12, 'дальняя монета прилетела сама');
});

test('золото с врага выпадает монетами, после этапа несобранные монеты не пропадают', () => {
  const state = createState();
  const battle = quiet(state);
  const e = battle.spawnEnemy('sword', { x: 300, y: 200 });
  battle.hit(e, e.hp + 1, false, battle.squad);
  const coins = battle.pickups.filter((p) => p.kind === 'coin');
  assert.equal(coins.length, ARENA.coinsPerKill);
  const total = coins.reduce((s, p) => s + p.value, 0);
  battle.advance();
  assert.ok(Math.abs(state.gold - total) < 1e-9);
});

test('звёздный сундук падает на арену: подбери — награда, не успел — исчез', () => {
  const state = createState();
  state.maxStage = 10;
  const battle = quiet(state);
  battle.chestCd = 0;
  battle.update(1 / 60);
  const chest = battle.pickups.find((p) => p.kind === 'chest');
  assert.ok(chest, 'упал');
  const rewards = [];
  battle.events.onChest = (r) => rewards.push(r);
  battle.chestCd = Infinity;
  battle.leader.x = chest.x;
  battle.leader.y = chest.y;
  battle.input.lastAt = battle.time;
  battle.update(1 / 60);
  assert.equal(rewards.length, 1);
  assert.equal(state.stats.chests, 1);
  battle.pickups.push({ kind: 'chest', x: 30, y: 300, t: 0, life: 1, lifeMax: 1, drop: 0 });
  battle.leader.x = 400;
  battle.leader.y = 100;
  for (let t = 0; t < 2; t += 1 / 30) {
    battle.input.lastAt = battle.time;
    battle.update(1 / 30);
  }
  assert.equal(battle.pickups.filter((p) => p.kind === 'chest').length, 0);
  assert.equal(rewards.length, 1);
});

test('ящик с оружием стоит на арене, его можно разбить и получить пушку', () => {
  const state = createState();
  const drops = [];
  const battle = new Battle(state, { onGunDrop: (tier, placed) => drops.push({ tier, placed }) });
  const random = Math.random;
  Math.random = () => 0; // гарантированный дроп
  try {
    const crate = battle.spawnEnemy('crate', { x: 300, y: 200 });
    battle.hit(crate, crate.hp + 1, false, battle.squad);
  } finally {
    Math.random = random;
  }
  assert.deepEqual(drops, [{ tier: 1, placed: true }]);
  assert.equal(state.stats.crates, 1);
  assert.equal(battle.killed, 0, 'ящик не считается в волну');
});

test('котики стреляют по воительницам раньше, чем по ящикам', () => {
  const state = createState();
  const battle = quiet(state);
  const L = battle.leader;
  const crate = battle.spawnEnemy('crate', { x: L.x + 40, y: L.y });
  const girl = battle.spawnEnemy('sword', { x: L.x + 120, y: L.y });
  assert.equal(battle.targetFor(L), girl);
  battle.enemies = [crate];
  assert.equal(battle.targetFor(L), crate);
});

test('золотая мышь пересекает арену и убегает, если её не подстрелить', () => {
  const state = createState();
  state.slots = [0, 0, 0];
  const battle = quiet(state);
  battle.refresh();
  battle.spawnEnemy('goldMouse');
  run(battle, 12);
  assert.equal(battle.enemies.length, 0);
  assert.equal(battle.killed, 1, 'побег засчитывается в прогресс этапа');
  assert.equal(state.gold, 0);
});

// ---------- Волшебницы и сферы ----------
test('волшебница держит дистанцию, сфера летит по прямой — от неё можно увернуться', () => {
  const state = createState();
  state.slots = [0, 0, 0];
  const battle = quiet(state);
  battle.refresh();
  const L = battle.leader;
  const mage = battle.spawnEnemy('mage', { x: L.x + 300, y: L.y });
  battle.input.lastAt = battle.time;
  for (let t = 0; t < 4; t += 1 / 60) {
    battle.input.lastAt = battle.time;
    battle.update(1 / 60);
  }
  const d = Math.hypot(mage.x - L.x, mage.y - L.y);
  assert.ok(d < 200 && d > 90, `дистанция ${d}`);

  // стоим — сфера попадает
  const hp = battle.hero.hp;
  battle.orbs = [];
  battle.fireOrb(mage, L, 150, 5);
  for (let t = 0; t < 2; t += 1 / 60) {
    battle.input.lastAt = battle.time;
    battle.update(1 / 60);
  }
  assert.ok(battle.hero.hp < hp, 'стоял — попало');

  // уходим поперёк — промах
  const hp2 = battle.hero.hp;
  battle.orbs = [];
  mage.castCd = Infinity;
  battle.fireOrb(mage, L, 150, 5);
  battle.setKeys(0, 1);
  run(battle, 2, 1 / 60);
  assert.equal(battle.hero.hp, hp2, 'увернулся');
});

test('урон обрывает серию побед без урона', () => {
  const state = createState();
  const battle = quiet(state);
  for (let i = 0; i < 3; i++) {
    const e = battle.spawnEnemy('ninja', { x: 300, y: 200 });
    battle.hit(e, e.hp + 1, false, battle.squad);
  }
  assert.equal(battle.streak, 3);
  assert.equal(state.stats.bestStreak, 3);
  battle.damageSquad(1, 0);
  assert.equal(battle.streak, 0);
});

// ---------- Героини глав ----------
function chapterBattle(stage, setup) {
  const state = createState();
  state.stage = stage;
  state.maxStage = stage;
  setup?.(state);
  const battle = new Battle(state);
  battle.spawnCd = 0; // босс выходит сразу
  battle.update(1 / 60);
  const boss = battle.enemies.find((e) => e.isBoss);
  boss.x = 360;
  boss.y = 200;
  return { state, battle, boss };
}

test('героиня главы: больше времени на бой и своё имя', () => {
  const { battle, boss } = chapterBattle(10);
  assert.equal(boss.heroine.key, 'sakura');
  assert.ok(battle.bossTimer > CHAPTER_BOSS_TIME_LIMIT - 1);
  const { boss: captain } = chapterBattle(15);
  assert.equal(captain.heroine, null, 'на 5-м этапе главы — обычный капитан');
});

test('щит Рин блокирует пули', () => {
  const { battle, boss } = chapterBattle(40);
  assert.equal(boss.heroine.ability, 'shield');
  boss.shield = 2;
  const hp = boss.hp;
  battle.hit(boss, 100, false, battle.squad);
  assert.equal(boss.hp, hp);
  boss.shield = 0;
  battle.hit(boss, 100, false, battle.squad);
  assert.equal(boss.hp, hp - 100);
});

test('Юки замораживает отряд — он не стреляет и не двигается', () => {
  const { battle, boss } = chapterBattle(30);
  boss.hp = 1e12;
  boss.timers.freeze = 0;
  battle.update(1 / 60);
  assert.ok(battle.freeze > 0);
  battle.bullets = [];
  battle.setKeys(1, 0);
  const x = battle.leader.x;
  battle.update(1 / 60);
  assert.equal(battle.bullets.length, 0);
  assert.equal(battle.leader.x, x);
});

test('Сакура лечится, Микото зовёт ниндзя (они не идут в зачёт этапа)', () => {
  const { battle, boss } = chapterBattle(10);
  boss.hp = boss.maxHp / 2;
  boss.timers.heal = 0;
  battle.update(1 / 60);
  assert.ok(boss.hp > boss.maxHp / 2);

  const m = chapterBattle(50);
  m.boss.timers.summon = 0;
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

test('героини Re:Zero появляются на этапах 70–120', () => {
  const keys = [70, 80, 90, 100, 110, 120].map((st) => chapterBattle(st).boss.heroine.key);
  assert.deepEqual(keys, ['felt', 'ram', 'rem', 'beatrice', 'emilia', 'echidna']);
  assert.equal(chapterBattle(130).boss.heroine.key, 'sakura', 'после 120-го главы идут по кругу');
});

test('Рем впадает в ярость на половине здоровья и бьёт чаще и сильнее', () => {
  const { battle, boss } = chapterBattle(90);
  const hits = [];
  battle.damageSquad = (dmg) => hits.push(dmg); // отряд бессмертен — считаем удары
  const pin = () => {
    // держим Рем вплотную к ведущему, ведущего — на месте
    battle.input.lastAt = battle.time;
    boss.x = battle.leader.x + 20;
    boss.y = battle.leader.y;
  };
  for (let t = 0; t < 3; t += 1 / 60) {
    pin();
    battle.update(1 / 60);
  }
  const calm = hits.length;
  const calmDamage = hits[0];
  boss.hp = boss.maxHp * 0.4;
  pin();
  battle.update(1 / 60);
  assert.equal(boss.enraged, true);
  hits.length = 0;
  for (let t = 0; t < 3; t += 1 / 60) {
    pin();
    battle.update(1 / 60);
  }
  assert.ok(calm >= 2, `спокойная ударила ${calm} раз`);
  assert.ok(hits.length >= calm * 1.8, `спокойная: ${calm}, в ярости: ${hits.length}`);
  assert.ok(hits[0] > calmDamage * 1.4);
});

test('Рам бросает веер лезвий в отряд, Беатрис вытягивает силы', () => {
  const r = chapterBattle(80);
  r.boss.timers.volley = 0;
  r.battle.update(1 / 60);
  const blades = r.battle.orbs.filter((o) => o.wind);
  assert.equal(blades.length, 3);
  assert.ok(blades.every((o) => o.vx < 0), 'летят в сторону отряда');

  const b = chapterBattle(100);
  b.boss.hp = b.boss.maxHp / 2;
  const hp = b.battle.hero.hp;
  b.boss.timers.drain = 0;
  b.battle.update(1 / 60);
  assert.ok(b.battle.hero.hp < hp);
  assert.ok(b.boss.hp > b.boss.maxHp / 2);
});

test('Фельт уворачивается чаще Аяме', () => {
  const dodges = (stage) => {
    const { battle, boss } = chapterBattle(stage);
    boss.hp = 1e12;
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const before = boss.hp;
      battle.hit(boss, 1, false, battle.squad);
      if (boss.hp === before) n++;
    }
    return n / 2000;
  };
  assert.ok(Math.abs(dodges(70) - 0.35) < 0.05);
  assert.ok(Math.abs(dodges(20) - 0.25) < 0.05);
});

test('финал книги 2 ослабляют только союзницы книги 2', () => {
  const alone = chapterBattle(120).boss;
  const helped = chapterBattle(120, (s) => {
    chooseChapter(s, 0, 'spare'); // героиня книги 1 — не помогает Эхидне
    chooseChapter(s, 6, 'spare');
    chooseChapter(s, 9, 'spare');
  }).boss;
  assert.ok(Math.abs(helped.maxHp / alone.maxHp - (1 - 2 * ALLY_BOSS_WEAKEN)) < 1e-9);
});

test('босс даёт ключ, каждый 10-й — два', () => {
  for (const [stage, expected] of [[5, 1], [10, 2]]) {
    const { state, battle, boss } = chapterBattle(stage);
    const keys = state.keys;
    boss.shield = 0;
    boss.heroine = null; // без уворотов
    battle.hit(boss, boss.hp + 1, false, battle.squad);
    assert.equal(state.keys - keys, expected, `этап ${stage}`);
  }
});

// ---------- Упорство, авто-босс, навыки ----------
test('упорство: каждый проигрыш боссу +10% урона против него, победа сбрасывает', () => {
  const state = createState();
  state.stage = 5;
  state.maxStage = 5;
  state.autoBoss = false;
  const battle = new Battle(state);
  battle.fail('test');
  assert.deepEqual(state.resolve, { stage: 5, stacks: 1 });
  battle.challengeBoss();
  battle.fail('test');
  assert.equal(state.resolve.stacks, 2);
  battle.challengeBoss();
  const boss = battle.enemies.find((e) => e.isBoss) ?? battle.spawnEnemy('boss');
  battle.hit(boss, boss.hp + 1, false, battle.squad);
  assert.deepEqual(state.resolve, { stage: 0, stacks: 0 });
});

test('авто-босс: после фарма отряд сам идёт на босса', () => {
  const state = createState();
  state.stage = 4;
  state.maxStage = 5;
  state.autoAdvance = false;
  const battle = quiet(state);
  run(battle, 31);
  assert.equal(state.autoAdvance, true);
  assert.equal(state.stage, 5);
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
