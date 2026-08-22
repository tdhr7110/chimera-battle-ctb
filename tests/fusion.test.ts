// ============================================================
// 部位融合(レシピ制)の検証。
//
// 仕様として要求されているのは以下の4点なので、そこだけを機械的に確かめる:
//   1. あらかじめ決まった素材が揃ったら融合できる(所持部位からレシピが成立する)
//   2. 融合部位にもレア度がある
//   3. 融合後は素材より強い
//   4. レア度が低い融合ほど、条件を満たす素材の組み合わせが広い
// 加えて、run.ts側のフロー(素材の消費・断ったレシピの再提示・進行)も見る。
// ============================================================
import {
  FUSION_RECIPES,
  effectWeight,
  findFusionCandidates,
  getFusionRecipe,
  recipeAccepts,
} from '../src/data/fusions.ts';
import { PARTS, getPart } from '../src/data/parts.ts';
import type { PartDef, PartRarity } from '../src/data/types.ts';
import {
  availableFusions,
  declineFusion,
  dismissFusionResult,
  performFusion,
  ownedPartIds,
  createTitleState,
  startNewRun,
  selectStarter,
  type RunState,
} from '../src/engine/run.ts';
import { migrate, SAVE_VERSION } from '../src/persistence/save.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('OK:', msg);
}

// ------------------------------------------------------------
// 1. レシピ表そのもの
// ------------------------------------------------------------
assert(FUSION_RECIPES.length >= 10, `融合レシピが十分ある (${FUSION_RECIPES.length}件)`);

const ids = new Set(FUSION_RECIPES.map((r) => r.id));
assert(ids.size === FUSION_RECIPES.length, '融合レシピIDが重複していない');

const collides = FUSION_RECIPES.filter((r) => PARTS.some((p) => p.id === r.id));
assert(collides.length === 0, `融合部位IDが通常部位と衝突していない (${collides.map((r) => r.id).join(',')})`);

const rarities = new Set(FUSION_RECIPES.map((r) => r.rarity));
assert(rarities.has('Rare') && rarities.has('Epic') && rarities.has('Legendary'),
  `融合部位内にレア度の階層がある (${[...rarities].join('/')})`);

const resultRarityOk = FUSION_RECIPES.every((r) => r.result.rarity === r.rarity);
assert(resultRarityOk, '結果部位のレア度がレシピのレア度と一致している');

const labelled = FUSION_RECIPES.every((r) => r.requirementLabel.length > 0 && r.result.description.length > 0);
assert(labelled, 'すべてのレシピに素材条件の表示文と説明文がある');

// getFusionPart経由で通常のgetPart()からも引ける(装備した融合部位が解決できないと壊れる)
const resolvable = FUSION_RECIPES.every((r) => getPart(r.id)?.name === r.result.name);
assert(resolvable, '融合部位が getPart() から引ける(装備後に解決できる)');

// ------------------------------------------------------------
// 2. 融合後は素材より強い
//
// 種類の違う効果を厳密には比較できないので effectWeight で「明らかに弱く
// なっていないこと」を見る。融合は素材2個を1枠に畳むので、比較は
// 「1枠あたりの価値」(= ペアの平均)で行う。
//
// 基準は2本立て:
//   (a) 条件を満たすペアの中央値を上回る  … 普通に揃えた素材より確実に強い
//   (b) 同レア度以下の素材で組める最良ペアを上回る … レア度の階段を踏み外さない
// (b)を「全ペアの最良」にしないのは、広いタグ条件のRareレシピにLegendary部位を
// 2つ突っ込むケースまで上回らせると、Rare融合がEpic部位より強くなってしまうため。
// ------------------------------------------------------------
const RARITY_RANK: Record<PartRarity, number> = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 };

/** レシピを満たす実部位のペアを、1枠あたりの重みにして全部返す。 */
function pairWeights(recipeId: string): { weight: number; capped: boolean; label: string }[] {
  const recipe = getFusionRecipe(recipeId)!;
  const out: { weight: number; capped: boolean; label: string }[] = [];
  for (let i = 0; i < PARTS.length; i++) {
    for (let j = i + 1; j < PARTS.length; j++) {
      if (!recipeAccepts(recipe, PARTS[i], PARTS[j])) continue;
      out.push({
        weight: (effectWeight(PARTS[i]) + effectWeight(PARTS[j])) / 2,
        capped: RARITY_RANK[PARTS[i].rarity] <= RARITY_RANK[recipe.rarity]
          && RARITY_RANK[PARTS[j].rarity] <= RARITY_RANK[recipe.rarity],
        label: `${PARTS[i].name} + ${PARTS[j].name}`,
      });
    }
  }
  return out;
}

