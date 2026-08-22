import type { PartDef, PartRarity, PartTag } from './types';

// ============================================================
// 部位融合(Excel「融合」シート)。
//
// 融合は「あらかじめ決まった素材の組み合わせ」で成立する。所持部位がレシピを
// 満たした瞬間に成立候補になり、実行すると素材2つを消費して融合部位が手に入る。
//
// 素材条件は2種類:
//   kind: 'tag'  … 素材A/Bはタグ。そのタグを持つ部位ならどれでもよい(条件が広い)
//   kind: 'part' … 素材A/Bは部位ID。その部位そのものが要る(条件が狭い)
//
// レア度が低いほど条件を広く取ってある:
//   Rare      … すべてタグ条件。序盤の拾い物同士でも噛み合う
//   Epic      … タグ条件だが母数の少ないタグ同士なので、狙って揃える必要がある
//   Legendary … 部位指定。特定のLegendary部位2つを引き当てたときだけ成立する
//
// 効果は必ず素材より強い(素材が持つ軸を伸ばしたうえで、もう1軸足してある)。
// 使えるのは現行のPartEffectだけで、エンジンに解決フックが無い効果は書かない。
// ============================================================

export type FusionMatch =
  | { kind: 'tag'; a: PartTag; b: PartTag }
  | { kind: 'part'; a: string; b: string };

export interface FusionRecipe {
  id: string;
  name: string;
  icon: string;
  rarity: PartRarity;
  match: FusionMatch;
  /** 素材条件を人が読める形にしたもの(UI表示用)。 */
  requirementLabel: string;
  result: PartDef;
}

const RARITY_ORDER: Record<PartRarity, number> = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 };

