import { useEffect, useState } from 'react';
import { TitleScreen } from './ui/TitleScreen';
import { StarterSelectScreen } from './ui/StarterSelectScreen';
import { PrepScreen } from './ui/PrepScreen';
import { EnemySelectScreen } from './ui/EnemySelectScreen';
import { BattleScreen } from './ui/BattleScreen';
import { RewardScreen } from './ui/RewardScreen';
import { CommandUnlockScreen } from './ui/CommandUnlockScreen';
import { ResultScreen } from './ui/ResultScreen';
import { CodexModal } from './ui/CodexModal';
import {
  acceptDrop,
  chooseEnemy,
  createTitleState,
  dismissCommandUnlock,
  enterEnemySelect,
  equipPart,
  markCommandsSeen,
  equippedPartDefs,
  finishBattle,
  markIntroSeen,
  ownedPartIds,
  selectStarter,
  skipDrop,
  startNewRun,
  TOTAL_BATTLES,
  unequipPart,
  type RunState,
} from './engine/run';
import { getEnemy } from './data/enemies';
import { clearRunState, loadIntroSeen, loadRunState, saveIntroSeen, saveRunState } from './persistence/save';
import { markEnemyDefeated, markEnemyEncountered, markPartsDiscovered } from './engine/codex';
import { loadCodexState, saveCodexState } from './persistence/codex';
import { initAudioUnlock, playSE } from './engine/soundManager';
import { AudioSettingsButton } from './ui/AudioSettingsButton';

// ============================================================
// CHIMERA BATTLE 統合版(本編)のフェーズ制御。
// TEST18/19のゲームループ(タイトル→素体選択→待機→敵選択→戦闘→報酬→待機)を、
// CTB専用版の戦闘エンジン・データモデルの上で再構築したもの。
// 戦闘フェーズはBattleScreen(chimera-battle-ctbの検証済みCTBエンジン)をそのまま使い、
// ここではRunStateとの橋渡し(装備部位を渡す・終了後の結果を受け取る)だけを行う。
// ============================================================

