// Процедурная отрисовка арены (вид сверху, фигурки «в три четверти»): земля локации, отряд котиков,
// воительницы, добыча на земле, пули, эффекты и полоски здоровья.
import { WORLD } from './battle.js';
import { biomeFor } from './formulas.js';
import { CATS, ARENA } from './config.js';
import { drawGirl, lookFor, drawPuck } from './girls.js';

const TAU = Math.PI * 2;
const BACK_WALL = 34; // высота «задней стены» локации вверху арены

// Декор генерируется детерминированно, чтобы не мерцал.
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const rnd = seeded(42);
const STARS = Array.from({ length: 60 }, () => ({ x: rnd() * WORLD.width, y: rnd() * WORLD.height, r: rnd() * 1.3 + 0.3, t: rnd() * TAU }));
const PATCHES = Array.from({ length: 40 }, () => ({ x: rnd() * WORLD.width, y: BACK_WALL + rnd() * (WORLD.height - BACK_WALL), r: 8 + rnd() * 22, k: rnd() }));
const WALL = Array.from({ length: 13 }, (_, i) => ({ x: i * 40 + rnd() * 16 - 8, s: 0.8 + rnd() * 0.4, k: rnd() }));

export function render(ctx, battle, time) {
  const { width: W, height: H } = WORLD;
  const biome = biomeFor(battle.state.stage);
  ctx.save();
  if (battle.shake > 0) ctx.translate((Math.random() - 0.5) * battle.shake, (Math.random() - 0.5) * battle.shake);
  drawArena(ctx, biome, time);
  drawPickups(ctx, battle.pickups, time);
  if (battle.manual && battle.input.target) drawTargetMarker(ctx, battle.input.target, time);

  // все фигуры сортируются по y: кто ниже на экране — тот ближе к зрителю
  const figures = [];
  for (const e of battle.enemies) figures.push({ y: e.y, draw: () => drawFigure(ctx, e, time, battle, biome) });
  for (const i of battle.activeCats) {
    const c = battle.cats[i];
    figures.push({ y: c.y, draw: () => drawArenaCat(ctx, battle, i, battle.squad.cats[i], time) });
  }
  figures.sort((a, b) => a.y - b.y);
  for (const f of figures) f.draw();

  drawOrbs(ctx, battle.orbs, time);
  drawBullets(ctx, battle.bullets);
  drawParticles(ctx, battle.particles);
  drawTexts(ctx, battle.texts);
  ctx.restore();

  if (battle.buffs.rage > 0) {
    ctx.fillStyle = `rgba(255, 60, 60, ${0.07 + Math.sin(time * 8) * 0.03})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (battle.freeze > 0) {
    ctx.fillStyle = `rgba(165, 216, 255, ${Math.min(0.3, battle.freeze * 0.25)})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (battle.hero.hurt > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, 'rgba(255,0,0,0)');
    g.addColorStop(1, `rgba(255,0,0,${battle.hero.hurt * 0.3})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  drawHud(ctx, battle);
}

function drawFigure(ctx, e, time, battle, biome) {
  if (e.obstacle) drawObstacle(ctx, e, time, biome);
  else if (e.girl) drawGirlEnemy(ctx, e, time, battle);
  else drawEnemy(ctx, e, time);
}

// ---------- Арена ----------
function drawArena(ctx, biome, time) {
  const { width: W, height: H } = WORLD;
  ctx.fillStyle = biome.ground;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  // пятна и плитка на земле
  if (biome.decor === 'city' || biome.decor === 'roofs') {
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    const step = biome.decor === 'city' ? 32 : 24;
    ctx.beginPath();
    for (let x = 0; x <= W; x += step) {
      ctx.moveTo(x + 0.5, BACK_WALL);
      ctx.lineTo(x + 0.5, H);
    }
    for (let y = BACK_WALL; y <= H; y += step / 2) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
    }
    ctx.stroke();
  } else {
    for (const p of PATCHES) {
      ctx.fillStyle = biome.decor === 'snow'
        ? (p.k > 0.5 ? 'rgba(255,255,255,0.6)' : 'rgba(150,185,225,0.16)')
        : (p.k > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)');
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.55, 0, 0, TAU);
      ctx.fill();
    }
  }
  if (biome.decor === 'space') {
    for (const s of STARS) {
      ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.sin(time * 3 + s.t) * 0.2})`;
      circle(ctx, s.x, s.y, s.r);
    }
  }

  // «задняя стена» локации — небо и декор вверху арены
  const sky = ctx.createLinearGradient(0, 0, 0, BACK_WALL);
  sky.addColorStop(0, biome.sky[0]);
  sky.addColorStop(1, biome.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, W + 40, BACK_WALL + 20);
  for (const w of WALL) drawWallDecor(ctx, biome, w.x, BACK_WALL + 2, w.s, w.k);
  ctx.fillStyle = biome.groundDark;
  ctx.fillRect(-20, BACK_WALL, W + 40, 4);

  // мягкая виньетка по краям арены
  const v = ctx.createRadialGradient(W / 2, H / 2 + 20, H * 0.45, W / 2, H / 2 + 20, H * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function drawWallDecor(ctx, biome, x, base, s, k) {
  switch (biome.decor) {
    case 'garden':
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(x - 2 * s, base - 14 * s, 4 * s, 14 * s);
      ctx.fillStyle = k > 0.5 ? '#4f9d3f' : '#5aae48';
      tri(ctx, x - 14 * s, base - 8 * s, x + 14 * s, base - 8 * s, x, base - 38 * s);
      break;
    case 'desert':
      ctx.fillStyle = '#e8b56b';
      ctx.beginPath();
      ctx.ellipse(x, base, 26 * s, 12 * s, 0, Math.PI, TAU);
      ctx.fill();
      if (k > 0.6) {
        ctx.fillStyle = '#4f9a52';
        roundRect(ctx, x - 3 * s, base - 26 * s, 6 * s, 26 * s, 3 * s);
        roundRect(ctx, x - 10 * s, base - 18 * s, 6 * s, 10 * s, 3 * s);
      }
      break;
    case 'snow':
      ctx.fillStyle = '#d7e3f2';
      tri(ctx, x - 22 * s, base, x + 22 * s, base, x, base - 34 * s);
      ctx.fillStyle = '#ffffff';
      tri(ctx, x - 7 * s, base - 23 * s, x + 7 * s, base - 23 * s, x, base - 34 * s);
      break;
    case 'city':
      ctx.fillStyle = k > 0.5 ? '#c47a5a' : '#b0694b';
      ctx.fillRect(x - 16 * s, base - 34 * s, 32 * s, 34 * s);
      ctx.fillStyle = 'rgba(255,240,200,0.6)';
      for (let i = 0; i < 3; i++) ctx.fillRect(x - 12 * s + i * 9 * s, base - 28 * s, 5 * s, 6 * s);
      break;
    case 'roofs':
      ctx.fillStyle = '#2a1f3d';
      tri(ctx, x - 20 * s, base, x + 20 * s, base, x, base - 22 * s);
      if (k > 0.5) ctx.fillRect(x + 6 * s, base - 30 * s, 6 * s, 16 * s);
      break;
    case 'space':
      ctx.fillStyle = '#4a4d66';
      ctx.beginPath();
      ctx.ellipse(x, base, 18 * s, 6 * s, 0, Math.PI, TAU);
      ctx.fill();
      break;
  }
}

function drawTargetMarker(ctx, t, time) {
  const r = 9 + Math.sin(time * 8) * 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(t.x, t.y, r, r * 0.5, 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  circle(ctx, t.x, t.y + 1, 3);
  for (const [dx, dy] of [[-4, -4], [-1.5, -6], [1.5, -6], [4, -4]]) circle(ctx, t.x + dx, t.y + dy, 1.4);
}

// ---------- Добыча на земле ----------
function drawPickups(ctx, pickups, time) {
  for (const p of pickups) {
    if (p.kind === 'coin') {
      const spin = Math.abs(Math.cos(time * 6 + p.x));
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 2, 4, 1.6, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 3, 4 * Math.max(0.25, spin), 4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#b8860b';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 3, 1.8 * Math.max(0.25, spin), 1.8, 0, 0, TAU);
      ctx.fill();
      continue;
    }
    // звёздный сундук: падает с неба, светится, мигает перед исчезновением
    if (p.life < 3 && Math.sin(time * 18) > 0) continue;
    const lift = p.drop * 120 + Math.abs(Math.sin(time * 4)) * 2;
    ctx.fillStyle = 'rgba(255, 220, 120, 0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 20, 8, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(p.x, p.y - lift);
    ctx.fillStyle = '#b5651d';
    roundRect(ctx, -12, -16, 24, 15, 3);
    ctx.fillStyle = '#d4892b';
    roundRect(ctx, -13, -21, 26, 8, 4);
    ctx.fillStyle = '#ffd43b';
    ctx.fillRect(-13, -14, 26, 3);
    ctx.fillRect(-2, -21, 4, 20);
    star(ctx, 0, -9, 3.5);
    ctx.restore();
    ctx.fillStyle = `rgba(255, 243, 176, ${0.5 + Math.sin(time * 6) * 0.4})`;
    star(ctx, p.x + 14, p.y - 26 - lift, 3);
    // кольцо оставшегося времени
    ctx.strokeStyle = 'rgba(255, 243, 176, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 10 - lift, 18, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, p.life / p.lifeMax));
    ctx.stroke();
  }
}

// ---------- HUD на арене ----------
function drawHud(ctx, battle) {
  const { width: W, height: H } = WORLD;
  const sq = battle.squad;
  // здоровье отряда — внизу слева
  bar(ctx, 10, H - 14, 120, 8, battle.hero.hp / sq.maxHp, '#4ade80', '#14532d');
  ctx.font = '700 9px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText('Отряд', 11, H - 15);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Отряд', 10, H - 16);
  if (!battle.manual && battle.state.autopilot && !battle.enemies.some((e) => e.isBoss)) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText('🤖 автопилот — веди котиков мышкой или пальцем', W / 2 + 1, BACK_WALL + 7);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('🤖 автопилот — веди котиков мышкой или пальцем', W / 2, BACK_WALL + 6);
  }
  // здоровье босса — вверху по центру
  const boss = battle.enemies.find((e) => e.isBoss);
  if (boss) {
    const name = boss.heroine ? boss.heroine.name : 'Капитан';
    const color = boss.heroine && boss.heroine.accent !== '#ffffff' ? boss.heroine.accent : '#a855f7';
    bar(ctx, W / 2 - 90, BACK_WALL + 8, 180, 8, boss.hp / boss.maxHp, color, '#2a0a2a');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(`👑 ${name}${boss.shield > 0 ? ' · щит' : ''}${boss.enraged ? ' · ярость' : ''}`, W / 2 + 1, BACK_WALL + 7);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`👑 ${name}${boss.shield > 0 ? ' · щит' : ''}${boss.enraged ? ' · ярость' : ''}`, W / 2, BACK_WALL + 6);
  }
}

