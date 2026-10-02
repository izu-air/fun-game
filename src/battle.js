// Боевая симуляция: отряд котиков идёт вперёд, сносит препятствия и сражается с воительницами Академии.
// Не сохраняется — живёт только в сессии.
import {
  ENEMIES_PER_STAGE, BOSS_TIME_LIMIT, CHAPTER_BOSS_TIME_LIMIT, MAX_ALIVE_ENEMIES, ENEMY, ENEMY_TYPES,
  HERO, SKILLS, MARCH_SPEED, SPAWN_GAP, CRATE_GUN_CHANCE, KEYS, TAP, PET,
} from './config.js';
import {
  isBossStage, enemyHp, enemyDamage, enemyGold, pickEnemyType, formatNumber, buyTier, squadDps,
} from './formulas.js';
import {
  statsOf, addGold, isSkillUnlocked, addGun, addKeys, allies, progressQuest,
} from './state.js';
import { heroineForStage, ALLY_BOSS_WEAKEN } from './story.js';

export const WORLD = { width: 480, height: 340, groundY: 278 };
// Позиции котиков в строю: первый слот впереди, остальные чуть дальше от зрителя.
export const SQUAD = [
  { x: 150, y: 0, scale: 1 },
  { x: 98, y: -12, scale: 0.9 },
  { x: 50, y: -24, scale: 0.8 },
];
export const FRONT_X = SQUAD[0].x + 26;
const CAT_HEIGHT = 66; // для попадания пальцем по котику

const BULLET_TURN_RATE = 9; // рад/с — пули доворачивают к цели, дробь сначала разлетается веером

// Способности героинь-боссов: период (с) и длительность эффекта (с).
const ABILITIES = {
  heal: { every: 6, amount: 0.06 },
  evade: { chance: 0.25 },
  freeze: { every: 7, duration: 1.5 },
  shield: { every: 6, duration: 2 },
  summon: { every: 6, count: 2 },
  empress: { shieldEvery: 7, shieldDuration: 2, summonEvery: 9, count: 2 },
};

export class Battle {
  constructor(state, events = {}) {
    this.state = state;
    // { onStageStart, onStageFail, onBossKill, onGunDrop, onKey, onPet, sfx }
    this.events = events;
    this.time = 0;
    this.scroll = 0;
    this.walking = true;
    this.shake = 0;
    this.freeze = 0; // отряд заморожен и не стреляет
    this.tapCd = 0;
    this.buffs = { volley: 0, rage: 0 };
    this.cooldowns = Object.fromEntries(Object.keys(SKILLS).map((k) => [k, 0]));
    this.squad = statsOf(state);
    this.hero = { hp: this.squad.maxHp, hurt: 0 };
    this.cats = SQUAD.map(() => ({ fireCd: Math.random() * 0.3, recoil: 0, aim: 0, happy: 0, petCd: 0 }));
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
    this.orbs = []; // магические сферы волшебниц
    this.particles = [];
    this.texts = [];
    this.spawned = 0;
    this.killed = 0;
    this.nextSpawnIn = 0;
    this.freeze = 0;
    this.bossTimer = heroineForStage(this.state.stage) ? CHAPTER_BOSS_TIME_LIMIT : BOSS_TIME_LIMIT;
    this.stageClearDelay = 0;
    this.events.onStageStart?.(this.state.stage, this.isBoss);
  }

  // Пересчитать характеристики после покупки, смены оружия или скина.
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
      this.freeze = 0; // мурчание заодно отогревает лапки
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

  // ---------- Взаимодействия ----------
  // Нажатие по полю боя в мировых координатах: погладить котика или ударить врага лапкой.
  tap(x, y) {
    const cat = this.catAt(x, y);
    if (cat >= 0) return this.pet(cat) ? 'pet' : 'busy';
    if (this.tapCd > 0) return null;
    this.tapCd = TAP.cooldown;
    this.paw(x, y);
    if (this.popOrbAt(x, y)) {
      this.events.sfx?.('tap');
      return 'orb';
    }
    const enemy = this.enemyAt(x, y);
    if (!enemy) return 'miss';
    const dmg = Math.max(1, squadDps(this.squad) * TAP.dpsShare);
    this.state.stats.taps++;
    progressQuest(this.state, 'taps');
    this.hit(enemy, dmg, false, this.squad, true);
    this.events.sfx?.('tap');
    return 'hit';
  }

