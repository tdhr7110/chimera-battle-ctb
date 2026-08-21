import type { RunState } from '../engine/run';

// ============================================================
// セーブデータ(仕様書38章)。CTB×MP×新データモデルへの移行により、
// TEST18/19時代のセーブとはスキーマが全く異なる。バージョンタグを持たせ、
// 不一致の場合は無条件破壊(silent wipe)ではなく、はっきり通知したうえで
// 新規ランとして扱う(旧データはlocalStorageに残したまま上書きしない)。
// ============================================================

const SAVE_VERSION = 1; // CTB統合版の初版。データモデルが変わるたびに必ず上げる。
const SAVE_KEY = 'chimera-battle-ctb:run:v1';
const INTRO_SEEN_KEY = 'chimera-battle-ctb:intro-seen:v1';

interface SaveEnvelope {
  version: number;
  state: RunState;
}

export interface LoadResult {
  state: RunState | null;
  incompatibleFound: boolean; // 旧バージョンのセーブが存在した(=移行できず破棄した)ことをUIへ伝える
}

export function loadRunState(): LoadResult {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { state: null, incompatibleFound: false };
    const parsed = JSON.parse(raw) as Partial<SaveEnvelope>;
    if (parsed.version !== SAVE_VERSION || !parsed.state) {
      // 互換性のないバージョン: 破壊はするが、呼び出し側がユーザーへ通知できるようフラグを立てる。
      localStorage.removeItem(SAVE_KEY);
      return { state: null, incompatibleFound: true };
    }
    if (parsed.state.phase === 'battle') {
      // 戦闘中の状態は保存対象外(チェックポイント方式)。安全なprepへ差し戻す。
      return { state: { ...parsed.state, phase: 'prep' }, incompatibleFound: false };
    }
    return { state: parsed.state, incompatibleFound: false };
  } catch {
    return { state: null, incompatibleFound: false };
  }
}

export function saveRunState(state: RunState) {
  if (state.phase === 'title' || state.phase === 'result') {
    clearRunState();
    return;
  }
  try {
    const envelope: SaveEnvelope = { version: SAVE_VERSION, state };
    localStorage.setItem(SAVE_KEY, JSON.stringify(envelope));
  } catch {
    // 保存容量オーバー等は無視(セーブは補助機能のため、ゲーム進行自体には影響させない)
  }
}

export function clearRunState() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}

export function loadIntroSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveIntroSeen() {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    // ignore
  }
}
