import { getPart } from '../data/parts';
import { getFusionRecipe } from '../data/fusions';
import { AcquireBurst, type BurstTone } from './AcquireBurst';
import { describeEffect } from './FusionScreen';

// ============================================================
// 融合成立の演出。部位獲得と同じ AcquireBurst に乗せているが、
// 融合は「素材2つが1つになった」ことが見えないと納得できないので、
// 素材 → 結果 の一行を演出の中に入れてある。
//
// レア度に応じて演出のトーンが変わる(Legendaryが最も派手)。自動送りはせず、
// タップで閉じる(engine側の dismissFusionResult が次の行き先を決める)。
// ============================================================

export function FusionResultScreen({ partId, onDone }: { partId: string; onDone: () => void }) {
  const recipe = getFusionRecipe(partId);
  if (!recipe) return null;
  const part = recipe.result;
  const materials = (recipe.match.kind === 'part' ? [recipe.match.a, recipe.match.b] : [])
    .map((id) => getPart(id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  return (
    <AcquireBurst
      tone={part.rarity.toLowerCase() as BurstTone}
      icon={part.icon}
      title={part.name}
      subtitle={`${part.type} ・ ${part.tags.join(' / ')}`}
      badge={part.rarity}
      banner="融合成功！"
      hint="タップして次へ"
      onDone={onDone}
    >
      <div className="burst__fusion-from">
        {materials.length === 2
          ? `${materials[0].icon} ${materials[0].name} ＋ ${materials[1].icon} ${materials[1].name}`
          : recipe.requirementLabel}
        {' → '}
        <strong>
          {part.icon} {part.name}
        </strong>
      </div>
      <div className="burst__desc">{part.description}</div>
      <ul className="burst__effects">
        {part.effects.map((e, i) => (
          <li key={i}>{describeEffect(e)}</li>
        ))}
      </ul>
    </AcquireBurst>
  );
}
