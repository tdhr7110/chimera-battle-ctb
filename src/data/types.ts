// ============================================================
// キメラバトル CTB戦闘システム仕様書 v0.2 の実装用型定義。
// このリポジトリはCTB(行動順可視化型コマンドバトル)そのものの検証に集中した
// スタンドアロンのデモで、育成・ショップ・セーブ等の周辺機能は持たない。
// ============================================================

export type Side = 'player' | 'enemy';

// 仕様書6章: プレイヤーに内部CT値そのものは見せず、「軽量/標準/重量/超重量」という
// 定性的なラベルだけを見せる。CT_WEIGHT_INTERVAL_MULTでこの区分を実際の行動間隔へ変換する。
export type CtWeight = 'light' | 'standard' | 'heavy' | 'very_heavy';

export const CT_WEIGHT_LABEL: Record<CtWeight, string> = {
  light: '早い',
  standard: '標準',
  heavy: '遅い',
  very_heavy: '非常に遅い',
};

// 仕様書7章の数値感を再現する行動間隔倍率(仮の値。最終バランスは別途調整する)。
export const CT_WEIGHT_INTERVAL_MULT: Record<CtWeight, number> = {
  light: 0.55,
  standard: 1.0,
  heavy: 1.65,
  very_heavy: 2.3,
};

export interface StatusApply {
  kind: 'burn';
  dps: number;
  turns: number;
}

export type CommandKind = 'attack' | 'guard' | 'ultimate';

export interface CommandDef {
  id: string;
  name: string;
  icon: string;
  kind: CommandKind;
  powerMult: number; // 基礎攻撃力に対する倍率。0 = ダメージを与えない(防御など)
  mpCost: number;
  ctWeight: CtWeight;
  guardReductionPct?: number; // 防御系コマンドのみ: 次に受ける1回のダメージを軽減する割合
  applyStatus?: StatusApply; // 命中時に付与する状態異常(仮実装のフレーバー)
  description: string; // 1回目タップで展開する短い説明
}

export interface EnemyMoveDef {
  id: string;
  name: string;
  icon: string;
  powerMult: number; // 敵の基礎攻撃力に対する倍率
  ctWeight: CtWeight;
  applyStatus?: StatusApply;
  telegraph?: string; // このmoveが次に来ると分かった時に表示する警告文(仕様書21章)
}

export interface EnemyDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  hp: number;
  defense: number;
  power: number; // 基礎攻撃力(各moveのpowerMultに乗算する)
  evasionPct: number;
  baseSpeed: number; // CTB上の基礎速度(プレイヤーの基準値100に対する相対値)
  moves: EnemyMoveDef[]; // 単純な周期パターンで順番に使用する(仮のAI)
  description: string;
}
