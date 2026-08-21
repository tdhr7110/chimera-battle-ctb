import { COMMANDS, getCommand } from '../data/commands';
import { activeSynergies, activeSynergyRuleChanges, computePlayerModifiers, type PlayerModifiers } from './modifiers';
import type { CommandDef, EnemyDef, EnemyIntent, EnemyMoveDef, EnemyPhase, EnemyTier, PartDef, Side, StatusApply, StatusKind } from '../data/types';
import {
  CT_DELAY_UNITS_CEILING,
  CT_WEIGHT_INTERVAL_MULT,
  CT_WEIGHT_LABEL,
  CT_WEIGHT_MULT_FLOOR,
  SHOCK_TRIGGER_DELAY_BASE,
  SHOCK_TRIGGER_STACKS,
  STATUS_LABEL,
  TIER_DELAY_RESISTANCE_PCT,
} from '../data/types';

// ============================================================
// キメラバトル CTB 再設計データ 第1弾 の戦闘エンジン。
//
// 「行動順(CT)」はATBゲージ方式で管理する: 各陣営に「次に行動できる時刻(nextAt)」を
// 持たせ、値が小さい側から行動する。行動すると、速度とコマンド/技のCT重量に応じて
// nextAtが加算される。
//
// 第1弾で追加した仕組み:
//   - MP: 代謝ゲージを廃止し、MPへ全面置換(通常攻撃・速撃・防御・待機・チャージはMP0)
//   - 部位・シナジー由来のPlayerModifiers(速度・CT倍率・MP回復・威力・遅延効果量・反撃)
//   - 状態異常を単一のburnフィールドから複数スタック可能なstatuses配列へ一般化
//     (burn/poison=継続ダメージ、vulnerable=被ダメ増加、haste/slow=CT倍率の一時補正)
//   - CT操作(遅延打撃・加速・待機)には仕様書12章の耐性/床・天井を必ずかける
//   - 反撃型敵(counter)・CT遅延型敵(delayTargetBy)・敵の意図表示(intent)
//
// 戦闘開始UXの段階演出(battle_start → order_reveal → enemy_first_announce →
// player_turn)は従来通り。engine自体はタイマーを持たない純粋な状態機械。
// ============================================================

export type CtbPhase = 'battle_start' | 'order_reveal' | 'enemy_first_announce' | 'player_turn' | 'ended';
export type CtbStatus = 'ongoing' | 'won' | 'lost';

export type CtbEvent =
  | { type: 'attack'; time: number; side: Side; targetSide: Side; commandName: string; icon: string; damage: number }
  | { type: 'evade'; time: number; side: Side; targetSide: Side; commandName: string; icon: string }
  | { type: 'guard'; time: number; side: Side }
  | { type: 'wait'; time: number; side: Side }
  | { type: 'charge'; time: number; side: Side }
  | { type: 'haste_self'; time: number; side: Side }
  | { type: 'delay_enemy'; time: number; side: Side; amount: number }
  | { type: 'counter'; time: number; side: Side; targetSide: Side; damage: number }
  | { type: 'status_apply'; time: number; side: Side; kind: StatusKind }
  | { type: 'status_tick'; time: number; side: Side; kind: 'burn' | 'poison' | 'bleed'; damage: number }
  | { type: 'status_heal'; time: number; side: Side; kind: 'regen'; amount: number }
  | { type: 'undying'; time: number; side: Side }
  | { type: 'extra_action'; time: number; side: Side }
  | { type: 'telegraph'; time: number; message: string }
  | { type: 'victory'; time: number }
  | { type: 'defeat'; time: number };

type EventWithoutTime<T> = T extends CtbEvent ? Omit<T, 'time'> : never;

const CTB_BASE_INTERVAL = 100;
const CTB_PREVIEW_STEPS = 8; // Excel CTB設定「行動順表示」に合わせる
const CTB_MAX_RESOLVE_STEPS = 60;

// MP改定: 「戦闘中は回復せず、勝利後にまとめて回復する」方式へ変更(Excel CTB設定を
// 同時に書き換え済み)。CtbEngineは戦闘中一切MPを増やさない。通常攻撃/速撃/防御/待機/
// チャージがMP0で使える設計はそのまま維持している。
export const CTB_MP_MAX_BASE = 100;
const CTB_MP_START_FLAT_DEFAULT = 30; // startingMp省略時(単発デモ利用時)のフォールバック。Excel初期MPに一致。
const UNDYING_DELAY_BASE = 90; // 不死/致死回避が発動した後にかかるCT遅延の基礎量
const OVERHEAL_SHIELD_CAP = 30; // シナジー「再生体」3段階目(overheal_shield): 盾の最大保持量

// 統合版(本編)がラン全体の最大HP等を参照できるようexportする(値そのものは変更しない)。
export const PLAYER_BASE = { name: 'キメラ', icon: '🧬', color: '#4ade80', maxHp: 130, defense: 3, power: 15, evasionPct: 5, speed: 100 };

function actionInterval(speed: number, weightMult: number): number {
  return CTB_BASE_INTERVAL * (100 / Math.max(20, speed)) * weightMult;
}

interface ActiveStatus {
  kind: StatusKind;
  magnitude: number;
  turnsLeft: number;
}

interface RuntimeActor {
  side: Side;
  name: string;
  icon: string;
  color: string;
  hp: number;
  maxHp: number;
  defense: number;
  power: number;
  evasionPct: number;
  speed: number;
  guardReductionPct: number; // 次の被弾1回だけ軽減する(消費型)
  statuses: ActiveStatus[];
  isDead: boolean;
}

interface PlayerRuntime extends RuntimeActor {
  mods: PlayerModifiers;
  maxMp: number;
  chargeBonusMult: number; // チャージで蓄積し、次の攻撃系コマンドで消費するダメージ倍率ボーナス
  damageImmuneOnce: boolean; // 完全防御: 次の1回の被ダメージを完全無効化(消費型)
  counterStance: { powerMult: number } | null; // カウンター姿勢・受け流し: 次の被弾時に反撃(消費型)
  reflectPct: number; // 棘返し: 次の被弾時、受けたダメージの一部を反射(消費型)
  pendingFollowUp: { powerMult: number } | null; // 追撃命令: 次の攻撃系コマンドの後に追撃(消費型)
  shieldHp: number; // シナジー「再生体」3段階目(overheal_shield): 回復超過分を貯める盾。被弾時にHPより先に減る
}

interface EnemyRuntime extends RuntimeActor {
  moves: EnemyMoveDef[];
  moveIndex: number;
  tier: EnemyTier;
  delayResistancePct: number;
  counter?: { chancePct: number; powerMult: number };
}

export interface CommandPreviewInfo {
  id: string;
  name: string;
  icon: string;
  kind: CommandDef['kind'];
  damageEstimate: number | null; // 防御・待機・チャージ等はnull
  mpCost: number;
  ctLabel: string;
  applyStatusLabel: string | null;
  affordable: boolean;
  usable: boolean;
  description: string;
}

export interface OrderSlot {
  side: Side;
  intent: EnemyIntent | null; // 敵スロットのみ: 仕様書11章の意図表示
  telegraph: string | null; // 大技等、専用の警告文が出る場合のみ
}

export interface ActiveStatusSnapshot {
  kind: StatusKind;
  magnitude: number;
  turnsLeft: number;
}

export interface CtbActorSnapshot {
  name: string;
  icon: string;
  color: string;
  hp: number;
  maxHp: number;
  statuses: ActiveStatusSnapshot[];
  guardActive: boolean;
  isDead: boolean;
}

export interface NextEnemyActionInfo {
  intent: EnemyIntent;
  moveName: string;
  icon: string;
}

export interface CtbSnapshot {
  phase: CtbPhase;
  status: CtbStatus;
  turnCount: number;
  player: CtbActorSnapshot & { chargeActive: boolean };
  enemy: CtbActorSnapshot;
  mp: { current: number; max: number };
  order: OrderSlot[];
  nextEnemyAction: NextEnemyActionInfo | null;
  commands: CommandPreviewInfo[];
  activeSynergyNames: string[];
  log: string[];
  autoMode: boolean;
  enemyFirstAnnounce: { moveName: string; icon: string; telegraph: string | null } | null;
}

let logSeq = 0;

