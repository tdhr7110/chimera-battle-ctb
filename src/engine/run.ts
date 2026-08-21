import { ENEMIES, getEnemy } from '../data/enemies';
import { PARTS, getPart } from '../data/parts';
import { getStarter } from '../data/starters';
import { PLAYER_BASE } from './ctbEngine';
import type { EnemyTier, PartDef } from '../data/types';

// ============================================================
// 統合版(本編)のラン進行状態。TEST18/19の「素体選択→待機→敵選択→戦闘→報酬→待機」
// というゲームループを、CTB専用版のデータモデル(部位10種・敵6種)の上で再構築したもの。
//
// 重要な設計判断:
//   - 戦闘ロジックそのもの(CtbEngine)は一切変更しない。ここではRunStateと
//     CtbEngineの間を橋渡しするだけ(装備部位を渡す・終了後のHPを受け取る)。
//   - 部位に接続コスト/容量の概念がまだ第1弾データには無いため、暫定的に
//     「装着数の上限」だけで管理する(Excelの容量データが揃ったら置き換える)。
//   - 敵45体・部位80種はまだ無いため、現行の6敵・10部位から抽選する
//     (同じ敵に複数回遭遇することがあるのは既知の暫定仕様)。
// ============================================================

export type GamePhase = 'title' | 'starterSelect' | 'prep' | 'enemySelect' | 'battle' | 'reward' | 'result';

// 仕様書のTEST18パターン(通常/通常/エリート/通常/中ボス/通常/エリート/ボス)を踏襲しつつ、
// 現行6敵ではミニボスまで区別できないためboss 1種類にまとめた7戦構成にしている。
const BATTLE_SEQUENCE: EnemyTier[] = ['normal', 'normal', 'elite', 'normal', 'normal', 'elite', 'boss'];
export const TOTAL_BATTLES = BATTLE_SEQUENCE.length;

export const MAX_EQUIPPED_PARTS = 4; // 暫定の装着上限(Excelの接続容量データが揃うまでの仮仕様)
export const CORE_HP_BASE = PLAYER_BASE.maxHp;
export const POST_VICTORY_RECOVERY_PCT = 0.4; // 勝利後の小休止による自然回復割合(TEST18を踏襲した仮値)

export interface RunState {
  phase: GamePhase;
  battleIndex: number; // 1-based
  coreHp: number;
  starterId: string | null;
  equippedPartIds: string[];
  inventoryPartIds: string[];
  currentEnemyId: string | null;
  enemyCandidateIds: string[];
  dropCandidateIds: string[];
  resultOutcome: 'victory' | 'defeat' | null;
  seenIntro: boolean; // 遊び方を一度でも見たか(GAME STARTのたび強制表示しないため)
}

export function createTitleState(seenIntro: boolean): RunState {
  return {
    phase: 'title',
    battleIndex: 1,
    coreHp: CORE_HP_BASE,
    starterId: null,
    equippedPartIds: [],
    inventoryPartIds: [],
    currentEnemyId: null,
    enemyCandidateIds: [],
    dropCandidateIds: [],
    resultOutcome: null,
    seenIntro,
  };
}

export function startNewRun(state: RunState): RunState {
  return { ...createTitleState(state.seenIntro), phase: 'starterSelect' };
}

export function selectStarter(state: RunState, starterId: string): RunState {
  const starter = getStarter(starterId);
  return {
    ...state,
    phase: 'prep',
    starterId,
    equippedPartIds: starter ? [...starter.partIds] : [],
  };
}

export function equippedPartDefs(state: RunState): PartDef[] {
  return state.equippedPartIds.map((id) => getPart(id)).filter((p): p is PartDef => !!p);
}

export function ownedPartIds(state: RunState): string[] {
  return [...state.equippedPartIds, ...state.inventoryPartIds];
}

export function equipPart(state: RunState, partId: string): RunState {
  if (state.equippedPartIds.includes(partId)) return state;
  if (state.equippedPartIds.length >= MAX_EQUIPPED_PARTS) return state;
  return {
    ...state,
    equippedPartIds: [...state.equippedPartIds, partId],
    inventoryPartIds: state.inventoryPartIds.filter((id) => id !== partId),
  };
}

export function unequipPart(state: RunState, partId: string): RunState {
  if (!state.equippedPartIds.includes(partId)) return state;
  return {
    ...state,
    equippedPartIds: state.equippedPartIds.filter((id) => id !== partId),
    inventoryPartIds: [...state.inventoryPartIds, partId],
  };
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (pool.length > 0 && out.length < count) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

export function enterEnemySelect(state: RunState): RunState {
  const tier = BATTLE_SEQUENCE[Math.min(state.battleIndex, TOTAL_BATTLES) - 1];
  const pool = ENEMIES.filter((e) => e.tier === tier);
  const candidates = pickRandom(pool.length > 0 ? pool : ENEMIES, Math.min(3, pool.length > 0 ? pool.length : ENEMIES.length));
  return { ...state, phase: 'enemySelect', enemyCandidateIds: candidates.map((e) => e.id) };
}

export function chooseEnemy(state: RunState, enemyId: string): RunState {
  return { ...state, phase: 'battle', currentEnemyId: enemyId, enemyCandidateIds: [] };
}

export function finishBattle(state: RunState, result: 'won' | 'lost', finalHp: number): RunState {
  if (result === 'lost') {
    return { ...state, phase: 'result', resultOutcome: 'defeat', coreHp: 0 };
  }
  const recovered = Math.min(CORE_HP_BASE, Math.round(finalHp + CORE_HP_BASE * POST_VICTORY_RECOVERY_PCT));
  if (state.battleIndex >= TOTAL_BATTLES) {
    return { ...state, phase: 'result', resultOutcome: 'victory', coreHp: recovered, currentEnemyId: null };
  }
  const owned = new Set(ownedPartIds(state));
  const candidatePool = PARTS.filter((p) => !owned.has(p.id));
  const candidates = pickRandom(candidatePool, Math.min(3, candidatePool.length));
  return {
    ...state,
    phase: 'reward',
    coreHp: recovered,
    currentEnemyId: null,
    dropCandidateIds: candidates.map((p) => p.id),
  };
}

// wantEquip=trueかつ装着枠に空きがあればそのまま装着、空きが無ければインベントリへ保管する。
export function acceptDrop(state: RunState, partId: string, wantEquip: boolean): RunState {
  const next =
    wantEquip && state.equippedPartIds.length < MAX_EQUIPPED_PARTS
      ? { ...state, equippedPartIds: [...state.equippedPartIds, partId] }
      : { ...state, inventoryPartIds: [...state.inventoryPartIds, partId] };
  return advanceToNextBattle({ ...next, dropCandidateIds: [] });
}

export function skipDrop(state: RunState): RunState {
  return advanceToNextBattle({ ...state, dropCandidateIds: [] });
}

function advanceToNextBattle(state: RunState): RunState {
  return { ...state, phase: 'prep', battleIndex: state.battleIndex + 1 };
}

export function tierOfCurrentBattle(state: RunState): EnemyTier {
  return BATTLE_SEQUENCE[Math.min(state.battleIndex, TOTAL_BATTLES) - 1];
}

export function markIntroSeen(state: RunState): RunState {
  return { ...state, seenIntro: true };
}

export { getEnemy };
