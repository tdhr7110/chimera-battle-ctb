import { ENEMIES } from './enemies';
import { PARTS } from './parts';
import type { EnemyDef, PartDef, PartRarity, PartTag } from './types';

// ============================================================
// 敵所持部位ドロップ(Phase 1)。
//
// データの出どころはすべてExcelマスターで、このファイルは一切のドロップ表を
// 手書きしない:
//   - どのタグの部位を落とすか … Excel「敵」シートの「ドロップタグ」列(45敵すべてに値あり)
//   - 通常枠かレア枠か         … Excel「部位」シートの「レア度」列
//   - どの部位がそのタグか     … Excel「部位」シートの「タグ1/タグ2」列
// つまりドロップ表はExcelを編集すれば自動で変わる。generated JSONやrun.tsへ
// 部位IDを直接書き込むことはしない。
//
// ただしExcelの「ドロップタグ」はアーキタイプ語彙(炎上/遅延/MP破壊/変異/氷)で書かれており、
// 部位側のタグ語彙(PartTag)と完全には一致しない。コマンド解放のunlockTagで既に採った方針と
// 同じく、意味的に最も近い実在PartTagへ変換する対応表をここに1か所だけ持つ。
// ============================================================

// Excelのドロップタグ(15種) → 実在するPartTagへの変換。
// 1タグだけでは部位の母数が極端に少ない系統(炎2件・処刑2件・再生2件・進化1件・多段4件・雷4件)は、
// アーキタイプとして意味の通る近縁タグを補助的に足して、ドロップ候補が枯れないようにしている。
// 先頭のタグがその敵の「主系統」で、dropSummaryの表示にも使う。
const DROP_TAG_TO_PART_TAGS: Record<string, PartTag[]> = {
  高速: ['高速'], //             17件
  重量: ['重量'], //             14件
  毒: ['毒'], //                  6件
  炎上: ['炎', '状態異常'], //    2件 + 6件
  遅延: ['時間'], //             12件
  反撃: ['反撃'], //              7件
  処刑: ['処刑', '貫通'], //      2件 + 2件
  多段: ['多段', '多腕'], //      4件 + 3件
  暴走: ['暴走'], //              9件
  知性: ['知性'], //             10件
  // 進化1件・コア3件はすべてCommon/RareでEpic以上が0件(Excelマスター側のタグ分布の偏り)。
  // レア枠が空にならないよう、同じ「体内器官・核」系統である器官タグを補助として足している。
  変異: ['進化', 'コア', '器官'], // 1件 + 3件 + 7件
  MP破壊: ['MP'], //              9件
  氷: ['状態異常', '妨害'], //    6件 + 4件(Excelに「氷」PartTagは存在しない)
  雷: ['雷', '状態異常'], //      4件 + 6件
  再生: ['再生', '器官'], //      2件 + 7件
};

// 通常ドロップ枠に入れるレア度と、レアドロップ枠に入れるレア度。
const NORMAL_RARITIES: PartRarity[] = ['Common', 'Rare'];
const RARE_RARITIES: PartRarity[] = ['Epic', 'Legendary'];

// レア枠が抽選に混ざる確率(敵の階級ごと)。通常敵でもゼロにはしないが、
// エリート・ボスほど上位部位が出やすい。
export const RARE_DROP_CHANCE_PCT: Record<EnemyDef['tier'], number> = {
  normal: 8,
  elite: 22,
  boss: 40,
};

export interface EnemyDropDef {
  enemyId: string;
  partTags: PartTag[]; // Excelドロップタグを変換した結果
  bodyPartIds: string[]; // 通常ドロップ候補(Common/Rare)
  rareDropPartIds: string[]; // レアドロップ候補(Epic/Legendary)
  dropSummary: string; // 敵選択カードに出す短い説明
}

/** Excelのドロップタグ列を、実在するPartTagの配列へ変換する(未知タグは黙って捨てない=空配列で表面化させる)。 */
export function partTagsForDropTags(dropTags: string[]): PartTag[] {
  const out: PartTag[] = [];
  for (const raw of dropTags) {
    for (const tag of DROP_TAG_TO_PART_TAGS[raw] ?? []) {
      if (!out.includes(tag)) out.push(tag);
    }
  }
  return out;
}

function partsWithAnyTag(parts: PartDef[], tags: PartTag[], rarities: PartRarity[]): string[] {
  return parts.filter((p) => rarities.includes(p.rarity) && p.tags.some((t) => tags.includes(t))).map((p) => p.id);
}

/** 1体分のドロップ定義を導出する純粋関数(テストから任意のPARTS配列を渡せるようにしてある)。 */
export function buildEnemyDrop(enemy: EnemyDef, parts: PartDef[] = PARTS): EnemyDropDef {
  const partTags = partTagsForDropTags(enemy.dropTags);
  const primary = enemy.dropTags[0] ?? '';
  return {
    enemyId: enemy.id,
    partTags,
    bodyPartIds: partsWithAnyTag(parts, partTags, NORMAL_RARITIES),
    rareDropPartIds: partsWithAnyTag(parts, partTags, RARE_RARITIES),
    dropSummary: primary ? `${primary}系の部位` : '不明',
  };
}

export const ENEMY_DROPS: Record<string, EnemyDropDef> = Object.fromEntries(
  ENEMIES.map((e) => [e.id, buildEnemyDrop(e)])
);

export function getEnemyDrop(enemyId: string): EnemyDropDef | undefined {
  return ENEMY_DROPS[enemyId];
}
