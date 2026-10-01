// Процедурная отрисовка: фон биома с параллаксом, отряд котиков, оружие, враги, препятствия, эффекты.
import { WORLD, SQUAD } from './battle.js';
import { biomeFor } from './formulas.js';
import { CATS } from './config.js';

const TAU = Math.PI * 2;

// Декор генерируется один раз детерминированно, чтобы не мерцал.
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const rnd = seeded(42);
const STARS = Array.from({ length: 70 }, () => ({ x: rnd() * WORLD.width, y: rnd() * WORLD.groundY * 0.8, r: rnd() * 1.4 + 0.4, t: rnd() * TAU }));
const BUILDINGS = Array.from({ length: 14 }, (_, i) => ({ x: i * 42, w: 34 + rnd() * 14, h: 70 + rnd() * 110, win: rnd() }));
const CLOUDS = Array.from({ length: 4 }, () => ({ x: rnd() * WORLD.width, y: 30 + rnd() * 80, s: 0.7 + rnd() * 0.6 }));
const SNOW = Array.from({ length: 50 }, () => ({ x: rnd() * WORLD.width, y: rnd() * WORLD.height, s: 0.6 + rnd() * 1.6, v: 15 + rnd() * 25 }));

// Повторяющийся по горизонтали элемент с параллаксом.
const wrap = (x, offset, span) => ((((x - offset) % span) + span) % span) - 60;

export function render(ctx, battle, time) {
  const { width: W, height: H } = WORLD;
  const biome = biomeFor(battle.state.stage);
  ctx.save();
  if (battle.shake > 0) {
    ctx.translate((Math.random() - 0.5) * battle.shake, (Math.random() - 0.5) * battle.shake);
  }
  drawBackground(ctx, biome, battle.scroll, time);
  // сначала дальние препятствия, затем враги поверх
  const sorted = [...battle.enemies].sort((a, b) => (a.obstacle === b.obstacle ? b.x - a.x : a.obstacle ? -1 : 1));
  for (const e of sorted) (e.obstacle ? drawObstacle : drawEnemy)(ctx, e, time, biome);
  drawSquad(ctx, battle, time);
  drawBullets(ctx, battle.bullets);
  drawParticles(ctx, battle.particles);
  drawTexts(ctx, battle.texts);
  ctx.restore();

  if (battle.buffs.rage > 0) {
    ctx.fillStyle = `rgba(255, 60, 60, ${0.08 + Math.sin(time * 8) * 0.04})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (battle.hero.hurt > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, 'rgba(255,0,0,0)');
    g.addColorStop(1, `rgba(255,0,0,${battle.hero.hurt * 0.35})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

// ---------- Фон ----------
function drawBackground(ctx, biome, scroll, time) {
  const { width: W, height: H, groundY } = WORLD;
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, biome.sky[0]);
  sky.addColorStop(1, biome.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, W + 40, groundY + 20);

  switch (biome.decor) {
    case 'garden': drawForest(ctx, scroll, time); break;
    case 'desert': drawDesert(ctx, scroll); break;
    case 'snow': drawSnow(ctx, scroll, time); break;
    case 'city': drawCity(ctx, scroll); break;
    case 'roofs': drawRoofs(ctx, scroll, time); break;
    case 'space': drawSpace(ctx, scroll, time); break;
  }

  ctx.fillStyle = biome.ground;
  ctx.fillRect(-20, groundY, W + 40, H - groundY + 20);
  ctx.fillStyle = biome.groundDark;
  ctx.fillRect(-20, groundY, W + 40, 6);
  // полосы на земле едут вместе с отрядом — так видно движение
  for (let i = 0; i < 20; i++) {
    const x = wrap(i * 28, scroll, 20 * 28);
    ctx.fillRect(x, groundY + 22 + (i % 2) * 14, 14, 4);
  }
}

function hills(ctx, color, offset, baseY, amp, period) {
  const { width: W, groundY } = WORLD;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-20, groundY);
  for (let x = -20; x <= W + 20; x += 10) {
    ctx.lineTo(x, baseY - Math.sin((x + offset) / period) * amp - Math.sin((x + offset) / (period * 0.37)) * amp * 0.3);
  }
  ctx.lineTo(W + 20, groundY);
  ctx.fill();
}

