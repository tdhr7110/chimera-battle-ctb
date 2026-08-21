import type { EnemyDef } from './types';

// ============================================================
// CTB再設計データ 第1弾(仕様書10章)。Excelの45敵を一括実装せず、
// CTBの違いが分かりやすい代表6タイプだけを採用する。
// 「高速型」「重量型」「CT遅延型」は仕様書の指示により必ず含める。
//
// 各moveのintentは行動順プレビュー上に常時表示する「敵の意図」タグ(仕様書11章)。
// telegraphは大技専用の追加警告文で、intentタグとは別に一度だけ表示する。
// ============================================================

export const ENEMIES: EnemyDef[] = [
  {
    id: 'wolf',
    name: '疾風狼',
    icon: '🐺',
    color: '#60a5fa',
    tier: 'normal',
    hp: 60,
    defense: 2,
    power: 9,
    evasionPct: 10,
    baseSpeed: 135,
    description: '【高速型】行動回数が多く、プレイヤーより複数回動くこともある。CTBの行動順が入り乱れる相手。',
    moves: [
      { id: 'wolf_bite', name: '牙', icon: '🦷', powerMult: 0.7, ctWeight: 'light', intent: 'ATTACK' },
      { id: 'wolf_pounce', name: '飛びかかり', icon: '🌀', powerMult: 1.1, ctWeight: 'standard', intent: 'ATTACK' },
      {
        id: 'wolf_howl',
        name: '遠吠え',
        icon: '🌙',
        powerMult: 0.2,
        ctWeight: 'light',
        intent: 'DEBUFF',
        applyStatus: { kind: 'vulnerable', magnitude: 20, turns: 2 },
      },
      {
        id: 'wolf_slash',
        name: '切り裂き',
        icon: '🩸',
        powerMult: 0.6,
        ctWeight: 'light',
        intent: 'ATTACK',
        applyStatus: { kind: 'bleed', magnitude: 3, turns: 4 },
      },
    ],
  },
  {
    id: 'golem',
    name: '鎧ゴーレム',
    icon: '🗿',
    color: '#f59e0b',
    tier: 'normal',
    hp: 150,
    defense: 6,
    power: 12,
    evasionPct: 0,
    baseSpeed: 70,
    description: '【重量型】非常に遅いが、「大地砕き」の一撃は重い。予兆を見て防御や遅延で備えたい相手。',
    moves: [
      { id: 'golem_smash', name: '殴打', icon: '👊', powerMult: 1.0, ctWeight: 'standard', intent: 'ATTACK' },
      {
        id: 'golem_earthbreak',
        name: '大地砕き',
        icon: '🌋',
        powerMult: 2.4,
        ctWeight: 'very_heavy',
        intent: 'STRONG',
        applyStatus: { kind: 'slow', magnitude: 25, turns: 2 },
        telegraph: '鎧ゴーレムが「大地砕き」の構え…!',
      },
    ],
  },
  {
    id: 'spider',
    name: '毒蜘蛛',
    icon: '🕷️',
    color: '#a855f7',
    tier: 'normal',
    hp: 70,
    defense: 2,
    power: 8,
    evasionPct: 6,
    baseSpeed: 100,
    description: '【毒型】牙に毒を仕込んでおり、放置すると毒ダメージが積み重なっていく。',
    moves: [
      { id: 'spider_bite', name: '毒牙', icon: '🦷', powerMult: 0.6, ctWeight: 'light', intent: 'POISON', applyStatus: { kind: 'poison', magnitude: 4, turns: 4 } },
      { id: 'spider_web', name: '糸絡め', icon: '🕸️', powerMult: 0.8, ctWeight: 'standard', intent: 'ATTACK' },
      {
        id: 'spider_drain',
        name: '魔喰い',
        icon: '🕳️',
        powerMult: 0.5,
        ctWeight: 'standard',
        intent: 'DEBUFF',
        applyStatus: { kind: 'mp_leak', magnitude: 4, turns: 3 },
      },
    ],
  },
  {
    id: 'chronomancer',
    name: '刻魔道士',
    icon: '🧙',
    color: '#38bdf8',
    tier: 'elite',
    hp: 95,
    defense: 4,
    power: 10,
    evasionPct: 5,
    baseSpeed: 100,
    description: '【CT遅延型】プレイヤーの行動順そのものを後ろへ送ってくる。速度で押し切る戦術への対策役。',
    moves: [
      { id: 'chrono_bolt', name: '刻の矢', icon: '🔹', powerMult: 0.8, ctWeight: 'standard', intent: 'ATTACK' },
      { id: 'chrono_delay', name: '時封じ', icon: '⏳', powerMult: 0.4, ctWeight: 'standard', intent: 'DELAY', delayTargetBy: 65 },
      {
        id: 'chrono_seal',
        name: '封魔の矢',
        icon: '🔇',
        powerMult: 0.5,
        ctWeight: 'standard',
        intent: 'DEBUFF',
        applyStatus: { kind: 'silence', magnitude: 1, turns: 2 },
      },
    ],
  },
  {
    id: 'mirror_beetle',
    name: '鏡甲虫',
    icon: '🪲',
    color: '#34d399',
    tier: 'elite',
    hp: 110,
    defense: 5,
    power: 9,
    evasionPct: 4,
    baseSpeed: 95,
    description: '【反撃型】攻撃を受けると即座に反撃してくる。強打などの一撃を叩き込む前に注意したい相手。',
    counter: { chancePct: 35, powerMult: 0.7 },
    moves: [
      { id: 'beetle_ram', name: '体当たり', icon: '💢', powerMult: 0.9, ctWeight: 'standard', intent: 'ATTACK' },
      { id: 'beetle_stance', name: '甲殻の構え', icon: '🛡️', powerMult: 0, ctWeight: 'light', intent: 'COUNTER_STANCE' },
    ],
  },
  {
    id: 'ancient_dragon',
    name: '古龍',
    icon: '🐉',
    color: '#fb7185',
    tier: 'boss',
    hp: 260,
    defense: 8,
    power: 14,
    evasionPct: 5,
    baseSpeed: 90,
    description: '【ボス型】力を溜めたあと放つ「滅びの咆哮」は事前に予告される。防御・遅延・加速・チャージのどれで備えるかが問われる。HP50%で行動パターンが変化する。',
    moves: [
      { id: 'dragon_claw', name: '爪撃', icon: '🐾', powerMult: 1.0, ctWeight: 'standard', intent: 'ATTACK' },
      { id: 'dragon_claw2', name: '尾撃', icon: '🦖', powerMult: 1.1, ctWeight: 'standard', intent: 'ATTACK' },
      {
        id: 'dragon_charge',
        name: '力を溜める',
        icon: '✨',
        powerMult: 0,
        ctWeight: 'light',
        intent: 'CHARGE',
        telegraph: '古龍が力を溜めている…！',
      },
      {
        id: 'dragon_ultimate',
        name: '滅びの咆哮',
        icon: '💀',
        powerMult: 3.2,
        ctWeight: 'very_heavy',
        intent: 'ULTIMATE',
        telegraph: '古龍が「滅びの咆哮」を放とうとしている…!!',
      },
    ],
    // フェーズ変化(新フック): HP50%以下になった瞬間、爪撃を捨てて業火の息(炎上蓄積)を
    // 主体とした攻撃的な行動パターンへ切り替わる。大技・チャージはフェーズ2でも健在。
    phases: [
      {
        hpPctThreshold: 50,
        announceText: '🔥 古龍が半身を焦がしながら牙を剥く…！行動パターンが変化した！',
        moves: [
          { id: 'dragon_claw2_p2', name: '尾撃', icon: '🦖', powerMult: 1.2, ctWeight: 'standard', intent: 'ATTACK' },
          {
            id: 'dragon_breath',
            name: '業火の息',
            icon: '🔥',
            powerMult: 1.6,
            ctWeight: 'standard',
            intent: 'STRONG',
            applyStatus: { kind: 'burn', magnitude: 5, turns: 3 },
          },
          {
            id: 'dragon_charge_p2',
            name: '力を溜める',
            icon: '✨',
            powerMult: 0,
            ctWeight: 'light',
            intent: 'CHARGE',
            telegraph: '古龍が力を溜めている…！',
          },
          {
            id: 'dragon_ultimate_p2',
            name: '滅びの咆哮',
            icon: '💀',
            powerMult: 3.4,
            ctWeight: 'very_heavy',
            intent: 'ULTIMATE',
            telegraph: '古龍が「滅びの咆哮」を放とうとしている…!!',
          },
        ],
      },
    ],
  },
];

export function getEnemy(id: string): EnemyDef | undefined {
  return ENEMIES.find((e) => e.id === id);
}
