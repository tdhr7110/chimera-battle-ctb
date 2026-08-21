import type { CommandDef, PartDef, PartEffect, StatusApply, StatusKind, SynergyDef, SynergyRuleChange } from '../data/types';
import { SYNERGIES } from '../data/synergies';
import { COMMANDS } from '../data/commands';

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
  maxHpBonus: number;
  powerBonusLightPct: number;
  powerBonusHeavyPct: number;
  delayEffectBonusPct: number;
  counters: { chancePct: number; powerMult: number }[];
  // --- 段階4(部位80接続)で追加 ---
  powerBonusAllPct: number;
  onHitApplyStatuses: StatusApply[];
  defenseFlatBonus: number;
  defensePctPenalty: number;
  evasionBonusPct: number;
  accuracyBonusPct: number;
  executeBonuses: { hpPctThreshold: number; bonusMult: number }[];
  lifestealBonusPct: number;
  statusMagnitudeBonuses: { target: StatusKind; flatAmount: number; pctAmount: number }[];
  passiveRegenPerTurn: number;
  reflectOnHitPct: number;
  mpMovePowerBonusPct: number;
  firstMpMoveFree: boolean;
  ignoreDefensePct: number;
  onKillCtBonusPct: number;
  // --- 段階5(シナジー36接続)で追加 ---
  bonusHitsFlat: number;
  lowHpMpRegenPerTurn: { hpPctThreshold: number; amount: number }[];
  onKillMpGain: number;
  utilityCtBonusPct: number;
  utilityMpCostReductionPct: number;
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
    maxHpBonus: 0,
    powerBonusLightPct: 0,
    powerBonusHeavyPct: 0,
    delayEffectBonusPct: 0,
    counters: [],
    powerBonusAllPct: 0,
    onHitApplyStatuses: [],
    defenseFlatBonus: 0,
    defensePctPenalty: 0,
    evasionBonusPct: 0,
    accuracyBonusPct: 0,
    executeBonuses: [],
    lifestealBonusPct: 0,
    statusMagnitudeBonuses: [],
    passiveRegenPerTurn: 0,
    reflectOnHitPct: 0,
    mpMovePowerBonusPct: 0,
    firstMpMoveFree: false,
    ignoreDefensePct: 0,
    onKillCtBonusPct: 0,
    bonusHitsFlat: 0,
    lowHpMpRegenPerTurn: [],
    onKillMpGain: 0,
    utilityCtBonusPct: 0,
    utilityMpCostReductionPct: 0,
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
    case 'max_hp_bonus':
      mods.maxHpBonus += e.amount;
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
    case 'power_bonus_all_pct':
      mods.powerBonusAllPct += e.pct;
      break;
    case 'on_hit_apply_status':
      mods.onHitApplyStatuses.push(e.status);
      break;
    case 'defense_flat_bonus':
      mods.defenseFlatBonus += e.amount;
      break;
    case 'defense_pct_penalty':
      mods.defensePctPenalty += e.pct;
      break;
    case 'evasion_bonus_pct':
      mods.evasionBonusPct += e.pct;
      break;
    case 'accuracy_bonus_pct':
      mods.accuracyBonusPct += e.pct;
      break;
    case 'execute_bonus_passive':
      mods.executeBonuses.push({ hpPctThreshold: e.hpPctThreshold, bonusMult: e.bonusMult });
      break;
    case 'lifesteal_bonus_pct':
      mods.lifestealBonusPct += e.pct;
      break;
    case 'status_magnitude_bonus':
      mods.statusMagnitudeBonuses.push({ target: e.target, flatAmount: e.flatAmount ?? 0, pctAmount: e.pctAmount ?? 0 });
      break;
    case 'passive_regen_per_turn':
      mods.passiveRegenPerTurn += e.amount;
      break;
    case 'reflect_on_hit_pct':
      mods.reflectOnHitPct += e.pct;
      break;
    case 'mp_move_power_bonus_pct':
      mods.mpMovePowerBonusPct += e.pct;
      break;
    case 'first_mp_move_free':
      mods.firstMpMoveFree = true;
      break;
    case 'ignore_defense_pct':
      mods.ignoreDefensePct += e.pct;
      break;
    case 'on_kill_ct_bonus_pct':
      mods.onKillCtBonusPct += e.pct;
      break;
    case 'bonus_hits_flat':
      mods.bonusHitsFlat += e.amount;
      break;
    case 'low_hp_mp_regen_per_turn':
      mods.lowHpMpRegenPerTurn.push({ hpPctThreshold: e.hpPctThreshold, amount: e.amount });
      break;
    case 'on_kill_mp_gain':
      mods.onKillMpGain += e.amount;
      break;
    case 'utility_ct_bonus_pct':
      mods.utilityCtBonusPct += e.pct;
      break;
    case 'utility_mp_cost_reduction_pct':
      mods.utilityMpCostReductionPct += e.pct;
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
    for (const stage of reachedSynergyStages(syn, equippedParts)) {
      for (const e of stage.effects) applyEffect(mods, e);
    }
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

// ------------------------------------------------------------
// コマンド段階的解放: unlockAlwaysの基礎4コマンド以外は、対応するunlockTagを持つ部位を
// 1つでも装着するまで使用不可(バトル画面にも出さない)。UI(PrepScreenのコマンドタブ等)
// からも同じ判定を使えるようexportしている。
// ------------------------------------------------------------
export function isCommandUnlocked(cmd: CommandDef, equippedParts: PartDef[]): boolean {
  if (cmd.unlockAlways) return true;
  if (!cmd.unlockTag) return true;
  return equippedParts.some((p) => p.tags.includes(cmd.unlockTag!));
}

// 現在の装備で解放されているコマンドID一覧。CtbEngineが戦闘中の選択肢を絞るのに使う。
export function computeUnlockedCommandIds(equippedParts: PartDef[]): Set<string> {
  return new Set(COMMANDS.filter((c) => isCommandUnlocked(c, equippedParts)).map((c) => c.id));
}

// ------------------------------------------------------------
// Phase 2: 部位取得の前後で解放状態を比較し、「今回新しく解放されたコマンド」だけを返す。
// 解放ルールそのもの(computeUnlockedCommandIds)には一切手を加えず、その差分を取るだけの
// 純粋関数。報酬演出(CommandUnlockScreen)とNEWバッジの両方がこの1か所を共有する。
// ------------------------------------------------------------
export function newlyUnlockedCommands(beforeParts: PartDef[], afterParts: PartDef[]): CommandDef[] {
  const before = computeUnlockedCommandIds(beforeParts);
  const after = computeUnlockedCommandIds(afterParts);
  return COMMANDS.filter((c) => after.has(c.id) && !before.has(c.id));
}
