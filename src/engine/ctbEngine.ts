import { COMMANDS, getCommand } from '../data/commands';
import { activeSynergies, computePlayerModifiers, type PlayerModifiers } from './modifiers';
import type { CommandDef, EnemyDef, EnemyIntent, EnemyMoveDef, EnemyTier, PartDef, Side, StatusApply, StatusKind } from '../data/types';
import { CT_DELAY_UNITS_CEILING, CT_WEIGHT_INTERVAL_MULT, CT_WEIGHT_LABEL, CT_WEIGHT_MULT_FLOOR, TIER_DELAY_RESISTANCE_PCT } from '../data/types';

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
  | { type: 'status_tick'; time: number; side: Side; kind: 'burn' | 'poison'; damage: number }
  | { type: 'telegraph'; time: number; message: string }
  | { type: 'victory'; time: number }
  | { type: 'defeat'; time: number };

type EventWithoutTime<T> = T extends CtbEvent ? Omit<T, 'time'> : never;

const CTB_BASE_INTERVAL = 100;
const CTB_PREVIEW_STEPS = 7; // 5〜8行動を見せる(仕様書5章)
const CTB_MAX_RESOLVE_STEPS = 60;

// MP: 代謝ゲージを廃止した第1弾のMP仕様。挙動(プレイヤーターン開始時に一定量回復)は
// 仮実装のまま、呼び名・見た目だけでなく「MPが0でも戦える」設計(通常攻撃/速撃/防御/待機/
// チャージがMP0)を徹底している。
const CTB_MP_MAX_BASE = 100;
const CTB_MP_START_RATIO = 0.4;
const CTB_MP_REGEN_PER_TURN_BASE = 14;

