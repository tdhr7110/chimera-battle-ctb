import type { EnemyDef } from './types';

// ============================================================
// 仕様書20章「敵側」: 敵ごとに速度・通常技・重量技・高速技・状態異常を持たせ、
// CTB上で個性が出るようにする。3体だけの検証用プリセット。
// ============================================================

export const ENEMIES: EnemyDef[] = [
  {
    id: 'slime',
    name: 'スライム',
    icon: '🟢',
    color: '#4ade80',
    hp: 55,
    defense: 1,
    power: 7,
    evasionPct: 4,
    baseSpeed: 105,
    description: '軽量級。攻撃は軽いが手数が多く、行動順を乱してくる。',
    moves: [
      { id: 'slime_bite', name: '体当たり', icon: '💢', powerMult: 0.9, ctWeight: 'standard' },
      { id: 'slime_splash', name: '連続飛沫', icon: '💦', powerMult: 0.5, ctWeight: 'light' },
    ],
  },
  {
    id: 'golem',
    name: '鎧ゴーレム',
    icon: '🗿',
    color: '#f59e0b',
    hp: 150,
    defense: 6,
    power: 12,
    evasionPct: 0,
    baseSpeed: 70,
    description: '重量級。「大地砕き」の予兆が出たら防御や回避の判断が問われる。',
    moves: [
      { id: 'golem_smash', name: '殴打', icon: '👊', powerMult: 1.0, ctWeight: 'standard' },
      {
        id: 'golem_earthbreak',
        name: '大地砕き',
        icon: '🌋',
        powerMult: 2.4,
        ctWeight: 'very_heavy',
        telegraph: '鎧ゴーレムが「大地砕き」の構え…!',
      },
    ],
  },
  {
    id: 'wolf',
    name: '疾風狼',
    icon: '🐺',
    color: '#60a5fa',
    hp: 60,
    defense: 2,
    power: 9,
    evasionPct: 10,
    baseSpeed: 135,
    description: '高速級。行動回数が多く、CTBの行動順が入り乱れる相手。',
    moves: [
      { id: 'wolf_bite', name: '牙', icon: '🦷', powerMult: 0.7, ctWeight: 'light' },
      { id: 'wolf_pounce', name: '飛びかかり', icon: '🌀', powerMult: 1.1, ctWeight: 'standard' },
      { id: 'wolf_howl', name: '遠吠え', icon: '🌙', powerMult: 0.25, ctWeight: 'light' },
    ],
  },
];

export function getEnemy(id: string): EnemyDef | undefined {
  return ENEMIES.find((e) => e.id === id);
}
