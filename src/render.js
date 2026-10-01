// Процедурная отрисовка: фон биома, котик-стрелок, враги, пули, эффекты.
import { WORLD } from './battle.js';
import { biomeFor } from './formulas.js';

const TAU = Math.PI * 2;

// Звёзды и декор генерируются один раз детерминированно, чтобы не мерцали.
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const rnd = seeded(42);
const STARS = Array.from({ length: 70 }, () => ({ x: rnd() * WORLD.width, y: rnd() * WORLD.groundY * 0.8, r: rnd() * 1.4 + 0.4, t: rnd() * TAU }));
const BUILDINGS = Array.from({ length: 12 }, (_, i) => ({ x: i * 42 - 10, w: 34 + rnd() * 14, h: 70 + rnd() * 120, win: rnd() }));
const CLOUDS = Array.from({ length: 4 }, () => ({ x: rnd() * WORLD.width, y: 30 + rnd() * 90, s: 0.7 + rnd() * 0.6, v: 4 + rnd() * 6 }));

export function render(ctx, battle, time) {
  const { width: W, height: H } = WORLD;
  ctx.save();
  if (battle.shake > 0) {
    ctx.translate((Math.random() - 0.5) * battle.shake, (Math.random() - 0.5) * battle.shake);
  }
  drawBackground(ctx, biomeFor(battle.state.stage), time);
  for (const e of battle.enemies) drawEnemy(ctx, e, time);
  drawCat(ctx, battle, time);
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
function drawBackground(ctx, biome, time) {
  const { width: W, height: H, groundY } = WORLD;
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, biome.sky[0]);
  sky.addColorStop(1, biome.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, W + 40, groundY + 20);

  switch (biome.decor) {
    case 'garden': drawGarden(ctx, time); break;
    case 'city': drawCity(ctx); break;
    case 'roofs': drawRoofs(ctx, time); break;
    case 'space': drawSpace(ctx, time); break;
  }

  ctx.fillStyle = biome.ground;
  ctx.fillRect(-20, groundY, W + 40, H - groundY + 20);
  ctx.fillStyle = biome.groundDark;
  ctx.fillRect(-20, groundY, W + 40, 6);
  for (let x = -10; x < W + 20; x += 28) {
    ctx.fillRect(x, groundY + 22 + ((x / 28) % 2) * 14, 14, 4);
  }
}

function drawGarden(ctx, time) {
  const { width: W, groundY } = WORLD;
  ctx.fillStyle = '#fff3a0';
  circle(ctx, W - 70, 60, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const c of CLOUDS) {
    const x = ((c.x + time * c.v) % (W + 120)) - 60;
    cloud(ctx, x, c.y, c.s);
  }
  ctx.fillStyle = '#e8c48a';
  for (let x = 0; x < W; x += 26) ctx.fillRect(x, groundY - 46, 16, 46);
  ctx.fillRect(0, groundY - 36, W, 6);
  ctx.fillRect(0, groundY - 16, W, 6);
  ctx.fillStyle = '#58a63b';
  for (let x = 20; x < W; x += 110) {
    circle(ctx, x, groundY - 8, 22);
    circle(ctx, x + 22, groundY - 14, 18);
  }
}

function drawCity(ctx) {
  const { groundY } = WORLD;
  for (const b of BUILDINGS) {
    ctx.fillStyle = '#c47a5a';
    ctx.fillRect(b.x, groundY - b.h, b.w, b.h);
    ctx.fillStyle = 'rgba(255,240,200,0.6)';
    for (let y = groundY - b.h + 10; y < groundY - 14; y += 18) {
      for (let x = b.x + 6; x < b.x + b.w - 8; x += 12) {
        if ((x * 7 + y * 3 + b.win * 100) % 5 > 1.5) ctx.fillRect(x, y, 6, 8);
      }
    }
  }
}

