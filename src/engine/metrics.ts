// ============================================================
// Phase 6: バランス計測。TEST12/14の「プレイを邪魔せずデータだけ貯める」考え方を、
// CTB版の実際のイベント構成へ合わせて実装したもの。
//
// 厳守する方針:
//   - 外部送信は一切しない。fetch/XHR/WebSocketをこのファイルは使わない。
//   - 個人情報を記録しない。記録するのはゲーム内のID・数値・時刻の差分だけで、
//     ユーザー名・IP・UA・localStorageの他のキーには触れない。
//   - 通常画面に常時ダッシュボードを出さない(閲覧は明示操作か開発モードのときだけ)。
//   - 保存に失敗してもゲームを止めない(全てtry/catch、失敗時は黙ってメモリ上だけで続ける)。
//   - CTBの進行やバランスそのものには一切影響しない(読み取り専用の記録係)。
// ============================================================

const STORAGE_KEY = 'chimera-battle-ctb:metrics:v1';
const MAX_RUNS = 50; // 貯めすぎてlocalStorageを圧迫しないよう、古いランから捨てる

export interface BattleRecord {
  battleIndex: number;
  enemyId: string;
  enemyTier: string;
  outcome: 'won' | 'lost';
  turns: number;
  durationMs: number;
  hpLeft: number;
  mpLeft: number;
  commandUses: Record<string, number>; // コマンドID -> 使用回数
  unlockedCommandIds: string[]; // その戦闘で使用可能だった解放済みコマンド
  equippedPartIds: string[];
  activeSynergyNames: string[];
}

export interface RunRecord {
  runId: string;
  startedAt: number;
  endedAt: number | null;
  outcome: 'victory' | 'defeat' | null;
  reachedBattle: number;
  starterId: string | null;
  battles: BattleRecord[];
  takenPartIds: string[]; // 報酬で選んだ部位
  skippedPartIds: string[]; // 報酬画面に出たが選ばなかった部位
  chosenEnemyIds: string[]; // 敵選択で選んだ相手
  fusionCount: number; // 融合を実行した回数
  fusionOfferCount: number; // 融合を提示された回数(実行率の分母)
  finalEquippedPartIds: string[];
}

export interface MetricsState {
  runs: RunRecord[];
}

function emptyState(): MetricsState {
  return { runs: [] };
}

let state: MetricsState = load();
let current: RunRecord | null = null;
let battleStartedAt = 0;
let battleTurns = 0;
let battleCommandUses: Record<string, number> = {};

function load(): MetricsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<MetricsState>;
    return Array.isArray(parsed.runs) ? { runs: parsed.runs } : emptyState();
  } catch {
    return emptyState();
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 容量超過・プライベートモード等。計測はあくまで補助なので、失敗しても進行は続ける。
  }
}

export function getMetrics(): MetricsState {
  return state;
}

export function clearMetrics() {
  state = emptyState();
  current = null;
  persist();
}

// --- 記録フック。すべて「呼ばれなくてもゲームは成立する」ように書く ---

export function recordRunStart(starterId: string | null) {
  try {
    current = {
      runId: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      startedAt: Date.now(),
      endedAt: null,
      outcome: null,
      reachedBattle: 1,
      starterId,
      battles: [],
      takenPartIds: [],
      skippedPartIds: [],
      chosenEnemyIds: [],
      fusionCount: 0,
      fusionOfferCount: 0,
      finalEquippedPartIds: [],
    };
    state = { runs: [...state.runs, current].slice(-MAX_RUNS) };
    persist();
  } catch {
    current = null;
  }
}

export function recordBattleStart() {
  battleStartedAt = Date.now();
  battleTurns = 0;
  battleCommandUses = {};
}

export function recordCommandUse(commandId: string) {
  battleCommandUses[commandId] = (battleCommandUses[commandId] ?? 0) + 1;
  battleTurns += 1;
}

export function recordEnemyChosen(enemyId: string) {
  if (!current) return;
  current.chosenEnemyIds.push(enemyId);
  persist();
}

export function recordBattleEnd(record: Omit<BattleRecord, 'turns' | 'durationMs' | 'commandUses'>) {
  if (!current) return;
  try {
    current.battles.push({
      ...record,
      turns: battleTurns,
      durationMs: battleStartedAt ? Date.now() - battleStartedAt : 0,
      commandUses: { ...battleCommandUses },
    });
    current.reachedBattle = Math.max(current.reachedBattle, record.battleIndex);
    persist();
  } catch {
    // ignore
  }
}

export function recordDrop(takenPartId: string | null, offeredPartIds: string[]) {
  if (!current) return;
  if (takenPartId) current.takenPartIds.push(takenPartId);
  for (const id of offeredPartIds) if (id !== takenPartId) current.skippedPartIds.push(id);
  persist();
}

export function recordFusionOffered() {
  if (!current) return;
  current.fusionOfferCount += 1;
  persist();
}

export function recordFusionPerformed() {
  if (!current) return;
  current.fusionCount += 1;
  persist();
}

