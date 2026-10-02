// Точка входа: игровой цикл, связка боя с интерфейсом, сохранения.
import {
  UPGRADES, SKILLS, PRESTIGE_MIN_STAGE, CATS, MAX_GUN_TIER, CASES, SKINS, QUEST_TYPES, QUEST_GOLD_SECONDS,
  SPAWN_INTERVAL, CHAPTER_BOSS_TIME_LIMIT, BOSS_TIME_LIMIT,
} from './config.js';
import {
  formatNumber, formatDuration, isMaxed, isBossStage, biomeFor, bonesForPrestige,
  boneMultiplier, expectedDps, squadDps, gunInfo, buyTier, caseOdds, rollCaseBonus, idleGoldPerSecond,
} from './formulas.js';
import {
  createState, statsOf, buyUpgrade, nextCost, isSkillUnlocked, canPrestige, prestige,
  applyOffline, saveToStorage, loadFromStorage, clearStorage, buyGun, nextGunCost, mergeGuns,
  mergeAll, equipGun, equipBest, isSlotUnlocked, casePrice, caseBlocker, openCase, pityLeft,
  cycleSpeed, availableSpeeds, hasSeen, markSeen, chooseChapter, sparedCount, allies, equipSkin,
} from './state.js';
import { Battle, WORLD } from './battle.js';
import { render, drawGun, GUN_EXTENTS, drawCatPreview } from './render.js';
import { drawGirlPortrait } from './girls.js';
import {
  PROLOGUE, JOIN_SCENES, CHAPTERS, HEROINES, ABILITY_TEXT, SPARE_LABEL, TROPHY_LABEL, TROPHY_KEYS, ALLY_BOSS_WEAKEN,
  endingFor, EPILOGUE, chapterForStage, heroineForStage,
} from './story.js';
import { questText, isQuestDone, claimQuest } from './quests.js';
import { initDialogue, playScene, isDialogueOpen } from './dialogue.js';
import { sfx, unlockAudio, setSoundEnabled } from './audio.js';

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
      const heroine = heroineForStage(stage);
      if (heroine) toast(`👑 ${heroine.name}: ${ABILITY_TEXT[heroine.ability]}. ${CHAPTER_BOSS_TIME_LIMIT} секунд!`);
      else if (boss) toast(`👑 Капитан Академии! Победи её за ${BOSS_TIME_LIMIT} секунд`);
      else if ((stage - 1) % 10 === 0 && stage > 1) toast(`🌍 Новая локация: ${biomeFor(stage).name}`);
      if (stage === state.maxStage) {
        for (const s of Object.values(SKILLS)) {
          if (s.unlockStage === stage) toast(`✨ Новый навык: ${s.name}!`);
        }
        CATS.forEach((c, k) => {
          if (k > 0 && c.unlockStage === stage) {
            toast(`🐱 ${c.name} вступает в отряд! Дай ему пушку в Арсенале`);
            renderArsenal();
          }
        });
      }
      if (boss) sfx('boss');
      storyOnStageStart(stage);
    },
    onStageFail(message) {
      toast(message);
    },
    onBossKill(stage, heroine) {
      sfx('win');
      if (heroine) storyOnHeroineDefeated(stage);
    },
    onPet(i) {
      if (state.stats.pets === 1) toast(`💗 ${CATS[i].name} мурчит и стреляет быстрее!`);
    },
    onKey(n) {
      sfx('key');
      toast(`🔑 +${n} ${n > 1 ? 'ключа' : 'ключ'} для золотого кейса!`);
    },
    onGunDrop(tier, placed) {
      toast(placed ? `📦 Из ящика выпал ${gunInfo(tier).name}!` : '📦 Арсенал полон — слей или продай пушки');
      renderArsenal();
    },
    sfx,
  });
}

// ---------- Сюжет ----------
async function playOnce(id, lines, title) {
  if (hasSeen(state, id)) return;
  markSeen(state, id);
  saveToStorage(state);
  sfx('story');
  await playScene(lines, { title });
}

