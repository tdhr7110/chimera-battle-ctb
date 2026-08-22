// ============================================================
// プロトタイプ専用: 敵表示(仕様書12章)。
// 敵は部位合成ではなく完成済み1枚絵。素材そのものが左向きのため反転は行わない。
// ============================================================
import { useState } from 'react';
import type { EnemyVisual } from './types';

export function EnemyFigure({ enemy, className }: { enemy: EnemyVisual | null; className?: string }) {
  const [failed, setFailed] = useState(false);

  if (!enemy) {
    return (
      <div className={`proto-enemy-figure proto-enemy-figure--empty${className ? ` ${className}` : ''}`}>❓</div>
    );
  }

  const src = `${import.meta.env.BASE_URL}${enemy.image}`;
  return (
    <div className={`proto-enemy-figure${className ? ` ${className}` : ''}`}>
      {failed ? (
        <div className="proto-enemy-figure__fallback">👾</div>
      ) : (
        <img
          src={src}
          alt={enemy.name}
          draggable={false}
          className="proto-enemy-figure__img"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
