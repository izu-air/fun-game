// Процедурная отрисовка воительниц Звёздной Академии в чиби-стиле.
// Начало координат — у ног, героиня смотрит влево (на отряд котиков).
import { HEROINES } from './story.js';

const TAU = Math.PI * 2;
const SKIN = '#ffe3d3';
const SKIN_SHADE = '#f6c7b4';

// Облик рядовых воительниц; цвет волос выбирается по variant, чтобы толпа была разноцветной.
const LOOKS = {
  ninja: { hairs: ['#25262b', '#5c3d2e', '#862e9c'], style: 'pony', outfit: '#2b2f4a', skirt: '#2b2f4a', accent: '#e03131', weapon: 'kunai', mask: true, eyes: '#e8590c' },
  sword: { hairs: ['#ff9ec7', '#ffd43b', '#74c0fc', '#ff8787'], style: 'twin', outfit: '#ffffff', skirt: '#c92a2a', accent: '#c92a2a', weapon: 'katana', eyes: '#1971c2' },
  knight: { hairs: ['#dee2e6', '#ffd8a8', '#b197fc'], style: 'bob', outfit: '#adb5bd', skirt: '#868e96', accent: '#495057', weapon: 'hammer', armor: true, eyes: '#2f9e44' },
  mage: { hairs: ['#b197fc', '#f783ac', '#63e6be'], style: 'long', outfit: '#5f3dc4', skirt: '#5f3dc4', accent: '#ffd43b', weapon: 'staff', hat: true, eyes: '#ae3ec9' },
};

const darker = (hex, k = 0.75) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

// Облик конкретного врага (рядовая, капитан или героиня главы).
export function lookFor(enemy, stage) {
  if (enemy.heroine) return { ...enemy.heroine, skirt: enemy.heroine.outfit, heroineKey: enemy.heroine.key };
  if (enemy.type === 'boss') {
    // Капитан на 5-м этапе главы — рыцарша в цветах героини этой локации.
    const h = HEROINES[Math.floor((stage - 1) / 10) % HEROINES.length];
    return { ...LOOKS.knight, hair: h.hair, hairDark: h.hairDark, accent: h.accent, cape: h.accent, eyes: h.eyes };
  }
  const base = LOOKS[enemy.type];
  const hair = base.hairs[Math.floor(enemy.variant * base.hairs.length)];
  return { ...base, hair, hairDark: darker(hair) };
}

export function lookForHeroine(key) {
  const h = HEROINES.find((x) => x.key === key);
  return { ...h, skirt: h.outfit, heroineKey: h.key };
}

