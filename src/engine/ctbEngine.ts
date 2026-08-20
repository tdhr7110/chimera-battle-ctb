import { COMMANDS, getCommand } from '../data/commands';
import type { CommandDef, EnemyDef, EnemyMoveDef, Side } from '../data/types';
import { CT_WEIGHT_INTERVAL_MULT, CT_WEIGHT_LABEL } from '../data/types';

// ============================================================
// キメラバトル CTB戦闘システム仕様書 v0.2 の実装。
//
// 「行動順(CT)」はATBゲージ方式で管理する: 各陣営に「次に行動できる時刻(nextAt)」を
// 持たせ、値が小さい側から行動する。行動すると、使用速度とコマンド/技のCT重量に応じて
// nextAtが加算される。CT重量が軽いコマンドほど次の行動が早く巡ってくる(仕様書6章)。
//
// 仕様書4章「戦闘開始のUX改善」に対応するため、戦闘は単純な即時解決ではなく
// 明示的なフェーズを持つ:
//   battle_start → order_reveal → (enemy_first_announce →) player_turn
// UI側はこのphaseの遷移をsetTimeoutで演出しながら進める(engine自身はタイマーを
// 持たない純粋な状態機械)。
// ============================================================

export type CtbPhase = 'battle_start' | 'order_reveal' | 'enemy_first_announce' | 'player_turn' | 'ended';
export type CtbStatus = 'ongoing' | 'won' | 'lost';

export type CtbEvent =
  | { type: 'attack'; time: number; side: Side; targetSide: Side; commandName: string; icon: string; damage: number; isCrit: boolean; isEvaded: false }
  | { type: 'evade'; time: number; side: Side; targetSide: Side; commandName: string; icon: string }
  | { type: 'guard'; time: number; side: Side }
  | { type: 'burn_apply'; time: number; side: Side }
  | { type: 'burn_tick'; time: number; side: Side; damage: number }
  | { type: 'telegraph'; time: number; message: string }
  | { type: 'victory'; time: number }
  | { type: 'defeat'; time: number };

type EventWithoutTime<T> = T extends CtbEvent ? Omit<T, 'time'> : never;

const CTB_BASE_INTERVAL = 100;
const CTB_PREVIEW_STEPS = 7; // 5〜8行動を見せる(仕様書5章)
const CTB_MAX_RESOLVE_STEPS = 60;
const CTB_METABOLISM_MAX = 100;
const CTB_METABOLISM_START = 40;
const CTB_METABOLISM_REGEN_PER_TURN = 16;

const PLAYER_BASE = { name: 'キメラ', icon: '🧬', color: '#4ade80', maxHp: 130, defense: 3, power: 15, evasionPct: 5, speed: 100 };

function actionInterval(speed: number, weightMult: number): number {
  return CTB_BASE_INTERVAL * (100 / Math.max(20, speed)) * weightMult;
}

function computeDamage(rawPower: number, defense: number, guardReductionPct: number): number {
  let d = rawPower - defense;
  d = d * (1 - guardReductionPct / 100);
  return Math.max(1, Math.round(d));
}

interface BurnState {
  dps: number;
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
  burn: BurnState | null;
  isDead: boolean;
}

interface EnemyRuntime extends RuntimeActor {
  moves: EnemyMoveDef[];
  moveIndex: number;
}

export interface CommandPreviewInfo {
  id: string;
  name: string;
  icon: string;
  kind: CommandDef['kind'];
  damageEstimate: number | null; // ガード等はnull
  metabolismCost: number;
  ctLabel: string;
  applyStatusLabel: string | null;
  affordable: boolean;
  usable: boolean;
  description: string;
}

export interface OrderSlot {
  side: Side;
  telegraph: string | null; // このスロットが敵の予兆技だと判明していればメッセージ
}

export interface CtbActorSnapshot {
  name: string;
  icon: string;
  color: string;
  hp: number;
  maxHp: number;
  burnTurnsLeft: number;
  guardActive: boolean;
  isDead: boolean;
}

export interface CtbSnapshot {
  phase: CtbPhase;
  status: CtbStatus;
  turnCount: number;
  player: CtbActorSnapshot;
  enemy: CtbActorSnapshot;
  metabolism: { current: number; max: number };
  order: OrderSlot[];
  commands: CommandPreviewInfo[];
  log: string[];
  autoMode: boolean;
  enemyFirstAnnounce: { moveName: string; icon: string; telegraph: string | null } | null;
}

