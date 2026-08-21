// TEST11: 自由合体レイヤー表示の座標計算(戦闘ロジックとは無関係な純粋関数のみ)。
// レンダリング(React)にもNode.js側の回帰テスト(scripts/freeLayerTest.ts)にも同じ関数を使う。
import type { AnchorLayouts, AnchorSlot, Vec2 } from './types';

export interface PlacedLayerStyle {
  leftPct: number;
  topPct: number;
  sizePct: number;
  originXPct: number;
  originYPct: number;
}

// left = anchor.x - pivot.x * scale / top = anchor.y - pivot.y * scale (仕様書の基本式)。
// 256基準のキャンバス内での割合(%)に変換して返すことで、コンテナのCSSサイズが
// clampでどう変化してもJS側の再計算なしに追従できるようにする。
export function computeLayerStyle(anchor: Vec2, pivot: Vec2, scale: number, canvasSize: number): PlacedLayerStyle {
  const left = anchor.x - pivot.x * scale;
  const top = anchor.y - pivot.y * scale;
  return {
    leftPct: (left / canvasSize) * 100,
    topPct: (top / canvasSize) * 100,
    sizePct: scale * 100,
    originXPct: (pivot.x / canvasSize) * 100,
    originYPct: (pivot.y / canvasSize) * 100,
  };
}

export interface CategoryPlacement {
  visible: { anchor: AnchorSlot; instanceId: string }[];
  overflowCount: number;
  mode: 'badge' | 'representative';
}

// 装着順に依存して表示が毎回変わらないよう、instanceIdの文字列昇順で安定ソートしてから
// anchor-layouts.jsonの先頭から接続点を割り当てる。表示上限を超えた分はoverflowCountに積む。
export function placeCategory(category: string, instanceIds: string[], layouts: AnchorLayouts, autoLayout = true): CategoryPlacement {
  const anchors = layouts.layouts[category] ?? [];
  const overflow = layouts.overflow[category] ?? { visibleLimit: anchors.length, mode: 'badge' as const };
  const sorted = [...instanceIds].sort();

  if (anchors.length === 0) {
    return { visible: [], overflowCount: sorted.length, mode: overflow.mode };
  }

  if (!autoLayout) {
    // 自動配置OFF: 検証用に、全個体を先頭の接続点だけへ重ねて表示する(自動配置ONとの見た目比較用)。
    return {
      visible: sorted.map((instanceId) => ({ anchor: anchors[0], instanceId })),
      overflowCount: 0,
      mode: overflow.mode,
    };
  }

  const limit = Math.min(overflow.visibleLimit, anchors.length);
  const visible = sorted.slice(0, limit).map((instanceId, i) => ({ anchor: anchors[i], instanceId }));
  const overflowCount = Math.max(0, sorted.length - limit);
  return { visible, overflowCount, mode: overflow.mode };
}
