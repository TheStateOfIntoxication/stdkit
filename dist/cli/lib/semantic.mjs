// semantic：语义层回归的「记录 + 比对」骨架。
//
// 它**不调模型**：ADR 0003 决定 CI 不依赖模型与网络，所以这里只做两件事——
//   1. 校验用例本身（fixture 在、expect 的 ID 是真实存在且**没有 deny** 的语义规则）；
//   2. 比对「上一次人工/agent 审查的记录」与期望，产出回归信号。
// 记录由 `ds eval --record` 写入（谁跑的、什么时候跑的都记下来），工具只负责存与比。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, writeJSON, walk } from './util.mjs';
import { buildCatalog } from './catalog.mjs';

const CASE_DIR = (root) => path.join(root, 'evals', 'semantic');

/** 用例目录列表（按名字排序）。 */
export function listSemanticCases(root = ROOT) {
  const dir = CASE_DIR(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** 一个用例的结构校验（check 与 eval --semantic 共用）。 */
export function validateSemanticCase(root, name, cat = buildCatalog(root)) {
  const dir = path.join(CASE_DIR(root), name);
  const errors = [];
  const warnings = [];

  const expect = readJSON(path.join(dir, 'expect.json'), null);
  if (!expect) {
    errors.push('缺少 expect.json（或 JSON 解析失败）');
    return { errors, warnings, expect: null };
  }
  if (!Array.isArray(expect.mustReport) || !expect.mustReport.length) {
    errors.push('expect.mustReport 必须是非空数组（这个用例要求模型报出哪些规则 ID）');
  }
  if (expect.mustNotReport !== undefined && !Array.isArray(expect.mustNotReport)) {
    errors.push('expect.mustNotReport 必须是数组（可为空）');
  }
  if (!expect.why) warnings.push('expect.why 为空：写清「这个片段为什么必须命中这条规则」，否则没法复核');

  const byId = new Map(cat.rules.map((r) => [r.id, r]));
  for (const id of [...(expect.mustReport ?? []), ...(expect.mustNotReport ?? [])]) {
    const r = byId.get(id);
    if (!r) {
      errors.push(`expect 引用了不存在的规则 ${id}`);
      continue;
    }
    if (r.status === 'retired') errors.push(`${id} 已 retired`);
    // 关键：有 deny 的规则属于「可机判」，不该靠人肉回归 —— 那是 ds eval 的活
    if ((r.deny ?? []).length) errors.push(`${id} 有 deny 正则，属可机判规则：请放进 evals/cases，不要放进 semantic`);
  }

  const fixture = path.join(dir, 'fixture');
  if (!fs.existsSync(fixture)) errors.push('缺少 fixture/ 目录（待审代码片段）');
  else if (!walk(fixture, () => true).length) errors.push('fixture/ 是空的');

  return { errors, warnings, expect };
}

/** 记录一次审查结果（谁跑的、什么时候）。工具不判对错，只存下来供下次比。 */
export function recordSemantic(root, name, reported, by = 'unknown') {
  const dir = path.join(CASE_DIR(root), name);
  if (!fs.existsSync(dir)) throw new Error(`没有这个语义用例：${name}（可选：${listSemanticCases(root).join(' / ') || '无'}）`);
  const ids = [...new Set(reported.map((s) => s.trim()).filter(Boolean))].sort();
  const result = {
    $comment: '一次人工/agent 审查的记录。ds eval --semantic 用它做回归：改 prompt 或条文后重跑一遍再 --record。',
    recordedAt: new Date().toISOString().slice(0, 10),
    recordedBy: by,
    reported: ids,
    // 由人写明「本次是怎么审的」，否则这条记录在别人眼里无法复核
    method: 'review by agent/human against rules/*.md; 只记录落在该域的规则 ID',
  };
  writeJSON(path.join(dir, 'result.json'), result);
  return result;
}

/**
 * 跑全部语义用例。
 * @returns {{name:string, pass:boolean, skipped:boolean, problems:string[]}[]}
 */
export function runSemanticEvals(root = ROOT, cat = buildCatalog(root)) {
  const cases = listSemanticCases(root);
  const results = [];

  for (const name of cases) {
    const dir = path.join(CASE_DIR(root), name);
    const { errors, expect } = validateSemanticCase(root, name, cat);
    if (errors.length) {
      results.push({ name, pass: false, skipped: false, problems: errors });
      continue;
    }

    const result = readJSON(path.join(dir, 'result.json'), null);
    if (!result) {
      results.push({
        name,
        pass: true,
        skipped: true,
        problems: [`未记录结果：审完 fixture 后执行 node cli/ds.mjs eval --record ${name} --reported <ID,ID> --by <你>`],
      });
      continue;
    }

    const reported = new Set(result.reported ?? []);
    const problems = [];
    for (const id of expect.mustReport ?? []) if (!reported.has(id)) problems.push(`漏审 ${id}（期望报出）`);
    for (const id of expect.mustNotReport ?? []) if (reported.has(id)) problems.push(`误报 ${id}（期望不报）`);
    results.push({ name, pass: problems.length === 0, skipped: false, problems, recordedAt: result.recordedAt, recordedBy: result.recordedBy });
  }

  return results;
}

/** 给「怎么用」的一句话说明（CLI 打印用）。 */
export const SEMANTIC_NOTE =
  '语义层不调模型（ADR 0003）：这里只比对「上一次人工/agent 审查的记录」。改条文或 prompt 后重跑一遍再 --record。';
