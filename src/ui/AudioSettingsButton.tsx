import { useEffect, useState } from 'react';
import { getAudioSettings, setMuted, setVolume, subscribeAudioSettings } from '../engine/soundManager';

// ============================================================
// Phase 4: ミュート・音量の設定UI。設定はsoundManager側でlocalStorageへ保存される。
// 図鑑ボタンと同じ位置系の小さなFABで、開くと音量スライダーが出る。
// ============================================================

export function AudioSettingsButton() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);

  // soundManagerはReactの外で状態を持つので、変更を購読して再描画する。
  useEffect(() => subscribeAudioSettings(() => force((v) => v + 1)), []);

  const settings = getAudioSettings();
  const off = settings.muted || settings.volume <= 0;

  return (
    <div className="audio-fab-wrap">
      <button
        type="button"
        className="audio-fab"
        onClick={() => setOpen((o) => !o)}
        title={off ? '効果音: OFF' : `効果音: ON (音量${Math.round(settings.volume * 100)}%)`}
        aria-label="効果音の設定"
      >
        {off ? '🔇' : '🔊'}
      </button>
      {open && (
        <div className="audio-panel">
          <button type="button" className="audio-panel__toggle" onClick={() => setMuted(!settings.muted)}>
            {settings.muted ? '🔇 ミュート中' : '🔊 効果音ON'}
          </button>
          <label className="audio-panel__row">
            音量
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              aria-label="効果音の音量"
            />
            <span className="audio-panel__value">{Math.round(settings.volume * 100)}</span>
          </label>
        </div>
      )}
    </div>
  );
}
