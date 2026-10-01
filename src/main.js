// Точка входа: игровой цикл, связка боя с интерфейсом, сохранения.
import { UPGRADES, SKILLS, PRESTIGE_MIN_STAGE } from './config.js';
import {
  formatNumber, formatDuration, isMaxed, isBossStage, biomeFor, bonesForPrestige,
  boneMultiplier, expectedDps,
} from './formulas.js';
import {
  createState, statsOf, buyUpgrade, nextCost, isSkillUnlocked, canPrestige, prestige,
  applyOffline, saveToStorage, loadFromStorage, clearStorage,
} from './state.js';
import { Battle, WORLD } from './battle.js';
import { render } from './render.js';

const $ = (id) => document.getElementById(id);

let state = loadFromStorage() ?? createState();
const offline = applyOffline(state);
let battle;
let buyAmount = 1;

// ---------- Холст ----------
const canvas = $('game');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(w * (WORLD.height / WORLD.width) * dpr);
  ctx.setTransform(canvas.width / WORLD.width, 0, 0, canvas.height / WORLD.height, 0, 0);
}
window.addEventListener('resize', resizeCanvas);

// ---------- Тосты и модальные окна ----------
let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function showModal({ icon, title, text, actions }) {
  $('modal-icon').textContent = icon;
  $('modal-title').textContent = title;
  $('modal-text').innerHTML = text;
  const box = $('modal-actions');
  box.replaceChildren();
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = a.style ?? 'primary';
    b.textContent = a.label;
    b.onclick = () => {
      $('modal').hidden = true;
      a.onClick?.();
    };
    box.append(b);
  }
  $('modal').hidden = false;
}

// ---------- Бой ----------
function newBattle() {
  battle = new Battle(state, {
    onStageStart(stage, boss) {
      if (boss) toast(`👑 Босс! Победи его за 30 секунд`);
      else if ((stage - 1) % 10 === 0 && stage > 1) toast(`🌍 Новая локация: ${biomeFor(stage).name}`);
      for (const s of Object.values(SKILLS)) {
        if (s.unlockStage === stage && stage === state.maxStage) toast(`✨ Новый навык: ${s.name}!`);
      }
    },
    onStageFail(message) {
      toast(message);
    },
  });
}

// ---------- Навыки ----------
const skillEls = {};
function buildSkills() {
  const box = $('skills');
  for (const [key, s] of Object.entries(SKILLS)) {
    const b = document.createElement('button');
    b.className = 'skill';
    b.title = s.desc;
    b.innerHTML = `<span class="icon">${s.icon}</span><span class="name">${s.name}</span>
      <div class="cd-overlay"></div><div class="cd-text"></div>`;
    b.onclick = () => {
      if (!isSkillUnlocked(state, key)) return toast(`🔒 Откроется на этапе ${s.unlockStage}`);
      if (battle.cast(key)) toast(`${s.icon} ${s.name}: ${s.desc}`);
    };
    box.append(b);
    skillEls[key] = { root: b, overlay: b.querySelector('.cd-overlay'), text: b.querySelector('.cd-text') };
  }
  const auto = document.createElement('button');
  auto.className = 'auto-toggle';
  auto.id = 'auto-skills';
  auto.innerHTML = '<span class="icon">🤖</span><span>Авто</span>';
  auto.onclick = () => {
    state.autoSkills = !state.autoSkills;
    toast(state.autoSkills ? 'Авто-навыки включены' : 'Авто-навыки выключены');
  };
  box.append(auto);
}

function updateSkills() {
  for (const [key, s] of Object.entries(SKILLS)) {
    const el = skillEls[key];
    const unlocked = isSkillUnlocked(state, key);
    const cd = battle.cooldowns[key];
    el.root.classList.toggle('locked', !unlocked);
    el.root.classList.toggle('active', battle.buffs[key] > 0);
    el.overlay.style.height = unlocked ? `${(cd / s.cooldown) * 100}%` : '100%';
    el.text.textContent = !unlocked ? `🔒 этап ${s.unlockStage}` : cd > 0 ? Math.ceil(cd) : '';
  }
  $('auto-skills').classList.toggle('on', state.autoSkills);
}

