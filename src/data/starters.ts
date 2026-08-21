// ============================================================
// 統合版(本編)の素体選択(仕様書27章)。
// 「固定の骨2本」のような決め打ち初期装備ではなく、プレイヤーが最初の方向性を
// 選べるようにする。部位80種(Excel正式マスター接続済み)の中から代表的な
// 組み合わせだけを用意する(Excelの本格的な素体データが揃うまでの暫定仕様)。
// ============================================================

export interface StarterDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  partIds: string[]; // 開始時点で装着済みの部位(0〜1個)
}

export const STARTERS: StarterDef[] = [
  {
    id: 'balanced',
    name: 'バランス個体',
    icon: '🧬',
    description: '無装備からスタート。装備の自由度が高く、拾った部位次第でどの方向にも育つ。',
    partIds: [],
  },
  {
    id: 'swift',
    name: '俊敏個体',
    icon: '🦵',
    description: '俊足脚を装着した状態で開始する。速度重視のCTBを最初から体感できる。',
    partIds: ['PRT029'],
  },
  {
    id: 'sturdy',
    name: '頑健個体',
    icon: '🦿',
    description: '重装脚を装着した状態で開始する。強打などの重量技を軸にした戦い方に向く。',
    partIds: ['PRT031'],
  },
  {
    id: 'arcane',
    name: '魔力個体',
    icon: '🔮',
    description: '魔力嚢を装着した状態で開始する。MPを多く使う戦術を最初から試しやすい。',
    partIds: ['PRT071'],
  },
];

export function getStarter(id: string): StarterDef | undefined {
  return STARTERS.find((s) => s.id === id);
}