function storyOnStageStart(stage) {
  if (stage !== state.maxStage) return;
  if (JOIN_SCENES[stage]) playOnce(`join${stage}`, JOIN_SCENES[stage], 'Новый боец');
  const ch = chapterForStage(stage);
  if (ch >= 0) {
    const intro = [...CHAPTERS[ch].intro];
    if (CHAPTERS[ch].final && allies(state).length) {
      const names = allies(state).map((h) => h.name).join(', ');
      intro.push({ who: 'narrator', text: `На помощь отряду пришли ${names}! Императрица ослаблена на ${Math.round(ALLY_BOSS_WEAKEN * allies(state).length * 100)}%.` });
    }
    playOnce(`intro${ch}`, intro, CHAPTERS[ch].title);
  }
}

async function storyOnHeroineDefeated(stage) {
  const ch = chapterForStage(stage);
  const chapter = CHAPTERS[ch];
  if (state.story.choices[ch]) return;
  markSeen(state, `outro${ch}`);
  const choice = await playScene(chapter.outro, {
    title: chapter.title,
    choices: [
      { label: `🤝 ${chapter.spareLabel ?? SPARE_LABEL}`, value: 'spare', primary: true },
      { label: `🔑 ${chapter.trophyLabel ?? TROPHY_LABEL} (+${TROPHY_KEYS})`, value: 'trophy' },
    ],
  });
  const reward = chooseChapter(state, ch, choice ?? 'spare');
  await playScene([chapter[choice ?? 'spare']], { title: chapter.title });
  if (reward) {
    toast(`👘 Новый костюм: ${SKINS[reward.skin].name}! Загляни во вкладку «Скины»`);
    if (reward.keys) sfx('key');
  }
  if (chapter.final && !hasSeen(state, 'ending')) {
    markSeen(state, 'ending');
    await playScene(endingFor(sparedCount(state)), { title: 'Финал' });
    await playScene(EPILOGUE, { title: 'Конец первой книги' });
  }
  saveToStorage(state);
  renderStory();
  renderWardrobe();
}

// Сохранения, пройденные до появления сюжета: показываем пропущенные развязки глав,
// чтобы игрок сделал выбор и получил костюмы героинь.
async function storyCatchUp() {
  await playOnce('prologue', PROLOGUE, 'Пролог');
  for (let ch = 0; ch < CHAPTERS.length; ch++) {
    const stage = (ch + 1) * 10;
    if (state.maxStage > stage && !state.story.choices[ch]) {
      markSeen(state, `intro${ch}`);
      await storyOnHeroineDefeated(stage);
    }
  }
}

// Повтор уже увиденной главы целиком — без выбора, с репликой по сделанному выбору.
function replayChapter(ch) {
  const chapter = CHAPTERS[ch];
  const choice = state.story.choices[ch];
  const lines = [...chapter.intro, ...(choice ? [...chapter.outro, chapter[choice]] : [])];
  playScene(lines, { title: chapter.title });
}

