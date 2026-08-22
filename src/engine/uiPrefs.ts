// ============================================================
// UI/操作まわりの設定。音量・ミュートは soundManager 側が持ち、
// ここはそれ以外の「遊び方の好み」を扱う。
//
// soundManager と同じ作りにしてある(Reactの外に状態を置き、購読で再描画する)。
// localStorage が使えない環境でも既定値で動き、保存失敗はゲーム進行に影響させない。
// ============================================================

const STORAGE_KEY = 'chimera-battle-ctb:ui-prefs:v1';

export interface UiPrefs {
  /**
   * コマンド実行後に大カテゴリ表示へ戻すか。
   * false のままだと同じカテゴリを開いたまま次の手を選べる(連続で同系統を撃ちたい人向け)。
   */
  returnToCategories: boolean;
}

const DEFAULTS: UiPrefs = { returnToCategories: false };

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      returnToCategories:
        typeof parsed.returnToCategories === 'boolean' ? parsed.returnToCategories : DEFAULTS.returnToCategories,
    };
  } catch {
    return DEFAULTS;
  }
}

let prefs: UiPrefs = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 保存できなくてもゲーム進行には影響させない
  }
}

export function getUiPrefs(): UiPrefs {
  return prefs;
}

export function setUiPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) {
  prefs = { ...prefs, [key]: value };
  persist();
  for (const l of listeners) l();
}

export function subscribeUiPrefs(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
