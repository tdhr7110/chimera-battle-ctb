import type { PartDef, PartTag } from './types';

// ============================================================
// Phase 5: 任意の部位融合。
//
// src/data/generated/fusions.json(Excel「融合」シート由来)の11行を、他のデータと同じく
// 型付きの定義へ落としたもの。組み合わせ表も効果もExcel側が編集元で、ここは
// 「Excelの効果文を現行のPartEffectへ翻訳した結果」だけを持つ。
//
// 設計上の重要な制約:
//   - 融合結果は「素材2つのタグの組み合わせ」で決まる有限のルール表であって、
//     ランダム生成ではない。結果の部位IDはFUS000〜FUS010の11種類しか存在せず、
//     セーブに入るのも常にこのIDなので、保存形式が不安定にならない。
//   - 効果はすべて現行のPartEffect(=engineに実解決フックがあるもの)だけで構成する。
//     Excelの効果文に書けても現行エンジンで表現できないものは、そもそも書かない。
//   - 素材タグA/Bが空のFUS000はワイルドカード。どのルールにも当てはまらない
//     2部位を融合したときの既定の結果で、これがあるおかげで「融合できない詰み」が無い。
// ============================================================

export interface FusionRuleDef {
  id: string;
  name: string;
  icon: string;
  tagA: PartTag | null; // null = ワイルドカード
  tagB: PartTag | null;
  result: PartDef; // 融合で得られる部位(idはルールIDと同じ)
}

// レア度はExcelの部位シートに無い概念(融合部位はExcelの80部位ではない)。
// ドロップ抽選の対象にはしないが、PartDefの必須項目なので最上位として扱う。
const FUSION_RARITY = 'Legendary' as const;