  catAt(x, y) {
    for (let i = 0; i < SQUAD.length; i++) {
      if (!this.squad.cats[i]) continue;
      const p = SQUAD[i];
      const top = WORLD.groundY + p.y - CAT_HEIGHT * p.scale;
      if (Math.abs(x - p.x) < 26 * p.scale && y > top && y < WORLD.groundY + p.y + 6) return i;
    }
    return -1;
  }

  enemyAt(x, y) {
    let best = null;
    let bestD = TAP.radius;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.x > WORLD.width) continue;
      const d = Math.hypot(e.x - x, Math.max(0, Math.abs(this.aimY(e) - y) - e.height * 0.4));
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  // Довольный котик стреляет быстрее; гладить можно не чаще раза в PET.cooldown секунд.
  pet(i) {
    const c = this.cats[i];
    if (c.petCd > 0) {
      this.floatText(SQUAD[i].x, WORLD.groundY + SQUAD[i].y - 80, 'Мрр… хватит', '#e9d5ff', 12);
      return false;
    }
    c.happy = PET.duration;
    c.petCd = PET.cooldown;
    this.state.stats.pets++;
    progressQuest(this.state, 'pets');
    for (let k = 0; k < 6; k++) {
      this.particles.push({
        x: SQUAD[i].x + (Math.random() - 0.5) * 30,
        y: WORLD.groundY + SQUAD[i].y - 60,
        vx: (Math.random() - 0.5) * 40,
        vy: -60 - Math.random() * 50,
        life: 1.2,
        color: '#ff6b9d',
        size: 7,
        heart: true,
        float: true,
      });
    }
    this.floatText(SQUAD[i].x, WORLD.groundY + SQUAD[i].y - 86, 'Мур! ×1.25 ⚡', '#ff9ec7', 14);
    this.events.sfx?.('purr');
    this.events.onPet?.(i);
    return true;
  }