function drawClouds(ctx, scroll, time) {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const c of CLOUDS) cloud(ctx, wrap(c.x, scroll * 0.1 + time * 6, WORLD.width + 160), c.y, c.s);
}

function drawForest(ctx, scroll, time) {
  const { width: W, groundY } = WORLD;
  ctx.fillStyle = '#fff3a0';
  circle(ctx, W - 70, 56, 24);
  drawClouds(ctx, scroll, time);
  hills(ctx, '#9fd68a', scroll * 0.2, groundY - 70, 18, 70);
  for (let i = 0; i < 9; i++) {
    const x = wrap(i * 70 + 20, scroll * 0.45, 9 * 70);
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(x - 3, groundY - 40, 6, 40);
    ctx.fillStyle = i % 2 ? '#4f9d3f' : '#5aae48';
    tri(ctx, x - 22, groundY - 30, x + 22, groundY - 30, x, groundY - 92);
    tri(ctx, x - 18, groundY - 55, x + 18, groundY - 55, x, groundY - 108);
  }
}

function drawDesert(ctx, scroll) {
  const { width: W, groundY } = WORLD;
  ctx.fillStyle = '#fff1b5';
  circle(ctx, W - 80, 60, 30);
  hills(ctx, '#f0c987', scroll * 0.15, groundY - 60, 22, 90);
  hills(ctx, '#e8b56b', scroll * 0.35, groundY - 28, 14, 60);
  for (let i = 0; i < 5; i++) {
    const x = wrap(i * 130 + 50, scroll * 0.5, 5 * 130);
    ctx.fillStyle = '#4f9a52';
    roundRect(ctx, x - 6, groundY - 54, 12, 54, 6);
    roundRect(ctx, x - 20, groundY - 40, 10, 22, 5);
    roundRect(ctx, x - 20, groundY - 26, 18, 8, 4);
    roundRect(ctx, x + 10, groundY - 46, 10, 20, 5);
    roundRect(ctx, x + 2, groundY - 32, 18, 8, 4);
  }
}

