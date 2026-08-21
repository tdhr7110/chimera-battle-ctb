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
// 状態異常(仕様書9章 + Excel状態異常24種のうち、既存エンジンに無い解決フックが
// 必要なものから代表的な系統を追加実装): 現在13種類。
// burn/poison = 継続ダメージ(毎ターン開始時にmagnitude分)。
// vulnerable = 被ダメージ増加(magnitude%)。
// haste/slow = CT倍率の一時的な補正(magnitude%。hasteは負方向、slowは正方向に効く)。
// bleed = 出血。ターン開始時ではなく「被弾するたび」にmagnitude分ダメージ(新フック)。
// paralyze = 麻痺。継続ターンではなく「次の1行動だけ」CTをmagnitude%増加させる単発型(新フック)。
// accuracy_down = 盲目。自分の攻撃が外れる確率をmagnitude%上乗せする(新しい判定軸)。
// regen = 再生。ターン開始時にmagnitude分HP回復する(DOTの逆)。
// silence = 沈黙。MPを消費するコマンドを選択不可にする(コマンド選択可否への新フック)。
// undying = 不死。致死ダメージを1回だけ無効化し、発動後にCTを遅らせる単発型。
// mp_leak = MP漏出。行動するたびmagnitude分MPを追加消費する(新しい資源減少フック)。
// shock = 感電。加算スタックし、一定スタック数(SHOCK_TRIGGER_STACKS)に達すると
//   自動でCT遅延が発動してスタックがリセットされる(閾値トリガー型の新フック)。
// ------------------------------------------------------------
export type StatusKind =
  | 'burn'
  | 'poison'
  | 'vulnerable'
  | 'haste'
  | 'slow'
  | 'bleed'
  | 'paralyze'
  | 'accuracy_down'
  | 'regen'
  | 'silence'
  | 'undying'
  | 'mp_leak'
  | 'shock'
  | 'frozen'
  | 'defense_down'
  | 'frenzy';

export const STATUS_LABEL: Record<StatusKind, { icon: string; name: string }> = {
  burn: { icon: '🔥', name: '炎上' },
  poison: { icon: '☠️', name: '毒' },
  vulnerable: { icon: '💥', name: '脆弱' },
  haste: { icon: '💨', name: '加速' },
  slow: { icon: '🐌', name: '減速' },
  bleed: { icon: '🩸', name: '出血' },
  paralyze: { icon: '💫', name: '麻痺' },
  accuracy_down: { icon: '🌫️', name: '盲目' },
  regen: { icon: '💚', name: '再生' },
  silence: { icon: '🔇', name: '沈黙' },
  undying: { icon: '🌟', name: '不死' },
  mp_leak: { icon: '🕳️', name: 'MP漏出' },
  shock: { icon: '⚡', name: '感電' },
  frozen: { icon: '🧊', name: '凍結' },
  defense_down: { icon: '🦴', name: '腐食' },
  frenzy: { icon: '💢', name: '狂化' },
};

// 感電: このスタック数(magnitude合計)に達すると自動でCT遅延が発動し、スタックがリセットされる。
export const SHOCK_TRIGGER_STACKS = 3;
export const SHOCK_TRIGGER_DELAY_BASE = 60;

export interface StatusApply {
  kind: StatusKind;
  magnitude: number;
  turns: number;
}

// ------------------------------------------------------------
// コマンド(仕様書3〜4章)
// ------------------------------------------------------------
export type CommandKind = 'attack' | 'guard' | 'wait' | 'charge';

// Excelコマンド60種の接続(段階2)で追加した効果フィールド群。1つずつ個別の解決フックを
// engine/ctbEngine.tsに持つ(自由記述の効果文をそのまま実装するのではなく、共通パターン
// ごとに構造化データへ落とし込んでいる)。どのコマンドがどのフィールドを使うかは
// data/commands.tsのコメントを参照。
export interface CommandDef {
  id: string;
  name: string;
  icon: string;
  kind: CommandKind;
  powerMult: number; // 基礎攻撃力に対する倍率。0 = ダメージを与えない
  mpCost: number;
  ctWeight: CtWeight;
  guardReductionPct?: number; // 防御: 次に受ける1回のダメージを軽減する割合
  delayEnemyBy?: number; // 遅延打撃: 敵のnextAtへ加算する基礎量(耐性適用前)
  hasteSelfBy?: number; // 加速: 自分のnextAtから減算する基礎量
  chargeNextAttackMultBonus?: number; // チャージ: 次の攻撃系コマンドの威力倍率に加算するボーナス
  applyStatus?: StatusApply; // 命中時に敵へ付与する状態異常
  applySelfStatus?: StatusApply; // 自分自身へ付与する状態異常(加速のhaste状態など)
  description: string; // 1回目タップで展開する短い説明

