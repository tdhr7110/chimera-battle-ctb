// ============================================================
// プロトタイプ専用: 7スロット固定・レイヤー合成キメラの型定義。
//
// 本番の src/data/types.ts (PartDef 等) には一切手を入れず、完全に独立した
// 型セットとしてここへ定義する。ゲームロジック側の部位データ(PartDef)に
// 画像位置情報を直接埋め込まない(仕様書5章: 「visual manifestを別データとして
// 持つ構成を優先する」)ための、見た目専用のレイヤー。
// ============================================================

export type ChimeraSlotCategory = 'head' | 'body' | 'front' | 'leg' | 'wing' | 'tail' | 'core';

export const SLOT_CATEGORIES: ChimeraSlotCategory[] = ['head', 'body', 'front', 'leg', 'wing', 'tail', 'core'];

export const SLOT_LABEL: Record<ChimeraSlotCategory, { jp: string; en: string; icon: string }> = {
  head: { jp: '頭', en: 'HEAD', icon: '💀' },
  body: { jp: '胴体', en: 'BODY', icon: '🦴' },
  front: { jp: '前脚', en: 'FRONT', icon: '💪' },
  leg: { jp: '後ろ脚', en: 'LEG', icon: '🦵' },
  wing: { jp: '羽', en: 'WING', icon: '🪽' },
  tail: { jp: '尻尾', en: 'TAIL', icon: '🐾' },
  core: { jp: 'コア', en: 'CORE', icon: '❤️' },
};

// 仕様書5章のChimeraPartVisual。id/name/category/image/anchorX/anchorY/scale/zIndexは
// 仕様書の指定どおり。加えて、6章の「個別画像ごとの微調整はoffsetX/offsetY/scale程度」を
// 実現するための任意フィールド(offsetX/offsetY)を持たせている。
//
// 画像の後日差し替えやすさのため、width/height/scaleはビルド時の画素数を「焼き込んで」
// 使わない設計にしている(layout.tsのコメント参照)。width/heightは参考表示用のメタ情報
// (デバッグパネルの「source size」表示等)、scaleは「カテゴリの基準サイズ(=ブラウザが
// 実際に読み込んだ画像のnaturalHeightから自動計算)に対する倍率」という意味の任意フィールド
// (省略時は1=基準サイズのまま)。そのため、public/assets/prototype-chimera/parts/配下の
// PNGを後から別解像度の絵に差し替えても、リビルド無しでサイズ・アンカーが自動的に合う。
//
// anchorX/anchorYの単位: この画像自身のbbox内における0〜1の割合(ピボット位置)。
// 例: head の anchorX=0.82 は「画像の右寄り(=首側)をCATEGORY_ANCHORSへ合わせる」という意味。
// 差し替え後の画像でも、この「割合」は解像度に依存しないため引き続き有効に働く。
export interface ChimeraPartVisual {
  id: string;
  name: string;
  category: ChimeraSlotCategory;
  excelCategory: string; // 元Excelのカテゴリ(頭/目/口/腕/脚/心臓/胴/尻尾/翼/角/器官/コア)。表示用。
  image: string; // public/ からの相対パス
  anchorX: number;
  anchorY: number;
  zIndex: number;
  scale?: number; // カテゴリ基準サイズに対する倍率(省略時1)。ドラッグ/ホイール調整やoverrides.jsonが使う。
  offsetX?: number;
  offsetY?: number;
  width?: number; // 参考情報(ビルド時点の画素幅)。描画には使わない。
  height?: number; // 参考情報(ビルド時点の画素高さ)。描画には使わない。
}

export interface EnemyVisual {
  id: string;
  name: string;
  tier: 'normal' | 'elite' | 'boss';
  image: string;
  width: number;
  height: number;
}

export interface ChimeraVisualManifest {
  canvasSize: number;
  categoryAnchors: Record<ChimeraSlotCategory, { x: number; y: number }>;
  categoryTargetHeight: Record<ChimeraSlotCategory, number>;
  parts: ChimeraPartVisual[];
  enemies: EnemyVisual[];
}

// カテゴリごとに1部位だけ(仕様書1章: 1カテゴリ=1部位、最大7部位)。
// null = 未装着(「なし」)。
export type ChimeraLoadout = Record<ChimeraSlotCategory, string | null>;

export const EMPTY_LOADOUT: ChimeraLoadout = {
  head: null,
  body: null,
  front: null,
  leg: null,
  wing: null,
  tail: null,
  core: null,
};
