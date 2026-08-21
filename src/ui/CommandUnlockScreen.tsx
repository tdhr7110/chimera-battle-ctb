import { useEffect, useRef, useState } from 'react';
import { getPart } from '../data/parts';
import { getCommand } from '../data/commands';
import { CT_WEIGHT_LABEL } from '../data/types';
import { playSE } from '../engine/soundManager';

// ============================================================
// Phase 2: 部位取得 → 新コマンド解放 → 準備画面、という連続演出のうち「解放」の1画面。
//
// 何を解放したのかが伝わらないまま準備画面へ戻ってしまう問題への対応。
// 「閉じるボタンを何度も押させない」ため、複数コマンドが同時に解放されても画面は1枚で、
// カードは順に自動で現れる。画面のどこをタップしても即座に全部表示 → もう一度で次へ進む。
//
// 自動送りはしない: 以前は出そろってから1.6秒で勝手に次へ進んでいたが、
// 読み終わる前に画面が変わってしまうため撤去した。進むのは必ずプレイヤーのタップ。
// 解放ルール自体(部位のタグで解放)は一切変更していない。差分は
// engine/modifiers.ts の newlyUnlockedCommands() が算出したものをそのまま表示するだけ。
// ============================================================

const CARD_STAGGER_MS = 420;
// カードが出そろってからタップを受け付けるまでの猶予。誤爆で飛ばしてしまうのを防ぐ。
const TAP_ARM_DELAY_MS = 450;

export function CommandUnlockScreen({
  commandIds,
  fromPartId,
  onDone,
}: {
  commandIds: string[];
  fromPartId: string | null;
  onDone: () => void;
}) {
  const part = fromPartId ? getPart(fromPartId) : undefined;
  const [revealed, setRevealed] = useState(0);
  const staggerTimersRef = useRef<number[]>([]);
  const allShown = revealed >= commandIds.length;

  // カードを1枚ずつ出す。prefers-reduced-motionなら段階表示せず即座に全部出す。
  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setRevealed(commandIds.length);
      return;
    }
    // 「タップで全部表示」した後に残りのタイマーが発火してrevealedを巻き戻さないよう、
    // 単調増加(Math.max)で更新する。タップ側でもタイマーを止める。
    staggerTimersRef.current = commandIds.map((_, i) =>
      window.setTimeout(() => setRevealed((r) => Math.max(r, i + 1)), CARD_STAGGER_MS * (i + 1))
    );
    const timers = staggerTimersRef.current;
    return () => timers.forEach(clearTimeout);
  }, [commandIds]);

  // Phase 4: 解放そのものを一度だけ音でも知らせる。
  useEffect(() => {
    if (commandIds.length > 0) playSE('unlock');
  }, [commandIds]);

  // 出そろった直後は、直前のタップが貫通して即座に閉じてしまわないよう少しだけ待つ。
  const [tapArmed, setTapArmed] = useState(false);
  useEffect(() => {
    if (!allShown) { setTapArmed(false); return; }
    const t = window.setTimeout(() => setTapArmed(true), TAP_ARM_DELAY_MS);
    return () => clearTimeout(t);
  }, [allShown]);

  // 1回目のタップで残りを全部表示、出そろっていれば次へ。
  function handleTap() {
    if (allShown) {
      if (tapArmed) onDone();
      return;
    }
    staggerTimersRef.current.forEach(clearTimeout);
    staggerTimersRef.current = [];
    setRevealed(commandIds.length);
  }

  return (
    <div className="unlock-screen" onClick={handleTap} role="button" tabIndex={0} onKeyDown={handleTap}>
      {/* 派手側の演出レイヤー(表示専用) */}
      <div className="burst__flash burst__flash--unlock" aria-hidden />
      <div className="unlock-rays" aria-hidden />
      <div className="unlock-ring unlock-ring--a" aria-hidden />
      <div className="unlock-ring unlock-ring--b" aria-hidden />
      <div className="unlock-sparks" aria-hidden>
        {Array.from({ length: 18 }, (_, i) => (
          <span
            key={i}
            className="unlock-spark"
            style={{
              ['--angle' as string]: `${20 * i}deg`,
              ['--delay' as string]: `${(i % 6) * 50}ms`,
            }}
          />
        ))}
      </div>

      <div className="unlock-screen__title">⚡ 新コマンド解放</div>
      {part && (
        <div className="unlock-screen__sub">
          {part.icon} {part.name} を組み込んだことで使えるようになった
        </div>
      )}
      <div className="unlock-list">
        {commandIds.slice(0, revealed).map((id) => {
          const cmd = getCommand(id);
          if (!cmd) return null;
          return (
            <div key={id} className="unlock-card">
              <span className="unlock-card__icon">{cmd.icon}</span>
              <div className="unlock-card__body">
                <div className="unlock-card__name">{cmd.name}</div>
                <div className="unlock-card__desc">{cmd.description}</div>
              </div>
              <div className="unlock-card__stats">
                <span>🔷{cmd.mpCost}</span>
                <span>{CT_WEIGHT_LABEL[cmd.ctWeight]}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="unlock-screen__hint">
        {!allShown ? 'タップですべて表示' : tapArmed ? '👆 タップして次へ' : '...'}
      </div>
    </div>
  );
}
