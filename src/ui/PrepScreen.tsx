import { useMemo, useState } from 'react';
import { PARTS, getPart } from '../data/parts';
import { COMMANDS } from '../data/commands';
import { SYNERGIES } from '../data/synergies';
import { PLAYER_BASE } from '../engine/ctbEngine';
import { activeSynergies, commandUnlockProgress, computePlayerModifiers, isCommandUnlocked, synergyPartCount } from '../engine/modifiers';
import { CT_WEIGHT_LABEL } from '../data/types';
import { areaDefOfBattle, currentMaxHp, currentMaxMp, equippedPartDefs, maxEquippedParts, TOTAL_BATTLES, tierOfCurrentBattle, type RunState } from '../engine/run';

// ============================================================
// 統合版(本編)の戦闘待機/キメラビルド画面(仕様書3章)。
// ステータス・部位・シナジー・コマンドをタブで確認できる、ゲーム全体の中核画面。
// ============================================================

type Tab = 'status' | 'parts' | 'synergy' | 'commands';

const TIER_LABEL: Record<string, string> = { normal: '通常戦', elite: 'エリート戦', boss: 'ボス戦' };

export function PrepScreen({
  state,
  onEquip,
  onUnequip,
  onGoToEnemySelect,
  onCommandsTabOpened,
}: {
  state: RunState;
  onEquip: (partId: string) => void;
  onUnequip: (partId: string) => void;
  onGoToEnemySelect: () => void;
  onCommandsTabOpened: () => void;
}) {
  const [tab, setTab] = useState<Tab>('status');
  // Phase 2: コマンドタブを開いた時点でNEWを既読にする。既読化はRunState側で行うが、
  // 「今回のNEWがどれだったか」はタブを開いた瞬間の値を保持して表示に使う
  // (開いた途端にハイライトが全部消えてしまうと、どれが新しいのか分からなくなるため)。
  const [highlightIds, setHighlightIds] = useState<string[]>([]);

  function openTab(next: Tab) {
    if (next === 'commands' && tab !== 'commands') {
      setHighlightIds(state.newCommandIds);
      onCommandsTabOpened();
    }
    setTab(next);
  }

  const equippedDefs = useMemo(() => equippedPartDefs(state), [state.equippedPartIds]);
  const mods = useMemo(() => computePlayerModifiers(equippedDefs), [equippedDefs]);
  const activeSynergyIds = useMemo(() => activeSynergies(equippedDefs).map((s) => s.id), [equippedDefs]);
  // 接続枠は「基本12 + 枠を増やす部位のぶん」なので、装備を変えるたびに動く。
  const slotCap = useMemo(() => maxEquippedParts(state), [equippedDefs]);
  const unlockedCount = useMemo(() => COMMANDS.filter((c) => isCommandUnlocked(c, equippedDefs)).length, [equippedDefs]);

  const speed = Math.round(PLAYER_BASE.speed + mods.speedFlatBonus);
  const maxHp = currentMaxHp(state);
  const maxMp = currentMaxMp(state);
  const nextTier = TIER_LABEL[tierOfCurrentBattle(state)] ?? '通常戦';

  return (
    <div className="prep-screen">
      <header className="screen__header">
        <div>
          第{state.battleIndex}戦 / 全{TOTAL_BATTLES}戦（{nextTier}）
          <span className="prep-area">
            {areaDefOfBattle(state.battleIndex).icon} {areaDefOfBattle(state.battleIndex).name}
          </span>
        </div>
      </header>

      <div className="hp-bar hp-bar--large">
        <div className="hp-bar__fill" style={{ width: `${(state.coreHp / maxHp) * 100}%`, background: 'var(--color-player)' }} />
        <div className="hp-bar__label">
          🧬 コアHP {state.coreHp} / {maxHp}
        </div>
      </div>

      <div className="tab-row">
        <button className={`tab-btn${tab === 'status' ? ' tab-btn--active' : ''}`} onClick={() => openTab('status')}>
          ❤️ ステータス
        </button>
        <button className={`tab-btn${tab === 'parts' ? ' tab-btn--active' : ''}`} onClick={() => openTab('parts')}>
          🦴 部位
        </button>
        <button className={`tab-btn${tab === 'synergy' ? ' tab-btn--active' : ''}`} onClick={() => openTab('synergy')}>
          🔗 シナジー
        </button>
        <button className={`tab-btn${tab === 'commands' ? ' tab-btn--active' : ''}`} onClick={() => openTab('commands')}>
          ⚡ コマンド
          {state.newCommandIds.length > 0 && <span className="tab-btn__new">NEW</span>}
        </button>
      </div>

      <div className="tab-content">
        {tab === 'status' && (
          <div className="status-grid">
            <div className="status-row">
              <span>⚔️ 攻撃力</span>
              <strong>{PLAYER_BASE.power}</strong>
            </div>
            <div className="status-row">
              <span>🛡️ 防御力</span>
              <strong>{PLAYER_BASE.defense}</strong>
            </div>
            <div className="status-row">
              <span>💨 速度</span>
              <strong>{speed}</strong>
            </div>
            <div className="status-row">
              <span>🔷 MP</span>
              <strong>
                {Math.min(state.mp, maxMp)} / {maxMp}
              </strong>
            </div>
            <div className="status-row">
              <span>🎯 回避率</span>
              <strong>{PLAYER_BASE.evasionPct}%</strong>
            </div>
            <div className="status-row">
              <span>🦴 装着部位</span>
              <strong>
                {state.equippedPartIds.length} / {slotCap}
              </strong>
            </div>
          </div>
        )}

        {tab === 'parts' && (
          <div className="part-tab">
            <div className="part-tab__section-title">装着中({state.equippedPartIds.length}/{slotCap})</div>
            <div className="part-grid">
              {state.equippedPartIds.map((id) => {
                const part = getPart(id);
                if (!part) return null;
                return (
                  <button key={id} type="button" className="part-card part-card--selected" onClick={() => onUnequip(id)}>
                    <div className="part-card__head">
                      <span className="part-card__icon">{part.icon}</span>
                      {part.name}
                    </div>
                    <div className="part-card__desc">{part.description}</div>
                  </button>
                );
              })}
              {state.equippedPartIds.length === 0 && <p className="muted">装着中の部位はありません。</p>}
            </div>

            {state.inventoryPartIds.length > 0 && (
              <>
                <div className="part-tab__section-title">インベントリ(未装着)</div>
                <div className="part-grid">
                  {state.inventoryPartIds.map((id) => {
                    const part = getPart(id);
                    if (!part) return null;
                    const full = state.equippedPartIds.length >= slotCap;
                    return (
                      <button key={id} type="button" className="part-card" disabled={full} onClick={() => onEquip(id)} title={full ? '装着枠が空いていません' : '装着する'}>
                        <div className="part-card__head">
                          <span className="part-card__icon">{part.icon}</span>
                          {part.name}
                        </div>
                        <div className="part-card__desc">{part.description}</div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <p className="muted" style={{ fontSize: '0.65rem' }}>
              まだ入手していない部位は敵を倒した報酬で手に入ります(全{PARTS.length}種)。
            </p>
          </div>
        )}

        {tab === 'synergy' && (
          <div className="synergy-tab">
            {SYNERGIES.map((syn) => {
              const count = synergyPartCount(syn, equippedDefs);
              const active = activeSynergyIds.includes(syn.id);
              return (
                <div key={syn.id} className={`synergy-row${active ? ' synergy-row--active' : ''}`}>
                  <div className="synergy-row__head">
                    <strong>{syn.name}</strong>
                    <span>{count}個装着中</span>
                  </div>
                  <div className="synergy-row__desc">{syn.description}</div>
                  {syn.stages.map((stage, i) => {
                    const reached = count >= stage.threshold;
                    const remaining = Math.max(0, stage.threshold - count);
                    return (
                      <div key={i} className="synergy-row__status">
                        {reached ? '✅' : '🔒'} {stage.threshold}個{stage.ruleChangeLabel ? `: ${stage.ruleChangeLabel}` : ''}
                        {!reached && `（あと${remaining}個）`}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'commands' && (
          <div className="command-tab">
            <p className="muted" style={{ fontSize: '0.65rem' }}>
              同じタグの部位を集めるほど、その系統の深いコマンドが順に解放される({unlockedCount}/{COMMANDS.length}解放中)。
            </p>
            {COMMANDS.map((cmd) => {
              const unlocked = isCommandUnlocked(cmd, equippedDefs);
              const isNew = highlightIds.includes(cmd.id);
              return (
                <div
                  key={cmd.id}
                  className={`command-tab__row${unlocked ? '' : ' command-tab__row--locked'}${isNew ? ' command-tab__row--new' : ''}`}
                >
                  <span className="command-tab__icon">{unlocked ? cmd.icon : '🔒'}</span>
                  <div className="command-tab__body">
                    <div className="command-tab__name">
                      {cmd.name}
                      {isNew && <span className="command-tab__new">NEW</span>}
                    </div>
                    <div className="command-tab__desc">
                      {unlocked ? cmd.description : (() => {
                        const p = commandUnlockProgress(cmd, equippedDefs);
                        return p ? `「${p.tag}」タグの部位 ${p.have}/${p.need} 個で解放` : '解放条件不明';
                      })()}
                    </div>
                  </div>
                  <div className="command-tab__stats">
                    <span>🔷{cmd.mpCost}</span>
                    <span>{CT_WEIGHT_LABEL[cmd.ctWeight]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button type="button" className="btn btn--primary btn--block" onClick={onGoToEnemySelect}>
        ⚔️ 次の戦闘へ進む
      </button>
    </div>
  );
}
