// ============================================================
// 戦闘画面のブラウザ確認。ビルド済みの dist を vite preview で配信した状態に対して走らせる。
//
//   npm run build
//   npx vite preview --port 4173 --strictPort --base /chimera-battle-ctb/ &
//   node tests/smoke/battle.smoke.mjs            # 3解像度すべて
//   ONLY_VP=390x780 node tests/smoke/battle.smoke.mjs
//
// 確認するのは「仕様として要求されている挙動」だけで、見た目の細部は対象外。
// ============================================================
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4173/chimera-battle-ctb/';
const ALL = [
  { name: '390x780', width: 390, height: 780 },
  { name: '430x932', width: 430, height: 932 },
  { name: '1280x720', width: 1280, height: 720 },
];
const VIEWPORTS = process.env.ONLY_VP ? ALL.filter((v) => v.name === process.env.ONLY_VP) : ALL;

let failed = false;
const fail = (m) => { console.error('  FAIL:', m); failed = true; };
const ok = (m) => console.log('  ok:', m);

async function noScroll(page, label) {
  const m = await page.evaluate(() => ({
    s: document.documentElement.scrollHeight,
    c: document.documentElement.clientHeight,
  }));
  if (m.s > m.c + 4) fail(`${label}: ページが縦スクロールする (${m.s} > ${m.c})`);
  return m;
}

