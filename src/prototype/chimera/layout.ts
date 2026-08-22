// ============================================================
// プロトタイプ専用: 7スロット・キメラのレイヤー配置計算(純粋関数のみ)。
//
// 既存の src/ui/freeLayer/layoutMath.ts と考え方は同じ(アンカー position - pivot*scale)だが、
// あちらは全レイヤーを正方形box(width%==height%)として置く前提だったのに対し、
// 今回の素材は1枚ごとに実際の切り出しサイズ(bbox)がバラバラな実写ドット絵のため、
// 縦横比を保ったまま(width/heightそれぞれ実寸*scale)配置できるよう独自に書き起こしている。
// 既存コードをコピーしてはいないが、同じ「アンカー+ピボット+スケール」設計を踏襲することで
// 「既存コードを可能な限り流用する」方針に沿わせている。
//
// 画像の差し替えやすさ(あとから同じファイル名で別解像度の絵に上書きしても壊れない)を
// 優先し、レンダリング用のサイズはビルド時に焼き込んだ数値ではなく、実行時にブラウザが
// 読み込んだ画像そのもののnaturalWidth/naturalHeightから毎回計算する。
// 各部位のscaleフィールドは「カテゴリの基準の高さ(CATEGORY_TARGET_HEIGHT)に対する倍率」
// (省略時1)という意味で、絶対px値ではない。そのため:
//   renderedHeight = naturalHeight * (targetHeightPx / naturalHeight) * (part.scale ?? 1)
//                  = targetHeightPx * (part.scale ?? 1)
// となり、差し替え後の画像がどんな解像度でも、まず「カテゴリの基準の高さ」に自動フィットし、
// そこにscale倍率(ユーザーの微調整)がかかる。
// ============================================================
import { CANVAS_SIZE, CATEGORY_ANCHORS, CATEGORY_TARGET_HEIGHT } from './manifest';
import type { ChimeraPartVisual } from './types';

export interface PlacedPartStyle {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  zIndex: number;
}

/**
 * naturalWidth/naturalHeightは呼び出し側(ChimeraCanvas)が<img>の読み込み完了後に
 * 実測した値を渡す。読み込み前は呼ばない(まだ正しいサイズで置けないため)。
 */
export function computePartStyle(part: ChimeraPartVisual, naturalWidth: number, naturalHeight: number): PlacedPartStyle {
  const anchor = CATEGORY_ANCHORS[part.category];
  const targetHeight = CATEGORY_TARGET_HEIGHT[part.category];
  const autoFitScale = naturalHeight > 0 ? targetHeight / naturalHeight : 1;
  const effectiveScale = autoFitScale * (part.scale ?? 1);

  const renderedWidth = naturalWidth * effectiveScale;
  const renderedHeight = naturalHeight * effectiveScale;
  const left = anchor.x + (part.offsetX ?? 0) - part.anchorX * renderedWidth;
  const top = anchor.y + (part.offsetY ?? 0) - part.anchorY * renderedHeight;
  return {
    leftPct: (left / CANVAS_SIZE) * 100,
    topPct: (top / CANVAS_SIZE) * 100,
    widthPct: (renderedWidth / CANVAS_SIZE) * 100,
    heightPct: (renderedHeight / CANVAS_SIZE) * 100,
    zIndex: part.zIndex,
  };
}

export function anchorDotPct(category: keyof typeof CATEGORY_ANCHORS): { leftPct: number; topPct: number } {
  const a = CATEGORY_ANCHORS[category];
  return { leftPct: (a.x / CANVAS_SIZE) * 100, topPct: (a.y / CANVAS_SIZE) * 100 };
}
