import type { RunState } from '../engine/run';

// ============================================================
// セーブデータ(仕様書38章)。CTB×MP×新データモデルへの移行により、
// TEST18/19時代のセーブとはスキーマが全く異なる。バージョンタグを持たせ、
// 不一致の場合は無条件破壊(silent wipe)ではなく、はっきり通知したうえで
// 新規ランとして扱う(旧データはlocalStorageに残したまま上書きしない)。
// ============================================================

// v1: CTB統合版の初版。
// v2: Phase 1(敵所持部位ドロップ)でRunStateへ lastDefeatedEnemyId を追加。
//     追加フィールドは表示用のnull許容値のみなので、v1のセーブは破棄せず移行できる。
const SAVE_VERSION = 2;
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

// 旧バージョンのセーブを現行RunStateへ持ち上げる。移行不能なら null を返す
// (= 破棄してユーザーへ通知する)。追加フィールドに安全な既定値を与えられる範囲は移行する。
export function migrate(version: number | undefined, state: RunState): RunState | null {
  let current = state;
  let v = version;
  if (v === 1) {
    // v1 -> v2: Phase 1 で lastDefeatedEnemyId を追加。既存ランには「直前に倒した敵」の
    // 記録が無いため null 始まりにする(報酬画面の見出しが敵名なしになるだけで進行に影響しない)。
    current = { ...current, lastDefeatedEnemyId: current.lastDefeatedEnemyId ?? null };
    v = 2;
  }
  return v === SAVE_VERSION ? current : null;
}

export function loadRunState(): LoadResult {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { state: null, incompatibleFound: false };
    const parsed = JSON.parse(raw) as Partial<SaveEnvelope>;
    if (!parsed.state) {
      localStorage.removeItem(SAVE_KEY);
      return { state: null, incompatibleFound: true };
    }
    const migrated = migrate(parsed.version, parsed.state);
    if (!migrated) {
      // 移行できないバージョン: 破壊はするが、呼び出し側がユーザーへ通知できるようフラグを立てる。
      localStorage.removeItem(SAVE_KEY);
      return { state: null, incompatibleFound: true };
    }
    parsed.state = migrated;
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
