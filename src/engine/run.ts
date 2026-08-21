import { ENEMIES, getEnemy } from '../data/enemies';
import { getEnemyDrop, RARE_DROP_CHANCE_PCT } from '../data/enemyDrops';
import { PARTS, getPart } from '../data/parts';
import { getStarter } from '../data/starters';
import { CTB_MP_MAX_BASE, PLAYER_BASE } from './ctbEngine';
import { computePlayerModifiers } from './modifiers';
import type { EnemyTier, PartDef } from '../data/types';

// ============================================================
// 統合版(本編)のラン進行状態。TEST18/19の「素体選択→待機→敵選択→戦闘→報酬→待機」
// というゲームループを、CTB専用版のデータモデル(部位10種・敵6種)の上で再構築したもの。
//
// 重要な設計判断:
//   - 戦闘ロジックそのもの(CtbEngine)は一切変更しない。ここではRunStateと
//     CtbEngineの間を橋渡しするだけ(装備部位を渡す・終了後のHPを受け取る)。
//   - 部位に個別の接続コストの概念はまだ無いため、「装着数の上限」(MAX_EQUIPPED_PARTS、
//     Excel36シナジーの最終段階の必要数に合わせた6)だけで管理する。
//   - 敵45体はまだ無いため、現行6敵から抽選する
//     (同じ敵に複数回遭遇することがあるのは既知の暫定仕様)。部位は80種すべて接続済み。
// ============================================================

export type GamePhase = 'title' | 'starterSelect' | 'prep' | 'enemySelect' | 'battle' | 'reward' | 'result';

// 仕様書のTEST18パターン(通常/通常/エリート/通常/中ボス/通常/エリート/ボス)を踏襲しつつ、
// 現行6敵ではミニボスまで区別できないためboss 1種類にまとめた7戦構成にしている。
const BATTLE_SEQUENCE: EnemyTier[] = ['normal', 'normal', 'elite', 'normal', 'normal', 'elite', 'boss'];
export const TOTAL_BATTLES = BATTLE_SEQUENCE.length;

// Excel36シナジーの最終段階が「同タグ6個」を要求するため、装着上限は6に設定する
// (シナジー36接続で確定。それ未満だと最終段階シナジーが永久に到達不能になってしまうため)。
export const MAX_EQUIPPED_PARTS = 6;
export const CORE_HP_BASE = PLAYER_BASE.maxHp;
export const POST_VICTORY_RECOVERY_PCT = 0.4; // 勝利後の小休止による自然回復割合(TEST18を踏襲した仮値)

// MP改定(Excel CTB設定を同時に書き換え済み): 戦闘中はMPを一切回復せず、勝利後にまとめて
// 回復する。MPはHPと同様、ラン中は戦闘をまたいで持ち越す資源として管理する。
export const MP_START = 30; // Excel「初期MP」に一致
export const POST_BATTLE_MP_REGEN_BASE = 20; // Excel「戦闘後MP回復」に一致

export interface RunState {
  phase: GamePhase;
  battleIndex: number; // 1-based
  coreHp: number;
  mp: number;
  starterId: string | null;
  equippedPartIds: string[];
  inventoryPartIds: string[];
  currentEnemyId: string | null;
  enemyCandidateIds: string[];
  dropCandidateIds: string[];
  lastDefeatedEnemyId: string | null; // Phase 1: 報酬画面で「どの敵が落としたか」を示すため
  resultOutcome: 'victory' | 'defeat' | null;
  seenIntro: boolean; // 遊び方を一度でも見たか(GAME STARTのたび強制表示しないため)
}

export function createTitleState(seenIntro: boolean): RunState {
  return {
    phase: 'title',
    battleIndex: 1,
    coreHp: CORE_HP_BASE,
    mp: MP_START,
    starterId: null,
    equippedPartIds: [],
    inventoryPartIds: [],
    currentEnemyId: null,
    enemyCandidateIds: [],
    dropCandidateIds: [],
    lastDefeatedEnemyId: null,
    resultOutcome: null,
    seenIntro,
  };
}

