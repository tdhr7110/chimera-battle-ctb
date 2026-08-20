import type { SynergyDef } from './types';

// ============================================================
// CTB再設計データ 第1弾(仕様書8章)。Excelの36シナジーを一括実装せず、
// 「部位構成によって時間の流れ方そのものが変わる」ことを最小限確認できる4種類だけ採用する。
// ============================================================

export const SYNERGIES: SynergyDef[] = [
  {
    id: 'multi_leg',
    name: '多脚',
    description: '脚部位2個以上: 全行動のCTをさらに短縮する。',
    countBy: { kind: 'type', type: 'leg' },
    threshold: 2,
    effect: { kind: 'ct_mult_all_pct', pct: -10 },
  },
  {
    id: 'multi_heart',
    name: '多心臓',
    description: '心臓部位2個以上: ターン開始時のMP回復量をさらに増やす。',
    countBy: { kind: 'type', type: 'heart' },
    threshold: 2,
    effect: { kind: 'mp_regen_bonus', amount: 8 },
  },
  {
    id: 'heavy_synergy',
    name: '重量',
    description: '「重量」タグの部位2個以上: 重量系コマンドの威力をさらに強化する。',
    countBy: { kind: 'tag', tag: 'heavy' },
    threshold: 2,
    effect: { kind: 'power_bonus_heavy_pct', pct: 15 },
  },
  {
    id: 'time_synergy',
    name: '時間',
    description: '「時間」タグの部位1個以上: CT遅延効果をさらに強化する。',
    countBy: { kind: 'tag', tag: 'time' },
    threshold: 1,
    effect: { kind: 'delay_effect_bonus_pct', pct: 20 },
  },
];