function renderStory() {
  const box = $('chapter-list');
  box.replaceChildren();
  const prologue = document.createElement('div');
  prologue.className = 'chapter';
  prologue.innerHTML = `<canvas width="96" height="96"></canvas>
    <div><div class="ch-title">Пролог. Пропажа Великой Рыбы</div>
    <div class="ch-sub">Мурград остался без Рыбы. Рыжик отправляется в поход.</div></div>`;
  const pb = document.createElement('button');
  pb.textContent = '▶ Читать';
  pb.onclick = () => playScene(PROLOGUE, { title: 'Пролог' });
  prologue.append(pb);
  const pc = prologue.querySelector('canvas').getContext('2d');
  pc.fillStyle = '#352a5a';
  pc.fillRect(0, 0, 96, 96);
  drawCatPreview(pc, 0, state.catSkins[0], 96, 96);
  box.append(prologue);

  CHAPTERS.forEach((chapter, ch) => {
    const h = HEROINES[ch];
    const stage = (ch + 1) * 10;
    const choice = state.story.choices[ch];
    const seen = hasSeen(state, `intro${ch}`);
    const el = document.createElement('div');
    el.className = 'chapter' + (seen ? '' : ' locked');
    el.style.setProperty('--chapter-accent', h.accent);
    const status = choice === 'spare' ? '🤝 Пощажена — придёт на помощь'
      : choice === 'trophy' ? `🔑 Трофей взят (+${TROPHY_KEYS} ключа)`
        : seen ? '⚔️ Бой не окончен' : `🔒 Этап ${stage}`;
    el.innerHTML = `<canvas width="96" height="96"></canvas>
      <div><div class="ch-title">${chapter.title}</div>
      <div class="ch-sub">${seen ? `${h.name}, ${h.title.toLowerCase()} — ${ABILITY_TEXT[h.ability]}` : 'Глава ещё впереди'}</div>
      <div class="ch-status" style="color:${h.accent}">${status}</div></div>`;
    if (seen) {
      const b = document.createElement('button');
      b.textContent = '▶ Читать';
      b.onclick = () => replayChapter(ch);
      el.append(b);
    }
    const g = el.querySelector('canvas').getContext('2d');
    if (seen) {
      g.fillStyle = h.hair;
      g.fillRect(0, 0, 96, 96);
      drawGirlPortrait(g, h.key, 96, 96);
    } else {
      g.fillStyle = '#2a2147';
      g.fillRect(0, 0, 96, 96);
      g.font = '40px system-ui';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('❔', 48, 50);
    }
    box.append(el);
  });
  if (hasSeen(state, 'ending')) {
    const end = document.createElement('div');
    end.className = 'chapter';
    end.innerHTML = `<canvas width="96" height="96"></canvas><div><div class="ch-title">Финал</div>
      <div class="ch-sub">Пощажено героинь: ${sparedCount(state)} из ${CHAPTERS.length}</div></div>`;
    const b = document.createElement('button');
    b.textContent = '▶ Читать';
    b.onclick = () => playScene([...endingFor(sparedCount(state)), ...EPILOGUE], { title: 'Финал' });
    end.append(b);
    const g = end.querySelector('canvas').getContext('2d');
    g.font = '48px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('🐟', 48, 50);
    box.append(end);
  }
}

// ---------- Задания ----------
const questRows = [];
function questGoldReward() {
  return idleGoldPerSecond(Math.max(1, state.stage), statsOf(state), SPAWN_INTERVAL) * QUEST_GOLD_SECONDS;
}

function updateQuests() {
  const box = $('quest-list');
  state.quests.forEach((q, i) => {
    const sig = `${q.type}:${q.target}:${state.questsDone}`;
    let row = questRows[i];
    if (!row || row.sig !== sig) {
      const el = document.createElement('div');
      el.className = 'quest';
      el.innerHTML = `<div><div class="quest-text">${questText(q)}</div>
        <div class="quest-reward">Награда: 🔑 ${QUEST_TYPES[q.type].keys} и золото</div></div>
        <button>Забрать</button><div class="progress"><div></div></div>`;
      el.querySelector('button').onclick = () => {
        const r = claimQuest(state, i, questGoldReward());
        if (!r) return;
        sfx('key');
        toast(`✅ +${r.keys} 🔑 и 🪙 ${formatNumber(r.gold)}`);
        if (r.skin) toast(`👘 Новый костюм за задания: ${SKINS[r.skin].name}!`);
        updateQuests();
        renderWardrobe();
      };
      if (row) row.el.replaceWith(el);
      else box.append(el);
      row = questRows[i] = { el, sig, bar: el.querySelector('.progress > div'), btn: el.querySelector('button') };
    }
    row.bar.style.width = `${(q.progress / q.target) * 100}%`;
    row.btn.disabled = !isQuestDone(q);
    row.btn.textContent = isQuestDone(q) ? 'Забрать' : `${q.progress}/${q.target}`;
  });
  let done = $('quests-done');
  if (!done) {
    done = document.createElement('p');
    done.id = 'quests-done';
    done.className = 'quests-done';
    box.after(done);
  }
  const idolLeft = SKINS.idol.questsNeeded - state.questsDone;
  done.textContent = `Выполнено заданий: ${state.questsDone}` + (idolLeft > 0 ? ` · до костюма «${SKINS.idol.name}» осталось ${idolLeft}` : '');
}

