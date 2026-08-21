import { useState } from 'react';
import { getEnemy } from '../data/enemies';
import { getPart } from '../data/parts';
import { AcquireBurst, type BurstTone } from './AcquireBurst';
import { playSE } from '../engine/soundManager';

// ============================================================
// 仕様書35章: Vampire Survivors系の「中央報酬選択」を参考にした部位獲得画面。
// 背景を暗くし、中央に候補部位を並べる。取得後は確認画面を挟まず即座に
// 待機画面へ戻す(仕様書37章: 不要な中間画面を作らない)。
//
// Phase 1: 候補は「倒した敵が落とす部位」から抽選済み(engine/run.ts の rollDropCandidates)。
// この画面は抽選を一切行わず、確定済みのIDを描画するだけ(再描画で候補が変わらない)。
// ============================================================

export function RewardScreen({
  candidateIds,
  fromEnemyId,
  onAccept,
  onSkip,
}: {
  candidateIds: string[];
  fromEnemyId: string | null;
  onAccept: (partId: string) => void;
  onSkip: () => void;
}) {
  const enemy = fromEnemyId ? getEnemy(fromEnemyId) : undefined;
  // 選んだ瞬間に画面遷移せず、まず獲得演出を挟む。
  const [celebrating, setCelebrating] = useState<string | null>(null);
  const celebrated = celebrating ? getPart(celebrating) : undefined;

  if (celebrated) {
    return (
      <AcquireBurst
        tone={celebrated.rarity.toLowerCase() as BurstTone}
        icon={celebrated.icon}
        title={celebrated.name}
        subtitle={`${celebrated.type} ・ ${celebrated.tags.join(' / ')}`}
        badge={celebrated.rarity}
        banner="部位を獲得！"
        hint="タップして次へ"
        autoAdvanceMs={2400}
        onDone={() => onAccept(celebrated.id)}
      >
        <div className="burst__desc">{celebrated.description}</div>
      </AcquireBurst>
    );
  }
  return (
    <div className="reward-screen">
      <div className="reward-screen__title">🎁 部位を獲得</div>
      <div className="reward-screen__sub">
        {enemy ? `${enemy.icon} ${enemy.name} の部位から1個選んでください` : '1個選んでください'}
      </div>
      <div className="reward-grid">
        {candidateIds.map((id) => {
          const part = getPart(id);
          if (!part) return null;
          return (
            <button
              key={id}
              type="button"
              className={`reward-card reward-card--${part.rarity.toLowerCase()}`}
              onClick={() => {
                playSE('part');
                setCelebrating(id);
              }}
            >
              <div className="reward-card__icon">{part.icon}</div>
              <div className="reward-card__name">{part.name}</div>
              <div className="reward-card__type">
                {part.type}
                <span className={`rarity-badge rarity-badge--${part.rarity.toLowerCase()}`}>{part.rarity}</span>
              </div>
              <div className="reward-card__desc">{part.description}</div>
            </button>
          );
        })}
        {candidateIds.length === 0 && <p className="muted">候補部位がありません(すべて入手済みです)。</p>}
      </div>
      <button type="button" className="btn" onClick={onSkip}>
        どれも受け取らない
      </button>
    </div>
  );
}