// 装備中の部位に応じた現在の最大MP(部位のmax_mp_bonusを含む)。装備変更でmpが上限を
// 超えていた場合はequipPart/unequipPart側でクランプする。
export function currentMaxMp(state: RunState): number {
  return CTB_MP_MAX_BASE + computePlayerModifiers(equippedPartDefs(state)).maxMpBonus;
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

// 装備変更で最大MPが下がった場合、現在MPが上限を超えないようクランプする
// (MP改定: MPはHPと同様に戦闘をまたいで持ち越す資源になったため必要になったガード)。
function clampMpToMax(state: RunState): RunState {
  const max = currentMaxMp(state);
  return state.mp > max ? { ...state, mp: max } : state;
}

export function equipPart(state: RunState, partId: string): RunState {
  if (state.equippedPartIds.includes(partId)) return state;
  if (state.equippedPartIds.length >= MAX_EQUIPPED_PARTS) return state;
  return clampMpToMax({
    ...state,
    equippedPartIds: [...state.equippedPartIds, partId],
    inventoryPartIds: state.inventoryPartIds.filter((id) => id !== partId),
  });
}

export function unequipPart(state: RunState, partId: string): RunState {
  if (!state.equippedPartIds.includes(partId)) return state;
  return clampMpToMax({
    ...state,
    equippedPartIds: state.equippedPartIds.filter((id) => id !== partId),
    inventoryPartIds: [...state.inventoryPartIds, partId],
  });
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

export const DROP_CANDIDATE_COUNT = 3;

// ------------------------------------------------------------
// 報酬候補の抽選(Phase 1: 敵所持部位ドロップ)。
//
// 「全PARTSから未所持をランダム」ではなく、倒した敵のドロップ定義(Excelのドロップタグ由来)を
// 中心に抽選する。これにより敵選択が単なる危険度選択ではなく、ビルドの方向を選ぶ行為になる。
//
// 所持済み部位の扱いは既存仕様(finishBattleが未所持のみを候補にしていた)をそのまま踏襲し、
// どの枠でも所持済みは候補から除外する。
//
// 敵のプールを引き切った場合の縮退順序(Excelのタグ分布の偏りでプールが小さい敵があるため、
// 報酬画面が空になるのを必ず防ぐ): 敵の通常枠 → 敵のレア枠 → 全未所持部位。
//
// rollFn は 0<=x<1 を返す乱数。テストから決定的な値を渡せるよう引数にしている。
// ------------------------------------------------------------
export function rollDropCandidates(
  enemyId: string,
  ownedIds: string[],
  rollFn: () => number = Math.random
): string[] {
  const owned = new Set(ownedIds);
  const drop = getEnemyDrop(enemyId);
  const enemy = getEnemy(enemyId);
  const unowned = (ids: string[]) => ids.filter((id) => !owned.has(id));

  if (!drop || !enemy) {
    return pickRandom(unowned(PARTS.map((p) => p.id)), DROP_CANDIDATE_COUNT);
  }

  const normalPool = unowned(drop.bodyPartIds);
  const rarePool = unowned(drop.rareDropPartIds);
  const rareChance = RARE_DROP_CHANCE_PCT[enemy.tier];

  const picked: string[] = [];
  const taken = new Set<string>();
  const takeFrom = (pool: string[]): boolean => {
    const available = pool.filter((id) => !taken.has(id));
    if (available.length === 0) return false;
    const id = available[Math.min(available.length - 1, Math.floor(rollFn() * available.length))];
    picked.push(id);
    taken.add(id);
    return true;
  };

  while (picked.length < DROP_CANDIDATE_COUNT) {
    // 1枠ごとに独立してレア枠かどうかを判定し、外れた/引き切った場合は通常枠へ落とす。
    const wantRare = rollFn() * 100 < rareChance;
    const got = wantRare ? takeFrom(rarePool) || takeFrom(normalPool) : takeFrom(normalPool) || takeFrom(rarePool);
    if (!got) break;
  }

  // 敵のプールを引き切ってもまだ枠が余る場合だけ、全未所持部位から補充する。
  if (picked.length < DROP_CANDIDATE_COUNT) {
    const fallback = unowned(PARTS.map((p) => p.id)).filter((id) => !taken.has(id));
    for (const id of pickRandom(fallback, DROP_CANDIDATE_COUNT - picked.length)) picked.push(id);
  }
  return picked;
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

export function finishBattle(state: RunState, result: 'won' | 'lost', finalHp: number, finalMp: number): RunState {
  if (result === 'lost') {
    return { ...state, phase: 'result', resultOutcome: 'defeat', coreHp: 0, mp: finalMp };
  }
  const recovered = Math.min(CORE_HP_BASE, Math.round(finalHp + CORE_HP_BASE * POST_VICTORY_RECOVERY_PCT));
  const mods = computePlayerModifiers(equippedPartDefs(state));
  const maxMp = CTB_MP_MAX_BASE + mods.maxMpBonus;
  const recoveredMp = Math.min(maxMp, Math.round(finalMp + POST_BATTLE_MP_REGEN_BASE + mods.postBattleMpRegenBonus));
  if (state.battleIndex >= TOTAL_BATTLES) {
    return { ...state, phase: 'result', resultOutcome: 'victory', coreHp: recovered, mp: recoveredMp, currentEnemyId: null };
  }
  // Phase 1: 報酬候補は「倒した敵が落とす部位」から抽選する。ここで一度だけ確定させ、
  // RunStateへ保存する(RewardScreenは再描画されても再抽選しない)。
  const defeatedEnemyId = state.currentEnemyId;
  return {
    ...state,
    phase: 'reward',
    coreHp: recovered,
    mp: recoveredMp,
    currentEnemyId: null,
    lastDefeatedEnemyId: defeatedEnemyId,
    dropCandidateIds: defeatedEnemyId ? rollDropCandidates(defeatedEnemyId, ownedPartIds(state)) : [],
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
