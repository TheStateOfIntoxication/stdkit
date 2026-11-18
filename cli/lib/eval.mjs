// eval：确定性层回归。每个用例 = 一份目录 + expect.json；期望行号手写，不由实现反推。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON } from './util.mjs';
import { buildCatalog } from './catalog.mjs';
import { runScan } from './scan.mjs';
import { loadBaseline } from './brief.mjs';
import { loadPolicy, resolveFailOn } from './policy.mjs';
import { runCrossCheck } from './cross.mjs';

export function runEvals(root = ROOT) {
  const cat = buildCatalog(root);
  const dir = path.join(root, 'evals', 'cases');
  if (!fs.existsSync(dir)) return { results: [], passed: 0, failed: 0, uncovered: [], machine: 0 };

  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const results = [];
  const fired = new Set();
  for (const name of names) {
    const caseDir = path.join(dir, name);
    const expect = readJSON(path.join(caseDir, 'expect.json'), null);
    if (!expect) {
      results.push({ name, pass: false, total: 0, problems: ['缺少 expect.json'] });
      continue;
    }

    const policy = loadPolicy(root, { target: caseDir });
    const scan = runScan({ target: caseDir, catalog: cat, baseline: loadBaseline(caseDir), policy });
    const key = (f) => `${f.ruleId}|${f.file}|${f.line}`;
    const actual = scan.findings.map(key);
    const expected = (expect.findings ?? []).map(key);
    const problems = [];

    for (const x of expected) if (!actual.includes(x)) problems.push(`漏报 ${x}`);
    for (const x of actual) if (!expected.includes(x)) problems.push(`误报/多报 ${x}`);

    // 可选：断言生效级（policy 单条覆盖是否真的生效）
    for (const e of expect.findings ?? []) {
      if (!e.severity) continue;
      const got = scan.findings.find((f) => key(f) === key(e));
      if (got && got.severity !== e.severity) {
        problems.push(`生效级不符 ${key(e)}：期望 ${e.severity}，实际 ${got.severity}`);
      }
    }
    // 可选：断言阻断结论（与 ds scan 同一套阈值语义）
    if (typeof expect.blocked === 'boolean') {
      const blockSet = resolveFailOn(undefined, policy);
      const blocked = scan.findings.some((f) => blockSet.has(f.severity));
      if (blocked !== expect.blocked) problems.push(`阻断结论不符：期望 blocked=${expect.blocked}，实际 ${blocked}`);
    }

    const uniqWaived = [...new Set(scan.waived.map((w) => w.ruleId))].sort();
    const expectWaived = [...new Set(expect.waived ?? [])].sort();
    for (const x of expectWaived) if (!uniqWaived.includes(x)) problems.push(`豁免未生效 ${x}`);
    for (const x of uniqWaived) if (!expectWaived.includes(x)) problems.push(`意外豁免 ${x}`);

    // 可选：仓级断言（ds cross）。expect.cross = [{ruleId, file}] / []
    if (expect.cross) {
      const got = runCrossCheck(caseDir).map((x) => `${x.ruleId}|${x.file}`);
      const want = expect.cross.map((x) => `${x.ruleId}|${x.file}`);
      for (const x of want) if (!got.includes(x)) problems.push(`仓级漏报 ${x}`);
      for (const x of got) if (!want.includes(x)) problems.push(`仓级误报 ${x}`);
    }

    results.push({ name, pass: problems.length === 0, total: expected.length, problems });
    for (const f of scan.findings) fired.add(f.ruleId);
  }

  // 覆盖率断言：「每条可机判规则至少在一个用例里命中过」。
  // 没有这一条，一条写错的规则（glob 拼错、正则永不命中）也能让 eval 全绿（P2-2）。
  const machine = cat.rules.filter((r) => r.deny.length > 0 && r.status !== 'retired').map((r) => r.id);
  const uncovered = machine.filter((id) => !fired.has(id));

  return {
    results,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    uncovered,
    machine: machine.length,
  };
}