/** レシピを満たす実際のペアのうち、いちばん重い組み合わせ(テストの素材役に使う)。 */
function bestMaterials(recipeId: string): PartDef[] {
  const recipe = getFusionRecipe(recipeId)!;
  let best: PartDef[] = [];
  let bestW = -1;
  for (let i = 0; i < PARTS.length; i++) {
    for (let j = i + 1; j < PARTS.length; j++) {
      if (!recipeAccepts(recipe, PARTS[i], PARTS[j])) continue;
      const w = effectWeight(PARTS[i]) + effectWeight(PARTS[j]);
      if (w > bestW) { bestW = w; best = [PARTS[i], PARTS[j]]; }
    }
  }
  return best;
}

let belowMedian = 0;
let belowSameBand = 0;
for (const recipe of FUSION_RECIPES) {
  const pairs = pairWeights(recipe.id);
  if (pairs.length === 0) continue;
  const own = effectWeight(recipe.result);

  const sorted = pairs.map((p) => p.weight).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (own <= median) {
    belowMedian++;
    console.error(`  ${recipe.id} ${recipe.name}: ${own} <= 中央値 ${median.toFixed(1)}`);
  }

  const capped = pairs.filter((p) => p.capped);
  const bestSameBand = capped.reduce((m, p) => (p.weight > m.weight ? p : m), capped[0]);
  if (bestSameBand && own <= bestSameBand.weight) {
    belowSameBand++;
    console.error(`  ${recipe.id} ${recipe.name}: ${own} <= 同レア度最良 ${bestSameBand.weight.toFixed(1)} (${bestSameBand.label})`);
  }
}
assert(belowMedian === 0, '全レシピで融合後が「普通に揃えた素材」1枠ぶんより強い');
assert(belowSameBand === 0, '全レシピで融合後が「同レア度以下の最良素材」1枠ぶんより強い');

// 効果数も素材1個より減らない(効果1つだけの寂しい融合部位を作らない)
const enoughEffects = FUSION_RECIPES.every((r) => r.result.effects.length >= 2);
assert(enoughEffects, '融合部位は必ず2つ以上の効果を持つ');

// ------------------------------------------------------------
// 3. レア度が低いほど条件が広い
//
// 「その組み合わせを満たす実部位のペア数」を広さとして数える。
// ------------------------------------------------------------
function breadth(recipeId: string): number {
  const recipe = getFusionRecipe(recipeId)!;
  let n = 0;
  for (let i = 0; i < PARTS.length; i++) {
    for (let j = i + 1; j < PARTS.length; j++) {
      if (recipeAccepts(recipe, PARTS[i], PARTS[j])) n++;
    }
  }
  return n;
}

const byRarity: Record<PartRarity, number[]> = { Common: [], Rare: [], Epic: [], Legendary: [] };
for (const r of FUSION_RECIPES) byRarity[r.rarity].push(breadth(r.id));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rareB = avg(byRarity.Rare);
const epicB = avg(byRarity.Epic);
const legB = avg(byRarity.Legendary);
console.log(`  breadth: Rare=${rareB.toFixed(1)} Epic=${epicB.toFixed(1)} Legendary=${legB.toFixed(1)}`);
assert(rareB > epicB, `Rareの条件がEpicより広い (${rareB.toFixed(1)} > ${epicB.toFixed(1)})`);
assert(epicB > legB, `Epicの条件がLegendaryより広い (${epicB.toFixed(1)} > ${legB.toFixed(1)})`);
assert(legB >= 1, 'Legendaryも実部位で必ず成立しうる(到達不能なレシピが無い)');

const everyReachable = FUSION_RECIPES.filter((r) => breadth(r.id) === 0);
assert(everyReachable.length === 0, `到達不能なレシピが無い (${everyReachable.map((r) => r.id).join(',')})`);

// ------------------------------------------------------------
// 4. 候補の抽出
// ------------------------------------------------------------
const fus101 = getFusionRecipe('FUS101')!;
const matsFor101 = bestMaterials('FUS101');
const cands = findFusionCandidates(matsFor101);
assert(cands.some((c) => c.recipe.id === 'FUS101'), '素材が揃うとレシピが候補に挙がる');

// すでに持っている融合部位は二重に作らせない
const withResult = findFusionCandidates([...matsFor101, fus101.result]);
assert(!withResult.some((c) => c.recipe.id === 'FUS101'), '所持済みの融合部位は候補に出ない');

