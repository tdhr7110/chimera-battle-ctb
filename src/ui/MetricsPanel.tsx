import { useState } from 'react';
import { clearMetrics, exportCsv, exportJson, getMetrics, summarise } from '../engine/metrics';
import { getCommand } from '../data/commands';
import { getPart } from '../data/parts';

// ============================================================
// Phase 6: バランス計測の閲覧UI。
// 通常のプレイ画面には出さない(metricsViewerEnabled()が真のときだけApp側が描画する)。
// 書き出しは画面へテキストを出すだけで、外部への送信は一切しない。
// ============================================================

export function MetricsPanel({ onClose }: { onClose: () => void }) {
  const [dump, setDump] = useState<{ label: string; text: string } | null>(null);
  const metrics = getMetrics();
  const s = summarise(metrics);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card metrics-panel" onClick={(e) => e.stopPropagation()}>
        <h2>📊 バランス計測（ローカルのみ）</h2>
        <p className="muted" style={{ fontSize: '0.62rem' }}>
          この端末のlocalStorageにだけ保存され、どこにも送信されません。
        </p>

        {s.runCount === 0 && <p className="muted">まだ記録がありません。1ラン遊ぶとここに出ます。</p>}

        {s.runCount > 0 && (
          <>
            <div className="metrics-grid">
              <div>ラン数</div><strong>{s.runCount}</strong>
              <div>勝利 / 敗北</div><strong>{s.victories} / {s.defeats}</strong>
              <div>平均到達戦数</div><strong>{s.avgReachedBattle}</strong>
              <div>戦闘数</div><strong>{s.battleCount}</strong>
              <div>平均ターン数</div><strong>{s.avgTurnsPerBattle}</strong>
              <div>平均戦闘時間</div><strong>{s.avgBattleSeconds}秒</strong>
              <div>融合実行率</div><strong>{Math.round(s.fusionRate * 100)}%</strong>
            </div>

            <div className="metrics-section">
              <div className="metrics-section__title">階級別 勝率</div>
              {Object.entries(s.winRateByTier).map(([tier, t]) => (
                <div key={tier} className="metrics-row">
                  <span>{tier}</span>
                  <span>
                    {t.wins}/{t.total}（{Math.round((t.wins / t.total) * 100)}%）
                  </span>
                </div>
              ))}
            </div>

            <div className="metrics-section">
              <div className="metrics-section__title">よく使われたコマンド</div>
              {s.commandUsage.slice(0, 10).map((c) => (
                <div key={c.commandId} className="metrics-row">
                  <span>{getCommand(c.commandId)?.name ?? c.commandId}</span>
                  <span>{c.uses}回</span>
                </div>
              ))}
              {s.commandUsage.length === 0 && <p className="muted">記録なし</p>}
            </div>

            <div className="metrics-section">
              <div className="metrics-section__title">
                解放済みなのに一度も使われなかったコマンド（{s.neverUsedUnlockedCommandIds.length}件）
              </div>
              <div className="metrics-chips">
                {s.neverUsedUnlockedCommandIds.map((id) => (
                  <span key={id} className="metrics-chip">{getCommand(id)?.name ?? id}</span>
                ))}
                {s.neverUsedUnlockedCommandIds.length === 0 && <p className="muted">なし</p>}
              </div>
            </div>

            <div className="metrics-section">
              <div className="metrics-section__title">選ばれた部位 / 見送られた部位</div>
              <div className="metrics-two-col">
                <div>
                  {s.mostTakenPartIds.map((p) => (
                    <div key={p.partId} className="metrics-row">
                      <span>{getPart(p.partId)?.name ?? p.partId}</span>
                      <span>{p.count}</span>
                    </div>
                  ))}
                </div>
                <div>
                  {s.mostSkippedPartIds.map((p) => (
                    <div key={p.partId} className="metrics-row">
                      <span>{getPart(p.partId)?.name ?? p.partId}</span>
                      <span>{p.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="metrics-actions">
          <button type="button" className="btn" onClick={() => setDump({ label: 'JSON', text: exportJson(metrics) })}>
            JSONで書き出す
          </button>
          <button type="button" className="btn" onClick={() => setDump({ label: 'CSV', text: exportCsv(metrics) })}>
            CSVで書き出す
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              clearMetrics();
              setDump(null);
            }}
          >
            記録を消去
          </button>
        </div>

        {dump && (
          <div className="metrics-dump">
            <div className="metrics-section__title">{dump.label}（選択してコピーしてください）</div>
            <textarea className="metrics-dump__text" readOnly value={dump.text} onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}

        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
