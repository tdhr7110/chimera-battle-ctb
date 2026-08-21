import { getEnemy } from '../data/enemies';

// 仕様書30章: 敵選択画面の情報量を減らす。カードは画像(アイコン)・名前・種別・危険度のみ。
const TIER_DANGER: Record<string, string> = { normal: '★', elite: '★★', boss: '★★★' };
const TIER_LABEL: Record<string, string> = { normal: 'NORMAL', elite: 'ELITE', boss: 'BOSS' };

export function EnemySelectScreen({ candidateIds, onPick }: { candidateIds: string[]; onPick: (enemyId: string) => void }) {
  return (
    <div className="select-screen">
      <h1>⚔️ 次の相手を選択</h1>
      <p className="select-screen__lead">戦う相手を1体選んでください。</p>
      {candidateIds.map((id) => {
        const enemy = getEnemy(id);
        if (!enemy) return null;
        return (
          <button key={id} type="button" className="enemy-pick" onClick={() => onPick(id)}>
            <div className="enemy-pick__head">
              <span className="enemy-pick__icon">{enemy.icon}</span>
              {enemy.name}
              <span className={`tier-badge tier-badge--${enemy.tier}`}>{TIER_LABEL[enemy.tier]}</span>
            </div>
            <div className="enemy-pick__stats">
              <span>危険度 {TIER_DANGER[enemy.tier]}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