// ---------- Оружие ----------
// Габариты пушек по X (от приклада до дула) — для центрирования иконок.
export const GUN_EXTENTS = {
  pistol: [-6, 22], smg: [-10, 28], shotgun: [-16, 36], rifle: [-16, 38], sniper: [-18, 48], minigun: [-14, 34],
};

// Рисует пушку с началом координат у рукояти, ствол смотрит вправо.
export function drawGun(ctx, family, accent, time = 0) {
  const body = '#3d405b';
  const dark = '#2b2d42';
  const metal = '#5c6185';
  switch (family) {
    case 'pistol':
      ctx.fillStyle = body; roundRect(ctx, -6, -6, 22, 9, 2);
      ctx.fillStyle = metal; ctx.fillRect(14, -5, 6, 6);
      ctx.fillStyle = dark; ctx.fillRect(-4, 2, 7, 9);
      ctx.fillStyle = accent; ctx.fillRect(-2, -5, 12, 2);
      return 22;
    case 'smg':
      ctx.fillStyle = body; roundRect(ctx, -10, -6, 30, 10, 2);
      ctx.fillStyle = metal; ctx.fillRect(20, -4, 8, 5);
      ctx.fillStyle = dark; ctx.fillRect(4, 3, 6, 12); ctx.fillRect(-6, 3, 6, 8);
      ctx.fillStyle = accent; ctx.fillRect(-6, -5, 20, 2);
      return 28;
    case 'shotgun':
      ctx.fillStyle = '#7a4b2a'; roundRect(ctx, -16, -4, 14, 9, 3);
      ctx.fillStyle = body; ctx.fillRect(-4, -6, 16, 9);
      ctx.fillStyle = metal; ctx.fillRect(12, -6, 24, 4); ctx.fillRect(12, -1, 22, 3);
      ctx.fillStyle = accent; ctx.fillRect(14, 2, 12, 4);
      return 36;
    case 'rifle':
      ctx.fillStyle = dark; roundRect(ctx, -16, -4, 14, 9, 2);
      ctx.fillStyle = body; ctx.fillRect(-4, -6, 24, 10);
      ctx.fillStyle = metal; ctx.fillRect(20, -4, 18, 4);
      ctx.fillStyle = dark; ctx.fillRect(6, 4, 6, 10);
      ctx.fillStyle = accent; ctx.fillRect(0, -10, 14, 4);
      return 38;
    case 'sniper':
      ctx.fillStyle = dark; roundRect(ctx, -18, -4, 16, 8, 2);
      ctx.fillStyle = body; ctx.fillRect(-4, -5, 22, 8);
      ctx.fillStyle = metal; ctx.fillRect(18, -3, 30, 3);
      ctx.fillStyle = '#1b1c2b'; roundRect(ctx, 0, -13, 16, 6, 3);
      ctx.fillStyle = accent; circle(ctx, 16, -10, 2.5); ctx.fillRect(-2, -4, 8, 2);
      return 48;
    case 'minigun': {
      ctx.fillStyle = body; roundRect(ctx, -14, -9, 22, 16, 4);
      ctx.fillStyle = dark; ctx.fillRect(-10, 6, 8, 8);
      const spin = time * 30;
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = (Math.floor(spin) + k) % 3 === 0 ? '#8a90b8' : metal;
        ctx.fillRect(8, -7 + k * 5, 26, 3);
      }
      ctx.fillStyle = accent; ctx.fillRect(-12, -8, 18, 3); ctx.fillRect(30, -8, 4, 14);
      return 34;
    }
  }
  return 20;
}