export function recordRunEnd(outcome: 'victory' | 'defeat', finalEquippedPartIds: string[]) {
  if (!current) return;
  current.endedAt = Date.now();
  current.outcome = outcome;
  current.finalEquippedPartIds = [...finalEquippedPartIds];
  persist();
  current = null;
}

// --- 集計(表示・書き出し用の純粋関数) ---

export interface MetricsSummary {
  runCount: number;
  victories: number;
  defeats: number;
  avgReachedBattle: number;
  battleCount: number;
  avgTurnsPerBattle: number;
  avgBattleSeconds: number;
  winRateByTier: Record<string, { wins: number; total: number }>;
  commandUsage: { commandId: string; uses: number }[];
  neverUsedUnlockedCommandIds: string[]; // 解放されていたのに一度も使われなかったコマンド
  fusionRate: number; // 提示に対する実行率
  mostTakenPartIds: { partId: string; count: number }[];
  mostSkippedPartIds: { partId: string; count: number }[];
}

export function summarise(s: MetricsState = state): MetricsSummary {
  const runs = s.runs;
  const battles = runs.flatMap((r) => r.battles);
  const uses: Record<string, number> = {};
  const unlocked = new Set<string>();
  for (const b of battles) {
    for (const [id, n] of Object.entries(b.commandUses)) uses[id] = (uses[id] ?? 0) + n;
    for (const id of b.unlockedCommandIds) unlocked.add(id);
  }
  const byTier: Record<string, { wins: number; total: number }> = {};
  for (const b of battles) {
    const t = (byTier[b.enemyTier] ??= { wins: 0, total: 0 });
    t.total += 1;
    if (b.outcome === 'won') t.wins += 1;
  }
  const count = (ids: string[]) => {
    const m: Record<string, number> = {};
    for (const id of ids) m[id] = (m[id] ?? 0) + 1;
    return Object.entries(m)
      .map(([partId, c]) => ({ partId, count: c }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  };
  const offers = runs.reduce((n, r) => n + r.fusionOfferCount, 0);
  const fusions = runs.reduce((n, r) => n + r.fusionCount, 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  return {
    runCount: runs.length,
    victories: runs.filter((r) => r.outcome === 'victory').length,
    defeats: runs.filter((r) => r.outcome === 'defeat').length,
    avgReachedBattle: Math.round(avg(runs.map((r) => r.reachedBattle)) * 10) / 10,
    battleCount: battles.length,
    avgTurnsPerBattle: Math.round(avg(battles.map((b) => b.turns)) * 10) / 10,
    avgBattleSeconds: Math.round(avg(battles.map((b) => b.durationMs / 1000)) * 10) / 10,
    winRateByTier: byTier,
    commandUsage: Object.entries(uses)
      .map(([commandId, n]) => ({ commandId, uses: n }))
      .sort((a, b) => b.uses - a.uses),
    neverUsedUnlockedCommandIds: [...unlocked].filter((id) => !uses[id]).sort(),
    fusionRate: offers === 0 ? 0 : Math.round((fusions / offers) * 100) / 100,
    mostTakenPartIds: count(runs.flatMap((r) => r.takenPartIds)),
    mostSkippedPartIds: count(runs.flatMap((r) => r.skippedPartIds)),
  };
}

export function exportJson(s: MetricsState = state): string {
  return JSON.stringify(s, null, 2);
}

/** 1戦闘 = 1行のCSV。表計算でそのまま開ける形にしておく。 */
export function exportCsv(s: MetricsState = state): string {
  const header = [
    'runId', 'startedAt', 'runOutcome', 'battleIndex', 'enemyId', 'enemyTier', 'outcome',
    'turns', 'durationSec', 'hpLeft', 'mpLeft', 'equippedParts', 'activeSynergies', 'commandUses',
  ];
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(',')];
  for (const run of s.runs) {
    for (const b of run.battles) {
      lines.push(
        [
          run.runId,
          new Date(run.startedAt).toISOString(),
          run.outcome ?? '',
          String(b.battleIndex),
          b.enemyId,
          b.enemyTier,
          b.outcome,
          String(b.turns),
          (b.durationMs / 1000).toFixed(1),
          String(b.hpLeft),
          String(b.mpLeft),
          b.equippedPartIds.join(' '),
          b.activeSynergyNames.join(' '),
          Object.entries(b.commandUses).map(([id, n]) => `${id}x${n}`).join(' '),
        ]
          .map((v) => escape(String(v)))
          .join(',')
      );
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * 計測ビューアを開いてよいか。通常のプレイ画面には出さない。
 *   - 開発ビルド(vite dev)なら常に可
 *   - 本番でもURLに ?metrics=1 を付けたときだけ可(明示操作)
 */
export function metricsViewerEnabled(): boolean {
  try {
    if (import.meta.env?.DEV) return true;
    return new URLSearchParams(window.location.search).has('metrics');
  } catch {
    return false;
  }
}
