#!/usr/bin/env node
// ds —— stdkit 命令行入口。规则自检、索引生成、规则检索、确定性检查、业务仓接入。
import fs from 'node:fs';
import path from 'node:path';
import { runCheck, printCheck } from './lib/check.mjs';
import { writeCatalog, buildCatalog } from './lib/catalog.mjs';
import { runScan } from './lib/scan.mjs';
import { buildBrief, renderBriefMarkdown, loadBaseline, snapshotBaseline, BASELINE_REL } from './lib/brief.mjs';
import { writeDist } from './lib/build.mjs';
import { runEvals } from './lib/eval.mjs';
import { initRepo, doctor } from './lib/init.mjs';
import { runPublishCheck, runHistoryCheck, loadPublishPolicy } from './lib/publish.mjs';
import { planInstall, applyInstall, uninstall, installPi } from './lib/install.mjs';
import { runCrossCheck } from './lib/cross.mjs';
import { loadPolicy, resolveFailOn, SEVERITY_ORDER, effectiveSeverity } from './lib/policy.mjs';
import { SEVERITIES, LEVELS } from './lib/parse.mjs';
import { ROOT, c, writeJSON } from './lib/util.mjs';

const HELP = `stdkit · ds

  ds check [路径]              自检规则仓（CI 用，error 即非 0；dist 安装会明确跳过）
  ds eval                      确定性层回归：跑 evals/cases 并比对期望行号
  ds build                     rules/ → dist/（skills · prompts · extensions · adapters）
  ds brief [路径] [筛选]        生成审查简报（A 类命中 + B 类规则），喂给模型
  ds scan [路径] [筛选]         确定性检查：对业务仓跑 deny 正则
  ds cross [路径] [--json]     仓级检查：回滚是否配齐、多方言是否齐（ADR 0001）
  ds baseline [路径] [--days N]  把当前命中快照为基线豁免（存量仓落地用）
  ds init [路径] [--scaffold]  探测栈 → 生成业务仓 AGENTS.md + 基线文件（--scaffold 顺带建默认包结构）
  ds doctor [路径] [--json]    业务仓与 stdkit 自检（分组显示；FAIL 即非 0）
  ds catalog                   重建 catalog/rules.json
  ds rules [筛选] [--json]      检索规则
  ds publish-check [路径...]   发布前脱敏检查（多个仓一起查；--history 连 git 历史一起查）
  ds install --claude|--codex|--cursor|--copilot|--pi|--all  把 dist/ 装到各客户端
  ds --version                 版本 + 规则数
  ds help                      本帮助

init：
  --scaffold        按 J8-SPR-19 的默认树建 src/main/java/<根包>/{controller,service,...}
                    只建空目录，不放文件；与 --dry-run 同用可只看将创建哪些目录
  --force           覆盖已存在的 AGENTS.md

install：
  --pi / --claude / --codex / --cursor / --copilot / --all
                    装到对应客户端（cursor / copilot 装到 --project，默认当前目录）
  --project <dir>   业务仓根（cursor / copilot 用）

publish-check：
  --history         连 git 历史一起扫（只看新增行；force-push 不删旧对象，工作树干净不代表历史干净）

cross：
  只做标准布局（sql/upgrade/<dialect>/ 与 rollback/）；非标准布局直接跳过，不误报
  --json            机器可读
  --domain sql      目前只有 sql 域有仓级检查
  --dry-run         只打印将写入的路径
  --uninstall       按 manifest 反向删除（只删本命令装过的文件）

scan / brief：
  --diff [ref]      只查本次变更（默认 ref=HEAD，含未跟踪文件与新增目录）
  --json            机器可读输出
  --fail-on <s>     达到该级（含更高）即退出 1；支持 'high' 或 'critical,high'
                    默认取 policy 的 blockOn
  --limit <n>       终端最多显示 n 条（默认 200；--json 不受限）
  --profile <name>  策略 profile：${'policy/profiles/<name>.json'}
  --severity <s>    只看该级的命中（critical | high | medium | low）
  --no-mask         命中片段不掩码（默认掩码：命中行往往就是密钥本身）

brief 额外：
  --fail            有阻断项时退出 1（默认始终 0，避免模型误判为命令失败）

策略覆盖：业务仓 .stdkit/policy.json 覆盖 policy/default.json 的同名键。
豁免：业务仓 .stdkit/baseline.json
  {"waivers":[{"ruleId":"J8-API-04","file":"src/legacy/**","until":"2026-12-31","reason":"X"}]}
  到期日按本地日末计算；过期自动失效并重新计入。

筛选（rules）：
  --tag <t>          按标签（可重复）
  --domain <d>       java-jdk8 | vue | sql | test
  --level <l>        must | should
  --severity <s>     critical | high | medium | low
`;

