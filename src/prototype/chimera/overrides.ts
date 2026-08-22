// ============================================================
// プロトタイプ専用: 部位配置の「直感的な微調整」を支える上書き値の管理。
//
// 2段構え:
//   1. baked (overrides.json, git管理・コミット時点で全員に反映される「確定版」の調整値)
//   2. session (localStorage, このブラウザだけの「作業中」の調整値。ドラッグ/ホイール/矢印キーで
//      その場で書き換わる)
// 表示するときは baked → session の順で重ねる(sessionが常に最優先)。
// このファイルはピュアな読み書き関数だけを持ち、React/DOM操作には関与しない。
// ============================================================
import bakedRaw from './overrides.json';
import type { ChimeraPartVisual } from './types';

export interface PartOverride {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export type OverrideMap = Record<string, PartOverride>;

const baked = bakedRaw as OverrideMap;

const SESSION_STORAGE_KEY = 'proto-chimera-session-overrides-v1';

export function bakedOverrideFor(id: string): PartOverride | undefined {
  return baked[id];
}

export function applyOverride(part: ChimeraPartVisual, override: PartOverride | undefined): ChimeraPartVisual {
  if (!override) return part;
  return { ...part, offsetX: override.offsetX, offsetY: override.offsetY, scale: override.scale };
}

export function loadSessionOverrides(): OverrideMap {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OverrideMap) : {};
  } catch {
    return {};
  }
}

export function saveSessionOverrides(overrides: OverrideMap): void {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // プライベートブラウズ等でlocalStorageが使えない場合は、保存を諦めて画面上の調整だけ有効にする。
  }
}
