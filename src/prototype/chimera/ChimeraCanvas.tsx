// ============================================================
// プロトタイプ専用: 7スロット・キメラのレイヤー合成描画コンポーネント。
//
// Canvas焼き込みではなくHTMLの重ね合わせで実装している(仕様書14章)。
// 検証の結果、部位素材(頭・胴・前脚・後脚・羽・尻尾)はすべて右向きで描かれていることを
// 確認できた(敵シートは逆に左向きで統一されている)。そのため既定(facing='right')では
// 反転せずそのまま使い、必要なとき(facing='left')だけコンテナ全体をscaleX(-1)で反転する。
// 敵は完成済み1枚絵(仕様書12章)で、素材自体がすでに左向きのためそのまま使う。
// ============================================================
import { useState } from 'react';
import { computePartStyle, anchorDotPct } from './layout';
import { getPartVisual } from './manifest';
import { SLOT_CATEGORIES, SLOT_LABEL, type ChimeraLoadout } from './types';
import './chimeraCanvas.css';

export function ChimeraCanvas({
  loadout,
  facing = 'right',
  showDebugAnchors = false,
  className,
}: {
  loadout: ChimeraLoadout;
  facing?: 'right' | 'left';
  showDebugAnchors?: boolean;
  className?: string;
}) {
  const layers = SLOT_CATEGORIES.map((category) => {
    const part = getPartVisual(loadout[category]);
    if (!part) return null;
    const style = computePartStyle(part);
    return { category, part, style };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  layers.sort((a, b) => a.style.zIndex - b.style.zIndex);

  // 素材は右向きが基準。facing='left'を明示的に指定したときだけ全体を反転する。
  const mirrored = facing === 'left';

  return (
    <div className={`proto-chimera-canvas${className ? ` ${className}` : ''}`}>
      <div className="proto-chimera-canvas__flip" style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}>
        {layers.map(({ category, part, style }) => (
          <ChimeraLayerImg
            key={category}
            src={part.image}
            alt={part.name}
            style={{
              left: `${style.leftPct}%`,
              top: `${style.topPct}%`,
              width: `${style.widthPct}%`,
              height: `${style.heightPct}%`,
              zIndex: style.zIndex,
            }}
          />
        ))}
        {showDebugAnchors && (
          <div className="proto-chimera-canvas__debug" aria-hidden>
            {SLOT_CATEGORIES.map((category) => {
              const pos = anchorDotPct(category);
              return (
                <div
                  key={category}
                  className="proto-chimera-canvas__anchor"
                  style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%` }}
                  title={`${SLOT_LABEL[category].en}_ANCHOR`}
                >
                  <span className="proto-chimera-canvas__anchor-label">{SLOT_LABEL[category].en}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {layers.length === 0 && <div className="proto-chimera-canvas__empty">部位未装着</div>}
    </div>
  );
}

function ChimeraLayerImg({ src, alt, style }: { src: string; alt: string; style: React.CSSProperties }) {
  const [failed, setFailed] = useState(false);
  const fullSrc = `${import.meta.env.BASE_URL}${src}`;
  if (failed) {
    return (
      <div className="proto-chimera-canvas__img-fallback" style={style} aria-hidden>
        ❓
      </div>
    );
  }
  return (
    <img
      src={fullSrc}
      alt={alt}
      draggable={false}
      className="proto-chimera-canvas__img"
      style={style}
      onError={() => setFailed(true)}
    />
  );
}
