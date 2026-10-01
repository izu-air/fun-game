// Боевая симуляция: котик, враги, пули, эффекты. Не сохраняется — живёт только в сессии.
import {
  ENEMIES_PER_STAGE, BOSS_TIME_LIMIT, MAX_ALIVE_ENEMIES, SPAWN_INTERVAL, ENEMY, ENEMY_TYPES,
  HERO, SKILLS,
} from './config.js';
import {
  isBossStage, enemyHp, enemyDamage, enemyGold, pickEnemyType, formatNumber,
} from './formulas.js';
import { statsOf, addGold, isSkillUnlocked } from './state.js';

export const WORLD = { width: 480, height: 340, groundY: 278, heroX: 70 };

export class Battle {
  constructor(state, events = {}) {
    this.state = state;
    this.events = events; // { onStageStart, onStageFail, onBossKill, onMessage }
    this.time = 0;
    this.shake = 0;
    this.buffs = { volley: 0, rage: 0 };
    this.cooldowns = Object.fromEntries(Object.keys(SKILLS).map((k) => [k, 0]));
    this.hero = { hp: statsOf(state).maxHp, fireCd: 0, recoil: 0, hurt: 0, aim: 0 };
    this.startStage();
  }

  get stats() {
    return statsOf(this.state);
  }

  get isBoss() {
    return isBossStage(this.state.stage);
  }

