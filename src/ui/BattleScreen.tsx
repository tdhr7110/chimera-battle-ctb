import { useEffect, useRef, useState } from 'react';
import { CtbEngine, type CtbEvent, type CtbSnapshot } from '../engine/ctbEngine';
import type { EnemyDef } from '../data/types';

const INTRO_START_MS = 900;
const INTRO_ORDER_MS = 700;
const INTRO_ENEMY_FIRST_MS = 950;
const AUTO_DELAY_MS = 900;
const FLOATER_TTL_MS = 1000;
const SHAKE_MS = 240;

interface Floater {
  id: number;
  side: 'player' | 'enemy';
  text: string;
  kind: 'normal' | 'evade' | 'burn';
  createdAt: number;
}

export function BattleScreen({ enemy, onExit }: { enemy: EnemyDef; onExit: (result: 'won' | 'lost') => void }) {
  const engineRef = useRef<CtbEngine | null>(null);
  const [snapshot, setSnapshot] = useState<CtbSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shakeOn, setShakeOn] = useState(false);
  const [telegraphBanner, setTelegraphBanner] = useState<string | null>(null);
  const floatersRef = useRef<Floater[]>([]);
  const floaterIdRef = useRef(0);
  const attackFxRef = useRef<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const hitFxRef = useRef<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const [, forceTick] = useState(0);

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
      } else if (e.type === 'evade') {
        floatersRef.current.push({ id: ++floaterIdRef.current, side: e.targetSide, text: 'MISS', kind: 'evade', createdAt: now });
      } else if (e.type === 'burn_tick') {
        floatersRef.current.push({ id: ++floaterIdRef.current, side: e.side, text: `🔥${e.damage}`, kind: 'burn', createdAt: now });
      } else if (e.type === 'telegraph') {
        setTelegraphBanner(e.message);
        setTimeout(() => setTelegraphBanner((cur) => (cur === e.message ? null : cur)), 1100);
      }
    }
    floatersRef.current = floatersRef.current.filter((f) => now - f.createdAt < FLOATER_TTL_MS).slice(-24);
  }

  // 仕様書4章: BATTLE START → 初期行動順表示 → (敵先制ならENEMY FIRST告知) → 最初の行動、
  // という段階的な戦闘開始シーケンス。engine自体はタイマーを持たない状態機械なので、
  // ここでsetTimeoutを使って各フェーズの遷移を演出込みで進める。
  useEffect(() => {
    const engine = new CtbEngine(enemy);
    engineRef.current = engine;
    floatersRef.current = [];
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
  }, [enemy]);

  // 演出(フローティング数字)の寿命管理。CTB自体は離散イベントだが表示の消滅だけは実時間で見る。
  useEffect(() => {
    let raf: number;
    function loop() {
      const now = performance.now();
      if (floatersRef.current.some((f) => now - f.createdAt >= FLOATER_TTL_MS)) {
        floatersRef.current = floatersRef.current.filter((f) => now - f.createdAt < FLOATER_TTL_MS);
        forceTick((v) => v + 1);
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function executeCommand(commandId: string) {
    const engine = engineRef.current;
    if (!engine) return;
    const result = engine.useCommand(commandId);
    if (result.ok) {
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

  if (!snapshot) return <div className="app-root">戦闘を準備中...</div>;

  const order = engineRef.current?.previewOrder(selectedId) ?? snapshot.order;
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
        <button className="btn" onClick={() => onExit(snapshot.status === 'lost' ? 'lost' : 'won')} style={{ opacity: 0.7 }}>
          ✕
        </button>
      </header>

      <div className="ctb-order">
        <div className="ctb-order__title">⏱ 行動順 (NOW → NEXT)</div>
        <div className="ctb-order__track">
          {order.map((slot, i) => (
            <div key={i} className={`ctb-order__slot ctb-order__slot--${slot.side}${i === 0 ? ' ctb-order__slot--now' : ''}`}>
              <span>{slot.side === 'player' ? '🧬' : enemy.icon}</span>
              {slot.telegraph && <span className="ctb-order__telegraph">⚠️</span>}
              {i === 0 && <span className="ctb-order__now-label">NOW</span>}
            </div>
          ))}
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
            <div className={`combatant__figure${playerAttackFx ? ' combatant__figure--attack' : ''}${playerHitFx ? ' combatant__figure--hit' : ''}`}>🧬</div>
            <div className="combatant__name">キメラ {snapshot.player.isDead && '（機能停止）'}</div>
            <div className="hp-bar">
              <div className="hp-bar__fill" style={{ width: `${(snapshot.player.hp / snapshot.player.maxHp) * 100}%`, background: 'var(--color-player)' }} />
              <div className="hp-bar__label">
                {snapshot.player.hp} / {snapshot.player.maxHp}
              </div>
            </div>
            <div className="combatant__badges">
              {snapshot.player.guardActive && <span title="防御中">🛡️</span>}
              {snapshot.player.burnTurnsLeft > 0 && <span title="炎上中">🔥{snapshot.player.burnTurnsLeft}</span>}
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
            <div className="combatant__badges">{snapshot.enemy.burnTurnsLeft > 0 && <span title="炎上中">🔥{snapshot.enemy.burnTurnsLeft}</span>}</div>
          </div>
        </div>

        <div className="floater-layer">
          {floatersRef.current.map((f) => (
            <div key={f.id} className={`floater floater--${f.side} floater--${f.kind}`}>
              {f.text}
            </div>
          ))}
        </div>

        {telegraphBanner && <div className="telegraph-banner">⚠️ {telegraphBanner}</div>}

        {snapshot.status !== 'ongoing' && (
          <button
            type="button"
            className={`end-overlay end-overlay--${snapshot.status}`}
            onClick={() => onExit(snapshot.status === 'won' ? 'won' : 'lost')}
          >
            <div className="end-overlay__text">{snapshot.status === 'won' ? '勝利！' : '敗北…'}</div>
            <div className="end-overlay__hint">タップして戻る</div>
          </button>
        )}
      </div>

      <div className="metabolism-bar" title="代謝ゲージ: プレイヤーターン開始時に回復し、コマンド発動に消費する">
        <div className="metabolism-bar__fill" style={{ width: `${(snapshot.metabolism.current / snapshot.metabolism.max) * 100}%` }} />
        <div className="metabolism-bar__label">
          💧代謝 {snapshot.metabolism.current} / {snapshot.metabolism.max}
        </div>
      </div>

      <div className="command-grid">
        {snapshot.commands.map((cmd) => {
          const isSelected = selectedId === cmd.id;
          const isUltra = cmd.id === 'ultra';
          return (
            <button
              key={cmd.id}
              type="button"
              disabled={!cmd.usable}
              onClick={() => handleCommandTap(cmd.id, cmd.usable)}
              className={`command${cmd.usable ? ' command--usable' : ''}${isSelected ? ' command--selected' : ''}${
                anySelected && !isSelected ? ' command--dimmed' : ''
              }${isUltra && !isSelected ? ' command-grid__ultra' : ''}`}
            >
              <span className="command__icon">{cmd.icon}</span>
              <span className="command__name">{cmd.name}</span>
              {isSelected && (
                <>
                  <div className="command__detail">
                    {cmd.damageEstimate !== null && <span className="command__stat">⚔️ {cmd.damageEstimate} DAMAGE</span>}
                    <span className="command__stat">💧代謝 {cmd.metabolismCost}</span>
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