export class CtbEngine {
  private phase: CtbPhase = 'battle_start';
  private status: CtbStatus = 'ongoing';
  private turnCount = 1;
  private player: PlayerRuntime;
  private enemy: EnemyRuntime;
  private nextAt: { player: number; enemy: number };
  private mp: number;
  private log: string[] = [];
  private events: CtbEvent[] = [];
  private seq = 0;
  private autoMode = false;
  private pendingEnemyAnnounce: { moveName: string; icon: string; telegraph: string | null } | null = null;
  private activeSynergyNames: string[];
  private playerReviveAvailable: boolean; // シナジー「多心臓」3段階目: 戦闘中1回だけ致死を耐える
  private playerExtraActionRules: { afterCtWeight: CommandDef['ctWeight']; chancePct: number }[];
  private enemyPhases: EnemyPhase[];
  private enemyPhaseIndex = -1; // -1 = 基本(フェーズ1)。フェーズ変化のたびに増える。
  private lastPlayerCommandId: string | null = null; // 模倣(mimicPreviousCommand)が参照する直前の自分のコマンド
  private lastMpSpent = 0; // 巻き戻し(refundLastMpSpentPct)が参照する直前のコマンドのMP消費量
  private killGrantedInstantAction = false; // 捕食連鎖等(killBonus.instantNextAction)がuseCommandへ伝える一時フラグ
  private firstMpMoveFreeUsed = false; // ゼロコスト核(first_mp_move_free): 1戦1回だけ消費する
  // --- シナジー36接続で追加。すべてactiveSynergyRuleChangesから初期化する一戦分の設定値 ---
  private playerReviveInstantAction = false; // シナジー「暴走生命」3段階目: revive_once_instant_actionが未消費か
  private followUpAfterAttackMult = 0; // シナジー「多腕」3段階目: 攻撃後に自動追撃する倍率(0=無効)
  private fullMpCtBonusPct = 0; // シナジー「多心臓」3段階目: MP満タン時のMP技CT短縮率
  private delayMpRefundAmount = 0; // シナジー「時間捕食」2段階目以降: 遅延成功時のMP回復量
  private compoundingDelayPctPerStack = 0; // シナジー「時間捕食」3段階目: 遅延を重ねるほど強化される割合
  private delayComboCount = 0; // ↑の実行中カウンタ
  private veryHeavyDelaysEnemyAmount = 0; // シナジー「重量怪物」3段階目: 超重量技の追加CT遅延量
  private poisonExplodeRule: { stackThreshold: number; bonusDamage: number } | null = null; // シナジー「毒性融合」3段階目
  private attackBurningCtBonusPct = 0; // シナジー「炎獄」3段階目
  private reflectNextFreeActive = false; // シナジー「反射生物」3段階目: reflect_on_hit_pct発動後に次コマンドMP0にするか
  private pendingFreeMpMove = false; // ↑が発動して次の1コマンドがMP0になる、消費型フラグ
  private guardMpGainAmount = 0; // シナジー「再生体」2段階目以降: 防御コマンドでMP回復
  private overhealShieldActive = false; // シナジー「再生体」3段階目
  private killInstantActionRule = false; // シナジー「捕食者」3段階目: 撃破のたび即行動できるか
  private repeatUtilityExtraHaste = 0; // シナジー「演算生命」3段階目

  // startingHp/startingMp: 統合版(本編)がラン中のHP・MPを戦闘間で持ち越すための追加パラメータ。
  // 省略時はフルHP・Excel初期MPで開始する単発デモ挙動のまま(既存の呼び出し元・挙動は変わらない)。
  constructor(enemyDef: EnemyDef, equippedParts: PartDef[] = [], startingHp?: number, startingMp?: number) {
    const mods = computePlayerModifiers(equippedParts);
    this.activeSynergyNames = activeSynergies(equippedParts).map((s) => s.name);
    const ruleChanges = activeSynergyRuleChanges(equippedParts);
    this.playerReviveAvailable = ruleChanges.some((r) => r.kind === 'revive_once');
    this.playerExtraActionRules = ruleChanges.flatMap((r) =>
      r.kind === 'extra_action_chance' ? [{ afterCtWeight: r.afterCtWeight, chancePct: r.chancePct }] : []
    );
    this.playerReviveInstantAction = ruleChanges.some((r) => r.kind === 'revive_once_instant_action');
    for (const r of ruleChanges) {
      if (r.kind === 'follow_up_after_attack') this.followUpAfterAttackMult = r.powerMult;
      else if (r.kind === 'full_mp_ct_bonus') this.fullMpCtBonusPct = r.ctMultPct;
      else if (r.kind === 'delay_mp_refund') this.delayMpRefundAmount += r.mpGain;
      else if (r.kind === 'compounding_delay') this.compoundingDelayPctPerStack = r.pctPerStack;
      else if (r.kind === 'very_heavy_delays_enemy') this.veryHeavyDelaysEnemyAmount = r.amount;
      else if (r.kind === 'poison_explode') this.poisonExplodeRule = { stackThreshold: r.stackThreshold, bonusDamage: r.bonusDamage };
      else if (r.kind === 'attack_burning_ct_bonus') this.attackBurningCtBonusPct = r.ctMultPct;
      else if (r.kind === 'reflect_next_free') this.reflectNextFreeActive = true;
      else if (r.kind === 'guard_mp_gain') this.guardMpGainAmount += r.amount;
      else if (r.kind === 'overheal_shield') this.overhealShieldActive = true;
      else if (r.kind === 'kill_instant_action') this.killInstantActionRule = true;
      else if (r.kind === 'repeat_utility_bonus') this.repeatUtilityExtraHaste = r.extraHaste;
    }
    const maxMp = CTB_MP_MAX_BASE + mods.maxMpBonus;
    const maxHp = PLAYER_BASE.maxHp + mods.maxHpBonus;

    this.player = {
      side: 'player',
      name: PLAYER_BASE.name,
      icon: PLAYER_BASE.icon,
      color: PLAYER_BASE.color,
      hp: startingHp !== undefined ? Math.max(1, Math.min(maxHp, Math.round(startingHp))) : maxHp,
      maxHp,
      defense: PLAYER_BASE.defense,
      power: PLAYER_BASE.power,
      evasionPct: PLAYER_BASE.evasionPct + mods.evasionBonusPct,
      speed: PLAYER_BASE.speed + mods.speedFlatBonus,
      guardReductionPct: 0,
      statuses: [],
      isDead: false,
      mods,
      maxMp,
      chargeBonusMult: 0,
      damageImmuneOnce: false,
      counterStance: null,
      reflectPct: 0,
      pendingFollowUp: null,
      shieldHp: 0,
    };
    this.mp =
      startingMp !== undefined ? Math.max(0, Math.min(maxMp, Math.round(startingMp))) : Math.min(maxMp, CTB_MP_START_FLAT_DEFAULT);

    this.enemy = {
      side: 'enemy',
      name: enemyDef.name,
      icon: enemyDef.icon,
      color: enemyDef.color,
      hp: enemyDef.hp,
      maxHp: enemyDef.hp,
      defense: enemyDef.defense,
      power: enemyDef.power,
      evasionPct: enemyDef.evasionPct,
      speed: enemyDef.baseSpeed,
      guardReductionPct: 0,
      statuses: [],
      isDead: false,
      moves: enemyDef.moves,
      moveIndex: 0,
      tier: enemyDef.tier,
      delayResistancePct: TIER_DELAY_RESISTANCE_PCT[enemyDef.tier],
      counter: enemyDef.counter,
    };
    this.enemyPhases = [...(enemyDef.phases ?? [])].sort((a, b) => b.hpPctThreshold - a.hpPctThreshold);

    // 仕様書4章: 開始直後は半区間だけ待たせてから最初の行動時刻を迎える(ATBの一般的な作法)。
    this.nextAt = {
      player: actionInterval(this.player.speed, 1) / 2,
      enemy: actionInterval(this.enemy.speed, 1) / 2,
    };
    this.pushLog(`⚔️ ${enemyDef.name}が現れた！`);
  }

  // ------------------------------------------------------------
  // ログ・イベント
  // ------------------------------------------------------------
  private pushLog(msg: string) {
    logSeq += 1;
    this.log.unshift(`#${logSeq} ${msg}`);
    if (this.log.length > 60) this.log.length = 60;
  }
  private pushEvent(e: EventWithoutTime<CtbEvent>) {
    this.events.push({ ...e, time: this.seq++ } as CtbEvent);
  }
  drainEvents(): CtbEvent[] {
    if (this.events.length === 0) return this.events;
    const out = this.events;
    this.events = [];
    return out;
  }

  // ------------------------------------------------------------
  // 仕様書4章: 戦闘開始の段階演出
  // ------------------------------------------------------------
  getPhase(): CtbPhase {
    return this.phase;
  }

  revealOrder() {
    if (this.phase !== 'battle_start') return;
    this.phase = 'order_reveal';
  }

  beginFirstTurn() {
    if (this.phase !== 'order_reveal') return;
    const side = this.firstActingSide();
    if (side === 'player') {
      this.tickStatusesAtTurnStart('player');
      if (this.checkEnd()) return;
      this.phase = 'player_turn';
      return;
    }
    const move = this.currentEnemyMove();
    this.pendingEnemyAnnounce = { moveName: move.name, icon: move.icon, telegraph: move.telegraph ?? null };
    this.phase = 'enemy_first_announce';
    if (move.telegraph) {
      this.pushLog(move.telegraph);
      this.pushEvent({ type: 'telegraph', message: move.telegraph });
    }
  }

  resolveAnnouncedEnemyTurn() {
    if (this.phase !== 'enemy_first_announce') return;
    this.pendingEnemyAnnounce = null;
    this.tickStatusesAtTurnStart('enemy');
    if (this.checkEnd()) return;
    this.resolveEnemyAttack();
    if (this.checkEnd()) return;
    this.resolveUntilPlayerOrEnd();
  }

  private firstActingSide(): Side {
    return this.nextAt.player <= this.nextAt.enemy ? 'player' : 'enemy';
  }

  private currentEnemyMove(offset = 0): EnemyMoveDef {
    return this.enemy.moves[(this.enemy.moveIndex + offset) % this.enemy.moves.length];
  }