// 同じ部位1個では成立しない(素材2枠を1個で埋めない)
assert(findFusionCandidates([matsFor101[0]]).length === 0, '部位1個では融合が成立しない');
assert(!recipeAccepts(fus101, matsFor101[0], matsFor101[0]), '同一部位を2枠に使い回せない');

// レア度の高い順に返る
const sortedOk = cands.every(
  (c, i) => i === 0 || RARITY_RANK[cands[i - 1].recipe.rarity] >= RARITY_RANK[c.recipe.rarity]
);
assert(sortedOk, '候補はレア度の高い順に並ぶ');

// ------------------------------------------------------------
// 5. run.ts のフロー
// ------------------------------------------------------------
function runWith(partIds: string[]): RunState {
  const base = selectStarter(startNewRun(createTitleState(true)), 'STR001');
  // 素材だけを持たせた状態にする(素体由来の部位は残す)。
  return { ...base, equippedPartIds: [...base.equippedPartIds, ...partIds].slice(0, 6), inventoryPartIds: [] };
}

const legendary = FUSION_RECIPES.find((r) => r.match.kind === 'part')!;
const legMats = legendary.match.kind === 'part' ? [legendary.match.a, legendary.match.b] : [];
let s = runWith(legMats);
const offered = availableFusions(s);
assert(offered.some((c) => c.recipe.id === legendary.id), '所持部位からLegendaryレシピが提示される');

const fused = performFusion(s, legendary.id);
assert(fused.phase === 'fusionResult', '融合すると結果演出フェーズへ入る');
assert(fused.lastFusionPartId === legendary.id, '結果演出に渡す部位IDが立つ');
assert(ownedPartIds(fused).includes(legendary.id), '融合部位を所持している');
assert(legMats.every((id) => !ownedPartIds(fused).includes(id)), '素材2つが消費されている');
assert(
  ownedPartIds(fused).length === ownedPartIds(s).length - 1,
  `所持数が1減る(2個消費して1個獲得: ${ownedPartIds(s).length} -> ${ownedPartIds(fused).length})`
);

const after = dismissFusionResult(fused);
assert(after.phase !== 'fusionResult', '結果演出を閉じると次のフェーズへ進む');
assert(after.lastFusionPartId === null, '結果演出を閉じると表示用IDが消える');

// 断ったレシピは再提示しない。素材は失わない。
const declined = declineFusion(s, legendary.id);
assert(!availableFusions(declined).some((c) => c.recipe.id === legendary.id), '断ったレシピは再提示されない');
assert(legMats.every((id) => ownedPartIds(declined).includes(id)), '断っても素材は失われない');

// 融合を経由しても戦闘の進行は止まらない(pendingAdvanceがあれば次の戦闘へ)
const pending = performFusion({ ...s, pendingAdvance: true }, legendary.id);
const advanced = dismissFusionResult(pending);
assert(advanced.battleIndex === s.battleIndex + 1, `融合を挟んでも次の戦闘へ進む (${s.battleIndex} -> ${advanced.battleIndex})`);
assert(advanced.pendingAdvance === false, '進んだあとは pendingAdvance が下りる');

const noPending = dismissFusionResult(performFusion(s, legendary.id));
assert(noPending.battleIndex === s.battleIndex, '進行予定が無ければ戦闘は進めない');

// 存在しないレシピや条件を満たさないレシピは何も起こさない
assert(performFusion(s, 'NOPE') === s, '存在しないレシピIDでは状態が変わらない');
const noMats = runWith([]);
const impossible = FUSION_RECIPES.find((r) => !availableFusions(noMats).some((c) => c.recipe.id === r.id))!;
assert(performFusion(noMats, impossible.id) === noMats, '素材が無いレシピは実行できない');

// ------------------------------------------------------------
// 6. セーブ移行(v5 -> v6)
// ------------------------------------------------------------
const oldSave = {
  ...s,
  declinedFusionIds: undefined,
  pendingAdvance: undefined,
  fusionUsedForBattleIndex: 3,
} as unknown as RunState;
const migrated = migrate(5, oldSave);
assert(migrated !== null, 'v5のセーブがv6へ移行できる(破棄されない)');
assert(Array.isArray(migrated!.declinedFusionIds) && migrated!.declinedFusionIds.length === 0,
  '移行後 declinedFusionIds が空配列で入る');
assert(migrated!.pendingAdvance === false, '移行後 pendingAdvance が false で入る');
assert(!('fusionUsedForBattleIndex' in (migrated as object)), '旧 fusionUsedForBattleIndex が落ちている');
assert(SAVE_VERSION === 6, `SAVE_VERSION が 6 (${SAVE_VERSION})`);
