import { useEffect, useState } from 'react';

// ============================================================
// 決着の演出。戦闘画面の上に全画面でかぶせる。
//
// 勝利は「派手に」を最優先にしている:
//   1. 白フラッシュ → 2. 回転する光条 → 3. 三重のショックウェーブ
//   4. 外へ飛ぶ粒子 → 5. VICTORY の一文字ずつの落下 → 6. 戦績が遅れて入る
// 敗北は逆に静かに落とす(赤いヴィネットと沈む文字)。
//
// prefers-reduced-motion のときはアニメーションを止め、最終状態だけを見せる。
// 表示専用で、戦闘の状態には一切触れない。
// ============================================================

const SPARKS = 26;
const RAYS = 12;
const WIN_LETTERS = [...'VICTORY'];

export function BattleEndOverlay({
  won,
  enemyIcon,
  enemyName,
  turnCount,
  hp,
  maxHp,
  mp,
  maxMp,
  onDismiss,
}: {
  won: boolean;
  enemyIcon: string;
  enemyName: string;
  turnCount: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  onDismiss: () => void;
}) {
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [armed, setArmed] = useState(false);

  // 決着直前のタップが貫通して演出が一瞬で消えないよう、少し置いてから入力を受ける。
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), reduced ? 0 : 700);
    return () => window.clearTimeout(t);
  }, [reduced]);

  const tone = won ? 'won' : 'lost';
  const hpPct = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;

  return (
    <button
      type="button"
      className={`bend bend--${tone}${reduced ? ' bend--still' : ''}`}
      onClick={() => armed && onDismiss()}
      aria-label={won ? '勝利。タップして次へ' : '敗北。タップして次へ'}
    >
      <div className="bend__flash" aria-hidden />

      {won && !reduced && (
        <div className="bend__rays" aria-hidden>
          {Array.from({ length: RAYS }, (_, i) => (
            <span key={i} className="bend__ray" style={{ transform: `rotate(${(360 / RAYS) * i}deg)` }} />
          ))}
        </div>
      )}

      {won && !reduced && (
        <div className="bend__rings" aria-hidden>
          <span className="bend__ring" />
          <span className="bend__ring bend__ring--2" />
          <span className="bend__ring bend__ring--3" />
        </div>
      )}

      {!reduced && (
        <div className="bend__sparks" aria-hidden>
          {Array.from({ length: won ? SPARKS : 12 }, (_, i) => {
            const angle = (360 / (won ? SPARKS : 12)) * i + (i % 3) * 7;
            const dist = 110 + (i % 5) * 34;
            return (
              <span
                key={i}
                className="bend__spark"
                style={{
                  ['--a' as string]: `${angle}deg`,
                  ['--d' as string]: `${dist}px`,
                  animationDelay: `${(i % 7) * 42}ms`,
                }}
              />
            );
          })}
        </div>
      )}

      <div className="bend__body">
        <div className="bend__word">
          {won ? (
            WIN_LETTERS.map((ch, i) => (
              <span key={i} className="bend__letter" style={{ animationDelay: `${140 + i * 62}ms` }}>
                {ch}
              </span>
            ))
          ) : (
            <span className="bend__letter bend__letter--lost">DEFEATED</span>
          )}
        </div>

        <div className="bend__sub">
          {won ? (
            <>
              <span className="bend__enemy">{enemyIcon}</span> {enemyName} を撃破
            </>
          ) : (
            <>
              <span className="bend__enemy">{enemyIcon}</span> {enemyName} に敗れた
            </>
          )}
        </div>

        <div className="bend__stats">
          <div className="bend__stat">
            <span className="bend__stat-label">ターン</span>
            <strong>{turnCount}</strong>
          </div>
          <div className="bend__stat">
            <span className="bend__stat-label">残りHP</span>
            <strong>
              {hp}
              <small>/{maxHp}・{hpPct}%</small>
            </strong>
          </div>
          <div className="bend__stat">
            <span className="bend__stat-label">残りMP</span>
            <strong>
              {mp}
              <small>/{maxMp}</small>
            </strong>
          </div>
        </div>

        <div className={`bend__hint${armed ? ' bend__hint--on' : ''}`}>タップして次へ</div>
      </div>
    </button>
  );
}