let logSeq = 0;

export class CtbEngine {
  private phase: CtbPhase = 'battle_start';
  private status: CtbStatus = 'ongoing';
  private turnCount = 1;
  private player: RuntimeActor;
  private enemy: EnemyRuntime;
  private nextAt: { player: number; enemy: number };
  private metabolism = CTB_METABOLISM_START;
  private log: string[] = [];
  private events: CtbEvent[] = [];
  private seq = 0;
  private autoMode = false;
  private pendingEnemyAnnounce: { moveName: string; icon: string; telegraph: string | null } | null = null;

  constructor(enemyDef: EnemyDef) {
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
      speed: PLAYER_BASE.speed,
      guardReductionPct: 0,
      burn: null,
      isDead: false,
    };
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
      burn: null,
      isDead: false,
      moves: enemyDef.moves,
      moveIndex: 0,
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

  // BATTLE START表示のあと呼ぶ。初期CTB行動順を確定表示する段階へ進める。
  revealOrder() {
    if (this.phase !== 'battle_start') return;
    this.phase = 'order_reveal';
  }

  // 初期行動順を確認させたあと呼ぶ。最初の行動者を判定し、
  // プレイヤーなら即座にplayer_turnへ、敵なら「ENEMY FIRST」告知フェーズを挟む。
  beginFirstTurn() {
    if (this.phase !== 'order_reveal') return;
    const side = this.firstActingSide();
    if (side === 'player') {
      this.tickBurnAtTurnStart('player');
      if (this.checkEnd()) return;
      this.phase = 'player_turn';
      this.regenMetabolismForNewPlayerTurn();
      return;
    }
    // 敵が先制: まだダメージは発生させず、告知だけ行う(要件: 画面表示直後に突然被弾しない)。
    const move = this.enemy.moves[this.enemy.moveIndex % this.enemy.moves.length];
    this.pendingEnemyAnnounce = { moveName: move.name, icon: move.icon, telegraph: move.telegraph ?? null };
    this.phase = 'enemy_first_announce';
    if (move.telegraph) {
      this.pushLog(move.telegraph);
      this.pushEvent({ type: 'telegraph', message: move.telegraph });
    }
  }

  // 「ENEMY FIRST」告知を見せたあと呼ぶ。実際に敵の先制行動を解決し、以後は通常ループへ入る。
  resolveAnnouncedEnemyTurn() {
    if (this.phase !== 'enemy_first_announce') return;
    this.pendingEnemyAnnounce = null;
    this.tickBurnAtTurnStart('enemy');
    if (this.checkEnd()) return;
    this.resolveEnemyAttack();
    if (this.checkEnd()) return;
    this.resolveUntilPlayerOrEnd();
  }

  private firstActingSide(): Side {
    return this.nextAt.player <= this.nextAt.enemy ? 'player' : 'enemy';
  }

  // ------------------------------------------------------------
  // 状態異常(炎上のみ。仕様書9章の強打の例に合わせた仮のフレーバー)
  // ------------------------------------------------------------
  private tickBurnAtTurnStart(side: Side) {
    const actor = side === 'player' ? this.player : this.enemy;
    if (actor.burn && !actor.isDead) {
      const dmg = Math.round(actor.burn.dps);
      actor.hp = Math.max(0, actor.hp - dmg);
      this.pushLog(`🔥 ${actor.name}は炎上で${dmg}ダメージ`);
      this.pushEvent({ type: 'burn_tick', side, damage: dmg });
      actor.burn.turnsLeft -= 1;
      if (actor.burn.turnsLeft <= 0) actor.burn = null;
      if (actor.hp <= 0) actor.isDead = true;
    }
  }

  private applyStatusToTarget(target: RuntimeActor, cmd: { applyStatus?: CommandDef['applyStatus'] | EnemyMoveDef['applyStatus'] }) {
    if (!cmd.applyStatus) return;
    if (cmd.applyStatus.kind === 'burn') {
      const turns = Math.max(1, cmd.applyStatus.turns);
      if (!target.burn) target.burn = { dps: cmd.applyStatus.dps, turnsLeft: turns };
      else {
        target.burn.dps += cmd.applyStatus.dps;
        target.burn.turnsLeft = Math.max(target.burn.turnsLeft, turns);
      }
      this.pushLog(`🔥 ${target.name}が炎上した`);
      this.pushEvent({ type: 'burn_apply', side: target.side });
    }
  }

