#!/usr/bin/env node
// ============================================================
// テストランナー。tests/*.test.ts をすべて実行し、OK/FAIL を集計する。
//
// Node 22 の --experimental-strip-types で .ts を直接動かしているため、
// テスト用のビルド設定やテストフレームワークの依存を増やしていない。
// 各テストは assert() が FAIL を出したとき process.exitCode を立てる。
// ============================================================
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => !only || f.includes(only))
  .sort();

if (files.length === 0) {
  console.error(only ? `no test file matches "${only}"` : 'no test files found');
  process.exit(1);
}

let totalOk = 0;
let totalFail = 0;
const failedFiles = [];

for (const file of files) {
  const res = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--experimental-transform-types',
      '--no-warnings',
      '--import',
      join(here, 'register.mjs'),
      join(here, file),
    ],
    { encoding: 'utf-8' }
  );
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const ok = (out.match(/^OK:/gm) ?? []).length;
  const fail = (out.match(/^FAIL:/gm) ?? []).length;
  totalOk += ok;
  totalFail += fail;

  const crashed = res.status !== 0 && fail === 0;
  const status = fail > 0 || crashed ? 'FAIL' : 'pass';
  console.log(`${status.padEnd(4)} ${file.padEnd(24)} ${ok} ok${fail > 0 ? `, ${fail} failed` : ''}`);
  if (fail > 0) {
    failedFiles.push(file);
    for (const line of out.split('\n').filter((l) => l.startsWith('FAIL:'))) console.log(`       ${line}`);
  }
  if (crashed) {
    failedFiles.push(file);
    console.log(out.split('\n').slice(-15).map((l) => `       ${l}`).join('\n'));
  }
}

console.log(`\n${totalOk} assertions, ${totalFail} failed, ${files.length} files`);
process.exit(failedFiles.length > 0 ? 1 : 0);
