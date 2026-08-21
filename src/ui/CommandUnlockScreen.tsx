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
// 解放ルール自体(部位のタグで解放)は一切変更していない。差分は
// engine/modifiers.ts の newlyUnlockedCommands() が算出したものをそのまま表示するだけ。
// ============================================================

const CARD_STAGGER_MS = 420;
const AUTO_ADVANCE_AFTER_MS = 1600;

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

  // 全部出そろったら短い間を置いて自動で次へ(タップ不要で進める)。
  // onDoneは呼び出し側でインライン生成される想定なので依存に入れず、最新値をrefで参照する
  // (依存に入れると親の再描画のたびにタイマーが張り直されて自動送りが永久に来ない)。
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (!allShown) return;
    const t = window.setTimeout(() => onDoneRef.current(), AUTO_ADVANCE_AFTER_MS);
    return () => clearTimeout(t);
  }, [allShown]);

  // 1回目のタップで残りを全部表示、出そろっていれば次へ。
  function handleTap() {
    if (allShown) {
      onDone();
      return;
    }
    staggerTimersRef.current.forEach(clearTimeout);
    staggerTimersRef.current = [];
    setRevealed(commandIds.length);
  }

  return (
    <div className="unlock-screen" onClick={handleTap} role="button" tabIndex={0} onKeyDown={handleTap}>
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
      <div className="unlock-screen__hint">{allShown ? 'タップして次へ' : 'タップですべて表示'}</div>
    </div>
  );
}
