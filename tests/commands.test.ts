// ============================================================
// 「情報・かく乱」系コマンド(MP吸収/挑発/観察/解析/変異)の検証。
//
// どれもExcel「コマンド」シートの効果列をそのまま実装したものなので、
// 確かめるのは「効果列に書いてあることが実際に起きるか」だけ。
//   CMD025 MP吸収  敵MPを奪う
//   CMD049 挑発    敵の強攻撃を誘発し予測可能化
//   CMD050 観察    敵の次2行動を詳細表示
//   CMD051 解析    敵弱点を暴き与ダメUP
//   CMD054 変異    戦闘中ランダム部位効果を一時獲得
// 適応(CMD053)は属性システムを要するため未実装のまま。ここでも検証しない。
// ============================================================
import { CtbEngine } from '../src/engine/ctbEngine.ts';
import { COMMANDS, getCommand } from '../src/data/commands.ts';
import { ENEMIES, getEnemy } from '../src/data/enemies.ts';
import { PARTS } from '../src/data/parts.ts';
import type { EnemyDef, PartDef } from '../src/data/types.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('OK:', msg);
}

function enemy(id: string): EnemyDef {
  const e = getEnemy(id);
  if (!e) throw new Error(`missing enemy ${id}`);
  return e;
}

// 段階解放を迂回して全コマンドを撃てるエンジン。装備を積むとシナジーが乗って
// 数値が動いてしまうので、解放集合だけ差し替える(engine.test.ts と同じ手)。
function mk(def: EnemyDef, parts: PartDef[] = []): CtbEngine {
  const e = new CtbEngine(def, parts);
  (e as unknown as { unlockedCommandIds: Set<string> }).unlockedCommandIds = new Set(COMMANDS.map((c) => c.id));
  e.revealOrder();
  e.beginFirstTurn();
  if (e.getSnapshot().phase === 'enemy_first_announce') e.resolveAnnouncedEnemyTurn();
  return e;
}

/** プレイヤーの手番が来るまで進める(来なければ false)。 */
function toPlayerTurn(e: CtbEngine): boolean {
  for (let i = 0; i < 40; i++) {
    const s = e.getSnapshot();
    if (s.status !== 'ongoing') return false;
    if (s.phase === 'player_turn') return true;
    if (s.phase === 'enemy_first_announce') { e.resolveAnnouncedEnemyTurn(); continue; }
    if (s.phase === 'enemy_pending') { e.stepEnemyTurn(); continue; }
    return false;
  }
  return false;
}

// ------------------------------------------------------------
// データ側: Excelの列がコードへ届いているか
// ------------------------------------------------------------
const noMp = ENEMIES.filter((e) => !e.maxMp || e.maxMp <= 0);
assert(noMp.length === 0, `全45体にExcel由来の最大MPが入っている (欠け: ${noMp.length})`);

const noWeak = ENEMIES.filter((e) => !e.weakness);
assert(noWeak.length === 0, `全45体にExcel由来の弱点が入っている (欠け: ${noWeak.length})`);

const withDanger = ENEMIES.filter((e) => e.moves.some((m) => m.mpCost));
assert(withDanger.length === ENEMIES.length, `全45体の危険技に消費MPが付いている (${withDanger.length}/${ENEMIES.length})`);

const costOk = ENEMIES.every((e) => e.moves.every((m) => !m.mpCost || m.mpCost <= e.maxMp));
assert(costOk, '危険技の消費MPが最大MPを超えていない(初手から撃てない敵がいない)');

const freeFallback = ENEMIES.every((e) => e.moves.some((m) => !m.mpCost));
assert(freeFallback, '全45体にMP不要の技が最低1つある(MP切れで手が止まらない)');

// ------------------------------------------------------------
// CMD025 MP吸収: 敵MPを奪い、自分のMPにする
// ------------------------------------------------------------
{
  const e = mk(enemy('ENM003'));
  assert(toPlayerTurn(e), 'MP吸収: プレイヤーの手番まで進む');
  const before = e.getSnapshot();
  const enemyMpBefore = before.enemyMp.current;
  const myMpBefore = before.mp.current;
  assert(enemyMpBefore > 0, `敵は最初からMPを持っている (${enemyMpBefore}/${before.enemyMp.max})`);

  const res = e.useCommand('CMD025', { stepwise: true });
  assert(res.ok, `MP吸収が使える (${res.reason ?? ''})`);
  const after = e.getSnapshot();
  const drained = enemyMpBefore - after.enemyMp.current;
  assert(drained > 0, `敵のMPが減る (${enemyMpBefore} -> ${after.enemyMp.current})`);
  assert(drained <= (getCommand('CMD025')!.drainEnemyMp ?? 0), `奪う量が定義値を超えない (${drained})`);
  // 自分は8払って12奪うので、差し引きで増えているはず(上限に当たっていない限り)
  assert(
    after.mp.current >= myMpBefore - getCommand('CMD025')!.mpCost + drained - 1,
    `奪ったMPが自分のMPへ移る (${myMpBefore} -> ${after.mp.current})`
  );
  assert(after.enemy.hp < before.enemy.hp, 'MP吸収はダメージも与える');
}

