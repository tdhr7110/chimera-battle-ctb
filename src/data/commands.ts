import type { CommandDef } from './types';

// ============================================================
// 仕様書7章のコマンド例をそのまま実装する。数値はすべて仮。
// 5つ目のULTRA(大技)は8章のコマンドUI例には出てこないが、7章で明示的に
// 挙げられている「威力：非常に高い/代謝：大量/CT：非常に長い」を確認したいため
// 5枠目として追加する(将来カットしてもよい)。
// ============================================================

export const COMMANDS: CommandDef[] = [
  {
    id: 'attack',
    name: '通常攻撃',
    icon: '👊',
    kind: 'attack',
    powerMult: 1.0,
    metabolismCost: 0,
    ctWeight: 'standard',
    description: '威力・代謝・CTのすべてが標準のコマンド。迷ったらこれ。',
  },
  {
    id: 'rush',
    name: '高速攻撃',
    icon: '⚡',
    kind: 'attack',
    powerMult: 0.55,
    metabolismCost: 10,
    ctWeight: 'light',
    description: '威力は低いが次の行動が非常に早い。敵より先にもう一度動けることもある。',
  },
  {
    id: 'guard',
    name: '防御',
    icon: '🛡️',
    kind: 'guard',
    powerMult: 0,
    metabolismCost: 6,
    ctWeight: 'light',
    guardReductionPct: 50,
    description: '次に受ける1回のダメージを軽減する。敵の大技を受けつつ早く次へつなげる。',
  },
  {
    id: 'smash',
    name: '強打',
    icon: '💥',
    kind: 'attack',
    powerMult: 1.75,
    metabolismCost: 24,
    ctWeight: 'heavy',
    applyStatus: { kind: 'burn', dps: 3, turns: 3 },
    description: '大ダメージ＋炎上を与える代わりに、次の行動が遅くなる。',
  },
  {
    id: 'ultra',
    name: '大技',
    icon: '🌋',
    kind: 'ultimate',
    powerMult: 2.6,
    metabolismCost: 45,
    ctWeight: 'very_heavy',
    description: '非常に高い威力と引き換えに、使用後は敵へ複数回の行動を許してしまう。',
  },
];

export function getCommand(id: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.id === id);
}