// ---------- Отряд ----------
function drawArenaCat(ctx, battle, i, cat, time) {
  const c = battle.cats[i];
  const invuln = battle.dash.invulnerable > 0;
  if (invuln) ctx.globalAlpha = 0.55 + Math.sin(time * 40) * 0.25;
  drawCat(ctx, { x: c.x, y: 0, base: c.y, scale: ARENA.catScale, facing: c.facing }, CATS[i], cat?.gun ?? null,
    { ...c, walking: battle.moving }, battle, time + i * 0.7, battle.state.catSkins[i]);
  ctx.globalAlpha = 1;
}

// Котик для витрины гардероба и портретов диалогов: без боя, с выбранным скином.
// time по умолчанию 1 — чтобы котик на витрине не моргал.
export function drawCatPreview(ctx, catIndex, skin, w, h, time = 1, gun = null) {
  const scale = h / 82;
  const fake = { walking: false, buffs: { rage: 0, volley: 0 }, hero: { hurt: 0 }, freeze: 0 };
  ctx.save();
  drawCat(ctx, { x: w * 0.42 / scale, y: 0, scale: 1, base: (h - 6) / scale, facing: 1 }, CATS[catIndex], gun,
    { aim: 0, recoil: 0, happy: 0 }, fake, time, skin, scale);
  ctx.restore();
}