// MPを削り切ると危険技が撃てなくなる
{
  const def = enemy('ENM002');
  const e = mk(def);
  const inner = e as unknown as { enemy: { mp: number; moveIndex: number } };
  const danger = def.moves.find((m) => m.mpCost)!;
  inner.enemy.mp = 0;
  // 危険技の番までmoveIndexを進める
  inner.enemy.moveIndex = def.moves.indexOf(danger);
  const shown = e.getSnapshot().nextEnemyAction;
  assert(shown !== null && shown.moveName !== danger.name, `MP0では危険技が予告に出ない (${shown?.moveName})`);

  inner.enemy.mp = danger.mpCost!;
  const shown2 = e.getSnapshot().nextEnemyAction;
  assert(shown2?.moveName === danger.name, `MPが足りれば危険技が予告に戻る (${shown2?.moveName})`);
}

// ------------------------------------------------------------
// CMD049 挑発: 次の1手が「いま撃てる最も強い技」に固定され、予告に出る
// ------------------------------------------------------------
{
  const def = enemy('ENM002');
  const e = mk(def);
  assert(toPlayerTurn(e), '挑発: プレイヤーの手番まで進む');
  const strongest = [...def.moves].sort((a, b) => b.powerMult - a.powerMult)[0];

  const before = e.getSnapshot().nextEnemyAction;
  const res = e.useCommand('CMD049', { stepwise: true });
  assert(res.ok, `挑発が使える (${res.reason ?? ''})`);
  const after = e.getSnapshot().nextEnemyAction;
  assert(after?.moveName === strongest.name, `挑発すると最強技が予告される (${before?.moveName} -> ${after?.moveName})`);

  // 予告どおりの技が実際に来る(= 予測可能化)
  const hpBefore = e.getSnapshot().player.hp;
  if (e.getSnapshot().phase === 'enemy_pending') e.stepEnemyTurn();
  const log = e.getSnapshot().log.join('\n');
  assert(log.includes('挑発に乗って'), '挑発を受けた敵はログに残る');
  assert(log.includes(strongest.name), `予告どおりの技が来る (${strongest.name})`);
  assert(e.getSnapshot().player.hp < hpBefore, '強攻撃なので実際にダメージを受ける');

  // 挑発は1手ぶんだけ。次の手はまた通常のパターンへ戻る
  assert(!(e as unknown as { enemy: { tauntPending: boolean } }).enemy.tauntPending, '挑発の効果は1手で切れる');
}

// ------------------------------------------------------------
// CMD050 観察: 敵の次2行動を詳細表示する
// ------------------------------------------------------------
{
  const e = mk(enemy('ENM001'));
  assert(toPlayerTurn(e), '観察: プレイヤーの手番まで進む');
  assert(e.getSnapshot().observedEnemyActions.length === 0, '観察前は詳細表示が無い');

  const res = e.useCommand('CMD050', { stepwise: true });
  assert(res.ok, `観察が使える (${res.reason ?? ''})`);
  const seen = e.getSnapshot().observedEnemyActions;
  assert(seen.length === 2, `観察すると敵の次2手が読める (${seen.length}手)`);
  assert(seen.every((a) => a.moveName.length > 0), '読めた手には技名が入っている');
  assert(seen[0].moveName !== undefined && seen[1].moveName !== undefined, '2手とも中身がある');
  assert(getCommand('CMD050')!.mpCost === 0, '観察はMPを使わない');

  // 敵が1手動くたびに1つ減り、2手で切れる
  if (e.getSnapshot().phase === 'enemy_pending') e.stepEnemyTurn();
  const left = e.getSnapshot().observedEnemyActions.length;
  assert(left === 1, `敵が動くと残りが減る (2 -> ${left})`);
}

// ------------------------------------------------------------
// CMD051 解析: 弱点を暴き、与ダメージを上げる
// ------------------------------------------------------------
{
  const def = enemy('ENM002');
  const cmd = getCommand('CMD051')!;

  // 解析なしで通常攻撃したときのダメージ
  const plain = mk(def);
  toPlayerTurn(plain);
  const hp0 = plain.getSnapshot().enemy.hp;
  plain.useCommand('CMD001', { stepwise: true });
  const plainDmg = hp0 - plain.getSnapshot().enemy.hp;

  // 解析してから同じ通常攻撃
  const analyzed = mk(def);
  toPlayerTurn(analyzed);
  const res = analyzed.useCommand('CMD051', { stepwise: true });
  assert(res.ok, `解析が使える (${res.reason ?? ''})`);
  const info = analyzed.getSnapshot().enemyAnalysis;
  assert(info !== null, '解析中であることが表に出る');
  assert(info?.weakness === def.weakness, `Excelの弱点がそのまま出る (${info?.weakness})`);
  assert(info?.damageBonusPct === cmd.analyzeEnemy?.damageBonusPct, `与ダメージ強化量が定義どおり (+${info?.damageBonusPct}%)`);

  assert(toPlayerTurn(analyzed), '解析後もプレイヤーの手番へ戻る');
  const hp1 = analyzed.getSnapshot().enemy.hp;
  analyzed.useCommand('CMD001', { stepwise: true });
  const analyzedDmg = hp1 - analyzed.getSnapshot().enemy.hp;
  assert(analyzedDmg > plainDmg, `解析後は同じ攻撃が強くなる (${plainDmg} -> ${analyzedDmg})`);

  // ターン数が切れると効果も消える
  const forced = analyzed as unknown as { enemy: { analyzed: { turns: number } | null } };
  forced.enemy.analyzed = { turns: 1 } as never;
  (forced as unknown as { tickStatusesAtTurnStart: (s: string) => void }).tickStatusesAtTurnStart('player');
  assert(analyzed.getSnapshot().enemyAnalysis === null, '解析は時間で切れる');
}

