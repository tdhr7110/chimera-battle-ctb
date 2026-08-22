import type { PartDef, PartType } from '../../data/types';

// ============================================================
// Phase 3: 装着中のPartDefを「表示専用のレイヤー構成」へ変換する。
//
// 旧版(TEST11)は5種類の英語PartType(arm/leg/head/heart/skin)しか無く、その対応表を
// そのまま持ち込むことはできない。現行の日本語12カテゴリ用に、この1ファイルだけを
// 新規に書き起こしている(旧対応表はコピーしていない)。
//
// これは見た目の置き場所を決めるだけの変換で、部位効果・ステータス計算・命中判定・
// CTB処理には一切関与しない。ここを削除しても戦闘の挙動は1ミリも変わらない。
// ============================================================

// 素材側のカテゴリ(public/assets/chimera-layers/anchor-layouts.json のキー)。
export type LayerCategory = 'arm' | 'wing' | 'horn' | 'tail' | 'leg' | 'back' | 'face' | 'armor' | 'eye' | 'organ';

// 部位カテゴリ(8種) → 素材カテゴリ(接続点)。
//
// カテゴリを8つへ統合したので、1カテゴリが複数の接続点に対応することがある。
// とくに「頭」は旧 頭/目/口/角 を全部束ねているため、素材側では 角・顔・目 の
// 3か所へ順番に振り分ける。こうしないと頭部位を3つ付けても同じ絵が重なるだけで、
// 「獲得したら対応する場所に絵が増える」という手応えが失われてしまう。
//
// 素材側に専用レイヤーが無いカテゴリは意味の近い接続点へ寄せている
// (体=armor、その他=organ、コア=organとback)。
const PART_TYPE_TO_LAYERS: Record<PartType, LayerCategory[]> = {
  頭: ['horn', 'face', 'eye'],
  腕: ['arm'],
  足: ['leg'],
  体: ['armor'],
  コア: ['organ', 'back'],
  尻尾: ['tail'],
  羽: ['wing'],
  その他: ['organ'],
};

/** そのカテゴリの部位を1つだけ付けたときの置き場所。 */
export function layerCategoryForPartType(type: PartType): LayerCategory {
  return PART_TYPE_TO_LAYERS[type][0];
}

/**
 * 装着部位から、接続点ごとの表示個数を求める純粋関数。
 *
 * 同じカテゴリの部位が複数あるときは、そのカテゴリに割り当てられた接続点へ
 * 順番に配っていく(頭が3つなら 角→顔→目)。並び順は部位IDでソートしてから
 * 決めるので、装備の並べ替えだけでは見た目が変わらない。
 * anchor-layouts.json の接続点の数を超えた分はFreeLayerFigure側で切り詰められる。
 */
export function layerCountsFromParts(parts: PartDef[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const byType = new Map<PartType, PartDef[]>();
  for (const part of parts) {
    const list = byType.get(part.type);
    if (list) list.push(part);
    else byType.set(part.type, [part]);
  }
  for (const [type, list] of byType) {
    const anchors = PART_TYPE_TO_LAYERS[type];
    if (!anchors) continue;
    [...list]
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((_, i) => {
        const category = anchors[i % anchors.length];
        counts[category] = (counts[category] ?? 0) + 1;
      });
  }
  return counts;
}