  // ------------------------------------------------------------
  // 行動解決
  // ------------------------------------------------------------
  private resolveEnemyAttack() {
    const move = this.enemy.moves[this.enemy.moveIndex % this.enemy.moves.length];
    this.enemy.moveIndex += 1;

    // 仕様書21章: 予兆(telegraph)付きの技が実際に発動する瞬間、ログ・イベントとして
    // 明示する(行動順タイムラインの⚠️バッジは「これから来る」予告、こちらは「今来た」告知)。
    if (move.telegraph) {
      this.pushLog(move.telegraph);
      this.pushEvent({ type: 'telegraph', message: move.telegraph });
    }

    if (Math.random() * 100 < this.player.evasionPct) {
      this.pushLog(`💨 キメラは${this.enemy.name}の${move.name}を回避した`);
      this.pushEvent({ type: 'evade', side: 'enemy', targetSide: 'player', commandName: move.name, icon: move.icon });
    } else {
      const rawPower = this.enemy.power * move.powerMult;
      const dmg = computeDamage(rawPower, this.player.defense, this.player.guardReductionPct);
      this.player.guardReductionPct = 0;
      this.player.hp = Math.max(0, this.player.hp - dmg);
      if (this.player.hp <= 0) this.player.isDead = true;
      this.pushLog(`${this.enemy.icon}${this.enemy.name}の${move.name}が${dmg}ダメージ`);
      this.pushEvent({ type: 'attack', side: 'enemy', targetSide: 'player', commandName: move.name, icon: move.icon, damage: dmg, isCrit: false, isEvaded: false });
      this.applyStatusToTarget(this.player, move);
    }
    this.nextAt.enemy += actionInterval(this.enemy.speed, CT_WEIGHT_INTERVAL_MULT[move.ctWeight]);
  }

  private resolvePlayerCommand(cmd: CommandDef) {
    if (cmd.kind === 'guard') {
      this.player.guardReductionPct = cmd.guardReductionPct ?? 0;
      this.pushLog(`🛡️ ${cmd.name}！次に受けるダメージを軽減する`);
      this.pushEvent({ type: 'guard', side: 'player' });
      return;
    }
    if (Math.random() * 100 < this.enemy.evasionPct) {
      this.pushLog(`💨 ${this.enemy.name}が回避した`);
      this.pushEvent({ type: 'evade', side: 'player', targetSide: 'enemy', commandName: cmd.name, icon: cmd.icon });
      return;
    }
    const rawPower = this.player.power * cmd.powerMult;
    const dmg = computeDamage(rawPower, this.enemy.defense, 0);
    this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
    if (this.enemy.hp <= 0) this.enemy.isDead = true;
    this.pushLog(`${cmd.icon}${cmd.name}が${this.enemy.name}に${dmg}ダメージ`);
    this.pushEvent({ type: 'attack', side: 'player', targetSide: 'enemy', commandName: cmd.name, icon: cmd.icon, damage: dmg, isCrit: false, isEvaded: false });
    this.applyStatusToTarget(this.enemy, cmd);
  }

  private regenMetabolismForNewPlayerTurn() {
    this.metabolism = Math.min(CTB_METABOLISM_MAX, this.metabolism + CTB_METABOLISM_REGEN_PER_TURN);
  }

