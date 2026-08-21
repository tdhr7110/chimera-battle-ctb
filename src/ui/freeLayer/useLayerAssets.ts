// TEST11: layer-manifest.json / anchor-layouts.json をpublic/assets/chimera-layers/から取得する。
// import.meta.env.BASE_URLを使うことで、GitHub Pagesのサブパス配信(/game-claude/test11/等)でも
// 相対的に正しいURLになる。素材はfetchでそのまま参照し、複製やBase64化はしない。
import { useEffect, useState } from 'react';
import type { AnchorLayouts, LayerManifest } from './types';

export const CHIMERA_LAYERS_BASE = `${import.meta.env.BASE_URL}assets/chimera-layers/`;

interface LayerAssetsState {
  manifest: LayerManifest | null;
  layouts: AnchorLayouts | null;
  error: string | null;
}

const LOADING_STATE: LayerAssetsState = { manifest: null, layouts: null, error: null };
let cache: LayerAssetsState | null = null;

export function useLayerAssets(): LayerAssetsState {
  const [state, setState] = useState<LayerAssetsState>(cache ?? LOADING_STATE);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    Promise.all([
      fetch(`${CHIMERA_LAYERS_BASE}layer-manifest.json`).then((r) => r.json() as Promise<LayerManifest>),
      fetch(`${CHIMERA_LAYERS_BASE}anchor-layouts.json`).then((r) => r.json() as Promise<AnchorLayouts>),
    ])
      .then(([manifest, layouts]) => {
        if (cancelled) return;
        cache = { manifest, layouts, error: null };
        setState(cache);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ manifest: null, layouts: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
