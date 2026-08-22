import { useEffect, useState } from 'react';
import { getPart } from '../data/parts';
import type { FusionCandidate } from '../data/fusions';
import type { PartDef, PartEffect } from '../data/types';

// ============================================================
// 部位融合(レシピ制)。
//
// 「あらかじめ決まった素材が揃った」ときにだけ開く画面なので、この画面は
// 素材を探させない。成立しているレシピを並べ、素材2つ → 融合部位 を見せて
// 「融合する / あとにする」を選ばせるだけにしてある。
//
//   - 強制しない。「あとにする」を選べば素材のまま持ち続けられる
//   - 断ったレシピは以後この画面に出ない(engine側の declinedFusionIds)
//   - 結果はExcel「融合」シートのレシピ表で決まる(ランダム生成ではない)
//   - 表示する効果は現行のPartEffectで実装済みのものだけ
// ============================================================

const RARITY_LABEL: Record<string, string> = {
  Rare: 'RARE',
  Epic: 'EPIC',
  Legendary: 'LEGENDARY',
  Common: 'COMMON',
};

export function FusionScreen({
  candidates,
  equippedPartIds,
  onFuse,
  onDecline,
}: {
  candidates: FusionCandidate[];
  equippedPartIds: string[];
  onFuse: (recipeId: string) => void;
  onDecline: (recipeId: string) => void;
}) {
  // 一番おいしい融合(レア度が高い順に並んでいる)を最初から開いておく。
  const [selectedId, setSelectedId] = useState(() => candidates[0]?.recipe.id ?? '');
  useEffect(() => {
    if (!candidates.some((c) => c.recipe.id === selectedId)) setSelectedId(candidates[0]?.recipe.id ?? '');
  }, [candidates, selectedId]);

  const current = candidates.find((c) => c.recipe.id === selectedId) ?? candidates[0];
  if (!current) return null;

  const { recipe } = current;
  const materials = current.materialIds.map((id) => getPart(id)).filter((p): p is PartDef => !!p);
  const losesEquipped = current.materialIds.some((id) => equippedPartIds.includes(id));
  const rarity = recipe.rarity.toLowerCase();

  return (
    <div className={`fusion-screen fusion-screen--${rarity}`}>
      <div className="fusion-screen__head">
        <div className="fusion-screen__title">🧪 融合できる部位がある</div>
        <div className="fusion-screen__sub">{recipe.requirementLabel}を持っている。</div>
      </div>

      {candidates.length > 1 && (
        <div className="fusion-tabs">
          {candidates.map((c) => (
            <button
              key={c.recipe.id}
              type="button"
              className={`fusion-tab fusion-tab--${c.recipe.rarity.toLowerCase()}${
                c.recipe.id === current.recipe.id ? ' fusion-tab--on' : ''
              }`}
              onClick={() => setSelectedId(c.recipe.id)}
            >
              <span className="fusion-tab__icon">{c.recipe.icon}</span>
              <span className="fusion-tab__name">{c.recipe.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="fusion-flow">
        <div className="fusion-flow__materials">
          {materials.map((part, i) => (
            <div key={part.id} className={`fusion-mat fusion-mat--${part.rarity.toLowerCase()}`}>
              {i > 0 && <div className="fusion-mat__plus">＋</div>}
              <div className="fusion-mat__icon">{part.icon}</div>
              <div className="fusion-mat__name">{part.name}</div>
              <div className="fusion-mat__type">{part.type}</div>
              {equippedPartIds.includes(part.id) && <div className="fusion-mat__equipped">装着中</div>}
            </div>
          ))}
        </div>

        <div className="fusion-flow__arrow" aria-hidden>
          ▼
        </div>

        <div className={`fusion-out fusion-out--${rarity}`}>
          <div className="fusion-out__badge">{RARITY_LABEL[recipe.rarity] ?? recipe.rarity}</div>
          <div className="fusion-out__icon">{recipe.icon}</div>
          <div className="fusion-out__name">{recipe.result.name}</div>
          <div className="fusion-out__type">
            {recipe.result.type} ・ {recipe.result.tags.join(' / ')}
          </div>
          <div className="fusion-out__desc">{recipe.result.description}</div>
          <ul className="fusion-out__effects">
            {recipe.result.effects.map((e, i) => (
              <li key={i}>{describeEffect(e)}</li>
            ))}
          </ul>
        </div>
      </div>

      {losesEquipped && <div className="fusion-warn">⚠️ 装着中の部位が素材として失われます。</div>}

      <div className="fusion-actions">
        <button type="button" className="btn btn--primary btn--block" onClick={() => onFuse(recipe.id)}>
          🧪 融合する
        </button>
        <button type="button" className="btn btn--block" onClick={() => onDecline(recipe.id)}>
          あとにする
        </button>
      </div>
    </div>
  );
}

// PartEffectを日本語1行に説明する。ここに書けるのは実際にengineが解決する効果だけ
// (fusions.tsが現行のPartEffectしか使わないので、未実装の効果が文章に出ることはない)。
export function describeEffect(e: PartEffect): string {
  switch (e.kind) {
    case 'power_bonus_all_pct':
      return `全攻撃の威力 +${e.pct}%`;
    case 'power_bonus_light_pct':
      return `軽量攻撃の威力 +${e.pct}%`;
    case 'on_hit_apply_status':
      return `命中時に ${e.status.kind}（${e.status.magnitude}・${e.status.turns}ターン）を付与`;
    case 'status_magnitude_bonus':
      return `自分が与える ${e.target} の量 +${e.flatAmount ?? 0}`;
    case 'speed_flat':
      return `速度 +${e.amount}`;
    case 'defense_flat_bonus':
      return `防御力 +${e.amount}`;
    case 'delay_effect_bonus_pct':
      return `遅延効果量 +${e.pct}%`;
    case 'max_mp_bonus':
      return `最大MP +${e.amount}`;
    case 'max_hp_bonus':
      return `最大HP +${e.amount}`;
    case 'low_hp_ct_bonus':
      return `HP${e.hpPctThreshold}%以下でCT ${e.ctMultPct}%`;
    case 'passive_regen_per_turn':
      return `手番開始時にHP +${e.amount}`;
    case 'reflect_on_hit_pct':
      return `被弾するたびダメージの ${e.pct}% を反射`;
    case 'lifesteal_bonus_pct':
      return `吸血の回復量 +${e.pct}%`;
    case 'on_kill_mp_gain':
      return `敵撃破時に MP +${e.amount}`;
    case 'bonus_hits_flat':
      return `多段コマンドのヒット数 +${e.amount}`;
    case 'utility_ct_bonus_pct':
      return `補助コマンドのCT ${e.pct}%`;
    case 'ignore_defense_pct':
      return `敵防御力の ${e.pct}% を無視`;
    case 'accuracy_bonus_pct':
      return `命中率 +${e.pct}%`;
    case 'ct_mult_all_pct':
      return `全行動のCT ${e.pct}%`;
    case 'execute_bonus_passive':
      return `HP${e.hpPctThreshold}%以下の敵へ威力 ${e.bonusMult}倍`;
    case 'on_kill_ct_bonus_pct':
      return `敵撃破時に次の行動が ${e.pct}% 早まる`;
    default:
      return e.kind;
  }
}
