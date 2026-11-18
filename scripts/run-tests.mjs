#!/usr/bin/env node
// 跨平台跑单测。
//
// 为什么不让 CI 直接写 `node --test cli/lib/*.test.mjs`：
//   · Ubuntu 的 bash 会展开 glob，Windows 的 pwsh / cmd **不会**（会把字面量 `*.test.mjs` 交给 node），
//     于是同一条命令在两个 runner 上行为不同——这本身就是一类 bug；
//   · 失败时最想知道「哪个文件、哪条断言」，所以这里把 TAP 的 `not ok` 行汇成一段摘要，
//     顺便写进 GitHub 的 step summary（打开 Actions 页面第一眼就能看到）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(ROOT, 'cli', 'lib');

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => path.join('cli', 'lib', f));

if (!files.length) {
  console.error(`没找到单测文件：${DIR}`);
  process.exit(1);
}

// 红的时候第一眼看这些：Node 版本、OS、临时目录、git 有没有
let git = '无';
try {
  git = execFileSync('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  git = process.env.DS_GIT ? `${process.env.DS_GIT}（DS_GIT）` : '无';
}
const envLine = `env：${process.version} · ${process.platform}/${process.arch} · tmp=${os.tmpdir()} · ${git}`;
console.log(envLine);
console.log(`跑 ${files.length} 个单测文件：${files.join(' ')}\n`);

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
process.stdout.write(r.stdout ?? '');

const out = r.stdout ?? '';
const fails = out.split(/\r?\n/).filter((l) => l.startsWith('not ok'));
const counts = out.match(/^# (pass|fail) \d+$/gm) ?? [];
const tail = counts.length ? counts.join(' · ') : '(没有拿到计数)';

const summary = fails.length
  ? [`## ✗ 单测失败 ${fails.length} 条`, '', ...fails.map((l) => `- \`${l.replace(/^not ok \d+ - /, '')}\``), '', '```', tail, '```'].join('\n')
  : [`## ✓ 单测通过`, '', '```', tail, '```', '', envLine].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n', 'utf8');
}

if (fails.length) {
  console.error(`\n失败 ${fails.length} 条：`);
  for (const l of fails) console.error('  ' + l);
}
process.exit(r.status ?? 1);