export const FUSION_RECIPES: FusionRecipe[] = [
  // ---------- Rare: タグ条件。もっとも当てはまりが広い ----------
  {
    id: 'FUS101', name: '灼熱牙', icon: '🔥', rarity: 'Rare',
    match: { kind: 'tag', a: '炎', b: '攻撃' },
    requirementLabel: '「炎」の部位 ＋ 「攻撃」の部位',
    result: {
      id: 'FUS101', name: '灼熱牙', icon: '🔥', type: '頭', rarity: 'Rare', tags: ['炎', '攻撃'],
      effects: [
        { kind: 'power_bonus_all_pct', pct: 18 },
        { kind: 'on_hit_apply_status', status: { kind: 'burn', magnitude: 4, turns: 3 } },
      ],
      description: '炎の器官と攻撃器官を噛み合わせた顎。素の火炎頭より火力も燃焼も上。',
    },
  },
  {
    id: 'FUS102', name: '猛毒腺', icon: '☠️', rarity: 'Rare',
    match: { kind: 'tag', a: '毒', b: '状態異常' },
    requirementLabel: '「毒」の部位 ＋ 「状態異常」の部位',
    result: {
      id: 'FUS102', name: '猛毒腺', icon: '☠️', type: 'その他', rarity: 'Rare', tags: ['毒', '状態異常'],
      effects: [
        { kind: 'on_hit_apply_status', status: { kind: 'poison', magnitude: 4, turns: 4 } },
        { kind: 'status_magnitude_bonus', target: 'poison', flatAmount: 3 },
      ],
      description: '毒腺を二重化したもの。毒の乗りが速く、濃くなる。',
    },
  },
  {
    id: 'FUS103', name: '疾風装甲', icon: '🛡️', rarity: 'Rare',
    match: { kind: 'tag', a: '高速', b: '防御' },
    requirementLabel: '「高速」の部位 ＋ 「防御」の部位',
    result: {
      id: 'FUS103', name: '疾風装甲', icon: '🛡️', type: '体', rarity: 'Rare', tags: ['高速', '防御'],
      effects: [
        { kind: 'speed_flat', amount: 12 },
        { kind: 'defense_flat_bonus', amount: 6 },
        { kind: 'evasion_bonus_pct', pct: 6 },
      ],
      description: '軽さを殺さない装甲。素の防具より硬く、素の脚より速く、そのうえ避ける。',
    },
  },
  {
    id: 'FUS104', name: '時喰核', icon: '⏳', rarity: 'Rare',
    match: { kind: 'tag', a: '時間', b: 'MP' },
    requirementLabel: '「時間」の部位 ＋ 「MP」の部位',
    result: {
      id: 'FUS104', name: '時喰核', icon: '⏳', type: 'コア', rarity: 'Rare', tags: ['時間', 'MP'],
      effects: [
        { kind: 'delay_effect_bonus_pct', pct: 30 },
        { kind: 'max_mp_bonus', amount: 18 },
      ],
      description: '時間干渉器官と魔力嚢の融合核。遅延を撃ち続けるための燃料と威力を同時に得る。',
    },
  },
  {
    id: 'FUS105', name: '反射棘甲', icon: '🌵', rarity: 'Rare',
    match: { kind: 'tag', a: '反撃', b: '重量' },
    requirementLabel: '「反撃」の部位 ＋ 「重量」の部位',
    result: {
      id: 'FUS105', name: '反射棘甲', icon: '🌵', type: '体', rarity: 'Rare', tags: ['反撃', '重量'],
      effects: [
        { kind: 'reflect_on_hit_pct', pct: 26 },
        { kind: 'defense_flat_bonus', amount: 6 },
        { kind: 'counter_on_hit', chancePct: 18, powerMult: 0.6 },
      ],
      description: '棘と重装甲を編んだもの。殴られること自体が攻撃手段になり、時には殴り返す。',
    },
  },
  {
    id: 'FUS106', name: '捕食顎', icon: '🦈', rarity: 'Rare',
    match: { kind: 'tag', a: '捕食', b: '吸血' },
    requirementLabel: '「捕食」の部位 ＋ 「吸血」の部位',
    result: {
      id: 'FUS106', name: '捕食顎', icon: '🦈', type: '頭', rarity: 'Rare', tags: ['捕食', '吸血'],
      effects: [
        { kind: 'lifesteal_bonus_pct', pct: 25 },
        { kind: 'on_kill_mp_gain', amount: 10 },
      ],
      description: '捕食器官と吸血口の融合。倒すほど息を吹き返す。',
    },
  },

  // ---------- Epic: タグ条件だが、母数の少ないタグ同士 ----------
  {
    id: 'FUS201', name: '多重腕', icon: '🦑', rarity: 'Epic',
    match: { kind: 'tag', a: '多腕', b: '多段' },
    requirementLabel: '「多腕」の部位 ＋ 「多段」の部位',
    result: {
      id: 'FUS201', name: '多重腕', icon: '🦑', type: '腕', rarity: 'Epic', tags: ['多段', '多腕'],
      effects: [
        { kind: 'bonus_hits_flat', amount: 1 },
        { kind: 'power_bonus_light_pct', pct: 18 },
        { kind: 'speed_flat', amount: 4 },
      ],
      description: '腕を束ねて多重化したもの。手数で押し切るビルドの中核。',
    },
  },
  {
    id: 'FUS202', name: '解析角', icon: '🧠', rarity: 'Epic',
    match: { kind: 'tag', a: '知性', b: '貫通' },
    requirementLabel: '「知性」の部位 ＋ 「貫通」の部位',
    result: {
      id: 'FUS202', name: '解析角', icon: '🧠', type: '頭', rarity: 'Epic', tags: ['知性', '貫通'],
      effects: [
        { kind: 'utility_ct_bonus_pct', pct: -20 },
        { kind: 'ignore_defense_pct', pct: 35 },
        { kind: 'accuracy_bonus_pct', pct: 8 },
      ],
      description: '知性器官と穿孔角の融合。守りを読み切り、準備も速くなる。',
    },
  },
  {
    id: 'FUS203', name: '雷光眼', icon: '⚡', rarity: 'Epic',
    match: { kind: 'tag', a: '雷', b: '高速' },
    requirementLabel: '「雷」の部位 ＋ 「高速」の部位',
    result: {
      id: 'FUS203', name: '雷光眼', icon: '⚡', type: '頭', rarity: 'Epic', tags: ['雷', '高速'],
      effects: [
        { kind: 'accuracy_bonus_pct', pct: 15 },
        { kind: 'ct_mult_all_pct', pct: -11 },
        { kind: 'on_hit_apply_status', status: { kind: 'shock', magnitude: 2, turns: 3 } },
      ],
      description: '雷を宿した複眼。見てから動くまでが速い。',
    },
  },
  {
    id: 'FUS204', name: '暴走再生心', icon: '💢', rarity: 'Epic',
    match: { kind: 'tag', a: '暴走', b: '再生' },
    requirementLabel: '「暴走」の部位 ＋ 「再生」の部位',
    result: {
      id: 'FUS204', name: '暴走再生心', icon: '💢', type: 'コア', rarity: 'Epic', tags: ['暴走', '再生'],
      effects: [
        { kind: 'low_hp_ct_bonus', hpPctThreshold: 50, ctMultPct: -20 },
        { kind: 'passive_regen_per_turn', amount: 5 },
        { kind: 'max_hp_bonus', amount: 15 },
      ],
      description: '暴走心臓に再生組織を編み込んだもの。追い詰められるほど速く、しぶとい。',
    },
  },

  // ---------- Legendary: 部位そのものを指定。最も狭く、最も強い ----------
  {
    id: 'FUS301', name: '終焉の顎', icon: '🐲', rarity: 'Legendary',
    match: { kind: 'part', a: 'PRT013', b: 'PRT028' },
    requirementLabel: '処刑眼・極 ＋ 多腕・零',
    result: {
      id: 'FUS301', name: '終焉の顎', icon: '🐲', type: '頭', rarity: 'Legendary', tags: ['処刑', '多段', '攻撃'],
      effects: [
        { kind: 'bonus_hits_flat', amount: 1 },
        { kind: 'power_bonus_all_pct', pct: 22 },
        { kind: 'execute_bonus_passive', hpPctThreshold: 30, bonusMult: 2.0 },
        { kind: 'on_kill_ct_bonus_pct', pct: 25 },
      ],
      description: '処刑眼・極と多腕・零を融合した顎。弱った敵を確実に噛み切る。',
    },
  },
  {
    id: 'FUS302', name: '時空の王冠', icon: '👑', rarity: 'Legendary',
    match: { kind: 'part', a: 'PRT055', b: 'PRT077' },
    requirementLabel: '時間尾・極 ＋ 魔力嚢・零',
    result: {
      id: 'FUS302', name: '時空の王冠', icon: '👑', type: 'コア', rarity: 'Legendary', tags: ['時間', 'MP', '妨害'],
      effects: [
        { kind: 'delay_effect_bonus_pct', pct: 45 },
        { kind: 'max_mp_bonus', amount: 30 },
        { kind: 'utility_ct_bonus_pct', pct: -25 },
      ],
      description: '時間尾・極と魔力嚢・零を編み込んだ核。時間そのものを資源にする。',
    },
  },
  {
    id: 'FUS303', name: '雷神角', icon: '🌩️', rarity: 'Legendary',
    match: { kind: 'part', a: 'PRT069', b: 'PRT068' },
    requirementLabel: '雷角・極 ＋ 穿孔角・異',
    result: {
      id: 'FUS303', name: '雷神角', icon: '🌩️', type: '頭', rarity: 'Legendary', tags: ['雷', '貫通', '状態異常'],
      effects: [
        { kind: 'ignore_defense_pct', pct: 45 },
        { kind: 'power_bonus_all_pct', pct: 20 },
        { kind: 'on_hit_apply_status', status: { kind: 'shock', magnitude: 3, turns: 3 } },
        { kind: 'speed_flat', amount: 6 },
      ],
      description: '雷角・極に穿孔角・異を貫かせたもの。硬い相手ほどよく通る。',
    },
  },
];

