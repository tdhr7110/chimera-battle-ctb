import { useState } from 'react';
import { PrepScreen } from './ui/PrepScreen';
import { EnemySelectScreen } from './ui/EnemySelectScreen';
import { BattleScreen } from './ui/BattleScreen';
import type { EnemyDef, PartDef } from './data/types';

type Phase = 'prep' | 'enemySelect' | 'battle';

export default function App() {
  const [phase, setPhase] = useState<Phase>('prep');
  const [equippedParts, setEquippedParts] = useState<PartDef[]>([]);
  const [enemy, setEnemy] = useState<EnemyDef | null>(null);
  const [lastResult, setLastResult] = useState<'won' | 'lost' | null>(null);

  return (
    <div className="app-root">
      {phase === 'prep' && (
        <>
          {lastResult && (
            <p className="muted" style={{ textAlign: 'center', fontSize: '0.75rem' }}>
              前回の結果: {lastResult === 'won' ? '🎉 勝利' : '💀 敗北'}
            </p>
          )}
          <PrepScreen
            onReady={(parts) => {
              setEquippedParts(parts);
              setPhase('enemySelect');
            }}
          />
        </>
      )}
      {phase === 'enemySelect' && (
        <EnemySelectScreen
          onPick={(e) => {
            setEnemy(e);
            setPhase('battle');
          }}
        />
      )}
      {phase === 'battle' && enemy && (
        <BattleScreen
          enemy={enemy}
          equippedParts={equippedParts}
          onExit={(result) => {
            setLastResult(result);
            setEnemy(null);
            setPhase('prep');
          }}
        />
      )}
    </div>
  );
}
