// Сюжетные сцены в стиле визуальной новеллы: портрет, имя, текст с «печатной машинкой», выбор в конце.
// Сцены ставятся в очередь; пока сцена открыта, игра на паузе (см. isDialogueOpen).
import { SPEAKERS } from './story.js';
import { CATS } from './config.js';
import { drawGirlPortrait } from './girls.js';
import { drawCatPreview } from './render.js';

const $ = (id) => document.getElementById(id);
const CHARS_PER_SECOND = 45;

let hooks = { catSkin: () => null, sfx: () => {} };
const queue = [];
let current = null; // { lines, index, title, choices, resolve, typing, shown, timer }

export function initDialogue(options) {
  hooks = { ...hooks, ...options };
  $('dialogue').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    advance();
  });
  $('dialogue-skip').onclick = skipScene;
  document.addEventListener('keydown', (e) => {
    if (!current || (e.key !== ' ' && e.key !== 'Enter')) return;
    if (e.target.closest?.('button')) return;
    e.preventDefault();
    advance();
  });
}

export const isDialogueOpen = () => current !== null;

// lines: [{ who, text }]; choices: [{ label, value }] — показываются после последней реплики.
// Возвращает Promise с выбранным value (или null, если выбора нет).
export function playScene(lines, { title = '', choices = [] } = {}) {
  return new Promise((resolve) => {
    queue.push({ lines, title, choices, resolve });
    if (!current) next();
  });
}

function next() {
  current = queue.shift() ?? null;
  if (!current) {
    $('dialogue').hidden = true;
    return;
  }
  current.index = -1;
  $('dialogue').hidden = false;
  $('dialogue-title').textContent = current.title;
  $('dialogue-title').hidden = !current.title;
  showLine(0);
}

function showLine(i) {
  const scene = current;
  scene.index = i;
  const line = scene.lines[i];
  const speaker = SPEAKERS[line.who] ?? SPEAKERS.narrator;
  $('dialogue-speaker').textContent = speaker.name;
  $('dialogue-speaker').style.color = speaker.heroine?.accent ?? (line.who === 'narrator' ? '' : '#ffb347');
  $('dialogue-card').classList.toggle('narration', line.who === 'narrator');
  drawPortrait(line.who);
  $('dialogue-choices').replaceChildren();
  $('dialogue-hint').hidden = false;

  const el = $('dialogue-line');
  scene.shown = 0;
  scene.typing = true;
  clearInterval(scene.timer);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return finishTyping();
  el.textContent = '';
  scene.timer = setInterval(() => {
    scene.shown += 2;
    el.textContent = line.text.slice(0, scene.shown);
    if (scene.shown % 6 === 0) hooks.sfx('dialog');
    if (scene.shown >= line.text.length) finishTyping();
  }, 2000 / CHARS_PER_SECOND);
}

function finishTyping() {
  const scene = current;
  clearInterval(scene.timer);
  scene.typing = false;
  $('dialogue-line').textContent = scene.lines[scene.index].text;
  const last = scene.index === scene.lines.length - 1;
  if (last && scene.choices.length) {
    $('dialogue-hint').hidden = true;
    const box = $('dialogue-choices');
    for (const c of scene.choices) {
      const b = document.createElement('button');
      b.className = c.primary ? 'primary' : 'secondary';
      b.textContent = c.label;
      b.onclick = () => close(c.value);
      box.append(b);
    }
  }
}

function advance() {
  if (!current) return;
  if (current.typing) return finishTyping();
  if (current.index < current.lines.length - 1) return showLine(current.index + 1);
  if (!current.choices.length) close(null);
}

// Пропуск сразу ведёт к выбору, если он есть: решения игрок принимает сам.
function skipScene() {
  if (!current) return;
  if (current.choices.length) {
    if (current.index !== current.lines.length - 1) showLine(current.lines.length - 1);
    finishTyping();
    return;
  }
  close(null);
}

function close(value) {
  const scene = current;
  clearInterval(scene.timer);
  scene.resolve(value);
  next();
}

function drawPortrait(who) {
  const canvas = $('dialogue-portrait');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createRadialGradient(w / 2, h * 0.4, 10, w / 2, h / 2, w * 0.7);
  const heroine = SPEAKERS[who]?.heroine;
  bg.addColorStop(0, heroine ? heroine.hair : '#4b3f7a');
  bg.addColorStop(1, '#1b1530');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (heroine) {
    drawGirlPortrait(ctx, heroine.key, w, h);
    return;
  }
  const catIndex = CATS.findIndex((c) => c.key === who);
  if (catIndex >= 0) {
    ctx.save();
    ctx.translate(-w * 0.22, h * 0.55);
    drawCatPreview(ctx, catIndex, hooks.catSkin(catIndex), w * 1.4, h * 1.4);
    ctx.restore();
    return;
  }
  ctx.font = `${Math.round(h * 0.45)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('📜', w / 2, h / 2);
}
