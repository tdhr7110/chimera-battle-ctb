// TEST11: public/assets/chimera-layers/ の layer-manifest.json / anchor-layouts.json の型定義。
// JSONは実行時にfetchして読み込むため、ここには形だけを定義する。

export interface Vec2 {
  x: number;
  y: number;
}

export interface LayerAsset {
  id: string;
  category: string;
  file: string;
  pivot: Vec2;
  defaultScale: number;
  mirrorable: boolean;
  rotatable: boolean;
  zGroup: number;
}

export interface LayerManifest {
  version: number;
  canvas: { width: number; height: number };
  assets: LayerAsset[];
}

export interface AnchorSlot {
  x: number;
  y: number;
  rotation: number;
  mirror: boolean;
  z: number;
}

export interface OverflowRule {
  visibleLimit: number;
  mode: 'badge' | 'representative';
}

export interface AnchorLayouts {
  version: number;
  coordinateSystem: string;
  layouts: Record<string, AnchorSlot[]>;
  overflow: Record<string, OverflowRule>;
}