const BOOL_FLAGS = new Set([
  '--json', '--dry-run', '--force', '--fail', '--scaffold',
  '--pi', '--claude', '--codex', '--cursor', '--copilot', '--all', '--uninstall', '--no-mask', '--version', '--history',
]);
const VALUE_FLAGS = new Set(['--tag', '--domain', '--level', '--severity', '--fail-on', '--limit', '--days', '--profile', '--path', '--project']);

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'check';

async function main() {
  switch (cmd) {
    case '--version':
    case '-v':
    case 'version': {
      // 版本只从 package.json 读（单一源）；规则数以 catalog 为准
      const pkg = readVersionInfo();
      console.log(`stdkit ${pkg.version}（${pkg.rules} 条规则 / ${pkg.machine} 可机判）`);
      return;
    }
    case 'check': {
      // 允许指定目录：用来区分「规则仓自检」与「走错目录」
      const f = flags(argv.slice(1));
      return process.exit(printCheck(runCheck(path.resolve(f.positional[0] ?? ROOT))));
    }
    case 'eval':
      return runEval();
    case 'build': {
      const n = writeDist(ROOT);
      console.log(c.green('dist/ 已重建') + c.dim(`  ${n} 个文件`));
      return;
    }
    case 'catalog': {
      const cat = writeCatalog(ROOT);
      console.log(c.green('catalog/rules.json 已更新') + c.dim(`  ${cat.rules.length} 条 / v${cat.version}`));
      return;
    }
    case 'scan':
      return scan(argv.slice(1));
    case 'brief':
      return brief(argv.slice(1));
    case 'baseline':
      return baseline(argv.slice(1));
    case 'init':
      return doInit(argv.slice(1));
    case 'doctor':
      return doDoctor(argv.slice(1));
    case 'cross':
    return runCross(argv.slice(1));
  case 'install':
    return doInstall(argv.slice(1));
  case 'publish-check':
    return publishCheck(argv.slice(1));
  case 'rules':
      return listRules(argv.slice(1));
    case 'help':
    case '-h':
    case '--help':
      return console.log(HELP);
    default:
      console.error(c.red(`未知命令 ${cmd}`) + '\n');
      console.log(HELP);
      process.exit(2);
  }
}


/** 版本信息：package.json 是唯一源，规则数来自 catalog。 */
function readVersionInfo() {
  const pkg = JSON.parse(readTextSafe(path.join(ROOT, 'package.json'), '{}'));
  const cat = JSON.parse(readTextSafe(path.join(ROOT, 'catalog', 'rules.json'), '{"rules":[]}'));
  const rules = (cat.rules ?? []).filter((r) => r.status !== 'retired');
  return {
    version: pkg.version ?? '0.0.0',
    rules: rules.length,
    machine: rules.filter((r) => (r.deny ?? []).length).length,
  };
}

function readTextSafe(p, fallback) {
  try {
    return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return fallback;
  }
}

function assertSeverity(severity) {
  if (!severity) return;
  if (!SEVERITIES.includes(severity)) throw new Error(`--severity "${severity}" 不存在（可用：${SEVERITIES.join(', ')}）`);
}

function assertLevel(level) {
  if (!level) return;
  if (!LEVELS.includes(level)) throw new Error(`--level "${level}" 不存在（可用：${LEVELS.join(', ')}）`);
}

function assertDomain(domain) {
  if (!domain) return;
  const known = buildCatalog(ROOT).domains;
  if (!known.includes(domain)) throw new Error(`--domain "${domain}" 不存在（可用：${known.join(', ')}）`);
}