// opts: { H — высота, phase — фаза шага, lunge — 0..1 замах, walking, flash, time }
export function drawGirl(ctx, look, { H, phase = 0, lunge = 0, walking = true, flash = 0, time = 0, enraged = false }) {
  const r = H * 0.22; // радиус головы
  const hx = 0;
  const hy = -H + r * 1.05;
  const step = walking ? Math.sin(phase) : 0;
  const sway = Math.sin(time * 2 + phase) * H * 0.012;
  const hairDark = look.hairDark ?? darker(look.hair);

  ctx.save();
  if (flash > 0 && 'filter' in ctx) ctx.filter = `brightness(${1 + flash})`;

  // тень
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, 2, H * 0.24, H * 0.05, 0, 0, TAU);
  ctx.fill();

  // плащ капитана / мантия — за спиной
  if (look.cape || look.heroineKey === 'luna' || look.heroineKey === 'mikoto') {
    ctx.fillStyle = look.cape ?? (look.heroineKey === 'luna' ? '#3b3f9e' : '#3b2a8a');
    ctx.beginPath();
    ctx.moveTo(-H * 0.1, -H * 0.55);
    ctx.lineTo(H * 0.12, -H * 0.55);
    ctx.quadraticCurveTo(H * 0.3 + sway * 3, -H * 0.25, H * 0.24 + sway * 4, -H * 0.04);
    ctx.lineTo(-H * 0.02, -H * 0.06);
    ctx.closePath();
    ctx.fill();
  }

  drawBackHair(ctx, look, hx, hy, r, H, sway, hairDark);

  // ноги и сапоги
  ctx.fillStyle = SKIN_SHADE;
  ctx.fillRect(-H * 0.08 + step * H * 0.03, -H * 0.16, H * 0.06, H * 0.12);
  ctx.fillRect(H * 0.03 - step * H * 0.03, -H * 0.16, H * 0.06, H * 0.12);
  ctx.fillStyle = look.armor ? '#495057' : '#3d2b1f';
  roundRect(ctx, -H * 0.11 + step * H * 0.03, -H * 0.07, H * 0.1, H * 0.07, H * 0.02);
  roundRect(ctx, H * 0.01 - step * H * 0.03, -H * 0.07, H * 0.1, H * 0.07, H * 0.02);

  // юбка-хакама / мантия до колен и ниже
  ctx.fillStyle = look.skirt ?? look.outfit;
  ctx.beginPath();
  ctx.moveTo(-H * 0.12, -H * 0.42);
  ctx.lineTo(H * 0.12, -H * 0.42);
  const longDress = look.hat || look.maid || ['yuki', 'luna', 'emilia', 'echidna', 'beatrice'].includes(look.heroineKey);
  ctx.lineTo(H * 0.2, -H * (longDress ? 0.06 : 0.14));
  ctx.lineTo(-H * 0.2, -H * (longDress ? 0.06 : 0.14));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(-H * 0.01, -H * 0.4, H * 0.02, H * 0.3);

  // корпус
  ctx.fillStyle = look.outfit;
  roundRect(ctx, -H * 0.12, -H * 0.56, H * 0.24, H * 0.18, H * 0.05);
  if (look.armor) {
    ctx.fillStyle = '#ced4da';
    roundRect(ctx, -H * 0.1, -H * 0.54, H * 0.2, H * 0.12, H * 0.04);
    ctx.fillStyle = look.accent;
    circle(ctx, -H * 0.13, -H * 0.53, H * 0.05);
    circle(ctx, H * 0.13, -H * 0.53, H * 0.05);
  }
  // фартук горничной
  if (look.maid) {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, -H * 0.08, -H * 0.52, H * 0.16, H * 0.1, H * 0.02);
    ctx.beginPath();
    ctx.moveTo(-H * 0.1, -H * 0.42);
    ctx.lineTo(H * 0.1, -H * 0.42);
    ctx.lineTo(H * 0.13, -H * 0.1);
    ctx.lineTo(-H * 0.13, -H * 0.1);
    ctx.closePath();
    ctx.fill();
  }
  // пояс-оби / ремень
  ctx.fillStyle = look.accent;
  ctx.fillRect(-H * 0.125, -H * 0.43, H * 0.25, H * 0.04);
  if (look.bow) {
    ctx.fillStyle = look.accent;
    tri(ctx, 0, -H * 0.54, -H * 0.07, -H * 0.58, -H * 0.07, -H * 0.5);
    tri(ctx, 0, -H * 0.54, H * 0.07, -H * 0.58, H * 0.07, -H * 0.5);
  }
  if (look.scarf) {
    ctx.fillStyle = look.accent;
    roundRect(ctx, -H * 0.1, -H * 0.6, H * 0.2, H * 0.05, H * 0.02);
    ctx.beginPath();
    ctx.moveTo(H * 0.06, -H * 0.58);
    ctx.quadraticCurveTo(H * 0.2 + sway * 4, -H * 0.55, H * 0.24 + sway * 6, -H * 0.46);
    ctx.lineTo(H * 0.2 + sway * 6, -H * 0.45);
    ctx.quadraticCurveTo(H * 0.15, -H * 0.52, H * 0.04, -H * 0.55);
    ctx.fill();
  }
  // воротник-кимоно у мечниц
  if (look.weapon === 'katana' && !look.armor) {
    ctx.strokeStyle = look.accent;
    ctx.lineWidth = H * 0.015;
    ctx.beginPath();
    ctx.moveTo(-H * 0.06, -H * 0.56);
    ctx.lineTo(H * 0.02, -H * 0.44);
    ctx.moveTo(H * 0.06, -H * 0.56);
    ctx.lineTo(-H * 0.0, -H * 0.5);
    ctx.stroke();
  }

  // шея и голова
  ctx.fillStyle = SKIN;
  ctx.fillRect(-H * 0.03, -H * 0.6, H * 0.06, H * 0.06);
  if (look.elf) {
    // заострённые эльфийские уши
    ctx.fillStyle = SKIN;
    tri(ctx, hx - r * 0.9, hy + r * 0.05, hx - r * 1.45, hy - r * 0.35, hx - r * 0.85, hy + r * 0.35);
    tri(ctx, hx + r * 0.9, hy + r * 0.05, hx + r * 1.45, hy - r * 0.35, hx + r * 0.85, hy + r * 0.35);
  }
  circle(ctx, hx, hy, r);
  drawFace(ctx, look, hx, hy, r, time + phase);
  drawFrontHair(ctx, look, hx, hy, r, hairDark);
  drawHeadwear(ctx, look, hx, hy, r, time);
  if (enraged) {
    // светящийся рог они на лбу
    ctx.fillStyle = `rgba(255, 255, 255, ${0.8 + Math.sin(time * 10) * 0.2})`;
    tri(ctx, hx - r * 0.12, hy - r * 0.95, hx + r * 0.12, hy - r * 0.95, hx, hy - r * 1.6);
    ctx.fillStyle = 'rgba(255, 80, 80, 0.25)';
    circle(ctx, hx, hy - r * 1.2, r * 0.45);
  }

  // рука с оружием — вытянута к отряду
  const swing = -lunge * 0.9;
  ctx.save();
  ctx.translate(-H * 0.1, -H * 0.47);
  ctx.rotate(swing);
  ctx.fillStyle = look.outfit;
  roundRect(ctx, -H * 0.12, -H * 0.025, H * 0.13, H * 0.05, H * 0.02);
  ctx.fillStyle = SKIN;
  circle(ctx, -H * 0.13, 0, H * 0.03);
  drawWeapon(ctx, look, -H * 0.13, 0, H, time);
  ctx.restore();

  ctx.restore();
}

