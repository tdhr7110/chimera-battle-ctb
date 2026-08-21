import { useEffect, useRef, useState } from 'react';

// ============================================================
// 獲得演出。部位獲得とコマンド解放で共有する「派手な一枚」。
//
// 構成:
//   1. 画面全体のフラッシュ
//   2. レア度で色が変わる放射状の光条 + 二重のショックウェーブ
//   3. 外へ飛び散る粒子(レア度が高いほど数が増える)
//   4. 中央でアイコンが弾んで出て、名前・肩書きが遅れて入る
//
// prefers-reduced-motion のときはアニメーションを止め、静止した最終状態だけを見せる。
// 演出は表示専用で、ゲームの状態には一切触れない。
// ============================================================

export type BurstTone = 'common' | 'rare' | 'epic' | 'legendary' | 'unlock';

const PARTICLES: Record<BurstTone, number> = {
  common: 10,
  rare: 14,
  epic: 20,
  legendary: 28,
  unlock: 22,
};

export function AcquireBurst({
  tone,
  icon,
  title,
  subtitle,
  badge,
  banner,
  children,
  hint,
  onDone,
  autoAdvanceMs,
}: {
  tone: BurstTone;
  icon: string;
  title: string;
  subtitle?: string;
  badge?: string;
  /** アイコンの上に出る見出し(「部位を獲得！」など)。 */
  banner?: string;
  children?: React.ReactNode;
  hint?: string;
  onDone: () => void;
  /** 指定するとこの時間で自動的に次へ進む。省略時はタップ待ち。 */
  autoAdvanceMs?: number;
}) {
  const [armed, setArmed] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // 直前のタップが貫通して演出が一瞬で消えないよう、少し置いてから入力を受ける。
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), reduced ? 0 : 500);
    return () => clearTimeout(t);
  }, [reduced]);

  useEffect(() => {
    if (autoAdvanceMs === undefined) return;
    const t = window.setTimeout(() => onDoneRef.current(), autoAdvanceMs);
    return () => clearTimeout(t);
  }, [autoAdvanceMs]);

  const particles = reduced ? 0 : PARTICLES[tone];

  return (
    <div
      className={`burst burst--${tone}${reduced ? ' burst--still' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => armed && onDone()}
      onKeyDown={() => armed && onDone()}
    >
      <div className="burst__flash" aria-hidden />
      <div className="burst__rays" aria-hidden />
      <div className="burst__ring burst__ring--a" aria-hidden />
      <div className="burst__ring burst__ring--b" aria-hidden />

      <div className="burst__particles" aria-hidden>
        {Array.from({ length: particles }, (_, i) => (
          <span
            key={i}
            className="burst__particle"
            style={{
              // 均等に配りつつ少しだけ散らす。見た目のためだけの値。
              ['--angle' as string]: `${(360 / particles) * i + (i % 3) * 7}deg`,
              ['--delay' as string]: `${(i % 5) * 40}ms`,
              ['--dist' as string]: `${38 + (i % 4) * 12}vmin`,
            }}
          />
        ))}
      </div>

      {banner && <div className="burst__banner">{banner}</div>}

      <div className="burst__core">
        <div className="burst__icon">{icon}</div>
        {badge && <div className="burst__badge">{badge}</div>}
      </div>

      <div className="burst__title">{title}</div>
      {subtitle && <div className="burst__subtitle">{subtitle}</div>}
      {children}
      {hint && <div className="burst__hint">{armed ? hint : ' '}</div>}
    </div>
  );
}
