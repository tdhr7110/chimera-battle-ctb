// ============================================================
// プロトタイプ専用: 簡易バトル表示テスト画面(仕様書13章)。
// 本番のBattleScreen/CtbEngineには一切関与しない、見た目サイズ確認だけの画面。
// 本番の .combatant__figure と近いサイズ感(min(112px, 30vw)相当)で並べて、
// 実際の戦闘UI上でキメラ/敵の画像サイズが適切かを見る。
// ============================================================
import { useMemo, useState } from 'react';
import { ChimeraCanvas } from './ChimeraCanvas';
import { EnemyFigure } from './EnemyFigure';
import { allEnemyVisuals, getEnemyVisual } from './manifest';
import type { ChimeraLoadout } from './types';

export function PrototypeBattlePreviewScreen({
  loadout,
  onBackToBuilder,
}: {
  loadout: ChimeraLoadout;
  onBackToBuilder: () => void;
}) {
  const enemies = useMemo(() => allEnemyVisuals(), []);
  const [enemyId, setEnemyId] = useState<string>(enemies[0]?.id ?? '');
  const enemy = getEnemyVisual(enemyId);

  function randomEnemy() {
    const pick = enemies[Math.floor(Math.random() * enemies.length)];
    if (pick) setEnemyId(pick.id);
  }

  return (
    <div className="proto-battle-preview">
      <div className="proto-builder__toolbar">
        <button type="button" className="proto-btn proto-btn--ghost" onClick={onBackToBuilder}>
          ← ビルダーへ戻る
        </button>
        <div className="proto-builder__toolbar-right">
          <select
            className="proto-enemy-select"
            value={enemyId}
            onChange={(e) => setEnemyId(e.target.value)}
          >
            {enemies.map((e) => (
              <option key={e.id} value={e.id}>
                {e.id} {e.name} [{e.tier}]
              </option>
            ))}
          </select>
          <button type="button" className="proto-btn proto-btn--ghost" onClick={randomEnemy}>
            🎲 敵ランダム
          </button>
        </div>
      </div>

      <div className="proto-battle-stage">
        <div className="proto-battle-stage__side proto-battle-stage__side--player">
          <ChimeraCanvas loadout={loadout} facing="right" className="proto-battle-figure" />
          <div className="proto-battle-stage__caption">PLAYER →</div>
        </div>
        <div className="proto-battle-stage__vs">VS</div>
        <div className="proto-battle-stage__side proto-battle-stage__side--enemy">
          <EnemyFigure enemy={enemy} className="proto-battle-figure proto-battle-figure--enemy" />
          <div className="proto-battle-stage__caption">← ENEMY</div>
        </div>
      </div>
      <p className="proto-battle-preview__note">
        本番BattleScreenの .combatant__figure と近いサイズ感(min(112px, 30vw))で表示しています。実際の戦闘画面サイズでの見え方確認用です。
      </p>
    </div>
  );
}