function drawBackHair(ctx, look, hx, hy, r, H, sway, hairDark) {
  ctx.fillStyle = hairDark;
  switch (look.style) {
    case 'long':
      roundRect(ctx, hx - r * 1.02, hy - r * 0.4, r * 2.04, r * 2.5, r * 0.6);
      break;
    case 'bob':
      roundRect(ctx, hx - r * 1.08, hy - r * 0.5, r * 2.16, r * 1.45, r * 0.5);
      break;
    case 'pony':
      ctx.beginPath();
      ctx.moveTo(hx + r * 0.6, hy - r * 0.7);
      ctx.quadraticCurveTo(hx + r * 2 + sway * 6, hy - r * 0.2, hx + r * 1.5 + sway * 8, hy + r * 1.8);
      ctx.quadraticCurveTo(hx + r * 1.2, hy + r * 0.6, hx + r * 0.6, hy + r * 0.2);
      ctx.fill();
      break;
    case 'short':
      roundRect(ctx, hx - r * 1.05, hy - r * 0.5, r * 2.1, r * 1.1, r * 0.4);
      break;
    case 'drill':
      // длинные локоны-«дрели» по бокам
      for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const cx = hx + side * r * (1.15 + k * 0.03);
          const cy = hy + r * (0.15 + k * 0.42) + sway * 2;
          ctx.fillStyle = k % 2 ? hairDark : look.hair;
          ctx.beginPath();
          ctx.ellipse(cx, cy, r * (0.36 - k * 0.04), r * 0.26, 0, 0, TAU);
          ctx.fill();
        }
      }
      ctx.fillStyle = hairDark;
      break;
    case 'twin':
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(hx + side * r * 0.85, hy - r * 0.5);
        ctx.quadraticCurveTo(hx + side * r * 1.9, hy + r * 0.3 + sway * 3, hx + side * r * 1.3, hy + r * 2.1);
        ctx.quadraticCurveTo(hx + side * r * 1.0, hy + r * 0.8, hx + side * r * 0.75, hy);
        ctx.fill();
      }
      ctx.fillStyle = look.accent;
      circle(ctx, hx - r * 0.95, hy - r * 0.45, r * 0.16);
      circle(ctx, hx + r * 0.95, hy - r * 0.45, r * 0.16);
      ctx.fillStyle = hairDark;
      break;
  }
  ctx.fillStyle = look.hair;
  circle(ctx, hx, hy - r * 0.12, r * 1.05);
}