  // ------------------------------------------------------------
  // 状態異常(仕様書9章 + 拡張分): burn/poison/regenは自分の行動順が来た瞬間に継続ダメージ/回復。
  // vulnerable/haste/slow/accuracy_downはダメージ・CT・命中の計算式側から参照するだけで、
  // ここでは残りターン数の消化だけを行う。bleed(被弾トリガー)/paralyze(単発消費)/
  // shock(閾値到達)/undying/mp_leak/silenceは、それぞれの発生ポイント(攻撃解決・行動解決・
  // コマンド使用時)で個別に処理する。
  // ------------------------------------------------------------
  private tickStatusesAtTurnStart(side: Side) {
    const actor = side === 'player' ? this.player : this.enemy;
    if (actor.isDead) return;
    // 再生胴系(passive_regen_per_turn): 状態異常ではなく部位由来の常時パッシブ回復。
    // シナジー「再生体」3段階目(overheal_shield)が有効な場合、HP上限を超える分はシールドになる。
    if (side === 'player' && this.player.mods.passiveRegenPerTurn > 0 && actor.hp > 0) {
      const heal = Math.round(this.player.mods.passiveRegenPerTurn);
      const overflow = this.overhealShieldActive ? Math.max(0, actor.hp + heal - actor.maxHp) : 0;
      actor.hp = Math.min(actor.maxHp, actor.hp + heal);
      this.pushLog(`💚 ${actor.name}は再生胴で${heal}回復`);
      this.pushEvent({ type: 'status_heal', side, kind: 'regen', amount: heal });
      if (overflow > 0) {
        this.player.shieldHp = Math.min(OVERHEAL_SHIELD_CAP, this.player.shieldHp + overflow);
        this.pushLog(`🛡️ 回復超過分がシールドになった(${this.player.shieldHp})`);
      }
    }
    // シナジー「暴走生命」2段階目以降(low_hp_mp_regen_per_turn): 低HP時、手番開始時にMPも回復。
    if (side === 'player' && actor.hp > 0) {
      const hpPct = actor.maxHp > 0 ? (actor.hp / actor.maxHp) * 100 : 100;
      for (const b of this.player.mods.lowHpMpRegenPerTurn) {
        if (hpPct <= b.hpPctThreshold && b.amount > 0) {
          this.mp = Math.min(this.player.maxMp, this.mp + b.amount);
          this.pushLog(`🔷 低HPでMPが${b.amount}回復`);
        }
      }
    }
    for (const s of actor.statuses) {
      if ((s.kind === 'burn' || s.kind === 'poison') && actor.hp > 0) {
        const dmg = Math.round(s.magnitude);
        actor.hp = Math.max(0, actor.hp - dmg);
        this.pushLog(`${s.kind === 'burn' ? '🔥' : '☠️'} ${actor.name}は${s.kind === 'burn' ? '炎上' : '毒'}で${dmg}ダメージ`);
        this.pushEvent({ type: 'status_tick', side, kind: s.kind, damage: dmg });
      } else if (s.kind === 'regen' && actor.hp > 0) {
        const heal = Math.round(s.magnitude);
        actor.hp = Math.min(actor.maxHp, actor.hp + heal);
        this.pushLog(`💚 ${actor.name}は再生で${heal}回復`);
        this.pushEvent({ type: 'status_heal', side, kind: 'regen', amount: heal });
      }
    }
    // paralyzeは「次の1行動」で消費されるまで残り続ける単発型のため、ターン経過による
    // 自動減衰の対象から除外する(consumeParalyzeExtraMultが実際の行動解決時に明示的に消費する)。
    actor.statuses = actor.statuses
      .map((s) => (s.kind === 'paralyze' ? s : { ...s, turnsLeft: s.turnsLeft - 1 }))
      .filter((s) => s.kind === 'paralyze' || s.turnsLeft > 0);
    if (actor.hp <= 0 && !this.preventLethalIfPossible(actor)) actor.isDead = true;
  }

  private applyStatus(target: RuntimeActor, apply: StatusApply | undefined) {
    if (!apply) return;
    const existing = target.statuses.find((s) => s.kind === apply.kind);
    if (existing) {
      existing.magnitude += apply.magnitude;
      existing.turnsLeft = Math.max(existing.turnsLeft, apply.turns);
    } else {
      target.statuses.push({ kind: apply.kind, magnitude: apply.magnitude, turnsLeft: apply.turns });
    }
    this.pushLog(`${STATUS_LABEL[apply.kind].icon} ${target.name}に${STATUS_LABEL[apply.kind].name}状態が付与された`);
    this.pushEvent({ type: 'status_apply', side: target.side, kind: apply.kind });
    if (apply.kind === 'shock') this.checkShockTrigger(target);
    if (apply.kind === 'poison' && target.side === 'enemy') this.checkPoisonExplode(target);
  }

  // シナジー「毒性融合」3段階目(poison_explode): 敵の毒スタックが一定値へ達するたび自動で爆発し、追加ダメージ。
  private checkPoisonExplode(target: RuntimeActor) {
    if (!this.poisonExplodeRule) return;
    const mag = this.statusMagnitude(target, 'poison');
    if (mag < this.poisonExplodeRule.stackThreshold || target.hp <= 0) return;
    target.statuses = target.statuses.filter((s) => s.kind !== 'poison');
    const dmg = this.poisonExplodeRule.bonusDamage;
    target.hp = Math.max(0, target.hp - dmg);
    this.pushLog(`☠️💥 ${target.name}の毒が爆発し${dmg}ダメージ！`);
    this.pushEvent({ type: 'status_tick', side: target.side, kind: 'poison', damage: dmg });
    if (target.hp <= 0 && !this.preventLethalIfPossible(target)) target.isDead = true;
    else this.checkEnemyPhaseTransition();
  }

  // 毒腺口/毒嚢系(status_magnitude_bonus): プレイヤーが敵へ付与する状態異常のうち、
  // 部位で強化対象に指定された種類だけmagnitudeを底上げしてから適用する。
  private boostOutgoingStatus(apply: StatusApply | undefined): StatusApply | undefined {
    if (!apply) return apply;
    const bonuses = this.player.mods.statusMagnitudeBonuses.filter((b) => b.target === apply.kind);
    if (bonuses.length === 0) return apply;
    let magnitude = apply.magnitude;
    for (const b of bonuses) magnitude += b.flatAmount;
    for (const b of bonuses) magnitude *= 1 + b.pctAmount / 100;
    return { ...apply, magnitude };
  }

  private statusMagnitude(actor: RuntimeActor, kind: StatusKind): number {
    return actor.statuses.filter((s) => s.kind === kind).reduce((sum, s) => sum + s.magnitude, 0);
  }

  // 感電(新フック): スタックがSHOCK_TRIGGER_STACKSに達すると自動でCT遅延が発動しリセットされる。
  private checkShockTrigger(target: RuntimeActor) {
    if (this.statusMagnitude(target, 'shock') < SHOCK_TRIGGER_STACKS) return;
    target.statuses = target.statuses.filter((s) => s.kind !== 'shock');
    this.pushLog(`⚡ ${target.name}に感電が蓄積し、大きな隙が生まれた！`);
    if (target.side === 'player') this.applyDelayToPlayer(SHOCK_TRIGGER_DELAY_BASE);
    else this.applyDelayToEnemy(SHOCK_TRIGGER_DELAY_BASE);
  }

  // 出血(新フック): ターン開始時ではなく、被弾するたびに追加ダメージが発生する。
  private triggerBleedOnHit(target: RuntimeActor) {
    const mag = this.statusMagnitude(target, 'bleed');
    if (mag <= 0 || target.hp <= 0) return;
    const dmg = Math.round(mag);
    target.hp = Math.max(0, target.hp - dmg);
    this.pushLog(`🩸 ${target.name}は出血で${dmg}ダメージ`);
    this.pushEvent({ type: 'status_tick', side: target.side, kind: 'bleed', damage: dmg });
    if (target.hp <= 0 && !this.preventLethalIfPossible(target)) target.isDead = true;
    else if (target.side === 'enemy') this.checkEnemyPhaseTransition();
  }

  // 麻痺(新フック): 継続ターンではなく「次の1行動だけ」CTを重くする単発型。
  // 実際の行動解決時に一度だけ呼び、消費(状態を除去)しながら倍率を返す。previewでは呼ばない。
  private consumeParalyzeExtraMult(actor: RuntimeActor): number {
    const mag = this.statusMagnitude(actor, 'paralyze');
    if (mag <= 0) return 1;
    actor.statuses = actor.statuses.filter((s) => s.kind !== 'paralyze');
    this.pushLog(`💫 ${actor.name}は麻痺で行動が遅れた`);
    return 1 + mag / 100;
  }

  // 不死/致死回避(新フック): undying状態、シナジー「多心臓」3段階目の revive_once、
  // またはシナジー「暴走生命」3段階目の revive_once_instant_action を消費して、
  // 致死ダメージをHP1で耐える。いずれも無ければfalseを返し、通常の死亡処理へ進む。
  private preventLethalIfPossible(actor: RuntimeActor): boolean {
    const undyingActive = this.statusMagnitude(actor, 'undying') > 0;
    let grantsInstantAction = false;
    if (undyingActive) {
      actor.statuses = actor.statuses.filter((s) => s.kind !== 'undying');
    } else if (actor.side === 'player' && this.playerReviveAvailable) {
      this.playerReviveAvailable = false;
    } else if (actor.side === 'player' && this.playerReviveInstantAction) {
      this.playerReviveInstantAction = false;
      grantsInstantAction = true;
    } else {
      return false;
    }
    actor.hp = 1;
    actor.isDead = false;
    if (grantsInstantAction) {
      this.killGrantedInstantAction = true;
    } else if (actor.side === 'player') {
      this.nextAt.player += UNDYING_DELAY_BASE;
    } else {
      this.nextAt.enemy += UNDYING_DELAY_BASE;
    }
    this.pushLog(`🌟 ${actor.name}は致死ダメージを耐えた！`);
    this.pushEvent({ type: 'undying', side: actor.side });
    return true;
  }