function drawRoofs(ctx, time) {
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
  for (let x = -10; x < W; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x + 45, groundY - 60);
    ctx.lineTo(x + 90, groundY);
    ctx.fill();
    ctx.fillRect(x + 56, groundY - 70, 12, 40);
  }
}

function drawSpace(ctx, time) {
  const { width: W } = WORLD;
  for (const s of STARS) {
    ctx.fillStyle = `rgba(255,255,255,${0.6 + Math.sin(time * 3 + s.t) * 0.4})`;
    circle(ctx, s.x, s.y, s.r);
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
}

// ---------- Котик ----------
function drawCat(ctx, battle, time) {
  const { heroX: x, groundY: y } = WORLD;
  const hero = battle.hero;
  const bob = Math.sin(time * 4) * 1.5;
  const rage = battle.buffs.rage > 0;
  const fur = rage ? '#ff7b54' : '#f4a442';
  const furDark = rage ? '#d9483b' : '#d9822b';

  ctx.save();
  ctx.translate(x, y);

  // тень
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 30, 6, 0, 0, TAU);
  ctx.fill();

  // хвост
  ctx.strokeStyle = furDark;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-18, -14);
  ctx.quadraticCurveTo(-42, -20 + Math.sin(time * 3) * 6, -34, -46 + Math.sin(time * 3 + 1) * 6);
  ctx.stroke();

  // тело
  ctx.translate(0, bob);
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, -20, 22, 18, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fff1dc';
  ctx.beginPath();
  ctx.ellipse(6, -16, 11, 12, 0, 0, TAU);
  ctx.fill();
  // лапы
  ctx.fillStyle = furDark;
  ctx.fillRect(-14, -6, 9, 8);
  ctx.fillRect(6, -6, 9, 8);

  // голова
  const hx = 8;
  const hy = -48;
  ctx.fillStyle = fur;
  tri(ctx, hx - 16, hy - 6, hx - 12, hy - 26, hx - 2, hy - 12);
  tri(ctx, hx + 16, hy - 6, hx + 12, hy - 26, hx + 2, hy - 12);
  ctx.fillStyle = '#ffb3c1';
  tri(ctx, hx - 13, hy - 9, hx - 11, hy - 20, hx - 5, hy - 12);
  tri(ctx, hx + 13, hy - 9, hx + 11, hy - 20, hx + 5, hy - 12);
  ctx.fillStyle = fur;
  circle(ctx, hx, hy, 18);
  // полоски
  ctx.strokeStyle = furDark;
  ctx.lineWidth = 2.5;
  for (const dx of [-5, 0, 5]) {
    ctx.beginPath();
    ctx.moveTo(hx + dx, hy - 17);
    ctx.lineTo(hx + dx, hy - 10);
    ctx.stroke();
  }
  // глаза (моргают)
  const blink = time % 4 < 0.12;
  ctx.fillStyle = '#222';
  if (blink || hero.hurt > 0.5) {
    ctx.fillRect(hx - 1, hy - 1, 7, 2);
    ctx.fillRect(hx + 9, hy - 1, 7, 2);
  } else {
    circle(ctx, hx + 3, hy, 3.5);
    circle(ctx, hx + 12, hy, 3.5);
    ctx.fillStyle = '#fff';
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
  // нос и усы
  ctx.fillStyle = '#ff6f91';
  tri(ctx, hx + 6, hy + 5, hx + 10, hy + 5, hx + 8, hy + 8);
  ctx.strokeStyle = 'rgba(60,40,20,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const dy of [5, 9]) {
    ctx.moveTo(hx + 14, hy + 6);
    ctx.lineTo(hx + 26, hy + dy - 2);
    ctx.moveTo(hx + 2, hy + 6);
    ctx.lineTo(hx - 10, hy + dy - 2);
  }
  ctx.stroke();
  // бандана
  ctx.fillStyle = '#e63946';
  ctx.fillRect(hx - 17, hy - 12, 34, 5);
  tri(ctx, hx - 17, hy - 12, hx - 26, hy - 16 + Math.sin(time * 6) * 2, hx - 24, hy - 6);

  // пушка: поворачивается к цели, отдача при выстреле
  ctx.save();
  ctx.translate(34, -34 - bob);
  ctx.rotate(Math.max(-0.6, Math.min(0.4, hero.aim)));
  ctx.translate(-hero.recoil * 4, 0);
  ctx.fillStyle = '#3d405b';
  roundRect(ctx, -14, -6, 30, 12, 3);
  ctx.fillStyle = '#5c6185';
  ctx.fillRect(14, -4, 10, 8);
  ctx.fillStyle = '#2b2d42';
  ctx.fillRect(-8, 4, 7, 9);
  ctx.fillStyle = fur;
  circle(ctx, -10, 4, 5);
  if (hero.recoil > 0.6) {
    ctx.fillStyle = battle.buffs.volley > 0 ? '#4cc9f0' : '#ffd166';
    tri(ctx, 24, -7, 24, 7, 38 + Math.random() * 6, 0);
  }
  ctx.restore();

  ctx.restore();

  // полоска здоровья котика
  const stats = battle.stats;
  bar(ctx, x - 30, y + 12, 60, 7, hero.hp / stats.maxHp, '#4ade80', '#14532d');
}

