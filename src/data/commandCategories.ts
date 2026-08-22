import type { CommandCategory } from './types';

// ============================================================
// 戦闘画面の大カテゴリ(4つ)。
//
// Excel「コマンド」シートの「系統」列は 攻撃/防御/補助/妨害/特殊 の5種類。
// 画面の大ボタンは4つに収めたいので、母数2件しかない「特殊」(模倣・変異)を
// 意味の近い「補助」へまとめて4分割にしている。分類の出どころはあくまでExcelで、
// ここにあるのは「どの系統をどのボタンへ出すか」という表示上の割り当てだけ。
//
// 参考画像には「回復」カテゴリがあるが、Excelの系統に「回復」は無い。
// 回復手段を調べると、純粋な回復系(精神集中=MP大回復、血の契約=HP→MP変換 等)は
// すべて系統「補助」= このスキルカテゴリに入っている。残る2つ(吸血・捕食)は
// 「当てるとHPが戻る攻撃」なので、こうげきに置くのが正しい。
// つまり回復はスキルに集約済みなので、空の回復カテゴリは作らず、
// 4つ目には実在する「妨害」を据えている。
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
  { id: 'skill', label: 'スキル', icon: '✨', sub: '補助・回復・特殊', sources: ['補助', '特殊'] },
  { id: 'debuff', label: 'じゃま', icon: '🌀', sub: '敵を弱らせる', sources: ['妨害'] },
];

export function categoryIdForCommand(category: CommandCategory): string {
  return COMMAND_CATEGORIES.find((c) => c.sources.includes(category))?.id ?? COMMAND_CATEGORIES[0].id;
}