const PLAYER_BASE = { name: 'キメラ', icon: '🧬', color: '#4ade80', maxHp: 130, defense: 3, power: 15, evasionPct: 5, speed: 100 };

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
  mpRegenPerTurn: number;
  chargeBonusMult: number; // チャージで蓄積し、次の攻撃系コマンドで消費するダメージ倍率ボーナス
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

  constructor(enemyDef: EnemyDef, equippedParts: PartDef[] = []) {
    const mods = computePlayerModifiers(equippedParts);
    this.activeSynergyNames = activeSynergies(equippedParts).map((s) => s.name);
    const maxMp = CTB_MP_MAX_BASE + mods.maxMpBonus;

    this.player = {
      side: 'player',
      name: PLAYER_BASE.name,
      icon: PLAYER_BASE.icon,
      color: PLAYER_BASE.color,
      hp: PLAYER_BASE.maxHp,
      maxHp: PLAYER_BASE.maxHp,
      defense: PLAYER_BASE.defense,
      power: PLAYER_BASE.power,
      evasionPct: PLAYER_BASE.evasionPct,
      speed: PLAYER_BASE.speed + mods.speedFlatBonus,
      guardReductionPct: 0,
      statuses: [],
      isDead: false,
      mods,
      maxMp,
      mpRegenPerTurn: CTB_MP_REGEN_PER_TURN_BASE + mods.mpRegenBonus,
      chargeBonusMult: 0,
    };
    this.mp = Math.round(maxMp * CTB_MP_START_RATIO);

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
      this.regenMpForNewPlayerTurn();
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
  // 状態異常(仕様書9章): burn/poisonは自分の行動順が来た瞬間に継続ダメージ。
  // vulnerable/haste/slowはダメージ・CT計算式側から参照するだけで、ここでは
  // 残りターン数の消化だけを行う。
  // ------------------------------------------------------------
  private tickStatusesAtTurnStart(side: Side) {
    const actor = side === 'player' ? this.player : this.enemy;
    if (actor.isDead) return;
    for (const s of actor.statuses) {
      if ((s.kind === 'burn' || s.kind === 'poison') && actor.hp > 0) {
        const dmg = Math.round(s.magnitude);
        actor.hp = Math.max(0, actor.hp - dmg);
        this.pushLog(`${s.kind === 'burn' ? '🔥' : '☠️'} ${actor.name}は${s.kind === 'burn' ? '炎上' : '毒'}で${dmg}ダメージ`);
        this.pushEvent({ type: 'status_tick', side, kind: s.kind, damage: dmg });
      }
    }
    actor.statuses = actor.statuses.map((s) => ({ ...s, turnsLeft: s.turnsLeft - 1 })).filter((s) => s.turnsLeft > 0);
    if (actor.hp <= 0) actor.isDead = true;
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
    this.pushLog(`${target.name}に${apply.kind}状態が付与された`);
    this.pushEvent({ type: 'status_apply', side: target.side, kind: apply.kind });
  }

  private statusMagnitude(actor: RuntimeActor, kind: StatusKind): number {
    return actor.statuses.filter((s) => s.kind === kind).reduce((sum, s) => sum + s.magnitude, 0);
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
    const hastePct = this.statusMagnitude(actor, 'haste');
    const slowPct = this.statusMagnitude(actor, 'slow');
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

  // 仕様書12章: 遅延打撃(プレイヤー→敵)の実際の加算量。効果量ボーナス→天井→耐性の順に適用する。
  private applyDelayToEnemy(baseAmount: number) {
    const boosted = baseAmount * (1 + this.player.mods.delayEffectBonusPct / 100);
    const capped = Math.min(CT_DELAY_UNITS_CEILING, boosted);
    const resisted = capped * (1 - this.enemy.delayResistancePct / 100);
    this.nextAt.enemy += resisted;
    this.pushLog(`⏳ ${this.enemy.name}の行動が遅れた`);
    this.pushEvent({ type: 'delay_enemy', side: 'player', amount: Math.round(resisted) });
  }

  // CT遅延型敵(→プレイヤー)。プレイヤー側には部位耐性の概念がないため天井のみ適用する。
  private applyDelayToPlayer(baseAmount: number) {
    const capped = Math.min(CT_DELAY_UNITS_CEILING, baseAmount);
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

    if (Math.random() * 100 < this.player.evasionPct) {
      this.pushLog(`💨 キメラは${this.enemy.name}の${move.name}を回避した`);
      this.pushEvent({ type: 'evade', side: 'enemy', targetSide: 'player', commandName: move.name, icon: move.icon });
    } else {
      const rawPower = this.enemy.power * move.powerMult;
      const vulnerablePct = this.statusMagnitude(this.player, 'vulnerable');
      const dmg = this.computeDamage(rawPower, this.player.defense, this.player.guardReductionPct, vulnerablePct);
      this.player.guardReductionPct = 0;
      this.player.hp = Math.max(0, this.player.hp - dmg);
      if (this.player.hp <= 0) this.player.isDead = true;
      this.pushLog(`${this.enemy.icon}${this.enemy.name}の${move.name}が${dmg}ダメージ`);
      this.pushEvent({ type: 'attack', side: 'enemy', targetSide: 'player', commandName: move.name, icon: move.icon, damage: dmg });
      this.applyStatus(this.player, move.applyStatus);
      if (move.delayTargetBy && !this.player.isDead) this.applyDelayToPlayer(move.delayTargetBy);
    }
    this.nextAt.enemy += actionInterval(this.enemy.speed, this.effectiveWeightMult(this.enemy, move.ctWeight));
  }

  private resolvePlayerCommand(cmd: CommandDef) {
    if (cmd.kind === 'guard') {
      this.player.guardReductionPct = cmd.guardReductionPct ?? 0;
      if (cmd.mpRestoreOnUse) this.mp = Math.min(this.player.maxMp, this.mp + cmd.mpRestoreOnUse);
      this.pushLog(`🛡️ ${cmd.name}！次に受けるダメージを軽減する`);
      this.pushEvent({ type: 'guard', side: 'player' });
      return;
    }
    if (cmd.kind === 'wait') {
      if (cmd.hasteSelfBy) this.applyHasteToSelf(cmd.hasteSelfBy);
      if (cmd.mpRestoreOnUse) this.mp = Math.min(this.player.maxMp, this.mp + cmd.mpRestoreOnUse);
      this.applyStatus(this.player, cmd.applySelfStatus);
      this.pushLog(`${cmd.icon} ${cmd.name}！`);
      this.pushEvent(cmd.id === 'haste_self' ? { type: 'haste_self', side: 'player' } : { type: 'wait', side: 'player' });
      return;
    }
    if (cmd.kind === 'charge') {
      this.player.chargeBonusMult += cmd.chargeNextAttackMultBonus ?? 0;
      this.pushLog(`🔋 ${cmd.name}！次の攻撃が強化される`);
      this.pushEvent({ type: 'charge', side: 'player' });
      return;
    }

    // attack系
    if (Math.random() * 100 < this.enemy.evasionPct) {
      this.pushLog(`💨 ${this.enemy.name}が回避した`);
      this.pushEvent({ type: 'evade', side: 'player', targetSide: 'enemy', commandName: cmd.name, icon: cmd.icon });
      return;
    }
    let power = this.player.power * cmd.powerMult;
    power *= 1 + this.attackPowerCategoryBonusPct(cmd.ctWeight, this.player.mods) / 100;
    if (this.player.chargeBonusMult > 0) {
      power *= 1 + this.player.chargeBonusMult;
      this.player.chargeBonusMult = 0;
    }
    const dmg = this.computeDamage(power, this.enemy.defense, 0, 0);
    this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
    if (this.enemy.hp <= 0) this.enemy.isDead = true;
    this.pushLog(`${cmd.icon}${cmd.name}が${this.enemy.name}に${dmg}ダメージ`);
    this.pushEvent({ type: 'attack', side: 'player', targetSide: 'enemy', commandName: cmd.name, icon: cmd.icon, damage: dmg });
    this.applyStatus(this.enemy, cmd.applyStatus);
    if (cmd.delayEnemyBy && !this.enemy.isDead) this.applyDelayToEnemy(cmd.delayEnemyBy);

    // 反撃型(仕様書10・17章): 被弾した敵が一定確率でCTを消費せず即座に反撃する。
    if (!this.enemy.isDead && this.enemy.counter && Math.random() * 100 < this.enemy.counter.chancePct) {
      const counterRaw = this.enemy.power * this.enemy.counter.powerMult;
      const counterVulnerable = this.statusMagnitude(this.player, 'vulnerable');
      const counterDmg = this.computeDamage(counterRaw, this.player.defense, this.player.guardReductionPct, counterVulnerable);
      this.player.guardReductionPct = 0;
      this.player.hp = Math.max(0, this.player.hp - counterDmg);
      if (this.player.hp <= 0) this.player.isDead = true;
      this.pushLog(`🔁 ${this.enemy.name}の反撃！${counterDmg}ダメージ`);
      this.pushEvent({ type: 'counter', side: 'enemy', targetSide: 'player', damage: counterDmg });
    }
  }

  private regenMpForNewPlayerTurn() {
    this.mp = Math.min(this.player.maxMp, this.mp + this.player.mpRegenPerTurn);
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
        this.regenMpForNewPlayerTurn();
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
    if (this.mp < cmd.mpCost) return { ok: false, reason: `MPが足りません（必要${cmd.mpCost}）` };

    this.mp -= cmd.mpCost;
    this.resolvePlayerCommand(cmd);
    this.nextAt.player += actionInterval(this.player.speed, this.effectiveWeightMult(this.player, cmd.ctWeight, this.player.mods));
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
  decideAutoCommand(): CommandDef {
    const hpPct = this.player.maxHp > 0 ? this.player.hp / this.player.maxHp : 1;
    const guard = getCommand('guard')!;
    if (hpPct < 0.3) return guard;

    const nextMove = this.currentEnemyMove();
    if (nextMove.intent === 'ULTIMATE' || nextMove.intent === 'STRONG') {
      const delayStrike = getCommand('delay_strike')!;
      if (this.mp >= delayStrike.mpCost && Math.random() < 0.5) return delayStrike;
      return guard;
    }

    const pool: { cmd: CommandDef; weight: number }[] = [
      { cmd: getCommand('attack')!, weight: 3 },
      { cmd: getCommand('quick')!, weight: 2 },
      { cmd: getCommand('smash')!, weight: 2 },
      { cmd: getCommand('flame_fang')!, weight: 1.4 },
      { cmd: getCommand('poison_needle')!, weight: 1 },
    ].filter((p) => this.mp >= p.cmd.mpCost);

    const totalWeight = pool.reduce((s, p) => s + p.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const p of pool) {
      roll -= p.weight;
      if (roll <= 0) return p.cmd;
    }
    return getCommand('attack')!;
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
    const affordable = this.mp >= cmd.mpCost;
    const usable = this.status === 'ongoing' && this.phase === 'player_turn' && affordable;
    let damageEstimate: number | null = null;
    if (cmd.powerMult > 0) {
      let power = this.player.power * cmd.powerMult;
      power *= 1 + this.attackPowerCategoryBonusPct(cmd.ctWeight, this.player.mods) / 100;
      if (this.player.chargeBonusMult > 0) power *= 1 + this.player.chargeBonusMult;
      damageEstimate = Math.max(1, Math.round(power - this.enemy.defense));
    }
    const weightMult = this.effectiveWeightMult(this.player, cmd.ctWeight, this.player.mods);
    const labelPrefix = weightMult <= 0.5 ? '⚡⚡' : weightMult <= 0.75 ? '⚡' : weightMult >= 1.5 ? '🐌' : '';
    const statusLabels: string[] = [];
    if (cmd.applyStatus) statusLabels.push(`付与:${cmd.applyStatus.kind}`);
    if (cmd.applySelfStatus) statusLabels.push(`自己:${cmd.applySelfStatus.kind}`);
    if (cmd.delayEnemyBy) statusLabels.push('敵CT遅延');
    if (cmd.hasteSelfBy) statusLabels.push('自CT短縮');
    return {
      id: cmd.id,
      name: cmd.name,
      icon: cmd.icon,
      kind: cmd.kind,
      damageEstimate,
      mpCost: cmd.mpCost,
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
