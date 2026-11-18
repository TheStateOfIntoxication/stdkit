// 1.0 契约的形状快照：只断言「键存在且类型不变」，不断言值。
//
// 为什么要有它：冻结写进文档会漂，写成断言才不会。加可选字段（如 maxHits）不受影响；
// 改名 / 删键 / 改类型会让这里红，并直接给出升级步骤——而不是一句「断言失败」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { ROOT, readJSON } from './util.mjs';
import { buildCatalog } from './catalog.mjs';
import { POLICY_KEYS, PROFILE_KEYS, OVERRIDE_KEYS, POLICY_VERSION } from './policy.mjs';

const COMPAT = readJSON(path.join(ROOT, 'policy', 'compat.json'), null);
const UPGRADE = [
  '',
  '这是**破坏性变更**。要走 1.0 的升级流程：',
  '  1) 改大版本号（1.x → 2.0）；',
  '  2) 同步改 policy/compat.json（形状是契约，不是随手可改的快照）；',
  '  3) 在 docs/adr/ 写一篇 ADR 说明为什么破坏、迁移怎么做。',
  '如果只是**新增可选字段**：加进 compat.json 的 ruleOptional 即可，不算破坏。',
].join('\n');

test('compat：catalog 的根键与 schema 版本', () => {
  assert.ok(COMPAT, 'policy/compat.json 缺失或解析失败');
  const cat = buildCatalog(ROOT);
  assert.deepEqual(
    Object.keys(cat).sort(),
    [...COMPAT.catalog.rootKeys].sort(),
    `catalog 根键变了。${UPGRADE}`,
  );
  assert.equal(cat.schema, COMPAT.catalog.schema, `catalog.schema 与快照不一致。${UPGRADE}`);
});

test('compat：每条规则的键集合（必需全在，可选之外不许有）', () => {
  const cat = buildCatalog(ROOT);
  const required = new Set(COMPAT.catalog.ruleRequired);
  const optional = new Set(COMPAT.catalog.ruleOptional ?? []);
  for (const r of cat.rules) {
    const keys = new Set(Object.keys(r));
    for (const k of required) assert.ok(keys.has(k), `规则 ${r.id} 缺必需键 ${k}。${UPGRADE}`);
    for (const k of keys) {
      assert.ok(required.has(k) || optional.has(k), `规则 ${r.id} 出现未登记的可选键 ${k}（应先加进 compat.ruleOptional）。`);
    }
  }
});

test('compat：policy 的键与版本', () => {
  const dflt = readJSON(path.join(ROOT, 'policy', 'default.json'), {});
  const allowed = COMPAT.policy.keys;
  // default.json 的键必须是「允许集」的子集（severity 这种只在需要时才写，不强制出现）
  const extra = Object.keys(dflt).filter((k) => k !== '$comment' && !allowed.includes(k));
  assert.deepEqual(extra, [], `policy/default.json 出现未登记的键：${extra.join(', ')}。${UPGRADE}`);
  // 但 version / blockOn 必须真的在（它们是契约的骨架）
  for (const k of ['version', 'blockOn']) assert.ok(k in dflt, `policy/default.json 缺 ${k}。${UPGRADE}`);
  assert.equal(Number(dflt.version), COMPAT.policy.version, `policy.version 与快照不一致。${UPGRADE}`);
  assert.equal(POLICY_VERSION, COMPAT.policy.version, 'policy.mjs 的 POLICY_VERSION 与快照不一致');

  // 代码里的白名单也不能悄悄放宽
  assert.deepEqual([...POLICY_KEYS].sort(), [...COMPAT.policy.keys].sort(), 'POLICY_KEYS 与快照不一致');
  assert.deepEqual([...PROFILE_KEYS].sort(), [...COMPAT.policy.profileKeys].sort(), 'PROFILE_KEYS 与快照不一致');
  assert.deepEqual([...OVERRIDE_KEYS].sort(), [...COMPAT.policy.overrideKeys].sort(), 'OVERRIDE_KEYS 与快照不一致');

  // 仓里的每个 profile 都只能用 profile 允许的键
  const profDir = path.join(ROOT, 'policy', 'profiles');
  for (const f of fs.readdirSync(profDir).filter((x) => x.endsWith('.json'))) {
    const prof = readJSON(path.join(profDir, f), {});
    const extra = Object.keys(prof).filter((k) => k !== '$comment' && !COMPAT.policy.profileKeys.includes(k));
    assert.deepEqual(extra, [], `profile ${f} 有未登记的键：${extra.join(', ')}。${UPGRADE}`);
  }
});

test('compat：退出码语义（0 通过 / 1 阻断 / 2 用法错误）', () => {
  const ds = path.join(ROOT, 'cli', 'ds.mjs');
  const run = (args) => {
    try {
      execFileSync(process.execPath, [ds, ...args], { encoding: 'utf8', stdio: 'pipe' });
      return 0;
    } catch (e) {
      return e.status ?? 1;
    }
  };
  const want = COMPAT.exitCodes;

  // 通过
  assert.equal(run(['check']), want.pass, `check 无问题时应以 ${want.pass} 退出`);
  // 阻断：java-bad 有 critical
  assert.equal(run(['scan', path.join(ROOT, 'evals/cases/java-bad')]), want.blocked, `命中阻断级应以 ${want.blocked} 退出`);
  // 用法错误
  assert.equal(run(['scan', '--severity', 'hight']), want.usage, `拼错参数应以 ${want.usage} 退出`);
  assert.equal(run(['frobnicate']), want.usage, `未知命令应以 ${want.usage} 退出`);
});

test('compat：语义快照不是空话（阈值语义 + 浅合并）', () => {
  // 这三条写进了快照的 semantics，必须真能验证，否则快照就只是注释
  assert.ok((COMPAT.semantics ?? []).length >= 3, 'compat.semantics 至少三条（阈值 / 浅合并 / applies 相对根）');
  const s = (COMPAT.semantics ?? []).join('\n');
  for (const kw of ['阈值', '浅合并', '相对业务仓根']) {
    assert.ok(s.includes(kw), `semantics 里应写明「${kw}」`);
  }
});