function drawFace(ctx, look, hx, hy, r, t) {
  const blink = t % 3.7 < 0.12;
  const eyeY = hy + r * 0.18;
  for (const ex of [hx - r * 0.42, hx + r * 0.3]) {
    if (blink) {
      ctx.strokeStyle = '#3b2a2a';
      ctx.lineWidth = r * 0.08;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.17, eyeY);
      ctx.quadraticCurveTo(ex, eyeY + r * 0.08, ex + r * 0.17, eyeY);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, r * 0.17, r * 0.24, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = look.eyes ?? '#5c7cfa';
    ctx.beginPath();
    ctx.ellipse(ex - r * 0.02, eyeY + r * 0.03, r * 0.13, r * 0.19, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1b1b2f';
    ctx.beginPath();
    ctx.ellipse(ex - r * 0.02, eyeY + r * 0.05, r * 0.06, r * 0.1, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    circle(ctx, ex - r * 0.06, eyeY - r * 0.06, r * 0.05);
    circle(ctx, ex + r * 0.04, eyeY + r * 0.1, r * 0.025);
    // ресницы
    ctx.strokeStyle = '#2b1d1d';
    ctx.lineWidth = r * 0.06;
    ctx.beginPath();
    ctx.moveTo(ex - r * 0.19, eyeY - r * 0.18);
    ctx.quadraticCurveTo(ex, eyeY - r * 0.3, ex + r * 0.19, eyeY - r * 0.16);
    ctx.stroke();
  }
  // румянец и рот (решительный — это же бой)
  ctx.fillStyle = 'rgba(255,120,140,0.35)';
  ctx.beginPath();
  ctx.ellipse(hx - r * 0.62, hy + r * 0.48, r * 0.14, r * 0.07, 0, 0, TAU);
  ctx.ellipse(hx + r * 0.52, hy + r * 0.48, r * 0.14, r * 0.07, 0, 0, TAU);
  ctx.fill();
  if (look.mask) {
    ctx.fillStyle = look.outfit;
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.95, hy + r * 0.38);
    ctx.quadraticCurveTo(hx, hy + r * 0.3, hx + r * 0.95, hy + r * 0.38);
    ctx.quadraticCurveTo(hx + r * 0.7, hy + r * 1.0, hx, hy + r * 1.02);
    ctx.quadraticCurveTo(hx - r * 0.7, hy + r * 1.0, hx - r * 0.95, hy + r * 0.38);
    ctx.fill();
  } else {
    ctx.strokeStyle = '#a23b4a';
    ctx.lineWidth = r * 0.06;
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.18, hy + r * 0.64);
    ctx.lineTo(hx + r * 0.06, hy + r * 0.62);
    ctx.stroke();
  }
}