function flags(args) {
  const out = { tags: [], positional: [], json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    // 选项名本身保持原样；值在下面统一小写处理
    if (BOOL_FLAGS.has(a)) {
      out[a.slice(2)] = true;
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(0, eq) : a;
    if (VALUE_FLAGS.has(name)) {
      const value = eq > 0 ? a.slice(eq + 1) : args[++i];
      if (value === undefined || value === '' || (value.startsWith('--') && eq < 0)) {
        throw new Error(`参数 ${name} 缺少取值`);
      }
      if (name === '--tag') out.tags.push(value);
      // 枚举型取值宽容大小写：--severity HIGH / --level MUST 照常用，拼错（HIGHT）仍然报错
      else if (name === '--severity' || name === '--level' || name === '--domain') out[name.slice(2)] = value.toLowerCase();
      else out[name.slice(2)] = value;
      continue;
    }
    if (a === '--diff') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) out.diff = args[++i];
      else out.diff = 'HEAD';
      continue;
    }
    if (a.startsWith('-')) throw new Error(`未知参数 ${a}`);
    out.positional.push(a);
  }
  return out;
}

const LETTER = { critical: 'C', high: 'H', medium: 'M', low: 'L' };
const SEV_COLOR = { critical: (s) => c.red(s), high: (s) => c.yellow(s), medium: (s) => c.dim(s), low: (s) => c.dim(s) };

function scan(args) {
  const f = flags(args);
  const target = path.resolve(f.positional[0] ?? process.cwd());
  const policy = loadPolicy(ROOT, { profile: f.profile, target });
  assertDomain(f.domain);
  assertSeverity(f.severity);
  // 参数先校验再干活，避免打了一半结果才报错
  const limit = f.limit === undefined ? 200 : Number(f.limit);
  if (!Number.isFinite(limit) || limit < 0) throw new Error(`--limit 需要非负整数，收到 "${f.limit}"`);
  const blockOn = resolveFailOn(f['fail-on'], policy);
  const { findings, scanned, rules, totalRules, waived, expiredWaivers } = runScan({
    target,
    catalog: buildCatalog(ROOT),
    domain: f.domain,
    severity: f.severity,
    diffRef: f.diff,
    baseline: loadBaseline(target),
    policy,
    // 命中片段默认掩码：命中行往往就是密钥本身，原样输出会二次泄漏到 CI 日志 / 模型上下文
    mask: !f['no-mask'],
  });

  if (f.json) {
    console.log(
      JSON.stringify({ target, mode: f.diff ?? 'full', rules, totalRules, scanned, findings, waived, expiredWaivers }, null, 2),
    );
  } else {
    const mode = f.diff ? `diff ${f.diff}` : '全量';
    const scope = f.severity ? `${rules} 条（仅 ${f.severity}，全部 ${totalRules} 条）` : `${rules} 条`;
    console.log(c.bold('stdkit scan') + c.dim(`  ${target}  (${mode})  ${scope}可判规则 / ${scanned} 文件`));
    let lastFile = null;
    for (const x of findings.slice(0, limit)) {
      if (x.file !== lastFile) {
        console.log(c.bold(`\n${x.file}`));
        lastFile = x.file;
      }
      const tag = (SEV_COLOR[x.severity] ?? ((s) => s))(`[${LETTER[x.severity]}]`);
      console.log(`  ${x.line}  ${tag} ${c.bold(x.ruleId)}  ${x.text}`);
    }
    const counts = ORDER.map((s) => [s, findings.filter((x) => x.severity === s).length]).filter(([, n]) => n);
    if (findings.length > limit) console.log(c.dim(`… 其余 ${findings.length - limit} 条省略（--limit 调大，或 --json 取全量）`));
    console.log(
      findings.length
        ? '\n' + counts.map(([s, n]) => SEV_COLOR[s](`${s} ${n}`)).join(c.dim(' · ')) + c.dim(`   共 ${findings.length}`)
        : c.green('无命中'),
    );
    if (waived.length) console.log(c.dim(`已豁免 ${waived.length} 条（基线）`));
    if (expiredWaivers.length) console.log(c.yellow(`过期豁免 ${expiredWaivers.length} 条，已重新计入：${expiredWaivers.join('、')}`));
  }

  const blockOnSet = blockOn;
  if (findings.some((x) => blockOnSet.has(x.severity))) process.exit(1);
}

const ORDER = SEVERITY_ORDER.slice().reverse();

function brief(args) {
  const f = flags(args);
  assertDomain(f.domain);
  assertSeverity(f.severity);
  const target = path.resolve(f.positional[0] ?? process.cwd());
  const b = buildBrief({
    target,
    catalog: buildCatalog(ROOT),
    policy: loadPolicy(ROOT, { profile: f.profile, target }),
    domain: f.domain,
    diffRef: f.diff,
    severity: f.severity,
  });
  if (f.json) console.log(JSON.stringify(b, null, 2));
  else console.log(renderBriefMarkdown(b));
  // 默认不因「有阻断项」退出非 0：审查 prompt 把 brief 当信息收集步骤，
  // 非 0 会让模型误判成命令失败。需要门禁语义时显式加 --fail。
  if (f.fail && b.blocked) process.exit(1);
}

