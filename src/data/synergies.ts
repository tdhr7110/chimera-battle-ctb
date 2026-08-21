import type { SynergyDef } from './types';

// ============================================================
// CTB再設計データ 第1弾(仕様書8章)。Excelの36シナジーを一括実装せず、
// 「部位構成によって時間の流れ方そのものが変わる」ことを最小限確認できる4種類だけ採用する。
// ============================================================

export const SYNERGIES: SynergyDef[] = [
  {
    id: 'multi_leg',
    name: '多脚',
    description: '脚部位2個以上でCTさらに短縮。3個(全脚部位装着)で軽量技の後に確率で即再行動。',
    countBy: { kind: 'type', type: 'leg' },
    stages: [
      { threshold: 2, effect: { kind: 'ct_mult_all_pct', pct: -10 } },
      {
        threshold: 3,
        effect: { kind: 'ct_mult_all_pct', pct: -5 },
        ruleChange: { kind: 'extra_action_chance', afterCtWeight: 'light', chancePct: 20 },
        ruleChangeLabel: '軽量技の後、20%で即座にもう一度行動',
      },
    ],
  },
  {
    id: 'multi_heart',
    name: '多心臓',
    description: '心臓部位2個以上で戦闘後MP回復量UP。3個(全心臓部位装着)で戦闘中1回だけ致死を耐える。',
    countBy: { kind: 'type', type: 'heart' },
    stages: [
      { threshold: 2, effect: { kind: 'post_battle_mp_regen_bonus', amount: 8 } },
      {
        threshold: 3,
        effect: { kind: 'post_battle_mp_regen_bonus', amount: 4 },
        ruleChange: { kind: 'revive_once' },
        ruleChangeLabel: '戦闘中1回だけ、致死ダメージをHP1で耐える',
      },
    ],
  },
  {
    id: 'heavy_synergy',
    name: '重量',
    description: '「重量」タグの部位2個以上: 重量系コマンドの威力をさらに強化する。',
    countBy: { kind: 'tag', tag: 'heavy' },
    stages: [{ threshold: 2, effect: { kind: 'power_bonus_heavy_pct', pct: 15 } }],
  },
  {
    id: 'time_synergy',
    name: '時間',
    description: '「時間」タグの部位1個以上: CT遅延効果をさらに強化する。',
    countBy: { kind: 'tag', tag: 'time' },
    stages: [{ threshold: 1, effect: { kind: 'delay_effect_bonus_pct', pct: 20 } }],
  },
];