// ------------------------------------------------------------
// CMD054 変異: この戦闘のあいだランダムな部位効果を1つ得る
// ------------------------------------------------------------
{
  const e = mk(enemy('ENM001'));
  assert(toPlayerTurn(e), '変異: プレイヤーの手番まで進む');
  assert(e.getSnapshot().mutations.length === 0, '変異前は何も得ていない');

  const res = e.useCommand('CMD054', { stepwise: true });
  assert(res.ok, `変異が使える (${res.reason ?? ''})`);
  const got = e.getSnapshot().mutations;
  assert(got.length === 1, `変異で効果を1つ得る (${got.join(' / ')})`);
  assert(got[0].length > 0, '得た効果に表示名がある');

  // 重ねがけできる。引くものが毎回同じとは限らないので、増えることだけ見る。
  // 変異はMP28なので、2回目を撃つためにMPだけ足しておく(検証したいのは重ねがけの可否)。
  assert(toPlayerTurn(e), '変異: 2回目の手番まで進む');
  (e as unknown as { mp: number }).mp = 99;
  const res2 = e.useCommand('CMD054', { stepwise: true });
  assert(res2.ok, `変異を2回目も使える (${res2.reason ?? ''})`);
  assert(e.getSnapshot().mutations.length === 2, `変異は重ねがけできる (${e.getSnapshot().mutations.join(' / ')})`);

  // 何を引いても実際にPlayerModifiersへ乗っている(=表示だけの飾りではない)
  const mods = (e as unknown as { player: { mods: Record<string, number> } }).player.mods;
  const touched = Object.values(mods).some((v) => typeof v === 'number' && v !== 0);
  assert(touched, '変異の効果がプレイヤーの補正値に実際に乗る');
}

// ------------------------------------------------------------
// 未実装のまま残しているのは適応(CMD053)だけであること
// ------------------------------------------------------------
{
  const unimplemented = COMMANDS.filter((c) => c.description.includes('未実装'));
  assert(
    unimplemented.length === 1 && unimplemented[0].id === 'CMD053',
    `未実装と書かれているのは適応だけ (${unimplemented.map((c) => `${c.id} ${c.name}`).join(', ')})`
  );
}

// ------------------------------------------------------------
// AUTO が新コマンドを妥当に扱うか
//
// 挑発と観察はAUTOには使いこなせない(挑発は最強技を呼び込むだけ、観察は情報を
// 活かす先が無い)ので、選択肢に入っていても選ばないことを確かめる。
// ------------------------------------------------------------
{
  const picks = new Map<string, number>();
  let turns = 0;
  // 判断を見たいので、実戦に近い装備(レア度上位6個)を積んだ状態で回す。
  const rank: Record<string, number> = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 };
  const loadout = [...PARTS].sort((a, b) => rank[b.rarity] - rank[a.rarity]).slice(0, 6);
  for (const def of ENEMIES) {
    const e = mk(def, loadout);
    for (let i = 0; i < 60; i++) {
      const s = e.getSnapshot();
      if (s.status !== 'ongoing' || s.phase !== 'player_turn') {
        if (s.phase === 'enemy_pending') { e.stepEnemyTurn(); continue; }
        break;
      }
      const cmd = e.decideAutoCommand();
      picks.set(cmd.id, (picks.get(cmd.id) ?? 0) + 1);
      turns += 1;
      e.useCommand(cmd.id, { stepwise: true });
    }
  }
  assert(turns > 100, `AUTOの手を十分な数だけ観測できた (${turns}手)`);
  assert((picks.get('CMD049') ?? 0) === 0, `AUTOは挑発を選ばない (${picks.get('CMD049') ?? 0}回)`);
  assert((picks.get('CMD050') ?? 0) === 0, `AUTOは観察を選ばない (${picks.get('CMD050') ?? 0}回)`);
  // 解析とMP吸収は状況次第で選ぶ。まったく選ばないなら評価式が死んでいる。
  assert(
    (picks.get('CMD051') ?? 0) + (picks.get('CMD025') ?? 0) > 0,
    `AUTOは解析やMP吸収を状況に応じて選ぶ (解析${picks.get('CMD051') ?? 0} / MP吸収${picks.get('CMD025') ?? 0})`
  );
}
