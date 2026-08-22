// ============================================================
// プロトタイプ専用: ランダムキメラ生成(仕様書11章)。
// 「押すたびに7カテゴリからランダムに部位を選択して、即座にキメラを生成する」。
//
// body/head/core は常に何かしら装着する(素体としての体裁を保つため)。
// front/leg/wing/tailは一定確率で「なし」も選ばれる(仕様書10章: 羽などは
// 「なし」も選択可能、というプロトタイプ要件の確認を兼ねる)。
// ============================================================
import { partsForCategory } from './manifest';
import { SLOT_CATEGORIES, type ChimeraLoadout } from './types';

const ALWAYS_FILLED = new Set(['body', 'head', 'core']);
const NONE_CHANCE = 0.25;

export function randomLoadout(): ChimeraLoadout {
  const loadout = {} as ChimeraLoadout;
  for (const category of SLOT_CATEGORIES) {
    const pool = partsForCategory(category);
    if (pool.length === 0) {
      loadout[category] = null;
      continue;
    }
    if (!ALWAYS_FILLED.has(category) && Math.random() < NONE_CHANCE) {
      loadout[category] = null;
      continue;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    loadout[category] = pick.id;
  }
  return loadout;
}