// ---------- Гардероб ----------
let wardrobeCat = 0;
function renderWardrobe() {
  const cats = $('wardrobe-cats');
  cats.replaceChildren();
  CATS.forEach((cat, i) => {
    const open = isSlotUnlocked(state, i);
    const b = document.createElement('button');
    b.className = 'wardrobe-cat' + (i === wardrobeCat ? ' selected' : '') + (open ? '' : ' locked');
    const skin = state.catSkins[i];
    b.innerHTML = `<canvas width="220" height="220"></canvas><span class="cat-name">${cat.name}</span>
      <span class="cat-skin">${open ? (skin ? SKINS[skin].name : 'Без костюма') : `🔒 этап ${cat.unlockStage}`}</span>`;
    const g = b.querySelector('canvas').getContext('2d');
    g.fillStyle = '#211a3a';
    g.fillRect(0, 0, 220, 220);
    drawCatPreview(g, i, skin, 220, 220, 1, state.slots[i] ? gunInfo(state.slots[i]) : null);
    b.onclick = () => {
      if (!open) return toast(`🔒 ${cat.name} присоединится на этапе ${cat.unlockStage}`);
      wardrobeCat = i;
      renderWardrobe();
    };
    cats.append(b);
  });

  const list = $('skin-list');
  list.replaceChildren();
  for (const [key, skin] of Object.entries(SKINS)) {
    const owned = state.skins.includes(key);
    const wornBy = state.catSkins.indexOf(key);
    const b = document.createElement('button');
    b.className = 'skin' + (wornBy === wardrobeCat ? ' worn' : '') + (owned ? '' : ' locked');
    const heroineIdx = HEROINES.findIndex((h) => h.skin === key);
    const how = skin.questsNeeded ? `за ${skin.questsNeeded} заданий (${state.questsDone}/${skin.questsNeeded})`
      : `победи ${HEROINES[heroineIdx].name} на этапе ${(heroineIdx + 1) * 10}`;
    b.innerHTML = `<b>${owned ? '' : '🔒 '}${skin.name}</b>
      <span class="skin-bonus">${skin.desc}</span>
      <small>${owned ? (wornBy >= 0 ? `Надет: ${CATS[wornBy].name}${wornBy === wardrobeCat ? ' · нажми, чтобы снять' : ''}` : `Подарок: ${skin.from}`) : how}</small>`;
    b.onclick = () => {
      if (!owned) return toast(`🔒 Костюм «${skin.name}»: ${how}`);
      equipSkin(state, key, wardrobeCat);
      battle.refresh();
      sfx('buy');
      renderWardrobe();
    };
    list.append(b);
  }
}

// ---------- Касания по полю боя ----------
function setupFieldTaps() {
  canvas.addEventListener('pointerdown', (e) => {
    if (isDialogueOpen()) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WORLD.width;
    const y = ((e.clientY - rect.top) / rect.height) * WORLD.height;
    battle.tap(x, y);
  });
}

// ---------- Арсенал ----------
const iconCache = new Map();
function gunIcon(tier) {
  if (!iconCache.has(tier)) {
    // Иконка 80×48 (×2 для чётких экранов), пушка вписана по ширине и отцентрована.
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 96;
    const g = c.getContext('2d');
    const info = gunInfo(tier);
    const [x0, x1] = GUN_EXTENTS[info.family.key];
    const k = Math.min(2.2, 70 / (x1 - x0));
    g.scale(2, 2);
    g.translate(40, 24);
    g.scale(k, k);
    g.translate(-(x0 + x1) / 2, 0);
    drawGun(g, info.family.key, info.rarity.color);
    iconCache.set(tier, c.toDataURL());
  }
  return iconCache.get(tier);
}

let selected = -1; // индекс выбранной ячейки инвентаря

function select(i) {
  selected = i;
  const hint = $('arsenal-hint');
  if (i >= 0) {
    const info = gunInfo(state.guns[i]);
    hint.innerHTML = `<b style="color:${info.rarity.color}">${info.name}</b> (${info.rarity.name}, ур. ${info.tier}) — урон ×${formatNumber(info.power * info.family.damage)}, ` +
      `выстрелов ×${info.family.rate}${info.family.pellets > 1 ? `, дробь ×${info.family.pellets}` : ''}${info.family.pierce ? ', пробивает насквозь' : ''}. ` +
      'Нажми на такую же пушку или на котика.';
  } else {
    hint.textContent = 'Нажми на пушку, потом на такую же — они сольются в пушку уровнем выше. Нажми на пушку, потом на котика — он возьмёт её в лапы.';
  }
  renderArsenal();
}