  private resolveUntilPlayerOrEnd() {
    let guard = 0;
    while (this.status === 'ongoing' && guard < CTB_MAX_RESOLVE_STEPS) {
      guard += 1;
      const side = this.firstActingSide();
      if (side === 'player') {
        this.tickBurnAtTurnStart('player');
        if (this.checkEnd()) return;
        this.phase = 'player_turn';
        this.regenMetabolismForNewPlayerTurn();
        return;
      }
      this.tickBurnAtTurnStart('enemy');
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
    if (this.metabolism < cmd.metabolismCost) return { ok: false, reason: `代謝ゲージが足りません（必要${cmd.metabolismCost}）` };

    this.metabolism -= cmd.metabolismCost;
    this.resolvePlayerCommand(cmd);
    this.nextAt.player += actionInterval(this.player.speed, CT_WEIGHT_INTERVAL_MULT[cmd.ctWeight]);
    this.turnCount += 1;

    if (this.checkEnd()) return { ok: true };
    this.resolveUntilPlayerOrEnd();
    return { ok: true };
  }

  // 現在の行動順(先頭は「これから行動する陣営」)を予測する。
  // commandIdを渡すと「このコマンドを選んだ場合」の予測に切り替わる(仕様書10〜11章)。
  previewOrder(commandId: string | null, steps: number = CTB_PREVIEW_STEPS): OrderSlot[] {
    // battle_start(まだ何も表示しない段階)とended以外は常に予測を返す。
    // コマンド選択によるプレビュー変更(commandId指定)はplayer_turn中のみ意味を持つため、
    // それ以外のフェーズではcommandIdを無視して現在の予測を返す。
    if (this.phase === 'battle_start' || this.phase === 'ended') return [];
    const cmd = commandId && this.phase === 'player_turn' ? getCommand(commandId) : null;
    const firstWeightMult = cmd ? CT_WEIGHT_INTERVAL_MULT[cmd.ctWeight] : 1.0;
    const at = { ...this.nextAt };
    const enemyMoveIdx = this.enemy.moveIndex;
    const order: OrderSlot[] = [];
    let usedFirst = false;
    let enemySteps = 0;
    for (let i = 0; i < steps; i++) {
      const side: Side = at.player <= at.enemy ? 'player' : 'enemy';
      if (side === 'player') {
        const mult = !usedFirst ? firstWeightMult : 1.0;
        usedFirst = true;
        at.player += actionInterval(this.player.speed, mult);
        order.push({ side, telegraph: null });
      } else {
        const move = this.enemy.moves[(enemyMoveIdx + enemySteps) % this.enemy.moves.length];
        enemySteps += 1;
        at.enemy += actionInterval(this.enemy.speed, CT_WEIGHT_INTERVAL_MULT[move.ctWeight]);
        order.push({ side, telegraph: move.telegraph ?? null });
      }
    }
    return order;
  }

  // 仕様書22章: AUTOの簡易AI。攻撃コマンド優先・代謝不足なら通常攻撃・HPが低ければ防御。
  decideAutoCommand(): CommandDef {
    const hpPct = this.player.maxHp > 0 ? this.player.hp / this.player.maxHp : 1;
    const guard = getCommand('guard')!;
    const smash = getCommand('smash')!;
    const rush = getCommand('rush')!;
    const attack = getCommand('attack')!;
    if (hpPct < 0.3 && this.metabolism >= guard.metabolismCost) return guard;
    if (this.metabolism >= smash.metabolismCost && Math.random() < 0.45) return smash;
    if (this.metabolism >= rush.metabolismCost && Math.random() < 0.5) return rush;
    return attack;
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
      burnTurnsLeft: a.burn?.turnsLeft ?? 0,
      guardActive: a.guardReductionPct > 0,
      isDead: a.isDead,
    };
  }

  private commandPreview(cmd: CommandDef): CommandPreviewInfo {
    const affordable = this.metabolism >= cmd.metabolismCost;
    const usable = this.status === 'ongoing' && this.phase === 'player_turn' && affordable;
    const damageEstimate = cmd.powerMult > 0 ? Math.max(1, Math.round(this.player.power * cmd.powerMult - this.enemy.defense)) : null;
    const weightMult = CT_WEIGHT_INTERVAL_MULT[cmd.ctWeight];
    const labelPrefix = weightMult <= 0.7 ? '⚡' : weightMult >= 1.5 ? '🐌' : '';
    return {
      id: cmd.id,
      name: cmd.name,
      icon: cmd.icon,
      kind: cmd.kind,
      damageEstimate,
      metabolismCost: cmd.metabolismCost,
      ctLabel: `${labelPrefix}${CT_WEIGHT_LABEL[cmd.ctWeight]}`,
      applyStatusLabel: cmd.applyStatus ? '🔥炎上付与' : null,
      affordable,
      usable,
      description: cmd.description,
    };
  }

  getSnapshot(): CtbSnapshot {
    return {
      phase: this.phase,
      status: this.status,
      turnCount: this.turnCount,
      player: this.actorSnapshot(this.player),
      enemy: this.actorSnapshot(this.enemy),
      metabolism: { current: Math.round(this.metabolism), max: CTB_METABOLISM_MAX },
      order: this.previewOrder(null),
      commands: COMMANDS.map((c) => this.commandPreview(c)),
      log: this.log.slice(0, 30),
      autoMode: this.autoMode,
      enemyFirstAnnounce: this.pendingEnemyAnnounce,
    };
  }
}