  paw(x, y) {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.45, color: '#ffffff', size: 10, paw: true, float: true });
  }

  // ---------- Основной цикл ----------
  update(dt) {
    this.time += dt;
    this.squad = statsOf(this.state);
    const squad = this.squad;

    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    for (const k of Object.keys(this.buffs)) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
    for (const c of this.cats) {
      c.recoil = Math.max(0, c.recoil - dt * 8);
      c.happy = Math.max(0, c.happy - dt);
      c.petCd = Math.max(0, c.petCd - dt);
    }
    this.freeze = Math.max(0, this.freeze - dt);
    this.tapCd = Math.max(0, this.tapCd - dt);
    if (this.state.autoSkills) this.autoCast(squad);

    this.hero.hp = Math.min(squad.maxHp, this.hero.hp + squad.regen * dt);
    this.hero.hurt = Math.max(0, this.hero.hurt - dt * 4);
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
        if (this.bossTimer <= 0) return this.fail('Время вышло! Капитан отступила с поля боя');
      }
    }

    if (this.freeze <= 0) this.updateShooting(dt, squad);
    this.updateBullets(dt, squad);
    this.updateEnemies(dt, march);
    this.updateOrbs(dt);
    this.updateEffects(dt, march);

    if (this.hero.hp <= 0) this.fail('Отряд устал… Отступаем на этап назад 😿');
  }

  autoCast(squad) {
    const hasTargets = this.enemies.length > 0;
    if (hasTargets && this.canCast('volley')) this.cast('volley');
    if (hasTargets && this.canCast('rage')) this.cast('rage');
    if ((this.hero.hp < squad.maxHp * 0.5 || this.freeze > 0) && this.canCast('purr')) this.cast('purr');
  }

  // Где цель останавливается перед отрядом.
  stopX(e) {
    const t = ENEMY_TYPES[e.type];
    if (t.ranged) return FRONT_X + t.ranged.range;
    if (t.reach) return FRONT_X + t.reach;
    return FRONT_X + e.size * (e.obstacle ? 1.1 : 1.4);
  }

  // Высота точки прицеливания — середина силуэта.
  aimY(e) {
    return e.y - e.height * 0.5;
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

  spawnEnemy(type, x = WORLD.width + ENEMY_TYPES[type].size + 10) {
    const stage = this.state.stage;
    const t = ENEMY_TYPES[type];
    let hp = enemyHp(stage, type);
    const heroine = type === 'boss' ? heroineForStage(stage) : null;
    let helpers = [];
    if (heroine?.ability === 'empress') {
      // Пощажённые героини приходят на помощь и ослабляют Императрицу.
      helpers = allies(this.state);
      hp *= 1 - ALLY_BOSS_WEAKEN * helpers.length;
    }
    const e = {
      type,
      girl: !!t.girl,
      isBoss: type === 'boss',
      heroine,
      obstacle: !!t.obstacle,
      runner: !!t.runner,
      fleeing: false,
      x,
      y: WORLD.groundY,
      hp,
      maxHp: hp,
      damage: enemyDamage(stage, type),
      gold: enemyGold(stage, type),
      speed: t.speed * (0.9 + Math.random() * 0.2),
      size: t.size,
      height: t.size * (t.height ?? 1.2),
      attackCd: 0.3,
      castCd: 1 + Math.random(),
      phase: Math.random() * Math.PI * 2,
      flash: 0,
      lunge: 0,
      variant: Math.random(),
      shield: 0,
      abilityCd: 3,
      summonCd: 4,
    };
    this.enemies.push(e);
    if (type === 'goldMouse') this.floatText(WORLD.width - 60, WORLD.groundY - 60, 'Золотая мышь!', '#ffd700', 16);
    if (heroine) {
      this.floatText(WORLD.width / 2, 60, `${heroine.name} — ${heroine.title}`, heroine.accent, 18);
      if (helpers.length) {
        this.floatText(WORLD.width / 2, 86, `На помощь пришли: ${helpers.map((h) => h.name).join(', ')}!`, '#ffd166', 13);
        this.floatText(WORLD.width / 2, 106, `Сила Императрицы −${Math.round(ALLY_BOSS_WEAKEN * helpers.length * 100)}%`, '#ffd166', 13);
      }
    }
    return e;
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
      c.aim = Math.atan2(this.aimY(target) - gunY, target.x - gunX);
      if (c.fireCd > 0) return;
      const happy = c.happy > 0 ? PET.fireRateMult : 1;
      c.fireCd = 1 / (cat.fireRate * volley * happy);
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
        const ty = this.aimY(b.target);
        const want = Math.atan2(ty - b.y, tx - b.x);
        let diff = want - b.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const maxTurn = BULLET_TURN_RATE * dt;
        b.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
        if (Math.hypot(tx - b.x, ty - b.y) <= speed + Math.max(b.target.size * 0.6, b.target.height * 0.35)) {
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

  // tap — удар лапкой: его не блокируют щит и уворот (палец игрока точнее пуль).
  hit(enemy, dmg, crit, squad, tap = false) {
    if (enemy.hp <= 0) return;
    const ability = enemy.heroine?.ability;
    if (!tap && enemy.shield > 0) {
      this.floatText(enemy.x, enemy.y - enemy.height - 8, 'Щит!', '#7dd3fc', 13);
      return;
    }
    if (!tap && ability === 'evade' && Math.random() < ABILITIES.evade.chance) {
      this.floatText(enemy.x + 10, enemy.y - enemy.height - 8, 'Мимо!', '#e9d5ff', 13);
      return;
    }
    enemy.hp -= dmg;
    enemy.flash = 1;
    if (!enemy.obstacle && !enemy.isBoss) enemy.x += 3; // лёгкая отдача
    this.floatText(
      enemy.x + (Math.random() - 0.5) * 16,
      enemy.y - enemy.height - 6,
      (tap ? '🐾 ' : '') + formatNumber(dmg) + (crit ? '!' : ''),
      crit ? '#ff4d6d' : tap ? '#ffe066' : '#ffffff',
      crit || tap ? 18 : 14,
    );
    const chip = enemy.obstacle
      ? (enemy.type === 'rock' ? '#9aa0a6' : enemy.type === 'crate' ? '#c8894a' : '#7a5230')
      : crit ? '#ff4d6d' : enemy.girl ? '#ffd6e7' : '#ffd166';
    this.burst(enemy.x - enemy.size * 0.5, this.aimY(enemy), chip, crit ? 8 : 4, 120);
    if (crit) this.shake = Math.max(this.shake, 3);
    if (enemy.hp <= 0) this.kill(enemy, squad);
  }

  kill(enemy, squad) {
    const gold = enemy.gold * squad.goldMult;
    addGold(this.state, gold);
    const s = this.state;
    if (enemy.obstacle) {
      progressQuest(s, 'obstacles');
    } else {
      s.stats.kills++;
      if (enemy.girl) progressQuest(s, 'kills');
    }
    if (enemy.runner) {
      s.stats.goldMice++;
      progressQuest(s, 'goldMice');
    }
    if (!enemy.minion) this.killed++;
    this.floatText(enemy.x, enemy.y - enemy.height - 24, '+' + formatNumber(gold) + ' 🪙', '#ffd700', enemy.isBoss || enemy.runner ? 24 : 16);
    // воительницы не погибают, а исчезают в облачке звёздочек — возвращаются в Академию
    const debris = enemy.obstacle ? (enemy.type === 'rock' ? '#8d939a' : enemy.type === 'crate' ? '#b5763b' : '#5b8f3a')
      : enemy.girl ? (enemy.heroine?.accent ?? '#ffc9de') : '#bbbbbb';
    this.burst(enemy.x, this.aimY(enemy), debris, enemy.isBoss ? 40 : 14, enemy.isBoss ? 260 : 170);
    if (enemy.girl) this.sparkles(enemy.x, this.aimY(enemy), enemy.isBoss ? 16 : 6);
    for (let i = 0; i < (enemy.isBoss || enemy.runner ? 12 : 3); i++) this.coin(enemy.x, this.aimY(enemy));
    this.events.sfx?.(enemy.obstacle ? 'break' : 'coin');
    if (ENEMY_TYPES[enemy.type].dropsGun && Math.random() < CRATE_GUN_CHANCE) this.dropGun(enemy);
    if (enemy.isBoss) this.giveKeys(enemy, this.state.stage % 10 === 0 ? KEYS.bigBoss : KEYS.boss);
    if (enemy.runner && Math.random() < KEYS.goldMouseChance) this.giveKeys(enemy, 1);
    if (enemy.isBoss) {
      s.stats.bossKills++;
      progressQuest(s, 'bosses');
      this.shake = 12;
      this.events.onBossKill?.(s.stage, enemy.heroine);
    }
    this.removeEnemy(enemy);
  }

  dropGun(enemy) {
    const tier = buyTier(this.state.levels.forge ?? 0);
    const placed = addGun(this.state, tier) >= 0;
    this.floatText(enemy.x, enemy.y - enemy.height - 40, placed ? '🔫 Пушка!' : 'Арсенал полон', placed ? '#7dd3fc' : '#fca5a5', 16);
    this.events.onGunDrop?.(tier, placed);
  }

  giveKeys(enemy, n) {
    addKeys(this.state, n);
    this.floatText(enemy.x, enemy.y - enemy.height - 50, `+${n} 🔑`, '#ffe066', 20);
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
      e.shield = Math.max(0, e.shield - dt);
      if (e.heroine) this.updateAbility(e, dt);
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

      const ranged = ENEMY_TYPES[e.type].ranged;
      if (ranged) {
        e.castCd -= dt;
        if (e.castCd <= 0) {
          e.castCd = ranged.interval;
          e.lunge = 0.6;
          this.orbs.push({ x: e.x - 14, y: this.aimY(e) - 6, speed: ranged.speed, damage: e.damage, life: 4 });
        }
        continue;
      }

      e.attackCd -= dt;
      if (e.attackCd <= 0) {
        e.attackCd = ENEMY.attackInterval;
        e.lunge = 1;
        this.damageSquad(e.damage, e.isBoss ? 8 : 3);
      }
    }
  }

  damageSquad(damage, shake) {
    this.hero.hp -= damage;
    this.hero.hurt = 1;
    this.shake = Math.max(this.shake, shake);
    this.floatText(SQUAD[0].x, WORLD.groundY - 90, '-' + formatNumber(damage), '#ff6b6b', 16);
    this.events.sfx?.('hurt');
  }

  // Магические сферы летят к отряду; их можно сбить ударом лапкой.
  updateOrbs(dt) {
    for (const o of this.orbs) {
      o.x -= o.speed * dt;
      o.life -= dt;
      if (o.x <= FRONT_X - 10) {
        this.damageSquad(o.damage, 3);
        o.dead = true;
      }
    }
    this.orbs = this.orbs.filter((o) => !o.dead && o.life > 0);
  }

  // Сбить сферу пальцем (вызывается до удара по врагу).
  popOrbAt(x, y) {
    const o = this.orbs.find((orb) => Math.hypot(orb.x - x, orb.y - y) < 28);
    if (!o) return false;
    o.dead = true;
    this.sparkles(o.x, o.y, 6);
    this.floatText(o.x, o.y - 14, 'Сбито!', '#c4b5fd', 13);
    return true;
  }

  updateAbility(e, dt) {
    const ab = e.heroine.ability;
    if (e.x > WORLD.width) return; // способности — только когда героиня на экране
    if (ab === 'heal' || ab === 'freeze' || ab === 'shield' || ab === 'summon') {
      e.abilityCd -= dt;
      if (e.abilityCd > 0) return;
      const cfg = ABILITIES[ab];
      e.abilityCd = cfg.every;
      if (ab === 'heal') {
        const heal = e.maxHp * cfg.amount;
        e.hp = Math.min(e.maxHp, e.hp + heal);
        this.floatText(e.x, e.y - e.height - 12, '🌸 +' + formatNumber(heal), '#ff9ec7', 15);
        this.burst(e.x, this.aimY(e), '#ffc9de', 14, 120);
      } else if (ab === 'freeze') {
        this.freeze = cfg.duration;
        this.floatText(SQUAD[1].x, WORLD.groundY - 100, '❄️ Лапы замёрзли!', '#a5d8ff', 15);
      } else if (ab === 'shield') {
        e.shield = cfg.duration;
      } else {
        this.summon(e, cfg.count);
      }
    } else if (ab === 'empress') {
      const cfg = ABILITIES.empress;
      e.abilityCd -= dt;
      e.summonCd -= dt;
      if (e.abilityCd <= 0) {
        e.abilityCd = cfg.shieldEvery;
        e.shield = cfg.shieldDuration;
      }
      if (e.summonCd <= 0) {
        e.summonCd = cfg.summonEvery;
        this.summon(e, cfg.count);
      }
    }
  }

  summon(boss, count) {
    for (let k = 0; k < count; k++) {
      const m = this.spawnEnemy('ninja', boss.x + 30 + k * 26);
      m.minion = true; // призванные ниндзя не считаются в прогресс этапа
    }
    this.floatText(boss.x, boss.y - boss.height - 12, 'Ко мне, стража!', boss.heroine.accent, 14);
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

  sparkles(x, y, count) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 60,
        vy: -40 - Math.random() * 60,
        life: 0.8 + Math.random() * 0.4,
        color: '#fff3b0',
        size: 5,
        star: true,
        float: true,
      });
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
      if (!p.float) p.vy += 500 * dt; // сердечки, звёздочки и следы лапок не падают
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

