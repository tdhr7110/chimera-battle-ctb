import { useMemo, useState } from 'react';
import { PARTS } from '../data/parts';
import { activeSynergies } from '../engine/modifiers';
import type { PartDef } from '../data/types';

// ============================================================
// 仕様書13章「今回テストする代表ビルド」を実際に組めるようにするための、
// 最小限の装備選択画面。全80部位の本格的な装備UIはまだ作らず、
// 第1弾10部位から最大2個を選ぶだけの検証用インターフェースにしている。
// ============================================================

const PRESETS: { label: string; description: string; partIds: string[] }[] = [
  { label: 'A: 高速型', description: '俊足脚 + 六節脚 — 敵より多く行動できるか確認する', partIds: ['swift_legs', 'six_legs'] },
  { label: 'B: 重量型', description: '豪腕 + 重装脚 — 行動回数を犠牲に大ダメージを狙う', partIds: ['giant_arm', 'heavy_legs'] },
  { label: 'C: CT妨害型', description: '時喰い眼 — 遅延打撃・加速で行動順を操作する', partIds: ['time_eye'] },
  { label: 'D: MP循環型', description: '第二心臓 + 魔力嚢 — MPを回しながら高性能技を使う', partIds: ['second_heart', 'mana_sac'] },
];

const MAX_EQUIPPED = 2;

export function PrepScreen({ onReady }: { onReady: (parts: PartDef[]) => void }) {
  const [equippedIds, setEquippedIds] = useState<string[]>([]);

  const equippedParts = useMemo(() => equippedIds.map((id) => PARTS.find((p) => p.id === id)!).filter(Boolean), [equippedIds]);
  const synergies = useMemo(() => activeSynergies(equippedParts), [equippedParts]);

  function toggle(id: string) {
    setEquippedIds((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= MAX_EQUIPPED) return [prev[1], id]; // 3個目は最も古いものと入れ替える
      return [...prev, id];
    });
  }

  return (
    <div className="select-screen">
      <h1>⏱️ キメラバトル CTB 再設計データ 第1弾</h1>
      <p className="select-screen__lead">
        まず部位を最大{MAX_EQUIPPED}個まで装着してください(0個でも戦闘可能です)。仕様書13章の代表ビルドはプリセットから一発で組めます。
      </p>

      <div className="preset-row">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="preset-btn" onClick={() => setEquippedIds(p.partIds)} title={p.description}>
            {p.label}
          </button>
        ))}
        <button type="button" className="preset-btn preset-btn--clear" onClick={() => setEquippedIds([])}>
          装備なし
        </button>
      </div>

      <div className="part-grid">
        {PARTS.map((part) => {
          const selected = equippedIds.includes(part.id);
          return (
            <button key={part.id} type="button" className={`part-card${selected ? ' part-card--selected' : ''}`} onClick={() => toggle(part.id)}>
              <div className="part-card__head">
                <span className="part-card__icon">{part.icon}</span>
                {part.name}
              </div>
              <div className="part-card__desc">{part.description}</div>
            </button>
          );
        })}
      </div>

      {synergies.length > 0 && (
        <div className="synergy-panel">
          <div className="synergy-panel__title">🔗 発動中のシナジー</div>
          {synergies.map((s) => (
            <div key={s.id} className="synergy-panel__item">
              <strong>{s.name}</strong> — {s.description}
            </div>
          ))}
        </div>
      )}

      <button type="button" className="btn btn--primary btn--block" onClick={() => onReady(equippedParts)}>
        次へ(敵を選ぶ) ▶
      </button>
    </div>
  );
}
