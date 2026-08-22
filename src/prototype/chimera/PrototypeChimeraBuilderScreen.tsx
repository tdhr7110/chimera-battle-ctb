// ============================================================
// プロトタイプ専用: キメラ作成画面(仕様書9・10・11・17章)。
// 本番のPrepScreen/BattleScreenとは完全に独立した検証用UI。
// ============================================================
import { useState } from 'react';
import { ChimeraCanvas } from './ChimeraCanvas';
import { partsForCategory, getPartVisual } from './manifest';
import { randomLoadout } from './randomChimera';
import { EMPTY_LOADOUT, SLOT_CATEGORIES, SLOT_LABEL, type ChimeraLoadout, type ChimeraSlotCategory } from './types';
import { SLOT_TO_EXCEL_CATEGORIES } from './excelCategoryMapping';

export function PrototypeChimeraBuilderScreen({
  loadout,
  onChangeLoadout,
  onGoToBattlePreview,
}: {
  loadout: ChimeraLoadout;
  onChangeLoadout: (next: ChimeraLoadout) => void;
  onGoToBattlePreview: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState<ChimeraSlotCategory>('head');
  const [showDebug, setShowDebug] = useState(false);
  const [showMapping, setShowMapping] = useState(false);

  function selectPart(category: ChimeraSlotCategory, partId: string | null) {
    onChangeLoadout({ ...loadout, [category]: partId });
  }

  const activePartId = loadout[activeCategory];
  const activePartVisual = getPartVisual(activePartId);
  const options = partsForCategory(activeCategory);

  return (
    <div className="proto-builder">
      <div className="proto-builder__toolbar">
        <button type="button" className="proto-btn proto-btn--ghost" onClick={onGoToBattlePreview}>
          ⚔️ バトルサイズ確認へ
        </button>
        <div className="proto-builder__toolbar-right">
          <button
            type="button"
            className={`proto-btn proto-btn--ghost${showMapping ? ' proto-btn--active' : ''}`}
            onClick={() => setShowMapping((v) => !v)}
          >
            🗂️ Excelカテゴリ対応表
          </button>
          <button
            type="button"
            className={`proto-btn proto-btn--ghost${showDebug ? ' proto-btn--active' : ''}`}
            onClick={() => setShowDebug((v) => !v)}
          >
            🧭 アンカー表示 {showDebug ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {showMapping && (
        <div className="proto-mapping">
          {SLOT_CATEGORIES.map((cat) => (
            <div key={cat} className="proto-mapping__row">
              <span className="proto-mapping__slot">
                {SLOT_LABEL[cat].icon} {SLOT_LABEL[cat].en}
              </span>
              <span className="proto-mapping__arrow">←</span>
              <span className="proto-mapping__excel">{SLOT_TO_EXCEL_CATEGORIES[cat].join(' / ')}</span>
            </div>
          ))}
        </div>
      )}

      <div className="proto-builder__preview">
        <ChimeraCanvas loadout={loadout} facing="right" showDebugAnchors={showDebug} className="proto-builder__canvas" />
        <div className="proto-builder__preview-actions">
          <button
            type="button"
            className="proto-btn proto-btn--primary"
            onClick={() => onChangeLoadout(randomLoadout())}
          >
            🎲 ランダム生成
          </button>
          <button type="button" className="proto-btn" onClick={() => onChangeLoadout({ ...EMPTY_LOADOUT })}>
            🗑️ 全解除
          </button>
        </div>
      </div>

      {showDebug && (
        <div className="proto-debug-panel">
          <div className="proto-debug-panel__title">DEBUG: {SLOT_LABEL[activeCategory].en}</div>
          {activePartVisual ? (
            <dl className="proto-debug-panel__grid">
              <dt>Part ID</dt>
              <dd>{activePartVisual.id}</dd>
              <dt>name</dt>
              <dd>{activePartVisual.name}</dd>
              <dt>excelCategory</dt>
              <dd>{activePartVisual.excelCategory}</dd>
              <dt>anchorX / anchorY</dt>
              <dd>
                {activePartVisual.anchorX} / {activePartVisual.anchorY}
              </dd>
              <dt>offsetX / offsetY</dt>
              <dd>
                {activePartVisual.offsetX ?? 0} / {activePartVisual.offsetY ?? 0}
              </dd>
              <dt>scale</dt>
              <dd>{activePartVisual.scale}</dd>
              <dt>zIndex</dt>
              <dd>{activePartVisual.zIndex}</dd>
              <dt>source size</dt>
              <dd>
                {activePartVisual.width} × {activePartVisual.height}px
              </dd>
            </dl>
          ) : (
            <div className="proto-debug-panel__empty">未装着(なし)</div>
          )}
        </div>
      )}

      <div className="proto-builder__tabs">
        {SLOT_CATEGORIES.map((cat) => {
          const equippedId = loadout[cat];
          return (
            <button
              key={cat}
              type="button"
              className={`proto-tab${cat === activeCategory ? ' proto-tab--active' : ''}${equippedId ? ' proto-tab--filled' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              <span className="proto-tab__icon">{SLOT_LABEL[cat].icon}</span>
              <span className="proto-tab__label">{SLOT_LABEL[cat].jp}</span>
            </button>
          );
        })}
      </div>

      <div className="proto-builder__options">
        <button
          type="button"
          className={`proto-option proto-option--none${activePartId === null ? ' proto-option--selected' : ''}`}
          onClick={() => selectPart(activeCategory, null)}
        >
          <div className="proto-option__thumb proto-option__thumb--none">なし</div>
          <div className="proto-option__label">未装着</div>
        </button>
        {options.map((part) => (
          <button
            key={part.id}
            type="button"
            className={`proto-option${activePartId === part.id ? ' proto-option--selected' : ''}`}
            onClick={() => selectPart(activeCategory, part.id)}
          >
            <div className="proto-option__thumb">
              <img
                src={`${import.meta.env.BASE_URL}${part.image}`}
                alt={part.name}
                draggable={false}
              />
            </div>
            <div className="proto-option__label">{part.id}</div>
            <div className="proto-option__sublabel">{part.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
