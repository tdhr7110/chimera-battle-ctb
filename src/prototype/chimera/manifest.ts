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

interface RawManifest {
  canvasSize: number;
  categoryAnchors: Record<ChimeraSlotCategory, { x: number; y: number }>;
  parts: ChimeraPartVisual[];
  enemies: EnemyVisual[];
}

const manifest = raw as RawManifest;

export const CANVAS_SIZE = manifest.canvasSize;
export const CATEGORY_ANCHORS = manifest.categoryAnchors;

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

export function getPartVisual(id: string | null | undefined): ChimeraPartVisual | null {
  if (!id) return null;
  return partsById.get(id) ?? null;
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
