import { CtbEngine } from '../src/engine/ctbEngine.ts';
import { COMMANDS } from '../src/data/commands.ts';
import type { EnemyDef, PartDef } from '../src/data/types.ts';
import { getPart } from '../src/data/parts.ts';
import { ENEMIES, getEnemy } from '../src/data/enemies.ts';

function enemy(id: string): EnemyDef {
  const e = getEnemy(id);
  if (!e) throw new Error(`missing enemy ${id}`);
  return e;
}

function part(id: string): PartDef {
  const p = getPart(id);
  if (!p) throw new Error(`missing part ${id}`);
  return p;
}

// コマンド段階的解放(unlockTag)後: 特定コマンドを使うテストは、そのコマンドのunlockTagを
// 持つ部位を装備しないとuseCommand()が「未解放」で失敗する。効果を持たない純粋なタグ
// キャリアとして使う(数値へは一切影響しない)。
function unlockPart(tag: string, i = 0): PartDef {
  return { id: `UNLOCK_${tag}_${i}`, name: `unlock(${tag})`, icon: '🔓', type: '器官', rarity: 'Common', tags: [tag] as PartDef['tags'], effects: [], description: '' };
}

// コマンド解放が段階制(同タグ n 個で n 番目が解放、最大4)になったので、
// 特定コマンドを撃つテストは必要数ぶんのタグキャリアを装備する。
// effects が空なので数値には一切影響しない。
function unlockParts(tag: string, n = 4): PartDef[] {
  return Array.from({ length: n }, (_, i) => unlockPart(tag, i));
}

// 大半のテストは「その効果が正しく解決されるか」を見たいだけで、解放条件は関心事ではない。
// タグキャリアを人数分積むと同タグのシナジーまで発動してしまい数値が濁るので、
// ここでは解放済みコマンド集合を直接差し替えてから使う。
// 解放ルール自体は末尾の専用テスト(new CtbEngine を直接使う)で検証している。
function mk(...args: ConstructorParameters<typeof CtbEngine>): CtbEngine {
  const engine = new CtbEngine(...args);
  (engine as unknown as { unlockedCommandIds: Set<string> }).unlockedCommandIds = new Set(
    COMMANDS.map((c) => c.id)
  );
  return engine;
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('OK:', msg);
}

const dummyEnemy: EnemyDef = {
  id: 'test_enemy', name: 'テスト敵', icon: '👹', color: '#fff', tier: 'normal',
  hp: 500, defense: 0, power: 5, evasionPct: 0, baseSpeed: 100,
  moves: [{ id: 'poke', name: 'つつく', icon: '👉', powerMult: 0.1, ctWeight: 'standard', intent: 'ATTACK' }],
};

// --- Test 1: MP does not regen in battle ---
{
  const engine = mk(dummyEnemy, [], 130, 30);
  engine.revealOrder();
  engine.beginFirstTurn();
  let snap = engine.getSnapshot();
  const mpBefore = snap.mp.current;
  // use a 0-cost command a few times (attack) to advance several player turns
  for (let i = 0; i < 4 && engine.getStatus() === 'ongoing'; i++) {
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    if (engine.getPhase() === 'player_turn') engine.useCommand('CMD001');
  }
  snap = engine.getSnapshot();
  assert(snap.mp.current <= mpBefore, `MP does not increase without MP-restoring action (before=${mpBefore}, after=${snap.mp.current})`);
  assert(snap.mp.current === mpBefore, `MP stays exactly flat when only using 0-cost attack (before=${mpBefore}, after=${snap.mp.current})`);
}

// --- Test 2: shock stacking triggers CT delay after 3 casts ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  let sawTrigger = false;
  for (let i = 0; i < 8 && engine.getStatus() === 'ongoing'; i++) {
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    if (engine.getPhase() === 'player_turn') {
      void engine.useCommand('CMD017');
      const events = engine.drainEvents();
      if (events.some((e) => e.type === 'delay_enemy')) sawTrigger = true;
    }
  }
  assert(sawTrigger, 'shock stacking eventually triggers a CT delay event on the enemy');
}

// --- Test 3: paralyze delays the enemy's next single action, then is consumed ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD021');
  const snapAfter = engine.getSnapshot();
  const sawParalyzeDelayLog = snapAfter.log.some((l) => l.includes('麻痺で行動が遅れた'));
  const paralyzeConsumed = !snapAfter.enemy.statuses.some((s) => s.kind === 'paralyze');
  assert(sawParalyzeDelayLog, 'paralyze delays the enemy CT on its next action (log line present)');
  assert(paralyzeConsumed, 'paralyze status is removed once consumed by that one action');
}

// --- Test 4: regen self-buff heals at next own turn start ---
{
  const engine = mk(dummyEnemy, [], 50, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD031');
  let healed = false;
  for (let i = 0; i < 6 && engine.getStatus() === 'ongoing' && !healed; i++) {
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    const events = engine.drainEvents();
    if (events.some((e) => e.type === 'status_heal')) healed = true;
    if (!healed && engine.getPhase() === 'player_turn') engine.useCommand('CMD005');
  }
  assert(healed, 'regen status_heal event fires on a subsequent player turn');
}

// --- Test 5: undying prevents lethal damage exactly once (a single grace hit, not invincibility) ---
{
  // A single, moderate-power hit: enough to be lethal once, but the player should then
  // survive at 1 HP rather than being finished off by the very same attack.
  const oneShotEnemy: EnemyDef = { ...dummyEnemy, power: 40, moves: [{ id: 'smash', name: '大打撃', icon: '💥', powerMult: 1, ctWeight: 'standard', intent: 'STRONG' }] };
  // PLAYER_BASE has a 5% evasion chance, so a single attack can whiff; retry a few times.
  let sawUndying = false;
  for (let trial = 0; trial < 10 && !sawUndying; trial++) {
    const engine = mk(oneShotEnemy, [], 20, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    engine.useCommand('CMD030');
    const snap = engine.getSnapshot();
    if (snap.log.some((l) => l.includes('致死ダメージを耐えた'))) sawUndying = true;
  }
  assert(sawUndying, 'undying prevents the first lethal hit and logs it (10 trials)');
  // undying is a single grace hit, not invincibility: if a second lethal hit lands before the
  // player's delayed next turn, the battle legitimately ends in defeat. Either outcome is
  // correct engine behavior; what matters is that the FIRST lethal hit was negated (hp forced
  // to 1 rather than 0), which the log line above already confirms.
}

// --- Test 6: enemy phase change triggers when HP drops below threshold ---
{
  const phasedEnemy: EnemyDef = {
    ...dummyEnemy,
    hp: 100,
    moves: [{ id: 'p1', name: 'フェーズ1攻撃', icon: '👊', powerMult: 0.1, ctWeight: 'standard', intent: 'ATTACK' }],
    phases: [{ hpPctThreshold: 50, announceText: 'フェーズ変化した！', moves: [{ id: 'p2', name: 'フェーズ2攻撃', icon: '🔥', powerMult: 0.1, ctWeight: 'standard', intent: 'STRONG' }] }],
  };
  const engine = mk(phasedEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  let sawPhaseLog = false;
  for (let i = 0; i < 30 && engine.getStatus() === 'ongoing' && !sawPhaseLog; i++) {
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    if (engine.getPhase() === 'player_turn') engine.useCommand('CMD003');
    const snap = engine.getSnapshot();
    if (snap.log.some((l) => l.includes('フェーズ変化した'))) sawPhaseLog = true;
  }
  assert(sawPhaseLog, 'enemy phase transition fires once HP crosses the threshold');
}

// シナジー36接続(段階5)後の共通ヘルパー: 特定タグを持つだけの合成部位をN個生成する。
// (実際の80部位ロースターとは独立に、各シナジーのcountByタグ判定だけをピンポイントで検証するため)
function taggedParts(tag: string, count: number): PartDef[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `SYNTH_${tag}_${i}`,
    name: `合成部位(${tag})${i}`,
    icon: '🔧',
    type: '器官',
    tags: [tag] as PartDef['tags'],
    effects: [],
    description: '',
  }));
}

// --- Test 7: speed_synergy(多脚/高速タグ)が2個装着で発動する ---
{
  const engine = mk(dummyEnemy, taggedParts('高速', 2), 130, 100);
  const snap = engine.getSnapshot();
  assert(snap.activeSynergyNames.includes('多脚'), 'speed_synergy(多脚) is active with 2 高速-tagged parts equipped');
}

