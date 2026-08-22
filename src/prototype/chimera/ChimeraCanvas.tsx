// ============================================================
// プロトタイプ専用: 7スロット・キメラのレイヤー合成描画コンポーネント。
//
// Canvas焼き込みではなくHTMLの重ね合わせで実装している(仕様書14章)。
// 検証の結果、部位素材(頭・胴・前脚・後脚・羽・尻尾)はすべて右向きで描かれていることを
// 確認できた(敵シートは逆に左向きで統一されている)。そのため既定(facing='right')では
// 反転せずそのまま使い、必要なとき(facing='left')だけコンテナ全体をscaleX(-1)で反転する。
// 敵は完成済み1枚絵(仕様書12章)で、素材自体がすでに左向きのためそのまま使う。
//
// editableCategory を指定すると、そのカテゴリのレイヤーだけドラッグ(位置)・ホイール(拡縮)・
// 矢印キー(微調整)で直感的に動かせるようにする。数値をJSON/コードへ直接書く代わりの
// 調整手段(overrides.ts の session override)。
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { computePartStyle, anchorDotPct } from './layout';
import { getPartVisual, CANVAS_SIZE } from './manifest';
import { applyOverride, type OverrideMap, type PartOverride } from './overrides';
import { SLOT_CATEGORIES, SLOT_LABEL, type ChimeraLoadout, type ChimeraPartVisual, type ChimeraSlotCategory } from './types';
import './chimeraCanvas.css';

export function ChimeraCanvas({
  loadout,
  facing = 'right',
  showDebugAnchors = false,
  editableCategory = null,
  sessionOverrides,
  onAdjustPart,
  className,
}: {
  loadout: ChimeraLoadout;
  facing?: 'right' | 'left';
  showDebugAnchors?: boolean;
  editableCategory?: ChimeraSlotCategory | null;
  sessionOverrides?: OverrideMap;
  onAdjustPart?: (partId: string, next: PartOverride) => void;
  className?: string;
}) {
  const flipRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);

  const layers = SLOT_CATEGORIES.map((category) => {
    const basePart = getPartVisual(loadout[category]);
    if (!basePart) return null;
    const part = applyOverride(basePart, sessionOverrides?.[basePart.id]);
    const style = computePartStyle(part);
    return { category, part, style };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  layers.sort((a, b) => a.style.zIndex - b.style.zIndex);

  // 素材は右向きが基準。facing='left'を明示的に指定したときだけ全体を反転する。
  const mirrored = facing === 'left';

  function currentPartFor(category: ChimeraSlotCategory): ChimeraPartVisual | null {
    return layers.find((l) => l.category === category)?.part ?? null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLImageElement>, part: ChimeraPartVisual) {
    if (!onAdjustPart) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: part.offsetX ?? 0,
      startOffsetY: part.offsetY ?? 0,
    };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLImageElement>) {
    const drag = dragRef.current;
    const part = currentPartFor(editableCategory as ChimeraSlotCategory);
    if (!drag || drag.pointerId !== e.pointerId || !onAdjustPart || !flipRef.current || !part) return;
    const rectWidth = flipRef.current.getBoundingClientRect().width || CANVAS_SIZE;
    const canvasPerPx = CANVAS_SIZE / rectWidth;
    const sign = mirrored ? -1 : 1;
    const dx = (e.clientX - drag.startX) * canvasPerPx * sign;
    const dy = (e.clientY - drag.startY) * canvasPerPx;
    onAdjustPart(part.id, { offsetX: drag.startOffsetX + dx, offsetY: drag.startOffsetY + dy, scale: part.scale });
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function handleWheel(e: WheelEvent, part: ChimeraPartVisual) {
    if (!onAdjustPart) return;
    e.preventDefault();
    const factor = 1 - e.deltaY * 0.0012;
    const nextScale = Math.min(4, Math.max(0.15, part.scale * factor));
    onAdjustPart(part.id, { offsetX: part.offsetX ?? 0, offsetY: part.offsetY ?? 0, scale: nextScale });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLImageElement>, part: ChimeraPartVisual) {
    if (!onAdjustPart) return;
    const step = e.shiftKey ? 5 : 1;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    onAdjustPart(part.id, { offsetX: (part.offsetX ?? 0) + dx, offsetY: (part.offsetY ?? 0) + dy, scale: part.scale });
  }

  return (
    <div className={`proto-chimera-canvas${className ? ` ${className}` : ''}`}>
      <div ref={flipRef} className="proto-chimera-canvas__flip" style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}>
        {layers.map(({ category, part, style }) => {
          const editable = onAdjustPart != null && category === editableCategory;
          return (
            <ChimeraLayerImg
              key={category}
              src={part.image}
              alt={part.name}
              editable={editable}
              style={{
                left: `${style.leftPct}%`,
                top: `${style.topPct}%`,
                width: `${style.widthPct}%`,
                height: `${style.heightPct}%`,
                zIndex: style.zIndex,
              }}
              onPointerDown={editable ? (e) => handlePointerDown(e, part) : undefined}
              onPointerMove={editable ? handlePointerMove : undefined}
              onPointerUp={editable ? handlePointerUp : undefined}
              onWheelNative={editable ? (e) => handleWheel(e, part) : undefined}
              onKeyDown={editable ? (e) => handleKeyDown(e, part) : undefined}
            />
          );
        })}
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

function ChimeraLayerImg({
  src,
  alt,
  style,
  editable,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheelNative,
  onKeyDown,
}: {
  src: string;
  alt: string;
  style: React.CSSProperties;
  editable: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLImageElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLImageElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLImageElement>) => void;
  onWheelNative?: (e: WheelEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLImageElement>) => void;
}) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const fullSrc = `${import.meta.env.BASE_URL}${src}`;

  // Reactのsynthetic onWheelはpassiveリスナーとして登録されるため、ホイールで拡縮する間
  // ページ自体がスクロールしてしまう(=preventDefault()が効かない)。ネイティブの
  // addEventListener('wheel', ..., { passive: false }) を直接張ることでこれを防ぐ。
  useEffect(() => {
    const node = imgRef.current;
    if (!node || !onWheelNative) return;
    const handler = (e: WheelEvent) => onWheelNative(e);
    node.addEventListener('wheel', handler, { passive: false });
    return () => node.removeEventListener('wheel', handler);
  }, [onWheelNative]);

  if (failed) {
    return (
      <div className="proto-chimera-canvas__img-fallback" style={style} aria-hidden>
        ❓
      </div>
    );
  }
  return (
    <img
      ref={imgRef}
      src={fullSrc}
      alt={alt}
      draggable={false}
      className={`proto-chimera-canvas__img${editable ? ' proto-chimera-canvas__img--editable' : ''}`}
      style={style}
      tabIndex={editable ? 0 : undefined}
      onError={() => setFailed(true)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