// ---------- Улучшения ----------
const upgradeEls = {};
function describe(key, stats) {
  switch (key) {
    case 'damage': return `Урон: <b>${formatNumber(stats.damage)}</b>`;
    case 'fireRate': return `Выстрелов/с: <b>${stats.fireRate.toFixed(2)}</b>`;
    case 'maxHp': return `Здоровье: <b>${formatNumber(stats.maxHp)}</b>`;
    case 'regen': return `Восст./с: <b>${formatNumber(stats.regen)}</b>`;
    case 'critChance': return `Шанс: <b>${(stats.critChance * 100).toFixed(1)}%</b>`;
    case 'critDamage': return `Множитель: <b>×${stats.critMult.toFixed(1)}</b>`;
    case 'goldBonus': return `Золото: <b>×${stats.goldMult.toFixed(2)}</b>`;
    default: return '';
  }
}

function buildUpgrades() {
  const list = $('upgrade-list');
  for (const [key, u] of Object.entries(UPGRADES)) {
    const row = document.createElement('div');
    row.className = 'upgrade';
    row.innerHTML = `<div class="u-icon">${u.icon}</div>
      <div><div class="u-name">${u.name}</div><div class="u-value"></div></div>
      <button class="buy-btn"></button>`;
    const btn = row.querySelector('.buy-btn');
    btn.onclick = () => {
      const before = statsOf(state).maxHp;
      if (buyUpgrade(state, key, buyAmount) > 0) {
        battle.hero.hp += Math.max(0, statsOf(state).maxHp - before);
        updateUI(true);
      }
    };
    list.append(row);
    upgradeEls[key] = { value: row.querySelector('.u-value'), btn };
  }
  for (const b of $('buy-amount').querySelectorAll('button')) {
    b.onclick = () => {
      buyAmount = b.dataset.amount === 'max' ? 'max' : Number(b.dataset.amount);
      for (const o of $('buy-amount').querySelectorAll('button')) o.classList.toggle('active', o === b);
      updateUI(true);
    };
  }
}

function updateUpgrades(stats) {
  for (const key of Object.keys(UPGRADES)) {
    const el = upgradeEls[key];
    const level = state.levels[key];
    const max = UPGRADES[key].maxLevel;
    el.value.innerHTML = `ур. ${level}${max ? '/' + max : ''} · ${describe(key, stats)}`;
    if (isMaxed(key, level)) {
      el.btn.disabled = true;
      el.btn.innerHTML = 'МАКС';
      continue;
    }
    const { count, cost } = nextCost(state, key, buyAmount);
    el.btn.disabled = count === 0 || cost > state.gold;
    el.btn.innerHTML = `🪙 ${formatNumber(cost)}<small>+${count} ур.</small>`;
  }
}

// ---------- Вкладки ----------
function setupTabs() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.onclick = () => {
      for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
      for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== `panel-${tab.dataset.tab}`;
      updateUI(true);
    };
  }
}

// ---------- Перерождение ----------
function setupPrestige() {
  $('prestige-btn').onclick = () => {
    const gain = bonesForPrestige(state.maxStage);
    showModal({
      icon: '🦴',
      title: 'Переродиться?',
      text: `Ты получишь <b>${gain}</b> 🦴. Урон и золото станут <b>×${boneMultiplier(state.bones + gain).toFixed(1)}</b>.<br>Этап, золото и улучшения сбросятся.`,
      actions: [
        {
          label: 'Да, переродиться!',
          onClick() {
            const got = prestige(state);
            newBattle();
            saveToStorage(state);
            toast(`🦴 +${got} косточек! Котик стал сильнее`);
            updateUI(true);
          },
        },
        { label: 'Пока нет', style: 'secondary' },
      ],
    });
  };
  $('reset-btn').onclick = () => {
    showModal({
      icon: '⚠️',
      title: 'Сбросить всё?',
      text: 'Весь прогресс, включая косточки, будет удалён навсегда.',
      actions: [
        {
          label: 'Удалить прогресс',
          style: 'danger',
          onClick() {
            clearStorage();
            state = createState();
            newBattle();
            updateUI(true);
          },
        },
        { label: 'Отмена', style: 'secondary' },
      ],
    });
  };
}

