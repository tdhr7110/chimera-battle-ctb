// ============================================================
// Phase 4: 効果音。TEST8のsoundManagerを土台に、CTB版のイベント構成へ合わせて作り直したもの。
//
// 方針(移植元から引き継いだもの):
//   - Web Audio APIで生成した短いトーンのみを使う。外部音源ファイルは一切読み込まない。
//   - ブラウザの自動再生制限に合わせ、最初のユーザー操作でAudioContextを生成・resumeする。
//   - 音声が使えない環境・再生に失敗した環境でも、ゲーム進行は絶対に止めない(全てtry/catch)。
//
// CTB版で変えたところ:
//   - 種別を現行の戦闘イベント(通常攻撃/強攻撃/回避/防御/状態異常/回復/コマンド解放/
//     部位獲得/勝利/敗北)に合わせた。
//   - ミュート状態も音量と一緒にlocalStorageへ保存する(移植元は音量のみだった)。
//   - CTBの進行速度には一切関与しない。SEは鳴らすだけで、待ち時間を作らない。
//     旧リアルタイム版の1x/2x/4x速度システムは移植していない。
// ============================================================

const STORAGE_KEY = 'chimera-battle-ctb:audio:v1';

export type SEKind =
  | 'attack' // 通常攻撃
  | 'heavy' // 強攻撃(重量級コマンド)
  | 'evade' // 回避
  | 'guard' // 防御
  | 'status' // 状態異常の付与
  | 'heal' // 回復
  | 'unlock' // コマンド解放
  | 'part' // 部位獲得
  | 'victory' // 勝利
  | 'defeat'; // 敗北

export interface AudioSettings {
  muted: boolean;
  volume: number; // 0..1
}

const DEFAULTS: AudioSettings = { muted: false, volume: 0.5 };

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULTS.muted,
      volume:
        typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
          ? Math.min(1, Math.max(0, parsed.volume))
          : DEFAULTS.volume,
    };
  } catch {
    // localStorageが使えない環境(プライベートモード等)でも既定値で動かす
    return DEFAULTS;
  }
}

let settings: AudioSettings = loadSettings();
let audioCtx: AudioContext | null = null;
let unlockAttached = false;
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくてもゲーム進行には影響させない
  }
}

function notify() {
  for (const l of listeners) l();
}

export function subscribeAudioSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getAudioSettings(): AudioSettings {
  return settings;
}

export function setMuted(muted: boolean) {
  settings = { ...settings, muted };
  persist();
  notify();
}

export function setVolume(volume: number) {
  settings = { ...settings, volume: Math.min(1, Math.max(0, volume)) };
  persist();
  notify();
}

function createCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

// 最初のユーザー操作(ポインタ/キー/タッチ)でAudioContextを生成・resumeする。
export function initAudioUnlock() {
  if (unlockAttached || typeof window === 'undefined') return;
  unlockAttached = true;
  const unlock = () => {
    try {
      if (!audioCtx) audioCtx = createCtx();
      if (audioCtx && audioCtx.state === 'suspended') void audioCtx.resume();
    } catch {
      // 音声が利用できない環境でもゲーム進行を止めない
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('touchstart', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
}

function getCtx(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = createCtx();
    if (audioCtx && audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

interface Tone {
  freq: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  slideTo?: number;
}

// 種別ごとの簡易トーン定義。CTBは「軽い手数」と「重い一撃」の対比が要なので、
// 通常攻撃は短く高め、強攻撃は低く長めにして手触りの差を出している。
const TONE_TABLE: Record<SEKind, Tone[]> = {
  attack: [{ freq: 240, duration: 0.055, type: 'square', gain: 0.45 }],
  heavy: [
    { freq: 130, duration: 0.09, type: 'square', gain: 0.55 },
    { freq: 90, duration: 0.13, type: 'sawtooth', gain: 0.45, slideTo: 60 },
  ],
  evade: [{ freq: 700, duration: 0.07, type: 'sine', gain: 0.3, slideTo: 1100 }],
  guard: [{ freq: 180, duration: 0.15, type: 'sine', gain: 0.45, slideTo: 220 }],
  status: [{ freq: 190, duration: 0.14, type: 'sawtooth', gain: 0.35, slideTo: 130 }],
  heal: [
    { freq: 523, duration: 0.08, type: 'sine', gain: 0.35 },
    { freq: 659, duration: 0.12, type: 'sine', gain: 0.35 },
  ],
  unlock: [
    { freq: 587, duration: 0.08, type: 'triangle', gain: 0.4 },
    { freq: 784, duration: 0.08, type: 'triangle', gain: 0.4 },
    { freq: 1047, duration: 0.16, type: 'triangle', gain: 0.4 },
  ],
  part: [
    { freq: 440, duration: 0.07, type: 'sine', gain: 0.4 },
    { freq: 660, duration: 0.11, type: 'sine', gain: 0.4 },
  ],
  victory: [
    { freq: 523, duration: 0.1, type: 'sine', gain: 0.45 },
    { freq: 659, duration: 0.1, type: 'sine', gain: 0.45 },
    { freq: 784, duration: 0.1, type: 'sine', gain: 0.45 },
    { freq: 1047, duration: 0.3, type: 'sine', gain: 0.45 },
  ],
  defeat: [{ freq: 300, duration: 0.22, type: 'sawtooth', gain: 0.45, slideTo: 100 }],
};

const lastPlayedAt: Partial<Record<SEKind, number>> = {};
// 同種SEの過剰な同時発音を防ぐ最小間隔(多段ヒット等での音割れ対策)。
const MIN_INTERVAL_MS: Partial<Record<SEKind, number>> = { attack: 35, heavy: 60, status: 180, heal: 180, evade: 60 };

/** 効果音を鳴らす。失敗しても決して例外を投げない(ゲーム進行を止めないため)。 */
export function playSE(kind: SEKind) {
  try {
    if (settings.muted || settings.volume <= 0) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const minInterval = MIN_INTERVAL_MS[kind];
    const last = lastPlayedAt[kind];
    if (minInterval !== undefined && last !== undefined && now - last < minInterval) return;
    lastPlayedAt[kind] = now;

    const ctx = getCtx();
    // まだユーザー操作が無くresumeできていない場合は黙って諦める(例外にはしない)。
    if (!ctx || ctx.state !== 'running') return;

    let t = ctx.currentTime;
    for (const tone of TONE_TABLE[kind]) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.freq, t);
      if (tone.slideTo) osc.frequency.linearRampToValueAtTime(tone.slideTo, t + tone.duration);
      const peak = tone.gain * settings.volume;
      gainNode.gain.setValueAtTime(0.0001, t);
      gainNode.gain.linearRampToValueAtTime(peak, t + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t + tone.duration);
      osc.connect(gainNode).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + tone.duration + 0.02);
      t += tone.duration * 0.85;
    }
  } catch {
    // SE再生の失敗はゲーム進行に一切影響させない
  }
}
