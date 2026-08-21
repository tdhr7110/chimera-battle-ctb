import { useState } from 'react';
import { getEnemy } from '../data/enemies';
import { getEnemyDrop, RARE_DROP_CHANCE_PCT } from '../data/enemyDrops';
import { getPart } from '../data/parts';

// 仕様書30章: 敵選択画面の情報量を減らす。カードは常時表示ぶんを
// アイコン・名前・種別・危険度・主なドロップだけに絞り、それ以外(具体的な部位名・攻略メモ)は
// 折りたたみの中に入れて画面を縦に伸ばさない。
//
// Phase 1: 「主なドロップ」を常時表示に加えることで、敵選択が危険度だけでなく
// 「次にどのビルドを伸ばすか」の選択になるようにしている。
const TIER_DANGER: Record<string, string> = { normal: '★', elite: '★★', boss: '★★★' };
const TIER_LABEL: Record<string, string> = { normal: 'NORMAL', elite: 'ELITE', boss: 'BOSS' };

const MAX_LISTED_PARTS = 6;

export function EnemySelectScreen({ candidateIds, onPick }: { candidateIds: string[]; onPick: (enemyId: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="select-screen">
      <h1>⚔️ 次の相手を選択</h1>
      <p className="select-screen__lead">戦う相手を1体選んでください。落とす部位で次のビルドが決まります。</p>
      {candidateIds.map((id) => {
        const enemy = getEnemy(id);
        if (!enemy) return null;
        const drop = getEnemyDrop(id);
        const open = openId === id;
        const names = (ids: string[]) =>
          ids
            .slice(0, MAX_LISTED_PARTS)
            .map((pid) => getPart(pid))
            .filter((p) => !!p)
            .map((p) => `${p!.icon}${p!.name}`)
            .join('・');
        return (
          <div key={id} className="enemy-pick-wrap">
            <button type="button" className="enemy-pick" onClick={() => onPick(id)}>
              <div className="enemy-pick__head">
                <span className="enemy-pick__icon">{enemy.icon}</span>
                {enemy.name}
                <span className={`tier-badge tier-badge--${enemy.tier}`}>{TIER_LABEL[enemy.tier]}</span>
              </div>
              <div className="enemy-pick__stats">
                <span>危険度 {TIER_DANGER[enemy.tier]}</span>
                {drop && <span className="enemy-pick__drop">🎁 主なドロップ: {drop.dropSummary}</span>}
              </div>
            </button>
            <button
              type="button"
              className="enemy-pick__more"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : id)}
            >
              {open ? '▲ 詳細を閉じる' : '▼ 詳細'}
            </button>
            {open && drop && (
              <div className="enemy-pick__detail">
                <div className="enemy-pick__detail-row">
                  <span className="enemy-pick__detail-label">通常ドロップ</span>
                  <span>
                    {names(drop.bodyPartIds) || '—'}
                    {drop.bodyPartIds.length > MAX_LISTED_PARTS && ` ほか${drop.bodyPartIds.length - MAX_LISTED_PARTS}種`}
                  </span>
                </div>
                <div className="enemy-pick__detail-row">
                  <span className="enemy-pick__detail-label">レア({RARE_DROP_CHANCE_PCT[enemy.tier]}%)</span>
                  <span>
                    {names(drop.rareDropPartIds) || '—'}
                    {drop.rareDropPartIds.length > MAX_LISTED_PARTS && ` ほか${drop.rareDropPartIds.length - MAX_LISTED_PARTS}種`}
                  </span>
                </div>
                <div className="enemy-pick__detail-desc">{enemy.description}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
