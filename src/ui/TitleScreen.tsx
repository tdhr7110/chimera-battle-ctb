import { useState } from 'react';

// ============================================================
// 統合版(本編)のタイトル画面(仕様書28章)。
// GAME START / CONTINUE(セーブがある場合のみ) / 遊び方 の3つに絞る。
// 存在しない機能(図鑑・設定等)は無理に追加しない(仕様書28章)。
// ============================================================

// 「続きから」はランの途中保存がある場合、App.tsx側でこの画面より前に専用の
// 再開プロンプトとして出す(TEST18/19のResumePromptModalと同じ考え方)ため、
// このコンポーネント自体はCONTINUEボタンを持たない(常に新規ラン開始の入口)。
export function TitleScreen({ onNewRun }: { onNewRun: () => void }) {
  const [showHowTo, setShowHowTo] = useState(false);

  return (
    <div className="title-screen">
      <div className="title-screen__logo">
        🧬
        <div className="title-screen__name">CHIMERA BATTLE</div>
        <div className="title-screen__sub">CTB Edition</div>
      </div>

      <div className="title-screen__buttons">
        <button type="button" className="btn btn--primary btn--block" onClick={onNewRun}>
          ⚔️ GAME START
        </button>
        <button type="button" className="btn btn--block" onClick={() => setShowHowTo(true)}>
          📖 遊び方
        </button>
      </div>

      {showHowTo && (
        <div className="modal-backdrop" onClick={() => setShowHowTo(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>🧬 キメラバトルへようこそ</h2>
            <ul className="howto-list">
              <li>⏱️ 戦闘はCTB(行動順可視化型)。誰の番かを見ながらコマンドを選ぶ。</li>
              <li>👆 コマンドは1回タップで選択・行動順プレビュー、同じコマンドをもう一度タップで実行。</li>
              <li>🔷 MPは高度な戦術のためのリソース。通常攻撃・速撃・防御・待機はMP0で使える。</li>
              <li>🦴 部位を装着すると、ステータスだけでなくCTBの行動順そのものが変わる。</li>
              <li>💀 コアHPが0で敗北。敵を倒して部位を集め、最後まで生き延びよう。</li>
            </ul>
            <button type="button" className="btn btn--primary btn--block" onClick={() => setShowHowTo(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
