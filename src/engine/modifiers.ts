import type { PartDef, PartEffect, SynergyDef, SynergyRuleChange } from '../data/types';
import { SYNERGIES } from '../data/synergies';

// ============================================================
// 装備中の部位(+シナジー)から、CTBエンジンが参照する数値をまとめて計算する。
// engine/ctbEngine.ts からもUI(装備画面のプレビュー等)からも同じ計算結果を
// 参照できるよう、副作用のない純粋関数として独立させている(仕様書16章:
// 数値をコードへ直接散らさず、後から一括調整できるようにする)。
// ============================================================

export interface PlayerModifiers {
  speedFlatBonus: number;
  ctMultAllPct: number; // 負値で短縮
  ctMultLightPct: number;
  ctHeavyPenaltyReductionPct: number;
  lowHpCtBonuses: { hpPctThreshold: number; ctMultPct: number }[];
  postBattleMpRegenBonus: number; // MP改定: 戦闘中の回復は廃止したため、戦闘後回復量への加算のみ
  maxMpBonus: number;
  powerBonusLightPct: number;
  powerBonusHeavyPct: number;
  delayEffectBonusPct: number;
  counters: { chancePct: number; powerMult: number }[];
}

function emptyModifiers(): PlayerModifiers {
  return {
    speedFlatBonus: 0,
    ctMultAllPct: 0,
    ctMultLightPct: 0,
    ctHeavyPenaltyReductionPct: 0,
    lowHpCtBonuses: [],
    postBattleMpRegenBonus: 0,
    maxMpBonus: 0,
    powerBonusLightPct: 0,
    powerBonusHeavyPct: 0,
    delayEffectBonusPct: 0,
    counters: [],
  };
}

function applyEffect(mods: PlayerModifiers, e: PartEffect) {
  switch (e.kind) {
    case 'speed_flat':
      mods.speedFlatBonus += e.amount;
      break;
    case 'ct_mult_all_pct':
      mods.ctMultAllPct += e.pct;
      break;
    case 'ct_mult_light_pct':
      mods.ctMultLightPct += e.pct;
      break;
    case 'ct_heavy_penalty_reduction_pct':
      mods.ctHeavyPenaltyReductionPct += e.pct;
      break;
    case 'low_hp_ct_bonus':
      mods.lowHpCtBonuses.push({ hpPctThreshold: e.hpPctThreshold, ctMultPct: e.ctMultPct });
      break;
    case 'post_battle_mp_regen_bonus':
      mods.postBattleMpRegenBonus += e.amount;
      break;
    case 'max_mp_bonus':
      mods.maxMpBonus += e.amount;
      break;
    case 'power_bonus_light_pct':
      mods.powerBonusLightPct += e.pct;
      break;
    case 'power_bonus_heavy_pct':
      mods.powerBonusHeavyPct += e.pct;
      break;
    case 'delay_effect_bonus_pct':
      mods.delayEffectBonusPct += e.pct;
      break;
    case 'counter_on_hit':
      mods.counters.push({ chancePct: e.chancePct, powerMult: e.powerMult });
      break;
  }
}

// 装備部位からPlayerModifiersを合成する。part.effects → シナジー判定(達成した段階すべて) →
// 各段階のeffect積み上げ、の順で適用する。
export function computePlayerModifiers(equippedParts: PartDef[]): PlayerModifiers {
  const mods = emptyModifiers();
  for (const part of equippedParts) {
    for (const e of part.effects) applyEffect(mods, e);
  }
  for (const syn of SYNERGIES) {
    for (const stage of reachedSynergyStages(syn, equippedParts)) applyEffect(mods, stage.effect);
  }
  return mods;
}

// TSの制御フロー解析はsyn.countBy.kindでの分岐narrowingをコールバック(filterの引数)の
// 中まで保持できないため、countByをローカル変数へ切り出してから判定する。
// UI側(PrepScreenのシナジータブ等)からも同じロジックを使えるようexportしている。
export function synergyPartCount(syn: SynergyDef, equippedParts: PartDef[]): number {
  const countBy = syn.countBy;
  if (countBy.kind === 'type') return equippedParts.filter((p) => p.type === countBy.type).length;
  return equippedParts.filter((p) => p.tags.includes(countBy.tag)).length;
}

// 装備数が満たしている段階を、閾値の昇順ですべて返す(段階の効果は積み上げで適用されるため)。
export function reachedSynergyStages(syn: SynergyDef, equippedParts: PartDef[]) {
  const count = synergyPartCount(syn, equippedParts);
  return syn.stages.filter((stage) => count >= stage.threshold);
}

// 現在の装備で1段階でも発動しているシナジーの一覧(UI表示用)。
export function activeSynergies(equippedParts: PartDef[]) {
  return SYNERGIES.filter((syn) => reachedSynergyStages(syn, equippedParts).length > 0);
}

// 現在の装備で発動しているルール変化(即時再行動・致死回避等)の一覧。CtbEngineが参照する。
export function activeSynergyRuleChanges(equippedParts: PartDef[]): SynergyRuleChange[] {
  const out: SynergyRuleChange[] = [];
  for (const syn of SYNERGIES) {
    for (const stage of reachedSynergyStages(syn, equippedParts)) {
      if (stage.ruleChange) out.push(stage.ruleChange);
    }
  }
  return out;
}
