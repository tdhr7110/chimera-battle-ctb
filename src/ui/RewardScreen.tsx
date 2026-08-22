import { useState } from 'react';
import { getEnemy } from '../data/enemies';
import { getPart } from '../data/parts';
import { AcquireBurst, type BurstTone } from './AcquireBurst';
import { playSE } from '../engine/soundManager';
import type { PartRarity } from '../data/types';

// カード左上に出す1文字のランク。レア度の序列を色だけに頼らず示す。
const RARITY_RANK_LABEL: Record<PartRarity, string> = { Common: 'C', Rare: 'B', Epic: 'A', Legendary: 'S' };
const RARITY_RANK: Record<PartRarity, number> = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 };

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
  // 一番レア度の高い候補にだけ光の柱を立てる(どれが当たりかを一目で分からせる)。
  const topRarity = candidateIds
    .map((id) => getPart(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .reduce<PartRarity>((m, p) => (RARITY_RANK[p.rarity] > RARITY_RANK[m] ? p.rarity : m), 'Common');

  return (
    <div className="reward-screen">
      {/* 背後で回り続ける光条。カードを引く瞬間の「当たりを引く」感を出すためだけの飾り。 */}
      <div className="reward-screen__rays" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} style={{ transform: `rotate(${i * 36}deg)` }} />
        ))}
      </div>

      <div className="reward-screen__head">
        <div className="reward-screen__title">🎁 部位を獲得</div>
        <div className="reward-screen__sub">
          {enemy ? `${enemy.icon} ${enemy.name} の部位から1個選んでください` : '1個選んでください'}
        </div>
      </div>

      <div className="reward-grid">
        {candidateIds.map((id, i) => {
          const part = getPart(id);
          if (!part) return null;
          const rarity = part.rarity.toLowerCase();
          const isTop = part.rarity === topRarity && RARITY_RANK[part.rarity] >= RARITY_RANK.Epic;
          return (
            <button
              key={id}
              type="button"
              className={`reward-card reward-card--${rarity}${isTop ? ' reward-card--top' : ''}`}
              style={{ animationDelay: `${120 + i * 130}ms` }}
              onClick={() => {
                playSE('part');
                setCelebrating(id);
              }}
            >
              <span className="reward-card__sheen" aria-hidden />
              <div className="reward-card__rank" aria-hidden>{RARITY_RANK_LABEL[part.rarity]}</div>
              <div className="reward-card__icon">{part.icon}</div>
              <div className="reward-card__name">{part.name}</div>
              <div className="reward-card__type">
                {part.type}
                <span className={`rarity-badge rarity-badge--${rarity}`}>{part.rarity}</span>
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
