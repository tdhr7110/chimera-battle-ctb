import { STARTERS } from '../data/starters';

// 仕様書27章: 固定装備で始めず、プレイヤーが初期素体を選べるようにする。
export function StarterSelectScreen({ onPick }: { onPick: (starterId: string) => void }) {
  return (
    <div className="select-screen">
      <h1>🧬 素体を選択</h1>
      <p className="select-screen__lead">最初のキメラの方向性を選んでください。装備は戦闘待機画面でいつでも組み替えられます。</p>
      <div className="starter-grid">
        {STARTERS.map((s) => (
          <button key={s.id} type="button" className="starter-card" onClick={() => onPick(s.id)}>
            <div className="starter-card__icon">{s.icon}</div>
            <div className="starter-card__name">{s.name}</div>
            <div className="starter-card__desc">{s.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