export const FUSION_RULES: FusionRuleDef[] = [
  {
    id: 'FUS001',
    name: '灼熱牙',
    icon: '🔥',
    tagA: '炎',
    tagB: '攻撃',
    result: {
      id: 'FUS001',
      name: '灼熱牙',
      icon: '🔥',
      type: '口',
      rarity: FUSION_RARITY,
      tags: ['炎', '攻撃'],
      effects: [
        { kind: 'power_bonus_all_pct', pct: 14 },
        { kind: 'on_hit_apply_status', status: { kind: 'burn', magnitude: 3, turns: 2 } },
      ],
      description: '炎の器官と攻撃器官を融合した顎。攻撃力を底上げし、当たるたび相手を燃やす。',
    },
  },
  {
    id: 'FUS002',
    name: '猛毒腺',
    icon: '☠️',
    tagA: '毒',
    tagB: '状態異常',
    result: {
      id: 'FUS002',
      name: '猛毒腺',
      icon: '☠️',
      type: '器官',
      rarity: FUSION_RARITY,
      tags: ['毒', '状態異常'],
      effects: [
        { kind: 'on_hit_apply_status', status: { kind: 'poison', magnitude: 3, turns: 3 } },
        { kind: 'status_magnitude_bonus', target: 'poison', flatAmount: 2 },
      ],
      description: '毒腺と状態異常器官の融合。毒を撒く頻度と濃度の両方が上がる。',
    },
  },
  {
    id: 'FUS003',
    name: '疾風装甲',
    icon: '🛡️',
    tagA: '高速',
    tagB: '防御',
    result: {
      id: 'FUS003',
      name: '疾風装甲',
      icon: '🛡️',
      type: '胴',
      rarity: FUSION_RARITY,
      tags: ['高速', '防御'],
      effects: [
        { kind: 'speed_flat', amount: 8 },
        { kind: 'defense_flat_bonus', amount: 3 },
      ],
      description: '軽量装甲。速さを保ったまま打たれ強さを足す。',
    },
  },
  {
    id: 'FUS004',
    name: '時喰核',
    icon: '⏳',
    tagA: '時間',
    tagB: 'MP',
    result: {
      id: 'FUS004',
      name: '時喰核',
      icon: '⏳',
      type: 'コア',
      rarity: FUSION_RARITY,
      tags: ['時間', 'MP'],
      effects: [
        { kind: 'delay_effect_bonus_pct', pct: 25 },
        { kind: 'max_mp_bonus', amount: 15 },
      ],
      description: '時間干渉器官と魔力嚢の融合核。遅延を撃ち続ける燃料と威力を同時に得る。',
    },
  },
  {
    id: 'FUS005',
    name: '暴走再生心',
    icon: '💢',
    tagA: '暴走',
    tagB: '再生',
    result: {
      id: 'FUS005',
      name: '暴走再生心',
      icon: '💢',
      type: '心臓',
      rarity: FUSION_RARITY,
      tags: ['暴走', '再生'],
      effects: [
        { kind: 'low_hp_ct_bonus', hpPctThreshold: 50, ctMultPct: -15 },
        { kind: 'passive_regen_per_turn', amount: 3 },
      ],
      description: '暴走心臓に再生組織を編み込んだもの。追い詰められるほど速くなり、じわじわ立て直す。',
    },
  },
  {
    id: 'FUS006',
    name: '反射棘甲',
    icon: '🌵',
    tagA: '反撃',
    tagB: '重量',
    result: {
      id: 'FUS006',
      name: '反射棘甲',
      icon: '🌵',
      type: '胴',
      rarity: FUSION_RARITY,
      tags: ['反撃', '重量'],
      effects: [
        { kind: 'reflect_on_hit_pct', pct: 18 },
        { kind: 'defense_flat_bonus', amount: 4 },
      ],
      description: '棘甲と重装甲の融合。殴られること自体が攻撃手段になる。',
    },
  },
  {
    id: 'FUS007',
    name: '捕食顎',
    icon: '🦈',
    tagA: '捕食',
    tagB: '吸血',
    result: {
      id: 'FUS007',
      name: '捕食顎',
      icon: '🦈',
      type: '口',
      rarity: FUSION_RARITY,
      tags: ['捕食', '吸血'],
      effects: [
        { kind: 'lifesteal_bonus_pct', pct: 20 },
        { kind: 'on_kill_mp_gain', amount: 8 },
      ],
      description: '捕食器官と吸血口の融合。倒すほど息を吹き返す、長期戦向けの顎。',
    },
  },
  {
    id: 'FUS008',
    name: '多重腕',
    icon: '🦑',
    tagA: '多段',
    tagB: '多腕',
    result: {
      id: 'FUS008',
      name: '多重腕',
      icon: '🦑',
      type: '腕',
      rarity: FUSION_RARITY,
      tags: ['多段', '多腕'],
      effects: [
        { kind: 'bonus_hits_flat', amount: 1 },
        { kind: 'power_bonus_light_pct', pct: 12 },
      ],
      description: '腕を束ねて多重化したもの。手数で押し切るビルドの中核。',
    },
  },
  {
    id: 'FUS009',
    name: '解析角',
    icon: '🧠',
    tagA: '知性',
    tagB: '貫通',
    result: {
      id: 'FUS009',
      name: '解析角',
      icon: '🧠',
      type: '角',
      rarity: FUSION_RARITY,
      tags: ['知性', '貫通'],
      effects: [
        { kind: 'utility_ct_bonus_pct', pct: -15 },
        { kind: 'ignore_defense_pct', pct: 25 },
      ],
      description: '知性器官と穿孔角の融合。相手の守りを読み切り、準備も速くなる。',
    },
  },
  {
    id: 'FUS010',
    name: '雷光眼',
    icon: '⚡',
    tagA: '雷',
    tagB: '高速',
    result: {
      id: 'FUS010',
      name: '雷光眼',
      icon: '⚡',
      type: '目',
      rarity: FUSION_RARITY,
      tags: ['雷', '高速'],
      effects: [
        { kind: 'accuracy_bonus_pct', pct: 12 },
        { kind: 'ct_mult_all_pct', pct: -8 },
      ],
      description: '雷を宿した複眼。見てから動くまでが速くなる。',
    },
  },
  // ワイルドカード。必ず最後に置く(先頭から順に照合し、最初に一致したルールを採用するため)。
  {
    id: 'FUS000',
    name: '融合塊',
    icon: '🧫',
    tagA: null,
    tagB: null,
    result: {
      id: 'FUS000',
      name: '融合塊',
      icon: '🧫',
      type: '器官',
      rarity: FUSION_RARITY,
      tags: ['器官'],
      effects: [
        { kind: 'max_hp_bonus', amount: 10 },
        { kind: 'power_bonus_all_pct', pct: 6 },
      ],
      description: '噛み合わせの悪い2部位を無理やり繋いだ塊。尖ってはいないが、無駄にはならない。',
    },
  },
];

export const FUSION_PARTS: PartDef[] = FUSION_RULES.map((r) => r.result);

export function getFusionPart(id: string): PartDef | undefined {
  return FUSION_PARTS.find((p) => p.id === id);
}

/**
 * 2つの素材部位から融合結果を決める純粋関数。
 * ルール表の先頭から順に「A/B両方のタグを(どちらの向きでも)満たすか」を見て、
 * 最初に一致したルールを返す。どれにも一致しなければ最後のワイルドカードが返る。
 */
export function resolveFusion(a: PartDef, b: PartDef): FusionRuleDef {
  for (const rule of FUSION_RULES) {
    if (rule.tagA === null || rule.tagB === null) continue; // ワイルドカードは最後に回す
    const forward = a.tags.includes(rule.tagA) && b.tags.includes(rule.tagB);
    const backward = b.tags.includes(rule.tagA) && a.tags.includes(rule.tagB);
    if (forward || backward) return rule;
  }
  const wildcard = FUSION_RULES.find((r) => r.tagA === null && r.tagB === null);
  if (!wildcard) throw new Error('fusion master is missing its wildcard rule');
  return wildcard;
}
