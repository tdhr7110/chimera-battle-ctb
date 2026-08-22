import { useEffect, useMemo, useRef, useState } from 'react';
import { CtbEngine, type CommandPreviewInfo, type CtbEvent, type CtbSnapshot } from '../engine/ctbEngine';
import type { EnemyDef, PartDef } from '../data/types';
import { ENEMY_INTENT_LABEL, STATUS_LABEL } from '../data/types';
import { ChimeraFigure } from './freeLayer/ChimeraFigure';
import { getCommand } from '../data/commands';
import { COMMAND_CATEGORIES, categoryIdForCommand } from '../data/commandCategories';
import { MAX_EQUIPPED_PARTS } from '../engine/run';
import { BattleEndOverlay } from './BattleEndOverlay';
import { getUiPrefs } from '../engine/uiPrefs';

// 参考画像の S/A/C 表記に合わせた、Excelレア度の1文字表現。
const RARITY_RANK: Record<string, string> = { Common: 'C', Rare: 'B', Epic: 'A', Legendary: 'S' };
import { playSE } from '../engine/soundManager';
import { recordBattleStart, recordCommandUse } from '../engine/metrics';

const INTRO_START_MS = 900;
const INTRO_ORDER_MS = 700;
const INTRO_ENEMY_FIRST_MS = 950;
const AUTO_DELAY_MS = 900;
// 自分の行動が終わってから敵が動くまでの「間」。敵が何をしたのか見て分かるようにするための溜め。
const ENEMY_BEAT_MS = 620;
const FLOATER_TTL_MS = 1000;
const SHAKE_MS = 240;

type FloaterKind = 'normal' | 'evade' | 'burn' | 'poison' | 'bleed' | 'counter' | 'delay' | 'haste' | 'heal';

interface Floater {
  id: number;
  side: 'player' | 'enemy';
  text: string;
  kind: FloaterKind;
  createdAt: number;
}

interface Toast {
  id: number;
  side: 'player' | 'enemy';
  label: string;
  createdAt: number;
}

