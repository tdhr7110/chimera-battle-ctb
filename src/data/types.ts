// ============================================================
// キメラバトル CTB 再設計データ 第1弾 の型定義。
//
// このリポジトリはCTB(行動順可視化型コマンドバトル)そのものの検証に集中した
// スタンドアロンのデモで、育成・ショップ・セーブ等の周辺機能は持たない。
//
// 数値(威力・MP・CT倍率・HP・速度・状態異常値)はすべて仮値。
// 「chimera_battle_ctb_redesign_v02_clean.xlsx」を全体設計マスターとして参照しつつ、
// 今回はそこから代表要素だけを採用している(全265要素の一括実装はしない)。
// ============================================================

export type Side = 'player' | 'enemy';

// 仕様書6章: プレイヤーに内部CT値そのものは見せず、「超早い/早い/標準/遅い/非常に遅い」
// という定性的なラベルだけを見せる。CT_WEIGHT_INTERVAL_MULTでこの区分を
// 実際の行動間隔倍率へ変換する。very_lightは待機・加速などの「CTB調整用」コマンド専用。
export type CtWeight = 'very_light' | 'light' | 'standard' | 'heavy' | 'very_heavy';

export const CT_WEIGHT_LABEL: Record<CtWeight, string> = {
  very_light: '超早い',
  light: '早い',
  standard: '標準',
  heavy: '遅い',
  very_heavy: '非常に遅い',
};

export const CT_WEIGHT_INTERVAL_MULT: Record<CtWeight, number> = {
  very_light: 0.3,
  light: 0.55,
  standard: 1.0,
  heavy: 1.65,
  very_heavy: 2.3,
};

// ------------------------------------------------------------
// 仕様書12章「CT操作に耐性を入れる」:
// CT短縮・CT遅延をどれだけ重ねても、無限行動や敵の永久拘束が起きないよう、
// 実際に適用される倍率・遅延量には必ずこの床/天井をかける。
// ------------------------------------------------------------
export const CT_WEIGHT_MULT_FLOOR = 0.28; // 短縮効果をどれだけ積んでも、これより速くはならない
export const CT_DELAY_UNITS_CEILING = 140; // 遅延打撃1回で加算できる時間の上限(耐性適用前の基礎量に対して)

// ------------------------------------------------------------
// 状態異常(仕様書9章): 第1弾は5種類のみ。
// burn/poison = 継続ダメージ(毎ターン開始時にmagnitude分)。
// vulnerable = 被ダメージ増加(magnitude%)。
// haste/slow = CT倍率の一時的な補正(magnitude%。hasteは負方向、slowは正方向に効く)。
// ------------------------------------------------------------
export type StatusKind = 'burn' | 'poison' | 'vulnerable' | 'haste' | 'slow';

export const STATUS_LABEL: Record<StatusKind, { icon: string; name: string }> = {
  burn: { icon: '🔥', name: '炎上' },
  poison: { icon: '☠️', name: '毒' },
  vulnerable: { icon: '💥', name: '脆弱' },
  haste: { icon: '💨', name: '加速' },
  slow: { icon: '🐌', name: '減速' },
};

export interface StatusApply {
  kind: StatusKind;
  magnitude: number;
  turns: number;
}

// ------------------------------------------------------------
// コマンド(仕様書3〜4章)
// ------------------------------------------------------------
export type CommandKind = 'attack' | 'guard' | 'wait' | 'charge';

export interface CommandDef {
  id: string;
  name: string;
  icon: string;
  kind: CommandKind;
  powerMult: number; // 基礎攻撃力に対する倍率。0 = ダメージを与えない
  mpCost: number;
  ctWeight: CtWeight;
  guardReductionPct?: number; // 防御: 次に受ける1回のダメージを軽減する割合
  mpRestoreOnUse?: number; // 防御/待機: 使用時に少量MPを回復
  delayEnemyBy?: number; // 遅延打撃: 敵のnextAtへ加算する基礎量(耐性適用前)
  hasteSelfBy?: number; // 加速: 自分のnextAtから減算する基礎量
  chargeNextAttackMultBonus?: number; // チャージ: 次の攻撃系コマンドの威力倍率に加算するボーナス
  applyStatus?: StatusApply; // 命中時に敵へ付与する状態異常
  applySelfStatus?: StatusApply; // 自分自身へ付与する状態異常(加速のhaste状態など)
  description: string; // 1回目タップで展開する短い説明
}

// ------------------------------------------------------------
// 敵の意図表示(仕様書11章): 行動順プレビュー・次行動表示に常時出すタグ。
// ------------------------------------------------------------
export type EnemyIntent = 'ATTACK' | 'STRONG' | 'POISON' | 'DEBUFF' | 'DELAY' | 'CHARGE' | 'COUNTER_STANCE' | 'ULTIMATE';

