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

// 現行の12カテゴリ → 素材カテゴリ。
// 素材側に「口」「頭」に相当する専用レイヤーはjaw-crescent(face)しか無いため、
// 頭は角(horn)、口は顔(face)へ寄せている。心臓・器官はどちらも内臓(organ)で、
// コアは背面のスパイン(back)を使う。
const PART_TYPE_TO_LAYER: Record<PartType, LayerCategory> = {
  頭: 'horn',
  目: 'eye',
  口: 'face',
  腕: 'arm',
  脚: 'leg',
  心臓: 'organ',
  胴: 'armor',
  尻尾: 'tail',
  翼: 'wing',
  角: 'horn',
  器官: 'organ',
  コア: 'back',
};

export function layerCategoryForPartType(type: PartType): LayerCategory {
  return PART_TYPE_TO_LAYER[type];
}

/**
 * 装着部位から、カテゴリごとの表示個数を求める純粋関数。
 * 同じカテゴリへ複数の部位が写像される場合(頭+角、心臓+器官)は素直に合算し、
 * anchor-layouts.json の接続点の数を超えた分はFreeLayerFigure側で切り詰められる。
 */
export function layerCountsFromParts(parts: PartDef[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const part of parts) {
    const category = PART_TYPE_TO_LAYER[part.type];
    if (!category) continue;
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
}