export function BattleScreen({
  enemy,
  equippedParts,
  startingHp,
  startingMp,
  battleIndex,
  totalBattles,
  onExit,
}: {
  enemy: EnemyDef;
  equippedParts: PartDef[];
  startingHp?: number;
  startingMp?: number;
  battleIndex?: number;
  totalBattles?: number;
  onExit: (result: 'won' | 'lost', finalHp: number, finalMp: number) => void;
}) {
  const engineRef = useRef<CtbEngine | null>(null);
  const [snapshot, setSnapshot] = useState<CtbSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 開いている大カテゴリ。null = 4つの大ボタンを出している状態。
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  // 敵が何をしたかを見せる帯。行動の「間」に出る。
  const [enemyBanner, setEnemyBanner] = useState<string | null>(null);
  const beatTimersRef = useRef<number[]>([]);
  const [shakeOn, setShakeOn] = useState(false);
  const [telegraphBanner, setTelegraphBanner] = useState<string | null>(null);
  const floatersRef = useRef<Floater[]>([]);
  const toastsRef = useRef<Toast[]>([]);
  const floaterIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const attackFxRef = useRef<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const hitFxRef = useRef<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const [, forceTick] = useState(0);
  const endSePlayedRef = useRef(false);

  function processEvents(events: CtbEvent[]) {
    if (events.length === 0) return;
    const now = performance.now();
    for (const e of events) {
      if (e.type === 'attack') {
        floatersRef.current.push({ id: ++floaterIdRef.current, side: e.targetSide, text: `${e.damage}`, kind: 'normal', createdAt: now });
        attackFxRef.current[e.side] = now;
        hitFxRef.current[e.targetSide] = now;
        setShakeOn(true);
        setTimeout(() => setShakeOn(false), SHAKE_MS);
        playSE('attack');
      } else if (e.type === 'evade') {
        floatersRef.current.push({ id: ++floaterIdRef.current, side: e.targetSide, text: 'MISS', kind: 'evade', createdAt: now });
        playSE('evade');
      } else if (e.type === 'counter') {
        floatersRef.current.push({ id: ++floaterIdRef.current, side: e.targetSide, text: `🔁${e.damage}`, kind: 'counter', createdAt: now });
        hitFxRef.current[e.targetSide] = now;
        setShakeOn(true);
        setTimeout(() => setShakeOn(false), SHAKE_MS);
      } else if (e.type === 'status_tick') {
        floatersRef.current.push({
          id: ++floaterIdRef.current,
          side: e.side,
          text: `${STATUS_LABEL[e.kind].icon}${e.damage}`,
          kind: e.kind,
          createdAt: now,
        });
      } else if (e.type === 'status_heal') {
        floatersRef.current.push({
          id: ++floaterIdRef.current,
          side: e.side,
          text: `${STATUS_LABEL[e.kind].icon}+${e.amount}`,
          kind: 'heal',
          createdAt: now,
        });
        playSE('heal');
      } else if (e.type === 'undying') {
        toastsRef.current.push({ id: ++toastIdRef.current, side: e.side, label: '🌟 致死ダメージを耐えた！', createdAt: now });
      } else if (e.type === 'extra_action') {
        toastsRef.current.push({ id: ++toastIdRef.current, side: e.side, label: '🌀 即座にもう一度行動！', createdAt: now });
      } else if (e.type === 'status_apply') {
        toastsRef.current.push({ id: ++toastIdRef.current, side: e.side, label: `${STATUS_LABEL[e.kind].icon} ${STATUS_LABEL[e.kind].name}`, createdAt: now });
        playSE('status');
      } else if (e.type === 'delay_enemy') {
        const targetSide = e.side === 'player' ? 'enemy' : 'player';
        floatersRef.current.push({ id: ++floaterIdRef.current, side: targetSide, text: `⏳+${e.amount}`, kind: 'delay', createdAt: now });
      } else if (e.type === 'haste_self') {
        floatersRef.current.push({ id: ++floaterIdRef.current, side: e.side, text: '🌀加速', kind: 'haste', createdAt: now });
      } else if (e.type === 'wait') {
        toastsRef.current.push({ id: ++toastIdRef.current, side: e.side, label: '⏸️ 待機', createdAt: now });
      } else if (e.type === 'charge') {
        toastsRef.current.push({ id: ++toastIdRef.current, side: e.side, label: '🔋 チャージ', createdAt: now });
      } else if (e.type === 'guard') {
        toastsRef.current.push({ id: ++toastIdRef.current, side: e.side, label: '🛡️ 防御', createdAt: now });
        playSE('guard');
      } else if (e.type === 'telegraph') {
        setTelegraphBanner(e.message);
        setTimeout(() => setTelegraphBanner((cur) => (cur === e.message ? null : cur)), 1100);
      }
    }
    floatersRef.current = floatersRef.current.filter((f) => now - f.createdAt < FLOATER_TTL_MS).slice(-24);
    toastsRef.current = toastsRef.current.filter((t) => now - t.createdAt < FLOATER_TTL_MS).slice(-8);
  }

  // 仕様書4章: BATTLE START → 初期行動順表示 → (敵先制ならENEMY FIRST告知) → 最初の行動、
  // という段階的な戦闘開始シーケンス。engine自体はタイマーを持たない状態機械なので、
  // ここでsetTimeoutを使って各フェーズの遷移を演出込みで進める。
  useEffect(() => {
    const engine = new CtbEngine(enemy, equippedParts, startingHp, startingMp);
    engineRef.current = engine;
    endSePlayedRef.current = false;
    setEnemyBanner(null);
    beatTimersRef.current.forEach((t) => clearTimeout(t));
    beatTimersRef.current = [];
    recordBattleStart();
    floatersRef.current = [];
    toastsRef.current = [];
    setSelectedId(null);
    setSnapshot(engine.getSnapshot());
    processEvents(engine.drainEvents());

    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        engine.revealOrder();
        setSnapshot(engine.getSnapshot());
        timers.push(
          window.setTimeout(() => {
            engine.beginFirstTurn();
            setSnapshot(engine.getSnapshot());
            processEvents(engine.drainEvents());
            if (engine.getPhase() === 'enemy_first_announce') {
              timers.push(
                window.setTimeout(() => {
                  engine.resolveAnnouncedEnemyTurn();
                  setSnapshot(engine.getSnapshot());
                  processEvents(engine.drainEvents());
                }, INTRO_ENEMY_FIRST_MS)
              );
            }
          }, INTRO_ORDER_MS)
        );
      }, INTRO_START_MS)
    );

    return () => {
      timers.forEach((t) => clearTimeout(t));
      beatTimersRef.current.forEach((t) => clearTimeout(t));
      beatTimersRef.current = [];
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enemy, equippedParts]);

  // Phase 4: 決着がついた瞬間に一度だけ勝敗SEを鳴らす(statusが遷移した時のみ)。
  useEffect(() => {
    if (!snapshot || snapshot.status === 'ongoing') return;
    if (endSePlayedRef.current) return;
    endSePlayedRef.current = true;
    playSE(snapshot.status === 'won' ? 'victory' : 'defeat');
  }, [snapshot?.status]);

  // 演出(フローティング数字・トースト)の寿命管理。CTB自体は離散イベントだが表示の消滅だけは実時間で見る。
  useEffect(() => {
    let raf: number;
    function loop() {
      const now = performance.now();
      let changed = false;
      if (floatersRef.current.some((f) => now - f.createdAt >= FLOATER_TTL_MS)) {
        floatersRef.current = floatersRef.current.filter((f) => now - f.createdAt < FLOATER_TTL_MS);
        changed = true;
      }
      if (toastsRef.current.some((t) => now - t.createdAt >= FLOATER_TTL_MS)) {
        toastsRef.current = toastsRef.current.filter((t) => now - t.createdAt < FLOATER_TTL_MS);
        changed = true;
      }
      if (changed) forceTick((v) => v + 1);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 敵の行動を1つずつ、間を置いて進める。1手ごとに「敵が何をしたか」を出す。
  function runEnemyBeats() {
    const engine = engineRef.current;
    if (!engine || engine.getPhase() !== 'enemy_pending') return;
    const move = engine.getSnapshot().nextEnemyAction;
    if (move) setEnemyBanner(`${move.icon} ${enemy.name} の ${move.moveName}`);
    const t = window.setTimeout(() => {
      const eng = engineRef.current;
      if (!eng) return;
      const more = eng.stepEnemyTurn();
      processEvents(eng.drainEvents());
      setSnapshot(eng.getSnapshot());
      if (more) runEnemyBeats();
      else {
        const clear = window.setTimeout(() => setEnemyBanner(null), ENEMY_BEAT_MS);
        beatTimersRef.current.push(clear);
      }
    }, ENEMY_BEAT_MS);
    beatTimersRef.current.push(t);
  }

  function executeCommand(commandId: string) {
    const engine = engineRef.current;
    if (!engine) return;
    // Phase 4: 攻撃イベント側は一律'attack'を鳴らすので、重量級コマンドだけここで
    // 一段重い音を先に重ねて、CT重量の差が耳でも分かるようにする。
    const cmd = getCommand(commandId);
    // stepwise: 自分の行動だけ解決し、敵の行動はrunEnemyBeats()が間を置いて進める。
    const result = engine.useCommand(commandId, { stepwise: true });
    if (result.ok) {
      recordCommandUse(commandId); // Phase 6: 計測(読み取り専用。戦闘には影響しない)
      if (cmd && (cmd.ctWeight === 'heavy' || cmd.ctWeight === 'very_heavy')) playSE('heavy');
      processEvents(engine.drainEvents());
      setSelectedId(null);
      // 設定で「実行後にカテゴリへ戻す」がONのときだけ畳む。既定は開いたまま。
      if (getUiPrefs().returnToCategories) setOpenCategory(null);
      setSnapshot(engine.getSnapshot());
      runEnemyBeats();
      return;
    }
    setSnapshot(engine.getSnapshot());
  }

  // 仕様書22章: AUTO ONならプレイヤーターンになったら一定時間後に自動でコマンドを選ぶ。
  useEffect(() => {
    if (!snapshot) return;
    if (!snapshot.autoMode || snapshot.status !== 'ongoing' || snapshot.phase !== 'player_turn') return;
    const t = setTimeout(() => {
      const engine = engineRef.current;
      if (!engine) return;
      executeCommand(engine.decideAutoCommand().id);
    }, AUTO_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  function openCategoryPanel(catId: string) {
    setOpenCategory(catId);
    setSelectedId(null);
  }
  function closeCategoryPanel() {
    setOpenCategory(null);
    setSelectedId(null);
  }

  function handleCommandTap(commandId: string, usable: boolean) {
    // 敵の行動を見せている間は入力を受けない(演出を飛ばして先に進んでしまうのを防ぐ)
    if (engineRef.current?.getPhase() === 'enemy_pending') return;
    if (!usable) return;
    if (selectedId === commandId) executeCommand(commandId);
    else setSelectedId(commandId);
  }

  function toggleAuto() {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setAutoMode(!engine.getAutoMode());
    setSnapshot(engine.getSnapshot());
  }

  // 解放済みコマンドを4つの大カテゴリへ振り分ける(Excelの系統列そのまま)。
  const commandsByCategory = useMemo(() => {
    const out: Record<string, CommandPreviewInfo[]> = {};
    for (const cat of COMMAND_CATEGORIES) out[cat.id] = [];
    for (const cmd of snapshot?.commands ?? []) out[categoryIdForCommand(cmd.category)]?.push(cmd);
    // 使えるものを先に、その中はMPの安い順(手が届くものから目に入るように)
    for (const id of Object.keys(out)) {
      out[id].sort((a, b) => Number(b.usable) - Number(a.usable) || a.mpCost - b.mpCost);
    }
    return out;
  }, [snapshot]);

  const previewOrder = useMemo(() => engineRef.current?.previewOrder(selectedId) ?? [], [selectedId, snapshot]);

  if (!snapshot) return <div className="app-root">戦闘を準備中...</div>;

  const order = previewOrder.length > 0 ? previewOrder : snapshot.order;

  const fxNow = performance.now();
  const playerAttackFx = fxNow - attackFxRef.current.player < 200;
  const enemyAttackFx = fxNow - attackFxRef.current.enemy < 200;
  const playerHitFx = fxNow - hitFxRef.current.player < 240;
  const enemyHitFx = fxNow - hitFxRef.current.enemy < 240;

  return (
    <div className="battle-screen">
      {/* 参考画像に寄せたヘッダ: 進行度をドットで示し、右に設定を置く */}
      <header className="bt-header">
        <div className="bt-header__logo">
          <span className="bt-header__logo-mark">🧬</span>
          <span className="bt-header__logo-text">キメラバトル</span>
        </div>
        <div className="bt-progress">
          <div className="bt-progress__label">
            第{battleIndex ?? 1}戦 / 全{totalBattles ?? 7}戦
          </div>
          <div className="bt-progress__dots">
            {Array.from({ length: totalBattles ?? 7 }, (_, i) => (
              <span
                key={i}
                className={`bt-dot${i + 1 < (battleIndex ?? 1) ? ' bt-dot--done' : ''}${
                  i + 1 === (battleIndex ?? 1) ? ' bt-dot--now' : ''
                }${i + 1 === (totalBattles ?? 7) ? ' bt-dot--boss' : ''}`}
              />
            ))}
          </div>
          <div className="bt-progress__turn">TURN {snapshot.turnCount}</div>
        </div>
      </header>

      {/* 両者のステータスを上部に並べる(名前・HP・MP・状態異常) */}
      <div className="bt-status">
        <div className="bt-card bt-card--player">
          <div className="bt-card__name">
            <span className="bt-card__badge">🧬</span>キメラ
          </div>
          <div className="bt-gauge bt-gauge--hp">
            <div className="bt-gauge__fill bt-gauge__fill--player" style={{ width: `${(snapshot.player.hp / snapshot.player.maxHp) * 100}%` }} />
            <div className="bt-gauge__text">
              {snapshot.player.hp} / {snapshot.player.maxHp}
            </div>
          </div>
          <div className="bt-mp">
            <span className="bt-mp__label">MP</span>
            <div className="bt-mp__track">
              <div className="bt-mp__fill" style={{ width: `${(snapshot.mp.current / snapshot.mp.max) * 100}%` }} />
            </div>
            <span className="bt-mp__num">
              {snapshot.mp.current} / {snapshot.mp.max}
            </span>
          </div>
          <div className="bt-chips">
            {snapshot.player.guardActive && <span className="bt-chip bt-chip--guard" title="防御中">🛡️</span>}
            {snapshot.player.chargeActive && <span className="bt-chip" title="チャージ中">🔋</span>}
            {snapshot.player.statuses.map((st) => (
              <span key={st.kind} className="bt-chip" title={`${STATUS_LABEL[st.kind].name} 残り${st.turnsLeft}ターン`}>
                {STATUS_LABEL[st.kind].icon}
                <i>{st.turnsLeft}</i>
              </span>
            ))}
          </div>
        </div>

        <div className="bt-card bt-card--enemy">
          <div className="bt-card__name">
            <span className="bt-card__badge">{enemy.icon}</span>
            {snapshot.enemy.name}
          </div>
          <div className="bt-gauge bt-gauge--hp">
            <div className="bt-gauge__fill bt-gauge__fill--enemy" style={{ width: `${(snapshot.enemy.hp / snapshot.enemy.maxHp) * 100}%` }} />
            <div className="bt-gauge__text">
              {snapshot.enemy.hp} / {snapshot.enemy.maxHp}
            </div>
          </div>
          <div className="bt-enemy-intent">
            {snapshot.nextEnemyAction ? (
              <>
                {snapshot.nextEnemyAction.icon} {snapshot.nextEnemyAction.moveName}
                <span className="bt-intent-tag">{ENEMY_INTENT_LABEL[snapshot.nextEnemyAction.intent]}</span>
              </>
            ) : (
              <span className="muted">—</span>
            )}
          </div>
          <div className="bt-chips">
            {snapshot.enemy.statuses.map((st) => (
              <span key={st.kind} className="bt-chip bt-chip--enemy" title={`${STATUS_LABEL[st.kind].name} 残り${st.turnsLeft}ターン`}>
                {STATUS_LABEL[st.kind].icon}
                <i>{st.turnsLeft}</i>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={`stage${shakeOn ? ' stage--shake' : ''}`}>
        {(snapshot.phase === 'battle_start' || snapshot.phase === 'enemy_first_announce') && (
          <div className="intro-overlay">
            {snapshot.phase === 'battle_start' ? (
              <div className="intro-overlay__title">BATTLE START</div>
            ) : (
              <>
                <div className="intro-overlay__title intro-overlay__title--enemy">ENEMY FIRST</div>
                {snapshot.enemyFirstAnnounce && (
                  <div className="intro-overlay__sub">
                    {snapshot.enemyFirstAnnounce.icon} {snapshot.enemyFirstAnnounce.moveName}
                    {snapshot.enemyFirstAnnounce.telegraph ? ` — ${snapshot.enemyFirstAnnounce.telegraph}` : ''}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="stage__combatants">
          <div className="combatant combatant--player">
            {/* Phase 3: 装着部位を見た目へ反映する(表示専用。戦闘ロジックには影響しない)。
                素材が読めない場合はChimeraFigure内で従来の🧬表示へフォールバックする。 */}
            <ChimeraFigure
              equippedParts={equippedParts}
              attackFx={playerAttackFx}
              hitFx={playerHitFx}
              isDead={snapshot.player.isDead}
            />
            {snapshot.player.isDead && <div className="combatant__ko">機能停止</div>}
          </div>

          <div className="stage__vs">VS</div>

          <div className="combatant combatant--enemy">
            <div className={`combatant__figure${enemyAttackFx ? ' combatant__figure--attack' : ''}${enemyHitFx ? ' combatant__figure--hit' : ''}`}>{enemy.icon}</div>
            {snapshot.enemy.isDead && <div className="combatant__ko">撃破</div>}
          </div>
        </div>

        <div className="floater-layer">
          {floatersRef.current.map((f) => (
            <div key={f.id} className={`floater floater--${f.side} floater--${f.kind}`}>
              {f.text}
            </div>
          ))}
        </div>

        <div className="toast-layer">
          {toastsRef.current.map((t) => (
            <div key={t.id} className={`toast toast--${t.side}`}>
              {t.label}
            </div>
          ))}
        </div>

        {telegraphBanner && <div className="telegraph-banner">⚠️ {telegraphBanner}</div>}
        {enemyBanner && <div className="enemy-turn-banner">{enemyBanner}</div>}

        {/* 戦闘画面の左下=ログ、右下=AUTO。どちらも小さく置いて盤面を邪魔しない。 */}
        <button type="button" className="stage-btn stage-btn--log" onClick={() => setShowLog(true)}>
          📜 ログ
        </button>
        <button
          type="button"
          className={`stage-btn stage-btn--auto${snapshot.autoMode ? ' stage-btn--on' : ''}`}
          onClick={toggleAuto}
        >
          🤖 AUTO {snapshot.autoMode ? 'ON' : 'OFF'}
        </button>

        {snapshot.status !== 'ongoing' && (
          <BattleEndOverlay
            won={snapshot.status === 'won'}
            enemyIcon={enemy.icon}
            enemyName={enemy.name}
            turnCount={snapshot.turnCount}
            hp={snapshot.player.hp}
            maxHp={snapshot.player.maxHp}
            mp={snapshot.mp.current}
            maxMp={snapshot.mp.max}
            onDismiss={() =>
              onExit(
                snapshot.status === 'won' ? 'won' : 'lost',
                engineRef.current?.getFinalPlayerHp() ?? 0,
                engineRef.current?.getFinalPlayerMp() ?? 0
              )
            }
          />
        )}
      </div>

      {/* 行動順: 参考画像に合わせて番号 + PLAYER/ENEMY を明示する */}
      <div className="bt-order">
        <div className="bt-order__title">行動順</div>
        <div className="bt-order__track">
          {order.map((slot, i) => (
            <div key={i} className={`bt-slot bt-slot--${slot.side}${i === 0 ? ' bt-slot--now' : ''}`}>
              <span className="bt-slot__no">{String(i + 1).padStart(2, '0')}</span>
              <span className="bt-slot__icon">{slot.side === 'player' ? '🧬' : enemy.icon}</span>
              {slot.telegraph && <span className="bt-slot__warn">⚠️</span>}
              <span className="bt-slot__side">{slot.side === 'player' ? 'PLAYER' : 'ENEMY'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ============================================================
          コマンド操作は3段階。
            1. 4つの大カテゴリ(常時この4枚だけ。スクロールしない)
            2. カテゴリをタップ → その系統のコマンドが横スクロールで出る
            3. コマンドをタップ → 同じ位置・同じ大きさのまま詳細に切り替わる
               もう一度タップで実行(2タップ実行の操作感は従来どおり)
          ============================================================ */}
      <div className="cmd-panel">
        {openCategory === null ? (
          <div className="cmd-cats">
            {COMMAND_CATEGORIES.map((cat) => {
              const list = commandsByCategory[cat.id] ?? [];
              const anyUsable = list.some((c) => c.usable);
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`cmd-cat cmd-cat--${cat.id}${anyUsable ? '' : ' cmd-cat--empty'}`}
                  disabled={list.length === 0}
                  onClick={() => openCategoryPanel(cat.id)}
                >
                  <span className="cmd-cat__icon">{cat.icon}</span>
                  <span className="cmd-cat__label">{cat.label}</span>
                  <span className="cmd-cat__sub">{cat.sub}</span>
                  <span className="cmd-cat__count">{list.length}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="cmd-list-wrap">
            <button type="button" className="cmd-back" onClick={closeCategoryPanel}>
              ‹
            </button>
            <div className="cmd-list">
              {(commandsByCategory[openCategory] ?? []).map((cmd) => {
                const isSelected = selectedId === cmd.id;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    disabled={!cmd.usable}
                    onClick={() => handleCommandTap(cmd.id, cmd.usable)}
                    className={`cmd-card${cmd.usable ? ' cmd-card--usable' : ''}${isSelected ? ' cmd-card--detail' : ''}`}
                  >
                    {isSelected ? (
                      // 詳細はカードと同じ枠の中で差し替える(位置もサイズも動かさない)
                      <span className="cmd-card__detail">
                        <span className="cmd-card__detail-name">{cmd.name}</span>
                        <span className="cmd-card__stats">
                          {cmd.damageEstimate !== null && <span className="cmd-card__stat cmd-card__stat--dmg">⚔{cmd.damageEstimate}</span>}
                          <span className="cmd-card__stat">🔷{cmd.mpCost}</span>
                          <span className="cmd-card__stat">{cmd.ctLabel}</span>
                          {cmd.applyStatusLabel && <span className="cmd-card__stat">{cmd.applyStatusLabel}</span>}
                        </span>
                        <span className="cmd-card__desc">{cmd.description}</span>
                        <span className="cmd-card__go">もう一度タップで実行</span>
                      </span>
                    ) : (
                      <>
                        <span className="cmd-card__icon">{cmd.icon}</span>
                        <span className="cmd-card__name">{cmd.name}</span>
                        <span className="cmd-card__cost">{cmd.mpCost > 0 ? `🔷${cmd.mpCost}` : 'FREE'}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>


      {showLog && (
        <div className="modal-backdrop" onClick={() => setShowLog(false)}>
          <div className="modal-card log-modal" onClick={(e) => e.stopPropagation()}>
            <h2>📜 戦闘ログ</h2>
            <div className="log-modal__body">
              {snapshot.log.map((line, i) => (
                <div key={`${i}-${line}`} className="log-modal__line">
                  {line}
                </div>
              ))}
              {snapshot.log.length === 0 && <p className="muted">まだ記録がありません。</p>}
            </div>
            <button type="button" className="btn btn--primary btn--block" onClick={() => setShowLog(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* 装備中のパーツ(参考画像の下段) */}
      <div className="bt-parts">
        <div className="bt-parts__head">
          <span>装備中のパーツ</span>
          <span className="bt-parts__cap">
            装着枠 {equippedParts.length} / {MAX_EQUIPPED_PARTS}
          </span>
        </div>
        <div className="bt-parts__row">
          {equippedParts.map((part) => (
            <div key={part.id} className={`bt-part bt-part--${part.rarity.toLowerCase()}`} title={`${part.name} — ${part.description}`}>
              <span className={`bt-part__rank bt-part__rank--${part.rarity.toLowerCase()}`}>{RARITY_RANK[part.rarity]}</span>
              <span className="bt-part__icon">{part.icon}</span>
              <span className="bt-part__type">{part.type}</span>
            </div>
          ))}
          {equippedParts.length === 0 && <span className="muted" style={{ fontSize: '0.6rem' }}>装着中の部位はありません</span>}
        </div>
      </div>

    </div>
  );
}