function baseline(args) {
  const f = flags(args);
  const target = path.resolve(f.positional[0] ?? process.cwd());
  const days = Number(f.days ?? 90);
  assertDomain(f.domain);
  if (!Number.isFinite(days) || days <= 0) throw new Error(`--days 需要正整数，收到 "${f.days}"`);
  const r = snapshotBaseline({ target, catalog: buildCatalog(ROOT), domain: f.domain, days });
  console.log(c.bold('stdkit baseline') + c.dim(`  ${target}  当前命中 ${r.total} 条`));
  if (!r.added.length) return console.log(c.green('基线已覆盖全部命中，无需新增'));
  const byRule = {};
  for (const w of r.added) byRule[w.ruleId] = (byRule[w.ruleId] ?? 0) + 1;
  console.log(`新增豁免 ${r.added.length} 条（按 规则+文件 聚合）：`);
  for (const [k, v] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log(c.dim(`到期日 ${r.added[0].until}（--days 可调）`));
  if (f['dry-run']) return console.log(c.dim('(--dry-run 未写盘)'));
  writeJSON(r.path, r.merged);
  console.log(c.green(`已写入 ${BASELINE_REL}`));
}

function doInit(args) {
  const f = flags(args);
  const dir = f.positional[0] ?? process.cwd();
  const r = initRepo(dir, { force: !!f.force, dryRun: !!f['dry-run'], scaffold: !!f.scaffold });
  console.log(c.bold('stdkit init') + c.dim(`  ${r.target}`));
  for (const [k, v] of Object.entries(r.detected)) console.log(`  ${c.green('探测')} ${k}: ${v}`);
  for (const w of r.wrote) console.log(`  ${c.green('写入')} ${w}`);
  for (const s of r.skipped ?? []) console.log(`  ${c.yellow('跳过')} ${s}`);
  for (const n of r.notes ?? []) console.log(`  ${c.yellow('提示')} ${n}`);
  if (r.todo.length) console.log(`\n${c.yellow('待人工填')}（${r.todo.length}）：${r.todo.join('、')}`);
  if (r.scaffold && !f['dry-run'] && !r.wrote.some((w) => w.endsWith('/'))) {
    console.log(c.dim('  包结构已齐（--scaffold 无新增目录）'));
  }
  if (f['dry-run'] && r.scaffold) {
    console.log(c.dim('\n将创建目录（--scaffold）：'));
    for (const dirAbs of r.scaffold) console.log(c.dim(`  ${dirAbs}`));
  }
  if (f['dry-run']) console.log(c.dim('\n(--dry-run 未写盘)'));
  else console.log(c.dim('\n下一步：跑 ds doctor 自检；按 dist/README.md 把 skills / prompts 装进各客户端'));
}



function runCross(args) {
  const f = flags(args);
  const target = path.resolve(f.positional[0] ?? process.cwd());
  assertDomain(f.domain);
  const findings = runCrossCheck(target).filter((x) => !f.domain || x.ruleId.startsWith('SQL-'));
  if (f.json) {
    console.log(JSON.stringify({ target, findings }, null, 2));
    return process.exit(findings.length ? 1 : 0);
  }
  console.log(c.bold('stdkit cross') + c.dim(`  ${target}  ${findings.length} 条`));
  if (!findings.length) {
    console.log(c.green('无命中（标准布局下：回滚齐全、方言齐）'));
    return process.exit(0);
  }
  for (const x of findings) {
    const tag = SEV_COLOR[x.severity] ?? ((v) => v);
    console.log(`  ${c.bold(x.ruleId)}  ${tag('[' + (LETTER[x.severity] ?? '?') + ']')}  ${x.file}`);
    console.log(c.dim(`      ${x.msg}`));
  }
  const blocking = findings.some((x) => x.severity === 'critical' || x.severity === 'high');
  console.log(blocking ? c.red('\n命中阻断级（critical / high）') : c.dim('\n未命中阻断级'));
  return process.exit(blocking ? 1 : 0);
}

function doInstall(args) {
  const f = flags(args);
  const picked = ['pi', 'claude', 'codex', 'cursor', 'copilot'].filter((t) => f[t]);
  const dryRun = !!f['dry-run'];

  if (f.uninstall) {
    const r = uninstall({ dryRun });
    if (!r.removed.length) {
      console.log(c.bold('stdkit install --uninstall') + c.dim('  没有安装记录（或文件已被删）'));
      return process.exit(0);
    }
    for (const p of r.removed) console.log(`  ${c.yellow(dryRun ? '将删除' : '已删除')} ${p}`);
    console.log(c.dim(`\n${r.removed.length} 个文件${dryRun ? '（--dry-run 未动文件）' : ''}`));
    return process.exit(0);
  }

  if (!picked.length && !f.all) {
    console.error(c.red('请指定目标：--pi / --claude / --codex / --cursor / --copilot / --all'));
    return process.exit(1);
  }

  const list = f.all ? ['pi', 'claude', 'codex', 'cursor', 'copilot'] : picked;
  const project = f.project ? path.resolve(f.project) : process.cwd();

  if (list.includes('pi')) {
    const r = installPi(path.join(ROOT, 'dist'), { dryRun });
    console.log(c.bold('pi') + c.dim(`  ${r.cmd}`));
    if (r.ran) console.log(c.green('  已安装'));
    else if (dryRun) console.log(c.dim('  (--dry-run 未执行)'));
    else console.log(c.yellow(`  未执行（${r.error?.split('\n')[0] || '找不到 pi'}）：请手动跑上面这条`));
  }

  const others = list.filter((t) => t !== 'pi');
  if (!others.length) return process.exit(0);

  const plan = planInstall({ distDir: path.join(ROOT, 'dist'), project, targets: others });
  const r = applyInstall(plan, { dryRun });
  const byTarget = {};
  for (const item of plan) (byTarget[item.target] ??= []).push(item.to);
  for (const [t, files] of Object.entries(byTarget)) {
    console.log(c.bold(t) + c.dim(`  ${files.length} 个文件`));
    for (const p of files) console.log(`  ${c.dim(dryRun ? '将写入' : '写入')} ${p}`);
  }
  console.log(c.dim(`\n${r.written.length} 个文件${dryRun ? '（--dry-run 未落盘）' : `，卸载：ds install --uninstall`}`));
  return process.exit(0);
}

function doDoctor(args) {
  const f = flags(args);
  const dir = f.positional[0] ?? process.cwd();
  const r = doctor(dir);
  if (f.json) {
    console.log(JSON.stringify({ target: dir, checks: r.checks, failed: r.failed, warned: r.warned }, null, 2));
    return process.exit(r.failed ? 1 : 0);
  }
  console.log(c.bold('stdkit doctor'));
  const tag = { PASS: c.green('PASS'), WARN: c.yellow('WARN'), FAIL: c.red('FAIL'), SKIP: c.dim('SKIP') };
  // 两类结论别混排：「你的仓」与「stdkit 自己」混在一起时，读者分不清该去哪修
  const groups = [
    ['repo', '业务仓'],
    ['self', 'stdkit 自身'],
  ];
  const present = groups.filter(([k]) => r.checks.some((x) => (x.group ?? 'repo') === k));
  for (const [key, title] of present) {
    if (present.length > 1) console.log(c.dim(`  -- ${title} --`));
    for (const x of r.checks.filter((k) => (k.group ?? 'repo') === key)) {
      console.log(`  ${tag[x.level]} ${String(x.name).padEnd(16)} ${c.dim(x.msg)}`);
    }
  }
  const tail = `${r.failed} fail, ${r.warned} warn`;
  console.log(r.failed ? c.red(tail) : r.warned ? c.yellow(tail) : c.green(tail));
  return process.exit(r.failed ? 1 : 0);
}

function runEval() {
  const r = runEvals(ROOT);
  console.log(c.bold('stdkit eval') + c.dim(`  ${r.results.length} 个用例`));
  for (const x of r.results) {
    if (x.pass) console.log(`${c.green('✓')} ${x.name} ${c.dim(`(${x.total} 期望命中)`)}`);
    else {
      console.log(`${c.red('✗')} ${x.name}`);
      for (const p of x.problems) console.log(`    ${p}`);
    }
  }
  const tail = `${r.passed} passed, ${r.failed} failed`;
  console.log(r.failed ? c.red(tail) : c.green(tail));
  if (r.uncovered?.length) {
    console.log(c.yellow(`未被任何用例覆盖的规则 ${r.uncovered.length}/${r.machine}：${r.uncovered.join('、')}`));
    console.log(c.dim('  给它们各补一个 fixture（命中一次即可）——这是「规则写错了也能全绿」的唯一防线。'));
  } else if (r.machine) {
    console.log(c.dim(`覆盖率：行级 ${r.machine}/${r.machine} 条可机判规则均有命中断言；另有仓级 2 条由 ds cross 覆盖（ADR 0001）`));
  }
  return process.exit(r.failed || r.uncovered?.length ? 1 : 0);
}


function publishCheck(args) {
  const f = flags(args);
  const roots = f.positional.length ? f.positional : [ROOT];
  const policy = loadPublishPolicy(ROOT);
  if (policy.missing) {
    console.log(c.yellow('未找到 policy/publish.json，跳过脱敏检查'));
    return process.exit(0);
  }
  const hits = runPublishCheck(roots, policy);
  const hist = f.history ? roots.flatMap((r) => runHistoryCheck(r, policy)) : [];
  const head = c.bold('stdkit publish-check') + c.dim(`  ${roots.join(' · ')}  ${policy.forbidden.length} 条规则`) + (f.history ? c.dim('  + 历史') : '');
  console.log(head);
  if (!hits.length && !hist.length) {
    console.log(c.green('无命中') + (f.history ? c.dim('（工作树 + 历史）') : ''));
    return process.exit(0);
  }
  for (const h of hits) {
    const where = `${path.relative(process.cwd(), path.join(h.root, h.rel))}:${h.line}`.split(path.sep).join('/');
    console.log(`  ${c.red(h.id)}  ${where}  ${c.dim(h.why)}`);
    console.log(c.dim(`      ${h.snippet}`));
  }
  for (const h of hist) {
    console.log(`  ${c.red(h.id)}  ${c.yellow('历史')} ${h.commit}  ${h.rel}  ${c.dim(h.why)}`);
    console.log(c.dim(`      ${h.snippet}`));
  }
  const parts = [];
  if (hits.length) parts.push(`工作树 ${hits.length} 处`);
  if (hist.length) parts.push(`历史 ${hist.length} 处`);
  console.log(c.red(`\n${parts.join(' · ')}待处理：改掉、或确认可公开后加入 policy/publish.json 的 allowPaths`));
  if (hist.length) {
    console.log(c.dim('  历史里的命中改不掉——只能删仓重建，或确认远端已 GC（force-push 只改引用，不删对象）。'));
  }
  return process.exit(1);
}

function listRules(args) {
  const f = flags(args);
  assertDomain(f.domain);
  assertSeverity(f.severity);
  assertLevel(f.level);
  const policy = loadPolicy(ROOT, { profile: f.profile });
  let rules = buildCatalog(ROOT).rules.filter((r) => r.status !== 'retired');
  // 生效级：本仓 policy 可能单条覆盖默认级（降级），过滤与展示都按生效级
  const withSev = rules.map((r) => ({ ...r, sev: effectiveSeverity(r, policy) }));
  if (f.tags.length) rules = rules.filter((r) => f.tags.every((t) => r.tags.includes(t)));
  if (f.level) rules = rules.filter((r) => r.level === f.level);
  if (f.domain) rules = rules.filter((r) => r.domain === f.domain);
  const shown = rules.map((r) => withSev.find((x) => x.id === r.id)).filter((r) => !f.severity || r.sev === f.severity);

  if (f.json) return console.log(JSON.stringify(shown, null, 2));
  if (!shown.length) return console.log(c.dim('无匹配规则'));

  const overridden = shown.filter((r) => r.sev !== r.severity);
  for (const r of shown) {
    const sev = r.sev === r.severity ? r.severity : `${r.severity} → ${c.yellow(r.sev)}`;
    console.log(`${c.bold(r.id)}  ${r.level}/${sev}  ${r.title}`);
    console.log(c.dim(`  ${r.file}:${r.line}  tags=${r.tags.join(',')}  applies=${r.applies.join(',')}`));
  }
  console.log(c.dim(`\n${shown.length} 条` + (overridden.length ? `（本仓 policy 覆盖 ${overridden.length} 条）` : '')));
}

main().catch((e) => {
  console.error(c.red(e.message || e));
  process.exit(1);
});
