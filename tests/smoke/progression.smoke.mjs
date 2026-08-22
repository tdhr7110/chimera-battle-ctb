// ============================================================
// 32戦構成・接続枠・部位カテゴリのブラウザ確認。
//
//   npm run build
//   npx vite preview --port 4173 --strictPort --base /chimera-battle-ctb/ &
//   node tests/smoke/progression.smoke.mjs
//
// 接続枠を増やす部位は拾えるまで待てないので、セーブを直接流し込んで確認する。
// ============================================================
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173/chimera-battle-ctb/';
const SAVE_KEY = 'chimera-battle-ctb:run:v1';

let failed = false;
const fail = (m) => { console.error('  FAIL:', m); failed = true; };
const ok = (m) => console.log('  ok:', m);

function save(overrides) {
  return {
    version: 7,
    state: {
      phase: 'prep', battleIndex: 1, coreHp: 130, mp: 30, starterId: 'swift',
      equippedPartIds: [], inventoryPartIds: [],
      currentEnemyId: null, enemyCandidateIds: [], dropCandidateIds: [],
      lastDefeatedEnemyId: null, lastAcquiredPartId: null, foughtEnemyIds: [],
      pendingUnlockCommandIds: [], newCommandIds: [],
      lastFusionPartId: null, declinedFusionIds: [], pendingAdvance: false,
      difficultyId: 'DIF002', seenIntro: true, resultOutcome: null,
      ...overrides,
    },
  };
}

async function boot(page, envelope) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(k, v); },
    [SAVE_KEY, JSON.stringify(envelope)]);
  await page.reload({ waitUntil: 'networkidle' });
  const cont = page.getByRole('button', { name: '続きから', exact: false });
  if ((await cont.count()) > 0) await cont.first().click();
  await page.waitForTimeout(400);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// --- 既定の接続枠は12 ---
await boot(page, save({}));
const header = await page.locator('.screen__header').innerText();
if (!header.includes('全32戦')) fail(`ラン全体が32戦になっていない (${header.replace(/\n/g, ' ')})`);
else ok('全32戦のランになっている');
if (!header.includes('腐食の巣')) fail('待機画面にエリア名が出ていない');
else ok('待機画面にエリア名が出る');

await page.getByRole('button', { name: '部位', exact: false }).first().click().catch(() => {});
await page.waitForTimeout(300);
const capText = await page.locator('body').innerText();
if (!/\/\s*12/.test(capText)) fail('既定の接続枠が12になっていない');
else ok('既定の接続枠は12');

// --- 接続枠を増やす部位を持つと上限が上がる ---
// PRT085 原初樹核 = 接続枠+4 なので 12 -> 16 になる。
await boot(page, save({ equippedPartIds: ['PRT085'] }));
await page.waitForTimeout(300);
const capText2 = await page.locator('body').innerText();
if (!/\/\s*16/.test(capText2)) fail('接続枠を増やす部位で上限が上がらない (16を期待)');
else ok('接続枠を増やす部位で上限が12→16になる');

// --- 戦闘画面: エリアの点は8個、ラン全体は32戦 ---
await boot(page, save({ battleIndex: 11 }));
await page.getByText('⚔️ 次の戦闘へ進む').click();
await page.waitForTimeout(300);
await page.locator('.enemy-pick').first().click();
await page.waitForTimeout(2200);

const dots = await page.locator('.bt-dot').count();
if (dots !== 8) fail(`エリアの点が8個でない (${dots})`);
else ok('戦闘画面の点は「今いるエリアの8戦」だけ');

const prog = (await page.locator('.bt-progress').innerText()).replace(/\n/g, ' ');
if (!prog.includes('全32戦')) fail(`戦闘画面が全32戦になっていない (${prog})`);
if (!prog.includes('AREA 2/4')) fail(`第11戦がエリア2になっていない (${prog})`);
else ok(`エリア表示が正しい (${prog})`);

const m = await page.evaluate(() => ({ s: document.documentElement.scrollHeight, c: document.documentElement.clientHeight }));
if (m.s > m.c + 4) fail(`戦闘画面が縦スクロールする (${m.s} > ${m.c})`);
else ok(`32戦構成でも戦闘画面は1画面に収まる (${m.s}=${m.c})`);

if (errors.length) fail(`コンソールエラー: ${errors.join(' | ')}`);
else ok('コンソールエラーなし');

await page.close();
await browser.close();
if (failed) { console.error('\nPROGRESSION SMOKE FAILED'); process.exit(1); }
console.log('\nALL PROGRESSION SMOKE CHECKS PASSED');
