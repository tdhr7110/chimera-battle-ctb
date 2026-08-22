// ============================================================
// プロトタイプ専用エントリ(仕様書8章): 7スロット固定・画像合成キメラの検証アプリ。
//
// 本番App.tsx(RunState/CtbEngineベースの本編ループ)には一切関与しない、
// 完全に独立したコンポーネントツリー。src/main.tsxから
// ?prototype=chimera-builder のときだけマウントされる(仕様書8章)。
// ============================================================
import { useState } from 'react';
import { PrototypeChimeraBuilderScreen } from './PrototypeChimeraBuilderScreen';
import { PrototypeBattlePreviewScreen } from './PrototypeBattlePreviewScreen';
import { randomLoadout } from './randomChimera';
import type { ChimeraLoadout } from './types';
import './prototypeChimera.css';

type Mode = 'builder' | 'battlePreview';

export function PrototypeChimeraApp() {
  const [loadout, setLoadout] = useState<ChimeraLoadout>(() => randomLoadout());
  const [mode, setMode] = useState<Mode>('builder');

  return (
    <div className="proto-app">
      <div className="proto-app__banner">
        🧪 PROTOTYPE — 7スロット・キメラ画像合成 検証専用画面(本番のゲーム進行・セーブデータには一切影響しません)
      </div>
      {mode === 'builder' && (
        <PrototypeChimeraBuilderScreen
          loadout={loadout}
          onChangeLoadout={setLoadout}
          onGoToBattlePreview={() => setMode('battlePreview')}
        />
      )}
      {mode === 'battlePreview' && (
        <PrototypeBattlePreviewScreen loadout={loadout} onBackToBuilder={() => setMode('builder')} />
      )}
    </div>
  );
}