export const ENEMY_INTENT_LABEL: Record<EnemyIntent, string> = {
  ATTACK: 'ATTACK',
  STRONG: 'STRONG ATTACK',
  POISON: 'POISON',
  DEBUFF: 'DEBUFF',
  DELAY: 'DELAY',
  CHARGE: 'CHARGE',
  COUNTER_STANCE: 'COUNTER',
  ULTIMATE: 'ULTIMATE',
};

export interface EnemyMoveDef {
  id: string;
  name: string;
  icon: string;
  powerMult: number; // 敵の基礎攻撃力に対する倍率
  ctWeight: CtWeight;
  intent: EnemyIntent;
  applyStatus?: StatusApply;
  delayTargetBy?: number; // CT遅延型: プレイヤーのnextAtへ加算する基礎量(耐性の概念はプレイヤー側には適用しない)
  telegraph?: string; // ボスの大技等、専用の警告文(通常のintentタグに加えて表示する)
}

// 仕様書12章: 通常/エリート/ボスで遅延耐性を変えられるデータ構造。
// ボスであってもCT遅延を完全無効にはしない(0%にはしない)。
export type EnemyTier = 'normal' | 'elite' | 'boss';

export const TIER_DELAY_RESISTANCE_PCT: Record<EnemyTier, number> = {
  normal: 0,
  elite: 30,
  boss: 55,
};

export interface EnemyCounter {
  chancePct: number;
  powerMult: number; // 敵の基礎攻撃力に対する反撃倍率
}

export interface EnemyDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  tier: EnemyTier;
  hp: number;
  defense: number;
  power: number;
  evasionPct: number;
  baseSpeed: number; // CTB上の基礎速度(プレイヤーの基準値100に対する相対値)
  moves: EnemyMoveDef[]; // 単純な周期パターンで順番に使用する(仮のAI)
  counter?: EnemyCounter; // 反撃型: 被弾時に一定確率で即時反撃する
  description: string;
}

// ------------------------------------------------------------
// 部位(仕様書7章): 第1弾10種類。全80種の実装はまだ行わない。
// PartEffectを増やすだけで将来の部位追加に対応できるデータ構造にしている。
// ------------------------------------------------------------
export type PartType = 'leg' | 'heart' | 'arm' | 'eye' | 'tail';
// シナジー判定用の横断タグ(仕様書8章の「重量」「時間」シナジー用)。
export type PartTag = 'heavy' | 'time';

export type PartEffect =
  | { kind: 'speed_flat'; amount: number } // 俊足脚: 速度そのものを底上げ
  | { kind: 'ct_mult_all_pct'; pct: number } // 俊足脚: 全行動のCTをさらに短縮(負値)
  | { kind: 'ct_mult_light_pct'; pct: number } // 六節脚: 軽量系コマンドのみCT短縮
  | { kind: 'ct_heavy_penalty_reduction_pct'; pct: number } // 重装脚: 重量系コマンドのCTペナルティを軽減
  | { kind: 'low_hp_ct_bonus'; hpPctThreshold: number; ctMultPct: number } // 暴走心臓: HP割合以下でCT短縮
  | { kind: 'mp_regen_bonus'; amount: number } // 第二心臓: ターン開始時MP回復量UP
  | { kind: 'max_mp_bonus'; amount: number } // 魔力嚢: 最大MP増加
  | { kind: 'power_bonus_light_pct'; pct: number } // 多腕: 通常攻撃・速撃など軽量attack系の威力UP
  | { kind: 'power_bonus_heavy_pct'; pct: number } // 豪腕: 強打など重量attack系の威力UP
  | { kind: 'delay_effect_bonus_pct'; pct: number } // 時喰い眼: 遅延打撃の効果量UP
  | { kind: 'counter_on_hit'; chancePct: number; powerMult: number }; // 反撃尾: 被弾時に反撃(将来の割り込み系の仮実装)

export interface PartDef {
  id: string;
  name: string;
  icon: string;
  type: PartType;
  tags: PartTag[];
  effects: PartEffect[];
  description: string;
}

// ------------------------------------------------------------
// シナジー(仕様書8章): 第1弾4種類。全36種の実装はまだ行わない。
// 装着中の部位をtype/tagで数え、閾値以上ならeffectを追加で1つ適用する。
// ------------------------------------------------------------
export type SynergyCountBy = { kind: 'type'; type: PartType } | { kind: 'tag'; tag: PartTag };

export interface SynergyDef {
  id: string;
  name: string;
  description: string;
  countBy: SynergyCountBy;
  threshold: number;
  effect: PartEffect;
}
