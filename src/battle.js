// Боевая симуляция: отряд котиков идёт вперёд, сносит препятствия и отстреливается от врагов.
// Не сохраняется — живёт только в сессии.
import {
  ENEMIES_PER_STAGE, BOSS_TIME_LIMIT, MAX_ALIVE_ENEMIES, ENEMY, ENEMY_TYPES, HERO, SKILLS,
  MARCH_SPEED, SPAWN_GAP, CRATE_GUN_CHANCE, KEYS,
} from './config.js';
import {
  isBossStage, enemyHp, enemyDamage, enemyGold, pickEnemyType, formatNumber, buyTier,
} from './formulas.js';
import { statsOf, addGold, isSkillUnlocked, addGun, addKeys } from './state.js';

export const WORLD = { width: 480, height: 340, groundY: 278 };
// Позиции котиков в строю: первый слот впереди, остальные чуть дальше от зрителя.
export const SQUAD = [
  { x: 150, y: 0, scale: 1 },
  { x: 98, y: -12, scale: 0.9 },
  { x: 50, y: -24, scale: 0.8 },
];
export const FRONT_X = SQUAD[0].x + 26;

const BULLET_TURN_RATE = 9; // рад/с — пули доворачивают к цели, дробь сначала разлетается веером

export class Battle {
  constructor(state, events = {}) {
    this.state = state;
    // { onStageStart, onStageFail, onBossKill, onGunDrop, onKey, sfx }
    this.events = events;
    this.time = 0;
    this.scroll = 0;
    this.walking = true;
    this.shake = 0;
    this.buffs = { volley: 0, rage: 0 };
    this.cooldowns = Object.fromEntries(Object.keys(SKILLS).map((k) => [k, 0]));
    this.squad = statsOf(state);
    this.hero = { hp: this.squad.maxHp, hurt: 0 };
    this.cats = SQUAD.map(() => ({ fireCd: Math.random() * 0.3, recoil: 0, aim: 0 }));
    this.startStage();
  }

  get stats() {
    return this.squad;
  }

  get isBoss() {
    return isBossStage(this.state.stage);
  }

  get stageTarget() {
    return this.isBoss ? 1 : ENEMIES_PER_STAGE;
  }

  startStage() {
    this.enemies = [];
    this.bullets = [];
    this.particles = [];
    this.texts = [];
    this.spawned = 0;
    this.killed = 0;
    this.nextSpawnIn = 0;
    this.bossTimer = BOSS_TIME_LIMIT;
    this.stageClearDelay = 0;
    this.events.onStageStart?.(this.state.stage, this.isBoss);
  }

  // Пересчитать характеристики после покупки или смены оружия.
  refresh() {
    const before = this.squad.maxHp;
    this.squad = statsOf(this.state);
    this.hero.hp = Math.min(this.squad.maxHp, this.hero.hp + Math.max(0, this.squad.maxHp - before));
  }

  // ---------- Навыки ----------
  canCast(key) {
    return isSkillUnlocked(this.state, key) && this.cooldowns[key] <= 0;
  }

  cast(key) {
    if (!this.canCast(key)) return false;
    const skill = SKILLS[key];
    this.cooldowns[key] = skill.cooldown;
    if (skill.duration > 0) this.buffs[key] = skill.duration;
    if (skill.healPct) {
      const heal = this.squad.maxHp * skill.healPct;
      this.hero.hp = Math.min(this.squad.maxHp, this.hero.hp + heal);
      this.floatText(SQUAD[0].x, WORLD.groundY - 80, '+' + formatNumber(heal), '#4ade80', 20);
    }
    this.burst(SQUAD[1].x, WORLD.groundY - 30, '#ffd166', 18, 160);
    this.events.sfx?.('skill');
    return true;
  }

  // Бросить вызов боссу после провала.
  challengeBoss() {
    if (this.state.autoAdvance) return;
    this.state.autoAdvance = true;
    this.state.stage += 1;
    this.state.maxStage = Math.max(this.state.maxStage, this.state.stage);
    this.hero.hp = this.squad.maxHp;
    this.startStage();
  }

