import { emptyCodex, type CodexState } from '../engine/codex';

const CODEX_KEY = 'chimera-battle-ctb:codex:v1';

export function loadCodexState(): CodexState {
  try {
    const raw = localStorage.getItem(CODEX_KEY);
    if (!raw) return emptyCodex();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.discoveredPartIds) || !Array.isArray(parsed.encounteredEnemyIds) || !Array.isArray(parsed.defeatedEnemyIds)) {
      return emptyCodex();
    }
    return parsed as CodexState;
  } catch {
    return emptyCodex();
  }
}

export function saveCodexState(codex: CodexState) {
  try {
    localStorage.setItem(CODEX_KEY, JSON.stringify(codex));
  } catch {
    // 保存容量オーバー等は無視(図鑑保存は補助機能のため、ゲーム進行自体には影響させない)
  }
}
