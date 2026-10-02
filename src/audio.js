// Звуки синтезируются WebAudio на лету — никаких аудиофайлов.
// Браузеры разрешают звук только после первого касания, поэтому контекст создаётся лениво.
let ctx = null;
let master = null;
let enabled = true;
const lastPlayed = {};

export function setSoundEnabled(on) {
  enabled = on;
}

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

// Не даём одинаковым звукам звучать чаще, чем раз в minGap секунд.
function throttle(name, minGap) {
  const now = ctx.currentTime;
  if (now - (lastPlayed[name] ?? -1) < minGap) return false;
  lastPlayed[name] = now;
  return true;
}

function tone({ type = 'square', from, to = from, dur = 0.08, vol = 0.3, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur = 0.1, vol = 0.3, filter = 1200 }) {
  const t = ctx.currentTime;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = filter;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(lp).connect(gain).connect(master);
  src.start(t);
}

const SHOTS = {
  pistol:  () => tone({ from: 900, to: 300, dur: 0.06, vol: 0.12 }),
  smg:     () => tone({ from: 1200, to: 500, dur: 0.04, vol: 0.08 }),
  shotgun: () => noise({ dur: 0.12, vol: 0.25, filter: 900 }),
  rifle:   () => tone({ type: 'sawtooth', from: 700, to: 150, dur: 0.08, vol: 0.1 }),
  sniper:  () => { noise({ dur: 0.18, vol: 0.3, filter: 2500 }); tone({ from: 300, to: 60, dur: 0.2, vol: 0.15 }); },
  minigun: () => tone({ from: 1400, to: 700, dur: 0.03, vol: 0.06 }),
};

export function sfx(name, variant) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  switch (name) {
    case 'shot':
      if (throttle('shot', 0.07)) SHOTS[variant]?.();
      break;
    case 'coin':
      if (throttle('coin', 0.05)) {
        tone({ type: 'triangle', from: 1320, dur: 0.06, vol: 0.15 });
        tone({ type: 'triangle', from: 1760, dur: 0.1, vol: 0.15, delay: 0.05 });
      }
      break;
    case 'break':
      if (throttle('break', 0.05)) noise({ dur: 0.2, vol: 0.35, filter: 600 });
      break;
    case 'hurt':
      if (throttle('hurt', 0.15)) tone({ type: 'sawtooth', from: 220, to: 90, dur: 0.15, vol: 0.15 });
      break;
    case 'merge':
      [660, 880, 1320].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.12, vol: 0.2, delay: i * 0.06 }));
      break;
    case 'buy':
      tone({ type: 'triangle', from: 520, to: 780, dur: 0.1, vol: 0.18 });
      break;
    case 'skill':
      tone({ type: 'sine', from: 300, to: 1200, dur: 0.3, vol: 0.2 });
      break;
    case 'boss':
      tone({ type: 'sawtooth', from: 110, to: 70, dur: 0.6, vol: 0.2 });
      break;
    case 'tick':
      tone({ type: 'square', from: 1800, to: 1200, dur: 0.025, vol: 0.08 });
      break;
    case 'reveal':
      [784, 1047].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.18, vol: 0.2, delay: i * 0.09 }));
      break;
    case 'key':
      tone({ type: 'triangle', from: 1568, to: 2093, dur: 0.15, vol: 0.18 });
      break;
    case 'jackpot':
      [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.2, vol: 0.13, delay: i * 0.08 }));
      [1047, 1319, 1568].forEach((f) => tone({ type: 'triangle', from: f, dur: 0.8, vol: 0.12, delay: 0.5 }));
      break;
    case 'tap':
      if (throttle('tap', 0.04)) noise({ dur: 0.05, vol: 0.2, filter: 1800 });
      break;
    case 'purr':
      tone({ type: 'sine', from: 70, to: 60, dur: 0.5, vol: 0.25 });
      tone({ type: 'sine', from: 72, to: 64, dur: 0.5, vol: 0.2, delay: 0.5 });
      break;
    case 'dialog':
      if (throttle('dialog', 0.06)) tone({ type: 'triangle', from: 660 + Math.random() * 120, dur: 0.03, vol: 0.05 });
      break;
    case 'story':
      [392, 523, 659].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.25, vol: 0.15, delay: i * 0.12 }));
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.14, vol: 0.12, delay: i * 0.1 }));
      break;
  }
}
