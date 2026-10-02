// Боевая симуляция на арене (вид сверху). Воительницы Академии набегают со всех сторон,
// ведущий котик бежит за указателем (мышь, палец, WASD), остальные следуют «змейкой» и стреляют сами.
// Монеты и сундуки остаются на земле — их нужно подбирать. Не сохраняется — живёт только в сессии.
import {
  ENEMIES_PER_STAGE, BOSS_TIME_LIMIT, CHAPTER_BOSS_TIME_LIMIT, MAX_ALIVE_ENEMIES, ENEMY, ENEMY_TYPES,
  HERO, SKILLS, CRATE_GUN_CHANCE, KEYS, BOSS_ABILITIES, ABILITY_FIRST, STAR_CHEST, AUTO_BOSS_DELAY,
  MAX_GUN_TIER, ARENA, DASH, CATS,
} from './config.js';
import {
  isBossStage, enemyHp, enemyDamage, enemyGold, pickEnemyType, formatNumber, buyTier, idleGoldPerSecond,
} from './formulas.js';
import {
  statsOf, addGold, isSkillUnlocked, addGun, addKeys, allies, progressQuest, resolveMult, addResolve,
  clearResolve,
} from './state.js';
import { heroineForStage, chapterForStage, CHAPTERS, ALLY_BOSS_WEAKEN, bookOf } from './story.js';

