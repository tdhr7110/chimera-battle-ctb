import { getEnemy } from './enemies';
import type { EnemyDef, EnemyTier } from './types';

// ============================================================
// 難易度プリセット(Excel「難易度」シート)。
//
// このファイルの目的は「今後の難易度調整をコード変更なしで回せるようにする」こと。
// 数値はすべて Excel 側にあり、調整したくなったら
//   1. docs/data/…xlsx の「難易度」シートを編集
//   2. npm run data:import
// だけで反映される。ここにあるのはその値を敵ステータスへ適用する純粋関数だけで、
// バランス数値そのものは1つも書かれていない。
//
// 倍率は「敵シートの現行値に対する係数」。1.0 = 素のまま。
// 敵のHP/速度はExcelの正式マスターなので書き換えず、戦闘へ渡す直前に倍率を掛ける
// (図鑑やドロップ抽選は素のEnemyDefを見るため、難易度で図鑑の数値がぶれない)。
// ============================================================

export interface DifficultyPreset {
  id: string;
  name: string;
  isDefault: boolean;
  hp: Record<EnemyTier, number>;
  power: Record<EnemyTier, number>;
  defenseMult: number;
  evasionMult: number;
  playerHpMult: number;
  postBattleHealPct: number;
  postBattleMpMult: number;
  rareBonusPerBattle: number;
  // エリアごとの上乗せ倍率(エリア1..4)。奥のエリアほど同じ敵でも硬く・痛くなる。
  // 部位が増えてプレイヤーが強くなるぶんを吸収するための係数。
  areaHp: number[];
  areaPower: number[];
  description: string;
}

interface RawPreset {
  id: string;
  name: string;
  isDefault: string;
  hpNormal: number; hpElite: number; hpBoss: number;
  powerNormal: number; powerElite: number; powerBoss: number;
  defenseMult: number; evasionMult: number;
  playerHpMult: number; postBattleHealPct: number; postBattleMpMult: number;
  rareBonusPerBattle: number;
  areaHpMults: string;
  areaPowerMults: string;
  description: string;
}

// Excelの行をそのまま写した型付き定義。generated/difficulty.json と1対1で対応する。
const RAW: RawPreset[] = [
  {
    id: 'DIF001', name: 'やさしい', isDefault: '',
    hpNormal: 0.8, hpElite: 0.45, hpBoss: 0.33,
    powerNormal: 0.8, powerElite: 0.7, powerBoss: 0.35,
    defenseMult: 0.8, evasionMult: 0.6,
    playerHpMult: 1.15, postBattleHealPct: 0.5, postBattleMpMult: 1.25,
    rareBonusPerBattle: 5,
    areaHpMults: '0.75/1.0/1.3/1.6', areaPowerMults: '0.7/0.9/1.15/1.35',
    description: '初見・UI確認向け。通常戦はほぼ消耗しない。',
  },
  {
    id: 'DIF002', name: 'ふつう', isDefault: '○',
    hpNormal: 1.0, hpElite: 0.6, hpBoss: 0.42,
    powerNormal: 1.0, powerElite: 0.95, powerBoss: 0.45,
    defenseMult: 1.0, evasionMult: 1.0,
    playerHpMult: 1.0, postBattleHealPct: 0.4, postBattleMpMult: 1.0,
    rareBonusPerBattle: 4,
    areaHpMults: '0.85/1.1/1.45/1.85', areaPowerMults: '0.8/1.0/1.25/1.5',
    description: '既定。通常戦は消耗、エリートは山場、ボスはプレイヤーHPの約3倍。',
  },
  {
    id: 'DIF003', name: 'むずかしい', isDefault: '',
    hpNormal: 1.15, hpElite: 0.78, hpBoss: 0.5,
    powerNormal: 1.1, powerElite: 1.05, powerBoss: 0.52,
    defenseMult: 1.15, evasionMult: 1.2,
    playerHpMult: 0.9, postBattleHealPct: 0.3, postBattleMpMult: 0.85,
    rareBonusPerBattle: 3,
    areaHpMults: '0.9/1.2/1.6/2.05', areaPowerMults: '0.85/1.1/1.4/1.65',
    description: 'ビルドが噛み合わないと通常戦でも落ちる。',
  },
];

// Excelでは「0.85/1.1/1.45/1.85」のようにスラッシュ区切りで書く(1エリア1つ)。
function parseMults(raw: string): number[] {
  const list = raw.split('/').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return list.length > 0 ? list : [1];
}

export const DIFFICULTIES: DifficultyPreset[] = RAW.map((r) => ({
  id: r.id,
  name: r.name,
  isDefault: r.isDefault !== '',
  hp: { normal: r.hpNormal, elite: r.hpElite, boss: r.hpBoss },
  power: { normal: r.powerNormal, elite: r.powerElite, boss: r.powerBoss },
  defenseMult: r.defenseMult,
  evasionMult: r.evasionMult,
  playerHpMult: r.playerHpMult,
  postBattleHealPct: r.postBattleHealPct,
  postBattleMpMult: r.postBattleMpMult,
  rareBonusPerBattle: r.rareBonusPerBattle,
  areaHp: parseMults(r.areaHpMults),
  areaPower: parseMults(r.areaPowerMults),
  description: r.description,
}));

export const DEFAULT_DIFFICULTY_ID = (DIFFICULTIES.find((d) => d.isDefault) ?? DIFFICULTIES[0]).id;

export function getDifficulty(id: string | null | undefined): DifficultyPreset {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES.find((d) => d.id === DEFAULT_DIFFICULTY_ID)!;
}

/** 配列の範囲外は最後の値で頭打ちにする(エリアが増えてもExcelを直さずに動く)。 */
function atArea(mults: number[], area: number): number {
  if (mults.length === 0) return 1;
  return mults[Math.min(Math.max(1, area), mults.length) - 1];
}

/**
 * 難易度倍率を適用した戦闘用の敵を返す純粋関数。
 * フェーズごとの技セットは据え置き(行動パターンは難易度・エリアで変えない)。
 *
 * @param area 1始まりのエリア番号。奥のエリアほど上乗せ倍率が掛かる。
 */
export function tuneEnemy(enemy: EnemyDef, preset: DifficultyPreset, area = 1): EnemyDef {
  const hpMult = (preset.hp[enemy.tier] ?? 1) * atArea(preset.areaHp, area);
  const powerMult = (preset.power[enemy.tier] ?? 1) * atArea(preset.areaPower, area);
  return {
    ...enemy,
    hp: Math.max(1, Math.round(enemy.hp * hpMult)),
    power: Math.max(1, Math.round(enemy.power * powerMult)),
    defense: Math.max(0, Math.round(enemy.defense * preset.defenseMult)),
    evasionPct: Math.max(0, Math.round(enemy.evasionPct * preset.evasionMult)),
  };
}

export function getTunedEnemy(
  enemyId: string,
  difficultyId: string | null | undefined,
  area = 1
): EnemyDef | undefined {
  const enemy = getEnemy(enemyId);
  return enemy ? tuneEnemy(enemy, getDifficulty(difficultyId), area) : undefined;
}