function updatePrestige() {
  const gain = bonesForPrestige(state.maxStage);
  $('prestige-gain').textContent = formatNumber(gain);
  $('prestige-btn').disabled = !canPrestige(state);
  $('prestige-bonus').textContent = canPrestige(state)
    ? `Бонус станет ×${boneMultiplier(state.bones).toFixed(1)} → ×${boneMultiplier(state.bones + gain).toFixed(1)}`
    : `Дойди до ${PRESTIGE_MIN_STAGE}-го этапа (рекорд: ${state.maxStage})`;
  document.querySelector('[data-tab="prestige"]').classList.toggle('badge', gain > 0 && gain >= Math.max(1, state.bones * 0.5));
}

function updateStats(stats) {
  const rows = [
    ['Урон в секунду', formatNumber(expectedDps(stats))],
    ['Текущий этап', state.stage],
    ['Рекорд этапа', state.maxStage],
    ['Побеждено врагов', formatNumber(state.stats.kills)],
    ['Побеждено боссов', formatNumber(state.stats.bossKills)],
    ['Всего золота', formatNumber(state.stats.totalGold)],
    ['Перерождений', state.stats.prestiges],
    ['Бонус косточек', `×${boneMultiplier(state.bones).toFixed(1)}`],
    ['Время в игре', formatDuration(state.stats.playTime)],
  ];
  $('stats-list').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------- Обновление интерфейса ----------
let uiTimer = 0;
function updateUI(force = false) {
  const stats = statsOf(state);
  $('gold').textContent = formatNumber(state.gold);
  $('bones').textContent = formatNumber(state.bones);
  const boss = isBossStage(state.stage);
  $('stage-label').textContent = `${boss ? '👑 ' : ''}Этап ${state.stage} · ${biomeFor(state.stage).name}`;
  $('stage-progress').style.width = `${Math.min(1, battle.progress) * 100}%`;
  $('stage-progress').parentElement.classList.toggle('boss', boss);
  $('stage-progress-text').textContent = boss
    ? `⏱ ${Math.max(0, battle.bossTimer).toFixed(1)} с`
    : `${battle.killed} / 10`;
  $('boss-btn').hidden = state.autoAdvance;
  updateSkills();

  // Тяжёлые панели обновляем реже.
  if (!force && uiTimer > 0) return;
  uiTimer = 0.2;
  if (!$('panel-upgrades').hidden) updateUpgrades(stats);
  updatePrestige();
  if (!$('panel-stats').hidden) updateStats(stats);
}

// ---------- Игровой цикл ----------
let last = performance.now();
let saveTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); // защита от скачков после сворачивания вкладки
  last = now;
  battle.update(dt);
  render(ctx, battle, battle.time);
  uiTimer -= dt;
  updateUI();
  saveTimer += dt;
  if (saveTimer > 5) {
    saveTimer = 0;
    state.lastSeen = Date.now();
    saveToStorage(state);
  }
  requestAnimationFrame(frame);
}

function persistNow() {
  state.lastSeen = Date.now();
  saveToStorage(state);
}

// Вернулись во вкладку после долгого отсутствия — начисляем оффлайн-доход.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return persistNow();
  const result = applyOffline(state);
  if (result) showOfflineModal(result);
  last = performance.now();
});
window.addEventListener('pagehide', persistNow);

function showOfflineModal({ seconds, gold }) {
  showModal({
    icon: '😺',
    title: 'Пока тебя не было…',
    text: `Котик охранял двор <b>${formatDuration(seconds)}</b> и собрал <b>🪙 ${formatNumber(gold)}</b>.`,
    actions: [{ label: 'Мур! Забрать' }],
  });
}

$('boss-btn').onclick = () => battle.challengeBoss();

buildSkills();
buildUpgrades();
setupTabs();
setupPrestige();
newBattle();
resizeCanvas();
updateUI(true);
if (offline) showOfflineModal(offline);
requestAnimationFrame(frame);
