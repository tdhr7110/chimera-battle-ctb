import { getPart } from '../data/parts';

// ============================================================
// 仕様書35章: Vampire Survivors系の「中央報酬選択」を参考にした部位獲得画面。
// 背景を暗くし、中央に候補部位を並べる。取得後は確認画面を挟まず即座に
// 待機画面へ戻す(仕様書37章: 不要な中間画面を作らない)。
// ============================================================

export function RewardScreen({ candidateIds, onAccept, onSkip }: { candidateIds: string[]; onAccept: (partId: string) => void; onSkip: () => void }) {
  return (
    <div className="reward-screen">
      <div className="reward-screen__title">🎁 部位を獲得</div>
      <div className="reward-screen__sub">1個選んでください</div>
      <div className="reward-grid">
        {candidateIds.map((id) => {
          const part = getPart(id);
          if (!part) return null;
          return (
            <button key={id} type="button" className="reward-card" onClick={() => onAccept(id)}>
              <div className="reward-card__icon">{part.icon}</div>
              <div className="reward-card__name">{part.name}</div>
              <div className="reward-card__type">{part.type}</div>
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
