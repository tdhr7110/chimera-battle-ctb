import { PARTS } from '../data/parts';
import { FUSION_PARTS } from '../data/fusions';
import { ENEMIES } from '../data/enemies';
import type { CodexState } from '../engine/codex';

// 仕様書3・28章: 戦闘待機画面から確認できる図鑑。未発見/未遭遇のものは中身を伏せて表示する。
export function CodexModal({ codex, onClose }: { codex: CodexState; onClose: () => void }) {
  // Phase 5: 融合部位はExcelの80部位ロスターの外にあるので、達成率は別々に数える
  // (混ぜると「81/80」のような表示になってしまう)。
  const partsFound = PARTS.filter((p) => codex.discoveredPartIds.includes(p.id)).length;
  const fusionsFound = FUSION_PARTS.filter((p) => codex.discoveredPartIds.includes(p.id)).length;
  const enemiesFound = codex.encounteredEnemyIds.length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card codex-modal" onClick={(e) => e.stopPropagation()}>
        <h2>
          📖 図鑑 <span className="muted" style={{ fontSize: '0.65rem' }}>(ランをリセットしても記録は消えません)</span>
        </h2>

        <div className="codex-section">
          <div className="codex-section__title">
            🦴 部位図鑑 ({partsFound}/{PARTS.length})
          </div>
          <div className="codex-grid">
            {PARTS.map((part) => {
              const found = codex.discoveredPartIds.includes(part.id);
              return (
                <div key={part.id} className={`codex-entry${found ? '' : ' codex-entry--locked'}`}>
                  <div className="codex-entry__icon">{found ? part.icon : '❔'}</div>
                  <div className="codex-entry__name">{found ? part.name : '？？？'}</div>
                  {found && <div className="codex-entry__desc">{part.description}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="codex-section">
          <div className="codex-section__title">
            🧪 融合部位 ({fusionsFound}/{FUSION_PARTS.length})
          </div>
          <div className="codex-grid">
            {FUSION_PARTS.map((part) => {
              const found = codex.discoveredPartIds.includes(part.id);
              return (
                <div key={part.id} className={`codex-entry${found ? '' : ' codex-entry--locked'}`}>
                  <div className="codex-entry__icon">{found ? part.icon : '❔'}</div>
                  <div className="codex-entry__name">{found ? part.name : '？？？'}</div>
                  {found && <div className="codex-entry__desc">{part.description}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="codex-section">
          <div className="codex-section__title">
            👹 敵図鑑 ({enemiesFound}/{ENEMIES.length})
          </div>
          <div className="codex-grid">
            {ENEMIES.map((enemy) => {
              const found = codex.encounteredEnemyIds.includes(enemy.id);
              const defeated = codex.defeatedEnemyIds.includes(enemy.id);
              return (
                <div key={enemy.id} className={`codex-entry${found ? '' : ' codex-entry--locked'}`}>
                  <div className="codex-entry__icon">{found ? enemy.icon : '❔'}</div>
                  <div className="codex-entry__name">
                    {found ? enemy.name : '？？？'}
                    {defeated && <span className="codex-entry__defeated"> ✅撃破済</span>}
                  </div>
                  {found && <div className="codex-entry__desc">{enemy.description}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