export const FUSION_PARTS: PartDef[] = FUSION_RECIPES.map((r) => r.result);

export function getFusionPart(id: string): PartDef | undefined {
  return FUSION_PARTS.find((p) => p.id === id);
}

export function getFusionRecipe(id: string): FusionRecipe | undefined {
  return FUSION_RECIPES.find((r) => r.id === id);
}

function sideMatches(part: PartDef, side: string, kind: 'tag' | 'part'): boolean {
  return kind === 'tag' ? (part.tags as string[]).includes(side) : part.id === side;
}

/** この2部位がレシピの素材条件を満たすか(素材の順序は問わない)。 */
export function recipeAccepts(recipe: FusionRecipe, x: PartDef, y: PartDef): boolean {
  if (x.id === y.id) return false;
  const { kind, a, b } = recipe.match;
  return (sideMatches(x, a, kind) && sideMatches(y, b, kind)) || (sideMatches(y, a, kind) && sideMatches(x, b, kind));
}

export interface FusionCandidate {
  recipe: FusionRecipe;
  materialIds: [string, string];
}

/**
 * 所持部位から成立する融合をすべて挙げる純粋関数。
 * すでに持っている融合部位は候補にしない(同じものを二重に作らない)。
 * レア度の高い順に返すので、呼び出し側は先頭を「一番おいしい融合」として扱える。
 */
export function findFusionCandidates(ownedParts: PartDef[]): FusionCandidate[] {
  const ownedIds = new Set(ownedParts.map((p) => p.id));
  const out: FusionCandidate[] = [];
  for (const recipe of FUSION_RECIPES) {
    if (ownedIds.has(recipe.id)) continue;
    let found: [string, string] | null = null;
    for (let i = 0; i < ownedParts.length && !found; i++) {
      for (let j = i + 1; j < ownedParts.length && !found; j++) {
        if (recipeAccepts(recipe, ownedParts[i], ownedParts[j])) {
          found = [ownedParts[i].id, ownedParts[j].id];
        }
      }
    }
    if (found) out.push({ recipe, materialIds: found });
  }
  return out.sort((a, b) => RARITY_ORDER[b.recipe.rarity] - RARITY_ORDER[a.recipe.rarity]);
}

/**
 * 効果量のおおまかな重み。融合結果が素材より強いことをテストで機械的に確かめるために使う
 * (種類の違う効果を厳密に比較はできないので、あくまで「明らかに弱くなっていない」ことの検出用)。
 */
export function effectWeight(part: PartDef): number {
  let total = 0;
  for (const e of part.effects) {
    const v = e as unknown as Record<string, number>;
    // %系はそのまま、実数系は2倍(+5防御 と +5% は同じ重さではない)。
    total += Math.abs(v.pct ?? 0) + (Math.abs(v.amount ?? 0) + Math.abs(v.flatAmount ?? 0)) * 2;
    if (v.bonusMult) total += v.bonusMult * 10;
    // CT短縮は増減分で入っている(-20 = 20%短縮)ので、絶対値をそのまま重みにする。
    if (v.ctMultPct) total += Math.abs(v.ctMultPct);
    if (v.chancePct) total += v.chancePct;
    // 状態異常の付与は「量 × ターン数」でおおよその総量に直す。
    if ('status' in e) {
      const st = (e as unknown as { status: { magnitude?: number; turns?: number } }).status;
      total += 6 + (st.magnitude ?? 1) * (st.turns ?? 1);
    }
  }
  return total;
}