  // ------------------------------------------------------------
  // CT倍率計算(仕様書6・12章): 部位由来の補正・HP割合依存の補正・haste/slow状態を
  // すべて重ねたうえで、最後に必ず床(CT_WEIGHT_MULT_FLOOR)でクランプする。
  // ------------------------------------------------------------
  private effectiveWeightMult(actor: RuntimeActor, ctWeight: keyof typeof CT_WEIGHT_INTERVAL_MULT, mods?: PlayerModifiers): number {
    let mult = CT_WEIGHT_INTERVAL_MULT[ctWeight];
    if (mods) {
      mult *= 1 + mods.ctMultAllPct / 100;
      if (ctWeight === 'light' || ctWeight === 'very_light') mult *= 1 + mods.ctMultLightPct / 100;
      if (ctWeight === 'heavy' || ctWeight === 'very_heavy') {
        const penalty = mult - 1;
        mult = 1 + penalty * (1 - mods.ctHeavyPenaltyReductionPct / 100);
      }
      const hpPct = actor.maxHp > 0 ? (actor.hp / actor.maxHp) * 100 : 100;
      for (const b of mods.lowHpCtBonuses) {
        if (hpPct <= b.hpPctThreshold) mult *= 1 + b.ctMultPct / 100;
      }
    }
    // frenzy(狂化)のCT短縮成分・frozen(凍結)のCT増加成分は、既存のhaste/slowと
    // 同じ計算式へ合算する(独立した状態異常だが、CTへの影響は同じ仕組みでよいため)。
    const hastePct = this.statusMagnitude(actor, 'haste') + this.statusMagnitude(actor, 'frenzy');
    const slowPct = this.statusMagnitude(actor, 'slow') + this.statusMagnitude(actor, 'frozen') + this.statusMagnitude(actor, 'fear');
    mult *= 1 - hastePct / 100;
    mult *= 1 + slowPct / 100;
    return Math.max(CT_WEIGHT_MULT_FLOOR, mult);
  }

  private attackPowerCategoryBonusPct(ctWeight: keyof typeof CT_WEIGHT_INTERVAL_MULT, mods: PlayerModifiers): number {
    if (ctWeight === 'very_light' || ctWeight === 'light') return mods.powerBonusLightPct;
    if (ctWeight === 'heavy' || ctWeight === 'very_heavy') return mods.powerBonusHeavyPct;
    return 0;
  }

  private computeDamage(rawPower: number, defenderDefense: number, defenderGuardPct: number, defenderVulnerablePct: number): number {
    let d = rawPower - defenderDefense;
    d *= 1 - defenderGuardPct / 100;
    d *= 1 + defenderVulnerablePct / 100;
    return Math.max(1, Math.round(d));
  }

  // 腐食(defense_down)・狂化(frenzy)の防御DOWN成分、および(プレイヤーのみ)部位由来の
  // 防御UP/DOWNを反映した実効防御力。
  private effectiveDefense(actor: RuntimeActor): number {
    let base = actor.defense;
    let downPct = this.statusMagnitude(actor, 'defense_down') + this.statusMagnitude(actor, 'frenzy');
    if (actor.side === 'player') {
      base += this.player.mods.defenseFlatBonus;
      downPct += this.player.mods.defensePctPenalty;
    }
    return Math.max(0, base * (1 - downPct / 100));
  }

  private randomInt(min: number, max: number): number {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  // プレイヤーが被弾する際の単発防御効果(完全防御・カウンター姿勢・棘返し)を消費しながら、
  // 最終的な被ダメージ量を返す。呼び出し側は戻り値をそのままhp減算に使う。
  private applyPlayerDefensiveHooks(rawDmg: number): number {
    if (this.player.damageImmuneOnce) {
      this.player.damageImmuneOnce = false;
      this.pushLog('🛡️ 完全防御でダメージを無効化した！');
      return 0;
    }
    if (this.player.counterStance) {
      const stance = this.player.counterStance;
      this.player.counterStance = null;
      const counterDmg = this.computeDamage(this.player.power * stance.powerMult, this.effectiveDefense(this.enemy), 0, 0);
      this.enemy.hp = Math.max(0, this.enemy.hp - counterDmg);
      this.pushLog(`🔁 ${this.player.name}の反撃！${counterDmg}ダメージ`);
      this.pushEvent({ type: 'counter', side: 'player', targetSide: 'enemy', damage: counterDmg });
      if (this.enemy.hp <= 0 && !this.preventLethalIfPossible(this.enemy)) this.enemy.isDead = true;
    }
    if (this.player.reflectPct > 0 && !this.enemy.isDead) {
      const reflectPct = this.player.reflectPct;
      this.player.reflectPct = 0;
      const reflectDmg = Math.round((rawDmg * reflectPct) / 100);
      if (reflectDmg > 0) {
        this.enemy.hp = Math.max(0, this.enemy.hp - reflectDmg);
        this.pushLog(`🦔 ${reflectDmg}ダメージを反射した`);
        this.pushEvent({ type: 'counter', side: 'player', targetSide: 'enemy', damage: reflectDmg });
        if (this.enemy.hp <= 0 && !this.preventLethalIfPossible(this.enemy)) this.enemy.isDead = true;
      }
    }
    // 棘甲系(reflect_on_hit_pct): 消費型のreflectPctと違い、被弾するたび常時発動する。
    if (this.player.mods.reflectOnHitPct > 0 && !this.enemy.isDead) {
      const passiveReflectDmg = Math.round((rawDmg * this.player.mods.reflectOnHitPct) / 100);
      if (passiveReflectDmg > 0) {
        this.enemy.hp = Math.max(0, this.enemy.hp - passiveReflectDmg);
        this.pushLog(`🦔 棘甲で${passiveReflectDmg}ダメージを反射した`);
        this.pushEvent({ type: 'counter', side: 'player', targetSide: 'enemy', damage: passiveReflectDmg });
        if (this.enemy.hp <= 0 && !this.preventLethalIfPossible(this.enemy)) this.enemy.isDead = true;
        // シナジー「反射生物」3段階目(reflect_next_free): この常時反射が発動した直後、
        // プレイヤーの次のコマンドのMPコストを0にする。
        if (this.reflectNextFreeActive) this.pendingFreeMpMove = true;
      }
    }
    return rawDmg;
  }

  // シナジー「再生体」3段階目(overheal_shield): 回復超過分で貯めたシールドが、HPより先に被ダメージを肩代わりする。
  private absorbWithShield(dmg: number): number {
    if (this.player.shieldHp <= 0 || dmg <= 0) return dmg;
    const absorbed = Math.min(this.player.shieldHp, dmg);
    this.player.shieldHp -= absorbed;
    if (absorbed > 0) this.pushLog(`🛡️ シールドが${absorbed}ダメージを肩代わりした`);
    return dmg - absorbed;
  }

  // 仕様書12章: 遅延打撃(プレイヤー→敵)の実際の加算量。時間傷(複利)→効果量ボーナス→
  // シナジー「時間捕食」3段階目の連続遅延強化(compounding_delay)→天井→耐性の順に適用する。
  private applyDelayToEnemy(baseAmount: number) {
    const wounded = baseAmount * (1 + this.statusMagnitude(this.enemy, 'time_wound') / 100);
    const boosted = wounded * (1 + this.player.mods.delayEffectBonusPct / 100);
    const combo = boosted * (1 + (this.delayComboCount * this.compoundingDelayPctPerStack) / 100);
    const capped = Math.min(CT_DELAY_UNITS_CEILING, combo);
    const resisted = capped * (1 - this.enemy.delayResistancePct / 100);
    this.nextAt.enemy += resisted;
    this.pushLog(`⏳ ${this.enemy.name}の行動が遅れた`);
    this.pushEvent({ type: 'delay_enemy', side: 'player', amount: Math.round(resisted) });
    if (this.compoundingDelayPctPerStack > 0) this.delayComboCount += 1;
    // シナジー「時間捕食」2段階目以降(delay_mp_refund): 遅延が成功するたびMPを回復する。
    if (this.delayMpRefundAmount > 0) {
      this.mp = Math.min(this.player.maxMp, this.mp + this.delayMpRefundAmount);
      this.pushLog(`🔷 遅延成功でMPが${this.delayMpRefundAmount}回復`);
    }
  }

  // CT遅延型敵(→プレイヤー)。プレイヤー側には部位耐性の概念がないため時間傷の複利と天井のみ適用する。
  private applyDelayToPlayer(baseAmount: number) {
    const wounded = baseAmount * (1 + this.statusMagnitude(this.player, 'time_wound') / 100);
    const capped = Math.min(CT_DELAY_UNITS_CEILING, wounded);
    this.nextAt.player += capped;
    this.pushLog(`⏳ キメラの行動が遅れた`);
    this.pushEvent({ type: 'delay_enemy', side: 'enemy', amount: Math.round(capped) });
  }

  // 仕様書12章: 加速・待機による自分のnextAt前倒し。敵の現在位置よりCT_DELAY_UNITS_CEILING以上
  // 先には進めない(無限に待機/加速を連打して無限行動を得る戦法を防ぐ床)。
  private applyHasteToSelf(amount: number) {
    const floor = this.nextAt.enemy - CT_DELAY_UNITS_CEILING;
    this.nextAt.player = Math.max(floor, this.nextAt.player - amount);
  }

  // ------------------------------------------------------------
  // 行動解決
  // ------------------------------------------------------------
  private resolveEnemyAttack() {
    const move = this.currentEnemyMove();
    this.enemy.moveIndex += 1;

    if (move.telegraph) {
      this.pushLog(move.telegraph);
      this.pushEvent({ type: 'telegraph', message: move.telegraph });
    }

    // 再生系(selfHeal)・暴走/雷/氷系(selfApplyStatus): どちらも自分自身への効果なので、
    // プレイヤーの回避判定とは無関係に発動する。
    if (move.selfHeal && this.enemy.hp > 0) {
      const heal = Math.round(this.enemy.maxHp * (move.selfHeal.pct / 100));
      this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + heal);
      this.pushLog(`💚 ${this.enemy.name}は${move.name}で${heal}回復した`);
      this.pushEvent({ type: 'status_heal', side: 'enemy', kind: 'regen', amount: heal });
    }
    if (move.selfApplyStatus) this.applyStatus(this.enemy, move.selfApplyStatus);

    const selfAccuracyDown = this.statusMagnitude(this.enemy, 'accuracy_down');
    if (Math.random() * 100 < this.player.evasionPct + selfAccuracyDown) {
      this.pushLog(`💨 キメラは${this.enemy.name}の${move.name}を回避した`);
      this.pushEvent({ type: 'evade', side: 'enemy', targetSide: 'player', commandName: move.name, icon: move.icon });
    } else {
      let power = this.enemy.power * move.powerMult * (1 - this.statusMagnitude(this.enemy, 'fear') / 100);
      // 処刑系(executeBonus): プレイヤーのHP割合が閾値以下なら威力UP。
      if (move.executeBonus) {
        const playerHpPct = this.player.maxHp > 0 ? (this.player.hp / this.player.maxHp) * 100 : 100;
        if (playerHpPct <= move.executeBonus.hpPctThreshold) power *= move.executeBonus.bonusMult;
      }
      const vulnerablePct = this.statusMagnitude(this.player, 'vulnerable');
      // 多段系(hits): 命中回数分ダメージを分割し、命中のたびapplyStatusを積み重ねる。
      const hitCount = move.hits ?? 1;
      const perHitPower = power / hitCount;
      let totalDmg = 0;
      for (let h = 0; h < hitCount && !this.player.isDead; h++) {
        const rawDmg = this.computeDamage(perHitPower, this.effectiveDefense(this.player), this.player.guardReductionPct, vulnerablePct);
        this.player.guardReductionPct = 0;
        const dmg = this.absorbWithShield(this.applyPlayerDefensiveHooks(rawDmg));
        this.player.hp = Math.max(0, this.player.hp - dmg);
        totalDmg += dmg;
        this.pushLog(`${this.enemy.icon}${this.enemy.name}の${move.name}が${dmg}ダメージ${hitCount > 1 ? `(${h + 1}/${hitCount})` : ''}`);
        this.pushEvent({ type: 'attack', side: 'enemy', targetSide: 'player', commandName: move.name, icon: move.icon, damage: dmg });
        if (this.player.hp <= 0 && !this.preventLethalIfPossible(this.player)) this.player.isDead = true;
        if (!this.player.isDead) this.applyStatus(this.player, move.applyStatus);
      }
      if (move.delayTargetBy && !this.player.isDead) this.applyDelayToPlayer(move.delayTargetBy);
      if (!this.player.isDead && totalDmg > 0) this.triggerBleedOnHit(this.player);
    }
    const weightMult = this.effectiveWeightMult(this.enemy, move.ctWeight) * this.consumeParalyzeExtraMult(this.enemy);
    this.nextAt.enemy += actionInterval(this.enemy.speed, weightMult);
  }

