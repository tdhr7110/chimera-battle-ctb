import type { CommandCategory } from './types';

// ============================================================
// 戦闘画面の大カテゴリ(4つ)。
//
// Excel「コマンド」シートの「系統」列は 攻撃/防御/補助/妨害/特殊 の5種類。
// 画面の大ボタンは4つに収めたいので、母数2件しかない「特殊」(模倣・変異)を
// 意味の近い「補助」へまとめて4分割にしている。分類の出どころはあくまでExcelで、
// ここにあるのは「どの系統をどのボタンへ出すか」という表示上の割り当てだけ。
//
// 参考画像には「回復」カテゴリがあるが、現行の60コマンドに回復系統は存在せず
// (回復は吸血・再生など攻撃/補助側の効果として実装されている)、
// 空のカテゴリを作らないため、実在する「妨害」を4つ目に据えている。
// ============================================================

export interface CommandCategoryDef {
  id: string;
  label: string;
  icon: string;
  sub: string;
  /** このボタンに集約するExcelの系統。 */
  sources: CommandCategory[];
}

export const COMMAND_CATEGORIES: CommandCategoryDef[] = [
  { id: 'attack', label: 'こうげき', icon: '⚔️', sub: '敵にダメージ', sources: ['攻撃'] },
  { id: 'guard', label: 'ガード', icon: '🛡️', sub: 'ダメージを軽減', sources: ['防御'] },
  { id: 'skill', label: 'スキル', icon: '✨', sub: '補助・特殊', sources: ['補助', '特殊'] },
  { id: 'debuff', label: 'じゃま', icon: '🌀', sub: '敵を弱らせる', sources: ['妨害'] },
];

export function categoryIdForCommand(category: CommandCategory): string {
  return COMMAND_CATEGORIES.find((c) => c.sources.includes(category))?.id ?? COMMAND_CATEGORIES[0].id;
}
