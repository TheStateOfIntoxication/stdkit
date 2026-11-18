// 写前护栏的判定单测：护栏是唯一会「阻止人落盘」的部件，必须可测。
// 注意：这里只覆盖**判定**；pi 的工具注册与事件路由只能由宿主验证（见 README 已知限制）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT } from './util.mjs';
import { buildCatalog } from './catalog.mjs';
import { scanText } from './scan.mjs';
import { relPathOf, isSkippedPath, pickGuardTarget, criticalViolations, loadBaselineFile, formatBlockReason } from './guard.mjs';

const cat = buildCatalog(ROOT);

test('relPathOf：相对/绝对/Windows 分隔符都归一成 posix 相对路径', () => {
  const cwd = path.resolve('/tmp/repo');
  assert.equal(relPathOf(cwd, 'src/A.java'), 'src/A.java');
  // 反斜杠必须在**任何平台**上都归一（判据不能依赖 path.sep：Linux 上它不把 \ 当分隔符，
  // 于是 src\\main\\A.java 会被当成一个文件名原样返回 —— CI 的 Ubuntu 就是这么红的）
  assert.equal(relPathOf(cwd, 'src\\main\\A.java'), 'src/main/A.java');
  assert.equal(relPathOf(cwd, 'src\\main/A.java'), 'src/main/A.java');
  // 断言函数自己就返回 posix，不在测试里替它做 split(path.sep).join() —— 那会掩盖上面那个 bug
  assert.equal(relPathOf(cwd, path.join(cwd, 'src', 'A.java')), 'src/A.java');
  // 仓外路径不会因为前缀相同被误切
  assert.equal(relPathOf(cwd, path.join(cwd, '..other', 'A.java')).startsWith('..other'), true);
});

test('isSkippedPath：反斜杠路径在任何平台上都按同一套规则跳过', () => {
  // 不真的建目录：node_modules 是「任意层级都跳」，判定不依赖文件是否存在
  const cwd = path.resolve(os.tmpdir(), 'stdkit-skip');
  assert.equal(isSkippedPath(cwd, 'node_modules/a.js'), true);
  assert.equal(isSkippedPath(cwd, 'src\\node_modules\\a.js'), true, '反斜杠版也要跳过');
  assert.equal(isSkippedPath(cwd, 'src/app.js'), false);
});

test('pickGuardTarget：只认 write / edit，edit 拼接各段 newText', () => {
  assert.equal(pickGuardTarget({ type: 'tool_call', toolName: 'read', input: { path: 'a' } }), null);
  assert.equal(pickGuardTarget({ type: 'message', toolName: 'write', input: {} }), null);

  const w = pickGuardTarget({ type: 'tool_call', toolName: 'write', input: { path: 'src/A.java', content: 'x' } });
  assert.deepEqual([w.rel, w.text, w.where], ['src/A.java', 'x', '']);

  const e = pickGuardTarget({
    type: 'tool_call',
    toolName: 'edit',
    input: { path: 'src/A.java', edits: [{ newText: 'a' }, { newText: 'b' }] },
  });
  assert.equal(e.text, 'a\nb');
  assert.match(e.where, /块内偏移/);

  assert.equal(pickGuardTarget({ type: 'tool_call', toolName: 'edit', input: { path: 'x', edits: [] } }), null);
  assert.equal(pickGuardTarget({ type: 'tool_call', toolName: 'write', input: { path: 'x' } }), null);
});

test('isSkippedPath：生成物与依赖跳过，业务包名与业务仓 evals 照看', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-guard-'));
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>');
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/app.js'), 'console.log(1)');
  fs.mkdirSync(path.join(root, 'evals/cases/x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evals/cases/x/A.java'), 'class A {}');
  fs.mkdirSync(path.join(root, 'src/main/java/com/x/log'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/main/java/com/x/log/A.java'), 'class A {}');

  assert.equal(isSkippedPath(root, 'dist/app.js'), true, '项目根的 dist 应跳过');
  assert.equal(isSkippedPath(root, 'evals/cases/x/A.java'), true, '带 cases/ 的 evals 是 fixture');
  // 与 listFiles 对齐：包名 log 不能被跳（旧护栏用正则跳任意 evals/ 与 log/）
  assert.equal(isSkippedPath(root, 'src/main/java/com/x/log/A.java'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('criticalViolations：只拦 critical，medium/high 交给审查', () => {
  const catalog = cat;
  const critical = criticalViolations({ scanText, catalog, rel: 'src/A.java', text: 'class A { void x() {} }' });
  assert.deepEqual(critical, []);

  // J8-SEC-01（Runtime.exec 拼接）是 critical
  const hit = criticalViolations({
    scanText,
    catalog,
    rel: 'src/A.java',
    text: 'class A { void x(String h) { Runtime.getRuntime().exec("ping " + h); } }',
  });
  assert.deepEqual(hit.map((f) => f.severity), ['critical']);

  // J8-API-04（double 金额）是 critical
  const money = criticalViolations({ scanText, catalog, rel: 'src/A.java', text: 'class A { private double amount; }' });
  assert.deepEqual(money.map((f) => f.ruleId), ['J8-API-04']);

  // high 级不进护栏
  const high = criticalViolations({ scanText, catalog, rel: 'src/A.java', text: 'class A { void x() { orderMapper.selectAll(); } }' });
  assert.deepEqual(high, []);
});

test('criticalViolations：baseline 豁免在护栏路径同样生效', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stdkit-guard-bl-'));
  fs.mkdirSync(path.join(root, '.stdkit'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.stdkit', 'baseline.json'),
    JSON.stringify({ waivers: [{ ruleId: 'J8-API-04', file: 'src/legacy/**', reason: '历史', until: '2999-01-01' }] }),
  );
  const baseline = loadBaselineFile(root);

  const text = 'class A { private double amount; }';
  assert.equal(criticalViolations({ scanText, catalog: cat, rel: 'src/legacy/A.java', text, baseline }).length, 0, '基线内应放行');
  assert.equal(
    criticalViolations({ scanText, catalog: cat, rel: 'src/new/A.java', text, baseline }).length,
    1,
    '基线外仍要拦',
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('formatBlockReason：带规则 ID、片段与改法提示', () => {
  const v = [{ ruleId: 'J8-API-04', title: '金额必须 BigDecimal', text: 'private double amount;' }];
  const msg = formatBlockReason('src/A.java', v, '（edit 片段，行号为块内偏移）');
  assert.match(msg, /J8-API-04/);
  assert.match(msg, /src\/A\.java/);
  assert.match(msg, /块内偏移/);
  assert.match(msg, /baseline\.json/);
});

test('扩展源码是薄壳：判定不在 .ts 里，而在 guard.mjs', () => {
  const src = fs.readFileSync(path.join(ROOT, 'extensions', 'stdkit.ts'), 'utf8');
  assert.match(src, /guard\.mjs/, '扩展应动态加载 cli/lib/guard.mjs');
  assert.ok(!/findings\.filter\(\(f\) => f\.severity/.test(src), '判定逻辑不应留在扩展里');
  assert.ok(!/function isSkipped\(/.test(src), '跳过判定不应留在扩展里');
});
