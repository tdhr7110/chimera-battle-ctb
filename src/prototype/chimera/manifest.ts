// ============================================================
// プロトタイプ専用: 7スロット・キメラのvisual manifestローダー。
//
// generated-visuals.json は scripts/prototype-assets/build_prototype_assets.py が
// 一度だけ生成した静的データ(PRTxxx/ENMxxx ID→画像パス・アンカー・スケール・zIndex)。
// src/data/generated/*.json (Excel由来の本番データ)とは別ディレクトリ・別ファイルであり、
// 依存関係は「このファイルがsrc/data/generated/parts.json・enemies.jsonのIDを読むだけ」の
// 片方向。本番側がこちらを参照することは無い。
// ============================================================
import raw from './generated-visuals.json';
import type { ChimeraPartVisual, ChimeraSlotCategory, EnemyVisual } from './types';
import { SLOT_CATEGORIES } from './types';
import { applyOverride, bakedOverrideFor } from './overrides';

interface RawManifest {
  canvasSize: number;
  categoryAnchors: Record<ChimeraSlotCategory, { x: number; y: number }>;
  categoryTargetHeight: Record<ChimeraSlotCategory, number>;
  parts: ChimeraPartVisual[];
  enemies: EnemyVisual[];
}

const manifest = raw as RawManifest;

export const CANVAS_SIZE = manifest.canvasSize;
export const CATEGORY_ANCHORS = manifest.categoryAnchors;
// カテゴリの「基準の高さ」(canvas px)。実際の描画スケールはこれを、ブラウザが読み込んだ
// 画像の実ピクセル高さ(naturalHeight)で割って求める(layout.ts参照)。画像を後から
// 別解像度へ差し替えても、この基準の高さに自動で合わせ直される。
export const CATEGORY_TARGET_HEIGHT = manifest.categoryTargetHeight;

const partsById = new Map(manifest.parts.map((p) => [p.id, p] as const));
const enemiesById = new Map(manifest.enemies.map((e) => [e.id, e] as const));

const partsByCategory: Record<ChimeraSlotCategory, ChimeraPartVisual[]> = {
  head: [],
  body: [],
  front: [],
  leg: [],
  wing: [],
  tail: [],
  core: [],
};
for (const p of manifest.parts) partsByCategory[p.category].push(p);
for (const cat of SLOT_CATEGORIES) partsByCategory[cat].sort((a, b) => a.id.localeCompare(b.id));

// overrides.json(コミット済みの確定調整値)を常に適用したうえで返す。
// ブラウザ内だけの作業中調整(session override)はここでは反映しない。
// ChimeraCanvas/デバッグパネルはこの戻り値を起点に、さらにsession overrideを重ねる。
export function getPartVisual(id: string | null | undefined): ChimeraPartVisual | null {
  if (!id) return null;
  const base = partsById.get(id);
  if (!base) return null;
  return applyOverride(base, bakedOverrideFor(id));
}

export function getEnemyVisual(id: string | null | undefined): EnemyVisual | null {
  if (!id) return null;
  return enemiesById.get(id) ?? null;
}

export function partsForCategory(category: ChimeraSlotCategory): ChimeraPartVisual[] {
  return partsByCategory[category];
}

export function allEnemyVisuals(): EnemyVisual[] {
  return manifest.enemies;
}

export const PART_ASSET_BASE = `${import.meta.env.BASE_URL}`;