function drawCat(ctx, pos, def, gun, cs, battle, time, skin = null, outerScale = 1) {
  const walking = cs.walking ?? false;
  const bob = walking ? Math.abs(Math.sin(time * 9)) * -3 : Math.sin(time * 4) * 1.5;
  const rage = battle.buffs.rage > 0;
  const fur = rage ? '#ff7b54' : def.fur;
  const furDark = rage ? '#d9483b' : def.furDark;

  ctx.save();
  if (outerScale !== 1) ctx.scale(outerScale, outerScale);
  ctx.translate(pos.x, pos.base + pos.y);
  ctx.scale(pos.scale, pos.scale);
  // котик нарисован лицом вправо; смотрит влево — отражаем, а угол прицела зеркалим
  const facing = pos.facing ?? 1;
  if (facing < 0) ctx.scale(-1, 1);
  const aim = facing < 0 ? Math.PI - cs.aim : cs.aim;

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 26, 5, 0, 0, TAU);
  ctx.fill();

  drawSkinBack(ctx, skin, time, fur);

  // хвост
  ctx.strokeStyle = furDark;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, -14);
  ctx.quadraticCurveTo(-38, -20 + Math.sin(time * 3) * 6, -30, -44 + Math.sin(time * 3 + 1) * 6);
  ctx.stroke();

  // лапы: шагают, пока отряд идёт
  const step = walking ? Math.sin(time * 9) * 4 : 0;
  ctx.fillStyle = furDark;
  ctx.fillRect(-13 + step, -7, 8, 9);
  ctx.fillRect(6 - step, -7, 8, 9);

  ctx.translate(0, bob);
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, -20, 20, 16, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = def.belly;
  ctx.beginPath();
  ctx.ellipse(6, -16, 10, 11, 0, 0, TAU);
  ctx.fill();

  // голова
  const hx = 8;
  const hy = -46;
  ctx.fillStyle = fur;
  tri(ctx, hx - 15, hy - 6, hx - 11, hy - 24, hx - 2, hy - 11);
  tri(ctx, hx + 15, hy - 6, hx + 11, hy - 24, hx + 2, hy - 11);
  ctx.fillStyle = '#ffb3c1';
  tri(ctx, hx - 12, hy - 9, hx - 10, hy - 19, hx - 5, hy - 12);
  tri(ctx, hx + 12, hy - 9, hx + 10, hy - 19, hx + 5, hy - 12);
  ctx.fillStyle = fur;
  circle(ctx, hx, hy, 17);
  ctx.strokeStyle = furDark;
  ctx.lineWidth = 2.5;
  for (const dx of [-5, 0, 5]) {
    ctx.beginPath();
    ctx.moveTo(hx + dx, hy - 16);
    ctx.lineTo(hx + dx, hy - 10);
    ctx.stroke();
  }
  const blink = time % 4 < 0.12;
  const eye = def.key === 'ugolek' ? '#f6d32d' : '#222';
  if (blink || battle.hero.hurt > 0.5) {
    ctx.fillStyle = '#222';
    ctx.fillRect(hx - 1, hy - 1, 7, 2);
    ctx.fillRect(hx + 9, hy - 1, 7, 2);
  } else {
    ctx.fillStyle = eye;
    circle(ctx, hx + 3, hy, 3.5);
    circle(ctx, hx + 12, hy, 3.5);
    ctx.fillStyle = def.key === 'ugolek' ? '#222' : '#fff';
    circle(ctx, hx + 4, hy - 1.2, 1.2);
    circle(ctx, hx + 13, hy - 1.2, 1.2);
  }
  if (rage) {
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx - 1, hy - 7);
    ctx.lineTo(hx + 6, hy - 4);
    ctx.moveTo(hx + 16, hy - 7);
    ctx.lineTo(hx + 9, hy - 4);
    ctx.stroke();
  }
  ctx.fillStyle = '#ff6f91';
  tri(ctx, hx + 6, hy + 5, hx + 10, hy + 5, hx + 8, hy + 8);
  ctx.strokeStyle = def.key === 'ugolek' ? 'rgba(220,220,220,0.6)' : 'rgba(60,40,20,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const dy of [5, 9]) {
    ctx.moveTo(hx + 14, hy + 6);
    ctx.lineTo(hx + 25, hy + dy - 2);
    ctx.moveTo(hx + 2, hy + 6);
    ctx.lineTo(hx - 9, hy + dy - 2);
  }
  ctx.stroke();
  if (!SKIN_HIDES_BAND.has(skin)) {
    ctx.fillStyle = def.band;
    ctx.fillRect(hx - 16, hy - 12, 32, 5);
    tri(ctx, hx - 16, hy - 12, hx - 25, hy - 16 + Math.sin(time * 6) * 2, hx - 23, hy - 6);
  }
  drawSkinHead(ctx, skin, hx, hy, time);
  if (battle.freeze > 0) {
    ctx.fillStyle = 'rgba(200, 235, 255, 0.55)';
    roundRect(ctx, -22, -64, 50, 66, 10);
  }

  // оружие
  if (!gun) {
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(30, -32 - bob);
  ctx.rotate(Math.max(-1.3, Math.min(1.3, Math.atan2(Math.sin(aim), Math.cos(aim)))));
  ctx.translate(-cs.recoil * 4, 0);
  const len = drawGun(ctx, gun.family.key, gun.rarity.color, time);
  ctx.fillStyle = fur;
  circle(ctx, -4, 4, 5);
  if (cs.recoil > 0.6) {
    ctx.fillStyle = battle.buffs.volley > 0 ? '#4cc9f0' : '#ffd166';
    tri(ctx, len, -6, len, 6, len + 12 + Math.random() * 6, 0);
  }
  ctx.restore();

  ctx.restore();
}