  // コマンド60種接続(段階2): kindによる大分岐(防御/待機/チャージ)はそのまま維持しつつ、
  // 自己対象の副作用(防御軽減・単発防御効果・CT前倒し・自己状態異常・MP関連)はkindに
  // よらずフィールドの有無で先に処理する。攻撃系コマンドは以降で多段ヒット・防御無視・
  // 吸血・処刑・状態異常消費・追撃・撃破ボーナスなどをオプションとして順に適用する。
  private resolvePlayerCommand(cmd: CommandDef) {
    if (cmd.guardReductionPct) this.player.guardReductionPct = cmd.guardReductionPct;
    if (cmd.damageImmuneOnce) this.player.damageImmuneOnce = true;
    if (cmd.counterStance) this.player.counterStance = cmd.counterStance;
    if (cmd.reflectPct) this.player.reflectPct = cmd.reflectPct;
    if (cmd.hasteSelfBy) this.applyHasteToSelf(cmd.hasteSelfBy);
    if (cmd.applySelfStatus) this.applyStatus(this.player, cmd.applySelfStatus);
    if (cmd.mpFullRestore) {
      this.mp = Math.min(this.player.maxMp, this.mp + cmd.mpFullRestore);
      this.pushLog(`🔷 ${cmd.name}でMPが回復した`);
    }
    if (cmd.hpCostForMp) {
      this.player.hp = Math.max(0, this.player.hp - cmd.hpCostForMp.hpCost);
      this.mp = Math.min(this.player.maxMp, this.mp + cmd.hpCostForMp.mpGain);
      if (this.player.hp <= 0 && !this.preventLethalIfPossible(this.player)) this.player.isDead = true;
    }
    if (cmd.refundLastMpSpentPct && this.lastMpSpent > 0) {
      const refund = Math.round((this.lastMpSpent * cmd.refundLastMpSpentPct) / 100);
      if (refund > 0) {
        this.mp = Math.min(this.player.maxMp, this.mp + refund);
        this.pushLog(`⏪ ${cmd.name}でMPを${refund}回復`);
      }
    }
    if (cmd.followUpNextAttack) this.player.pendingFollowUp = cmd.followUpNextAttack;

    // 模倣: 直前の自分のコマンドをこのコマンドのMPで再現する(参照先自身が模倣の場合は不発)。
    if (cmd.mimicPreviousCommand) {
      const target = this.lastPlayerCommandId ? getCommand(this.lastPlayerCommandId) : undefined;
      if (target && !target.mimicPreviousCommand) {
        this.pushLog(`🌀 模倣！「${target.name}」を再現する`);
        this.resolvePlayerCommand(target);
      } else {
        this.pushLog('🌀 模倣したが、再現できる直前の行動がなかった');
      }
      return;
    }

    if (this.player.isDead) return; // HP消費コスト(hpCostForMp等)でここまでに力尽きた場合

    if (cmd.kind === 'charge') {
      this.player.chargeBonusMult += cmd.chargeNextAttackMultBonus ?? 0;
      this.pushLog(`🔋 ${cmd.name}！次の攻撃が強化される`);
      this.pushEvent({ type: 'charge', side: 'player' });
      return;
    }

    if (cmd.powerMult <= 0) {
      // ダメージを与えない自己対象コマンド(防御・待機・各種補助)。自己対象の副作用は既に
      // 上で処理済み。妨害系(咆哮の敵CT遅延、腐食液/盲目粉/麻痺針の敵状態異常)は攻撃判定
      // (回避ロール)を経ないコマンドのため、ここで確定して適用する。
      if (cmd.delayEnemyBy && !this.enemy.isDead) this.applyDelayToEnemy(cmd.delayEnemyBy);
      if (cmd.applyStatus && !this.enemy.isDead) this.applyStatus(this.enemy, this.boostOutgoingStatus(cmd.applyStatus));
      // シナジー「再生体」2段階目以降(guard_mp_gain): 防御コマンドを使うとMPも回復する。
      if (cmd.kind === 'guard' && this.guardMpGainAmount > 0) {
        this.mp = Math.min(this.player.maxMp, this.mp + this.guardMpGainAmount);
        this.pushLog(`🔷 防御でMPが${this.guardMpGainAmount}回復`);
      }
      // シナジー「演算生命」3段階目(repeat_utility_bonus): 直前と同じ補助コマンドを連続使用するとさらにCTが早まる。
      if (this.repeatUtilityExtraHaste > 0 && cmd.id === this.lastPlayerCommandId) {
        this.applyHasteToSelf(this.repeatUtilityExtraHaste);
        this.pushLog('🧠 連続使用で行動がさらに早まった');
      }
      this.pushLog(`${cmd.icon} ${cmd.name}！`);
      this.pushEvent(
        cmd.kind === 'guard' ? { type: 'guard', side: 'player' } : cmd.hasteSelfBy ? { type: 'haste_self', side: 'player' } : { type: 'wait', side: 'player' }
      );
      return;
    }

    // ---- attack系 ----
    const selfAccuracyDown = this.statusMagnitude(this.player, 'accuracy_down');
    const enemyEffectiveEvasion = Math.max(0, this.enemy.evasionPct - this.player.mods.accuracyBonusPct);
    if (Math.random() * 100 < enemyEffectiveEvasion + selfAccuracyDown) {
      this.pushLog(`💨 ${this.enemy.name}が回避した`);
      this.pushEvent({ type: 'evade', side: 'player', targetSide: 'enemy', commandName: cmd.name, icon: cmd.icon });
      return;
    }

    let power = this.player.power * cmd.powerMult;
    power *= 1 + this.attackPowerCategoryBonusPct(cmd.ctWeight, this.player.mods) / 100;
    power *= 1 + this.statusMagnitude(this.player, 'frenzy') / 100;
    power *= 1 - this.statusMagnitude(this.player, 'fear') / 100;
    power *= 1 + this.player.mods.powerBonusAllPct / 100;
    if (cmd.mpCost > 0) power *= 1 + this.player.mods.mpMovePowerBonusPct / 100;
    if (this.player.chargeBonusMult > 0) {
      power *= 1 + this.player.chargeBonusMult;
      this.player.chargeBonusMult = 0;
    }
    if (cmd.executeBonus) {
      const enemyHpPct = this.enemy.maxHp > 0 ? (this.enemy.hp / this.enemy.maxHp) * 100 : 100;
      if (enemyHpPct <= cmd.executeBonus.hpPctThreshold) power *= cmd.executeBonus.bonusMult;
    }
    for (const passiveExecute of this.player.mods.executeBonuses) {
      const enemyHpPct = this.enemy.maxHp > 0 ? (this.enemy.hp / this.enemy.maxHp) * 100 : 100;
      if (enemyHpPct <= passiveExecute.hpPctThreshold) power *= passiveExecute.bonusMult;
    }
    if (cmd.statusPresentBonusMult && this.statusMagnitude(this.enemy, cmd.statusPresentBonusMult.kind) > 0) {
      power *= cmd.statusPresentBonusMult.mult;
    }
    if (cmd.missingHpPowerBonusPctPerMissing) {
      const missingPct = this.player.maxHp > 0 ? 100 - (this.player.hp / this.player.maxHp) * 100 : 0;
      power *= 1 + (missingPct * cmd.missingHpPowerBonusPctPerMissing) / 100;
    }
    if (cmd.hpCostPct) {
      const cost = Math.round(this.player.maxHp * (cmd.hpCostPct / 100));
      this.player.hp = Math.max(0, this.player.hp - cost);
      power *= cmd.hpCostPowerBonusMult ?? 1;
      this.pushLog(`💢 ${cmd.name}のためHPを${cost}消費`);
      if (this.player.hp <= 0 && !this.preventLethalIfPossible(this.player)) this.player.isDead = true;
    }
    if (cmd.consumeAllMpForPower) {
      if (this.mp > 0) {
        power *= 1 + this.mp * cmd.consumeAllMpForPower.powerMultPerMp;
        this.pushLog(`🔷 残りMP${this.mp}を威力へ変換`);
        this.mp = 0;
      }
    }
    if (this.player.isDead) return; // HP消費コストで力尽きた場合はここで終了

    const enemyDefense = cmd.ignoreDefense ? 0 : this.effectiveDefense(this.enemy) * (1 - this.player.mods.ignoreDefensePct / 100);
    const enemyWasBurningBeforeHit = this.statusMagnitude(this.enemy, 'burn') > 0;
    // シナジー「多腕」2段階目以降(bonus_hits_flat): hits指定の多段コマンドの命中回数を底上げする。
    const baseHitCount = cmd.randomHitsRange ? this.randomInt(cmd.randomHitsRange[0], cmd.randomHitsRange[1]) : (cmd.hits ?? 1);
    const hitCount = cmd.hits || cmd.randomHitsRange ? baseHitCount + this.player.mods.bonusHitsFlat : baseHitCount;
    const perHitPower = power / hitCount;
    let totalDmg = 0;
    for (let h = 0; h < hitCount && !this.enemy.isDead; h++) {
      const dmg = this.computeDamage(perHitPower, enemyDefense, 0, 0);
      this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
      totalDmg += dmg;
      this.pushLog(`${cmd.icon}${cmd.name}が${this.enemy.name}に${dmg}ダメージ${hitCount > 1 ? `(${h + 1}/${hitCount})` : ''}`);
      this.pushEvent({ type: 'attack', side: 'player', targetSide: 'enemy', commandName: cmd.name, icon: cmd.icon, damage: dmg });
      if (this.enemy.hp <= 0 && !this.preventLethalIfPossible(this.enemy)) this.enemy.isDead = true;
      if (cmd.vulnerableStackPerHit && !this.enemy.isDead) this.applyStatus(this.enemy, cmd.vulnerableStackPerHit);
      if (!this.enemy.isDead) {
        for (const onHit of this.player.mods.onHitApplyStatuses) this.applyStatus(this.enemy, this.boostOutgoingStatus(onHit));
      }
    }

    if (cmd.statusConsumeNuke && !this.enemy.isDead) {
      const nuke = cmd.statusConsumeNuke;
      const mag = this.statusMagnitude(this.enemy, nuke.kind);
      if (mag > 0) {
        const bonus = Math.round(mag * nuke.damagePerMagnitude);
        this.enemy.statuses = this.enemy.statuses.filter((s) => s.kind !== nuke.kind);
        this.enemy.hp = Math.max(0, this.enemy.hp - bonus);
        totalDmg += bonus;
        this.pushLog(`${STATUS_LABEL[nuke.kind].icon} ${cmd.name}が${STATUS_LABEL[nuke.kind].name}を吸収し追加${bonus}ダメージ`);
        this.pushEvent({ type: 'attack', side: 'player', targetSide: 'enemy', commandName: `${cmd.name}(消費)`, icon: cmd.icon, damage: bonus });
        if (this.enemy.hp <= 0 && !this.preventLethalIfPossible(this.enemy)) this.enemy.isDead = true;
      }
    }
    if (cmd.statusConsumeSelfHaste) {
      const mag = this.statusMagnitude(this.enemy, cmd.statusConsumeSelfHaste.kind);
      if (mag > 0) this.applyHasteToSelf(mag * cmd.statusConsumeSelfHaste.hasteUnitsPerMagnitude);
    }
    if (cmd.lifestealPct && totalDmg > 0) {
      const lifestealPct = cmd.lifestealPct * (1 + this.player.mods.lifestealBonusPct / 100);
      const healed = Math.round((totalDmg * lifestealPct) / 100);
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + healed);
      this.pushLog(`🩸 ${cmd.name}の吸収で${healed}回復`);
    }

