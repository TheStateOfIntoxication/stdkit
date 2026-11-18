// brief：把「机械命中 + 需语义判定的规则」拼成一份审查简报，喂给模型，一次到位。
import path from 'node:path';
import { readJSON } from './util.mjs';
import { runScan } from './scan.mjs';
import { effectiveSeverity } from './policy.mjs';
import { CROSS_RULE_IDS } from './cross.mjs';
import { buildCatalog } from './catalog.mjs';
import { resolveFailOn } from './policy.mjs';

export const BASELINE_REL = '.stdkit/baseline.json';

/** 把当前命中快照成基线豁免（按 ruleId + file 聚合，不按行，避免一次性几百条）。 */
export function snapshotBaseline({ target, catalog, policy, domain, days = 90 }) {
  const path_ = path.join(target, BASELINE_REL);
  const existing = readJSON(path_, null) ?? { waivers: [] };
  const scan = runScan({ target, catalog, domain });
  const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  const have = new Set(existing.waivers.map((w) => `${w.ruleId}|${w.file ?? '*'}`));
  const added = [];
  for (const f of scan.findings) {
    const key = `${f.ruleId}|${f.file}`;
    if (have.has(key)) continue;
    have.add(key);
    added.push({ ruleId: f.ruleId, file: f.file, until, reason: `存量基线（${until} 到期，到期后自动重新计入）` });
  }

  return {
    path: path.join(target, BASELINE_REL),
    total: scan.findings.length,
    added: added.sort((a, b) => {
      const x = `${a.ruleId}|${a.file}`;
      const y = `${b.ruleId}|${b.file}`;
      return x < y ? -1 : x > y ? 1 : 0;
    }),
    merged: { $comment: 'stdkit 基线豁免。过期自动失效；reason 必写。', waivers: [...existing.waivers, ...added] },
  };
}

export function loadBaseline(target) {
  return readJSON(path.join(target, BASELINE_REL), null);
}

/** 生成审查简报（纯函数，不写盘）。 */
export function buildBrief({ target, catalog, policy, domain, diffRef, severity }) {
  const baseline = loadBaseline(target);
  const scan = runScan({ target, catalog, domain, diffRef, baseline, severity, policy });
  const domains = domain ? [domain] : inferDomains(scan.scannedFiles, catalog.domains);
  const semantic = catalog.rules.filter(
    (r) => domains.includes(r.domain) && r.status !== 'retired' && r.deny.length === 0 && !CROSS_RULE_IDS.includes(r.id),
  );
  // 仓级规则：由 ds cross 机判（ADR 0001）。列出来是告诉审查者「跑哪条命令」，
  // 而不是让模型自己找——它没有文件集合的视野。
  const cross = catalog.rules.filter(
    (r) => domains.includes(r.domain) && r.status !== 'retired' && CROSS_RULE_IDS.includes(r.id),
  );
  // 判据在业务仓 L3 的规则：机判读不到，要人先看 AGENTS.md
  const l3Hints = domains.includes('sql')
    ? [`SQL-DIR-01` + ' 的判据是「项目实际 SQL 目录布局」；非标准布局 `ds cross` 会跳过，需人工确认']
    : [];
  // 与 ds scan 用同一套阈值语义（之前用 blockOn.includes 精确匹配，两命令会给出相反结论）
  const blockSet = resolveFailOn(undefined, policy);
  const blockOn = [...blockSet];
  const blocked = scan.findings.some((f) => blockSet.has(f.severity));

  return {
    target,
    mode: diffRef ? `diff ${diffRef}` : 'full',
    domains,
    blockOn,
    blocked,
    mechanical: {
      rules: scan.rules,
      scanned: scan.scanned,
      findings: scan.findings,
      waived: scan.waived,
      expiredWaivers: scan.expiredWaivers,
    },
    semantic: semantic.map((r) => ({ id: r.id, title: r.title, severity: effectiveSeverity(r, policy) })),
    cross: cross.map((r) => ({ id: r.id, title: r.title, severity: effectiveSeverity(r, policy) })),
    l3Hints,
  };
}

