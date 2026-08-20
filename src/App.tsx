import { useState } from 'react';
import { EnemySelectScreen } from './ui/EnemySelectScreen';
import { BattleScreen } from './ui/BattleScreen';
import type { EnemyDef } from './data/types';

export default function App() {
  const [enemy, setEnemy] = useState<EnemyDef | null>(null);
  const [lastResult, setLastResult] = useState<'won' | 'lost' | null>(null);

  return (
    <div className="app-root">
      {!enemy && (
        <>
          {lastResult && (
            <p className="muted" style={{ textAlign: 'center', fontSize: '0.75rem' }}>
              前回の結果: {lastResult === 'won' ? '🎉 勝利' : '💀 敗北'}
            </p>
          )}
          <EnemySelectScreen onPick={setEnemy} />
        </>
      )}
      {enemy && (
        <BattleScreen
          enemy={enemy}
          onExit={(result) => {
            setLastResult(result);
            setEnemy(null);
          }}
        />
      )}
    </div>
  );
}