// ---------- Враги ----------
const ENEMY_STYLE = {
  mouse: { body: '#a8a8b3', dark: '#7d7d8a', ear: '#ffc2d1' },
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

  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 2, s * 1.1, s * 0.25, 0, 0, TAU);
  ctx.fill();

  const body = e.flash > 0 ? '#ffffff' : st.body;
  const dark = e.flash > 0 ? '#ffdddd' : st.dark;

  // хвост
  ctx.strokeStyle = e.type === 'mouse' || e.type === 'rat' ? '#e7a4a4' : dark;
  ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s * 0.8, -s * 0.5);
  ctx.quadraticCurveTo(s * 1.5, -s * 0.5 + step * 4, s * 1.6, -s * (e.type === 'dog' || e.isBoss ? 1.2 : 0.2));
  ctx.stroke();

  // лапы
  ctx.fillStyle = dark;
  ctx.fillRect(-s * 0.5 + step * 3, -s * 0.25, s * 0.25, s * 0.3);
  ctx.fillRect(s * 0.35 - step * 3, -s * 0.25, s * 0.25, s * 0.3);

  // тело
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.55, s, s * 0.55, 0, 0, TAU);
  ctx.fill();

  // голова (смотрит влево)
  const hx = -s * 0.85;
  const hy = -s * 0.85;
  if (e.type === 'dog' || e.isBoss) {
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
  // злые глаза
  ctx.fillStyle = e.isBoss ? '#ff3b3b' : '#222';
  circle(ctx, hx - s * 0.2, hy - s * 0.1, Math.max(2, s * 0.09));
  ctx.strokeStyle = '#222';
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(hx - s * 0.35, hy - s * 0.3);
  ctx.lineTo(hx - s * 0.05, hy - s * 0.2);
  ctx.stroke();

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

  if (!e.isBoss && e.hp < e.maxHp) {
    bar(ctx, e.x - s, e.y - s * 1.55 - (e.type === 'dog' ? 6 : 0), s * 2, 4, e.hp / e.maxHp, '#ef4444', '#450a0a');
  }
}

// ---------- Пули и эффекты ----------
function drawBullets(ctx, bullets) {
  for (const b of bullets) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    // пуля в виде рыбки
    ctx.fillStyle = b.crit ? '#ff4d6d' : '#4cc9f0';
    ctx.beginPath();
    ctx.ellipse(0, 0, b.crit ? 8 : 6, b.crit ? 4 : 3, 0, 0, TAU);
    ctx.fill();
    tri(ctx, -5, 0, -11, -4, -11, 4);
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