export const WORLD = { width: ARENA.width, height: ARENA.height };
const CAT_BODY = 18; // высота центра котика над его «ногами» (с учётом масштаба)
const BULLET_TURN_RATE = 9; // рад/с — пули доворачивают к цели, дробь сначала разлетается веером
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class Battle {
  constructor(state, events = {}) {
    this.state = state;
    // { onStageStart, onStageFail, onBossKill, onGunDrop, onKey, onChest, onResolve, sfx }
    this.events = events;
    this.time = 0;
    this.shake = 0;
    this.freeze = 0; // отряд заморожен: не двигается и не стреляет
    this.farmTimer = 0; // сколько секунд отряд фармит после провала босса
    this.buffs = { volley: 0, rage: 0 };
    this.cooldowns = Object.fromEntries(Object.keys(SKILLS).map((k) => [k, 0]));
    this.squad = statsOf(state);
    this.hero = { hp: this.squad.maxHp, hurt: 0 };
    const cx = WORLD.width / 2;
    const cy = WORLD.height / 2 + 30;
    this.cats = CATS.map((_, i) => ({
      x: cx - i * ARENA.followGap, y: cy, fireCd: Math.random() * 0.3, recoil: 0, aim: 0, facing: 1, step: 0,
    }));
    // путь ведущего, по которому идут остальные; сначала — прямая линия позади него
    this.trail = Array.from({ length: 60 }, (_, i) => ({ x: cx - i * 2, y: cy }));
    // управление: цель указателя, направление клавиш, время последнего ввода
    this.input = { target: null, keys: { x: 0, y: 0 }, lastAt: -Infinity };
    this.moving = false;
    this.dash = { t: 0, cd: 0, invulnerable: 0, dx: 1, dy: 0 };
    this.streak = 0; // побед подряд без урона
    this.pickups = []; // монеты и звёздные сундуки на земле
    this.chestCd = this.nextChestDelay();
    this.crateCd = rand(...ARENA.crateEvery) / 2;
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

  // Индексы котиков в строю: только те, у кого есть пушка. Первый — ведущий.
  // Рыжик остаётся на арене, даже если у него нет пушки (тогда он просто не стреляет).
  get activeCats() {
    const list = this.squad.cats.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    return list.length ? list : [0];
  }

  get leader() {
    return this.cats[this.activeCats[0] ?? 0];
  }

  // Ручное управление было недавно — иначе включается автопилот.
  get manual() {
    return this.time - this.input.lastAt < ARENA.autopilotDelay;
  }

  startStage() {
    this.enemies = [];
    this.bullets = [];
    this.orbs = []; // магические сферы и ветряные лезвия
    this.particles = [];
    this.texts = [];
    this.spawned = 0;
    this.killed = 0;
    this.spawnCd = 0.3;
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

  // ---------- Управление ----------
  setTarget(x, y) {
    this.input.target = { x, y };
    this.input.lastAt = this.time;
  }

  clearTarget() {
    this.input.target = null;
  }

  setKeys(x, y) {
    this.input.keys = { x, y };
    if (x || y) this.input.lastAt = this.time;
  }

  // Рывок: короткий бросок с неуязвимостью. Возвращает true, если удался.
  dashNow() {
    const d = this.dash;
    if (d.cd > 0 || this.freeze > 0) return false;
    const dir = this.moveDir() ?? { x: this.leader.facing, y: 0 };
    d.dx = dir.x;
    d.dy = dir.y;
    d.t = DASH.duration;
    d.invulnerable = DASH.invulnerable;
    d.cd = DASH.cooldown;
    this.state.stats.dashes++;
    progressQuest(this.state, 'dashes');
    this.burst(this.leader.x, this.leader.y - CAT_BODY, '#e7f5ff', 10, 120);
    this.events.sfx?.('dash');
    return true;
  }

  // Направление движения ведущего (единичный вектор) или null — стоять.
  moveDir() {
    const k = this.input.keys;
    if (k.x || k.y) return normalize(k.x, k.y);
    const L = this.leader;
    if (this.input.target && this.manual) {
      const dx = this.input.target.x - L.x;
      const dy = this.input.target.y - L.y;
      return Math.hypot(dx, dy) > 6 ? normalize(dx, dy) : null;
    }
    if (!this.manual && this.state.autopilot) return this.autopilotDir();
    return null;
  }

  // Автопилот: убегать от ближних врагов и сфер, идти к добыче, держаться ближе к центру.
  autopilotDir() {
    const L = this.leader;
    let vx = 0;
    let vy = 0;
    for (const e of this.enemies) {
      if (e.obstacle || e.runner) continue;
      const d = Math.max(10, dist(e, L));
      const danger = (ENEMY_TYPES[e.type].ranged ? 120 : 95) + (e.isBoss ? 40 : 0);
      if (d < danger) {
        const w = (danger - d) / danger;
        vx += ((L.x - e.x) / d) * w * 2.2;
        vy += ((L.y - e.y) / d) * w * 2.2;
      }
    }
    for (const o of this.orbs) {
      const d = Math.max(8, dist(o, { x: L.x, y: L.y - CAT_BODY }));
      if (d < 70) {
        // уходим поперёк траектории сферы
        const sp = Math.hypot(o.vx, o.vy) || 1;
        vx += (-o.vy / sp) * 1.5;
        vy += (o.vx / sp) * 1.5;
      }
    }
    const loot = this.nearestPickup(L, 220);
    if (loot) {
      const d = Math.max(1, dist(loot, L));
      vx += ((loot.x - L.x) / d) * (loot.kind === 'chest' ? 1.6 : 0.9);
      vy += ((loot.y - L.y) / d) * (loot.kind === 'chest' ? 1.6 : 0.9);
    }
    const cx = WORLD.width / 2 - L.x;
    const cy = WORLD.height / 2 + 20 - L.y;
    vx += cx / 260;
    vy += cy / 200;
    return Math.hypot(vx, vy) > 0.25 ? normalize(vx, vy) : null;
  }

  nearestPickup(from, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const p of this.pickups) {
      const d = dist(p, from);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  updateMovement(dt) {
    const L = this.leader;
    const d = this.dash;
    d.cd = Math.max(0, d.cd - dt);
    d.invulnerable = Math.max(0, d.invulnerable - dt);
    let vx = 0;
    let vy = 0;
    if (this.freeze <= 0) {
      if (d.t > 0) {
        d.t -= dt;
        const sp = DASH.distance / DASH.duration;
        vx = d.dx * sp;
        vy = d.dy * sp;
      } else {
        const dir = this.moveDir();
        if (dir) {
          vx = dir.x * ARENA.catSpeed;
          vy = dir.y * ARENA.catSpeed;
        }
      }
    }
    this.moving = vx !== 0 || vy !== 0;
    const m = ARENA.margin;
    L.x = clamp(L.x + vx * dt, m, WORLD.width - m);
    L.y = clamp(L.y + vy * dt, m + 30, WORLD.height - 6);
    if (vx) L.facing = Math.sign(vx);
    if (this.moving) L.step += dt * 12;

    // «Змейка»: точки пути ведущего; котики встают на них через равные промежутки.
    const last = this.trail[0];
    if (dist(last, L) > 2) {
      this.trail.unshift({ x: L.x, y: L.y });
      if (this.trail.length > 120) this.trail.pop();
    }
    const order = this.activeCats;
    for (let k = 1; k < order.length; k++) {
      const c = this.cats[order[k]];
      const p = pointAlong(this.trail, ARENA.followGap * k) ?? this.trail.at(-1);
      const before = c.x;
      c.x += (p.x - c.x) * Math.min(1, dt * 10);
      c.y += (p.y - c.y) * Math.min(1, dt * 10);
      if (Math.abs(c.x - before) > 0.05) c.facing = Math.sign(c.x - before);
      if (this.moving) c.step += dt * 12;
    }
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
    const L = this.leader;
    if (skill.healPct) {
      const heal = this.squad.maxHp * skill.healPct;
      this.hero.hp = Math.min(this.squad.maxHp, this.hero.hp + heal);
      this.freeze = 0; // мурчание заодно отогревает лапки
      this.floatText(L.x, L.y - 50, '+' + formatNumber(heal), '#4ade80', 18);
    }
    this.burst(L.x, L.y - CAT_BODY, '#ffd166', 18, 160);
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
    this.farmTimer = 0;
    this.startStage();
  }

  // ---------- Основной цикл ----------
  update(dt) {
    this.time += dt;
    this.squad = statsOf(this.state);
    const squad = this.squad;

    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    for (const k of Object.keys(this.buffs)) this.buffs[k] = Math.max(0, this.buffs[k] - dt);
    for (const c of this.cats) c.recoil = Math.max(0, c.recoil - dt * 8);
    this.freeze = Math.max(0, this.freeze - dt);
    if (this.state.autoSkills) this.autoCast(squad);
    if (!this.state.autoAdvance && this.stageClearDelay <= 0) {
      this.farmTimer += dt;
      if (this.state.autoBoss && this.farmTimer >= AUTO_BOSS_DELAY) this.challengeBoss();
    }

    this.hero.hp = Math.min(squad.maxHp, this.hero.hp + squad.regen * dt);
    this.hero.hurt = Math.max(0, this.hero.hurt - dt * 4);
    this.shake = Math.max(0, this.shake - dt * 30);

    this.updateMovement(dt);
    if (this.stageClearDelay > 0) {
      this.stageClearDelay -= dt;
      if (this.stageClearDelay <= 0) this.advance();
    } else {
      this.updateSpawning(dt);
      if (this.isBoss && this.enemies.some((e) => e.isBoss)) {
        this.bossTimer -= dt;
        if (this.bossTimer <= 0) return this.fail('Время вышло! Капитан отступила с поля боя');
      }
    }
    this.updateArenaEvents(dt);
    if (this.freeze <= 0) this.updateShooting(dt, squad);
    this.updateBullets(dt, squad);
    this.updateEnemies(dt);
    this.updateOrbs(dt);
    this.updatePickups(dt);
    this.updateEffects(dt);

    if (this.hero.hp <= 0) this.fail('Отряд устал… Отступаем на этап назад 😿');
  }

  autoCast(squad) {
    const hasTargets = this.enemies.some((e) => !e.obstacle);
    if (hasTargets && this.canCast('volley')) this.cast('volley');
    if (hasTargets && this.canCast('rage')) this.cast('rage');
    if ((this.hero.hp < squad.maxHp * 0.5 || this.freeze > 0) && this.canCast('purr')) this.cast('purr');
  }

  // Точка прицеливания — середина силуэта.
  aimY(e) {
    return e.y - e.height * 0.5;
  }

  // Случайная точка за краем арены: враги приходят со всех четырёх сторон.
  edgePoint(pad = 20) {
    const W = WORLD.width;
    const H = WORLD.height;
    switch (Math.floor(Math.random() * 4)) {
      case 0: return { x: rand(0, W), y: 30 - pad };
      case 1: return { x: rand(0, W), y: H + pad };
      case 2: return { x: -pad, y: rand(40, H) };
      default: return { x: W + pad, y: rand(40, H) };
    }
  }

  updateSpawning(dt) {
    if (this.spawned >= this.stageTarget) return;
    this.spawnCd -= dt;
    const alive = this.enemies.filter((e) => !e.obstacle && !e.minion).length;
    if (this.spawnCd > 0 || alive >= MAX_ALIVE_ENEMIES) return;
    this.spawnCd = rand(...ARENA.spawnEvery);
    const type = this.isBoss ? 'boss' : pickEnemyType(this.state.stage);
    this.spawnEnemy(type, this.isBoss ? { x: WORLD.width + 30, y: WORLD.height / 2 + 30 } : undefined);
    this.spawned++;
  }

  // Ящики с оружием и звёздные сундуки появляются по таймерам, независимо от волны.
  updateArenaEvents(dt) {
    this.crateCd -= dt;
    const crates = this.enemies.filter((e) => e.obstacle).length;
    if (this.crateCd <= 0 && crates < ARENA.maxCrates && this.state.maxStage >= ENEMY_TYPES.crate.minStage) {
      this.crateCd = rand(...ARENA.crateEvery);
      this.spawnEnemy('crate', this.freeSpot(60));
    }
    this.chestCd -= dt;
    if (this.chestCd <= 0 && this.state.maxStage >= 3) {
      this.chestCd = this.nextChestDelay();
      const p = this.freeSpot(90);
      this.pickups.push({ kind: 'chest', x: p.x, y: p.y, t: 0, life: STAR_CHEST.lifetime, lifeMax: STAR_CHEST.lifetime, drop: 1 });
      this.floatText(p.x, p.y - 30, '⭐ Сундук!', '#fff3b0', 15);
      this.events.sfx?.('key');
    }
  }

  // Точка на арене подальше от котиков.
  freeSpot(minDist) {
    for (let i = 0; i < 20; i++) {
      const p = { x: rand(40, WORLD.width - 40), y: rand(70, WORLD.height - 30) };
      if (this.activeCats.every((k) => dist(this.cats[k], p) > minDist)) return p;
    }
    return { x: rand(40, WORLD.width - 40), y: rand(70, WORLD.height - 30) };
  }

  nextChestDelay() {
    return rand(...STAR_CHEST.every);
  }

  spawnEnemy(type, at = this.edgePoint()) {
    const stage = this.state.stage;
    const t = ENEMY_TYPES[type];
    let hp = enemyHp(stage, type);
    const heroine = type === 'boss' ? heroineForStage(stage) : null;
    let helpers = [];
    if (heroine && CHAPTERS[chapterForStage(stage)].final) {
      // Пощажённые героини книги приходят на помощь и ослабляют финального босса.
      helpers = allies(this.state, bookOf(chapterForStage(stage)));
      hp *= 1 - ALLY_BOSS_WEAKEN * helpers.length;
    }
    const scale = t.girl ? ARENA.enemyScale : 0.75;
    const height = t.size * (t.height ?? 1.2) * scale;
    let { x, y } = at;
    let vx = 0;
    if (t.runner) {
      // золотая мышь пересекает арену от края до края
      const left = Math.random() < 0.5;
      x = left ? -20 : WORLD.width + 20;
      y = rand(80, WORLD.height - 20);
      vx = left ? 1 : -1;
    }
    const e = {
      type,
      girl: !!t.girl,
      isBoss: type === 'boss',
      heroine,
      obstacle: !!t.obstacle,
      runner: !!t.runner,
      x,
      y,
      vx,
      hp,
      maxHp: hp,
      damage: enemyDamage(stage, type),
      gold: enemyGold(stage, type),
      speed: t.speed * (0.9 + Math.random() * 0.2),
      size: t.size * scale,
      height,
      r: Math.max(8, t.size * scale * 0.7), // радиус «тела» для столкновений
      facing: -1,
      attackCd: 0.4,
      castCd: 1 + Math.random(),
      phase: Math.random() * Math.PI * 2,
      flash: 0,
      lunge: 0,
      variant: Math.random(),
      shield: 0,
      timers: { ...ABILITY_FIRST },
      enraged: false,
    };
    this.enemies.push(e);
    if (type === 'goldMouse') this.floatText(WORLD.width / 2, 60, 'Золотая мышь! Лови!', '#ffd700', 16);
    if (heroine) {
      this.floatText(WORLD.width / 2, 56, `${heroine.name} — ${heroine.title}`, heroine.accent === '#ffffff' ? heroine.hair : heroine.accent, 17);
      if (helpers.length) {
        this.floatText(WORLD.width / 2, 80, `На помощь пришли: ${helpers.map((h) => h.name).join(', ')}!`, '#ffd166', 13);
        this.floatText(WORLD.width / 2, 98, `Сила: ${heroine.name} −${Math.round(ALLY_BOSS_WEAKEN * helpers.length * 100)}%`, '#ffd166', 13);
      }
    }
    return e;
  }

  // Ближайшая цель для котика в радиусе стрельбы: воительницы важнее ящиков.
  targetFor(cat) {
    let best = null;
    let bestScore = ARENA.shootRange;
    for (const e of this.enemies) {
      if (e.hp <= 0 || !onArena(e)) continue;
      const d = Math.hypot(e.x - cat.x, this.aimY(e) - (cat.y - CAT_BODY));
      const score = e.obstacle ? d + 120 : d;
      if (d < ARENA.shootRange && score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  updateShooting(dt, squad) {
    const volley = this.buffs.volley > 0 ? SKILLS.volley.fireRateMult : 1;
    const rage = (this.buffs.rage > 0 ? SKILLS.rage.damageMult : 1) * resolveMult(this.state);
    squad.cats.forEach((cat, i) => {
      const c = this.cats[i];
      c.fireCd -= dt;
      if (!cat) return;
      const gunX = c.x + 12 * c.facing;
      const gunY = c.y - CAT_BODY;
      const target = this.targetFor(c);
      if (!target) return;
      c.aim = Math.atan2(this.aimY(target) - gunY, target.x - gunX);
      if (!this.moving || i !== this.activeCats[0]) c.facing = Math.cos(c.aim) < 0 ? -1 : 1;
      if (c.fireCd > 0) return;
      c.fireCd = 1 / (cat.fireRate * volley);
      c.recoil = 1;
      for (let p = 0; p < cat.pellets; p++) {
        const crit = Math.random() < cat.critChance;
        const spread = cat.pellets > 1 ? (p - (cat.pellets - 1) / 2) * 0.35 : 0;
        const angle = c.aim + spread;
        this.bullets.push({
          x: gunX + Math.cos(angle) * 10,
          y: gunY + Math.sin(angle) * 10,
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

  nearestEnemy(from, exclude) {
    let best = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.obstacle || !onArena(e) || exclude?.has(e)) continue;
      const d = dist(e, from);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  updateBullets(dt, squad) {
    const speed = HERO.bulletSpeed * dt;
    for (const b of this.bullets) {
      if (!b.target || b.target.hp <= 0 || !this.enemies.includes(b.target)) b.target = this.nearestEnemy(b, b.hitSet);
      if (b.target) {
        const tx = b.target.x;
        const ty = this.aimY(b.target);
        const want = Math.atan2(ty - b.y, tx - b.x);
        let diff = want - b.angle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const maxTurn = BULLET_TURN_RATE * dt;
        b.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
        if (Math.hypot(tx - b.x, ty - b.y) <= speed + Math.max(b.target.r, b.target.height * 0.35)) {
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
      if (b.x < -40 || b.x > WORLD.width + 40 || b.y < -40 || b.y > WORLD.height + 40) b.dead = true;
    }
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  hit(enemy, dmg, crit, squad) {
    if (enemy.hp <= 0) return;
    const ability = enemy.heroine?.ability;
    if (enemy.shield > 0) {
      this.floatText(enemy.x, enemy.y - enemy.height - 8, 'Щит!', '#7dd3fc', 12);
      return;
    }
    const evade = ability && (enemy.heroine.evadeChance ?? BOSS_ABILITIES[ability].evade);
    if (evade && Math.random() < evade) {
      this.floatText(enemy.x + 10, enemy.y - enemy.height - 8, 'Мимо!', '#e9d5ff', 12);
      return;
    }
    enemy.hp -= dmg;
    enemy.flash = 1;
    this.floatText(
      enemy.x + (Math.random() - 0.5) * 14,
      enemy.y - enemy.height - 6,
      formatNumber(dmg) + (crit ? '!' : ''),
      crit ? '#ff4d6d' : '#ffffff',
      crit ? 16 : 12,
    );
    const chip = enemy.obstacle ? '#c8894a' : crit ? '#ff4d6d' : enemy.girl ? '#ffd6e7' : '#ffd166';
    this.burst(enemy.x, this.aimY(enemy), chip, crit ? 6 : 3, 100);
    if (crit) this.shake = Math.max(this.shake, 2);
    if (enemy.hp <= 0) this.kill(enemy, squad);
  }

  kill(enemy, squad) {
    const s = this.state;
    const gold = enemy.gold * squad.goldMult;
    // золото рассыпается монетами — их нужно подобрать (или они сами прилетят через пару секунд)
    const coins = enemy.isBoss || enemy.runner ? 12 : ARENA.coinsPerKill;
    for (let i = 0; i < coins; i++) this.dropCoin(enemy.x, enemy.y - 6, gold / coins);
    if (enemy.obstacle) {
      s.stats.crates++;
      progressQuest(s, 'crates');
    } else {
      s.stats.kills++;
      if (enemy.girl) {
        progressQuest(s, 'kills');
        this.streak++;
        s.stats.bestStreak = Math.max(s.stats.bestStreak, this.streak);
        progressQuest(s, 'streak', this.streak);
      }
    }
    if (enemy.runner) {
      s.stats.goldMice++;
      progressQuest(s, 'goldMice');
    }
    if (!enemy.minion && !enemy.obstacle) this.killed++;
    // воительницы не погибают, а исчезают в облачке звёздочек — возвращаются в Академию
    const debris = enemy.obstacle ? '#b5763b' : enemy.girl ? (enemy.heroine?.accent ?? '#ffc9de') : '#ffd34d';
    this.burst(enemy.x, this.aimY(enemy), debris, enemy.isBoss ? 36 : 12, enemy.isBoss ? 220 : 140);
    if (enemy.girl) this.sparkles(enemy.x, this.aimY(enemy), enemy.isBoss ? 16 : 5);
    this.events.sfx?.(enemy.obstacle ? 'break' : 'coin');
    if (ENEMY_TYPES[enemy.type].dropsGun && Math.random() < CRATE_GUN_CHANCE) this.dropGun(enemy);
    if (enemy.isBoss) this.giveKeys(enemy, s.stage % 10 === 0 ? KEYS.bigBoss : KEYS.boss);
    if (enemy.runner && Math.random() < KEYS.goldMouseChance) this.giveKeys(enemy, 1);
    if (enemy.isBoss) {
      clearResolve(s, s.stage);
      s.stats.bossKills++;
      progressQuest(s, 'bosses');
      this.shake = 10;
      this.events.onBossKill?.(s.stage, enemy.heroine);
    }
    this.removeEnemy(enemy);
  }

  dropGun(enemy) {
    const tier = buyTier(this.state.levels.forge ?? 0);
    const placed = addGun(this.state, tier) >= 0;
    this.floatText(enemy.x, enemy.y - 40, placed ? '🔫 Пушка!' : 'Арсенал полон', placed ? '#7dd3fc' : '#fca5a5', 15);
    this.events.onGunDrop?.(tier, placed);
  }

  giveKeys(enemy, n) {
    addKeys(this.state, n);
    this.floatText(enemy.x, enemy.y - enemy.height - 40, `+${n} 🔑`, '#ffe066', 18);
    this.events.onKey?.(n);
  }

  removeEnemy(enemy) {
    this.enemies = this.enemies.filter((e) => e !== enemy);
    if (this.killed >= this.stageTarget && this.stageClearDelay <= 0) {
      this.stageClearDelay = enemy.isBoss ? 1.5 : 1.0;
    }
  }

  // Ближайший котик в строю — к нему бегут воительницы.
  nearestCat(from) {
    let best = this.leader;
    let bestD = Infinity;
    for (const i of this.activeCats) {
      const d = dist(this.cats[i], from);
      if (d < bestD) {
        bestD = d;
        best = this.cats[i];
      }
    }
    return best;
  }

  updateEnemies(dt) {
    for (const e of [...this.enemies]) {
      e.flash = Math.max(0, e.flash - dt * 6);
      e.lunge = Math.max(0, e.lunge - dt * 4);
      e.shield = Math.max(0, e.shield - dt);
      if (e.obstacle) continue;
      e.phase += dt * (e.speed / 8);
      if (e.heroine) this.updateAbility(e, dt);

      if (e.runner) {
        e.x += e.vx * e.speed * dt;
        e.facing = e.vx;
        if (e.x < -40 || e.x > WORLD.width + 40) {
          this.floatText(WORLD.width / 2, 70, 'Золотая мышь убежала!', '#fca5a5', 13);
          this.killed++;
          this.removeEnemy(e);
        }
        continue;
      }

      const cat = this.nearestCat(e);
      const dx = cat.x - e.x;
      const dy = cat.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.facing = dx < 0 ? -1 : 1;
      const t = ENEMY_TYPES[e.type];
      if (t.ranged) {
        // волшебница держит дистанцию и бросает сферы туда, где котик сейчас
        const want = t.ranged.range;
        const dir = d > want ? 1 : d < want * 0.7 ? -0.8 : 0;
        e.x += (dx / d) * e.speed * dir * dt;
        e.y += (dy / d) * e.speed * dir * dt;
        e.castCd -= dt;
        if (e.castCd <= 0 && d < want * 1.3 && onArena(e)) {
          e.castCd = t.ranged.interval;
          e.lunge = 0.6;
          this.fireOrb(e, cat, t.ranged.speed, e.damage);
        }
      } else {
        const reach = ARENA.catRadius + e.r + (t.reach ?? 30) * 0.35;
        if (d > reach) {
          e.x += (dx / d) * e.speed * dt;
          e.y += (dy / d) * e.speed * dt;
        } else {
          e.attackCd -= dt;
          if (e.attackCd <= 0) {
            const oni = e.enraged ? BOSS_ABILITIES.oni.oni : null;
            e.attackCd = ENEMY.attackInterval / (oni?.attackMult ?? 1);
            e.lunge = 1;
            this.damageSquad(e.damage * (oni?.damageMult ?? 1), e.isBoss ? 6 : 2, cat);
          }
        }
      }
    }
    this.separateEnemies();
  }

  // Воительницы не стоят друг в друге: расталкиваем пары, которые слишком близко.
  separateEnemies() {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const min = a.r + b.r;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= min || d === 0) continue;
        const push = (min - d) / 2;
        const ka = a.obstacle || a.isBoss ? 0 : b.obstacle || b.isBoss ? 2 : 1;
        const kb = b.obstacle || b.isBoss ? 0 : a.obstacle || a.isBoss ? 2 : 1;
        a.x -= (dx / d) * push * ka;
        a.y -= (dy / d) * push * ka;
        b.x += (dx / d) * push * kb;
        b.y += (dy / d) * push * kb;
      }
    }
  }

  fireOrb(e, cat, speed, damage, extra = {}) {
    const sx = e.x - 8 * e.facing;
    const sy = this.aimY(e) - 4;
    const a = Math.atan2(cat.y - CAT_BODY - sy, cat.x - sx) + (extra.spread ?? 0);
    this.orbs.push({ x: sx, y: sy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, damage, life: 4, wind: !!extra.wind });
  }

  // Урон отряду. Во время рывка — неуязвимость; любой урон обрывает серию побед.
  damageSquad(damage, shake, at = this.leader) {
    if (this.dash.invulnerable > 0) {
      this.floatText(at.x, at.y - 50, 'Уклон!', '#e7f5ff', 13);
      return false;
    }
    this.hero.hp -= damage;
    this.hero.hurt = 1;
    this.streak = 0;
    this.shake = Math.max(this.shake, shake);
    this.floatText(at.x, at.y - 50, '-' + formatNumber(damage), '#ff6b6b', 14);
    this.events.sfx?.('hurt');
    return true;
  }

  // Сферы летят по прямой; попадают по любому котику на пути — от них можно увернуться.
  updateOrbs(dt) {
    for (const o of this.orbs) {
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.life -= dt;
      for (const i of this.activeCats) {
        const c = this.cats[i];
        if (Math.hypot(o.x - c.x, o.y - (c.y - CAT_BODY)) < ARENA.orbHitRadius) {
          this.damageSquad(o.damage, 3, c);
          o.dead = true;
          break;
        }
      }
      if (o.x < -20 || o.x > WORLD.width + 20 || o.y < -20 || o.y > WORLD.height + 20) o.dead = true;
    }
    this.orbs = this.orbs.filter((o) => !o.dead && o.life > 0);
  }

  updateAbility(e, dt) {
    if (!onArena(e)) return; // способности — только когда героиня на арене
    const cfg = BOSS_ABILITIES[e.heroine.ability];
    if (cfg.oni && !e.enraged && e.hp < e.maxHp * cfg.oni.below) {
      e.enraged = true;
      this.shake = 8;
      this.floatText(e.x, e.y - e.height - 14, '👹 Ярость!', '#ff6b6b', 16);
      this.burst(e.x, this.aimY(e), '#ff6b6b', 20, 160);
    }
    for (const kind of Object.keys(ABILITY_FIRST)) {
      const c = cfg[kind];
      if (!c) continue;
      e.timers[kind] -= dt;
      if (e.timers[kind] > 0) continue;
      e.timers[kind] = c.every;
      this.triggerAbility(e, kind, c);
    }
  }

  triggerAbility(e, kind, c) {
    const top = e.y - e.height - 12;
    switch (kind) {
      case 'heal': {
        const heal = e.maxHp * c.amount;
        e.hp = Math.min(e.maxHp, e.hp + heal);
        this.floatText(e.x, top, '🌸 +' + formatNumber(heal), '#ff9ec7', 14);
        this.burst(e.x, this.aimY(e), '#ffc9de', 14, 120);
        break;
      }
      case 'freeze':
        this.freeze = c.duration;
        this.floatText(this.leader.x, this.leader.y - 60, '❄️ Лапы замёрзли!', '#a5d8ff', 14);
        break;
      case 'shield':
        e.shield = c.duration;
        break;
      case 'summon':
        this.summon(e, c.count);
        break;
      case 'volley':
        // веер ветряных лезвий в сторону ведущего — уворачивайся
        for (let k = 0; k < c.count; k++) {
          this.fireOrb(e, this.leader, 170 + k * 15, e.damage * c.damage, { wind: true, spread: (k - (c.count - 1) / 2) * 0.28 });
        }
        this.floatText(e.x, top, '🌪 Ветер!', '#96f2d7', 14);
        break;
      case 'drain': {
        const heal = e.maxHp * c.healPct;
        e.hp = Math.min(e.maxHp, e.hp + heal);
        this.damageSquad(this.squad.maxHp * c.squadPct, 4);
        this.floatText(e.x, top, `✨ ${e.heroine.name} вытягивает силы`, e.heroine.accent === '#ffffff' ? e.heroine.hair : e.heroine.accent, 12);
        break;
      }
    }
  }

  summon(boss, count) {
    for (let k = 0; k < count; k++) {
      const m = this.spawnEnemy('ninja', { x: boss.x + rand(-30, 30), y: boss.y + rand(-30, 30) });
      m.minion = true; // призванные ниндзя не считаются в прогресс этапа
    }
    this.floatText(boss.x, boss.y - boss.height - 12, 'Ко мне, стража!', boss.heroine.accent === '#ffffff' ? boss.heroine.hair : boss.heroine.accent, 13);
  }

  // ---------- Добыча на земле ----------
  dropCoin(x, y, value) {
    const a = Math.random() * Math.PI * 2;
    const v = rand(30, 90);
    this.pickups.push({ kind: 'coin', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, value, t: 0, flying: false });
  }

  updatePickups(dt) {
    const order = this.activeCats;
    for (const p of this.pickups) {
      p.t += dt;
      if (p.kind === 'chest') {
        p.drop = Math.max(0, p.drop - dt * 2);
        p.life -= dt;
        if (order.some((i) => dist(this.cats[i], p) < 22)) this.collectChest(p);
        continue;
      }
      // монета: отскакивает, потом лежит; притягивается к котику рядом или сама летит к отряду
      p.vx *= 1 - Math.min(1, dt * 5);
      p.vy *= 1 - Math.min(1, dt * 5);
      p.x = clamp(p.x + p.vx * dt, 6, WORLD.width - 6);
      p.y = clamp(p.y + p.vy * dt, 36, WORLD.height - 4);
      let near = null;
      let nearD = ARENA.coinMagnet;
      for (const i of order) {
        const d = dist(this.cats[i], p);
        if (d < nearD) {
          nearD = d;
          near = this.cats[i];
        }
      }
      if (!near && p.t > ARENA.coinAutoCollect) near = this.leader;
      if (near) {
        const d = Math.max(1, dist(near, p));
        const sp = 260 + p.t * 40;
        p.x += ((near.x - p.x) / d) * Math.min(d, sp * dt);
        p.y += ((near.y - p.y) / d) * Math.min(d, sp * dt);
        if (d < 10) this.collectCoin(p);
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken && !(p.kind === 'chest' && p.life <= 0));
  }

  collectCoin(p) {
    p.taken = true;
    addGold(this.state, p.value);
    this.state.stats.coins++;
    progressQuest(this.state, 'coins');
    this.events.sfx?.('coin');
  }

  // Награда сундука: пушка (если есть место), ключ или золото за минуту фарма.
  collectChest(p) {
    p.taken = true;
    const s = this.state;
    s.stats.chests++;
    progressQuest(s, 'chests');
    this.sparkles(p.x, p.y - 10, 14);
    const roll = Math.random();
    let reward;
    if (roll < STAR_CHEST.gunChance && s.guns.includes(0)) {
      const tier = Math.min(MAX_GUN_TIER, buyTier(s.levels.forge ?? 0) + 1);
      addGun(s, tier);
      reward = { kind: 'gun', tier };
    } else if (roll < STAR_CHEST.gunChance + STAR_CHEST.keyChance) {
      addKeys(s, 1);
      reward = { kind: 'key', amount: 1 };
    } else {
      const gold = idleGoldPerSecond(Math.max(1, s.stage), this.squad) * STAR_CHEST.goldSeconds;
      addGold(s, gold);
      reward = { kind: 'gold', amount: gold };
    }
    this.floatText(p.x, p.y - 30, reward.kind === 'gold' ? `+${formatNumber(reward.amount)} 🪙`
      : reward.kind === 'key' ? '+1 🔑' : '🔫 Пушка!', '#fff3b0', 16);
    this.events.sfx?.('jackpot');
    this.events.onChest?.(reward);
    return reward;
  }

  // Монеты, оставшиеся на арене после этапа, не пропадают — собираем их сразу.
  sweepCoins() {
    for (const p of this.pickups) if (p.kind === 'coin' && !p.taken) this.collectCoin(p);
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  advance() {
    const s = this.state;
    this.sweepCoins();
    if (s.autoAdvance) {
      s.stage += 1;
      s.maxStage = Math.max(s.maxStage, s.stage);
    }
    this.startStage();
  }

  fail(message) {
    const s = this.state;
    if (this.isBoss) {
      const stacks = addResolve(s, s.stage);
      this.events.onResolve?.(stacks);
    }
    this.sweepCoins();
    this.farmTimer = 0;
    s.stage = Math.max(1, s.stage - 1);
    s.autoAdvance = false;
    this.squad = statsOf(s);
    this.hero.hp = this.squad.maxHp;
    this.streak = 0;
    this.events.onStageFail?.(message);
    this.startStage();
  }

  // ---------- Эффекты ----------
  floatText(x, y, text, color, size) {
    if (this.texts.length > 50) this.texts.shift();
    this.texts.push({ x, y, text, color, size, life: 1, vy: -36 });
  }

  burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.3, color, size: 2 + Math.random() * 2.5 });
    }
  }

  sparkles(x, y, count) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 24,
        y: y + (Math.random() - 0.5) * 24,
        vx: (Math.random() - 0.5) * 50,
        vy: -30 - Math.random() * 50,
        life: 0.7 + Math.random() * 0.4,
        color: '#fff3b0',
        size: 4,
        star: true,
      });
    }
  }

  updateEffects(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - Math.min(1, dt * 3);
      p.vy *= 1 - Math.min(1, dt * 3);
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

// ---------- помощники ----------
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function normalize(x, y) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

const onArena = (e) => e.x > -4 && e.x < WORLD.width + 4 && e.y > 20 && e.y < WORLD.height + 10;

// Точка на ломаной (путь ведущего) на расстоянии len от начала.
function pointAlong(path, len) {
  let left = len;
  for (let i = 0; i + 1 < path.length; i++) {
    const seg = dist(path[i], path[i + 1]);
    if (seg >= left) {
      const k = left / seg;
      return { x: path[i].x + (path[i + 1].x - path[i].x) * k, y: path[i].y + (path[i + 1].y - path[i].y) * k };
    }
    left -= seg;
  }
  return null;
}