// ---------- Аниме-скины котиков ----------
const SKIN_HIDES_BAND = new Set(['samurai', 'snowmage', 'mecha', 'moonlord', 'maidRam', 'maidRem', 'librarian', 'iceSpirit', 'witch']);

// Детали за спиной: плащи и дополнительные хвосты.
function drawSkinBack(ctx, skin, time, fur) {
  const flutter = Math.sin(time * 4) * 3;
  switch (skin) {
    case 'snowmage':
    case 'moonlord':
      ctx.fillStyle = skin === 'snowmage' ? '#e7f5ff' : '#5f3dc4';
      ctx.beginPath();
      ctx.moveTo(-6, -34);
      ctx.lineTo(10, -34);
      ctx.lineTo(-24 + flutter, 0);
      ctx.lineTo(-34 + flutter, -4);
      ctx.closePath();
      ctx.fill();
      if (skin === 'moonlord') {
        ctx.fillStyle = '#ffd43b';
        ctx.fillRect(-6, -36, 16, 3);
      }
      break;
    case 'kitsune':
      for (let k = 0; k < 2; k++) {
        ctx.strokeStyle = fur;
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-14, -14);
        ctx.quadraticCurveTo(-34 - k * 6, -8 - k * 10 + flutter, -40 - k * 4, -30 - k * 10);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        circle(ctx, -40 - k * 4, -30 - k * 10, 5);
      }
      break;
    case 'witch':
      ctx.fillStyle = '#1b1b1f';
      ctx.beginPath();
      ctx.moveTo(-6, -34);
      ctx.lineTo(10, -34);
      ctx.lineTo(-24 + flutter, 0);
      ctx.lineTo(-34 + flutter, -4);
      ctx.closePath();
      ctx.fill();
      break;
    case 'thief':
      ctx.fillStyle = '#c92a2a';
      ctx.beginPath();
      ctx.moveTo(0, -36);
      ctx.quadraticCurveTo(-22, -36 + flutter, -36, -26 + flutter * 1.5);
      ctx.lineTo(-34, -20 + flutter);
      ctx.quadraticCurveTo(-18, -28, 0, -30);
      ctx.fill();
      break;
    case 'kunoichi':
      ctx.fillStyle = '#5f3dc4';
      ctx.beginPath();
      ctx.moveTo(0, -40);
      ctx.quadraticCurveTo(-24, -40 + flutter, -38, -30 + flutter * 1.5);
      ctx.lineTo(-36, -24 + flutter);
      ctx.quadraticCurveTo(-20, -32, 0, -34);
      ctx.fill();
      break;
  }
}

