import type { SynergyDef } from './types';

// ============================================================
// CTB再設計データ シナジー(仕様書8章)。Excel正式マスターの36行(12系統×3段階、
// SYN001〜SYN036)を、系統ごとに1つのSynergyDef(3段階のstages配列)へ集約して接続する。
// 必要数はすべて「同タグ2/4/6個」で統一されているため、装着上限(MAX_EQUIPPED_PARTS)を
// 6に設定している(run.ts参照)。各段階のeffectsは積み上げで適用され、最終段階の
// ruleChangeは数値補正では表現できない「戦闘ルールそのものの変化」をエンジン側フックで実現する。
// ============================================================

export const SYNERGIES: SynergyDef[] = [
  {
    id: 'speed_synergy',
    name: '多脚',
    description:
      '「高速」タグの部位2個以上でCT短縮。4個でさらに全CT短縮。6個(実質全身高速化)で軽量技の後に確率で即再行動。',
    countBy: { kind: 'tag', tag: '高速' },
    stages: [
      { threshold: 2, effects: [{ kind: 'ct_mult_all_pct', pct: -8 }] },
      { threshold: 4, effects: [{ kind: 'ct_mult_all_pct', pct: -8 }] },
      {
        threshold: 6,
        effects: [{ kind: 'ct_mult_all_pct', pct: -6 }],
        ruleChange: { kind: 'extra_action_chance', afterCtWeight: 'light', chancePct: 20 },
        ruleChangeLabel: '軽量技の後、20%で即座にもう一度行動',
      },
    ],
  },
  {
    id: 'multi_hit_synergy',
    name: '多腕',
    description:
      '「多段」タグの部位2個以上で軽量攻撃の威力UP。4個で多段コマンドの命中回数が増える。6個で攻撃の後に自動で追撃する。',
    countBy: { kind: 'tag', tag: '多段' },
    stages: [
      { threshold: 2, effects: [{ kind: 'power_bonus_light_pct', pct: 10 }] },
      { threshold: 4, effects: [{ kind: 'power_bonus_light_pct', pct: 10 }, { kind: 'bonus_hits_flat', amount: 1 }] },
      {
        threshold: 6,
        effects: [{ kind: 'power_bonus_light_pct', pct: 10 }, { kind: 'bonus_hits_flat', amount: 1 }],
        ruleChange: { kind: 'follow_up_after_attack', powerMult: 0.4 },
        ruleChangeLabel: '攻撃コマンドの後、自動で追撃が発生する',
      },
    ],
  },
  {
    id: 'mp_synergy',
    name: '多心臓',
    description:
      '「MP」タグの部位2個以上で戦闘後MP回復量UP。4個で低HP時にCTも短縮。6個でMPが満タンの時、MP技のCTがさらに短縮される。',
    countBy: { kind: 'tag', tag: 'MP' },
    stages: [
      { threshold: 2, effects: [{ kind: 'post_battle_mp_regen_bonus', amount: 4 }] },
      {
        threshold: 4,
        effects: [
          { kind: 'post_battle_mp_regen_bonus', amount: 4 },
          { kind: 'low_hp_ct_bonus', hpPctThreshold: 50, ctMultPct: -8 },
        ],
      },
      {
        threshold: 6,
        effects: [
          { kind: 'post_battle_mp_regen_bonus', amount: 4 },
          { kind: 'low_hp_ct_bonus', hpPctThreshold: 50, ctMultPct: -8 },
        ],
        ruleChange: { kind: 'full_mp_ct_bonus', ctMultPct: -15 },
        ruleChangeLabel: 'MPが満タンの時、MP技のCTがさらに短縮される',
      },
    ],
  },
  {
    id: 'time_predation_synergy',
    name: '時間捕食',
    description:
      '「時間」タグの部位2個以上で遅延効果量UP。4個で遅延成功時にMPも回復。6個で遅延を重ねるほど次の遅延がさらに強化される。',
    countBy: { kind: 'tag', tag: '時間' },
    stages: [
      { threshold: 2, effects: [{ kind: 'delay_effect_bonus_pct', pct: 10 }] },
      {
        threshold: 4,
        effects: [{ kind: 'delay_effect_bonus_pct', pct: 10 }],
        ruleChange: { kind: 'delay_mp_refund', mpGain: 4 },
        ruleChangeLabel: '敵への遅延が成功するとMPが回復する',
      },
      {
        threshold: 6,
        effects: [{ kind: 'delay_effect_bonus_pct', pct: 10 }],
        ruleChange: { kind: 'compounding_delay', pctPerStack: 15 },
        ruleChangeLabel: '敵を遅延させるほど、次の遅延効果がさらに強化される',
      },
    ],
  },
  {
    id: 'heavy_synergy',
    name: '重量怪物',
    description:
      '「重量」タグの部位2個以上で重量系コマンドの威力UP。4個でCTペナルティも軽減。6個で超重量技が敵のCTも遅延させる。',
    countBy: { kind: 'tag', tag: '重量' },
    stages: [
      { threshold: 2, effects: [{ kind: 'power_bonus_heavy_pct', pct: 10 }] },
      {
        threshold: 4,
        effects: [{ kind: 'power_bonus_heavy_pct', pct: 10 }, { kind: 'ct_heavy_penalty_reduction_pct', pct: 15 }],
      },
      {
        threshold: 6,
        effects: [{ kind: 'power_bonus_heavy_pct', pct: 10 }, { kind: 'ct_heavy_penalty_reduction_pct', pct: 15 }],
        ruleChange: { kind: 'very_heavy_delays_enemy', amount: 40 },
        ruleChangeLabel: '超重量技が敵のCTも遅延させる',
      },
    ],
  },
  {
    id: 'berserk_synergy',
    name: '暴走生命',
    description:
      '「暴走」タグの部位2個以上で低HP時にCT短縮。4個で低HP時にMPも回復。6個で戦闘中1回、致死ダメージをHP1で耐え即座にもう一度行動する。',
    countBy: { kind: 'tag', tag: '暴走' },
    stages: [
      { threshold: 2, effects: [{ kind: 'low_hp_ct_bonus', hpPctThreshold: 50, ctMultPct: -8 }] },
      {
        threshold: 4,
        effects: [
          { kind: 'low_hp_ct_bonus', hpPctThreshold: 50, ctMultPct: -8 },
          { kind: 'low_hp_mp_regen_per_turn', hpPctThreshold: 50, amount: 3 },
        ],
      },
      {
        threshold: 6,
        effects: [
          { kind: 'low_hp_ct_bonus', hpPctThreshold: 50, ctMultPct: -8 },
          { kind: 'low_hp_mp_regen_per_turn', hpPctThreshold: 50, amount: 3 },
        ],
        ruleChange: { kind: 'revive_once_instant_action' },
        ruleChangeLabel: '戦闘中1回、致死ダメージをHP1で耐え即座にもう一度行動する',
      },
    ],
  },
  {
    id: 'poison_synergy',
    name: '毒性融合',
    description:
      '「毒」タグの部位2個以上で自分が付与する毒の量が増える。4個でさらに増える。6個で敵の毒が一定値まで蓄積すると自動で爆発し追加ダメージ。',
    countBy: { kind: 'tag', tag: '毒' },
    stages: [
      { threshold: 2, effects: [{ kind: 'status_magnitude_bonus', target: 'poison', pctAmount: 10 }] },
      { threshold: 4, effects: [{ kind: 'status_magnitude_bonus', target: 'poison', pctAmount: 10 }] },
      {
        threshold: 6,
        effects: [{ kind: 'status_magnitude_bonus', target: 'poison', pctAmount: 10 }],
        ruleChange: { kind: 'poison_explode', stackThreshold: 8, bonusDamage: 20 },
        ruleChangeLabel: '敵の毒が一定値まで蓄積すると自動で爆発し、追加ダメージが発生する',
      },
    ],
  },
  {
    id: 'inferno_synergy',
    name: '炎獄',
    description:
      '「炎」タグの部位2個以上で自分が付与する炎上の量が増える。4個でさらに増える。6個で炎上中の敵を攻撃すると自分の次回行動が早まる。',
    countBy: { kind: 'tag', tag: '炎' },
    stages: [
      { threshold: 2, effects: [{ kind: 'status_magnitude_bonus', target: 'burn', pctAmount: 10 }] },
      { threshold: 4, effects: [{ kind: 'status_magnitude_bonus', target: 'burn', pctAmount: 10 }] },
      {
        threshold: 6,
        effects: [{ kind: 'status_magnitude_bonus', target: 'burn', pctAmount: 10 }],
        ruleChange: { kind: 'attack_burning_ct_bonus', ctMultPct: -20 },
        ruleChangeLabel: '炎上中の敵を攻撃すると自分の次回行動が早まる',
      },
    ],
  },
  {
    id: 'reflect_synergy',
    name: '反射生物',
    description:
      '「反撃」タグの部位2個以上で常時反射の割合UP。4個で回避率もUP。6個で反射が発動した直後、次のコマンドのMPコストが0になる。',
    countBy: { kind: 'tag', tag: '反撃' },
    stages: [
      { threshold: 2, effects: [{ kind: 'reflect_on_hit_pct', pct: 8 }] },
      { threshold: 4, effects: [{ kind: 'reflect_on_hit_pct', pct: 8 }, { kind: 'evasion_bonus_pct', pct: 5 }] },
      {
        threshold: 6,
        effects: [{ kind: 'reflect_on_hit_pct', pct: 8 }, { kind: 'evasion_bonus_pct', pct: 5 }],
        ruleChange: { kind: 'reflect_next_free' },
        ruleChangeLabel: '反撃が発動した直後、次のコマンドのMPコストが0になる',
      },
    ],
  },
  {
    id: 'regen_synergy',
    name: '再生体',
    description:
      '「再生」タグの部位2個以上で手番開始時の自動回復量UP。4個で防御コマンドでもMPが回復する。6個で自動回復のHP超過分がシールドになる。',
    countBy: { kind: 'tag', tag: '再生' },
    stages: [
      { threshold: 2, effects: [{ kind: 'passive_regen_per_turn', amount: 2 }] },
      {
        threshold: 4,
        effects: [{ kind: 'passive_regen_per_turn', amount: 2 }],
        ruleChange: { kind: 'guard_mp_gain', amount: 5 },
        ruleChangeLabel: '防御コマンドを使うとMPも回復する',
      },
      {
        threshold: 6,
        effects: [{ kind: 'passive_regen_per_turn', amount: 2 }],
        ruleChange: { kind: 'overheal_shield' },
        ruleChangeLabel: '手番開始時の自動回復がHP上限を超えた分、被ダメージを肩代わりするシールドになる',
      },
    ],
  },
  {
    id: 'predator_synergy',
    name: '捕食者',
    description:
      '「捕食」タグの部位2個以上で吸血コマンドの回復量UP。4個で撃破時にCT短縮・MP回復も得る。6個で敵を撃破すると即座にもう一度行動できる。',
    countBy: { kind: 'tag', tag: '捕食' },
    stages: [
      { threshold: 2, effects: [{ kind: 'lifesteal_bonus_pct', pct: 8 }] },
      {
        threshold: 4,
        effects: [
          { kind: 'lifesteal_bonus_pct', pct: 8 },
          { kind: 'on_kill_ct_bonus_pct', pct: 15 },
          { kind: 'on_kill_mp_gain', amount: 5 },
        ],
      },
      {
        threshold: 6,
        effects: [
          { kind: 'lifesteal_bonus_pct', pct: 8 },
          { kind: 'on_kill_ct_bonus_pct', pct: 15 },
          { kind: 'on_kill_mp_gain', amount: 5 },
        ],
        ruleChange: { kind: 'kill_instant_action' },
        ruleChangeLabel: '敵を撃破すると即座にもう一度行動できる',
      },
    ],
  },
  {
    id: 'compute_synergy',
    name: '演算生命',
    description:
      '「知性」タグの部位2個以上で補助系コマンドのCTが短縮。4個でMPコストも軽減。6個で直前と同じ補助コマンドを連続で使うとさらにCTが早まる。',
    countBy: { kind: 'tag', tag: '知性' },
    stages: [
      { threshold: 2, effects: [{ kind: 'utility_ct_bonus_pct', pct: -8 }] },
      {
        threshold: 4,
        effects: [{ kind: 'utility_ct_bonus_pct', pct: -8 }, { kind: 'utility_mp_cost_reduction_pct', pct: 15 }],
      },
      {
        threshold: 6,
        effects: [{ kind: 'utility_ct_bonus_pct', pct: -8 }, { kind: 'utility_mp_cost_reduction_pct', pct: 15 }],
        ruleChange: { kind: 'repeat_utility_bonus', extraHaste: 10 },
        ruleChangeLabel: '直前と同じ補助コマンドを連続で使うと、自分のCTがさらに早まる',
      },
    ],
  },
];