  // --- コマンド60種接続で追加(Excel「効果」列の個別実装) ---
  hits?: number; // 連撃・粉砕連打・疾風連打等: 固定Hit数(省略時1)
  randomHitsRange?: [number, number]; // 乱撃: ランダムHit数([最小,最大])。hitsより優先
  vulnerableStackPerHit?: StatusApply; // 粉砕連打: ヒットごとに敵へ追加付与する状態異常
  lifestealPct?: number; // 吸血・血狂い系: 与えたダメージの一部を自分のHPへ変換
  ignoreDefense?: boolean; // 穿孔: 敵の防御力を無視
  executeBonus?: { hpPctThreshold: number; bonusMult: number }; // 処刑: 敵が閾値以下HPなら威力倍加
  missingHpPowerBonusPctPerMissing?: number; // 背水撃・血狂い: 自分の失ったHP割合1%ごとに威力+n%
  hpCostPct?: number; // 自壊砲等: 使用時に自分の現在HPの割合を代償として消費する
  hpCostPowerBonusMult?: number; // 上記のHP消費と対になる威力倍率ボーナス
  hpCostForMp?: { hpCost: number; mpGain: number }; // 血の契約: HPを消費してMPを得る
  mpFullRestore?: number; // 精神集中: 使用時にMPを大回復する(固定量)
  consumeAllMpForPower?: { powerMultPerMp: number }; // 魔力暴発: 残MPを消費し威力へ変換してから0にする
  damageImmuneOnce?: boolean; // 完全防御: 次の1回の被ダメージを完全無効化する
  counterStance?: { powerMult: number }; // カウンター姿勢・受け流し: 次の被弾時に反撃する
  reflectPct?: number; // 棘返し: 次の被弾時、受けたダメージの一部を敵へ反射する
  statusConsumeNuke?: { kind: StatusKind; damagePerMagnitude: number }; // 炎上爆破・毒爆・凍砕: 敵の状態異常を消費し追加ダメージ
  statusConsumeSelfHaste?: { kind: StatusKind; hasteUnitsPerMagnitude: number }; // 雷鎖: 敵の状態異常量に応じ自分のCTを短縮
  statusPresentBonusMult?: { kind: StatusKind; mult: number }; // 凍砕: 敵が特定状態異常を持っていれば威力倍加(消費はしない)
  killBonus?: { healPct?: number; mpGain?: number; instantNextAction?: boolean }; // 捕食・捕食連鎖: 敵撃破時のボーナス
  followUpNextAttack?: { powerMult: number }; // 追撃命令: 次の攻撃系コマンドの後に追撃が発生する
  firstActionCtBonusMult?: number; // 先制爪: 戦闘最初の行動でのみCT倍率にさらに掛ける係数
  mimicPreviousCommand?: boolean; // 模倣: 直前に使った自分のコマンドを(このコマンドのMPで)再使用する
  refundLastMpSpentPct?: number; // 巻き戻し: 直前に消費したMPの一部を返す
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

// Excelの「フェーズ変化」(現行エンジンに無かった仕組み): HP割合がhpPctThreshold以下に
// なった瞬間、以降の行動パターンをmovesから丸ごとphaseのmovesへ切り替える。
// thresholdの高い順に並べ、HPが下がるたびに該当する最初のフェーズへ1回だけ遷移する。
export interface EnemyPhase {
  hpPctThreshold: number;
  moves: EnemyMoveDef[];
  announceText: string; // フェーズ移行時に一度だけ表示する演出テキスト
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
  moves: EnemyMoveDef[]; // 単純な周期パターンで順番に使用する(仮のAI)。フェーズ1の行動パターン。
  phases?: EnemyPhase[]; // HP閾値で行動パターンそのものが変わる敵(エリート/ボス級)のみ設定
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
  | { kind: 'post_battle_mp_regen_bonus'; amount: number } // 第二心臓: 戦闘後MP回復量UP(MP改定: 戦闘中は回復しないため)
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
// 装着中の部位をtype/tagで数え、各段階の閾値を満たすたびeffectを積み上げで適用する
// (Excelの36シナジーが「段階」「必要数」で多段構造を持つことに合わせた拡張)。
// 最終段階にはruleChangeを持たせられ、単純な数値補正では表現できない
// 「戦闘ルールそのものの変化」(即時再行動・致死回避など)をエンジン側フックで実現する。
// ------------------------------------------------------------
export type SynergyCountBy = { kind: 'type'; type: PartType } | { kind: 'tag'; tag: PartTag };

export type SynergyRuleChange =
  | { kind: 'extra_action_chance'; afterCtWeight: CtWeight; chancePct: number } // 指定CT区分の行動後、確率でCTを消費せず即再行動
  | { kind: 'revive_once' }; // 戦闘中1回だけ、致死ダメージをHP1で耐えて即行動する

export interface SynergyStage {
  threshold: number;
  effect: PartEffect;
  ruleChange?: SynergyRuleChange;
  ruleChangeLabel?: string; // UI表示用の短い説明(ruleChangeとセットで使う)
}

export interface SynergyDef {
  id: string;
  name: string;
  description: string;
  countBy: SynergyCountBy;
  stages: SynergyStage[]; // 閾値の昇順で並べる。達成した段階のeffectはすべて積み上げで適用される。
}
