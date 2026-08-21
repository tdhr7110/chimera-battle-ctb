export function ResultScreen({ outcome, battleIndex, totalBattles, onRestart }: { outcome: 'victory' | 'defeat'; battleIndex: number; totalBattles: number; onRestart: () => void }) {
  return (
    <div className="result-screen">
      <div className={`result-screen__title result-screen__title--${outcome}`}>{outcome === 'victory' ? '🎉 CLEAR!' : '💀 GAME OVER'}</div>
      <div className="result-screen__sub">
        {outcome === 'victory' ? `全${totalBattles}戦を制覇した！` : `第${battleIndex}戦で力尽きた…`}
      </div>
      <button type="button" className="btn btn--primary btn--block" onClick={onRestart}>
        タイトルへ戻る
      </button>
    </div>
  );
}