export function renderBriefMarkdown(b) {
  const f = b.mechanical.findings;
  const lines = [];
  lines.push(`# 审查简报（${b.mode}）`);
  lines.push('');
  lines.push(`目标：\`${b.target}\`　可机判规则 ${b.mechanical.rules} 条 / 扫描 ${b.mechanical.scanned} 文件`);
  lines.push(`域：${b.domains.join(' · ')}`);
  lines.push('');

  lines.push(`## A 类：机械命中（${f.length} 条）— 直接计入结论，不要重新逐行找`);
  lines.push('');
  if (!f.length) lines.push('无');
  else {
    lines.push('| 级 | 规则 | 位置 | 片段 |');
    lines.push('|---|---|---|---|');
    for (const x of f) {
      lines.push(`| ${x.severity} | \`${x.ruleId}\` | \`${x.file}:${x.line}\` | ${cell(x.text)} |`);
    }
  }
  lines.push('');

  if (b.mechanical.waived.length) {
    lines.push(`已豁免（基线）：${b.mechanical.waived.length} 条`);
    lines.push('');
  }
  if (b.mechanical.expiredWaivers.length) {
    lines.push(`> 过期豁免（已重新计入）：${b.mechanical.expiredWaivers.join('、')}；请清理 ${BASELINE_REL}`);
    lines.push('');
  }

  lines.push(`## B 类：需语义判定（${b.semantic.length} 条）— 只有这张表里的要你判`);
  lines.push('');
  for (const r of b.semantic) lines.push(`- \`${r.id}\` ${r.title}（${r.severity}）`);
  lines.push('');

  // 仓级：这两条不在 B 类里，必须先跑命令（ADR 0001）。
  if (b.cross?.length) {
    lines.push(`## 仓级：跑 \`ds cross\` 得到的才算数`);
    lines.push('');
    for (const r of b.cross) lines.push(`- \`${r.id}\` ${r.title}（${r.severity}）→ \`ds cross\``);
    lines.push('');
    lines.push('> 它判定的是文件集合（回滚是否配齐、多方言是否齐），不在逐行清单里；不跑就不要判这两条。');
    lines.push('');
  }
  if (b.l3Hints?.length) {
    lines.push('## 判据在 L3（机判读不到，先看业务仓 `AGENTS.md`）');
    lines.push('');
    for (const h of b.l3Hints) lines.push(`- ${h}`);
    lines.push('');
  }

  lines.push(`## 阻断判定：${b.blocked ? '**Block**' : '无阻断项'}（阈值 ${b.blockOn.join(' / ')}）`);
  return lines.join('\n');
}

const cell = (s) => s.replace(/\|/g, '\\|').slice(0, 120);

/** 按本次涉及的文件类型推断域，避免 Java 改动去查 SQL/前端规则。 */
export function inferDomains(files, all) {
  const hit = new Set();
  for (const f of files ?? []) {
    if (/(^|\/)src\/test\//.test(f) || /\.(spec|test)\.js$/.test(f)) hit.add('test');
    else if (/\.vue$/.test(f)) hit.add('vue');
    else if (/\.sql$/.test(f) || /^sql\/README\.md$/.test(f)) hit.add('sql');
    else if (
      /\.java$/.test(f) ||
      /mapper\/.*\.xml$/.test(f) ||
      /\.ya?ml$/.test(f) ||
      // .properties / .ini 也属 Java 侧配置；漏了它们时「只改 application.properties 的 PR」
      // 会被推断成四个域全开，语义清单从 30 多条膨胀到 74 条（P2-5）。
      /\.(properties|ini)$/.test(f) ||
      /(^|\/)(pom\.xml|build\.gradle(?:\.kts)?)$/.test(f)
    )
      hit.add('java-jdk8');
  }
  return hit.size ? all.filter((d) => hit.has(d)) : all;
}