  startStage() {
    this.enemies = [];
    this.bullets = [];
    this.particles = [];
    this.texts = [];
    this.spawned = 0;
    this.killed = 0;
    this.spawnCd = 0.4;
    this.bossTimer = BOSS_TIME_LIMIT;
    this.stageClearDelay = 0;
    this.events.onStageStart?.(this.state.stage, this.isBoss);
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
      const s = this.stats;
      const heal = s.maxHp * skill.healPct;
      this.hero.hp = Math.min(s.maxHp, this.hero.hp + heal);
      this.floatText(WORLD.heroX, WORLD.groundY - 70, '+' + formatNumber(heal), '#4ade80', 20);
    }
    this.burst(WORLD.heroX, WORLD.groundY - 30, '#ffd166', 18, 160);
    return true;
  }

  // Бросить вызов боссу после провала.
  challengeBoss() {
    if (this.state.autoAdvance) return;
    this.state.autoAdvance = true;
    this.state.stage += 1;
    this.state.maxStage = Math.max(this.state.maxStage, this.state.stage);
    this.hero.hp = this.stats.maxHp;
    this.startStage();
  }

  // ---------- Основной цикл ----------
  update(dt) {
    this.time += dt;
    this.state.stats.playTime += dt;
    const stats = this.stats;

    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    for (const k of Object.keys(this.buffs)) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
    if (this.state.autoSkills) this.autoCast(stats);

    this.hero.hp = Math.min(stats.maxHp, this.hero.hp + stats.regen * dt);
    this.hero.recoil = Math.max(0, this.hero.recoil - dt * 8);
    this.hero.hurt = Math.max(0, this.hero.hurt - dt * 4);
    this.shake = Math.max(0, this.shake - dt * 30);

    if (this.stageClearDelay > 0) {
      this.stageClearDelay -= dt;
      if (this.stageClearDelay <= 0) this.advance();
    } else {
      this.updateSpawning(dt);
      if (this.isBoss && this.enemies.length > 0) {
        this.bossTimer -= dt;
        if (this.bossTimer <= 0) return this.fail('Время вышло! Босс сбежал 🐶');
      }
    }

    this.updateShooting(dt, stats);
    this.updateBullets(dt, stats);
    this.updateEnemies(dt);
    this.updateEffects(dt);

    if (this.hero.hp <= 0) this.fail('Котик устал… Отступаем на этап назад 😿');
  }

  autoCast(stats) {
    const hasEnemies = this.enemies.length > 0;
    if (hasEnemies && this.canCast('volley')) this.cast('volley');
    if (hasEnemies && this.canCast('rage')) this.cast('rage');
    if (this.hero.hp < stats.maxHp * 0.5 && this.canCast('purr')) this.cast('purr');
  }

  updateSpawning(dt) {
    const target = this.isBoss ? 1 : ENEMIES_PER_STAGE;
    if (this.spawned >= target) return;
    this.spawnCd -= dt;
    if (this.spawnCd > 0 || this.enemies.length >= MAX_ALIVE_ENEMIES) return;
    this.spawnCd = SPAWN_INTERVAL * (0.7 + Math.random() * 0.6);
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
    });
  }

  updateShooting(dt, stats) {
    const target = this.nearestEnemy();
    this.hero.fireCd -= dt;
    if (!target) {
      this.hero.aim *= 0.9;
      return;
    }
    const gunX = WORLD.heroX + 34;
    const gunY = WORLD.groundY - 34;
    this.hero.aim = Math.atan2(target.y - target.size * 0.6 - gunY, target.x - gunX);
    if (this.hero.fireCd > 0) return;

    const fireRate = stats.fireRate * (this.buffs.volley > 0 ? SKILLS.volley.fireRateMult : 1);
    this.hero.fireCd = 1 / fireRate;
    const crit = Math.random() < stats.critChance;
    const rage = this.buffs.rage > 0 ? SKILLS.rage.damageMult : 1;
    const dmg = stats.damage * rage * (crit ? stats.critMult : 1);
    this.bullets.push({
      x: gunX + Math.cos(this.hero.aim) * 18,
      y: gunY + Math.sin(this.hero.aim) * 18,
      target,
      dmg,
      crit,
      angle: this.hero.aim,
    });
    this.hero.recoil = 1;
  }

  nearestEnemy() {
    let best = null;
    for (const e of this.enemies) {
      if (e.hp > 0 && e.x < WORLD.width + 4 && (!best || e.x < best.x)) best = e;
    }
    return best;
  }

  updateBullets(dt, stats) {
    const speed = HERO.bulletSpeed * dt;
    for (const b of this.bullets) {
      // Самонаведение: если цель погибла — летим к ближайшей живой.
      if (!b.target || b.target.hp <= 0) b.target = this.nearestEnemy();
      if (!b.target) {
        b.x += Math.cos(b.angle) * speed;
        b.y += Math.sin(b.angle) * speed;
        if (b.x > WORLD.width + 40) b.dead = true;
        continue;
      }
      const tx = b.target.x;
      const ty = b.target.y - b.target.size * 0.6;
      b.angle = Math.atan2(ty - b.y, tx - b.x);
      const dist = Math.hypot(tx - b.x, ty - b.y);
      if (dist <= speed + b.target.size * 0.5) {
        this.hit(b.target, b.dmg, b.crit, stats);
        b.dead = true;
      } else {
        b.x += Math.cos(b.angle) * speed;
        b.y += Math.sin(b.angle) * speed;
      }
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  hit(enemy, dmg, crit, stats) {
    enemy.hp -= dmg;
    enemy.flash = 1;
    enemy.x += enemy.isBoss ? 1 : 4; // лёгкая отдача
    this.floatText(
      enemy.x + (Math.random() - 0.5) * 16,
      enemy.y - enemy.size * 1.4,
      formatNumber(dmg) + (crit ? '!' : ''),
      crit ? '#ff4d6d' : '#ffffff',
      crit ? 20 : 14,
    );
    this.burst(enemy.x - enemy.size * 0.5, enemy.y - enemy.size * 0.6, crit ? '#ff4d6d' : '#ffd166', crit ? 8 : 4, 120);
    if (crit) this.shake = Math.max(this.shake, 3);
    if (enemy.hp <= 0) this.kill(enemy, stats);
  }

  kill(enemy, stats) {
    const gold = enemy.gold * stats.goldMult;
    addGold(this.state, gold);
    this.state.stats.kills++;
    this.killed++;
    this.floatText(enemy.x, enemy.y - enemy.size * 2, '+' + formatNumber(gold) + ' 🪙', '#ffd700', enemy.isBoss ? 26 : 16);
    this.burst(enemy.x, enemy.y - enemy.size * 0.5, '#bbbbbb', enemy.isBoss ? 40 : 12, enemy.isBoss ? 260 : 160);
    for (let i = 0; i < (enemy.isBoss ? 12 : 3); i++) this.coin(enemy.x, enemy.y - enemy.size * 0.5);
    if (enemy.isBoss) {
      this.state.stats.bossKills++;
      this.shake = 12;
      this.events.onBossKill?.(this.state.stage);
    }
    this.enemies = this.enemies.filter((e) => e !== enemy);

    const target = this.isBoss ? 1 : ENEMIES_PER_STAGE;
    if (this.killed >= target) this.stageClearDelay = enemy.isBoss ? 1.2 : 0.6;
  }

  updateEnemies(dt) {
    const meleeX = WORLD.heroX + 30;
    for (const e of this.enemies) {
      e.phase += dt * (e.speed / 8);
      e.flash = Math.max(0, e.flash - dt * 6);
      e.lunge = Math.max(0, e.lunge - dt * 4);
      const stopX = meleeX + e.size;
      if (e.x > stopX) {
        e.x = Math.max(stopX, e.x - e.speed * dt);
      } else {
        e.attackCd -= dt;
        if (e.attackCd <= 0) {
          e.attackCd = ENEMY.attackInterval;
          e.lunge = 1;
          this.hero.hp -= e.damage;
          this.hero.hurt = 1;
          this.shake = Math.max(this.shake, e.isBoss ? 8 : 3);
          this.floatText(WORLD.heroX, WORLD.groundY - 80, '-' + formatNumber(e.damage), '#ff6b6b', 16);
        }
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
    this.hero.hp = this.stats.maxHp;
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

  updateEffects(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
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
