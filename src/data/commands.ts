import type { CommandDef } from './types';

// ============================================================
// CTB再設計データ 第1弾(仕様書「CHIMERA BATTLE CTB 再設計データ 第1弾実装」3章)。
// Excelの60コマンドを一括実装せず、まずこの10種類で
// 「MP0でも戦える／MP技はより強い戦術を使うためのリソース」という設計方針と、
// 高速・重量・状態異常・CT操作・準備行動という各カテゴリが成立するかを検証する。
//
// 重要: 通常攻撃・速撃・防御・待機・チャージの5つはMP0で使用できる基本行動。
// MP技(強打・火炎牙・毒針・遅延打撃・加速)は「より強い戦術のための追加リソース」。
// ============================================================

export const COMMANDS: CommandDef[] = [
  {
    id: 'attack',
    name: '通常攻撃',
    icon: '👊',
    kind: 'attack',
    powerMult: 1.0,
    mpCost: 0,
    ctWeight: 'standard',
    description: 'CTBの基準となる攻撃。威力・MP・CTのすべてが標準。',
  },
  {
    id: 'quick',
    name: '速撃',
    icon: '⚡',
    kind: 'attack',
    powerMult: 0.6,
    mpCost: 0,
    ctWeight: 'light',
    description: '通常攻撃より威力は低いが、MP0のまま次の自分の行動を早められる。',
  },
  {
    id: 'guard',
    name: '防御',
    icon: '🛡️',
    kind: 'guard',
    powerMult: 0,
    mpCost: 0,
    ctWeight: 'light',
    guardReductionPct: 50,
    description: '次に受ける1回のダメージを軽減する。',
  },
  {
    id: 'wait',
    name: '待機',
    icon: '⏸️',
    kind: 'wait',
    powerMult: 0,
    mpCost: 0,
    ctWeight: 'very_light',
    hasteSelfBy: 24,
    description: '攻撃しない代わりに、次回行動をさらに早めるCTB調整用の行動。',
  },
  {
    id: 'smash',
    name: '強打',
    icon: '💥',
    kind: 'attack',
    powerMult: 2.0,
    mpCost: 5,
    ctWeight: 'heavy',
    description: '大ダメージと引き換えに、次の行動が遅くなる。',
  },
  {
    id: 'flame_fang',
    name: '火炎牙',
    icon: '🔥',
    kind: 'attack',
    powerMult: 1.0,
    mpCost: 6,
    ctWeight: 'standard',
    applyStatus: { kind: 'burn', magnitude: 4, turns: 3 },
    description: 'ダメージに加えて炎上を付与する。',
  },
  {
    id: 'poison_needle',
    name: '毒針',
    icon: '🧪',
    kind: 'attack',
    powerMult: 0.5,
    mpCost: 5,
    ctWeight: 'light',
    applyStatus: { kind: 'poison', magnitude: 3, turns: 4 },
    description: '威力は低いが、毒を蓄積させる。',
  },
  {
    id: 'delay_strike',
    name: '遅延打撃',
    icon: '⏳',
    kind: 'attack',
    powerMult: 0.8,
    mpCost: 8,
    ctWeight: 'standard',
    delayEnemyBy: 70,
    description: 'ダメージを与えながら、敵の次回行動を後ろへ送る。CTBの妨害戦術の要。',
  },
  {
    id: 'haste_self',
    name: '加速',
    icon: '🌀',
    kind: 'wait',
    powerMult: 0,
    mpCost: 8,
    ctWeight: 'very_light',
    hasteSelfBy: 55,
    applySelfStatus: { kind: 'haste', magnitude: 20, turns: 2 },
    description: '攻撃せず、自分の次回行動を大きく前へ移動し、しばらくCTが短縮された状態になる。',
  },
  {
    id: 'charge',
    name: 'チャージ',
    icon: '🔋',
    kind: 'charge',
    powerMult: 0,
    mpCost: 0,
    ctWeight: 'light',
    chargeNextAttackMultBonus: 1.1,
    description: '今回の攻撃を放棄する代わりに、次の攻撃系コマンドの威力を大きく強化する。',
  },
  // ------------------------------------------------------------
  // Excel状態異常24種のうち、既存エンジンに無かった解決フック(単発消費・自己命中補正・
  // 閾値トリガー・自己バフ)を実際のCTB戦闘で機能させるために追加した代表コマンド5種。
  // ------------------------------------------------------------
  {
    id: 'paralyze_needle',
    name: '麻痺針',
    icon: '💫',
    kind: 'attack',
    powerMult: 0.5,
    mpCost: 6,
    ctWeight: 'light',
    applyStatus: { kind: 'paralyze', magnitude: 40, turns: 1 },
    description: '威力は低いが、命中すれば敵の次の1行動だけCTを大きく遅らせる。',
  },
  {
    id: 'blind_strike',
    name: '盲目の一撃',
    icon: '🌫️',
    kind: 'attack',
    powerMult: 0.7,
    mpCost: 6,
    ctWeight: 'standard',
    applyStatus: { kind: 'accuracy_down', magnitude: 25, turns: 3 },
    description: 'ダメージに加え、敵の命中率を下げて以後の攻撃を外れやすくする。',
  },
  {
    id: 'shock_strike',
    name: '電撃打',
    icon: '⚡',
    kind: 'attack',
    powerMult: 0.6,
    mpCost: 5,
    ctWeight: 'light',
    applyStatus: { kind: 'shock', magnitude: 1, turns: 4 },
    description: '感電を蓄積させる。3スタック溜まると自動で敵に大きな隙が生まれる。',
  },
  {
    id: 'quick_mend',
    name: '応急再生',
    icon: '💚',
    kind: 'wait',
    powerMult: 0,
    mpCost: 7,
    ctWeight: 'standard',
    applySelfStatus: { kind: 'regen', magnitude: 6, turns: 3 },
    description: '攻撃せず、自分に再生状態を付与する。以後しばらく行動開始時にHPが回復する。',
  },
  {
    id: 'undying_stance',
    name: '不屈の型',
    icon: '🌟',
    kind: 'wait',
    powerMult: 0,
    mpCost: 12,
    ctWeight: 'heavy',
    applySelfStatus: { kind: 'undying', magnitude: 1, turns: 5 },
    description: '攻撃せず、自分に不死状態を付与する。付与中に一度だけ致死ダメージをHP1で耐える。',
  },
];

export function getCommand(id: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.id === id);
}
