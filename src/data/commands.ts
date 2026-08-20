import type { CommandDef } from './types';

// ============================================================
// 仕様書7章のコマンド例をそのまま実装する。数値はすべて仮。
//
// ATTACK/RUSH/SMASHは「通常攻撃の派生(強弱)」として一つながりの系統になっている
// (FF10のような、威力を上げるほど次の行動が遅くなるトレードオフを軸にした構成):
//   RUSH(軽量・低威力・低MP) → ATTACK(標準) → SMASH(重量・高威力・高MP)
// GUARDは防御、ULTRAはこの系統から独立した「大技」という位置づけ。
//
// リソースは「代謝ゲージ」を廃止し、MP(マジックポイント)として実装している。
// 挙動(プレイヤーターン開始時に一定量回復)は元のままの仮実装。
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
    description: '威力・MP・CTのすべてが標準のコマンド。迷ったらこれ。',
  },
  {
    id: 'rush',
    name: '高速攻撃',
    icon: '⚡',
    kind: 'attack',
    powerMult: 0.55,
    mpCost: 10,
    ctWeight: 'light',
    description: '通常攻撃の軽量版。威力は低いが次の行動が非常に早く、敵より先にもう一度動けることもある。',
  },
  {
    id: 'guard',
    name: '防御',
    icon: '🛡️',
    kind: 'guard',
    powerMult: 0,
    mpCost: 6,
    ctWeight: 'light',
    guardReductionPct: 50,
    description: '次に受ける1回のダメージを軽減する。敵の大技を受けつつ早く次へつなげる。',
  },
  {
    id: 'smash',
    name: '強打',
    icon: '💥',
    kind: 'attack',
    powerMult: 2.0,
    mpCost: 20,
    ctWeight: 'heavy',
    applyStatus: { kind: 'burn', dps: 3, turns: 3 },
    description: '通常攻撃を強化した一撃。大ダメージ＋炎上と引き換えに、次の行動が遅くなる。',
  },
  {
    id: 'ultra',
    name: '大技',
    icon: '🌋',
    kind: 'ultimate',
    powerMult: 2.6,
    mpCost: 45,
    ctWeight: 'very_heavy',
    description: '通常攻撃の系統からは独立した奥義。非常に高い威力と引き換えに、使用後は敵へ複数回の行動を許してしまう。',
  },
];

export function getCommand(id: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.id === id);
}
