// ============================================================
// プロトタイプ専用: 7スロット・キメラのレイヤー配置計算(純粋関数のみ)。
//
// 既存の src/ui/freeLayer/layoutMath.ts と考え方は同じ(アンカー position - pivot*scale)だが、
// あちらは全レイヤーを正方形box(width%==height%)として置く前提だったのに対し、
// 今回の素材は1枚ごとに実際の切り出しサイズ(bbox)がバラバラな実写ドット絵のため、
// 縦横比を保ったまま(width/heightそれぞれ実寸*scale)配置できるよう独自に書き起こしている。
// 既存コードをコピーしてはいないが、同じ「アンカー+ピボット+スケール」設計を踏襲することで
// 「既存コードを可能な限り流用する」方針に沿わせている。
// ============================================================
import { CANVAS_SIZE, CATEGORY_ANCHORS } from './manifest';
import type { ChimeraPartVisual } from './types';

export interface PlacedPartStyle {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
  zIndex: number;
}

export function computePartStyle(part: ChimeraPartVisual): PlacedPartStyle {
  const anchor = CATEGORY_ANCHORS[part.category];
  const renderedWidth = part.width * part.scale;
  const renderedHeight = part.height * part.scale;
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