function drawFrontHair(ctx, look, hx, hy, r, hairDark) {
  // чёлка — зубчатая полоса по лбу
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  ctx.moveTo(hx - r * 1.02, hy + r * 0.05);
  ctx.quadraticCurveTo(hx - r * 1.05, hy - r * 1.05, hx, hy - r * 1.08);
  ctx.quadraticCurveTo(hx + r * 1.05, hy - r * 1.05, hx + r * 1.02, hy + r * 0.05);
  const spikes = 5;
  for (let i = spikes; i >= 0; i--) {
    const x = hx - r * 0.95 + (i / spikes) * r * 1.9;
    const y = hy - r * (i % 2 ? 0.1 : 0.32);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = hairDark;
  ctx.lineWidth = r * 0.05;
  ctx.beginPath();
  ctx.moveTo(hx - r * 0.2, hy - r * 0.95);
  ctx.quadraticCurveTo(hx - r * 0.35, hy - r * 0.5, hx - r * 0.45, hy - r * 0.3);
  ctx.stroke();
  // блик на волосах
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = r * 0.07;
  ctx.beginPath();
  ctx.arc(hx, hy - r * 0.2, r * 0.75, -2.4, -1.6);
  ctx.stroke();
}

function drawHeadwear(ctx, look, hx, hy, r, time) {
  const key = look.heroineKey;
  if (look.hat) {
    // шляпа волшебницы
    ctx.fillStyle = darker(look.outfit, 0.85);
    ctx.beginPath();
    ctx.ellipse(hx, hy - r * 0.85, r * 1.45, r * 0.28, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.75, hy - r * 0.9);
    ctx.lineTo(hx + r * 0.75, hy - r * 0.9);
    ctx.lineTo(hx + r * 0.5, hy - r * 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = look.accent;
    star(ctx, hx + r * 0.1, hy - r * 1.3, r * 0.22);
  }
  if (look.armor && !key) {
    ctx.fillStyle = look.accent;
    ctx.fillRect(hx - r, hy - r * 0.62, r * 2, r * 0.2);
  }
  if (key === 'sakura') {
    ctx.fillStyle = '#ffd6e7';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + time * 0.5;
      circle(ctx, hx + r * 0.7 + Math.cos(a) * r * 0.16, hy - r * 0.75 + Math.sin(a) * r * 0.16, r * 0.11);
    }
    ctx.fillStyle = '#e0457b';
    circle(ctx, hx + r * 0.7, hy - r * 0.75, r * 0.08);
  }
  if (key === 'ayame') {
    ctx.fillStyle = look.accent;
    ctx.fillRect(hx - r * 1.02, hy - r * 0.55, r * 2.04, r * 0.18);
  }
  if (key === 'yuki') {
    ctx.strokeStyle = '#e7f5ff';
    ctx.lineWidth = r * 0.07;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(hx + r * 0.65 - Math.cos(a) * r * 0.22, hy - r * 0.7 - Math.sin(a) * r * 0.22);
      ctx.lineTo(hx + r * 0.65 + Math.cos(a) * r * 0.22, hy - r * 0.7 + Math.sin(a) * r * 0.22);
      ctx.stroke();
    }
  }
  if (key === 'rin') {
    ctx.fillStyle = 'rgba(32,201,151,0.55)';
    roundRect(ctx, hx - r * 0.75, hy + r * 0.0, r * 1.4, r * 0.32, r * 0.12);
    ctx.fillStyle = '#343a40';
    circle(ctx, hx + r * 1.0, hy + r * 0.15, r * 0.18);
  }
  if (key === 'mikoto') {
    // маска кицунэ сбоку головы
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(hx + r * 0.85, hy - r * 0.55, r * 0.32, r * 0.38, 0.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#e03131';
    ctx.fillRect(hx + r * 0.72, hy - r * 0.6, r * 0.1, r * 0.04);
    ctx.fillRect(hx + r * 0.92, hy - r * 0.55, r * 0.1, r * 0.04);
  }
  if (look.maid) {
    // кружевная наколка горничной
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(hx, hy - r * 0.92, r * 0.7, r * 0.2, 0, Math.PI, TAU);
    ctx.fill();
    for (let i = -2; i <= 2; i++) circle(ctx, hx + i * r * 0.28, hy - r * 0.95, r * 0.12);
  }
  if (look.clip) {
    // заколка-крестик над глазом, у Рам и Рем с разных сторон
    const side = look.clip === 'left' ? -1 : 1;
    ctx.strokeStyle = look.heroineKey === 'ram' ? '#ffffff' : '#ffd6e7';
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    ctx.moveTo(hx + side * r * 0.45, hy - r * 0.55);
    ctx.lineTo(hx + side * r * 0.7, hy - r * 0.3);
    ctx.moveTo(hx + side * r * 0.7, hy - r * 0.55);
    ctx.lineTo(hx + side * r * 0.45, hy - r * 0.3);
    ctx.stroke();
  }
  if (look.flower) {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      circle(ctx, hx - r * 0.75 + Math.cos(a) * r * 0.15, hy - r * 0.55 + Math.sin(a) * r * 0.15, r * 0.1);
    }
    ctx.fillStyle = '#9b6fd6';
    circle(ctx, hx - r * 0.75, hy - r * 0.55, r * 0.07);
  }
  if (look.butterfly) {
    ctx.fillStyle = '#9775fa';
    const flap = 0.7 + Math.sin(time * 6) * 0.3;
    ctx.beginPath();
    ctx.ellipse(hx + r * 0.62, hy - r * 0.75, r * 0.2 * flap, r * 0.14, -0.5, 0, TAU);
    ctx.ellipse(hx + r * 0.88, hy - r * 0.75, r * 0.2 * flap, r * 0.14, 0.5, 0, TAU);
    ctx.fill();
  }
  if (look.bow && look.style === 'drill') {
    ctx.fillStyle = look.accent;
    tri(ctx, hx, hy - r * 1.05, hx - r * 0.45, hy - r * 1.3, hx - r * 0.45, hy - r * 0.8);
    tri(ctx, hx, hy - r * 1.05, hx + r * 0.45, hy - r * 1.3, hx + r * 0.45, hy - r * 0.8);
  }
  if (look.crown) {
    ctx.fillStyle = '#ffd43b';
    ctx.beginPath();
    ctx.moveTo(hx - r * 0.55, hy - r * 0.95);
    for (let i = 0; i <= 4; i++) {
      const x = hx - r * 0.55 + (i / 4) * r * 1.1;
      ctx.lineTo(x, hy - r * (i % 2 ? 1.15 : 1.45));
    }
    ctx.lineTo(hx + r * 0.55, hy - r * 0.95);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9775fa';
    circle(ctx, hx, hy - r * 1.18, r * 0.08);
  }
}