export default function App() {
  const [pendingResume, setPendingResume] = useState<RunState | null>(null);
  const [incompatibleSaveNotice, setIncompatibleSaveNotice] = useState(false);
  const [state, setState] = useState<RunState>(() => createTitleState(loadIntroSeen()));
  const [codex, setCodex] = useState(() => loadCodexState());
  const [showCodex, setShowCodex] = useState(false);

  // Phase 4: ブラウザの自動再生制限に合わせ、最初のユーザー操作でAudioContextを起動する。
  useEffect(() => {
    initAudioUnlock();
  }, []);

  // 起動時: 保存されたランがあれば「続きから」の選択待ちにする(TEST18/19のラン途中保存を踏襲)。
  useEffect(() => {
    const result = loadRunState();
    if (result.incompatibleFound) setIncompatibleSaveNotice(true);
    if (result.state) setPendingResume(result.state);
  }, []);

  // 戦闘中は毎フレーム保存しない。フェーズが変わった時点のチェックポイント保存のみ(save.ts側もbattle中は保存しない)。
  useEffect(() => {
    if (pendingResume) return;
    saveRunState(state);
  }, [state, pendingResume]);

  // 図鑑(仕様書3・28章): ランのリセットに関係なく蓄積する。所持部位は変化のたびに記録する。
  // 敵の遭遇/撃破は、finishBattle()がcurrentEnemyIdをnullへ戻す前にID自体が分かる場所
  // (敵選択時・戦闘終了時のイベントハンドラ内)で直接記録する(state監視だと再遭遇時に
  // 「最後に遭遇したID」が更新されず誤判定するため、あえてuseEffectにはしていない)。
  useEffect(() => {
    saveCodexState(codex);
  }, [codex]);
  useEffect(() => {
    const owned = ownedPartIds(state);
    if (owned.length === 0) return;
    setCodex((prev) => markPartsDiscovered(prev, owned));
  }, [state.equippedPartIds, state.inventoryPartIds]);

  function dismissHowToAndRemember() {
    saveIntroSeen();
    setState((s) => markIntroSeen(s));
  }

  // 互換性のない旧セーブが見つかった場合の通知。破棄はloadRunState()側で既に完了しているため、
  // ここでは「静かに消えた」ままにせずユーザーへ一度だけはっきり伝える(仕様書38章)。
  // pendingResume(続きから)が無い場合でも独立して表示できるよう、フェーズ描画とは別に扱う。
  const incompatibleBanner = incompatibleSaveNotice && (
    <div className="save-notice-banner">
      ⚠️ 以前のバージョンのセーブデータ(CTB/MP統合前)は今回のデータ構造と互換性がないため破棄しました。新しいランとして開始します。
      <button type="button" className="save-notice-banner__close" onClick={() => setIncompatibleSaveNotice(false)}>
        ✕
      </button>
    </div>
  );

  if (pendingResume) {
    return (
      <div className="app-root">
        {incompatibleBanner}
        <div className="select-screen">
          <h1>🧬 続きのランがあります</h1>
          <p className="select-screen__lead">
            第{pendingResume.battleIndex}戦 / 全{TOTAL_BATTLES}戦・コアHP {pendingResume.coreHp}
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              setState(pendingResume);
              setPendingResume(null);
            }}
          >
            ▶ 続きから
          </button>
          <button
            type="button"
            className="btn btn--block"
            onClick={() => {
              clearRunState();
              setPendingResume(null);
            }}
          >
            新しいゲームを始める
          </button>
        </div>
      </div>
    );
  }

  const codexButtonVisible = state.phase !== 'battle';

  return (
    <div className="app-root">
      {incompatibleBanner}
      <AudioSettingsButton />
      {codexButtonVisible && (
        <button type="button" className="codex-fab" onClick={() => setShowCodex(true)} title="図鑑">
          📖
        </button>
      )}
      {showCodex && <CodexModal codex={codex} onClose={() => setShowCodex(false)} />}
      {state.phase === 'title' && <TitleScreen onNewRun={() => setState((s) => startNewRun(s))} />}

      {state.phase === 'starterSelect' && <StarterSelectScreen onPick={(id) => setState((s) => selectStarter(s, id))} />}

      {state.phase === 'prep' && (
        <>
          {!state.seenIntro && (
            <div className="modal-backdrop" onClick={dismissHowToAndRemember}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <h2>🧬 キメラバトルへようこそ</h2>
                <ul className="howto-list">
                  <li>⏱️ 戦闘はCTB(行動順可視化型)。誰の番かを見ながらコマンドを選ぶ。</li>
                  <li>👆 コマンドは1回タップで選択・行動順プレビュー、同じコマンドをもう一度タップで実行。</li>
                  <li>🔷 MPは高度な戦術のためのリソース。通常攻撃・速撃・防御・待機はMP0で使える。</li>
                  <li>🦴 部位を装着すると、ステータスだけでなくCTBの行動順そのものが変わる。</li>
                </ul>
                <button type="button" className="btn btn--primary btn--block" onClick={dismissHowToAndRemember}>
                  はじめる
                </button>
              </div>
            </div>
          )}
          <PrepScreen
            state={state}
            onEquip={(partId) => setState((s) => equipPart(s, partId))}
            onUnequip={(partId) => setState((s) => unequipPart(s, partId))}
            onGoToEnemySelect={() => setState((s) => enterEnemySelect(s))}
            onCommandsTabOpened={() => setState((s) => markCommandsSeen(s))}
          />
        </>
      )}

      {state.phase === 'enemySelect' && (
        <EnemySelectScreen
          candidateIds={state.enemyCandidateIds}
          onPick={(enemyId) => {
            setCodex((prev) => markEnemyEncountered(prev, enemyId));
            setState((s) => chooseEnemy(s, enemyId));
          }}
        />
      )}

      {state.phase === 'battle' &&
        state.currentEnemyId &&
        (() => {
          const enemy = getEnemy(state.currentEnemyId);
          if (!enemy) return null;
          return (
            <BattleScreen
              enemy={enemy}
              equippedParts={equippedPartDefs(state)}
              startingHp={state.coreHp}
              startingMp={state.mp}
              onExit={(result, finalHp, finalMp) => {
                if (result === 'won') setCodex((prev) => markEnemyDefeated(prev, enemy.id));
                setState((s) => finishBattle(s, result, finalHp, finalMp));
              }}
            />
          );
        })()}

      {state.phase === 'reward' && (
        <RewardScreen
          candidateIds={state.dropCandidateIds}
          fromEnemyId={state.lastDefeatedEnemyId}
          onAccept={(partId) => {
            playSE('part');
            setState((s) => acceptDrop(s, partId, true));
          }}
          onSkip={() => setState((s) => skipDrop(s))}
        />
      )}

      {state.phase === 'commandUnlock' && (
        <CommandUnlockScreen
          commandIds={state.pendingUnlockCommandIds}
          fromPartId={state.lastAcquiredPartId}
          onDone={() => setState((s) => dismissCommandUnlock(s))}
        />
      )}

      {state.phase === 'result' && state.resultOutcome && (
        <ResultScreen
          outcome={state.resultOutcome}
          battleIndex={state.battleIndex}
          totalBattles={TOTAL_BATTLES}
          onRestart={() => {
            clearRunState();
            setState(createTitleState(true));
          }}
        />
      )}
    </div>
  );
}