function onCellClick(i) {
  const tier = state.guns[i];
  if (selected < 0) {
    if (tier) select(i);
    return;
  }
  if (selected === i) return select(-1);
  if (tier && tier === state.guns[selected]) {
    if (mergeGuns(state, selected, i)) {
      sfx('merge');
      popCell = i;
      if (state.guns[i] === state.stats.bestGun && state.guns[i] > 1) toast(`✨ Новая пушка: ${gunInfo(state.guns[i]).name}!`);
    } else if (tier >= MAX_GUN_TIER) {
      toast('Это уже самая мощная пушка!');
    }
    return select(-1);
  }
  if (!tier) {
    // перекладываем в пустую ячейку
    state.guns[i] = state.guns[selected];
    state.guns[selected] = 0;
    return select(-1);
  }
  select(i);
}

function onSlotClick(k) {
  if (!isSlotUnlocked(state, k)) return toast(`🔒 ${CATS[k].name} присоединится на этапе ${CATS[k].unlockStage}`);
  if (selected < 0) return toast(`${CATS[k].name}: ${CATS[k].bonus}`);
  if (equipGun(state, selected, k)) {
    sfx('buy');
    battle.refresh();
  }
  select(-1);
}

let popCell = -1;
function renderArsenal() {
  const squad = battle?.squad ?? statsOf(state);
  const box = $('squad');
  box.replaceChildren();
  CATS.forEach((cat, k) => {
    const open = isSlotUnlocked(state, k);
    const tier = state.slots[k];
    const el = document.createElement('button');
    el.className = 'slot' + (open ? '' : ' locked') + (selected >= 0 && open ? ' target' : '');
    el.style.borderColor = tier && open ? gunInfo(tier).rarity.color : '';
    const c = squad.cats[k];
    el.innerHTML = `<span class="cat-name">${open ? cat.name : '🔒 ' + cat.name}</span>
      <span class="cat-bonus">${open ? cat.bonus : 'Откроется на этапе ' + cat.unlockStage}</span>
      <span class="slot-gun">${tier && open ? `<img src="${gunIcon(tier)}" alt="${gunInfo(tier).name}">` : '—'}</span>
      <span class="slot-dps">${c ? formatNumber(expectedDps(c) * c.pellets) + ' урона/с' : open ? 'дай пушку' : ''}</span>`;
    el.onclick = () => onSlotClick(k);
    box.append(el);
  });

  const inv = $('inventory');
  inv.replaceChildren();
  const selTier = selected >= 0 ? state.guns[selected] : 0;
  state.guns.forEach((tier, i) => {
    const cell = document.createElement('button');
    cell.className = 'cell' + (i === selected ? ' selected' : '') + (selTier && i !== selected && tier === selTier ? ' match' : '') + (i === popCell ? ' pop' : '');
    if (tier) {
      const info = gunInfo(tier);
      cell.style.borderColor = i === selected ? '' : info.rarity.color + '88';
      cell.innerHTML = `<span class="tier" style="color:${info.rarity.color}">${tier}</span><img src="${gunIcon(tier)}" alt="${info.name}">`;
      cell.title = info.name;
    }
    cell.onclick = () => onCellClick(i);
    inv.append(cell);
  });
  popCell = -1;
  updateBuyGun();
}

function updateBuyGun() {
  const cost = nextGunCost(state);
  const full = !state.guns.includes(0);
  const btn = $('buy-gun');
  btn.disabled = full || state.gold < cost;
  btn.innerHTML = full ? 'Арсенал полон<small>слей пушки</small>'
    : `🔫 Купить · 🪙 ${formatNumber(cost)}<small>${gunInfo(buyTier(state.levels.forge)).name}</small>`;
}