// Головные уборы и маски поверх головы котика (голова в точке hx, hy, радиус 17).
function drawSkinHead(ctx, skin, hx, hy, time) {
  switch (skin) {
    case 'samurai':
      ctx.fillStyle = '#9b2226';
      ctx.beginPath();
      ctx.arc(hx, hy - 4, 18, Math.PI, TAU);
      ctx.fill();
      ctx.fillRect(hx - 21, hy - 6, 42, 5);
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(hx, hy - 22, 11, Math.PI * 1.1, Math.PI * 1.9);
      ctx.lineTo(hx, hy - 18);
      ctx.fill();
      ctx.fillStyle = '#ff9ec7';
      circle(ctx, hx - 10, hy - 14, 2.5);
      break;
    case 'kunoichi':
      ctx.fillStyle = '#5f3dc4';
      ctx.fillRect(hx - 17, hy - 13, 34, 5);
      ctx.fillStyle = '#3b2a6b';
      ctx.beginPath();
      ctx.moveTo(hx - 15, hy + 3);
      ctx.lineTo(hx + 18, hy + 3);
      ctx.quadraticCurveTo(hx + 14, hy + 16, hx + 2, hy + 16);
      ctx.quadraticCurveTo(hx - 12, hy + 15, hx - 15, hy + 3);
      ctx.fill();
      break;
    case 'snowmage':
      ctx.fillStyle = '#a5d8ff';
      ctx.beginPath();
      ctx.ellipse(hx, hy - 12, 24, 5, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx - 13, hy - 13);
      ctx.lineTo(hx + 13, hy - 13);
      ctx.lineTo(hx - 6 + Math.sin(time * 2) * 2, hy - 42);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(hx - Math.cos(a) * 4, hy - 22 - Math.sin(a) * 4);
        ctx.lineTo(hx + Math.cos(a) * 4, hy - 22 + Math.sin(a) * 4);
        ctx.stroke();
      }
      break;
    case 'mecha':
      ctx.fillStyle = '#495057';
      ctx.beginPath();
      ctx.arc(hx, hy - 3, 18.5, Math.PI * 1.02, Math.PI * 1.98);
      ctx.fill();
      ctx.fillStyle = 'rgba(76, 201, 240, 0.75)';
      roundRect(ctx, hx - 3, hy - 5, 22, 8, 3);
      ctx.strokeStyle = '#495057';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy - 20);
      ctx.lineTo(hx - 12, hy - 30);
      ctx.stroke();
      ctx.fillStyle = Math.sin(time * 6) > 0 ? '#ff6b6b' : '#ffd43b';
      circle(ctx, hx - 12, hy - 30, 2.5);
      break;
    case 'kitsune':
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(hx - 12, hy - 12, 8, 10, -0.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e03131';
      ctx.fillRect(hx - 16, hy - 14, 4, 1.5);
      ctx.fillRect(hx - 11, hy - 17, 4, 1.5);
      tri(ctx, hx - 18, hy - 18, hx - 16, hy - 26, hx - 12, hy - 20);
      break;
    case 'moonlord':
      ctx.fillStyle = '#3b2a6b';
      tri(ctx, hx - 12, hy - 14, hx - 18, hy - 30, hx - 6, hy - 17);
      tri(ctx, hx + 12, hy - 14, hx + 18, hy - 30, hx + 6, hy - 17);
      ctx.fillStyle = '#ffd43b';
      ctx.beginPath();
      ctx.arc(hx, hy - 10, 5, 0.6, Math.PI * 2 - 0.6);
      ctx.fill();
      ctx.fillStyle = '#5f3dc4';
      circle(ctx, hx + 2, hy - 10, 4);
      break;
    case 'thief':
      ctx.fillStyle = '#c92a2a';
      ctx.fillRect(hx - 15, hy + 12, 30, 6); // шарф на шее
      break;
    case 'maidRam':
    case 'maidRem': {
      // кружевная наколка и заколка-крестик, как у сестёр-горничных
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(hx, hy - 15, 13, 4, 0, Math.PI, TAU);
      ctx.fill();
      for (let i = -2; i <= 2; i++) circle(ctx, hx + i * 5.5, hy - 15, 2.6);
      if (skin === 'maidRem') {
        // фартук на животике (живот — на 30 пикс ниже головы)
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        roundRect(ctx, hx - 9, hy + 22, 16, 18, 4);
      }
      ctx.strokeStyle = skin === 'maidRam' ? '#ff8fab' : '#4dabf7';
      ctx.lineWidth = 2;
      const cx = skin === 'maidRam' ? hx - 9 : hx + 9;
      ctx.beginPath();
      ctx.moveTo(cx - 3, hy - 11);
      ctx.lineTo(cx + 3, hy - 5);
      ctx.moveTo(cx + 3, hy - 11);
      ctx.lineTo(cx - 3, hy - 5);
      ctx.stroke();
      break;
    }
    case 'librarian':
      ctx.fillStyle = '#e64980';
      tri(ctx, hx, hy - 16, hx - 13, hy - 24, hx - 13, hy - 9);
      tri(ctx, hx, hy - 16, hx + 13, hy - 24, hx + 13, hy - 9);
      circle(ctx, hx, hy - 16, 3.5);
      break;
    case 'iceSpirit':
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + time * 0.3;
        circle(ctx, hx - 10 + Math.cos(a) * 4, hy - 14 + Math.sin(a) * 4, 2.8);
      }
      ctx.fillStyle = '#9b6fd6';
      circle(ctx, hx - 10, hy - 14, 2);
      ctx.strokeStyle = 'rgba(165, 216, 255, 0.9)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(hx + 10 - Math.cos(a) * 4, hy - 16 - Math.sin(a) * 4);
        ctx.lineTo(hx + 10 + Math.cos(a) * 4, hy - 16 + Math.sin(a) * 4);
        ctx.stroke();
      }
      break;
    case 'witch': {
      const flap = 0.7 + Math.sin(time * 6) * 0.3;
      ctx.fillStyle = '#9775fa';
      ctx.beginPath();
      ctx.ellipse(hx + 6, hy - 15, 5 * flap, 3.5, -0.5, 0, TAU);
      ctx.ellipse(hx + 13, hy - 15, 5 * flap, 3.5, 0.5, 0, TAU);
      ctx.fill();
      break;
    }
    case 'idol':
      ctx.fillStyle = '#ff6b9d';
      tri(ctx, hx - 2, hy - 18, hx - 14, hy - 26, hx - 14, hy - 12);
      tri(ctx, hx + 2, hy - 18, hx + 14, hy - 26, hx + 14, hy - 12);
      circle(ctx, hx, hy - 18, 3.5);
      ctx.strokeStyle = '#343a40';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, hy, 18, Math.PI * 1.15, Math.PI * 1.85);
      ctx.moveTo(hx + 16, hy + 2);
      ctx.quadraticCurveTo(hx + 18, hy + 10, hx + 12, hy + 11);
      ctx.stroke();
      ctx.fillStyle = '#343a40';
      circle(ctx, hx + 12, hy + 11, 2);
      ctx.fillStyle = `rgba(255, 243, 176, ${0.5 + Math.sin(time * 6) * 0.5})`;
      star(ctx, hx + 22, hy - 20, 4);
      break;
  }
}

