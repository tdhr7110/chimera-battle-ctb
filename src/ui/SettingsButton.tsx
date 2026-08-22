import { useEffect, useState } from 'react';
import { getAudioSettings, setMuted, setVolume, subscribeAudioSettings } from '../engine/soundManager';
import { getUiPrefs, setUiPref, subscribeUiPrefs } from '../engine/uiPrefs';

// ============================================================
// 設定。右上に常時出す歯車ボタンと、その中身。
// 音量・ミュート(soundManager)と操作の好み(uiPrefs)をひとつの画面にまとめている。
// タイトル画面からも戦闘中からも同じものが開く。
// ============================================================

export function SettingsButton() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(false);

  // どちらのストアもReactの外にあるので、変更を購読して再描画する。
  useEffect(() => subscribeAudioSettings(() => force((v) => v + 1)), []);
  useEffect(() => subscribeUiPrefs(() => force((v) => v + 1)), []);

  const audio = getAudioSettings();
  const prefs = getUiPrefs();
  const soundOff = audio.muted || audio.volume <= 0;

  return (
    <>
      <button type="button" className="settings-fab" onClick={() => setOpen(true)} title="設定" aria-label="設定">
        ⚙️
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-card settings-card" onClick={(e) => e.stopPropagation()}>
            <h2>⚙️ 設定</h2>

            <div className="settings-section">
              <div className="settings-section__title">操作</div>
              <button
                type="button"
                className="settings-row"
                onClick={() => setUiPref('returnToCategories', !prefs.returnToCategories)}
              >
                <div className="settings-row__body">
                  <div className="settings-row__label">コマンド実行後にカテゴリへ戻す</div>
                  <div className="settings-row__desc">
                    {prefs.returnToCategories
                      ? '毎回4つの大カテゴリ表示へ戻ります。'
                      : '同じカテゴリを開いたままにします。連続で同系統を撃ちやすい。'}
                  </div>
                </div>
                <span className={`toggle${prefs.returnToCategories ? ' toggle--on' : ''}`} aria-hidden>
                  <span className="toggle__knob" />
                </span>
              </button>
            </div>

            <div className="settings-section">
              <div className="settings-section__title">サウンド</div>
              <button type="button" className="settings-row" onClick={() => setMuted(!audio.muted)}>
                <div className="settings-row__body">
                  <div className="settings-row__label">効果音</div>
                  <div className="settings-row__desc">{soundOff ? '🔇 ミュート中' : '🔊 ON'}</div>
                </div>
                <span className={`toggle${audio.muted ? '' : ' toggle--on'}`} aria-hidden>
                  <span className="toggle__knob" />
                </span>
              </button>
              <label className="settings-slider">
                <span>音量</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(audio.volume * 100)}
                  onChange={(e) => setVolume(Number(e.target.value) / 100)}
                  aria-label="効果音の音量"
                />
                <span className="settings-slider__value">{Math.round(audio.volume * 100)}</span>
              </label>
            </div>

            <button type="button" className="btn btn--primary btn--block" onClick={() => setOpen(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </>
  );
}