function setupArsenal() {
  $('buy-gun').onclick = () => {
    const i = buyGun(state);
    if (i < 0) return;
    sfx('buy');
    popCell = i;
    renderArsenal();
  };
  $('merge-all').onclick = () => {
    const n = mergeAll(state);
    if (n > 0) {
      sfx('merge');
      toast(`⚡ Слияний: ${n}`);
    } else {
      toast('Нет одинаковых пушек для слияния');
    }
    select(-1);
  };
  $('equip-best').onclick = () => {
    if (equipBest(state)) {
      sfx('buy');
      battle.refresh();
      toast('⭐ Котики взяли лучшие пушки');
    }
    select(-1);
  };
  $('sound-btn').onclick = () => {
    state.sound = !state.sound;
    setSoundEnabled(state.sound);
    updateSoundBtn();
  };
  // Звук разрешается только после первого касания страницы.
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
}

function updateSoundBtn() {
  $('sound-btn').textContent = state.sound ? '🔊' : '🔇';
}

// ---------- Кейсы ----------
const caseEls = {};
const BLOCKER_TEXT = { full: 'Арсенал полон', gold: 'Не хватает золота', keys: 'Нужен ключ 🔑' };

function buildCases() {
  const grid = $('case-grid');
  for (const [key, c] of Object.entries(CASES)) {
    const card = document.createElement('div');
    card.className = `case-card ${key}`;
    card.innerHTML = `<div class="case-icon">${c.icon}</div><div class="case-name">${c.name}</div>
      <div class="odds"></div><div class="pity"></div><button class="open-btn"></button>`;
    const btn = card.querySelector('.open-btn');
    btn.onclick = () => startRoulette(key);
    grid.append(card);
    caseEls[key] = { odds: card.querySelector('.odds'), pity: card.querySelector('.pity'), btn, base: -1 };
  }
}

function updateCases() {
  $('cases-gold').textContent = formatNumber(state.gold);
  $('cases-keys').textContent = state.keys;
  const base = buyTier(state.levels.forge);
  for (const [key, c] of Object.entries(CASES)) {
    const el = caseEls[key];
    // список шансов зависит только от уровня Кузни — перерисовываем, когда он меняется
    if (el.base !== base) {
      el.base = base;
      el.odds.innerHTML = caseOdds(key).map(({ bonus, chance }) => {
        const info = gunInfo(base + bonus);
        return `<div><span style="color:${info.rarity.color}">${info.name}</span><span>${(chance * 100).toFixed(0)}%</span></div>`;
      }).join('');
    }
    el.pity.textContent = c.pity
      ? (pityLeft(state) <= 1 ? 'Следующий — гарантированно +3!' : `Гарантия +3 через ${pityLeft(state)}`)
      : '';
    const blocker = caseBlocker(state, key);
    const price = c.currency === 'gold' ? `🪙 ${formatNumber(casePrice(state, key))}` : `🔑 ${casePrice(state, key)}`;
    el.btn.disabled = !!blocker;
    el.btn.textContent = blocker && blocker !== 'gold' ? BLOCKER_TEXT[blocker] : `Открыть · ${price}`;
  }
  document.querySelector('[data-tab="cases"]').classList.toggle('badge', state.keys > 0 && state.guns.includes(0));
}

// ---------- Рулетка ----------
const REEL_ITEMS = 48;
const WIN_INDEX = 42;
const ITEM_STEP = 84 + 6; // ширина ячейки + зазор, как в style.css
let spin = null;

