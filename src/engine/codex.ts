// ============================================================
// 図鑑(仕様書3・28章)。ランの進行状況(RunState)とは独立して、
// アカウント単位で「今までに発見した部位・遭遇した敵・撃破した敵」を蓄積する。
// ランをリセットしても図鑑の記録は消えない(TEST18/19のcodex.tsと同じ考え方)。
// ============================================================

export interface CodexState {
  discoveredPartIds: string[];
  encounteredEnemyIds: string[];
  defeatedEnemyIds: string[];
}

export function emptyCodex(): CodexState {
  return { discoveredPartIds: [], encounteredEnemyIds: [], defeatedEnemyIds: [] };
}

function addUnique(list: string[], id: string): string[] {
  return list.includes(id) ? list : [...list, id];
}

export function markPartsDiscovered(codex: CodexState, partIds: string[]): CodexState {
  let next = codex.discoveredPartIds;
  for (const id of partIds) next = addUnique(next, id);
  if (next === codex.discoveredPartIds) return codex;
  return { ...codex, discoveredPartIds: next };
}

export function markEnemyEncountered(codex: CodexState, enemyId: string): CodexState {
  const next = addUnique(codex.encounteredEnemyIds, enemyId);
  if (next === codex.encounteredEnemyIds) return codex;
  return { ...codex, encounteredEnemyIds: next };
}

export function markEnemyDefeated(codex: CodexState, enemyId: string): CodexState {
  const next = addUnique(codex.defeatedEnemyIds, enemyId);
  if (next === codex.defeatedEnemyIds) return codex;
  return { ...codex, defeatedEnemyIds: next };
}