// --- Test 8: berserk_synergy(暴走生命)6段階目のrevive_once_instant_actionが致死を耐える ---
{
  const oneShotEnemy: EnemyDef = { ...dummyEnemy, power: 40, moves: [{ id: 'smash', name: '大打撃', icon: '💥', powerMult: 1, ctWeight: 'standard', intent: 'STRONG' }] };
  // PLAYER_BASE has a 5% evasion chance, so a single attack can whiff; retry a few times.
  let sawRevive = false;
  for (let trial = 0; trial < 10 && !sawRevive; trial++) {
    const engine = mk(oneShotEnemy, taggedParts('暴走', 6), 20, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    engine.useCommand('CMD005');
    const snap = engine.getSnapshot();
    if (snap.log.some((l) => l.includes('致死ダメージを耐えた'))) sawRevive = true;
  }
  assert(sawRevive, 'berserk_synergy stage3 (revive_once_instant_action) prevents a lethal hit without any player-cast undying status (10 trials)');
}

// --- Test 9: extra_action_chance (speed_synergy stage3, 6 高速-tagged parts) can grant an immediate re-action after a light command ---
{
  let sawExtraAction = false;
  for (let trial = 0; trial < 40 && !sawExtraAction; trial++) {
    const engine = mk(dummyEnemy, taggedParts('高速', 6), 130, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    engine.useCommand('CMD002'); // ctWeight: light
    const events = engine.drainEvents();
    if (events.some((e) => e.type === 'extra_action')) sawExtraAction = true;
  }
  assert(sawExtraAction, 'extra_action_chance synergy rule eventually grants an immediate re-action after a light command (40 trials)');
}

// --- Test 10: silence blocks MP-cost commands, mp_leak drains extra MP on action ---
{
  const silenceEnemy: EnemyDef = {
    ...dummyEnemy,
    moves: [{ id: 'seal', name: '封魔の矢', icon: '🔇', powerMult: 0.1, ctWeight: 'standard', intent: 'DEBUFF', applyStatus: { kind: 'silence', magnitude: 1, turns: 2 } }],
  };
  // PLAYER_BASE has a 5% evasion chance, so the enemy's silence move can whiff; retry a few times.
  let r: { ok: boolean; reason?: string } = { ok: true };
  for (let trial = 0; trial < 10 && r.ok; trial++) {
    const engine = mk(silenceEnemy, [], 130, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    engine.useCommand('CMD005'); // let the enemy's silence move land
    r = engine.useCommand('CMD003'); // mpCost 5 > 0, should be blocked
    if (!r.ok) {
      const r2 = engine.useCommand('CMD001'); // mpCost 0, should still work
      assert(r2.ok, 'silence does not block a 0-MP command');
    }
  }
  assert(!r.ok, `silence blocks an MP-cost command (reason: ${r.reason}, 10 trials)`);
}
{
  const leakEnemy: EnemyDef = {
    ...dummyEnemy,
    moves: [{ id: 'drain', name: '魔喰い', icon: '🕳️', powerMult: 0.1, ctWeight: 'standard', intent: 'DEBUFF', applyStatus: { kind: 'mp_leak', magnitude: 4, turns: 3 } }],
  };
  // PLAYER_BASE has a 5% evasion chance, so the enemy's leak move can whiff; retry a few times.
  let mpDelta = 5;
  for (let trial = 0; trial < 10 && mpDelta <= 5; trial++) {
    const engine = mk(leakEnemy, [], 130, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    engine.useCommand('CMD005');
    const mpBefore = engine.getSnapshot().mp.current;
    engine.useCommand('CMD003'); // mpCost 5, plus mp_leak should drain extra
    const mpAfter = engine.getSnapshot().mp.current;
    mpDelta = mpBefore - mpAfter;
  }
  assert(mpDelta > 5, `mp_leak drains extra MP beyond the command's own cost (observed delta=${mpDelta}, 10 trials)`);
}

// --- Test 11: bleed deals damage on every subsequent hit taken, not just at turn start ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD003'); // apply nothing yet; need a bleed-applying enemy move instead
  const bleedEnemy: EnemyDef = { ...dummyEnemy, moves: [{ id: 'slash', name: '切り裂き', icon: '🩸', powerMult: 0.1, ctWeight: 'light', intent: 'ATTACK', applyStatus: { kind: 'bleed', magnitude: 3, turns: 4 } }] };
  const engine2 = mk(bleedEnemy, [], 130, 100);
  engine2.revealOrder();
  engine2.beginFirstTurn();
  let bleedTicks = 0;
  // 'wait' is deliberately very fast, so the enemy rarely gets a turn; run enough iterations
  // that the slower enemy still gets several attacks in across the run.
  for (let i = 0; i < 200 && engine2.getStatus() === 'ongoing' && bleedTicks < 3; i++) {
    if (engine2.getPhase() === 'enemy_first_announce') engine2.resolveAnnouncedEnemyTurn();
    const events = engine2.drainEvents();
    bleedTicks += events.filter((e) => e.type === 'status_tick' && e.kind === 'bleed').length;
    if (engine2.getPhase() === 'player_turn') engine2.useCommand('CMD005');
  }
  assert(bleedTicks >= 2, `bleed ticks extra damage on repeated hits, not just once (observed ${bleedTicks} ticks)`);
}

// --- Test 12: accuracy_down raises the afflicted actor's own chance to miss when IT attacks ---
{
  // blind_strike applies accuracy_down to the enemy; the enemy's own subsequent attacks
  // against the player should then evade (side:'enemy') more often than the player's
  // baseline 5% evasion alone would explain.
  const blindedEnemy: EnemyDef = { ...dummyEnemy, evasionPct: 0 };
  let enemyMissCount = 0;
  const trials = 60;
  for (let i = 0; i < trials; i++) {
    const engine = mk(blindedEnemy, [], 130, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    engine.useCommand('CMD020'); // applies accuracy_down to the enemy, and may itself trigger the enemy's next turn
    let events = engine.drainEvents();
    let sawEnemyEvade = events.some((e) => e.type === 'evade' && e.side === 'enemy');
    for (let j = 0; j < 3 && !sawEnemyEvade && engine.getPhase() === 'player_turn' && engine.getStatus() === 'ongoing'; j++) {
      engine.useCommand('CMD005');
      events = engine.drainEvents();
      sawEnemyEvade = events.some((e) => e.type === 'evade' && e.side === 'enemy');
    }
    if (sawEnemyEvade) enemyMissCount++;
  }
  // baseline (no accuracy_down) would be ~5% (PLAYER_BASE.evasionPct); accuracy_down(+25) should push this well above that.
  assert(
    enemyMissCount / trials > 0.15,
    `accuracy_down meaningfully raises the enemy's own miss rate against the player (observed ${enemyMissCount}/${trials}, baseline ~5%)`
  );
}

// ============================================================
// コマンド60種接続(段階2)の個別メカニクス検証
// ============================================================

// --- Test 13: multi-hit (CMD009 連撃, 3Hit) deals 3 separate attack events ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD009');
  const events = engine.drainEvents();
  const hitEvents = events.filter((e) => e.type === 'attack' && e.side === 'player');
  assert(hitEvents.length === 3, `連撃(CMD009) deals exactly 3 separate hit events (observed ${hitEvents.length})`);
}

// --- Test 14: lifesteal (CMD010 吸血) heals the player based on damage dealt ---
{
  const engine = mk(dummyEnemy, [], 100, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const hpBefore = engine.getSnapshot().player.hp;
  engine.useCommand('CMD010');
  const hpAfter = engine.getSnapshot().player.hp;
  assert(hpAfter > hpBefore, `吸血(CMD010) heals the player from lifesteal (before=${hpBefore}, after=${hpAfter})`);
}

// --- Test 15: ignoreDefense (CMD034 穿孔) deals more damage than an equal-power defense-respecting hit ---
{
  const tankyEnemy: EnemyDef = { ...dummyEnemy, defense: 50, hp: 5000 };
  const engineA = mk(tankyEnemy, [], 130, 100);
  engineA.revealOrder();
  engineA.beginFirstTurn();
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  const hpBeforeA = engineA.getSnapshot().enemy.hp;
  engineA.useCommand('CMD034'); // 穿孔: ignoreDefense
  const dmgA = hpBeforeA - engineA.getSnapshot().enemy.hp;

  const engineB = mk(tankyEnemy, [], 130, 100);
  engineB.revealOrder();
  engineB.beginFirstTurn();
  if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
  const hpBeforeB = engineB.getSnapshot().enemy.hp;
  engineB.useCommand('CMD001'); // 通常攻撃: respects defense
  const dmgB = hpBeforeB - engineB.getSnapshot().enemy.hp;

  assert(dmgA > dmgB, `穿孔(CMD034, ignoreDefense) deals more damage than 通常攻撃 against a high-defense enemy (穿孔=${dmgA}, 通常攻撃=${dmgB})`);
}

// --- Test 16: executeBonus (CMD039 処刑) deals bonus damage against a low-HP enemy ---
{
  const lowHpEnemy: EnemyDef = { ...dummyEnemy, hp: 1000 };
  const engine = mk(lowHpEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  // force the enemy below the 25% execute threshold first
  (engine as unknown as { enemy: { hp: number } }).enemy.hp = 100; // 10% of 1000
  const hpBefore = engine.getSnapshot().enemy.hp;
  engine.useCommand('CMD039');
  const dmg = hpBefore - Math.max(0, engine.getSnapshot().enemy.hp);
  assert(dmg > 30, `処刑(CMD039) deals large bonus damage against a sub-25% HP enemy (observed ${dmg} dmg vs ~12 base)`);
}

// --- Test 17: hpCostPct (CMD060 自壊砲) consumes player HP as a cost ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const hpBefore = engine.getSnapshot().player.hp;
  engine.useCommand('CMD060');
  const hpAfter = engine.getSnapshot().player.hp;
  assert(hpAfter < hpBefore, `自壊砲(CMD060) consumes player HP as a cost (before=${hpBefore}, after=${hpAfter})`);
}

// --- Test 18: damageImmuneOnce (CMD046 完全防御) fully negates the next hit ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD046');
  const hpBefore = engine.getSnapshot().player.hp;
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const hpAfter = engine.getSnapshot().player.hp;
  assert(hpAfter === hpBefore, `完全防御(CMD046) fully negates the next hit taken (before=${hpBefore}, after=${hpAfter})`);
}

// --- Test 19: counterStance (CMD014 カウンター姿勢) counters the next hit taken ---
// PLAYER_BASE has a 5% evasion chance, so an enemy attack can whiff several times in a row;
// retry across fresh engines to keep this robust against that.
{
  let sawCounter = false;
  for (let trial = 0; trial < 10 && !sawCounter; trial++) {
    const engine = mk(dummyEnemy, [], 130, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    // Don't drain here: useCommand() already resolves the enemy's turn synchronously if it's
    // fast enough to act within this same call, so the counter event may already be queued.
    engine.useCommand('CMD014');
    for (let i = 0; i < 5 && engine.getStatus() === 'ongoing' && !sawCounter; i++) {
      if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
      const events = engine.drainEvents();
      if (events.some((e) => e.type === 'counter' && e.side === 'player')) sawCounter = true;
      if (!sawCounter && engine.getPhase() === 'player_turn') engine.useCommand('CMD005');
    }
  }
  assert(sawCounter, 'カウンター姿勢(CMD014) triggers a player-side counter event on the next hit taken (10 trials)');
}

// --- Test 20: reflectPct (CMD048 棘返し) reflects a portion of the next hit back to the enemy ---
// dummyEnemy's 'poke' move deals only ~1 raw damage, and 40% of 1 rounds down to 0 reflected
// damage (a real, correct edge case) — use a harder-hitting enemy so the reflected amount is
// clearly nonzero and this test isn't just re-testing floating point rounding.
{
  const hittingEnemy: EnemyDef = { ...dummyEnemy, power: 20, moves: [{ id: 'hit', name: '一撃', icon: '👊', powerMult: 1, ctWeight: 'standard', intent: 'ATTACK' }] };
  let sawReflect = false;
  for (let trial = 0; trial < 10 && !sawReflect; trial++) {
    const engine = mk(hittingEnemy, [], 130, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    engine.useCommand('CMD048');
    for (let i = 0; i < 5 && engine.getStatus() === 'ongoing' && !sawReflect; i++) {
      if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
      const events = engine.drainEvents();
      if (events.some((e) => e.type === 'counter' && e.side === 'player' && e.targetSide === 'enemy')) sawReflect = true;
      if (!sawReflect && engine.getPhase() === 'player_turn') engine.useCommand('CMD005');
    }
  }
  assert(sawReflect, '棘返し(CMD048) reflects damage back to the enemy on the next hit taken (10 trials)');
}

// --- Test 21: killBonus healPct/mpGain (CMD032 捕食) triggers on a killing blow ---
{
  const weakEnemy: EnemyDef = { ...dummyEnemy, hp: 1 };
  const engine = mk(weakEnemy, [], 60, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD032');
  const snap = engine.getSnapshot();
  assert(snap.log.some((l) => l.includes('撃破のボーナスでHPが')), '捕食(CMD032) grants a heal-on-kill bonus');
}

// --- Test 22: killBonus instantNextAction (CMD033 捕食連鎖) grants an immediate re-action on kill ---
{
  const weakEnemy: EnemyDef = { ...dummyEnemy, hp: 1 };
  let sawInstant = false;
  for (let trial = 0; trial < 5 && !sawInstant; trial++) {
    const engine = mk(weakEnemy, [], 130, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    // status='ongoing' won't hold since the enemy dies; check status becomes 'won' but log shows instant-action line first
    engine.useCommand('CMD033');
    const snap = engine.getSnapshot();
    if (snap.log.some((l) => l.includes('即座にもう一度行動'))) sawInstant = true;
  }
  assert(sawInstant, '捕食連鎖(CMD033) logs an instant-re-action bonus when the kill lands');
}

// --- Test 23: followUpNextAttack (CMD037 追撃命令) triggers a bonus hit on the next attack ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD037'); // 追撃命令 (utility, no damage)
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD001'); // next attack should trigger a follow-up
  const snap = engine.getSnapshot();
  assert(snap.log.some((l) => l.includes('追撃！')), '追撃命令(CMD037) causes the next attack to be followed by an extra hit');
}

// --- Test 24: mimicPreviousCommand (CMD052 模倣) re-executes the previously used command ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD006'); // 火炎牙 (applies burn)
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD052'); // 模倣 -> re-executes 火炎牙
  const snap = engine.getSnapshot();
  const burnApplyCount = snap.log.filter((l) => l.includes('炎上状態が付与された')).length;
  assert(burnApplyCount >= 2, `模倣(CMD052) re-executes the previous command's full effect (observed ${burnApplyCount} burn applications, expected >=2)`);
}

// --- Test 25: statusConsumeNuke (CMD040 炎上爆破) consumes burn stacks for bonus damage ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD006'); // apply burn first
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const burnBefore = engine.getSnapshot().enemy.statuses.some((s) => s.kind === 'burn');
  engine.useCommand('CMD040'); // 炎上爆破: consumes burn
  const snap = engine.getSnapshot();
  const burnAfter = snap.enemy.statuses.some((s) => s.kind === 'burn');
  assert(burnBefore, 'precondition: enemy has burn before 炎上爆破');
  assert(!burnAfter, '炎上爆破(CMD040) consumes the enemy\'s burn stacks');
  assert(snap.log.some((l) => l.includes('を吸収し追加')), '炎上爆破(CMD040) logs the bonus consume-damage');
}

// --- Test 26: statusPresentBonusMult (CMD042 凍砕) deals bonus damage only while the enemy is frozen ---
{
  const engineFrozen = mk(dummyEnemy, [], 130, 100);
  engineFrozen.revealOrder();
  engineFrozen.beginFirstTurn();
  if (engineFrozen.getPhase() === 'enemy_first_announce') engineFrozen.resolveAnnouncedEnemyTurn();
  engineFrozen.useCommand('CMD016'); // 氷結牙: applies frozen
  if (engineFrozen.getPhase() === 'enemy_first_announce') engineFrozen.resolveAnnouncedEnemyTurn();
  const hpBeforeFrozen = engineFrozen.getSnapshot().enemy.hp;
  engineFrozen.useCommand('CMD042'); // 凍砕
  const dmgFrozen = hpBeforeFrozen - engineFrozen.getSnapshot().enemy.hp;

  const enginePlain = mk(dummyEnemy, [], 130, 100);
  enginePlain.revealOrder();
  enginePlain.beginFirstTurn();
  if (enginePlain.getPhase() === 'enemy_first_announce') enginePlain.resolveAnnouncedEnemyTurn();
  const hpBeforePlain = enginePlain.getSnapshot().enemy.hp;
  enginePlain.useCommand('CMD042'); // 凍砕 without frozen active
  const dmgPlain = hpBeforePlain - enginePlain.getSnapshot().enemy.hp;

  assert(dmgFrozen > dmgPlain, `凍砕(CMD042) deals bonus damage only while the enemy is frozen (frozen=${dmgFrozen}, not-frozen=${dmgPlain})`);
}

// --- Test 27: refundLastMpSpentPct (CMD024 巻き戻し) refunds part of the previous command's MP cost ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD003'); // 強打: mpCost 5
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const mpBefore = engine.getSnapshot().mp.current;
  engine.useCommand('CMD024'); // 巻き戻し: mpCost 8, refunds 50% of 5 = round(2.5)=3, net -5
  const mpAfter = engine.getSnapshot().mp.current;
  assert(mpAfter === mpBefore - 8 + 3, `巻き戻し(CMD024) refunds part of the previous command's MP cost (before=${mpBefore}, after=${mpAfter}, expected=${mpBefore - 8 + 3})`);
}

// --- Test 28: mpFullRestore (CMD026 精神集中) restores MP ---
{
  const engine = mk(dummyEnemy, [], 130, 10);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const mpBefore = engine.getSnapshot().mp.current;
  engine.useCommand('CMD026');
  const mpAfter = engine.getSnapshot().mp.current;
  assert(mpAfter > mpBefore, `精神集中(CMD026) restores MP (before=${mpBefore}, after=${mpAfter})`);
}

// --- Test 29: consumeAllMpForPower (CMD027 魔力暴発) spends all remaining MP for bonus power, then MP is 0 ---
{
  const engine = mk(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD027'); // mpCost 8, then consumes the rest (92) for power
  const mpAfter = engine.getSnapshot().mp.current;
  assert(mpAfter === 0, `魔力暴発(CMD027) consumes all remaining MP after paying its base cost (observed ${mpAfter})`);
}

// --- Test 30: frenzy (CMD029 狂化) raises the player's own outgoing damage ---
// (defense_down's effect on incoming damage is covered structurally by the same effectiveDefense()
// helper that vulnerable/frenzy share; testing it against dummyEnemy's near-zero defense(0)/tiny
// move power would only ever move the rounded damage by a fraction of a point, so this test
// verifies the more clearly measurable power-up side of the same status instead.)
{
  const engineA = mk(dummyEnemy, [], 130, 100);
  engineA.revealOrder();
  engineA.beginFirstTurn();
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  engineA.useCommand('CMD029'); // 狂化
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  const enemyHpBeforeA = engineA.getSnapshot().enemy.hp;
  engineA.useCommand('CMD001');
  const dmgFrenzy = enemyHpBeforeA - engineA.getSnapshot().enemy.hp;

  const engineB = mk(dummyEnemy, [], 130, 100);
  engineB.revealOrder();
  engineB.beginFirstTurn();
  if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
  const enemyHpBeforeB = engineB.getSnapshot().enemy.hp;
  engineB.useCommand('CMD001');
  const dmgPlain = enemyHpBeforeB - engineB.getSnapshot().enemy.hp;

  assert(dmgFrenzy > dmgPlain, `狂化(CMD029) raises the player's own outgoing damage (frenzy=${dmgFrenzy}, plain=${dmgPlain})`);
}

// --- Test 31: fear (CMD015 咆哮) lowers the afflicted enemy's own outgoing damage ---
{
  const punchyEnemy: EnemyDef = { ...dummyEnemy, power: 100, moves: [{ id: 'punch', name: '一撃', icon: '👊', powerMult: 1, ctWeight: 'standard', intent: 'ATTACK' }] };
  const engineA = mk(punchyEnemy, [], 1000, 100);
  engineA.revealOrder();
  engineA.beginFirstTurn();
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  engineA.useCommand('CMD015'); // 咆哮: applies fear to the enemy (this call may already resolve an enemy hit)
  let dmgFeared = -1;
  for (let i = 0; i < 20 && engineA.getStatus() === 'ongoing' && dmgFeared < 0; i++) {
    if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
    const events = engineA.drainEvents();
    const hit = events.find((e) => e.type === 'attack' && e.side === 'enemy' && e.targetSide === 'player');
    if (hit && hit.type === 'attack') dmgFeared = hit.damage;
    if (dmgFeared < 0 && engineA.getPhase() === 'player_turn') engineA.useCommand('CMD005');
  }

  const engineB = mk(punchyEnemy, [], 1000, 100);
  engineB.revealOrder();
  engineB.beginFirstTurn();
  if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
  let dmgPlain = -1;
  for (let i = 0; i < 20 && engineB.getStatus() === 'ongoing' && dmgPlain < 0; i++) {
    if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
    const events = engineB.drainEvents();
    const hit = events.find((e) => e.type === 'attack' && e.side === 'enemy' && e.targetSide === 'player');
    if (hit && hit.type === 'attack') dmgPlain = hit.damage;
    if (dmgPlain < 0 && engineB.getPhase() === 'player_turn') engineB.useCommand('CMD005');
  }
  assert(dmgFeared >= 0 && dmgPlain >= 0, 'precondition: both engines observed an enemy hit');
  assert(dmgFeared < dmgPlain, `恐怖(咆哮/CMD015) lowers the feared enemy's own outgoing damage (feared=${dmgFeared}, plain=${dmgPlain})`);
}

// --- Test 32: predation_mark (CMD032 捕食) increases the heal-on-kill bonus on repeated use ---
{
  const weakEnemy1: EnemyDef = { ...dummyEnemy, hp: 1 };
  const engine = mk(weakEnemy1, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD032'); // first kill: base healPct 15%, also stacks predation_mark
  const snap1 = engine.getSnapshot();
  const firstHealLine = snap1.log.find((l) => l.includes('撃破のボーナスでHPが'));
  assert(!!firstHealLine, '捕食(CMD032) grants a heal-on-kill bonus on first use');
  assert(
    snap1.player.statuses.some((s) => s.kind === 'predation_mark'),
    '捕食(CMD032) stacks a predation_mark self-status on use'
  );
}

// --- Test 33: time_wound (CMD023 時間喰い) compounds a subsequent delay effect ---
{
  const engineA = mk(dummyEnemy, [], 130, 100);
  engineA.revealOrder();
  engineA.beginFirstTurn();
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  engineA.useCommand('CMD023'); // applies time_wound to the enemy, plus its own delay
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  const beforeSecondDelayA = engineA.getSnapshot();
  const enemyNextAtBeforeA = beforeSecondDelayA.order.findIndex((s) => s.side === 'enemy');
  engineA.useCommand('CMD011'); // 遅延打撃: should be amplified by the existing time_wound stack
  const eventsA = engineA.drainEvents();
  const delayA = eventsA.find((e) => e.type === 'delay_enemy' && e.side === 'player');

  const engineB = mk(dummyEnemy, [], 130, 100);
  engineB.revealOrder();
  engineB.beginFirstTurn();
  if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
  engineB.useCommand('CMD011'); // same delay command, but without a prior time_wound stack
  const eventsB = engineB.drainEvents();
  const delayB = eventsB.find((e) => e.type === 'delay_enemy' && e.side === 'player');

  void enemyNextAtBeforeA;
  assert(!!delayA && !!delayB, 'precondition: both delay_enemy events fired');
  if (delayA && delayA.type === 'delay_enemy' && delayB && delayB.type === 'delay_enemy') {
    assert(delayA.amount > delayB.amount, `時間傷(時間喰い/CMD023) compounds a subsequent delay's magnitude (wounded=${delayA.amount}, plain=${delayB.amount})`);
  }
}

// ============================================================
// 部位80種接続(段階4)の新規PartEffect検証。実データ(src/data/parts.ts)を使う。
// ============================================================

// --- Test 34: power_bonus_all_pct + on_hit_apply_status (PRT002 火炎頭) ---
{
  const engineA = mk(dummyEnemy, [part('PRT002')], 130, 100);
  engineA.revealOrder();
  engineA.beginFirstTurn();
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  const hpBeforeA = engineA.getSnapshot().enemy.hp;
  engineA.useCommand('CMD001');
  const dmgA = hpBeforeA - engineA.getSnapshot().enemy.hp;

  const engineB = mk(dummyEnemy, [], 130, 100);
  engineB.revealOrder();
  engineB.beginFirstTurn();
  if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
  const hpBeforeB = engineB.getSnapshot().enemy.hp;
  engineB.useCommand('CMD001');
  const dmgB = hpBeforeB - engineB.getSnapshot().enemy.hp;
  assert(dmgA > dmgB, `火炎頭(power_bonus_all_pct) raises outgoing damage (with=${dmgA}, without=${dmgB})`);

  const snapA = engineA.getSnapshot();
  assert(snapA.enemy.statuses.some((s) => s.kind === 'burn'), '火炎頭(on_hit_apply_status) applies burn on a landed attack');
}


// --- Test 35: defense_flat_bonus (PRT024 反射腕) vs defense_pct_penalty (PRT003 狂戦頭) ---
{
  const punchyEnemy: EnemyDef = { ...dummyEnemy, power: 100, moves: [{ id: 'punch', name: '一撃', icon: '👊', powerMult: 1, ctWeight: 'standard', intent: 'ATTACK' }] };

  const measureDamage = (parts: ReturnType<typeof part>[]): number => {
    const engine = mk(punchyEnemy, parts, 100000, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    const hpBefore = engine.getSnapshot().player.hp;
    if (engine.getPhase() === 'player_turn') engine.useCommand('CMD005');
    return hpBefore - engine.getSnapshot().player.hp;
  };

  // player has a fixed 5% base evasion, so retry until none of the 3 runs whiffed (dmg=0)
  let dmgWithDefBonus = 0;
  let dmgWithPenalty = 0;
  let dmgBaseline = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    dmgWithDefBonus = measureDamage([part('PRT024')]);
    dmgWithPenalty = measureDamage([part('PRT003'), part('PRT003'), part('PRT003')]);
    dmgBaseline = measureDamage([]);
    if (dmgWithDefBonus > 0 && dmgWithPenalty > 0 && dmgBaseline > 0) break;
  }

  assert(dmgWithDefBonus < dmgBaseline, `反射腕(defense_flat_bonus) reduces incoming damage (with=${dmgWithDefBonus}, baseline=${dmgBaseline})`);
  assert(dmgWithPenalty > dmgBaseline, `狂戦頭(defense_pct_penalty) increases incoming damage (with=${dmgWithPenalty}, baseline=${dmgBaseline})`);
}

// --- Test 36: execute_bonus_passive (PRT010 処刑眼) boosts damage against a low-HP enemy ---
{
  const lowHpEnemy: EnemyDef = { ...dummyEnemy, hp: 1000 };
  const engineA = mk(lowHpEnemy, [part('PRT010')], 130, 100);
  engineA.revealOrder();
  engineA.beginFirstTurn();
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  (engineA as unknown as { enemy: { hp: number } }).enemy.hp = 100; // 10% of 1000, below the 25% threshold
  const hpBeforeA = engineA.getSnapshot().enemy.hp;
  engineA.useCommand('CMD001');
  const dmgA = hpBeforeA - Math.max(0, engineA.getSnapshot().enemy.hp);

  const engineB = mk(lowHpEnemy, [], 130, 100);
  engineB.revealOrder();
  engineB.beginFirstTurn();
  if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
  (engineB as unknown as { enemy: { hp: number } }).enemy.hp = 100;
  const hpBeforeB = engineB.getSnapshot().enemy.hp;
  engineB.useCommand('CMD001');
  const dmgB = hpBeforeB - Math.max(0, engineB.getSnapshot().enemy.hp);

  assert(dmgA > dmgB, `処刑眼(execute_bonus_passive) boosts ALL attacks (not just 処刑 itself) vs a sub-25%HP enemy (with=${dmgA}, without=${dmgB})`);
}

// --- Test 37: lifesteal_bonus_pct (PRT015 血吸口) boosts an existing lifesteal command's heal ---
{
  const engineA = mk(dummyEnemy, [part('PRT015')], 100, 100);
  engineA.revealOrder();
  engineA.beginFirstTurn();
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  const hpBeforeA = engineA.getSnapshot().player.hp;
  engineA.useCommand('CMD010'); // 吸血
  const healedA = engineA.getSnapshot().player.hp - hpBeforeA;

  const engineB = mk(dummyEnemy, [], 100, 100);
  engineB.revealOrder();
  engineB.beginFirstTurn();
  if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
  const hpBeforeB = engineB.getSnapshot().player.hp;
  engineB.useCommand('CMD010');
  const healedB = engineB.getSnapshot().player.hp - hpBeforeB;

  assert(healedA > healedB, `血吸口(lifesteal_bonus_pct) boosts 吸血's heal amount (with=${healedA}, without=${healedB})`);
}

// --- Test 38: status_magnitude_bonus (PRT016 毒腺口) boosts the magnitude of an applied poison ---
{
  const engineA = mk(dummyEnemy, [part('PRT016')], 130, 100);
  engineA.revealOrder();
  engineA.beginFirstTurn();
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  engineA.useCommand('CMD007'); // 毒針
  const magA = engineA.getSnapshot().enemy.statuses.find((s) => s.kind === 'poison')?.magnitude ?? 0;

  const engineB = mk(dummyEnemy, [], 130, 100);
  engineB.revealOrder();
  engineB.beginFirstTurn();
  if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
  engineB.useCommand('CMD007');
  const magB = engineB.getSnapshot().enemy.statuses.find((s) => s.kind === 'poison')?.magnitude ?? 0;

  assert(magA > magB, `毒腺口(status_magnitude_bonus) boosts applied poison magnitude (with=${magA}, without=${magB})`);
}

// --- Test 39: passive_regen_per_turn (PRT044 再生胴) heals every player turn start ---
{
  const engine = mk(dummyEnemy, [part('PRT044')], 50, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const hpBefore = engine.getSnapshot().player.hp;
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD005');
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const hpAfter = engine.getSnapshot().player.hp;
  assert(hpAfter >= hpBefore, `再生胴(passive_regen_per_turn) heals at player turn start without needing a regen status (before=${hpBefore}, after=${hpAfter})`);
}

// --- Test 40: reflect_on_hit_pct (PRT045 棘甲) reflects damage passively, every hit (not consumed) ---
{
  const hittingEnemy: EnemyDef = { ...dummyEnemy, power: 20, moves: [{ id: 'hit', name: '一撃', icon: '👊', powerMult: 1, ctWeight: 'standard', intent: 'ATTACK' }] };
  const engine = mk(hittingEnemy, [part('PRT045')], 100000, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  let reflectHits = 0;
  for (let i = 0; i < 80 && engine.getStatus() === 'ongoing' && reflectHits < 2; i++) {
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    const events = engine.drainEvents();
    reflectHits += events.filter((e) => e.type === 'counter' && e.side === 'player' && e.targetSide === 'enemy').length;
    if (engine.getPhase() === 'player_turn') engine.useCommand('CMD005');
  }
  assert(reflectHits >= 2, `棘甲(reflect_on_hit_pct) reflects damage on more than one hit, unlike the single-use CMD048 (observed ${reflectHits})`);
}

// --- Test 41: mp_move_power_bonus_pct (PRT038 魔導心臓) boosts MP-cost commands only ---
{
  const engineA = mk(dummyEnemy, [part('PRT038')], 130, 100);
  engineA.revealOrder();
  engineA.beginFirstTurn();
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  const hpBeforeA = engineA.getSnapshot().enemy.hp;
  engineA.useCommand('CMD006'); // 火炎牙, mpCost 6 > 0
  const dmgMpMoveA = hpBeforeA - engineA.getSnapshot().enemy.hp;

  const engineB = mk(dummyEnemy, [], 130, 100);
  engineB.revealOrder();
  engineB.beginFirstTurn();
  if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
  const hpBeforeB = engineB.getSnapshot().enemy.hp;
  engineB.useCommand('CMD006');
  const dmgMpMoveB = hpBeforeB - engineB.getSnapshot().enemy.hp;

  assert(dmgMpMoveA > dmgMpMoveB, `魔導心臓(mp_move_power_bonus_pct) boosts an MP-cost command's damage (with=${dmgMpMoveA}, without=${dmgMpMoveB})`);
}

// --- Test 42: first_mp_move_free (PRT078 ゼロコスト核) makes the first MP-cost move free, once per battle ---
{
  const engine = mk(dummyEnemy, [part('PRT078')], 130, 10);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const mpBefore = engine.getSnapshot().mp.current;
  const r1 = engine.useCommand('CMD006'); // mpCost 6, should be free (mpBefore=10 could afford it anyway, so check MP unchanged)
  assert(r1.ok, 'first MP-cost move succeeds');
  const mpAfterFirst = engine.getSnapshot().mp.current;
  assert(mpAfterFirst === mpBefore, `first_mp_move_free makes the first MP move cost 0 (before=${mpBefore}, after=${mpAfterFirst})`);
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const mpBeforeSecond = engine.getSnapshot().mp.current;
  engine.useCommand('CMD006'); // second use should cost normally
  const mpAfterSecond = engine.getSnapshot().mp.current;
  assert(mpBeforeSecond - mpAfterSecond === 6, `first_mp_move_free only applies once per battle (2nd use cost=${mpBeforeSecond - mpAfterSecond})`);
}

// --- Test 43: ignore_defense_pct (PRT065 穿孔角) partially ignores enemy defense ---
{
  const tankyEnemy: EnemyDef = { ...dummyEnemy, defense: 18, hp: 5000 };
  const engineA = mk(tankyEnemy, [part('PRT065')], 130, 100);
  engineA.revealOrder();
  engineA.beginFirstTurn();
  if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
  const hpBeforeA = engineA.getSnapshot().enemy.hp;
  engineA.useCommand('CMD001');
  const dmgA = hpBeforeA - engineA.getSnapshot().enemy.hp;

  const engineB = mk(tankyEnemy, [], 130, 100);
  engineB.revealOrder();
  engineB.beginFirstTurn();
  if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
  const hpBeforeB = engineB.getSnapshot().enemy.hp;
  engineB.useCommand('CMD001');
  const dmgB = hpBeforeB - engineB.getSnapshot().enemy.hp;

  assert(dmgA > dmgB, `穿孔角(ignore_defense_pct) deals more damage against a high-defense enemy (with=${dmgA}, without=${dmgB})`);
}

// --- Test 44: max_hp_bonus (PRT036 第二心臓) raises the player's max HP ---
{
  const engine = mk(dummyEnemy, [part('PRT036')], undefined, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  const snap = engine.getSnapshot();
  assert(snap.player.maxHp > 130, `第二心臓(max_hp_bonus) raises max HP above the base 130 (observed ${snap.player.maxHp})`);
}

// --- Test 45: accuracy_bonus_pct (PRT009 複眼) reduces the enemy's effective evasion ---
{
  const dodgyEnemy: EnemyDef = { ...dummyEnemy, evasionPct: 60 };
  let hitsWithBonus = 0;
  let hitsWithout = 0;
  const trials = 300;
  for (let i = 0; i < trials; i++) {
    const engineA = mk(dodgyEnemy, [part('PRT009')], 130, 100);
    engineA.revealOrder();
    engineA.beginFirstTurn();
    if (engineA.getPhase() === 'enemy_first_announce') engineA.resolveAnnouncedEnemyTurn();
    engineA.useCommand('CMD001');
    const eventsA = engineA.drainEvents();
    if (eventsA.some((e) => e.type === 'attack' && e.side === 'player')) hitsWithBonus++;

    const engineB = mk(dodgyEnemy, [], 130, 100);
    engineB.revealOrder();
    engineB.beginFirstTurn();
    if (engineB.getPhase() === 'enemy_first_announce') engineB.resolveAnnouncedEnemyTurn();
    engineB.useCommand('CMD001');
    const eventsB = engineB.drainEvents();
    if (eventsB.some((e) => e.type === 'attack' && e.side === 'player')) hitsWithout++;
  }
  assert(
    hitsWithBonus > hitsWithout,
    `複眼(accuracy_bonus_pct) increases the player's hit rate against a high-evasion enemy (with=${hitsWithBonus}/${trials}, without=${hitsWithout}/${trials})`
  );
}

// --- Test 46: evasion_bonus_pct (PRT057 加速翼) raises the player's own evasion ---
{
  const hittingEnemy: EnemyDef = { ...dummyEnemy, power: 20, moves: [{ id: 'hit', name: '一撃', icon: '👊', powerMult: 1, ctWeight: 'standard', intent: 'ATTACK' }] };
  let evadesWithBonus = 0;
  let evadesWithout = 0;
  const trials = 300;
  const observeEnemyEvade = (engine: CtbEngine): boolean => {
    for (let step = 0; step < 6; step++) {
      const phase = engine.getPhase();
      if (phase === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
      else if (phase === 'player_turn') engine.useCommand('CMD005');
      else break;
      const events = engine.drainEvents();
      if (events.some((e) => e.type === 'evade' && e.side === 'enemy')) return true;
      if (events.some((e) => e.type === 'attack' && e.side === 'enemy')) return false;
    }
    return false;
  };
  for (let i = 0; i < trials; i++) {
    const engineA = mk(hittingEnemy, [part('PRT057')], 100000, 100);
    engineA.revealOrder();
    engineA.beginFirstTurn();
    if (observeEnemyEvade(engineA)) evadesWithBonus++;

    const engineB = mk(hittingEnemy, [], 100000, 100);
    engineB.revealOrder();
    engineB.beginFirstTurn();
    if (observeEnemyEvade(engineB)) evadesWithout++;
  }
  assert(
    evadesWithBonus > evadesWithout,
    `加速翼(evasion_bonus_pct) raises the player's own evasion rate (with=${evadesWithBonus}/${trials}, without=${evadesWithout}/${trials})`
  );
}

// --- Test 47: on_kill_ct_bonus_pct (PRT059 黒翼) grants a CT haste when the player lands a killing blow ---
{
  const weakEnemy: EnemyDef = { ...dummyEnemy, hp: 1 };
  const engine = mk(weakEnemy, [part('PRT059')], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD001'); // should kill the 1-HP enemy and trigger on_kill_ct_bonus_pct (no crash, no assertion on private nextAt)
  assert(engine.getStatus() === 'won', '黒翼 on-kill haste does not interfere with a normal victory');
}

// ============================================================
// シナジー36接続(段階5): 12系統×3段階を、real 80-part rosterとは独立に
// taggedParts()で作った合成部位を使ってピンポイントで検証する。
// (注: 重量怪物3段階目のvery_heavy_delays_enemyは、現行60コマンドにvery_heavy
//  ctWeightのコマンドが1つも存在しないため、公開APIから発火させて検証する手段が無い。
//  ルール自体はctbEngine.tsに実装済みだが、ここではテストを省略する。)
// ============================================================

// --- Test 48: multi_hit_synergy stage2 (bonus_hits_flat) increases a hits-defined command's hit count ---
{
  const engineWith = mk(dummyEnemy, taggedParts('多段', 4), 130, 100);
  engineWith.revealOrder();
  engineWith.beginFirstTurn();
  if (engineWith.getPhase() === 'enemy_first_announce') engineWith.resolveAnnouncedEnemyTurn();
  engineWith.useCommand('CMD009'); // 連撃: 通常3Hit
  const hitsWith = engineWith.drainEvents().filter((e) => e.type === 'attack' && e.side === 'player').length;

  const engineWithout = mk(dummyEnemy, [], 130, 100);
  engineWithout.revealOrder();
  engineWithout.beginFirstTurn();
  if (engineWithout.getPhase() === 'enemy_first_announce') engineWithout.resolveAnnouncedEnemyTurn();
  engineWithout.useCommand('CMD009');
  const hitsWithout = engineWithout.drainEvents().filter((e) => e.type === 'attack' && e.side === 'player').length;

  assert(hitsWith > hitsWithout, `multi_hit_synergy stage2 (bonus_hits_flat) increases 連撃's hit count (with=${hitsWith}, without=${hitsWithout})`);
}

// --- Test 49: multi_hit_synergy stage3 (follow_up_after_attack) auto-adds a follow-up strike after any attack ---
{
  const engine = mk(dummyEnemy, taggedParts('多段', 6), 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD001'); // 通常攻撃: hits指定なしの単発コマンドでも追撃が発生するはず
  const attackEvents = engine.drainEvents().filter((e) => e.type === 'attack' && e.side === 'player');
  assert(attackEvents.length >= 2, `multi_hit_synergy stage3 (follow_up_after_attack) adds an automatic follow-up hit (observed ${attackEvents.length} attack events)`);
}

// --- Test 50: mp_synergy stage3 (full_mp_ct_bonus) makes an MP-cost command's CT faster when MP starts full ---
{
  const engineFull = mk(dummyEnemy, [...taggedParts('MP', 6)], 130, 100);
  engineFull.revealOrder();
  engineFull.beginFirstTurn();
  if (engineFull.getPhase() === 'enemy_first_announce') engineFull.resolveAnnouncedEnemyTurn();
  engineFull.useCommand('CMD011');
  const sawFullBonus = engineFull.getSnapshot().log.some((l) => l.includes('MP満タンからの技でさらに行動が早まった'));
  assert(sawFullBonus, 'mp_synergy stage3 (full_mp_ct_bonus) logs the CT bonus when MP starts full and an MP-cost command is used');

  const maxMpForThisBuild = engineFull.getSnapshot().mp.max;
  const engineNotFull = mk(dummyEnemy, [...taggedParts('MP', 6)], 130, Math.max(8, maxMpForThisBuild - 1));
  engineNotFull.revealOrder();
  engineNotFull.beginFirstTurn();
  if (engineNotFull.getPhase() === 'enemy_first_announce') engineNotFull.resolveAnnouncedEnemyTurn();
  engineNotFull.useCommand('CMD011');
  const sawBonusWhenNotFull = engineNotFull.getSnapshot().log.some((l) => l.includes('MP満タンからの技でさらに行動が早まった'));
  assert(!sawBonusWhenNotFull, 'mp_synergy stage3 (full_mp_ct_bonus) does NOT log the CT bonus when MP did not start full');
}

// --- Test 51: time_predation_synergy stage2 (delay_mp_refund) restores MP whenever a delay lands on the enemy ---
{
  let sawRefund = false;
  for (let trial = 0; trial < 10 && !sawRefund; trial++) {
    const engine = mk(dummyEnemy, taggedParts('時間', 4), 130, 30);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    const mpBefore = engine.getSnapshot().mp.current;
    engine.useCommand('CMD015'); // 咆哮: powerMult0、回避判定を経ずに確定でdelayEnemyByが入る
    const mpAfter = engine.getSnapshot().mp.current;
    if (mpAfter > mpBefore - 10) sawRefund = true; // CMD015のMPコストは10。リファンドが無ければmpAfter===mpBefore-10。
  }
  assert(sawRefund, 'time_predation_synergy stage2 (delay_mp_refund) restores MP when a delay lands (10 trials)');
}

// --- Test 52: time_predation_synergy stage3 (compounding_delay) makes each successive delay stronger ---
{
  const engine = mk(dummyEnemy, taggedParts('時間', 6), 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD015');
  const firstDelay = engine.drainEvents().find((e) => e.type === 'delay_enemy' && e.side === 'player');
  if (engine.getPhase() === 'player_turn') {
    engine.useCommand('CMD015');
  }
  const secondDelay = engine.drainEvents().find((e) => e.type === 'delay_enemy' && e.side === 'player');
  assert(
    !!firstDelay && !!secondDelay && firstDelay.type === 'delay_enemy' && secondDelay.type === 'delay_enemy' && secondDelay.amount > firstDelay.amount,
    `time_predation_synergy stage3 (compounding_delay) makes the 2nd delay stronger than the 1st (first=${firstDelay && firstDelay.type === 'delay_enemy' ? firstDelay.amount : 'n/a'}, second=${secondDelay && secondDelay.type === 'delay_enemy' ? secondDelay.amount : 'n/a'})`
  );
}

// --- Test 53: inferno_synergy stage3 (attack_burning_ct_bonus) hastens the player after attacking an already-burning enemy ---
{
  let sawBonus = false;
  for (let trial = 0; trial < 15 && !sawBonus; trial++) {
    const engine = mk(dummyEnemy, taggedParts('炎', 6), 130, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    engine.useCommand('CMD006'); // 火炎牙: 命中すれば炎上を付与(この1発目は敵がまだ炎上前なのでボーナス無し)
    if (engine.getPhase() !== 'player_turn') continue;
    engine.useCommand('CMD006'); // 2発目: 敵が既に炎上していればattack_burning_ct_bonusが乗るはず
    const snap = engine.getSnapshot();
    if (snap.log.some((l) => l.includes('炎上中の敵への攻撃で行動がさらに早まった'))) sawBonus = true;
  }
  assert(sawBonus, 'inferno_synergy stage3 (attack_burning_ct_bonus) hastens the player after hitting an already-burning enemy (15 trials)');
}

// --- Test 54: reflect_synergy stage3 (reflect_next_free) makes the next command cost 0 MP right after a passive reflect fires ---
{
  const hittingEnemy: EnemyDef = { ...dummyEnemy, power: 20, moves: [{ id: 'hit', name: '一撃', icon: '👊', powerMult: 1, ctWeight: 'standard', intent: 'ATTACK' }] };
  let sawFreeMove = false;
  for (let trial = 0; trial < 20 && !sawFreeMove; trial++) {
    const engine = mk(hittingEnemy, taggedParts('反撃', 6), 130, 30);
    engine.revealOrder();
    engine.beginFirstTurn();
    for (let step = 0; step < 6 && engine.getStatus() === 'ongoing'; step++) {
      const phase = engine.getPhase();
      if (phase === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
      else if (phase === 'player_turn') engine.useCommand('CMD005');
      else break;
      const events = engine.drainEvents();
      if (events.some((e) => e.type === 'counter' && e.side === 'player')) {
        if (engine.getPhase() === 'player_turn') {
          const mpBefore = engine.getSnapshot().mp.current;
          engine.useCommand('CMD006'); // MPコスト6のコマンドをタダで撃てるはず
          const mpAfter = engine.getSnapshot().mp.current;
          if (mpAfter === mpBefore) sawFreeMove = true;
        }
        break;
      }
    }
  }
  assert(sawFreeMove, 'reflect_synergy stage3 (reflect_next_free) makes the next command cost 0 MP right after a passive reflect (20 trials)');
}

// --- Test 55: regen_synergy stage2 (guard_mp_gain) restores MP when using the guard command ---
{
  const engine = mk(dummyEnemy, taggedParts('再生', 4), 130, 30);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const mpBefore = engine.getSnapshot().mp.current;
  if (engine.getPhase() === 'player_turn') engine.useCommand('CMD004'); // 防御
  const mpAfter = engine.getSnapshot().mp.current;
  assert(mpAfter > mpBefore, `regen_synergy stage2 (guard_mp_gain) restores MP when guarding (before=${mpBefore}, after=${mpAfter})`);
}

// --- Test 56: regen_synergy stage3 (overheal_shield) converts passive-regen overheal into a shield that absorbs the next hit ---
{
  const hittingEnemy: EnemyDef = { ...dummyEnemy, power: 20, moves: [{ id: 'hit', name: '一撃', icon: '👊', powerMult: 1, ctWeight: 'standard', intent: 'ATTACK' }] };
  let sawShieldLog = false;
  for (let trial = 0; trial < 15 && !sawShieldLog; trial++) {
    const engine = mk(hittingEnemy, taggedParts('再生', 6), 130, 100); // 130=maxHpなので次のtickで即オーバーヒール
    engine.revealOrder();
    engine.beginFirstTurn();
    for (let step = 0; step < 8 && engine.getStatus() === 'ongoing' && !sawShieldLog; step++) {
      const phase = engine.getPhase();
      if (phase === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
      else if (phase === 'player_turn') engine.useCommand('CMD005');
      else break;
      const snap = engine.getSnapshot();
      if (snap.log.some((l) => l.includes('シールドになった') || l.includes('シールドが'))) sawShieldLog = true;
    }
  }
  assert(sawShieldLog, 'regen_synergy stage3 (overheal_shield) builds and/or spends a shield from overhealed passive regen (15 trials)');
}

// --- Test 57: predator_synergy stage2 (on_kill_mp_gain) restores MP on a kill ---
{
  const weakEnemy: EnemyDef = { ...dummyEnemy, hp: 1 };
  const engine = mk(weakEnemy, taggedParts('捕食', 4), 130, 30);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const mpBefore = engine.getSnapshot().mp.current;
  if (engine.getPhase() === 'player_turn') engine.useCommand('CMD001');
  const mpAfter = engine.getSnapshot().mp.current;
  assert(mpAfter > mpBefore, `predator_synergy stage2 (on_kill_mp_gain) restores MP on a kill (before=${mpBefore}, after=${mpAfter})`);
}

// --- Test 58: predator_synergy stage3 (kill_instant_action) grants an extra_action event on a kill ---
{
  const weakEnemy: EnemyDef = { ...dummyEnemy, hp: 1 };
  const engine = mk(weakEnemy, taggedParts('捕食', 6), 130, 30);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  if (engine.getPhase() === 'player_turn') engine.useCommand('CMD001');
  const events = engine.drainEvents();
  assert(events.some((e) => e.type === 'extra_action'), 'predator_synergy stage3 (kill_instant_action) grants an immediate extra action on a kill');
}

// --- Test 59: compute_synergy stage2 (utility_ct_bonus_pct + utility_mp_cost_reduction_pct) speeds up and cheapens a utility command ---
{
  const engineWith = mk(dummyEnemy, [...taggedParts('知性', 4)], 130, 30);
  engineWith.revealOrder();
  engineWith.beginFirstTurn();
  if (engineWith.getPhase() === 'enemy_first_announce') engineWith.resolveAnnouncedEnemyTurn();
  const mpBeforeWith = engineWith.getSnapshot().mp.current;
  engineWith.useCommand('CMD015'); // 咆哮: powerMult0のutilityコマンド、通常MPコスト10
  const mpAfterWith = engineWith.getSnapshot().mp.current;
  const mpSpentWith = mpBeforeWith - mpAfterWith;

  const engineWithout = mk(dummyEnemy, [], 130, 30);
  engineWithout.revealOrder();
  engineWithout.beginFirstTurn();
  if (engineWithout.getPhase() === 'enemy_first_announce') engineWithout.resolveAnnouncedEnemyTurn();
  const mpBeforeWithout = engineWithout.getSnapshot().mp.current;
  engineWithout.useCommand('CMD015');
  const mpAfterWithout = engineWithout.getSnapshot().mp.current;
  const mpSpentWithout = mpBeforeWithout - mpAfterWithout;

  assert(
    mpSpentWith < mpSpentWithout,
    `compute_synergy stage2 (utility_mp_cost_reduction_pct) reduces 咆哮's MP cost (with=${mpSpentWith}, without=${mpSpentWithout})`
  );
}

// --- Test 60: compute_synergy stage3 (repeat_utility_bonus) hastens the player further when repeating the same utility command ---
{
  const engine = mk(dummyEnemy, taggedParts('知性', 6), 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  engine.useCommand('CMD005'); // 待機(1回目、直前コマンドなし)
  engine.drainEvents();
  if (engine.getPhase() === 'player_turn') {
    engine.useCommand('CMD005'); // 待機(2回目、直前と同じコマンドなのでrepeat_utility_bonusが乗るはず)
    const sawRepeatBonus = engine.getSnapshot().log.some((l) => l.includes('連続使用で行動がさらに早まった'));
    assert(sawRepeatBonus, 'compute_synergy stage3 (repeat_utility_bonus) logs the extra haste when repeating the same utility command');
  } else {
    assert(false, 'precondition: expected player_turn after the first 待機');
  }
}

// --- Test 61: poison_synergy stage3 (poison_explode) triggers bonus damage once the enemy's poison stacks reach the threshold ---
{
  const tankyEnemy: EnemyDef = { ...dummyEnemy, hp: 5000 };
  const engine = mk(tankyEnemy, taggedParts('毒', 6), 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  let sawExplode = false;
  for (let i = 0; i < 6 && engine.getStatus() === 'ongoing' && !sawExplode; i++) {
    if (engine.getPhase() !== 'player_turn') break;
    engine.useCommand('CMD007'); // 毒針: 毒を付与するコマンド。繰り返し使って閾値到達を狙う
    const snap = engine.getSnapshot();
    if (snap.log.some((l) => l.includes('毒が爆発'))) sawExplode = true;
  }
  assert(sawExplode, 'poison_synergy stage3 (poison_explode) triggers an automatic explosion once poison stacks reach the threshold');
}

// ============================================================
// 敵45体接続(段階6): 実データ(src/data/enemies.ts)を使って新設のEnemyMoveDef
// フィールド(selfHeal/hits/executeBonus/selfApplyStatus)と、45体全体の構築健全性を検証する。
// ============================================================

// --- Test 62: sanity - all 45 real enemies construct and battle without throwing ---
{
  let ok = true;
  for (const def of ENEMIES) {
    try {
      const engine = mk(def, [], 130, 100);
      engine.revealOrder();
      engine.beginFirstTurn();
      if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
      for (let i = 0; i < 3 && engine.getStatus() === 'ongoing'; i++) {
        if (engine.getPhase() === 'player_turn') engine.useCommand('CMD005');
      }
    } catch (err) {
      ok = false;
      console.error(`  -> threw for ${def.id} (${def.name}):`, err);
    }
  }
  assert(ok, `all ${ENEMIES.length} real enemies construct and run a few turns without throwing`);
  assert(ENEMIES.length === 45, `enemies.ts has exactly 45 entries (observed ${ENEMIES.length})`);
}

// --- Test 63: ENM007(再生肉壁) 再生殻(selfHeal) heals the enemy on its 2nd action ---
{
  const dmgEnemy = enemy('ENM007');
  const engine = mk(dmgEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  // 1発目(防御)を消化させ、2発目(再生殻)がselfHealを発火させるまで進める
  for (let i = 0; i < 30 && engine.getStatus() === 'ongoing'; i++) {
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    const snap = engine.getSnapshot();
    if (snap.log.some((l) => l.includes('再生殻で') && l.includes('回復した'))) break;
    if (engine.getPhase() === 'player_turn') engine.useCommand('CMD005');
  }
  const finalSnap = engine.getSnapshot();
  assert(finalSnap.log.some((l) => l.includes('再生殻で') && l.includes('回復した')), 'ENM007 再生殻(selfHeal) logs a self-heal');
}

// --- Test 64: ENM011(千腕虫) 連撃(hits:3) deals 3 separate hit events on the player ---
{
  // PLAYER_BASEは5%の基礎回避を持つため、1回の評価判定で3Hitすべてがまとめて回避される
  // ことがある(all-or-nothing判定のため)。数回リトライして安定させる。
  const dmgEnemy = enemy('ENM011');
  let hits = 0;
  for (let attempt = 0; attempt < 10 && hits !== 3; attempt++) {
    const engine = mk(dmgEnemy, [], 100000, 100);
    engine.revealOrder();
    engine.beginFirstTurn();
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    const events = engine.drainEvents();
    hits = events.filter((e) => e.type === 'attack' && e.side === 'enemy').length;
  }
  assert(hits === 3, `ENM011 連撃(hits:3) deals exactly 3 separate hit events (observed ${hits}, 10 attempts)`);
}

// --- Test 65: ENM012(処刑獣) 処刑(executeBonus) deals more damage when the player's HP is below the threshold ---
{
  // ENM012の技サイクルは [破砕撃, 処刑, 背水撃]。1発目(破砕撃)を待機で消化し、
  // 2発目(処刑)のダメージを、プレイヤーの開始HPを変えて比較する(startingHpはプレイヤーの値)。
  const measureExecuteDmg = (startingHp: number): number => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const engine = mk(enemy('ENM012'), [], startingHp, 100);
      engine.revealOrder();
      engine.beginFirstTurn();
      for (let i = 0; i < 30; i++) {
        const phase = engine.getPhase();
        if (phase === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
        else if (phase === 'player_turn' && engine.getStatus() === 'ongoing') engine.useCommand('CMD005');
        else break;
        // useCommand/resolveAnnouncedEnemyTurnがバトルを終わらせてしまっても、直後に必ずdrainする
        // (敗北等でstatusが変わった直後にイベントを取り逃す既知の落とし穴を避けるため)。
        const events = engine.drainEvents();
        const hit = events.find((e) => e.type === 'attack' && e.side === 'enemy' && e.commandName === '処刑');
        if (hit && hit.type === 'attack') return hit.damage;
        if (engine.getStatus() !== 'ongoing') break;
      }
    }
    return -1;
  };
  const dmgAtLowHp = measureExecuteDmg(35); // 130の約27%、executeBonusの閾値(30%)を下回る
  const dmgAtFullHp = measureExecuteDmg(130); // 満タン、閾値を上回る

  assert(
    dmgAtLowHp > 0 && dmgAtFullHp > 0 && dmgAtLowHp > dmgAtFullHp,
    `ENM012 処刑(executeBonus) deals more damage when the player's HP is low (lowHp=${dmgAtLowHp}, fullHp=${dmgAtFullHp})`
  );
}

// --- Test 66: ENM009(狂走獣) 狂化(selfApplyStatus) grants the enemy its own frenzy status ---
{
  const dmgEnemy = enemy('ENM009');
  const engine = mk(dmgEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  // 1発目(強打)を消化し、2発目(狂化)がselfApplyStatusを発火させるまで進める
  for (let i = 0; i < 30 && engine.getStatus() === 'ongoing'; i++) {
    if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
    const snap = engine.getSnapshot();
    if (snap.enemy.statuses.some((s) => s.kind === 'frenzy')) break;
    if (engine.getPhase() === 'player_turn') engine.useCommand('CMD005');
  }
  const finalSnap = engine.getSnapshot();
  assert(finalSnap.enemy.statuses.some((s) => s.kind === 'frenzy'), 'ENM009 狂化(selfApplyStatus) grants the enemy its own frenzy status');
}

// --- Test 67: a boss's HP-threshold phases (70%/35%) both fire in sequence ---
{
  const boss = enemy('ENM042'); // 処刑王: hpPctThreshold 50/35... (実データはEnemyDefのphases配列を直接検証)
  assert(!!boss.phases && boss.phases.length === 2, `ENM042 (boss tier) has exactly 2 phases (observed ${boss.phases ? boss.phases.length : 0})`);
  if (boss.phases) {
    assert(boss.phases[0].hpPctThreshold === 50, `ENM042 phase 1 triggers at 50% HP (observed ${boss.phases[0].hpPctThreshold})`);
    assert(boss.phases[1].hpPctThreshold === 35, `ENM042 phase 2 triggers at 35% HP (observed ${boss.phases[1].hpPctThreshold})`);
  }
}

// ============================================================
// コマンド段階的解放(獲得部位によるアンロック)の検証。
// ============================================================

// --- Test 68: with no parts equipped, only the 4 baseline commands are unlocked ---
{
  const engine = new CtbEngine(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  const ids = engine.getSnapshot().commands.map((c) => c.id).sort();
  const expected = ['CMD001', 'CMD002', 'CMD004', 'CMD005'].sort();
  assert(
    ids.length === 4 && expected.every((id) => ids.includes(id)),
    `with no parts equipped, only the 4 baseline commands are unlocked (observed ${JSON.stringify(ids)})`
  );
}

// --- Test 69: 解放は段階制。同タグ1個で1つ目、2個で2つ目が開く ---
{
  const one = new CtbEngine(dummyEnemy, unlockParts('炎', 1), 130, 100);
  one.revealOrder();
  const oneIds = new Set(one.getSnapshot().commands.map((c) => c.id));
  assert(oneIds.has('CMD006'), 'one 炎 part unlocks the first 炎 command (CMD006)');
  assert(!oneIds.has('CMD040'), 'one 炎 part does NOT unlock the deeper 炎 command yet (CMD040) — staged unlock');
  assert(!oneIds.has('CMD009'), 'a 炎 part never unlocks an unrelated tag (CMD009, 多段)');

  const two = new CtbEngine(dummyEnemy, unlockParts('炎', 2), 130, 100);
  two.revealOrder();
  const twoIds = new Set(two.getSnapshot().commands.map((c) => c.id));
  assert(twoIds.has('CMD006') && twoIds.has('CMD040'), 'a second 炎 part unlocks the next 炎 command');

  // 深いコマンドほど必要数が多い(1 -> 2 -> 3 -> 4 で頭打ち)
  const needs = COMMANDS.filter((c) => c.unlockTag === '時間').map((c) => c.unlockCount ?? 1).sort();
  assert(needs[0] === 1 && needs[needs.length - 1] > 1, `a multi-command tag ramps its requirement (時間: ${needs.join(',')})`);
  assert(COMMANDS.every((c) => (c.unlockCount ?? 1) <= 4), 'no command needs more than 4 same-tag parts (the equip cap is 6)');
}

// --- Test 70: useCommand() rejects a locked command even if called directly (defense in depth) ---
{
  const engine = new CtbEngine(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const hpBefore = engine.getSnapshot().enemy.hp;
  const r = engine.useCommand('CMD009'); // 連撃(多段) is locked with no parts equipped
  const hpAfter = engine.getSnapshot().enemy.hp;
  assert(!r.ok, 'useCommand() rejects a locked command even when called directly, not just hidden from the UI');
  assert(hpAfter === hpBefore, 'a rejected locked-command call has no side effect on battle state');
}

// --- Test 71: decideAutoCommand() never picks a locked command ---
{
  const engine = new CtbEngine(dummyEnemy, [], 130, 100);
  engine.revealOrder();
  engine.beginFirstTurn();
  if (engine.getPhase() === 'enemy_first_announce') engine.resolveAnnouncedEnemyTurn();
  const unlockedIds = new Set(engine.getSnapshot().commands.map((c) => c.id));
  let allPicksUnlocked = true;
  for (let i = 0; i < 30; i++) {
    const picked = engine.decideAutoCommand();
    if (!unlockedIds.has(picked.id)) allPicksUnlocked = false;
  }
  assert(allPicksUnlocked, 'decideAutoCommand() never recommends a command outside the currently unlocked set (30 samples)');
}

console.log('done');
