// TEST11: 同一部位の複数装着(腕1〜6本など)が扇状に重ならず表示できるかを検証する
// 自由合体レイヤー表示コンポーネント。戦闘ロジック・能力計算には一切関与しない、見た目専用の表示。
import { useState } from 'react';
import type { CSSProperties } from 'react';
import './freeLayerCanvas.css';
import { CHIMERA_LAYERS_BASE } from './useLayerAssets';
import { computeLayerStyle, placeCategory } from './layoutMath';
import type { AnchorLayouts, LayerAsset, LayerManifest } from './types';

// 画像読み込み失敗時のフォールバック絵文字(カテゴリごと)。素材が本番配信で欠落していても
// キャラクター表示自体は崩れないようにする。
const CATEGORY_FALLBACK_ICON: Record<string, string> = {
  base: '🧬',
  arm: '💪',
  wing: '🪽',
  horn: '🦌',
  tail: '🦂',
  leg: '🦵',
  back: '✨',
  face: '😈',
  armor: '🛡️',
  organ: '🫀',
  eye: '👁️',
};

export interface FreeLayerFigureProps {
  manifest: LayerManifest;
  layouts: AnchorLayouts;
  counts: Record<string, number>;
  variants?: Record<string, string>;
  autoLayout?: boolean;
  showAnchorDebug?: boolean;
  className?: string;
}

function LayerImage({ asset, style }: { asset: LayerAsset; style: CSSProperties }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="free-layer__fallback" style={style} aria-hidden>
        {CATEGORY_FALLBACK_ICON[asset.category] ?? '❓'}
      </div>
    );
  }
  return (
    <img
      src={`${CHIMERA_LAYERS_BASE}${asset.file}`}
      alt=""
      aria-hidden
      draggable={false}
      className="free-layer__img"
      style={style}
      onError={() => setFailed(true)}
    />
  );
}

export function FreeLayerFigure({ manifest, layouts, counts, variants, autoLayout = true, showAnchorDebug = false, className }: FreeLayerFigureProps) {
  const canvasSize = manifest.canvas.width;
  const byId = new Map(manifest.assets.map((a) => [a.id, a] as const));
  const byCategory = new Map<string, LayerAsset[]>();
  for (const asset of manifest.assets) {
    const list = byCategory.get(asset.category);
    if (list) list.push(asset);
    else byCategory.set(asset.category, [asset]);
  }

  type Layer = { key: string; asset: LayerAsset; style: CSSProperties; zIndex: number };
  const layers: Layer[] = [];
  const badges: { category: string; count: number }[] = [];

  const base = byId.get('base-core');
  if (base) {
    const s = computeLayerStyle({ x: canvasSize / 2, y: canvasSize / 2 }, base.pivot, base.defaultScale, canvasSize);
    layers.push({
      key: 'base',
      asset: base,
      zIndex: base.zGroup,
      style: {
        left: `${s.leftPct}%`,
        top: `${s.topPct}%`,
        width: `${s.sizePct}%`,
        height: `${s.sizePct}%`,
        zIndex: base.zGroup,
      },
    });
  }

  for (const [category, assets] of byCategory) {
    if (category === 'base') continue;
    const count = counts[category] ?? 0;
    if (count <= 0) continue;

    const variantId = variants?.[category];
    const asset = (variantId && byId.get(variantId)) || assets[0];

    // 装着順に依存しないよう、カテゴリ+ゼロ埋めindexの安定した文字列で並べる。
    const instanceIds = Array.from({ length: count }, (_, i) => `${category}-${String(i).padStart(3, '0')}`);
    const placement = placeCategory(category, instanceIds, layouts, autoLayout);

    for (const { anchor, instanceId } of placement.visible) {
      const s = computeLayerStyle(anchor, asset.pivot, asset.defaultScale, canvasSize);
      layers.push({
        key: instanceId,
        asset,
        zIndex: anchor.z,
        style: {
          left: `${s.leftPct}%`,
          top: `${s.topPct}%`,
          width: `${s.sizePct}%`,
          height: `${s.sizePct}%`,
          zIndex: anchor.z,
          transformOrigin: `${s.originXPct}% ${s.originYPct}%`,
          transform: `${anchor.mirror ? 'scaleX(-1) ' : ''}rotate(${anchor.rotation}deg)`,
        },
      });
    }

    // 内臓(representative)は超過分を静かに切り詰めるだけで、バッジは出さない。
    if (placement.overflowCount > 0 && placement.mode === 'badge') {
      badges.push({ category, count: placement.overflowCount });
    }
  }

  return (
    <div className={`free-layer-canvas${className ? ` ${className}` : ''}`}>
      {layers.map((l) => (
        <LayerImage key={l.key} asset={l.asset} style={l.style} />
      ))}
      {showAnchorDebug && <AnchorDebugOverlay layouts={layouts} canvasSize={canvasSize} />}
      {badges.length > 0 && (
        <div className="free-layer-canvas__badges">
          {badges.map((b) => (
            <span key={b.category} className="free-layer-canvas__badge">
              {CATEGORY_FALLBACK_ICON[b.category] ?? ''}×{b.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AnchorDebugOverlay({ layouts, canvasSize }: { layouts: AnchorLayouts; canvasSize: number }) {
  const dots: { key: string; x: number; y: number; label: string }[] = [];
  for (const [category, anchors] of Object.entries(layouts.layouts)) {
    anchors.forEach((a, i) => dots.push({ key: `${category}-${i}`, x: a.x, y: a.y, label: `${category}${i + 1}` }));
  }
  return (
    <div className="free-layer-canvas__debug" aria-hidden>
      {dots.map((d) => (
        <span
          key={d.key}
          className="free-layer-canvas__debug-dot"
          style={{ left: `${(d.x / canvasSize) * 100}%`, top: `${(d.y / canvasSize) * 100}%` }}
          title={d.label}
        />
      ))}
    </div>
  );
}