function startRoulette(key) {
  const blocker = caseBlocker(state, key);
  if (blocker) return toast(BLOCKER_TEXT[blocker]);
  const result = openCase(state, key);
  if (!result) return;
  updateCases();
  if (!$('panel-arsenal').hidden) renderArsenal();

  const c = CASES[key];
  $('roulette-title').textContent = `${c.icon} ${c.name}`;
  $('roulette-card').classList.remove('jackpot');
  $('roulette-result').textContent = '';
  $('roulette-skip').hidden = false;
  $('roulette-again').hidden = true;
  $('roulette-take').hidden = true;
  $('roulette').hidden = false;

  const reel = $('reel');
  reel.replaceChildren();
  const base = buyTier(state.levels.forge);
  for (let i = 0; i < REEL_ITEMS; i++) {
    // соседние ячейки показывают честные шансы этого кейса
    const tier = i === WIN_INDEX ? result.tier : Math.min(MAX_GUN_TIER, base + rollCaseBonus(key));
    const info = gunInfo(tier);
    const item = document.createElement('div');
    item.className = 'reel-item';
    item.style.borderColor = info.rarity.color;
    item.innerHTML = `<img src="${gunIcon(tier)}" alt=""><span style="color:${info.rarity.color}">${info.name}</span>`;
    reel.append(item);
  }

  const windowW = $('reel-window').clientWidth;
  const jitter = (Math.random() - 0.5) * 84 * 0.7;
  const target = WIN_INDEX * ITEM_STEP + 42 - windowW / 2 + jitter;
  reel.style.transition = 'none';
  reel.style.transform = 'translateX(0)';
  void reel.offsetWidth; // применяем стартовую позицию до запуска анимации
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduced ? 0.6 : 4.6;
  reel.style.transition = `transform ${duration}s cubic-bezier(0.08, 0.7, 0.12, 1)`;
  reel.style.transform = `translateX(${-target}px)`;

  spin = { key, result, target, lastIndex: -1, raf: 0, done: false };
  const tick = () => {
    if (!spin || spin.done) return;
    const x = new DOMMatrixReadOnly(getComputedStyle(reel).transform).m41;
    const idx = Math.floor((-x + windowW / 2) / ITEM_STEP);
    if (idx !== spin.lastIndex) {
      spin.lastIndex = idx;
      sfx('tick');
    }
    spin.raf = requestAnimationFrame(tick);
  };
  spin.raf = requestAnimationFrame(tick);
  reel.addEventListener('transitionend', finishRoulette, { once: true });
}

function finishRoulette() {
  if (!spin || spin.done) return;
  spin.done = true;
  cancelAnimationFrame(spin.raf);
  const reel = $('reel');
  reel.style.transition = 'none';
  reel.style.transform = `translateX(${-spin.target}px)`;
  reel.children[WIN_INDEX].classList.add('win');

  const { tier, bonus, jackpot, forced } = spin.result;
  const info = gunInfo(tier);
  const note = jackpot ? '🎉 СУПЕРПРИЗ!' : forced ? '🛡️ Сработала гарантия!' : bonus > 0 ? `+${bonus} к уровню Кузни` : 'Обычная пушка';
  $('roulette-result').innerHTML = `${note}<br>Выпало: <b style="color:${info.rarity.color}">${info.name}</b> · ур. ${tier}`;
  if (jackpot) {
    $('roulette-card').classList.add('jackpot');
    confetti();
    sfx('jackpot');
  } else {
    sfx('reveal');
  }
  if (tier === state.stats.bestGun && tier > 1) toast(`✨ Лучшая пушка в коллекции: ${info.name}!`);

  $('roulette-skip').hidden = true;
  $('roulette-take').hidden = false;
  const again = $('roulette-again');
  again.hidden = false;
  again.disabled = !!caseBlocker(state, spin.key);
  const c = CASES[spin.key];
  again.textContent = c.currency === 'gold' ? `Ещё · 🪙 ${formatNumber(casePrice(state, spin.key))}` : `Ещё · 🔑 ${casePrice(state, spin.key)}`;
}

function closeRoulette() {
  $('roulette').hidden = true;
  spin = null;
  updateCases();
  if (!$('panel-arsenal').hidden) renderArsenal();
}

function confetti() {
  const colors = ['#ffb800', '#ff4d6d', '#4cc9f0', '#5bd16a', '#b46cff'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.left = `${Math.random() * 100}vw`;
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    document.body.append(p);
    setTimeout(() => p.remove(), 3800);
  }
}

function setupRoulette() {
  $('roulette-skip').onclick = finishRoulette;
  $('roulette-take').onclick = closeRoulette;
  $('roulette-again').onclick = () => spin && startRoulette(spin.key);
}

// ---------- Скорость игры ----------
function updateSpeedBtn() {
  const btn = $('speed-btn');
  btn.textContent = `×${state.speed}`;
  btn.classList.toggle('fast', state.speed > 1);
}