function drawWeapon(ctx, look, x, y, H, time) {
  ctx.save();
  ctx.translate(x, y);
  switch (look.weapon) {
    case 'katana':
      ctx.rotate(0.5); // клинок вверх и вперёд
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(-H * 0.02, -H * 0.012, H * 0.1, H * 0.024);
      ctx.fillStyle = '#ffd43b';
      ctx.fillRect(-H * 0.025, -H * 0.03, H * 0.012, H * 0.06);
      ctx.fillStyle = '#e9ecef';
      ctx.beginPath();
      ctx.moveTo(-H * 0.025, -H * 0.012);
      ctx.lineTo(-H * 0.4, -H * 0.03);
      ctx.lineTo(-H * 0.42, 0);
      ctx.lineTo(-H * 0.025, H * 0.012);
      ctx.closePath();
      ctx.fill();
      break;
    case 'kunai':
      ctx.fillStyle = '#adb5bd';
      ctx.beginPath();
      ctx.moveTo(0, -H * 0.02);
      ctx.lineTo(-H * 0.14, 0);
      ctx.lineTo(0, H * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e03131';
      ctx.lineWidth = H * 0.01;
      ctx.beginPath();
      ctx.arc(H * 0.03, 0, H * 0.02, 0, TAU);
      ctx.stroke();
      break;
    case 'hammer':
      ctx.rotate(0.6);
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(-H * 0.26, -H * 0.012, H * 0.28, H * 0.024);
      ctx.fillStyle = '#868e96';
      roundRect(ctx, -H * 0.34, -H * 0.08, H * 0.12, H * 0.16, H * 0.02);
      break;
    case 'staff': {
      ctx.rotate(1.2); // навершие сверху
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(-H * 0.4, -H * 0.012, H * 0.5, H * 0.024);
      const glow = 0.6 + Math.sin(time * 4) * 0.3;
      ctx.fillStyle = look.heroineKey === 'yuki' ? `rgba(165,216,255,${glow})` : `rgba(255,212,59,${glow})`;
      circle(ctx, -H * 0.42, 0, H * 0.07);
      ctx.fillStyle = look.heroineKey === 'luna' ? '#fff3bf' : look.accent;
      if (look.heroineKey === 'luna') {
        circle(ctx, -H * 0.42, 0, H * 0.05);
        ctx.fillStyle = `rgba(59,63,158,0.9)`;
        circle(ctx, -H * 0.4, -H * 0.015, H * 0.045);
      } else {
        star(ctx, -H * 0.42, 0, H * 0.045);
      }
      break;
    }
    case 'dagger':
      ctx.rotate(0.3);
      ctx.fillStyle = '#5c3d2e';
      ctx.fillRect(-H * 0.02, -H * 0.012, H * 0.06, H * 0.024);
      ctx.fillStyle = '#dee2e6';
      tri(ctx, -H * 0.02, -H * 0.022, -H * 0.02, H * 0.022, -H * 0.2, 0);
      break;
    case 'wand': {
      ctx.rotate(1.0);
      ctx.fillStyle = '#5c3d2e';
      ctx.fillRect(-H * 0.24, -H * 0.01, H * 0.26, H * 0.02);
      const glow = 0.5 + Math.sin(time * 6) * 0.3;
      ctx.fillStyle = `rgba(150, 242, 215, ${glow})`;
      circle(ctx, -H * 0.25, 0, H * 0.045);
      break;
    }
    case 'flail': {
      // моргенштерн на цепи — шар покачивается
      ctx.fillStyle = '#5c3d2e';
      ctx.fillRect(-H * 0.08, -H * 0.012, H * 0.1, H * 0.024);
      const swingA = Math.sin(time * 3) * 0.6;
      const bx = -H * 0.08 - Math.cos(swingA) * H * 0.16;
      const by = Math.sin(swingA) * H * 0.16;
      ctx.strokeStyle = '#868e96';
      ctx.lineWidth = H * 0.01;
      ctx.beginPath();
      ctx.moveTo(-H * 0.08, 0);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.fillStyle = '#495057';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        tri(ctx, bx + Math.cos(a) * H * 0.04, by + Math.sin(a) * H * 0.04,
          bx + Math.cos(a + 0.3) * H * 0.04, by + Math.sin(a + 0.3) * H * 0.04,
          bx + Math.cos(a + 0.15) * H * 0.075, by + Math.sin(a + 0.15) * H * 0.075);
      }
      circle(ctx, bx, by, H * 0.045);
      break;
    }
    case 'book':
      ctx.rotate(0.2);
      ctx.fillStyle = look.heroineKey === 'echidna' ? '#3b2a6b' : '#7a2e4a';
      roundRect(ctx, -H * 0.12, -H * 0.06, H * 0.11, H * 0.12, H * 0.01);
      ctx.fillStyle = '#ffd43b';
      ctx.fillRect(-H * 0.1, -H * 0.045, H * 0.015, H * 0.09);
      ctx.fillStyle = `rgba(255, 243, 176, ${0.4 + Math.sin(time * 5) * 0.3})`;
      circle(ctx, -H * 0.065, -H * 0.09, H * 0.03);
      break;
    case 'ice':
      ctx.rotate(0.9);
      ctx.fillStyle = 'rgba(165, 216, 255, 0.9)';
      ctx.beginPath();
      ctx.moveTo(-H * 0.05, 0);
      ctx.lineTo(-H * 0.12, -H * 0.04);
      ctx.lineTo(-H * 0.26, 0);
      ctx.lineTo(-H * 0.12, H * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      circle(ctx, -H * 0.14, -H * 0.01, H * 0.012);
      break;
    case 'baton': {
      ctx.rotate(0.4);
      ctx.fillStyle = '#343a40';
      ctx.fillRect(-H * 0.05, -H * 0.015, H * 0.07, H * 0.03);
      const glow = 0.6 + Math.sin(time * 10) * 0.3;
      ctx.fillStyle = `rgba(32,201,151,${glow})`;
      roundRect(ctx, -H * 0.3, -H * 0.02, H * 0.26, H * 0.04, H * 0.02);
      break;
    }
  }
  ctx.restore();
}

// Портрет для диалога: голова и плечи крупным планом.
// time по умолчанию 1 — чтобы портрет не застал героиню посреди моргания.
export function drawGirlPortrait(ctx, key, w, h, time = 1) {
  const look = lookForHeroine(key);
  const H = h * 1.7;
  ctx.save();
  ctx.translate(w * 0.5, h * 1.82); // макушка с небольшим отступом от верхнего края
  drawGirl(ctx, { ...look, weapon: null }, { H, walking: false, time });
  ctx.restore();
}

// ---------- примитивы ----------
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

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

// Пак — дух-кот Эмилии: маленький серый котик, который парит в воздухе.
export function drawPuck(ctx, x, y, s, time = 0) {
  const bob = Math.sin(time * 3) * s * 0.15;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.fillStyle = 'rgba(200, 230, 255, 0.25)';
  circle(ctx, 0, 0, s * 1.5);
  ctx.fillStyle = '#9aa3ad';
  tri(ctx, -s * 0.9, -s * 0.3, -s * 0.75, -s * 1.3, -s * 0.15, -s * 0.75);
  tri(ctx, s * 0.9, -s * 0.3, s * 0.75, -s * 1.3, s * 0.15, -s * 0.75);
  ctx.fillStyle = '#ffc9de';
  tri(ctx, -s * 0.7, -s * 0.5, -s * 0.65, -s * 1.05, -s * 0.3, -s * 0.75);
  tri(ctx, s * 0.7, -s * 0.5, s * 0.65, -s * 1.05, s * 0.3, -s * 0.75);
  ctx.fillStyle = '#b7bec7';
  circle(ctx, 0, 0, s);
  ctx.fillStyle = '#1b1b2f';
  circle(ctx, -s * 0.35, -s * 0.05, s * 0.16);
  circle(ctx, s * 0.35, -s * 0.05, s * 0.16);
  ctx.fillStyle = '#ffffff';
  circle(ctx, -s * 0.3, -s * 0.12, s * 0.06);
  circle(ctx, s * 0.4, -s * 0.12, s * 0.06);
  ctx.fillStyle = '#ff8fab';
  circle(ctx, 0, s * 0.22, s * 0.1);
  ctx.strokeStyle = '#7d8590';
  ctx.lineWidth = s * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(s * 0.8, s * 0.5);
  ctx.quadraticCurveTo(s * 1.5, s * 0.6 + Math.sin(time * 4) * s * 0.2, s * 1.4, -s * 0.1);
  ctx.stroke();
  ctx.restore();
}