// ---------- Воительницы ----------
function drawGirlEnemy(ctx, e, time, battle) {
  const look = lookFor(e, battle.state.stage);
  ctx.save();
  ctx.translate(e.x + e.lunge * 6 * e.facing, e.y);
  if (e.facing > 0) ctx.scale(-1, 1); // героиня нарисована лицом влево
  drawGirl(ctx, look, { H: e.height, phase: e.phase, lunge: e.lunge, walking: e.lunge <= 0, flash: e.flash, time, enraged: e.enraged });
  ctx.restore();
  if (e.heroine?.key === 'emilia') drawPuck(ctx, e.x - e.size * 1.6 * e.facing, e.y - e.height * 0.9, 7, time);
  if (e.shield > 0) {
    ctx.strokeStyle = `rgba(125, 211, 252, ${0.6 + Math.sin(time * 12) * 0.3})`;
    ctx.fillStyle = 'rgba(125, 211, 252, 0.15)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y - e.height * 0.5, e.height * 0.42, e.height * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  if (!e.isBoss && e.hp < e.maxHp) {
    bar(ctx, e.x - 12, e.y - e.height - 6, 24, 3, e.hp / e.maxHp, '#ef4444', '#450a0a');
  }
}

function drawOrbs(ctx, orbs, time) {
  for (const o of orbs) {
    if (o.wind) {
      // ветряное лезвие — зелёный полумесяц
      ctx.strokeStyle = 'rgba(150, 242, 215, 0.9)';
      ctx.lineWidth = 3;
      const a = Math.atan2(o.vy, o.vx);
      ctx.beginPath();
      ctx.arc(o.x - Math.cos(a) * 6, o.y - Math.sin(a) * 6, 9, a - 0.8, a + 0.8);
      ctx.stroke();
      continue;
    }
    const g = ctx.createRadialGradient(o.x, o.y, 1, o.x, o.y, 11);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, '#c4b5fd');
    g.addColorStop(1, 'rgba(124, 58, 237, 0)');
    ctx.fillStyle = g;
    circle(ctx, o.x, o.y, 11 + Math.sin(time * 15) * 1.5);
  }
}

// ---------- Враги ----------
// Золотая мышь — единственный зверь среди врагов: котики не могут пройти мимо.
function drawEnemy(ctx, e, time) {
  const s = e.size;
  const step = Math.sin(e.phase);
  ctx.save();
  ctx.translate(e.x - e.lunge * 10, e.y);
  if (e.facing > 0) ctx.scale(-1, 1); // мышь нарисована мордой влево

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 2, s * 1.1, s * 0.25, 0, 0, TAU);
  ctx.fill();

  const body = e.flash > 0 ? '#ffffff' : '#ffd34d';
  const dark = e.flash > 0 ? '#ffdddd' : '#d9a300';

  ctx.strokeStyle = '#e7a4a4';
  ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s * 0.8, -s * 0.5);
  ctx.quadraticCurveTo(s * 1.5, -s * 0.5 + step * 4, s * 1.6, -s * 0.2);
  ctx.stroke();

  ctx.fillStyle = dark;
  ctx.fillRect(-s * 0.5 + step * 3, -s * 0.25, s * 0.25, s * 0.3);
  ctx.fillRect(s * 0.35 - step * 3, -s * 0.25, s * 0.25, s * 0.3);

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.55, s, s * 0.55, 0, 0, TAU);
  ctx.fill();

  const hx = -s * 0.85;
  const hy = -s * 0.85;
  ctx.fillStyle = '#fff0a8';
  circle(ctx, hx + s * 0.15, hy - s * 0.45, s * 0.3);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(hx, hy, s * 0.55, s * 0.4, 0.15, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ff8fab';
  circle(ctx, hx - s * 0.55, hy + s * 0.05, s * 0.1);
  ctx.fillStyle = '#222';
  circle(ctx, hx - s * 0.2, hy - s * 0.1, Math.max(2, s * 0.09));
  ctx.restore();

  ctx.fillStyle = `rgba(255,255,200,${0.5 + Math.sin(time * 12) * 0.5})`;
  star(ctx, e.x + Math.sin(time * 5) * s, e.y - s * 1.4, 4);
  if (e.hp < e.maxHp) bar(ctx, e.x - s, e.y - s * 1.55, s * 2, 4, e.hp / e.maxHp, '#ef4444', '#450a0a');
}

