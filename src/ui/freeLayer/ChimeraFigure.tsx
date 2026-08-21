import { useMemo } from 'react';
import type { PartDef } from '../../data/types';
import { useLayerAssets } from './useLayerAssets';
import { FreeLayerFigure } from './FreeLayerFigure';
import { layerCountsFromParts } from './layerFromParts';

// ============================================================
// Phase 3: 戦闘画面のプレイヤー表示を、装着部位に応じたレイヤー合成へ差し替えるラッパー。
//
// 描画だけを担当し、戦闘ロジックには一切関与しない(このコンポーネントはCtbEngineを
// 知らないし、受け取るのも「装着部位」と「見た目の状態フラグ」だけ)。
//
// フォールバック方針: 素材のマニフェスト取得に失敗した場合も、まだ読み込み中の場合も、
// 素材が1枚も対応しない部位構成の場合も、必ず従来の🧬表示へ落ちる。
// 個々の画像の404はFreeLayerFigure側がカテゴリ絵文字へ差し替える。
// 敵側は従来どおり絵文字のままで、この仕組みは通していない。
// ============================================================

export function ChimeraFigure({
  equippedParts,
  attackFx,
  hitFx,
  isDead,
}: {
  equippedParts: PartDef[];
  attackFx: boolean;
  hitFx: boolean;
  isDead: boolean;
}) {
  const { manifest, layouts } = useLayerAssets();
  const counts = useMemo(() => layerCountsFromParts(equippedParts), [equippedParts]);

  const className = `combatant__figure${attackFx ? ' combatant__figure--attack' : ''}${hitFx ? ' combatant__figure--hit' : ''}${
    isDead ? ' combatant__figure--dead' : ''
  }`;

  // 素材が未取得・取得失敗ならこれまでどおりの絵文字表示。
  if (!manifest || !layouts) return <div className={className}>🧬</div>;

  return (
    <div className={className}>
      <FreeLayerFigure manifest={manifest} layouts={layouts} counts={counts} className="chimera-figure__canvas" />
    </div>
  );
}
