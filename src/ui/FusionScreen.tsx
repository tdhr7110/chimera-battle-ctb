import { useMemo, useState } from 'react';
import { getPart } from '../data/parts';
import { fusionResultFor, ownedPartIds, type RunState } from '../engine/run';

// ============================================================
// Phase 5: 任意の部位融合。エリート撃破後にだけ提示される、飛ばしてよい寄り道。
//
// 過去版(TEST16)の融合をそのまま持ち込まず、CTB向けに以下だけへ絞っている:
//   - 強制しない(「そのまま進む」が常に選べる)
//   - 素材は所持部位から2つ。装備中の部位を素材にする場合だけ確認を挟む
//   - 結果はExcel「融合」シートのルール表で決まる(ランダム生成ではない)
//   - 得られる効果は現行のPartEffectで実装済みのものだけ。説明文だけの効果は出さない
// ============================================================

export function FusionScreen({
  state,
  onFuse,
  onSkip,
}: {
  state: RunState;
  onFuse: (partIdA: string, partIdB: string) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmEquipped, setConfirmEquipped] = useState(false);

  const owned = useMemo(() => ownedPartIds(state), [state.equippedPartIds, state.inventoryPartIds]);
  const [a, b] = picked;
  const preview = a && b ? fusionResultFor(a, b) : undefined;
  const alreadyHas = preview ? owned.includes(preview.id) : false;
  const usesEquipped = picked.some((id) => state.equippedPartIds.includes(id));

  function toggle(id: string) {
    setConfirmEquipped(false);
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 2 ? cur : [...cur, id]));
  }

  function handleFuse() {
    if (!preview || alreadyHas) return;
    // 装備中の部位を素材にする場合だけ、一度だけ確認を挟む。
    if (usesEquipped && !confirmEquipped) {
      setConfirmEquipped(true);
      return;
    }
    onFuse(a, b);
  }

  return (
    <div className="fusion-screen">
      <div className="fusion-screen__title">🧪 部位融合（任意）</div>
      <div className="fusion-screen__sub">
        エリートを倒した。部位を2つ融合できる（1回だけ）。融合しないで進んでもよい。
      </div>

      <div className="fusion-picker">
        {owned.map((id) => {
          const part = getPart(id);
          if (!part) return null;
          const on = picked.includes(id);
          const equipped = state.equippedPartIds.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={`fusion-part${on ? ' fusion-part--picked' : ''}`}
              onClick={() => toggle(id)}
            >
              <span className="fusion-part__icon">{part.icon}</span>
              <span className="fusion-part__name">{part.name}</span>
              {equipped && <span className="fusion-part__equipped">装着中</span>}
            </button>
          );
        })}
      </div>

      <div className="fusion-result">
        {!preview && <p className="muted">素材を2つ選ぶと、何になるかがここに出ます。</p>}
        {preview && (
          <>
            <div className="fusion-result__head">
              <span className="fusion-result__icon">{preview.result.icon}</span>
              <strong>{preview.result.name}</strong>
              <span className="fusion-result__type">{preview.result.type}</span>
            </div>
            <div className="fusion-result__desc">{preview.result.description}</div>
            <ul className="fusion-result__effects">
              {preview.result.effects.map((e, i) => (
                <li key={i}>{describeEffect(e)}</li>
              ))}
            </ul>
            {alreadyHas && <div className="fusion-result__warn">⚠️ この融合部位はすでに持っています。別の組み合わせを選んでください。</div>}
            {usesEquipped && confirmEquipped && !alreadyHas && (
              <div className="fusion-result__warn">
                ⚠️ 装着中の部位が素材として失われます。もう一度「融合する」を押すと実行します。
              </div>
            )}
          </>
        )}
      </div>

      <div className="fusion-actions">
        <button
          type="button"
          className="btn btn--primary btn--block"
          disabled={!preview || alreadyHas}
          onClick={handleFuse}
        >
          🧪 融合する
        </button>
        <button type="button" className="btn btn--block" onClick={onSkip}>
          そのまま進む
        </button>
      </div>
    </div>
  );
}

// PartEffectを日本語1行に説明する。ここに書けるのは実際にengineが解決する効果だけ
// (fusions.tsが現行のPartEffectしか使わないので、未実装の効果が文章に出ることはない)。
function describeEffect(e: import('../data/types').PartEffect): string {
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
    default:
      return e.kind;
  }
}
