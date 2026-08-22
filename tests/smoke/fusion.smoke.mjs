// ============================================================
// 融合フローのブラウザ確認。ビルド済みの dist を vite preview で配信した状態に対して走らせる。
//
//   npm run build
//   npx vite preview --port 4173 --strictPort --base /chimera-battle-ctb/ &
//   node tests/smoke/fusion.smoke.mjs
//
// 融合画面には「素材が揃った状態」でしか入れないので、セーブを直接流し込んで
// そのフェーズから起動する。確かめるのは仕様として要求されている挙動だけ。
// ============================================================
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173/chimera-battle-ctb/';
const SAVE_KEY = 'chimera-battle-ctb:run:v1';

let failed = false;
const fail = (m) => { console.error('  FAIL:', m); failed = true; };
const ok = (m) => console.log('  ok:', m);

// 融合フェーズのセーブ。素材は FUS301(Legendary / 部位指定)の 処刑眼・極 + 多腕・零。
const SAVE = {
  version: 6,
  state: {
    phase: 'fusion', battleIndex: 3, coreHp: 130, mp: 30, starterId: 'STR001',
    equippedPartIds: ['PRT013', 'PRT028'], inventoryPartIds: [],
    currentEnemyId: null, enemyCandidateIds: [], dropCandidateIds: [],
    lastDefeatedEnemyId: null, lastAcquiredPartId: null,
    pendingUnlockCommandIds: [], newCommandIds: [],
    lastFusionPartId: null, declinedFusionIds: [], pendingAdvance: false,
    difficultyId: 'DIF002', seenIntro: true, resultOutcome: null,
  },
};

async function bootTo(page, save) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); },
    [SAVE_KEY, JSON.stringify(save)]);
  await page.reload({ waitUntil: 'networkidle' });
  // 「続きから」を選ぶ
  const cont = page.getByRole('button', { name: '続きから', exact: false });
  if ((await cont.count()) > 0) await cont.first().click();
  await page.waitForTimeout(400);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// --- 融合画面 ---
await bootTo(page, SAVE);
if ((await page.locator('.fusion-screen').count()) !== 1) fail('素材が揃っているのに融合画面が出ない');
else ok('素材が揃うと融合画面が出る');

if ((await page.locator('.fusion-screen--legendary').count()) !== 1) fail('レシピのレア度が画面に反映されていない');
else ok('融合部位のレア度が画面に出る(Legendary)');

const mats = await page.locator('.fusion-mat').count();
if (mats !== 2) fail(`素材が2つ表示されない (${mats})`);
else ok('素材2つ → 融合部位 の流れが見える');

const outName = await page.locator('.fusion-out__name').innerText();
if (outName !== '終焉の顎') fail(`融合結果の名前が違う (${outName})`);
else ok(`融合後の部位が出ている (${outName})`);

if ((await page.locator('.fusion-out__effects li').count()) < 2) fail('融合部位の効果が並んでいない');
else ok('融合部位の効果が並んでいる');

const noScroll = await page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight + 4);
if (!noScroll) console.log('  note: 融合画面は縦に伸びる(1画面制約は戦闘画面のみ)');

// --- あとにする → 再提示されない ---
await page.getByRole('button', { name: 'あとにする' }).click();
await page.waitForTimeout(400);
if ((await page.locator('.fusion-screen').count()) !== 0) fail('「あとにする」で融合画面が閉じない');
else ok('「あとにする」で融合画面を抜けられる');
const declined = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).state.declinedFusionIds, SAVE_KEY);
if (!declined.includes('FUS301')) fail(`断ったレシピが記録されない (${JSON.stringify(declined)})`);
else ok('断ったレシピが記録され、再提示されない');

// --- 融合する → 派手な演出 → 部位を所持 ---
await bootTo(page, SAVE);
await page.getByRole('button', { name: '融合する', exact: false }).click();
await page.waitForTimeout(600);
if ((await page.locator('.burst').count()) !== 1) fail('融合成立の演出が出ない');
else ok('融合すると獲得演出が出る');
if ((await page.locator('.burst--legendary').count()) !== 1) fail('演出がレア度に応じて変わらない');
else ok('演出がレア度(Legendary)のトーンになる');
if ((await page.locator('.burst__fusion-from').count()) !== 1) fail('素材→結果の表示が演出に無い');
else ok('演出の中に「素材 → 融合部位」が出る');

// 演出は入力を受け付けるまで少し待つ(貫通防止)。タップして閉じる。
await page.waitForTimeout(900);
await page.locator('.burst').click();
await page.waitForTimeout(600);
if ((await page.locator('.burst').count()) !== 0) fail('演出をタップしても閉じない');
else ok('タップで演出を閉じられる');

const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).state, SAVE_KEY);
const owned = [...after.equippedPartIds, ...after.inventoryPartIds];
if (!owned.includes('FUS301')) fail(`融合部位を所持していない (${JSON.stringify(owned)})`);
else ok('融合部位を所持している');
if (owned.includes('PRT013') || owned.includes('PRT028')) fail('素材が消費されていない');
else ok('素材2つが消費されている');
if (after.phase !== 'prep') fail(`融合後に待機画面へ戻らない (${after.phase})`);
else ok('融合後は待機画面へ戻る');

if (errors.length) fail(`コンソールエラー: ${errors.join(' | ')}`);
else ok('コンソールエラーなし');

await page.close();
await browser.close();
if (failed) { console.error('\nFUSION SMOKE FAILED'); process.exit(1); }
console.log('\nALL FUSION SMOKE CHECKS PASSED');