    this.applyStatus(this.enemy, this.boostOutgoingStatus(cmd.applyStatus));
    if (cmd.delayEnemyBy && !this.enemy.isDead) this.applyDelayToEnemy(cmd.delayEnemyBy);
    // シナジー「重量怪物」3段階目(very_heavy_delays_enemy): 超重量技は威力に加え、敵のCTも遅延させる。
    if (cmd.ctWeight === 'very_heavy' && this.veryHeavyDelaysEnemyAmount > 0 && !this.enemy.isDead) {
      this.applyDelayToEnemy(this.veryHeavyDelaysEnemyAmount);
    }
    // シナジー「炎獄」3段階目(attack_burning_ct_bonus): 炎上中の敵を攻撃すると自分の次回行動が早まる。
    if (enemyWasBurningBeforeHit && this.attackBurningCtBonusPct !== 0 && totalDmg > 0) {
      this.applyHasteToSelf((Math.abs(this.attackBurningCtBonusPct) / 100) * CTB_BASE_INTERVAL);
      this.pushLog('🔥 炎上中の敵への攻撃で行動がさらに早まった');
    }
    if (!this.enemy.isDead) {
      this.triggerBleedOnHit(this.enemy);
      this.checkEnemyPhaseTransition();
    }

    if (this.enemy.isDead && this.player.mods.onKillCtBonusPct > 0) {
      this.applyHasteToSelf((this.player.mods.onKillCtBonusPct / 100) * CTB_BASE_INTERVAL);
    }
    // シナジー「捕食者」2段階目以降(on_kill_mp_gain)・3段階目(kill_instant_action): 撃破のたびにMP回復・即行動。
    if (this.enemy.isDead && this.player.mods.onKillMpGain > 0) {
      this.mp = Math.min(this.player.maxMp, this.mp + this.player.mods.onKillMpGain);
      this.pushLog(`🔷 撃破でMPが${this.player.mods.onKillMpGain}回復`);
    }
    if (this.enemy.isDead && this.killInstantActionRule) {
      this.killGrantedInstantAction = true;
      this.pushLog('🦴 撃破の勢いで即座にもう一度行動できる！');
    }

    if (this.enemy.isDead && cmd.killBonus) {
      if (cmd.killBonus.healPct) {
        const predationBonusPct = this.statusMagnitude(this.player, 'predation_mark');
        const healPct = cmd.killBonus.healPct * (1 + predationBonusPct / 100);
        const heal = Math.round(this.player.maxHp * (healPct / 100));
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
        this.pushLog(`💗 撃破のボーナスでHPが${heal}回復`);
      }
      if (cmd.killBonus.mpGain) {
        this.mp = Math.min(this.player.maxMp, this.mp + cmd.killBonus.mpGain);
        this.pushLog(`🔷 撃破のボーナスでMPが${cmd.killBonus.mpGain}回復`);
      }
      if (cmd.killBonus.instantNextAction) {
        this.killGrantedInstantAction = true;
        this.pushLog('🍖 撃破の勢いで即座にもう一度行動できる！');
      }
    }