function setupSpeed() {
  $('speed-btn').onclick = () => {
    const speed = cycleSpeed(state);
    updateSpeedBtn();
    if (speed === 1 && !availableSpeeds(state).includes(5)) toast('⏩ Скорость ×5 откроется после первого перерождения');
    else toast(speed === 1 ? '▶️ Обычная скорость' : `⏩ Скорость игры ×${speed}`);
  };
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
    case 'forge': return `Новые пушки: <b>ур. ${buyTier(state.levels.forge)}</b>`;
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
      if (buyUpgrade(state, key, buyAmount) > 0) {
        battle.refresh();
        sfx('buy');
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
      if (tab.dataset.tab === 'arsenal') renderArsenal();
      if (tab.dataset.tab === 'cases') updateCases();
      if (tab.dataset.tab === 'skins') renderWardrobe();
      if (tab.dataset.tab === 'story') {
        renderStory();
        updateQuests();
      }
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
      text: `Ты получишь <b>${gain}</b> 🦴. Урон и золото станут <b>×${boneMultiplier(state.bones + gain).toFixed(1)}</b>.<br>Этап, золото, улучшения и оружие сбросятся, ключи 🔑 останутся.`,
      actions: [
        {
          label: 'Да, переродиться!',
          onClick() {
            const got = prestige(state);
            newBattle();
            select(-1);
            saveToStorage(state);
            toast(state.stats.prestiges === 1
              ? `🦴 +${got} косточек! Открыта скорость ×5 ⏩`
              : `🦴 +${got} косточек! Котик стал сильнее`);
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
            select(-1);
            updateSpeedBtn();
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
  document.querySelector('[data-tab="profile"]').classList.toggle('badge', gain > 0 && gain >= Math.max(1, state.bones * 0.5));
}

function updateStats(stats) {
  const rows = [
    ['Урон отряда в секунду', formatNumber(squadDps(stats))],
    ['Лучшая пушка', gunInfo(state.stats.bestGun).name],
    ['Слияний', formatNumber(state.stats.merges)],
    ['Открыто кейсов', formatNumber(state.stats.casesOpened)],
    ['Суперпризов', formatNumber(state.stats.jackpots)],
    ['Ударов лапкой', formatNumber(state.stats.taps)],
    ['Котиков поглажено', formatNumber(state.stats.pets)],
    ['Выполнено заданий', formatNumber(state.questsDone)],
    ['Пощажено героинь', `${sparedCount(state)} из ${CHAPTERS.length}`],
    ['Костюмов', `${state.skins.length} из ${Object.keys(SKINS).length}`],
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
  if (!$('panel-arsenal').hidden) updateBuyGun();
  updatePrestige();
  if (!$('panel-profile').hidden) updateStats(stats);
  if (!$('panel-cases').hidden) updateCases();
  else document.querySelector('[data-tab="cases"]').classList.toggle('badge', state.keys > 0 && state.guns.includes(0));
  if (!$('panel-story').hidden) updateQuests();
  document.querySelector('[data-tab="story"]').classList.toggle('badge', state.quests.some(isQuestDone));
}

// ---------- Игровой цикл ----------
let last = performance.now();
let saveTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); // защита от скачков после сворачивания вкладки
  last = now;
  // Ускорение: несколько шагов симуляции за кадр — поведение то же, что и на ×1.
  // Пока идёт сюжетная сцена, бой на паузе.
  if (!isDialogueOpen()) for (let i = 0; i < state.speed; i++) battle.update(dt);
  state.stats.playTime += dt; // реальное время, без учёта ускорения
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

setSoundEnabled(state.sound);
updateSoundBtn();
initDialogue({ catSkin: (i) => state.catSkins[i], sfx });
setupFieldTaps();
setupArsenal();
buildCases();
setupRoulette();
setupSpeed();
updateSpeedBtn();
buildSkills();
buildUpgrades();
setupTabs();
setupPrestige();
newBattle();
renderArsenal();
resizeCanvas();
updateUI(true);
if (offline) showOfflineModal(offline);
storyCatchUp();
requestAnimationFrame(frame);