function drawSnow(ctx, scroll, time) {
  const { width: W, height: H, groundY } = WORLD;
  // горы
  for (const [color, off, h, span] of [['#b5c8e0', 0.12, 150, 200], ['#d7e3f2', 0.3, 100, 140]]) {
    for (let i = 0; i < 6; i++) {
      const x = wrap(i * span, scroll * off, 6 * span);
      ctx.fillStyle = color;
      tri(ctx, x - span * 0.6, groundY, x + span * 0.6, groundY, x, groundY - h);
      ctx.fillStyle = '#ffffff';
      tri(ctx, x - span * 0.14, groundY - h * 0.77, x + span * 0.14, groundY - h * 0.77, x, groundY - h);
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const f of SNOW) {
    const x = wrap(f.x + Math.sin(time + f.v) * 10, scroll * 0.6, W + 120);
    const y = (f.y + time * f.v) % H;
    circle(ctx, x, y, f.s);
  }
}

function drawCity(ctx, scroll) {
  const { groundY } = WORLD;
  const span = BUILDINGS.length * 42;
  for (const b of BUILDINGS) {
    const x = wrap(b.x, scroll * 0.35, span);
    ctx.fillStyle = '#c47a5a';
    ctx.fillRect(x, groundY - b.h, b.w, b.h);
    ctx.fillStyle = 'rgba(255,240,200,0.6)';
    for (let y = groundY - b.h + 10; y < groundY - 14; y += 18) {
      for (let wx = 6; wx < b.w - 8; wx += 12) {
        if ((wx * 7 + y * 3 + b.win * 100) % 5 > 1.5) ctx.fillRect(x + wx, y, 6, 8);
      }
    }
  }
}

function drawRoofs(ctx, scroll, time) {
  const { width: W, groundY } = WORLD;
  for (const s of STARS) {
    ctx.fillStyle = `rgba(255,255,255,${0.5 + Math.sin(time * 2 + s.t) * 0.4})`;
    circle(ctx, s.x, s.y, s.r);
  }
  ctx.fillStyle = 'rgba(253,246,195,0.15)';
  circle(ctx, W - 80, 70, 42);
  ctx.fillStyle = '#fdf6c3';
  circle(ctx, W - 80, 70, 28);
  ctx.fillStyle = 'rgba(200,190,140,0.5)';
  circle(ctx, W - 88, 62, 6);
  circle(ctx, W - 72, 80, 4);
  ctx.fillStyle = '#2a1f3d';
  for (let i = 0; i < 8; i++) {
    const x = wrap(i * 90, scroll * 0.4, 8 * 90);
    tri(ctx, x, groundY, x + 90, groundY, x + 45, groundY - 60);
    ctx.fillRect(x + 56, groundY - 70, 12, 40);
  }
}

function drawSpace(ctx, scroll, time) {
  const { width: W } = WORLD;
  for (const s of STARS) {
    ctx.fillStyle = `rgba(255,255,255,${0.6 + Math.sin(time * 3 + s.t) * 0.4})`;
    circle(ctx, wrap(s.x, scroll * 0.05, W + 120), s.y, s.r);
  }
  ctx.fillStyle = '#ff9f68';
  circle(ctx, W - 90, 90, 36);
  ctx.strokeStyle = 'rgba(255,220,180,0.7)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(W - 90, 90, 58, 12, -0.3, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = '#8ecae6';
  circle(ctx, 80, 60, 12);
  for (let i = 0; i < 6; i++) {
    const x = wrap(i * 110, scroll * 0.5, 6 * 110);
    ctx.fillStyle = '#4a4d66';
    ctx.beginPath();
    ctx.ellipse(x, WORLD.groundY, 30, 10, 0, Math.PI, TAU);
    ctx.fill();
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
function drawSquad(ctx, battle, time) {
  const squad = battle.squad;
  for (let i = SQUAD.length - 1; i >= 0; i--) {
    const cat = squad.cats[i];
    if (!cat) continue;
    drawCat(ctx, SQUAD[i], CATS[i], cat.gun, battle.cats[i], battle, time + i * 0.7);
  }
  const front = squad.cats.findIndex(Boolean);
  const x = SQUAD[Math.max(0, front)].x;
  bar(ctx, x - 30, WORLD.groundY + 12, 60, 7, battle.hero.hp / squad.maxHp, '#4ade80', '#14532d');
}

function drawCat(ctx, pos, def, gun, cs, battle, time) {
  const walking = battle.walking;
  const bob = walking ? Math.abs(Math.sin(time * 9)) * -3 : Math.sin(time * 4) * 1.5;
  const rage = battle.buffs.rage > 0;
  const fur = rage ? '#ff7b54' : def.fur;
  const furDark = rage ? '#d9483b' : def.furDark;

  ctx.save();
  ctx.translate(pos.x, WORLD.groundY + pos.y);
  ctx.scale(pos.scale, pos.scale);

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 26, 5, 0, 0, TAU);
  ctx.fill();

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
  ctx.fillStyle = def.band;
  ctx.fillRect(hx - 16, hy - 12, 32, 5);
  tri(ctx, hx - 16, hy - 12, hx - 25, hy - 16 + Math.sin(time * 6) * 2, hx - 23, hy - 6);

  // оружие
  ctx.save();
  ctx.translate(30, -32 - bob);
  ctx.rotate(Math.max(-0.6, Math.min(0.4, cs.aim)));
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

// ---------- Враги ----------
const ENEMY_STYLE = {
  mouse: { body: '#a8a8b3', dark: '#7d7d8a', ear: '#ffc2d1' },
  goldMouse: { body: '#ffd34d', dark: '#d9a300', ear: '#fff0a8' },
  rat:   { body: '#8b6b52', dark: '#6b4f3a', ear: '#e7a4a4' },
  dog:   { body: '#d6a76b', dark: '#a77b45', ear: '#8a5a2b' },
  boss:  { body: '#7b4fa0', dark: '#55357a', ear: '#3d2257' },
};

function drawEnemy(ctx, e, time) {
  const st = ENEMY_STYLE[e.type];
  const s = e.size;
  const step = Math.sin(e.phase);
  ctx.save();
  ctx.translate(e.x - e.lunge * 10, e.y);
  if (e.fleeing) ctx.scale(-1, 1); // убегающая мышь разворачивается

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 2, s * 1.1, s * 0.25, 0, 0, TAU);
  ctx.fill();

  const body = e.flash > 0 ? '#ffffff' : st.body;
  const dark = e.flash > 0 ? '#ffdddd' : st.dark;
  const rodent = e.type === 'mouse' || e.type === 'rat' || e.type === 'goldMouse';

  ctx.strokeStyle = rodent ? '#e7a4a4' : dark;
  ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s * 0.8, -s * 0.5);
  ctx.quadraticCurveTo(s * 1.5, -s * 0.5 + step * 4, s * 1.6, -s * (rodent ? 0.2 : 1.2));
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
  if (!rodent) {
    ctx.fillStyle = body;
    circle(ctx, hx, hy, s * 0.5);
    ctx.fillStyle = dark;
    roundRect(ctx, hx - s * 0.7, hy - s * 0.05, s * 0.45, s * 0.35, s * 0.12);
    ctx.fillStyle = st.ear;
    ctx.beginPath();
    ctx.ellipse(hx + s * 0.25, hy - s * 0.05, s * 0.16, s * 0.38, 0.4 + step * 0.1, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#222';
    circle(ctx, hx - s * 0.7, hy, s * 0.08);
  } else {
    ctx.fillStyle = st.ear;
    circle(ctx, hx + s * 0.15, hy - s * 0.45, s * 0.3);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(hx, hy, s * 0.55, s * 0.4, 0.15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ff8fab';
    circle(ctx, hx - s * 0.55, hy + s * 0.05, s * 0.1);
    ctx.strokeStyle = 'rgba(40,40,40,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx - s * 0.45, hy + s * 0.05);
    ctx.lineTo(hx - s * 0.85, hy - s * 0.05);
    ctx.moveTo(hx - s * 0.45, hy + s * 0.1);
    ctx.lineTo(hx - s * 0.85, hy + s * 0.2);
    ctx.stroke();
  }
  ctx.fillStyle = e.isBoss ? '#ff3b3b' : '#222';
  circle(ctx, hx - s * 0.2, hy - s * 0.1, Math.max(2, s * 0.09));
  if (e.type !== 'goldMouse') {
    ctx.strokeStyle = '#222';
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(hx - s * 0.35, hy - s * 0.3);
    ctx.lineTo(hx - s * 0.05, hy - s * 0.2);
    ctx.stroke();
  }

  if (e.isBoss) {
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    const cx = hx;
    const cy = hy - s * 0.5;
    ctx.moveTo(cx - s * 0.35, cy);
    ctx.lineTo(cx - s * 0.35, cy - s * 0.3);
    ctx.lineTo(cx - s * 0.18, cy - s * 0.15);
    ctx.lineTo(cx, cy - s * 0.38);
    ctx.lineTo(cx + s * 0.18, cy - s * 0.15);
    ctx.lineTo(cx + s * 0.35, cy - s * 0.3);
    ctx.lineTo(cx + s * 0.35, cy);
    ctx.fill();
    ctx.fillStyle = '#e63946';
    circle(ctx, cx, cy - s * 0.1, s * 0.06);
  }
  ctx.restore();

  if (e.type === 'goldMouse') {
    ctx.fillStyle = `rgba(255,255,200,${0.5 + Math.sin(time * 12) * 0.5})`;
    star(ctx, e.x + Math.sin(time * 5) * s, e.y - s * 1.4, 4);
  }
  if (!e.isBoss && e.hp < e.maxHp) {
    bar(ctx, e.x - s, e.y - s * 1.55 - (e.type === 'dog' ? 6 : 0), s * 2, 4, e.hp / e.maxHp, '#ef4444', '#450a0a');
  }
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
    if (p.coin) {
      circle(ctx, p.x, p.y, p.size);
      ctx.fillStyle = '#b8860b';
      circle(ctx, p.x, p.y, p.size * 0.45);
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

function cloud(ctx, x, y, s) {
  circle(ctx, x, y, 14 * s);
  circle(ctx, x + 16 * s, y - 6 * s, 18 * s);
  circle(ctx, x + 34 * s, y, 14 * s);
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
