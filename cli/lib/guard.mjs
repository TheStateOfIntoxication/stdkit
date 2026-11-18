// 写前护栏的判定核心：纯函数，不依赖 pi 运行时，便于单测。
//
// 为什么单独抽出来：扩展（extensions/stdkit.ts）是唯一会「阻止人落盘」的部件，
// 但它依赖 typebox 与 pi SDK，.mjs 测试无法直接 import .ts。
// 把判定逻辑搬到 cli/lib/guard.mjs 后：
//   - 单测覆盖「判定」；
//   - 扩展只留 pi 胶水（注册工具 / 事件路由）；
//   - 判定与 ds scan 共用 scan.mjs，不存在第二套实现。
import fs from 'node:fs';
import path from 'node:path';
import { skipByPath } from './scan.mjs';

/** 把 tool 参数里的路径归一成相对 cwd 的 posix 路径。 */
export function relPathOf(cwd, p) {
  const abs = /^([A-Za-z]:|[\\/])/.test(p) ? p : path.join(cwd, p);
  const rel = path.relative(path.resolve(cwd), path.resolve(abs));
  return rel.split(path.sep).join('/');
}

/**
 * 护栏不看的路径。语义必须与 ds scan 完全一致（共用 skipByPath），否则会出现
 * 「scan 说干净、写的时候被拦」或反之。历史偏差：旧版用正则跳过任意 `evals/`，
 * 而 listFiles 只跳过带 `cases/` 的 fixture 目录。
 */
export function isSkippedPath(cwd, rel) {
  const base = path.resolve(cwd);
  return skipByPath(path.resolve(base, rel), base);
}

/**
 * 从 pi 的 tool_call 事件里取出要检查的文本。
 * write → 整份 content；edit → 各段 newText 拼接（行号是块内偏移，不是文件行号）。
 */
export function pickGuardTarget(event) {
  if (!event || event.type !== 'tool_call') return null;
  const input = event.input ?? {};
  if (event.toolName === 'write') {
    if (typeof input.content !== 'string') return null;
    return { rel: String(input.path ?? ''), text: input.content, where: '' };
  }
  if (event.toolName === 'edit') {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    const text = edits.map((e) => (typeof e?.newText === 'string' ? e.newText : '')).join('\n');
    if (!text) return null;
    return { rel: String(input.path ?? ''), text, where: '（edit 片段，行号为块内偏移）' };
  }
  return null;
}

/** 业务仓基线豁免：与 ds scan 同一语义（读 .stdkit/baseline.json）。 */
export function loadBaselineFile(cwd) {
  const p = path.join(cwd, '.stdkit', 'baseline.json');
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw?.waivers) ? raw : null;
  } catch {
    return null;
  }
}

/** 用 scanText 判定，只取 critical（护栏只拦硬规则，medium/low 交给审查）。 */
export function criticalViolations({ scanText, catalog, rel, text, baseline }) {
  if (!catalog || !scanText || !rel || !text) return [];
  const findings = scanText({ relPath: rel, text, catalog, baseline });
  return findings.filter((f) => f.severity === 'critical');
}

/** 命中项 → 给模型看的拦截理由。 */
export function formatBlockReason(rel, violations, where = '') {
  const detail = violations
    .slice(0, 5)
    .map((x) => `- ${x.ruleId} ${x.title}：${x.text}`)
    .join('\n');
  return (
    `stdkit 硬规则拦截（critical）${where}：${rel}\n${detail}\n` +
    '改法见规则正文（skill write-java / write-vue / write-sql 的 references/）。' +
    '存量代码确需保留时，在业务仓 .stdkit/baseline.json 登记豁免（或对历史文件不修改）。'
  );
}