    // シナジー「多腕」3段階目(follow_up_after_attack): 攻撃系コマンドの後、自動で追撃を1回追加する。
    if (this.followUpAfterAttackMult > 0 && !this.player.pendingFollowUp && !this.enemy.isDead && totalDmg > 0) {
      this.player.pendingFollowUp = { powerMult: this.followUpAfterAttackMult };
    }

    // 追撃(追撃命令で予約、またはシナジーで自動付与): この攻撃の直後に追加の1撃を放つ。
    if (this.player.pendingFollowUp && !this.enemy.isDead) {
      const followUp = this.player.pendingFollowUp;
      this.player.pendingFollowUp = null;
      const followDmg = this.computeDamage(this.player.power * followUp.powerMult, this.effectiveDefense(this.enemy), 0, 0);
      this.enemy.hp = Math.max(0, this.enemy.hp - followDmg);
      this.pushLog(`⚡ 追撃！${followDmg}ダメージ`);
      this.pushEvent({ type: 'attack', side: 'player', targetSide: 'enemy', commandName: '追撃', icon: '⚡', damage: followDmg });
      if (this.enemy.hp <= 0 && !this.preventLethalIfPossible(this.enemy)) this.enemy.isDead = true;
    }

    // 反撃型(仕様書10・17章): 被弾した敵が一定確率でCTを消費せず即座に反撃する。
    if (!this.enemy.isDead && this.enemy.counter && Math.random() * 100 < this.enemy.counter.chancePct) {
      const counterRaw = this.enemy.power * this.enemy.counter.powerMult;
      const counterVulnerable = this.statusMagnitude(this.player, 'vulnerable');
      const rawCounterDmg = this.computeDamage(counterRaw, this.effectiveDefense(this.player), this.player.guardReductionPct, counterVulnerable);
      this.player.guardReductionPct = 0;
      const counterDmg = this.absorbWithShield(this.applyPlayerDefensiveHooks(rawCounterDmg));
      this.player.hp = Math.max(0, this.player.hp - counterDmg);
      this.pushLog(`🔁 ${this.enemy.name}の反撃！${counterDmg}ダメージ`);
      this.pushEvent({ type: 'counter', side: 'enemy', targetSide: 'player', damage: counterDmg });
      if (this.player.hp <= 0 && !this.preventLethalIfPossible(this.player)) this.player.isDead = true;
      if (!this.player.isDead) this.triggerBleedOnHit(this.player);
    }
  }

  // フェーズ変化(新フック): HPが閾値以下になった瞬間、以降の行動パターンを丸ごと切り替える。
  private checkEnemyPhaseTransition() {
    if (this.enemy.isDead) return;
    const hpPct = this.enemy.maxHp > 0 ? (this.enemy.hp / this.enemy.maxHp) * 100 : 100;
    const phase = this.enemyPhases[this.enemyPhaseIndex + 1];
    if (!phase || hpPct > phase.hpPctThreshold) return;
    this.enemyPhaseIndex += 1;
    this.enemy.moves = phase.moves;
    this.enemy.moveIndex = 0;
    this.pushLog(phase.announceText);
    this.pushEvent({ type: 'telegraph', message: phase.announceText });
  }

  private resolveUntilPlayerOrEnd() {
    let guard = 0;
    while (this.status === 'ongoing' && guard < CTB_MAX_RESOLVE_STEPS) {
      guard += 1;
      const side = this.firstActingSide();
      if (side === 'player') {
        this.tickStatusesAtTurnStart('player');
        if (this.checkEnd()) return;
        this.phase = 'player_turn';
        return;
      }
      this.tickStatusesAtTurnStart('enemy');
      if (this.checkEnd()) return;
      this.resolveEnemyAttack();
      if (this.checkEnd()) return;
    }
  }

  private checkEnd(): boolean {
    if (this.status !== 'ongoing') return true;
    if (this.player.hp <= 0 || this.player.isDead) {
      this.player.hp = 0;
      this.status = 'lost';
      this.phase = 'ended';
      this.pushLog('💀 キメラのコアが機能を停止した…敗北');
      this.pushEvent({ type: 'defeat' });
      return true;
    }
    if (this.enemy.hp <= 0 || this.enemy.isDead) {
      this.enemy.hp = 0;
      this.status = 'won';
      this.phase = 'ended';
      this.pushLog(`🎉 ${this.enemy.name}を撃破した！`);
      this.pushEvent({ type: 'victory' });
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------
  // 外部API
  // ------------------------------------------------------------
  useCommand(commandId: string): { ok: boolean; reason?: string } {
    if (this.status !== 'ongoing') return { ok: false, reason: '戦闘は終了しています' };
    if (this.phase !== 'player_turn') return { ok: false, reason: 'まだ行動順ではありません' };
    const cmd = getCommand(commandId);
    if (!cmd) return { ok: false, reason: '不明なコマンドです' };
    // シナジー「演算生命」2段階目以降(utility_mp_cost_reduction_pct): 補助系コマンドのMPコストを軽減。
    const effectiveMpCost =
      cmd.powerMult <= 0 && this.player.mods.utilityMpCostReductionPct > 0
        ? Math.max(0, Math.round(cmd.mpCost * (1 - this.player.mods.utilityMpCostReductionPct / 100)))
        : cmd.mpCost;
    // ゼロコスト核(first_mp_move_free)、またはシナジー「反射生物」3段階目(reflect_next_free)発動直後:
    // 1回だけMP技のコストを無料にする(所持MP不足でも使える)。
    const usesFreeMpMove = effectiveMpCost > 0 && ((this.player.mods.firstMpMoveFree && !this.firstMpMoveFreeUsed) || this.pendingFreeMpMove);
    if (!usesFreeMpMove && this.mp < effectiveMpCost) return { ok: false, reason: `MPが足りません（必要${effectiveMpCost}）` };
    if (effectiveMpCost > 0 && this.statusMagnitude(this.player, 'silence') > 0) {
      return { ok: false, reason: '沈黙中はMP技を使用できません' };
    }
    const wasMpFullBeforeSpend = this.mp >= this.player.maxMp;

    if (usesFreeMpMove) {
      if (this.pendingFreeMpMove) {
        this.pendingFreeMpMove = false;
        this.pushLog(`🦔 反撃直後でMP消費なしで${cmd.name}を使用！`);
      } else {
        this.firstMpMoveFreeUsed = true;
        this.pushLog(`🔷 ゼロコスト核で${cmd.name}のMP消費が無料に！`);
      }
    } else {
      this.mp -= effectiveMpCost;
    }
    const mpLeak = this.statusMagnitude(this.player, 'mp_leak');
    if (mpLeak > 0) {
      const leaked = Math.min(this.mp, Math.round(mpLeak));
      this.mp -= leaked;
      if (leaked > 0) this.pushLog(`🕳️ MP漏出で追加${leaked}MPを消費`);
    }

    // 模倣(mimicPreviousCommand)は「直前のコマンド」として記録しない(直前の実行動を
    // 参照し続けられるようにするため)。this.lastMpSpentはresolvePlayerCommand内の
    // refundLastMpSpentPctが参照するので、更新は解決の後で行う。
    const isMimicUse = !!cmd.mimicPreviousCommand;
    this.resolvePlayerCommand(cmd);
    if (!isMimicUse) this.lastPlayerCommandId = cmd.id;
    this.lastMpSpent = effectiveMpCost;

    let weightMult = this.effectiveWeightMult(this.player, cmd.ctWeight, this.player.mods) * this.consumeParalyzeExtraMult(this.player);
    if (cmd.firstActionCtBonusMult && this.turnCount === 1) weightMult *= cmd.firstActionCtBonusMult;
    // シナジー「演算生命」1段階目以降(utility_ct_bonus_pct): 補助系コマンドのCTをさらに短縮。
    if (cmd.powerMult <= 0) weightMult *= 1 + this.player.mods.utilityCtBonusPct / 100;
    // シナジー「多心臓」3段階目(full_mp_ct_bonus): MPが満タンの状態からMP技を使うとCTがさらに短縮される。
    if (cmd.mpCost > 0 && wasMpFullBeforeSpend && this.fullMpCtBonusPct !== 0) {
      weightMult *= 1 + this.fullMpCtBonusPct / 100;
      this.pushLog('🔷 MP満タンからの技でさらに行動が早まった');
    }
    const synergyGrantedExtraAction = this.playerExtraActionRules.some(
      (rule) => rule.afterCtWeight === cmd.ctWeight && Math.random() * 100 < rule.chancePct
    );
    const grantedExtraAction = this.killGrantedInstantAction || synergyGrantedExtraAction;
    this.killGrantedInstantAction = false;
    if (grantedExtraAction && this.status === 'ongoing') {
      if (synergyGrantedExtraAction) this.pushLog('🌀 シナジー効果で即座にもう一度行動できる！');
      this.pushEvent({ type: 'extra_action', side: 'player' });
    } else {
      this.nextAt.player += actionInterval(this.player.speed, weightMult);
    }
    this.turnCount += 1;

    if (this.checkEnd()) return { ok: true };
    this.resolveUntilPlayerOrEnd();
    return { ok: true };
  }

  previewOrder(commandId: string | null, steps: number = CTB_PREVIEW_STEPS): OrderSlot[] {
    if (this.phase === 'battle_start' || this.phase === 'ended') return [];
    const cmd = commandId && this.phase === 'player_turn' ? getCommand(commandId) : null;
    const firstWeightMult = cmd ? this.effectiveWeightMult(this.player, cmd.ctWeight, this.player.mods) : 1.0;
    const at = { ...this.nextAt };
    const order: OrderSlot[] = [];
    let usedFirst = false;
    let enemySteps = 0;
    for (let i = 0; i < steps; i++) {
      const side: Side = at.player <= at.enemy ? 'player' : 'enemy';
      if (side === 'player') {
        const mult = !usedFirst ? firstWeightMult : 1.0;
        usedFirst = true;
        at.player += actionInterval(this.player.speed, mult);
        order.push({ side, intent: null, telegraph: null });
      } else {
        const move = this.currentEnemyMove(enemySteps);
        enemySteps += 1;
        at.enemy += actionInterval(this.enemy.speed, this.effectiveWeightMult(this.enemy, move.ctWeight));
        order.push({ side, intent: move.intent, telegraph: move.telegraph ?? null });
      }
    }
    return order;
  }

  // 仕様書22章: AUTOの簡易AI。高度な先読みはせず、
  // 「ボスの大技/強攻撃が来るなら防御寄り、それ以外は攻撃系から重み付き抽選」程度に留める。
  // 仕様書22章のAUTO簡易AIは、60コマンド全体を評価する高度なAIではなく、既存の
  // 基礎5コマンド+防御+遅延打撃のみを使う実装のまま(仕様書の範囲外・Enemy AIと同様、
  // 段階的接続の対象外として据え置いている)。CMD IDはExcelのコマンドID(CMD001等)。
  decideAutoCommand(): CommandDef {
    const hpPct = this.player.maxHp > 0 ? this.player.hp / this.player.maxHp : 1;
    const guard = getCommand('CMD004')!;
    if (hpPct < 0.3) return guard;

    const nextMove = this.currentEnemyMove();
    if (nextMove.intent === 'ULTIMATE' || nextMove.intent === 'STRONG') {
      const delayStrike = getCommand('CMD011')!;
      if (this.mp >= delayStrike.mpCost && this.statusMagnitude(this.player, 'silence') === 0 && Math.random() < 0.5) return delayStrike;
      return guard;
    }

    const silenced = this.statusMagnitude(this.player, 'silence') > 0;
    const pool: { cmd: CommandDef; weight: number }[] = [
      { cmd: getCommand('CMD001')!, weight: 3 }, // 通常攻撃
      { cmd: getCommand('CMD002')!, weight: 2 }, // 速撃
      { cmd: getCommand('CMD003')!, weight: 2 }, // 強打
      { cmd: getCommand('CMD006')!, weight: 1.4 }, // 火炎牙
      { cmd: getCommand('CMD007')!, weight: 1 }, // 毒針
    ].filter((p) => this.mp >= p.cmd.mpCost && !(silenced && p.cmd.mpCost > 0));

    const totalWeight = pool.reduce((s, p) => s + p.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const p of pool) {
      roll -= p.weight;
      if (roll <= 0) return p.cmd;
    }
    return getCommand('CMD001')!;
  }

  setAutoMode(v: boolean) {
    this.autoMode = v;
  }
  getAutoMode(): boolean {
    return this.autoMode;
  }
  getStatus(): CtbStatus {
    return this.status;
  }
  // 統合版(本編)が戦闘終了後にRunStateへHP・MPを持ち越すための取得用API。
  getFinalPlayerHp(): number {
    return Math.round(this.player.hp);
  }
  getFinalPlayerMp(): number {
    return Math.round(this.mp);
  }

  private actorSnapshot(a: RuntimeActor): CtbActorSnapshot {
    return {
      name: a.name,
      icon: a.icon,
      color: a.color,
      hp: Math.round(a.hp),
      maxHp: a.maxHp,
      statuses: a.statuses.map((s) => ({ kind: s.kind, magnitude: Math.round(s.magnitude * 10) / 10, turnsLeft: s.turnsLeft })),
      guardActive: a.guardReductionPct > 0,
      isDead: a.isDead,
    };
  }

  private commandPreview(cmd: CommandDef): CommandPreviewInfo {
    // シナジー「演算生命」2段階目以降(utility_mp_cost_reduction_pct)、ゼロコスト核、
    // シナジー「反射生物」3段階目(reflect_next_free)発動直後: 実際に消費されるMPはuseCommandと同じ式で見積もる。
    const effectiveMpCost =
      cmd.powerMult <= 0 && this.player.mods.utilityMpCostReductionPct > 0
        ? Math.max(0, Math.round(cmd.mpCost * (1 - this.player.mods.utilityMpCostReductionPct / 100)))
        : cmd.mpCost;
    const usesFreeMpMove = effectiveMpCost > 0 && ((this.player.mods.firstMpMoveFree && !this.firstMpMoveFreeUsed) || this.pendingFreeMpMove);
    const silenced = effectiveMpCost > 0 && this.statusMagnitude(this.player, 'silence') > 0;
    const affordable = !silenced && (usesFreeMpMove || this.mp >= effectiveMpCost);
    const usable = this.status === 'ongoing' && this.phase === 'player_turn' && affordable;
    let damageEstimate: number | null = null;
    if (cmd.powerMult > 0) {
      let power = this.player.power * cmd.powerMult;
      power *= 1 + this.attackPowerCategoryBonusPct(cmd.ctWeight, this.player.mods) / 100;
      power *= 1 + this.statusMagnitude(this.player, 'frenzy') / 100;
      power *= 1 - this.statusMagnitude(this.player, 'fear') / 100;
      power *= 1 + this.player.mods.powerBonusAllPct / 100;
      if (cmd.mpCost > 0) power *= 1 + this.player.mods.mpMovePowerBonusPct / 100;
      if (this.player.chargeBonusMult > 0) power *= 1 + this.player.chargeBonusMult;
      const defense = cmd.ignoreDefense ? 0 : this.effectiveDefense(this.enemy) * (1 - this.player.mods.ignoreDefensePct / 100);
      damageEstimate = Math.max(1, Math.round(power - defense));
    }
    const weightMult = this.effectiveWeightMult(this.player, cmd.ctWeight, this.player.mods);
    const labelPrefix = weightMult <= 0.5 ? '⚡⚡' : weightMult <= 0.75 ? '⚡' : weightMult >= 1.5 ? '🐌' : '';
    const statusLabels: string[] = [];
    if (cmd.applyStatus) statusLabels.push(`付与:${cmd.applyStatus.kind}`);
    if (cmd.applySelfStatus) statusLabels.push(`自己:${cmd.applySelfStatus.kind}`);
    if (cmd.delayEnemyBy) statusLabels.push('敵CT遅延');
    if (cmd.hasteSelfBy) statusLabels.push('自CT短縮');
    if (cmd.hits && cmd.hits > 1) statusLabels.push(`${cmd.hits}Hit`);
    if (cmd.randomHitsRange) statusLabels.push(`${cmd.randomHitsRange[0]}〜${cmd.randomHitsRange[1]}Hit`);
    if (cmd.ignoreDefense) statusLabels.push('防御無視');
    if (cmd.lifestealPct) statusLabels.push(`吸血${cmd.lifestealPct}%`);
    if (cmd.executeBonus) statusLabels.push(`処刑(敵HP${cmd.executeBonus.hpPctThreshold}%以下)`);
    if (cmd.damageImmuneOnce) statusLabels.push('完全無効化');
    if (cmd.counterStance) statusLabels.push('カウンター');
    if (cmd.reflectPct) statusLabels.push(`反射${cmd.reflectPct}%`);
    if (cmd.killBonus) statusLabels.push('撃破ボーナス');
    if (cmd.followUpNextAttack) statusLabels.push('追撃予約');
    if (cmd.mimicPreviousCommand) statusLabels.push('模倣');
    return {
      id: cmd.id,
      name: cmd.name,
      icon: cmd.icon,
      kind: cmd.kind,
      damageEstimate,
      mpCost: effectiveMpCost,
      ctLabel: `${labelPrefix}${CT_WEIGHT_LABEL[cmd.ctWeight]}`,
      applyStatusLabel: statusLabels.length > 0 ? statusLabels.join(' / ') : null,
      affordable,
      usable,
      description: cmd.description,
    };
  }

  getSnapshot(): CtbSnapshot {
    const nextMove = this.status === 'ongoing' ? this.currentEnemyMove() : null;
    return {
      phase: this.phase,
      status: this.status,
      turnCount: this.turnCount,
      player: { ...this.actorSnapshot(this.player), chargeActive: this.player.chargeBonusMult > 0 },
      enemy: this.actorSnapshot(this.enemy),
      mp: { current: Math.round(this.mp), max: this.player.maxMp },
      order: this.previewOrder(null),
      nextEnemyAction: nextMove ? { intent: nextMove.intent, moveName: nextMove.name, icon: nextMove.icon } : null,
      commands: COMMANDS.map((c) => this.commandPreview(c)),
      activeSynergyNames: this.activeSynergyNames,
      log: this.log.slice(0, 30),
      autoMode: this.autoMode,
      enemyFirstAnnounce: this.pendingEnemyAnnounce,
    };
  }
}