async function toBattle(page, starter = '俊敏個体') {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('⚔️ GAME START', { exact: false }).click();
  await page.locator(`text=${starter}`).first().click();
  await page.waitForTimeout(300);
  const intro = page.getByText('はじめる', { exact: true });
  if ((await intro.count()) > 0) await intro.click();
  await page.getByText('⚔️ 次の戦闘へ進む').click();
  await page.waitForTimeout(300);
  await page.locator('.enemy-pick').first().click();
  await page.waitForTimeout(2000);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const vp of VIEWPORTS) {
  console.log(`\n=== ${vp.name} ===`);
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // --- 設定はタイトルから開ける。右上に常時ある ---
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  if ((await page.locator('.settings-fab').count()) !== 1) fail('タイトルに設定ボタンが無い');
  else ok('タイトルに設定ボタンがある');
  await page.locator('.settings-fab').click();
  await page.waitForTimeout(250);
  if ((await page.locator('.settings-row').count()) < 2) fail('設定に操作とサウンドの行が無い');
  if ((await page.locator('.settings-slider input').count()) !== 1) fail('設定に音量スライダーが無い');
  else ok('設定に「カテゴリへ戻す」トグルと音量が入っている');
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.waitForTimeout(200);

  // --- 戦闘画面 ---
  await toBattle(page);
  if ((await page.locator('.settings-fab').count()) !== 1) fail('戦闘中に設定ボタンが無い');
  else ok('戦闘中も設定ボタンが右上にある');

  if ((await page.locator('.log-panel').count()) !== 0) fail('常時表示のログ欄が残っている');
  else ok('常時表示のログ欄は無くなっている');
  if ((await page.locator('.stage-btn--log').count()) !== 1) fail('ログボタンが無い');
  if ((await page.locator('.stage-btn--auto').count()) !== 1) fail('AUTOボタンが無い');

  // 位置: ログ=左下、AUTO=右下(ステージ内)
  const stage = await page.locator('.stage').boundingBox();
  const logBox = await page.locator('.stage-btn--log').boundingBox();
  const autoBox = await page.locator('.stage-btn--auto').boundingBox();
  const inStage = (b) => b.y > stage.y && b.y + b.height <= stage.y + stage.height + 2;
  if (!inStage(logBox) || logBox.x > stage.x + stage.width / 2) fail('ログボタンがステージ左下に無い');
  if (!inStage(autoBox) || autoBox.x < stage.x + stage.width / 2) fail('AUTOボタンがステージ右下に無い');
  if (autoBox.height > 30) fail(`AUTOボタンが大きすぎる (${Math.round(autoBox.height)}px)`);
  else ok(`ログ=左下 / AUTO=右下、AUTOは小さい (${Math.round(autoBox.width)}x${Math.round(autoBox.height)})`);

  // 敵にもMPがある(Excel「敵」シートの最大MP)。危険技の燃料でMP吸収の的になる。
  if ((await page.locator('.bt-mp--enemy').count()) !== 1) fail('敵のMPゲージが出ていない');
  else {
    const enemyMp = await page.locator('.bt-mp--enemy .bt-mp__num').innerText();
    if (!/^\d+ \/ \d+$/.test(enemyMp.trim())) fail(`敵MPの表示が数値でない (${enemyMp})`);
    else ok(`敵のMPゲージが出る (${enemyMp.trim()})`);
  }

  const m1 = await noScroll(page, '戦闘開始時');
  ok(`戦闘画面がスクロールしない (${m1.s}=${m1.c})`);

  // --- ログはポップアップ ---
  await page.locator('.stage-btn--log').click();
  await page.waitForTimeout(300);
  if ((await page.locator('.log-modal').count()) !== 1) fail('ログがポップアップしない');
  else ok('ログボタンでポップアップが開く');
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.waitForTimeout(200);

  // --- 既定ではコマンド実行後もカテゴリを開いたまま ---
  await page.locator('.cmd-cat').first().click();
  await page.waitForTimeout(200);
  const card = page.locator('.cmd-card').first();
  await card.click();
  await page.waitForTimeout(150);
  await card.click();
  await page.waitForTimeout(300);
  if ((await page.locator('.cmd-card').count()) === 0) fail('既定でカテゴリが閉じてしまう');
  else ok('既定ではカテゴリを開いたまま次の手を選べる');

  // --- 敵の行動には間があり、何をしたか帯で出る ---
  // 帯は1手あたり620msで消えるので、確実に捕まえるまで長めに見る。
  // 自分の手番が連続して敵の手番がまだ来ていない場合もあるため、
  // 帯が出なければ次の手を撃ってからもう一度待つ。
  let sawBanner = false;
  for (let round = 0; round < 3 && !sawBanner; round++) {
    for (let i = 0; i < 30 && !sawBanner; i++) {
      if ((await page.locator('.enemy-turn-banner').count()) > 0) sawBanner = true;
      else await page.waitForTimeout(100);
    }
    if (!sawBanner) {
      const again = page.locator('.cmd-card').first();
      if ((await again.count()) > 0 && (await again.isEnabled())) {
        await again.click();
        await page.waitForTimeout(120);
        await again.click();
      }
    }
  }
  if (!sawBanner) fail('敵の行動を知らせる帯が出ない');
  else ok('自分の行動のあと一拍置いて、敵の行動が帯で出る');
  await noScroll(page, '敵の行動中');

  // --- 設定のトグルを入れると実行後に畳む ---
  await page.waitForTimeout(1800);
  await page.locator('.settings-fab').click();
  await page.waitForTimeout(250);
  await page.locator('.settings-row').first().click();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.waitForTimeout(250);
  const stored = await page.evaluate(() => localStorage.getItem('chimera-battle-ctb:ui-prefs:v1'));
  if (!stored || !stored.includes('"returnToCategories":true')) fail(`トグルが保存されない (${stored})`);
  else ok('トグルの状態がlocalStorageへ保存される');

  // 直前の実行ではカテゴリが開いたままなので、いったん戻してから開き直す
  if ((await page.locator('.cmd-back').count()) > 0) {
    await page.locator('.cmd-back').click();
    await page.waitForTimeout(200);
  }
  await page.locator('.cmd-cat').first().click();
  await page.waitForTimeout(200);
  const card2 = page.locator('.cmd-card').first();
  if ((await card2.count()) > 0 && (await card2.isEnabled())) {
    await card2.click();
    await page.waitForTimeout(150);
    await card2.click();
    await page.waitForTimeout(400);
    if ((await page.locator('.cmd-cat').count()) !== 4) fail('トグルONでもカテゴリへ戻らない');
    else ok('トグルONにすると実行後カテゴリへ戻る');
  }

  if (errors.length) fail(`コンソールエラー: ${errors.join(' | ')}`);
  else ok('コンソールエラーなし');
  await page.close();
}

await browser.close();
if (failed) {
  console.error('\nSMOKE FAILED');
  process.exit(1);
}
console.log('\nALL BATTLE SMOKE CHECKS PASSED');
