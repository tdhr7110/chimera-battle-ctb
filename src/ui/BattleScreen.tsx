import { useEffect, useMemo, useRef, useState } from 'react';
import { CtbEngine, type CtbEvent, type CtbSnapshot } from '../engine/ctbEngine';
import type { EnemyDef, PartDef } from '../data/types';
import { ENEMY_INTENT_LABEL, STATUS_LABEL } from '../data/types';
import { ChimeraFigure } from './freeLayer/ChimeraFigure';
import { getCommand } from '../data/commands';
import { playSE } from '../engine/soundManager';
import { recordBattleStart, recordCommandUse } from '../engine/metrics';

const INTRO_START_MS = 900;
const INTRO_ORDER_MS = 700;
const INTRO_ENEMY_FIRST_MS = 950;
const AUTO_DELAY_MS = 900;
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
  onExit,
}: {
  enemy: EnemyDef;
  equippedParts: PartDef[];
  startingHp?: number;
  startingMp?: number;
  onExit: (result: 'won' | 'lost', finalHp: number, finalMp: number) => void;
}) {
  const engineRef = useRef<CtbEngine | null>(null);
  const [snapshot, setSnapshot] = useState<CtbSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  function executeCommand(commandId: string) {
    const engine = engineRef.current;
    if (!engine) return;
    // Phase 4: 攻撃イベント側は一律'attack'を鳴らすので、重量級コマンドだけここで
    // 一段重い音を先に重ねて、CT重量の差が耳でも分かるようにする。
    const cmd = getCommand(commandId);
    const result = engine.useCommand(commandId);
    if (result.ok) {
      recordCommandUse(commandId); // Phase 6: 計測(読み取り専用。戦闘には影響しない)
      if (cmd && (cmd.ctWeight === 'heavy' || cmd.ctWeight === 'very_heavy')) playSE('heavy');
      processEvents(engine.drainEvents());
      setSelectedId(null);
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

  function handleCommandTap(commandId: string, usable: boolean) {
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

  const previewOrder = useMemo(() => engineRef.current?.previewOrder(selectedId) ?? [], [selectedId, snapshot]);

  if (!snapshot) return <div className="app-root">戦闘を準備中...</div>;

  const order = previewOrder.length > 0 ? previewOrder : snapshot.order;
  const anySelected = selectedId !== null;

  const fxNow = performance.now();
  const playerAttackFx = fxNow - attackFxRef.current.player < 200;
  const enemyAttackFx = fxNow - attackFxRef.current.enemy < 200;
  const playerHitFx = fxNow - hitFxRef.current.player < 240;
  const enemyHitFx = fxNow - hitFxRef.current.enemy < 240;

  return (
    <div className="battle-screen">
      <header className="battle-header">
        <h1>
          ⏱️ CTB戦闘 <span className="badge">TURN {snapshot.turnCount}</span>
        </h1>
      </header>

      <div className="ctb-order">
        <div className="ctb-order__title">⏱ 行動順 (NOW → NEXT)</div>
        <div className="ctb-order__track">
          {order.map((slot, i) => (
            <div key={i} className={`ctb-order__slot ctb-order__slot--${slot.side}${i === 0 ? ' ctb-order__slot--now' : ''}`}>
              <span>{slot.side === 'player' ? '🧬' : enemy.icon}</span>
              {slot.telegraph && <span className="ctb-order__telegraph">⚠️</span>}
              {i === 0 ? <span className="ctb-order__now-label">NOW</span> : slot.intent && <span className="ctb-order__intent">{ENEMY_INTENT_LABEL[slot.intent]}</span>}
            </div>
          ))}
        </div>
        {snapshot.nextEnemyAction && (
          <div className="next-enemy-action">
            {enemy.icon}次の敵行動: {snapshot.nextEnemyAction.icon} {snapshot.nextEnemyAction.moveName}
            <span className="next-enemy-action__intent">{ENEMY_INTENT_LABEL[snapshot.nextEnemyAction.intent]}</span>
          </div>
        )}
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
            <div className="combatant__name">キメラ {snapshot.player.isDead && '（機能停止）'}</div>
            <div className="hp-bar">
              <div className="hp-bar__fill" style={{ width: `${(snapshot.player.hp / snapshot.player.maxHp) * 100}%`, background: 'var(--color-player)' }} />
              <div className="hp-bar__label">
                {snapshot.player.hp} / {snapshot.player.maxHp}
              </div>
            </div>
            <div className="combatant__badges">
              {snapshot.player.guardActive && <span title="防御中">🛡️</span>}
              {snapshot.player.chargeActive && <span title="チャージ中">🔋</span>}
              {snapshot.player.statuses.map((s) => (
                <span key={s.kind} title={`${STATUS_LABEL[s.kind].name} 残り${s.turnsLeft}ターン`}>
                  {STATUS_LABEL[s.kind].icon}
                  {s.turnsLeft}
                </span>
              ))}
            </div>
          </div>

          <div className="combatant combatant--enemy">
            <div className={`combatant__figure${enemyAttackFx ? ' combatant__figure--attack' : ''}${enemyHitFx ? ' combatant__figure--hit' : ''}`}>{enemy.icon}</div>
            <div className="combatant__name">
              {snapshot.enemy.name} {snapshot.enemy.isDead && '（撃破）'}
            </div>
            <div className="hp-bar">
              <div className="hp-bar__fill" style={{ width: `${(snapshot.enemy.hp / snapshot.enemy.maxHp) * 100}%`, background: 'var(--color-enemy)' }} />
              <div className="hp-bar__label">
                {snapshot.enemy.hp} / {snapshot.enemy.maxHp}
              </div>
            </div>
            <div className="combatant__badges">
              {snapshot.enemy.statuses.map((s) => (
                <span key={s.kind} title={`${STATUS_LABEL[s.kind].name} 残り${s.turnsLeft}ターン`}>
                  {STATUS_LABEL[s.kind].icon}
                  {s.turnsLeft}
                </span>
              ))}
            </div>
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

        {snapshot.status !== 'ongoing' && (
          <button
            type="button"
            className={`end-overlay end-overlay--${snapshot.status}`}
            onClick={() =>
              onExit(snapshot.status === 'won' ? 'won' : 'lost', engineRef.current?.getFinalPlayerHp() ?? 0, engineRef.current?.getFinalPlayerMp() ?? 0)
            }
          >
            <div className="end-overlay__text">{snapshot.status === 'won' ? '勝利！' : '敗北…'}</div>
            <div className="end-overlay__hint">タップして戻る</div>
          </button>
        )}
      </div>

      <div className="mp-bar" title="MPゲージ: 戦闘中は回復しない。コマンド発動に消費し、勝利後にまとめて回復する">
        <div className="mp-bar__fill" style={{ width: `${(snapshot.mp.current / snapshot.mp.max) * 100}%` }} />
        <div className="mp-bar__label">
          🔷MP {snapshot.mp.current} / {snapshot.mp.max}
        </div>
      </div>

      <div className="command-grid">
        {snapshot.commands.map((cmd) => {
          const isSelected = selectedId === cmd.id;
          return (
            <button
              key={cmd.id}
              type="button"
              disabled={!cmd.usable}
              onClick={() => handleCommandTap(cmd.id, cmd.usable)}
              className={`command${cmd.usable ? ' command--usable' : ''}${isSelected ? ' command--selected' : ''}${
                anySelected && !isSelected ? ' command--dimmed' : ''
              }`}
            >
              <span className="command__icon">{cmd.icon}</span>
              <span className="command__name">{cmd.name}</span>
              {isSelected && (
                <>
                  <div className="command__detail">
                    {cmd.damageEstimate !== null && <span className="command__stat">⚔️ {cmd.damageEstimate} DAMAGE</span>}
                    <span className="command__stat">🔷MP {cmd.mpCost}</span>
                    <span className="command__stat">次回：{cmd.ctLabel}</span>
                    {cmd.applyStatusLabel && <span className="command__stat">{cmd.applyStatusLabel}</span>}
                  </div>
                  <div className="command__detail-desc">{cmd.description}</div>
                  <div className="command__hint">もう一度タップで実行</div>
                </>
              )}
            </button>
          );
        })}
      </div>

      <div className="controls-row">
        <button className={`btn${snapshot.autoMode ? ' btn--active' : ''}`} onClick={toggleAuto}>
          🤖 AUTO{snapshot.autoMode ? ' ON' : ' OFF'}
        </button>
      </div>

      <div className="log-panel">
        {snapshot.log.slice(0, 10).map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}
