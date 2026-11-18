/**
 * stdkit pi 扩展
 *
 * 1. 工具 `ds_check`：把确定性检查层交给模型自己调，写完代码立刻自查。
 * 2. 写前护栏：`write` / `edit` 落盘前用 critical 级 deny 正则拦截（`STDKIT_GUARD=off` 关闭）。
 *
 * 这里只放 pi 胶水（注册工具 / 事件路由 / 路径探测）。**判定逻辑在 `cli/lib/guard.mjs`**，
 * 与 `ds scan` 共用 `scan.mjs` 的 `scanText`（注释剥离、noString、exclude、baseline 语义一致），
 * 且能被 `npm test` 直接覆盖。
 *
 * 依赖：`<stdkit>/cli/` 与 `<stdkit>/catalog/rules.json`。
 * dist 安装后 `<pkg>/cli` 与 `<pkg>/catalog` 自带，无需设 STDKIT_HOME。
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Type } from 'typebox';

const here = dirname(fileURLToPath(import.meta.url));

function firstExisting(cands) {
  return cands.filter((x) => x && existsSync(x))[0] ?? null;
}

const CLI = firstExisting([
  process.env.STDKIT_HOME ? join(process.env.STDKIT_HOME, 'cli/ds.mjs') : null,
  join(here, '..', 'cli', 'ds.mjs'),
  join(here, '..', '..', 'cli', 'ds.mjs'),
]);

/** 判定核心；故意动态加载：cli/ 缺失时只关护栏，不让整个扩展加载失败。 */
const GUARD = firstExisting([
  process.env.STDKIT_HOME ? join(process.env.STDKIT_HOME, 'cli/lib/guard.mjs') : null,
  join(here, '..', 'cli', 'lib', 'guard.mjs'),
  join(here, '..', '..', 'cli', 'lib', 'guard.mjs'),
]);

const SCAN = firstExisting([
  process.env.STDKIT_HOME ? join(process.env.STDKIT_HOME, 'cli/lib/scan.mjs') : null,
  join(here, '..', 'cli', 'lib', 'scan.mjs'),
  join(here, '..', '..', 'cli', 'lib', 'scan.mjs'),
]);

let guardMod; // undefined = 未加载；null = 加载失败
async function getGuard() {
  if (guardMod !== undefined) return guardMod;
  if (!GUARD || !SCAN) {
    guardMod = null;
    console.warn('[stdkit] 未找到 cli/lib/guard.mjs，写前护栏关闭（ds_check 走 CLI 子进程仍可用）。');
    return null;
  }
  try {
    const [g, s] = await Promise.all([
      import(pathToFileURL(GUARD).href),
      import(pathToFileURL(SCAN).href),
    ]);
    guardMod = { ...g, scanText: s.scanText };
  } catch (e) {
    guardMod = null;
    console.warn(`[stdkit] 加载护栏失败，写前护栏关闭：${e.message}`);
  }
  return guardMod;
}

const CATALOG = firstExisting([
  process.env.STDKIT_HOME ? join(process.env.STDKIT_HOME, 'catalog/rules.json') : null,
  join(here, '..', 'catalog', 'rules.json'),
  join(here, '..', '..', 'catalog', 'rules.json'),
]);

function loadCatalog() {
  if (!CATALOG) return null;
  try {
    return JSON.parse(readFileSync(CATALOG, 'utf8'));
  } catch {
    return null;
  }
}

export default function stdkit(pi) {
  const catalog = loadCatalog();

  if (!CLI) {
    console.warn('[stdkit] 未找到 cli/ds.mjs，ds_check 不可用。请设置 STDKIT_HOME，或用 pi install 安装 dist。');
  }
  if (!catalog) {
    console.warn('[stdkit] 未找到 catalog/rules.json，写前护栏关闭。');
  }

  pi.registerTool({
    name: 'ds_check',
    label: 'stdkit 确定性检查',
    description:
      '对工作区或本次 diff 跑 stdkit 的 deny 正则规则（金额 double、空 catch、JDK9+ API、${}、明文密钥等），' +
      '返回精确到行号的命中。写完 Java/Vue/SQL 后自查用，只读不改文件。',
    promptSnippet: 'Run stdkit deterministic rule checks and return rule-id + file:line findings',
    promptGuidelines: [
      'Use ds_check (with diff=true) after editing Java, Vue or SQL files, before reporting the task done.',
      'ds_check only covers mechanically checkable rules; it does not replace a manual review.',
    ],
    parameters: Type.Object({
      diff: Type.Optional(Type.Boolean()),
      path: Type.Optional(Type.String()),
      domain: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!CLI) throw new Error('找不到 stdkit CLI：请设置 STDKIT_HOME 指向 stdkit 仓库根或 dist 目录');

      const args = [CLI, 'scan', '--json'];
      if (params.diff) args.push('--diff');
      if (params.domain) args.push('--domain', String(params.domain));
      if (params.path) args.push(String(params.path).replace(/^@/, ''));

      const raw = await runCli(args, ctx.cwd, signal);
      const parsed = parseJson(raw);
      if (!parsed) return { content: [{ type: 'text', text: raw.slice(0, 4000) || 'ds_check 无输出' }], details: {} };

      const f = parsed.findings ?? [];
      const lines = f.slice(0, 60).map((x) => `${x.file}:${x.line}  [${x.severity}] ${x.ruleId}  ${x.text}`);
      const summary = f.length
        ? `命中 ${f.length} 条（${countBy(f)}）；可机判规则 ${parsed.rules} 条 / 扫描 ${parsed.scanned} 文件`
        : `无命中；可机判规则 ${parsed.rules} 条 / 扫描 ${parsed.scanned} 文件`;
      const waived = parsed.waived?.length ? `\n已豁免 ${parsed.waived.length} 条（基线）` : '';
      const tail = f.length > 60 ? `\n… 其余 ${f.length - 60} 条省略` : '';
      return {
        content: [{ type: 'text', text: `${summary}${waived}\n\n${lines.join('\n')}${tail}` }],
        details: { findings: f },
        isError: false,
      };
    },
  });

  if (process.env.STDKIT_GUARD === 'off' || !catalog) return;

  pi.on('tool_call', async (event, ctx) => {
    const guard = await getGuard();
    if (!guard) return;

    const target = guard.pickGuardTarget(event);
    if (!target || !target.rel || !target.text) return;
    const rel = guard.relPathOf(ctx.cwd, target.rel);
    if (!rel || guard.isSkippedPath(ctx.cwd, rel)) return;

    const violations = guard.criticalViolations({
      scanText: guard.scanText,
      catalog,
      rel,
      text: target.text,
      baseline: guard.loadBaselineFile(ctx.cwd),
    });
    if (!violations.length) return;

    return { block: true, reason: guard.formatBlockReason(rel, violations, target.where) };
  });
}

function runCli(args, cwd, signal) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      args,
      { cwd, signal, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => resolve(stdout || (err && err.message) || ''),
    );
  });
}

function parseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function countBy(findings) {
  const m = {};
  for (const f of findings) m[f.severity] = (m[f.severity] ?? 0) + 1;
  return Object.entries(m)
    .map(([k, v]) => `${k} ${v}`)
    .join(' / ');
}