  // ---------- Основной цикл ----------
  update(dt) {
    this.time += dt;
    this.squad = statsOf(this.state);
    const squad = this.squad;

    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    for (const k of Object.keys(this.buffs)) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
    if (this.state.autoSkills) this.autoCast(squad);

    this.hero.hp = Math.min(squad.maxHp, this.hero.hp + squad.regen * dt);
    this.hero.hurt = Math.max(0, this.hero.hurt - dt * 4);
    for (const c of this.cats) c.recoil = Math.max(0, c.recoil - dt * 8);
    this.shake = Math.max(0, this.shake - dt * 30);

    this.walking = this.stageClearDelay <= 0 && !this.enemies.some((e) => e.x <= this.stopX(e) + 0.5);
    const march = this.walking ? MARCH_SPEED * dt : 0;
    this.scroll += march;

    if (this.stageClearDelay > 0) {
      this.stageClearDelay -= dt;
      if (this.stageClearDelay <= 0) this.advance();
    } else {
      this.updateSpawning(march);
      if (this.isBoss && this.enemies.some((e) => e.isBoss)) {
        this.bossTimer -= dt;
        if (this.bossTimer <= 0) return this.fail('Время вышло! Босс сбежал 🐶');
      }
    }

    this.updateShooting(dt, squad);
    this.updateBullets(dt, squad);
    this.updateEnemies(dt, march);
    this.updateEffects(dt, march);

    if (this.hero.hp <= 0) this.fail('Отряд устал… Отступаем на этап назад 😿');
  }

  autoCast(squad) {
    const hasTargets = this.enemies.length > 0;
    if (hasTargets && this.canCast('volley')) this.cast('volley');
    if (hasTargets && this.canCast('rage')) this.cast('rage');
    if (this.hero.hp < squad.maxHp * 0.5 && this.canCast('purr')) this.cast('purr');
  }

  // Где цель останавливается перед отрядом: у зверей голова выступает вперёд примерно на 1.4 размера.
  stopX(e) {
    return FRONT_X + e.size * (e.obstacle ? 1.1 : 1.4);
  }

  // Новые цели появляются по мере продвижения отряда.
  updateSpawning(march) {
    if (this.spawned >= this.stageTarget) return;
    this.nextSpawnIn -= march;
    if (this.nextSpawnIn > 0 || this.enemies.length >= MAX_ALIVE_ENEMIES) return;
    this.nextSpawnIn = SPAWN_GAP[0] + Math.random() * (SPAWN_GAP[1] - SPAWN_GAP[0]);
    this.spawnEnemy(this.isBoss ? 'boss' : pickEnemyType(this.state.stage));
    this.spawned++;
  }

  spawnEnemy(type) {
    const stage = this.state.stage;
    const t = ENEMY_TYPES[type];
    const hp = enemyHp(stage, type);
    this.enemies.push({
      type,
      isBoss: type === 'boss',
      obstacle: !!t.obstacle,
      runner: !!t.runner,
      fleeing: false,
      x: WORLD.width + t.size + 10,
      y: WORLD.groundY,
      hp,
      maxHp: hp,
      damage: enemyDamage(stage, type),
      gold: enemyGold(stage, type),
      speed: t.speed * (0.9 + Math.random() * 0.2),
      size: t.size,
      attackCd: 0.3,
      phase: Math.random() * Math.PI * 2,
      flash: 0,
      lunge: 0,
      variant: Math.random(),
    });
    if (type === 'goldMouse') this.floatText(WORLD.width - 60, WORLD.groundY - 60, 'Золотая мышь!', '#ffd700', 16);
  }

  updateShooting(dt, squad) {
    const target = this.nearestEnemy();
    const volley = this.buffs.volley > 0 ? SKILLS.volley.fireRateMult : 1;
    const rage = this.buffs.rage > 0 ? SKILLS.rage.damageMult : 1;
    squad.cats.forEach((cat, i) => {
      const c = this.cats[i];
      c.fireCd -= dt;
      if (!cat) return;
      const pos = SQUAD[i];
      const gunX = pos.x + 34 * pos.scale;
      const gunY = WORLD.groundY + pos.y - 34 * pos.scale;
      if (!target) {
        c.aim *= 0.9;
        return;
      }
      c.aim = Math.atan2(target.y - target.size * 0.6 - gunY, target.x - gunX);
      if (c.fireCd > 0) return;
      c.fireCd = 1 / (cat.fireRate * volley);
      c.recoil = 1;
      for (let p = 0; p < cat.pellets; p++) {
        const crit = Math.random() < cat.critChance;
        const spread = cat.pellets > 1 ? (p - (cat.pellets - 1) / 2) * 0.35 : 0;
        const angle = c.aim + spread;
        this.bullets.push({
          x: gunX + Math.cos(angle) * 18,
          y: gunY + Math.sin(angle) * 18,
          target,
          dmg: cat.damage * rage * (crit ? cat.critMult : 1),
          crit,
          angle,
          pierce: cat.pierce,
          hitSet: null,
          family: cat.gun.family.key,
          color: cat.gun.rarity.color,
        });
      }
      this.events.sfx?.('shot', cat.gun.family.key);
    });
  }

