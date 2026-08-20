import type { PartDef } from './types';

// ============================================================
// CTB再設計データ 第1弾(仕様書7章)。Excelの80部位を一括実装せず、
// CTBの違いが分かりやすい代表部位10種類だけを採用する。
//
// 各部位の効果(PartEffect)はengine/modifiers.tsで解釈され、CTB計算式
// (速度・CT倍率・MP回復・威力・遅延効果量)へ反映される。
// ============================================================

export const PARTS: PartDef[] = [
  {
    id: 'swift_legs',
    name: '俊足脚',
    icon: '🦵',
    type: 'leg',
    tags: [],
    effects: [
      { kind: 'speed_flat', amount: 18 },
      { kind: 'ct_mult_all_pct', pct: -8 },
    ],
    description: '速度を底上げし、さらに全行動のCTそのものを短縮する。',
  },
  {
    id: 'six_legs',
    name: '六節脚',
    icon: '🦗',
    type: 'leg',
    tags: [],
    effects: [{ kind: 'ct_mult_light_pct', pct: -25 }],
    description: '速撃・待機・毒針など軽量コマンドのCTをさらに短縮する。',
  },
  {
    id: 'heavy_legs',
    name: '重装脚',
    icon: '🦿',
    type: 'leg',
    tags: ['heavy'],
    effects: [{ kind: 'ct_heavy_penalty_reduction_pct', pct: 35 }],
    description: '強打など重量コマンドのCTペナルティを軽減する。',
  },
  {
    id: 'second_heart',
    name: '第二心臓',
    icon: '💗',
    type: 'heart',
    tags: [],
    effects: [{ kind: 'mp_regen_bonus', amount: 10 }],
    description: 'ターン開始時のMP回復量を増やす。',
  },
  {
    id: 'berserk_heart',
    name: '暴走心臓',
    icon: '💢',
    type: 'heart',
    tags: [],
    effects: [{ kind: 'low_hp_ct_bonus', hpPctThreshold: 50, ctMultPct: -20 }],
    description: 'HPが50%以下になると全行動のCTが短縮される。',
  },
  {
    id: 'mana_sac',
    name: '魔力嚢',
    icon: '🔮',
    type: 'heart',
    tags: [],
    effects: [{ kind: 'max_mp_bonus', amount: 30 }],
    description: '最大MPを増加させる。',
  },
  {
    id: 'many_arms',
    name: '多腕',
    icon: '🫆',
    type: 'arm',
    tags: [],
    effects: [{ kind: 'power_bonus_light_pct', pct: 20 }],
    description: '通常攻撃・速撃など軽量attack系の威力を強化する。',
  },
  {
    id: 'giant_arm',
    name: '豪腕',
    icon: '💪',
    type: 'arm',
    tags: ['heavy'],
    effects: [{ kind: 'power_bonus_heavy_pct', pct: 30 }],
    description: '強打など重量attack系の威力を強化する。',
  },
  {
    id: 'counter_tail',
    name: '反撃尾',
    icon: '🦂',
    type: 'tail',
    tags: [],
    effects: [{ kind: 'counter_on_hit', chancePct: 25, powerMult: 0.6 }],
    description: '被弾時、一定確率でCTを消費せず反撃する(将来の割り込み系能力の仮実装)。',
  },
  {
    id: 'time_eye',
    name: '時喰い眼',
    icon: '👁️',
    type: 'eye',
    tags: ['time'],
    effects: [{ kind: 'delay_effect_bonus_pct', pct: 40 }],
    description: '遅延打撃など、敵の行動順を操作する効果を強化する。',
  },
];

export function getPart(id: string): PartDef | undefined {
  return PARTS.find((p) => p.id === id);
}
