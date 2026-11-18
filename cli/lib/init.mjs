// init / doctor：业务仓接入。探测栈 → 填 L3 模板 → 自检。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, readJSON, readText, walk , detectLayout } from './util.mjs';
import { listFiles } from './scan.mjs';
import { isCatalogStale } from './catalog.mjs';
import { isDistStale } from './build.mjs';
import { validateOverrides } from './policy.mjs';

const DIALECTS = ['mysql', 'postgres', 'oracle', 'kingbase'];
const SKILL_OF_DOMAIN = { 'java-jdk8': 'write-java', vue: 'write-vue', sql: 'write-sql', test: 'write-test' };

const readIf = (p) => (fs.existsSync(p) ? readText(p) : null);
const pick = (s, re) => (s ? (s.match(re)?.[1] ?? null) : null);
const normJava = (v) => {
  const m = String(v).match(/(\d+)(?:\.(\d+))?/);
  if (!m) return v;
  const major = Number(m[1]);
  if (major === 1 && m[2]) return String(Number(m[2])); // 1.8 → 8
  return String(major);
};

/** 探测业务仓技术栈，只填能确定的项。支持多模块 Maven/Gradle。 */
export function detectStack(dir) {
  const target = path.resolve(dir);
  const out = { 项目名: path.basename(target) };
  const notes = [];

  const poms = readAll(target, 'pom.xml');
  const gradles = [...readAll(target, 'build.gradle'), ...readAll(target, 'build.gradle.kts')];
  const rootPom = poms.find((p) => path.dirname(p.file) === target)?.text ?? null;
  const allPoms = poms.map((p) => p.text).join('\n');

  const javaV =
    pick(rootPom, /<java\.version>\s*([^<]+)</) ??
    pick(rootPom, /<maven\.compiler\.source>\s*([^<]+)</) ??
    pick(allPoms, /<java\.version>\s*([^<]+)</) ??
    pick(allPoms, /<maven\.compiler\.source>\s*([^<]+)</) ??
    pick(gradles.map((g) => g.text).join('\n'), /sourceCompatibility\s*=\s*['"]?([\d.]+)/);
  if (javaV) out.Java = normJava(javaV);

  const boot =
    pick(allPoms, /<artifactId>spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)</) ?? pick(allPoms, /<spring-boot\.version>([^<]+)</);
  if (boot) out['Spring Boot'] = boot;

  const deps = `${allPoms}${gradles.map((g) => g.text).join('\n')}`;
  if (/mybatis-plus/i.test(deps)) out['持久化'] = 'MyBatis-Plus';
  else if (/mybatis/i.test(deps)) out['持久化'] = 'MyBatis';

  const modules = [...allPoms.matchAll(/<module>\s*([^<]+)\s*<\/module>/g)].map((m) => m[1].trim());
  if (modules.length > 1) {
    out['包结构'] = 'legacy';
    notes.push(`多模块（${modules.length}）：${modules.join(', ')}；按规范不搬包，存量包映射请人工填`);
  }

  const files = listFiles(target);
  const engines = detectEngines(files, target);
  if (engines) out.engines = engines;

  const pkg = readJSON(path.join(target, 'package.json'));
  if (pkg) {
    const v = pkg.dependencies?.vue ?? pkg.devDependencies?.vue;
    if (v) out.Vue = String(v).replace(/^[^\d]*/, '');
  }
  out['仓类型'] = pkg ? (poms.length ? '全栈' : '仅前端') : '仅后端';

  const rootPkg = detectRootPackage(files, target);
  if (rootPkg) out['根包'] = rootPkg;

  const flatSql = files
    .map((f) => path.relative(target, f).split(path.sep).join('/'))
    .filter((f) => /\.sql$/i.test(f) && !/^sql\//i.test(f));
  if (flatSql.length && !files.some((f) => /[\\/]sql[\\/](upgrade|install)[\\/]/i.test(f))) {
    notes.push(`SQL 脚本散在仓内（${flatSql.length} 个，如 ${flatSql[0]}），未按 SQL-DIR-01 的 sql/ 布局；迁移需人工定`);
  }

  out.__notes = notes;
  return out;
}

/**
 * 规则集是按 JDK 8 + Vue 2 写的。探测到别的版本时，不报错，但要明确告警：
 * 否则 JDK17 仓会看到 `record` 被判 critical、Vue3 仓会看到 `<script setup>` 被判 high，
 * 而 L3 里写的是「Java 17 / Vue 3」，doctor 还以为一切正常（P2-3）。
 */
export function stackCoverageNotes(detected) {
  const out = [];
  const javaMajor = Number(String(detected.Java ?? '').match(/\d+/)?.[0]);
  if (javaMajor && javaMajor > 8) {
    out.push(`探测到 Java ${detected.Java}，但当前规则集按 JDK 8 写（J8-MOD / J8-API 等条目不适用于 JDK 9+）`);
  }
  const vueMajor = Number(String(detected.Vue ?? '').match(/\d+/)?.[0]);
  if (vueMajor && vueMajor !== 2) {
    out.push(`探测到 Vue ${detected.Vue}，但当前规则集只覆盖 Vue 2（V2-* 和 write-vue skill 不适用）`);
  }
  return out;
}

function readAll(dir, name) {
  const out = [];
  for (const f of walk(dir, (p) => path.basename(p) === name)) {
    if (/[\\/](target|build|out|node_modules)[\\/]/.test(f)) continue;
    out.push({ file: f, text: readText(f) });
  }
  return out;
}

export function detectEngines(files, dir) {
  const found = new Set();
  for (const f of files) {
    // 前面补 `/`：仓根就是 sql/ 或 mapper/ 时，relative 结果没有前导分隔符，
    // 下面几个带前导 `/` 的模式会全脉不到（曾经因此把仓根 sql 布局的仓当成没方言）。
    const rel = ('/' + path.relative(dir, f).split(path.sep).join('/')).toLowerCase();
    const m =
      rel.match(/\/(?:mapper|db|sql\/upgrade)\/([a-z]+)\//) ??
      rel.match(/\/sql\/install\/([a-z]+)_init\.sql$/) ??
      rel.match(/\/sql\/([a-z]+)\//);
    if (m && DIALECTS.includes(m[1])) found.add(m[1]);
  }
  return found.size ? DIALECTS.filter((d) => found.has(d)).join(',') : null;
}

/** 取所有 src/main/java 下 package 声明的公共前缀。 */
function detectRootPackage(files, dir) {
  const pkgs = [];
  for (const f of files) {
    if (!/[\\/]src[\\/]main[\\/]java[\\/]/.test(f) || !f.endsWith('.java')) continue;
    const pkg = pick(readText(f), /^\s*package\s+([\w.]+)\s*;/m);
    if (pkg) pkgs.push(pkg.split('.'));
    if (pkgs.length >= 200) break;
  }
  if (!pkgs.length) return null;
  let prefix = pkgs[0];
  for (const p of pkgs.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < p.length && prefix[i] === p[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix.length ? prefix.join('.') : pkgs[0].slice(0, 3).join('.');
}

/** 用探测结果回填 L3 模板的表格行；未探测到的保持原样，由人补。 */
export function renderAgents(template, detected) {
  const lines = template.split(/\r?\n/);
  const filled = [];
  const patched = lines.map((line) => {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/);
    if (!m) return line;
    const label = m[1].trim();
    const key = normKey(label);
    const val = detected[key];
    if (!val) return line;
    filled.push(key);
    return `| ${label} | ${val} |`;
  });

  const todo = [];
  for (const line of patched) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/);
    if (!m) continue;
    const key = normKey(m[1]);
    const val = m[2].trim();
    if (!key || /^-+$/.test(key)) continue;
    if (!val || /^<!--/.test(val)) todo.push(key);
  }

  return { text: patched.join('\n'), filled, todo };
}

/** 去掉表格单元格里的强调标记，让 `**engines**` 与探测键 engines 对得上。 */
const normKey = (s) => String(s).replace(/[*`]/g, '').trim();

/** 新项目默认包结构（与 J8-SPR-19 正文里的默认树一致）；只建目录，不放文件。 */
export const DEFAULT_TREE = [
  'controller',
  'service',
  'service/impl',
  'mapper',
  'entity',
  'model',
  'convert',
  'config',
  'common',
];

/** 按默认树算出要建的目录（绝对路径）。根包探测不到时用 com.example 占位。 */
export function scaffoldDirs(target, rootPkg) {
  const pkg = (rootPkg || 'com.example').replace(/[^\w.]/g, '');
  const base = path.join(target, 'src', 'main', 'java', ...pkg.split('.'));
  return DEFAULT_TREE.map((d) => path.join(base, ...d.split('/')));
}

export function initRepo(dir, { force = false, dryRun = false, scaffold = false } = {}) {
  const target = path.resolve(dir);
  const agentsPath = path.join(target, 'AGENTS.md');
  const baselinePath = path.join(target, '.stdkit', 'baseline.json');
  const version = readJSON(path.join(ROOT, 'package.json'), {}).version;

  const detected = detectStack(target);
  const notes = detected.__notes ?? [];
  delete detected.__notes;
  notes.push(...stackCoverageNotes(detected));
  const template = readText(path.join(ROOT, 'templates', 'AGENTS.md')).replace(/stdkit v[\d.]*[\dX.Y.Z]*/, `stdkit v${version}`);
  const { text, filled, todo } = renderAgents(template, detected);

  const scaffoldPlan = scaffold ? scaffoldDirs(target, detected['根包']) : null;
  const result = { target, detected, filled, todo, notes, wrote: [], scaffold: scaffoldPlan };
  if (dryRun) return result;

  if (scaffoldPlan) {
    for (const dirAbs of scaffoldPlan) {
      if (fs.existsSync(dirAbs)) continue;
      fs.mkdirSync(dirAbs, { recursive: true });
      result.wrote.push(`${path.relative(target, dirAbs).split(path.sep).join('/')}/`);
    }
  }

  if (fs.existsSync(agentsPath) && !force) {
    result.skipped = ['AGENTS.md 已存在（加 --force 覆盖）'];
  } else {
    fs.writeFileSync(agentsPath, text, 'utf8');
    result.wrote.push('AGENTS.md');
  }

  if (!fs.existsSync(baselinePath)) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({ $comment: 'stdkit 基线豁免。过期自动失效；reason 必写。', waivers: [] }, null, 2) + '\n',
      'utf8',
    );
    result.wrote.push('.stdkit/baseline.json');
  }

  return result;
}

/**
 * 比较 L3 声明值与探测值。三类情况：
 *   1. 多值字段（如 engines：`mysql / kingbase` vs `mysql,kingbase`）——按集合比，只要求探测到的都在声明里；
 *   2. 版本字段（`2.x` vs `2.3.1.RELEASE`）——只比主版本号，L3 写粗粒度不算错；
 *   3. 其余（根包名等）——字符串包含。
 */
export function matchesDeclared(declared, detected) {
  const want = tokens(declared);
  const got = tokens(detected);
  if (got.length > 1) return got.every((t) => want.includes(t));

  const d = String(detected).trim();
  const m = d.match(/\d+(?:\.\d+)*/);
  if (!m) return String(declared).includes(d);
  const major = m[0].split('.')[0];
  return new RegExp(`(^|\\D)${major}(\\D|$)`).test(String(declared));
}

/** 拆分多值字段：去掉括号里的说明，再按 , ， / 、 空白 切分。 */
function tokens(v) {
  return String(v ?? '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .split(/[,，/、\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function doctor(dir) {
  const target = path.resolve(dir);
  const version = readJSON(path.join(ROOT, 'package.json'), {}).version;
  const self = target === path.resolve(ROOT);
  // 与 check / gate.sh 共用 detectLayout：dist/ 安装没有 catalog 的源头，
  // catalog/dist/references 三项无从比对（会去找 dist/dist）；不认识的目录要 FAIL 而不是 SKIP
  const layout = detectLayout(ROOT);
  const ruleRepo = layout === 'rules-repo';
  const checks = [];
  const add = (level, name, msg, group = 'repo') => checks.push({ level, name, msg, group });

  // 0. 目标是 stdkit 本仓：只查自身一致性
  if (self) {
    if (!ruleRepo) {
      if (layout === 'dist-install') {
        add('SKIP', 'stdkit 自检', 'ROOT 是 dist/ 安装（无 rules/），自身一致性检查只在源码仓有意义', 'self');
        return { checks, failed: 0, warned: 0 };
      }
      add('FAIL', 'stdkit 自检', 'ROOT 既不是规则仓也没有 catalog/rules.json + cli/ds.mjs：ds 装错了目录？', 'self');
      return { checks, failed: 1, warned: 0 };
    }
    const cat = isCatalogStale(ROOT);
    add(cat.stale ? 'FAIL' : 'PASS', 'catalog', cat.stale ? '与规则不一致，跑 ds catalog' : '同步', 'self');
    const dist = isDistStale(ROOT);
    add(dist.stale ? 'FAIL' : 'PASS', 'dist', dist.stale ? dist.reason : '同步', 'self');
    return { checks, failed: checks.filter((x) => x.level === 'FAIL').length, warned: checks.filter((x) => x.level === 'WARN').length };
  }

  // 1. L3
  const agentsPath = path.join(target, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) add('FAIL', 'AGENTS.md', '业务仓缺 L3；跑 ds init');
  else {
    const declared = readAgentsTable(readText(agentsPath));
    add('PASS', 'AGENTS.md', '存在');
    if (declared['规范版本']) {
      const ok = String(declared['规范版本']).includes(version);
      add(ok ? 'PASS' : 'WARN', '规范版本', ok ? `与 stdkit v${version} 一致` : `声明 ${declared['规范版本']}，当前 v${version}`);
    } else add('WARN', '规范版本', '未声明，无法知道按哪版规范写的');

    const detected = detectStack(target);
    delete detected.__notes;
    for (const key of ['Java', 'Spring Boot', 'Vue', 'engines', '根包']) {
      if (!detected[key]) continue;
      if (!declared[key]) add('WARN', key, `已探测到 ${detected[key]}，L3 未填`);
      else if (!matchesDeclared(declared[key], detected[key]))
        add('WARN', key, `L3 ${declared[key]} ≠ 实际 ${detected[key]}`);
      else add('PASS', key, String(detected[key]));
    }
    for (const note of stackCoverageNotes(detected)) add('WARN', '技术栈覆盖', note);
  }

  // 2. 基线
  const baselineRaw = readIf(path.join(target, '.stdkit', 'baseline.json'));
  let baseline;
  try {
    baseline = baselineRaw === null ? null : JSON.parse(baselineRaw);
  } catch {
    baseline = 'bad';
  }
  if (baselineRaw === null) add('WARN', 'baseline', '无 .stdkit/baseline.json（不是必须）');
  else if (baseline === 'bad') add('FAIL', 'baseline', 'JSON 解析失败');
  else if (!Array.isArray(baseline?.waivers)) add('FAIL', 'baseline', 'waivers 不是数组');
  else {
    const expired = baseline.waivers.filter((w) => w.until && new Date(w.until).getTime() < Date.now());
    const noReason = baseline.waivers.filter((w) => !w.reason);
    add('PASS', 'baseline', `${baseline.waivers.length} 条豁免`);
    if (expired.length) add('WARN', 'baseline', `${expired.length} 条已过期（会自动失效）：${expired.map((w) => w.ruleId).join('、')}`);
    if (noReason.length) add('WARN', 'baseline', `${noReason.length} 条缺 reason`);
  }

  // 2.4 同名外部 skill：两仓 skill 同名，同时装会互相覆盖，且 ds 看不到客户端状态，只能尽力探测
  const slots = [
    path.join(os.homedir(), '.pi', 'agent', 'skills'),
    path.join(os.homedir(), '.agents', 'skills'),
    path.join(os.homedir(), '.claude', 'skills'),
  ];
  const foreign = [];
  for (const slot of slots) {
    for (const name of ['write-java', 'write-vue', 'write-sql']) {
      const skillFile = path.join(slot, name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      let text = '';
      try {
        text = readText(skillFile);
      } catch {
        continue;
      }
      // 同名外部包特征：「文件 §章节」式回指，或 Vue3 参考文件
      const oldStyle = /§|references\/00-vue3\.md/.test(text);
      if (oldStyle) foreign.push(`${name}@${slot}`);
    }
  }
  if (foreign.length) {
    add('WARN', 'skill 冲突', `发现同名外部 skill：${[...new Set(foreign)].join('、')}；同名会互相覆盖，不要同时启用`);
  } else {
    add('PASS', 'skill 冲突', '未探测到同名外部 skill');
  }

  // 2.5 业务仓 policy 覆盖（写了不生效是历史高发坑）
  const policyRaw = readIf(path.join(target, '.stdkit', 'policy.json'));
  if (policyRaw !== null) {
    let pol;
    try {
      pol = JSON.parse(policyRaw);
    } catch {
      add('FAIL', 'policy', '.stdkit/policy.json 解析失败');
      pol = null;
    }
    if (pol) {
      const rules = readJSON(path.join(ROOT, 'catalog', 'rules.json'), null)?.rules ?? [];
      const { errors, warnings } = validateOverrides(pol, rules);
      const n = Object.keys(pol.severity ?? {}).length;
      if (errors.length) for (const m of errors) add('FAIL', 'policy', m);
      else add('PASS', 'policy', n ? `${n} 条单条覆盖` : '存在但无 severity 覆盖');
      for (const m of warnings) add('WARN', 'policy', m);
    }
  }

  // 3. sql 布局
  const sqlUp = path.join(target, 'sql', 'upgrade');
  if (fs.existsSync(sqlUp)) {
    for (const e of fs.readdirSync(sqlUp, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (!fs.existsSync(path.join(sqlUp, e.name, 'rollback')))
        add('WARN', `sql/${e.name}`, '缺 rollback/（见 SQL-RBK-01）');
      else add('PASS', `sql/${e.name}`, '有 rollback/');
    }
  }

  // 4. stdkit 自身一致性（dist/ 安装下跳过：没有 rules/ 就没有比对基准）
  if (!ruleRepo) {
    add(
      layout === 'dist-install' ? 'SKIP' : 'FAIL',
      'stdkit 自检',
      layout === 'dist-install'
        ? 'ROOT 是 dist/ 安装（无 rules/），跳过 catalog / dist / references'
        : 'ROOT 既不是规则仓也不是 dist 安装，自身一致性无从检查',
      'self',
    );
    return { checks, failed: checks.filter((x) => x.level === 'FAIL').length, warned: checks.filter((x) => x.level === 'WARN').length };
  }
  const cat = isCatalogStale(ROOT);
  add(cat.stale ? 'FAIL' : 'PASS', 'stdkit catalog', cat.stale ? '与规则不一致，跑 ds catalog' : '同步', 'self');
  const dist = isDistStale(ROOT);
  add(dist.stale ? 'FAIL' : 'PASS', 'stdkit dist', dist.stale ? dist.reason : '同步', 'self');

  // 5. 每条规则所属文件都被对应 skill 的 references 收录（防悬空规则 ID）
  const catalog = readJSON(path.join(ROOT, 'catalog', 'rules.json'), null);
  if (catalog) {
    const missing = new Set();
    for (const r of catalog.rules) {
      const skill = SKILL_OF_DOMAIN[r.domain];
      if (!skill) continue;
      const ref = path.join(ROOT, 'dist', 'skills', skill, 'references', path.basename(r.file));
      if (!fs.existsSync(ref)) missing.add(r.file);
    }
    add(
      missing.size ? 'FAIL' : 'PASS',
      'references',
      missing.size ? `未进入 skill references：${[...missing].join('、')}` : '规则文件均已收录',
      'self',
    );
  }

  return { checks, failed: checks.filter((x) => x.level === 'FAIL').length, warned: checks.filter((x) => x.level === 'WARN').length };
}

function readAgentsTable(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/);
    if (!m) continue;
    const key = normKey(m[1]);
    if (!key || /^-+$/.test(key)) continue;
    if (!(key in out)) out[key] = m[2].trim();
  }
  return out;
}
