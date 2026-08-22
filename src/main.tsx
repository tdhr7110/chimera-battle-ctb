import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';

// プロトタイプ検証用の分岐(仕様書8章): ?prototype=chimera-builder のときだけ、
// 本番App(RunState/CtbEngineの本編ループ)の代わりに独立した検証画面をマウントする。
// クエリパラメータが無い通常時の挙動・描画木は従来と完全に同一(<App /> のみ)。
const isPrototypeChimeraBuilder = new URLSearchParams(window.location.search).get('prototype') === 'chimera-builder';

async function bootstrap() {
  const root = createRoot(document.getElementById('root')!);
  if (isPrototypeChimeraBuilder) {
    const { PrototypeChimeraApp } = await import('./prototype/chimera/PrototypeChimeraApp');
    root.render(
      <StrictMode>
        <PrototypeChimeraApp />
      </StrictMode>
    );
    return;
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrap();
