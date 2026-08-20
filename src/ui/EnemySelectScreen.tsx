import { ENEMIES } from '../data/enemies';
import type { EnemyDef } from '../data/types';

export function EnemySelectScreen({ onPick }: { onPick: (enemy: EnemyDef) => void }) {
  return (
    <div className="select-screen">
      <h1>⏱️ キメラバトル CTB プロトタイプ</h1>
      <p className="select-screen__lead">
        行動順を見ながらコマンドを選ぶ検証用デモです。相手を選んで戦闘を開始してください。
        コマンドは1回タップで選択・詳細表示、もう一度同じコマンドをタップすると実行します。
      </p>
      {ENEMIES.map((e) => (
        <button key={e.id} type="button" className="enemy-pick" onClick={() => onPick(e)}>
          <div className="enemy-pick__head">
            <span className="enemy-pick__icon">{e.icon}</span>
            {e.name}
            <span className={`tier-badge tier-badge--${e.tier}`}>{e.tier === 'boss' ? 'BOSS' : e.tier === 'elite' ? 'ELITE' : 'NORMAL'}</span>
          </div>
          <div className="enemy-pick__desc">{e.description}</div>
          <div className="enemy-pick__stats">
            <span>❤️ HP {e.hp}</span>
            <span>⚔️ 攻撃 {e.power}</span>
            <span>💨 速度 {e.baseSpeed}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