// ---------- Препятствия ----------
function drawObstacle(ctx, e, time, biome) {
  const s = e.size;
  const shake = e.flash > 0 ? Math.sin(time * 80) * 2 * e.flash : 0;
  const dmg = 1 - e.hp / e.maxHp;
  ctx.save();
  ctx.translate(e.x + shake, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 2, s * 1.1, s * 0.22, 0, 0, TAU);
  ctx.fill();

  if (e.type === 'tree') {
    ctx.fillStyle = e.flash > 0 ? '#a37a55' : '#7a5230';
    ctx.fillRect(-s * 0.2, -s * 1.3, s * 0.4, s * 1.3);
    const leaves = e.flash > 0 ? '#9be08a' : biome.tree;
    ctx.fillStyle = leaves;
    circle(ctx, 0, -s * 1.7, s * 0.85);
    circle(ctx, -s * 0.6, -s * 1.3, s * 0.6);
    circle(ctx, s * 0.6, -s * 1.3, s * 0.6);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    circle(ctx, -s * 0.25, -s * 1.95, s * 0.3);
    if (dmg > 0.4) {
      ctx.strokeStyle = '#3d2a17';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, -s * 0.5);
      ctx.lineTo(0, -s * 0.65);
      ctx.lineTo(s * 0.2, -s * 0.5);
      ctx.stroke();
    }
  } else if (e.type === 'rock') {
    ctx.fillStyle = e.flash > 0 ? '#c7ccd1' : '#8d939a';
    ctx.beginPath();
    ctx.moveTo(-s * 1.1, 0);
    ctx.lineTo(-s * 0.9, -s * 0.9);
    ctx.lineTo(-s * 0.2, -s * 1.35);
    ctx.lineTo(s * 0.7, -s * 1.05);
    ctx.lineTo(s * 1.1, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    tri(ctx, -s * 0.8, -s * 0.85, -s * 0.2, -s * 1.3, -s * 0.3, -s * 0.7);
    ctx.strokeStyle = '#4b5056';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (dmg > 0.25) { ctx.moveTo(-s * 0.2, -s * 1.3); ctx.lineTo(-s * 0.05, -s * 0.8); ctx.lineTo(-s * 0.3, -s * 0.4); }
    if (dmg > 0.6) { ctx.moveTo(s * 0.6, -s * 1); ctx.lineTo(s * 0.3, -s * 0.5); ctx.lineTo(s * 0.5, 0); }
    ctx.stroke();
  } else if (e.type === 'crate') {
    const w = s * 1.7;
    ctx.fillStyle = e.flash > 0 ? '#e0a96b' : '#c8894a';
    ctx.fillRect(-w / 2, -w, w, w);
    ctx.strokeStyle = '#7a4b25';
    ctx.lineWidth = 3;
    ctx.strokeRect(-w / 2 + 1.5, -w + 1.5, w - 3, w - 3);
    ctx.beginPath();
    ctx.moveTo(-w / 2, -w);
    ctx.lineTo(w / 2, 0);
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.font = `800 ${Math.round(s * 0.9)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, -w / 2);
  }
  ctx.restore();
  if (e.hp < e.maxHp) bar(ctx, e.x - s, e.y - s * (e.type === 'tree' ? 2.75 : 1.75), s * 2, 4, e.hp / e.maxHp, '#f59e0b', '#451a03');
}

// ---------- Пули и эффекты ----------
function drawBullets(ctx, bullets) {
  for (const b of bullets) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    ctx.fillStyle = b.crit ? '#ff4d6d' : b.color;
    if (b.family === 'sniper') {
      ctx.fillRect(-14, -1.5, 22, 3);
    } else if (b.family === 'minigun' || b.family === 'smg') {
      ctx.fillRect(-5, -1.5, 9, 3);
    } else if (b.family === 'shotgun') {
      circle(ctx, 0, 0, 3);
    } else {
      // пуля-рыбка
      ctx.beginPath();
      ctx.ellipse(0, 0, b.crit ? 8 : 6, b.crit ? 4 : 3, 0, 0, TAU);
      ctx.fill();
      tri(ctx, -5, 0, -11, -4, -11, 4);
    }
    ctx.restore();
  }
}

function drawParticles(ctx, particles) {
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.color;
    if (p.star) {
      star(ctx, p.x, p.y, p.size);
    } else {
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;
}

function drawTexts(ctx, texts) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, t.life * 2);
    ctx.font = `800 ${t.size}px system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

// ---------- Примитивы ----------
function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function tri(ctx, x1, y1, x2, y2, x3, y3) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fill();
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const rr = i % 2 ? r * 0.35 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function bar(ctx, x, y, w, h, frac, fg, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