  nearestEnemy(exclude) {
    let best = null;
    for (const e of this.enemies) {
      if (e.hp > 0 && e.x < WORLD.width + 4 && !exclude?.has(e) && (!best || e.x < best.x)) best = e;
    }
    return best;
  }

  updateBullets(dt, squad) {
    const speed = HERO.bulletSpeed * dt;
    for (const b of this.bullets) {
      if (!b.target || b.target.hp <= 0 || !this.enemies.includes(b.target)) b.target = this.nearestEnemy(b.hitSet);
      if (b.target) {
        const tx = b.target.x;
        const ty = b.target.y - b.target.size * 0.6;
        const want = Math.atan2(ty - b.y, tx - b.x);
        let diff = want - b.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const maxTurn = BULLET_TURN_RATE * dt;
        b.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
        if (Math.hypot(tx - b.x, ty - b.y) <= speed + b.target.size * 0.6) {
          this.hit(b.target, b.dmg, b.crit, squad);
          if (b.pierce > 0) {
            b.pierce--;
            (b.hitSet ??= new Set()).add(b.target);
            b.target = null;
          } else {
            b.dead = true;
          }
        }
      }
      b.x += Math.cos(b.angle) * speed;
      b.y += Math.sin(b.angle) * speed;
      if (b.x > WORLD.width + 40 || b.y < -40 || b.y > WORLD.height + 40) b.dead = true;
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  hit(enemy, dmg, crit, squad) {
    if (enemy.hp <= 0) return;
    enemy.hp -= dmg;
    enemy.flash = 1;
    if (!enemy.obstacle && !enemy.isBoss) enemy.x += 3; // лёгкая отдача
    this.floatText(
      enemy.x + (Math.random() - 0.5) * 16,
      enemy.y - enemy.size * 1.5,
      formatNumber(dmg) + (crit ? '!' : ''),
      crit ? '#ff4d6d' : '#ffffff',
      crit ? 20 : 14,
    );
    const chip = enemy.obstacle ? (enemy.type === 'rock' ? '#9aa0a6' : enemy.type === 'crate' ? '#c8894a' : '#7a5230') : crit ? '#ff4d6d' : '#ffd166';
    this.burst(enemy.x - enemy.size * 0.5, enemy.y - enemy.size * 0.6, chip, crit ? 8 : 4, 120);
    if (crit) this.shake = Math.max(this.shake, 3);
    if (enemy.hp <= 0) this.kill(enemy, squad);
  }

  kill(enemy, squad) {
    const gold = enemy.gold * squad.goldMult;
    addGold(this.state, gold);
    if (!enemy.obstacle) this.state.stats.kills++;
    this.killed++;
    this.floatText(enemy.x, enemy.y - enemy.size * 2.1, '+' + formatNumber(gold) + ' 🪙', '#ffd700', enemy.isBoss || enemy.runner ? 24 : 16);
    const debris = enemy.obstacle ? (enemy.type === 'rock' ? '#8d939a' : enemy.type === 'crate' ? '#b5763b' : '#5b8f3a') : '#bbbbbb';
    this.burst(enemy.x, enemy.y - enemy.size * 0.5, debris, enemy.isBoss ? 40 : 14, enemy.isBoss ? 260 : 170);
    for (let i = 0; i < (enemy.isBoss || enemy.runner ? 12 : 3); i++) this.coin(enemy.x, enemy.y - enemy.size * 0.5);
    this.events.sfx?.(enemy.obstacle ? 'break' : 'coin');
    if (ENEMY_TYPES[enemy.type].dropsGun && Math.random() < CRATE_GUN_CHANCE) this.dropGun(enemy);
    if (enemy.isBoss) this.giveKeys(enemy, this.state.stage % 10 === 0 ? KEYS.bigBoss : KEYS.boss);
    if (enemy.runner && Math.random() < KEYS.goldMouseChance) this.giveKeys(enemy, 1);
    if (enemy.isBoss) {
      this.state.stats.bossKills++;
      this.shake = 12;
      this.events.onBossKill?.(this.state.stage);
    }
    this.removeEnemy(enemy);
  }

  dropGun(enemy) {
    const tier = buyTier(this.state.levels.forge ?? 0);
    const placed = addGun(this.state, tier) >= 0;
    this.floatText(enemy.x, enemy.y - enemy.size * 3, placed ? '🔫 Пушка!' : 'Арсенал полон', placed ? '#7dd3fc' : '#fca5a5', 16);
    this.events.onGunDrop?.(tier, placed);
  }

  giveKeys(enemy, n) {
    addKeys(this.state, n);
    this.floatText(enemy.x, enemy.y - enemy.size * 3.4, `+${n} 🔑`, '#ffe066', 20);
    this.events.onKey?.(n);
  }

  removeEnemy(enemy) {
    this.enemies = this.enemies.filter((e) => e !== enemy);
    if (this.killed >= this.stageTarget && this.stageClearDelay <= 0) {
      this.stageClearDelay = enemy.isBoss ? 1.2 : 0.6;
    }
  }

  updateEnemies(dt, march) {
    const fleeX = WORLD.width * 0.62;
    for (const e of [...this.enemies]) {
      e.phase += dt * ((e.speed || MARCH_SPEED) / 8);
      e.flash = Math.max(0, e.flash - dt * 6);
      e.lunge = Math.max(0, e.lunge - dt * 4);
      const stopX = this.stopX(e);

      if (e.runner) {
        // Золотая мышь подбегает, разворачивается и удирает.
        if (!e.fleeing && e.x <= fleeX) e.fleeing = true;
        e.x += (e.fleeing ? e.speed * 1.6 : -e.speed) * dt - march;
        if (e.fleeing && e.x > WORLD.width + 40) {
          this.floatText(WORLD.width - 50, WORLD.groundY - 60, 'Убежала!', '#fca5a5', 14);
          this.killed++;
          this.removeEnemy(e);
        }
        continue;
      }

      if (e.x > stopX) {
        e.x = Math.max(stopX, e.x - e.speed * dt - march);
        continue;
      }
      if (e.obstacle) continue;
      e.attackCd -= dt;
      if (e.attackCd <= 0) {
        e.attackCd = ENEMY.attackInterval;
        e.lunge = 1;
        this.hero.hp -= e.damage;
        this.hero.hurt = 1;
        this.shake = Math.max(this.shake, e.isBoss ? 8 : 3);
        this.floatText(SQUAD[0].x, WORLD.groundY - 90, '-' + formatNumber(e.damage), '#ff6b6b', 16);
        this.events.sfx?.('hurt');
      }
    }
  }

  advance() {
    const s = this.state;
    if (s.autoAdvance) {
      s.stage += 1;
      s.maxStage = Math.max(s.maxStage, s.stage);
    }
    this.startStage();
  }

  fail(message) {
    const s = this.state;
    s.stage = Math.max(1, s.stage - 1);
    s.autoAdvance = false;
    this.squad = statsOf(s);
    this.hero.hp = this.squad.maxHp;
    this.events.onStageFail?.(message);
    this.startStage();
  }

  // ---------- Эффекты ----------
  floatText(x, y, text, color, size) {
    if (this.texts.length > 60) this.texts.shift();
    this.texts.push({ x, y, text, color, size, life: 1, vy: -40 });
  }

  burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.5 + Math.random() * 0.4, color, size: 2 + Math.random() * 3 });
    }
  }

  coin(x, y) {
    this.particles.push({
      x, y,
      vx: -60 - Math.random() * 120,
      vy: -160 - Math.random() * 120,
      life: 1.1,
      color: '#ffd700',
      size: 4,
      coin: true,
    });
  }

  updateEffects(dt, march) {
    for (const p of this.particles) {
      p.x += p.vx * dt - march;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      if (p.coin && p.y > WORLD.groundY) {
        p.y = WORLD.groundY;
        p.vy *= -0.4;
        p.vx *= 0.6;
      }
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
    for (const t of this.texts) {
      t.y += t.vy * dt;
      t.life -= dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  // Прогресс этапа для UI: 0..1
  get progress() {
    if (this.isBoss) {
      const boss = this.enemies.find((e) => e.isBoss);
      return boss ? 1 - boss.hp / boss.maxHp : this.killed > 0 ? 1 : 0;
    }
    return this.killed / ENEMIES_PER_STAGE;
  }
}
