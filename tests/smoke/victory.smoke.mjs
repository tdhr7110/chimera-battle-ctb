// ============================================================
// 勝利 → 部位獲得 の演出をブラウザで確認する。
//
//   npm run build
//   npx vite preview --port 4173 --strictPort --base /chimera-battle-ctb/ &
//   node tests/smoke/victory.smoke.mjs
//
// AUTOで1戦目を決着まで回し、勝利演出と部位選択画面が要求どおり出るかだけを見る。
// 見た目の細部(色や間隔)は対象外。
// ============================================================
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173/chimera-battle-ctb/';

let failed = false;
const fail = (m) => { console.error('  FAIL:', m); failed = true; };
const ok = (m) => console.log('  ok:', m);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('⚔️ GAME START', { exact: false }).click();
await page.locator('text=俊敏個体').first().click();
await page.waitForTimeout(300);
const intro = page.getByText('はじめる', { exact: true });
if ((await intro.count()) > 0) await intro.click();
await page.getByText('⚔️ 次の戦闘へ進む').click();
await page.waitForTimeout(300);
await page.locator('.enemy-pick').first().click();
await page.waitForTimeout(2200);

// --- AUTOで決着まで ---
await page.locator('.stage-btn--auto').click();
let ended = false;
for (let i = 0; i < 150 && !ended; i++) {
  await page.waitForTimeout(300);
  ended = (await page.locator('.bend').count()) > 0;
}
if (!ended) { fail('AUTOで決着まで進まない'); process.exit(1); }
ok('AUTOで1戦目が決着する');

// --- 勝利演出 ---
if ((await page.locator('.bend--won').count()) !== 1) fail('勝利の演出が出ない');
else ok('勝利演出が出る');
const letters = await page.locator('.bend__letter').count();
if (letters !== 7) fail(`VICTORYの文字が1文字ずつ出ていない (${letters})`);
else ok('VICTORY が1文字ずつ組まれている');
if ((await page.locator('.bend__ray').count()) < 8) fail('光条が出ていない');
if ((await page.locator('.bend__ring').count()) !== 3) fail('ショックウェーブが出ていない');
if ((await page.locator('.bend__spark').count()) < 20) fail('粒子が出ていない');
else ok('光条・ショックウェーブ・粒子がすべて出ている');
const stats = await page.locator('.bend__stat').count();
if (stats !== 3) fail(`戦績が3項目出ていない (${stats})`);
else ok('ターン数・残りHP・残りMPが出る');

// 決着直前のタップが貫通しないこと(演出が即座に消えない)
await page.locator('.bend').click({ force: true, position: { x: 5, y: 5 } });
if ((await page.locator('.bend').count()) !== 1) fail('演出が即座に飛ばされてしまう');
else ok('決着直後のタップは貫通しない');

// 縦スクロールを生まない
const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight + 4);
if (scrolls) fail('勝利演出中にページが縦スクロールする');
else ok('勝利演出中も縦スクロールしない');

// --- 部位獲得画面 ---
await page.waitForTimeout(900);
await page.locator('.bend').click();
await page.waitForTimeout(900);
if ((await page.locator('.reward-screen').count()) !== 1) fail('勝利後に部位獲得画面へ進まない');
else ok('タップで部位獲得画面へ進む');
if ((await page.locator('.reward-screen__rays span').count()) < 8) fail('部位獲得画面に光条が無い');
if ((await page.locator('.reward-card__rank').count()) === 0) fail('候補にランク表示が無い');
else ok('部位獲得画面が光条とランク付きで出る');

const cards = page.locator('.reward-card');
const n = await cards.count();
if (n === 0) { fail('候補部位が無い'); }
else {
  // カードが1枚ずつ遅れて出る(遅延がカードごとに違う)
  const delays = await cards.evaluateAll((els) => els.map((e) => e.style.animationDelay));
  if (new Set(delays).size !== delays.length) fail(`カードの出現が同時 (${delays.join(',')})`);
  else ok(`候補が1枚ずつ遅れて出る (${delays.join(' / ')})`);
}

// --- 選ぶと獲得演出 ---
await cards.first().click();
await page.waitForTimeout(700);
if ((await page.locator('.burst').count()) !== 1) fail('部位を選んでも獲得演出が出ない');
else ok('部位を選ぶと獲得演出が出る');

if (errors.length) fail(`コンソールエラー: ${errors.join(' | ')}`);
else ok('コンソールエラーなし');

await page.close();
await browser.close();
if (failed) { console.error('\nVICTORY SMOKE FAILED'); process.exit(1); }
console.log('\nALL VICTORY SMOKE CHECKS PASSED');
