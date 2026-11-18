// build：rules/ + policy/ → dist/（skills · prompts · adapters）。纯函数，产物确定，无时间戳。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readText, readJSON, walk } from './util.mjs';
import { buildCatalog } from './catalog.mjs';
import { CROSS_RULE_IDS } from './cross.mjs';

export const DIST = path.join(ROOT, 'dist');

export const SKILLS = [
  {
    name: 'write-java',
    domain: 'java-jdk8',
    title: 'Java 8 后端',

    description:
      '按 stdkit 规则写或改 Java 8 / Spring Boot 2.x / MyBatis 后端代码。' +
      '在要写接口、改 Controller/Service/Mapper、动 *.java 或 Mapper XML、改事务/分页/幂等/金额/日志/线程池、' +
      '提到 JDK8 语法不可用、#{}、${}、BigDecimal、pageSize、多方言 XML，或输入 /write-java 时使用。' +
      '不要用来写 sql/ 交付脚本（用 write-sql），也不要用来审代码（用 /review-java）。',
    stack: 'Java 8 · Spring Boot 2.x · MyBatis / MyBatis-Plus',
  },
  {
    name: 'write-vue',
    domain: 'vue',
    title: 'Vue 2 前端',

    description:
      '按 stdkit 规则写或改 Vue 2.7 + Element UI + JavaScript（Options API）前端。' +
      '在要写组件、改页面、改路由/Vuex、封装请求、动 *.vue、提到 Element UI、Options API、' +
      '禁 TypeScript、禁 Pinia、data/props、样式 scoped，或输入 /write-vue 时使用。' +
      '不要用来写 Java 或 sql/ 脚本。',
    stack: 'Vue 2.7 · Element UI 2.15 · Vuex 3 · Vue Router 3 · Axios',
  },
  {
    name: 'write-sql',
    domain: 'sql',
    title: 'SQL 交付脚本',

    description:
      '按 stdkit 规则写 sql/ 下的多库交付脚本（MySQL / PostgreSQL / Oracle / Kingbase）：' +
      '目录布局、命名、中文文件头、同名回滚、幂等 DDL/DML、方言差异、风险分级。' +
      '在要写升级/回滚脚本、改表、加字段、幂等、方言，或输入 /write-sql 时使用。' +
      '不要用来改 MyBatis Mapper XML（用 write-java）。',
    stack: 'MySQL / PostgreSQL / Oracle / Kingbase',
  },
  {
    name: 'write-test',
    domain: 'test',
    title: '单元测试',

    description:
      '按 stdkit 规则写单元测试。仅在用户**明确要求**写测试时使用（写侧默认不写测试）。' +
      '在要写 JUnit 4 / Mockito 单测、Jest + @vue/test-utils 组件测试、' +
      '要判断该测什么/怎么避免 flaky，或输入 /write-test 时使用。',
    stack: 'JUnit 4 + Mockito · Jest + @vue/test-utils',
  },
];

export const REVIEWS = [
  { name: 'review-java', domains: ['java-jdk8'], stacks: ['java'], title: 'Java / Spring / MyBatis / sql' },
  { name: 'review-vue', domains: ['vue'], stacks: ['vue'], title: 'Vue 2' },
  { name: 'review-sql', domains: ['sql'], stacks: ['sql'], title: 'sql/ 交付脚本' },
  { name: 'review-fullstack', domains: ['java-jdk8', 'vue', 'sql'], stacks: ['java', 'vue', 'sql'], title: '全栈（Java + Vue + sql）' },
];

export function buildFiles(root = ROOT) {
  const cat = buildCatalog(root);
  const policy = readJSON(path.join(root, 'policy', 'default.json'), {});
  const files = new Map();

  for (const s of SKILLS) filesForSkill(files, root, cat, s);
  for (const r of REVIEWS) files.set(`prompts/${r.name}.md`, reviewPrompt(cat, policy, r));

  // 扩展与模板：一并生成，让 pi install dist 后即开箱可用
  for (const abs of walk(path.join(root, 'extensions'), (p) => p.endsWith('.ts') || p.endsWith('.js'))) {
    files.set(`extensions/${path.basename(abs)}`, readText(abs));
  }
  // 顶层 shim：不想敲 node 的人可以直接 ./install.sh
  for (const shim of ['install.sh', 'install.ps1']) {
    const abs = path.join(root, shim);
    if (fs.existsSync(abs)) files.set(shim, readText(abs));
  }
  const tpl = path.join(root, 'templates');
  for (const abs of walk(tpl, (p) => /\.(md|sh|yml)$/.test(p))) {
    files.set(`templates/${path.relative(tpl, abs).split(path.sep).join('/')}`, readText(abs));
  }

  // CLI 与 catalog 一并发布：dist 自包含，扩展与 `node <dist>/cli/ds.mjs` 都能直接跑
  for (const abs of walk(path.join(root, 'cli'), (p) => p.endsWith('.mjs'))) {
    files.set(`cli/${path.relative(path.join(root, 'cli'), abs).split(path.sep).join('/')}`, readText(abs));
  }
  files.set('catalog/rules.json', JSON.stringify(cat, null, 2) + '\n');

  files.set('AGENTS.md', agentsMd(cat, policy));
  files.set('package.json', distPackageJson(cat, root));
  // LICENSE 一并发布：装到别处也带着授权
  const licenseFile = path.join(root, 'LICENSE');
  if (fs.existsSync(licenseFile)) files.set('LICENSE', readText(licenseFile));

  // 客户端适配器：只放薄壳，实现在 skills/ prompts/
  files.set('adapters/claude/plugin.json', claudePlugin(cat, root));
  for (const r of REVIEWS) files.set(`adapters/claude/commands/${r.name}.md`, reviewPrompt(cat, policy, r));

  files.set('adapters/codex/plugin.json', codexPlugin(cat, root));
  for (const r of REVIEWS) {
    files.set(`adapters/codex/skills/${r.name}/SKILL.md`, reviewSkill(cat, policy, r));
    files.set(
      `adapters/codex/skills/${r.name}/agents/openai.yaml`,
      'policy:\n  allow_implicit_invocation: false\n',
    );
  }

  files.set('adapters/cursor/rules/stdkit.mdc', cursorRule(cat));
  files.set('adapters/copilot/copilot-instructions.md', copilotInstructions(cat));
  files.set('README.md', distReadme(cat, root));
  return files;
}

// ---------- skills ----------

function filesForSkill(files, root, cat, skill) {
  const rules = cat.rules.filter((r) => r.domain === skill.domain && r.status !== 'retired');
  files.set(`skills/${skill.name}/SKILL.md`, skillMd(cat, skill, rules));
  // 目录全量收录，不写死文件名——新增 rules 文件不需要改代码，也不会出现悬空规则 ID。
  for (const ref of refFiles(root, skill.domain)) {
    files.set(`skills/${skill.name}/references/${ref}`, readText(path.join(root, 'rules', skill.domain, ref)));
  }
}

/** rules/<domain>/ 下的全部 .md，按文件名排序（00, 01, ...）。 */
export function refFiles(root, domain) {
  const dir = path.join(root, 'rules', domain);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

function skillMd(cat, skill, rules) {
  const rows = rules
    .map((r) => `| \`${r.id}\` | ${r.level} / ${r.severity} | ${r.title} |`)
    .join('\n');
  const refs = refFiles(ROOT, skill.domain)
    .map((r) => `- \`references/${r}\`（本 skill 自带，规则正文与元数据）`)
    .join('\n');
  const machine = rules.filter((r) => r.deny.length);

  return `---
name: ${skill.name}
description: >
  ${wrap(skill.description, 2)}
---

# ${skill.title}

权威条文只在本目录 \`references/\`。规则用稳定 ID 引用（如 \`${rules[0]?.id ?? ''}\`），不要按章节名回指。

栈：${skill.stack}

## 条文

${refs}

## 规则索引（${rules.length} 条）

| 规则 ID | 级别 / 严重度 | 标题 |
|---|---|---|
${rows}

## 步骤

1. 读业务仓根 \`AGENTS.md\`（L3）：Java/Vue 版本、engines、API Mode、分页上限、时区、根包、存量包映射。
2. 新项目：复制 stdkit \`templates/AGENTS.md\` 到业务仓根填满；存量仓只跟随现有结构，禁止为对齐规范搬包。
3. 按需读命中章节：先看规则索引定位 ID，再在 \`references/\` 里读该条正文与示例。
4. 只改需求范围。多方言有几套改几套。
5. 机械检查自查：\`ds scan\` （${machine.length} 条规则带正则守卫，本机可跑）。
6. 写完即止：不写测试、不触发审查、不提交；测试与审查仅人手动触发。

## 约束

- 冲突优先级：业务仓 \`AGENTS.md\` > 本 skill \`references/\` > stdkit \`policy/\` 默认值。
- 回指一律用规则 ID（\`${rules[0]?.id ?? ''}\`），不用「文件名 §章节」。
- 条文没有的不要凭空发明；不确定先问。
- 示例全部 Java 8 / Vue 2.7 可运行；不要引入版本外语法。
`;
}

// ---------- 审查 ----------

/**
 * 从生成的 review prompt 里反解规则清单。
 * 用途：`ds check` 断言「prompt 里的清单 == 该域的规则全集」——prompt 少一条，
 * 模型就永远不会审它，而且不会有任何报错（这是最致命的失效模式）。
 * 生成（reviewPrompt）与校验（check）共用这一份解析，格式改了只改这里。
 */
export function collectPromptRuleIds(md) {
  const machine = [];
  const semantic = [];
  const cross = [];
  const line = String(md)
    .split(/\r?\n/)
    .find((l) => l.startsWith('本次可机械判定的规则：'));
  if (line) {
    for (const m of line.matchAll(/`([A-Z][A-Z0-9]*-[A-Z0-9]+-\d{2})`/g)) machine.push(m[1]);
  }
  for (const l of String(md).split(/\r?\n/)) {
    // 仓级段的行尾多一个 ` → \`ds cross\``，正则要容得下
    const m = l.match(/^- `([A-Z][A-Z0-9]*-[A-Z0-9]+-\d{2})` (.+?)（(critical|high|medium|low)）(?:\s*→ `ds cross`)?$/);
    if (!m) continue;
    // 「仓级」段的行尾带有 → `ds cross`：由命令判定，不算 B 类
    if (l.includes('ds cross')) cross.push({ id: m[1], title: m[2], severity: m[3] });
    else semantic.push({ id: m[1], title: m[2], severity: m[3] });
  }
  return { machine, semantic, cross };
}


function reviewPrompt(cat, policy, review) {
  const rules = cat.rules.filter((r) => review.domains.includes(r.domain) && r.status !== 'retired');
  const machine = rules.filter((r) => r.deny.length);
  // 仓级：由 ds cross 机判，不能进 B 类（否则模型重复劳动，ADR 0001 的承诺落空）
  const cross = rules.filter((r) => CROSS_RULE_IDS.includes(r.id));
  const semantic = rules.filter((r) => !r.deny.length && !CROSS_RULE_IDS.includes(r.id));
  const blockOn = (policy.blockOn ?? ['critical', 'high']).join(' / ');
  const warnOn = (policy.warnOn ?? ['medium', 'low']).join(' / ');

  const semList = semantic
    .map((r) => `- \`${r.id}\` ${r.title}（${r.severity}）`)
    .join('\n');

  const scopes = review.domains
    .map((d) => `- \`${d}\`：${d === 'java-jdk8' ? 'skill `write-java` 的 `references/`' : d === 'vue' ? 'skill `write-vue` 的 `references/00-vue2.md`' : 'skill `write-sql` 的 `references/00-delivery.md`'}`)
    .join('\n');

  return `---
description: 审 ${review.title} 变更，只报告不改代码。输出 Block / Warning / Approve。
---

你是独立的规范审查员，只看本次 diff，只报告不改代码。

## 两条硬边界

1. **不改代码、不写测试、不提交、不代作者修复。**
2. **每条发现必须能回指规则 ID。** 条文里没有的不编、不强行判级，标「需人工确认」。

## 产出形式：只给修改指令，不落地

审查的产物是**可执行的修改指令**，不是改动本身：

- 每条发现写清：\`文件:行\`、**改成什么**（删哪行 / 换成什么写法 / 补上什么）、依据的规则 ID。
- 验证手段（跑什么测试/命令）写在最后，不要自己去跑改写。
- 只有用户在当轮明确说「改 / 修 / 按建议改」时，才转入 \`write-*\` 流程执行修改；
  否则审查到此为止。反过来，写代码时也不要自行发起审查。

## 第一步：机械检查（不花你的推理）

先跑确定性检查，拿到精确到行号的清单：

\`\`\`bash
ds brief --diff            # 未安装 ds 则跳过，并在结论备注写「未跑机械检查」
\`\`\`

\`ds brief\` 一次给出「A 类机械命中（含行号）」+「B 类需你判的规则清单」；
只要原始命中时用 \`ds scan --diff --json\`。

本次可机械判定的规则：${machine.map((r) => `\`${r.id}\``).join('、') || '无'}。
命中项直接计入结论，**不要重新逐行去找它们**。
${
    cross.length
      ? `\n仓级（文件集合层面，由命令判定，不在上面的逐行清单里）：\n` +
        cross.map((r) => `- \`${r.id}\` ${r.title}（${r.severity}）→ \`ds cross\``).join('\n') +
        '\n不跑 `ds cross` 就不要判这两条；它的输出直接计入结论，同样**不要自己再找一遍**。\n'
      : ''
  }

## 第二步：只审上下文类规则

读本次 diff，对照下表逐条判断（共 ${semantic.length} 条）。这些规则无法用正则判定，需要看调用链、数据关系、跨文件一致性：

${semList}

条文正文与判级依据：
${scopes}

## 分级与结论

| 级别 | 含义 | 结论 |
|---|---|---|
| critical / high（${blockOn}） | 安全、数据损坏、规范必须项违背 | **Block** |
| medium / low（${warnOn}） | 风格、可维护性、建议项 | **Warning** |
| 无发现 | — | **Approve** |

历史存量非本次引入 → 记「基线债」，不 Block。只对本次 diff 负责。

## 输出

结论三选一；发现按级分节，某级无发现写「无」。每条固定格式：

\`\`\`
## 审查结论：Block | Warning | Approve

### critical
- 无 | path:line — 现象 — 规则ID — 建议

### high
- 无 | …

### medium
- 无 | …

### 备注
- 机械检查：已跑（N 条命中）/ 未跑
- 栈：${stackNote(review)}
- 需人工确认：无 | …
- 基线债（历史存量）：无 | …
\`\`\`
`;
}

function stackNote(review) {
  const parts = [];
  if (review.domains.includes('java-jdk8')) parts.push('Java 8 / Spring Boot 2.x');
  if (review.domains.includes('vue')) parts.push('Vue 2.7 / Element UI');
  if (review.domains.includes('sql')) parts.push('engines 见业务仓 L3');
  return parts.join(' · ');
}

function reviewSkill(cat, policy, review) {
  const body = reviewPrompt(cat, policy, review);
  const desc = `只审查、不改代码。审 ${review.title} 变更，输出 Block / Warning / Approve。用 $${review.name} 显式调用。`;
  return `---
name: ${review.name}
description: >
  ${wrap(desc, 2)}
---

${body.replace(/^---\n[\s\S]*?\n---\n\n/, '')}`;
}

// ---------- 常驻 ----------

function agentsMd(cat, policy) {
  const counts = cat.domains.map((d) => `${d} ${cat.rules.filter((r) => r.domain === d).length}`).join(' · ');
  const blockOn = (policy.blockOn ?? ['critical', 'high']).join(' / ');
  return `# 工程规范（stdkit）

${counts}。规则以稳定 ID 引用；条文细节在对应 skill 的 \`references/\`。

## 开工

1. 先读业务仓 \`AGENTS.md\`（L3）与构建/依赖文件，再动手。
2. 非琐碎改动按信号激活写 skill：\`write-java\` / \`write-vue\` / \`write-sql\` / \`write-test\`（测试仅在明确要求时）。
3. 不确定先问；条文没有的不要凭空发明。

## 信号

| 信号 | 写（自动激活） | 审（仅手动） |
|---|---|---|
| \`*.java\` · Mapper XML · Spring · MyBatis | \`write-java\` | \`/review-java\` |
| \`sql/install\` · \`sql/upgrade\` | \`write-sql\` | \`/review-sql\` |
| \`*.vue\` · Vue 2 · Element UI | \`write-vue\` | \`/review-vue\` |
| 同一 PR 跨 Java + 前端 + SQL | 各走各 skill | \`/review-fullstack\` |

## 必须

- 只改需求范围。禁止顺手重构、搬包、全文件格式化存量。
- 金额用 \`BigDecimal\`，禁止 \`double\`/\`float\` 存算（\`J8-API-04\`）。
- 列表必须分页且 pageSize 有上限（\`J8-SPR-10\`）。
- 写路径必须幂等或可安全重试（\`J8-SPR-12\`）；事务内禁止远程调用与发消息（\`J8-SPR-03\`）。
- \`${'${}'}\` 只允许服务端白名单（\`J8-MBT-02\`）。
- 密钥只来自环境变量 / 配置中心；禁入仓库、日志、前端包（\`J8-SPR-15\`、\`V2-SEC-01\`）。
- 多方言同一次提交改齐（\`J8-MBT-07\`、\`SQL-DIA-01\`）。
- 写完即止：不写测试、不触发审查、不提交。

## 审查（人手动触发）

- 审查是独立动作：写侧不自行调用、不纳入写任务。
- 先跑 \`ds scan --diff\`（行级）+ \`ds cross\`（仓级），再谈语义审查。
- **审查只给修改建议，不代改**：每条带 \`文件:行\` + 具体改法 + 规则 ID；
  只有用户明确说「改」时才按 write-* skill 修改。
- \`${blockOn}\` 未修 → Block；历史存量非本次引入 → 不 Block。

## 提交

- 首行 \`type: 摘要\`（feat / fix / refactor / chore / docs / perf / test / revert）。
- 涉及 SQL / 多库 / 配置 / 任务 / 缓存 / API：提交说明带 \`影响:\` 行。
- 一个需求一个提交；大范围格式化单独提交。
`;
}

function cursorRule(cat) {
  return `---
description: stdkit 工程规范（JDK8 / Vue2 / SQL）
alwaysApply: true
---

# stdkit 工程规范

${cat.domains.map((d) => `- **${d}**：${cat.rules.filter((r) => r.domain === d).length} 条规则`).join('\n')}

完整条文：安装 stdkit 后用 skill \`write-java\` / \`write-vue\` / \`write-sql\` 加载 \`references/\`。

## 硬约束

- 只改需求范围，禁止顺手重构与搬包。
- 金额 \`BigDecimal\`（\`J8-API-04\`）；列表必须分页且有上限（\`J8-SPR-10\`）。
- 写路径幂等（\`J8-SPR-12\`）；事务内禁远程（\`J8-SPR-03\`）。
- \`${'${}'}\` 仅白名单（\`J8-MBT-02\`）；密钥不入仓库/日志/前端包。
- Vue 2 用 Options API，禁 TypeScript、禁 Pinia（\`V2-BASE-01\`、\`V2-BASE-02\`）。
- 机械检查：\`ds scan --diff\`（行级）+ \`ds cross\`（仓级：回滚是否配齐、多方言是否齐）。

审查只在人明确要求时进行。
`;
}

function copilotInstructions(cat) {
  return `# Copilot 指令（stdkit）

本仓遵循 stdkit 工程规范（JDK8 / Vue2 / SQL，共 ${cat.rules.length} 条）。规则以 ID 引用。

- 改 \`*.java\` / Mapper XML：遵守 skill \`write-java\`；金额用 \`BigDecimal\`（J8-API-04），列表必须分页有上限（J8-SPR-10），写路径幂等（J8-SPR-12），事务内禁远程（J8-SPR-03）。
- 改 \`*.vue\`：Vue 2 + Options API + Element UI，禁 TypeScript 与 Pinia（V2-BASE-01、V2-BASE-02）。
- 改 \`sql/\`：目录与文件头、幂等守卫、同名回滚、全量方言（SQL-DIR-01、SQL-IDM-01、SQL-RBK-01、SQL-DIA-01）。
- 只改需求范围，不顺手重构、不搬包。不确定先问。
- 不自动写测试、不自动触发审查。
`;
}

// ---------- 包与说明 ----------

function claudePlugin(cat, root) {
  const version = readJSON(path.join(root, 'package.json'), {}).version;
  return JSON.stringify(
    {
      name: 'stdkit',
      version,
      description: `stdkit 工程规范：${cat.rules.length} 条规则（JDK8 / Vue2 / SQL）；写走 skills，审走 /review-* 手动命令。`,
      license: readJSON(path.join(root, 'package.json'), {}).license ?? 'UNLICENSED',
      keywords: ['standards', 'java', 'jdk8', 'vue2', 'sql'],
      agents: [],
    },
    null,
    2,
  ) + '\n';
}

function codexPlugin(cat, root) {
  const version = readJSON(path.join(root, 'package.json'), {}).version;
  return JSON.stringify(
    {
      name: 'stdkit',
      version,
      description: `stdkit 工程规范（${cat.rules.length} 条）：skills 目录 + 只显式调用的审查 skill。`,
      license: readJSON(path.join(root, 'package.json'), {}).license ?? 'UNLICENSED',
      skills: './skills/',
    },
    null,
    2,
  ) + '\n';
}

function distPackageJson(cat, root) {
  const version = readJSON(path.join(root, 'package.json'), {}).version;
  return JSON.stringify(
    {
      name: 'stdkit-dist',
      version,
      private: true,
      description: `stdkit 生成产物：${cat.rules.length} 条规则的 skills / prompts / cli / 客户端适配器。勿手改，改 rules/ 后跑 ds build。`,
      type: 'module',
      bin: { ds: './cli/ds.mjs' },
      keywords: ['pi-package', 'standards', 'code-review'],
      license: readJSON(path.join(root, 'package.json'), {}).license ?? 'UNLICENSED',
      pi: {
        skills: ['./skills'],
        prompts: ['./prompts'],
        extensions: ['./extensions'],
      },
      peerDependencies: {
        '@earendil-works/pi-coding-agent': '*',
        typebox: '*',
      },
    },
    null,
    2,
  ) + '\n';
}

function distReadme(cat, root) {
  const version = readJSON(path.join(root, 'package.json'), {}).version;
  return `# stdkit dist（生成物，勿手改）

由 \`ds build\` 从 \`rules/\` + \`policy/\` 生成。版本 v${version}，${cat.rules.length} 条规则。

改条文请改仓库根 \`rules/\`，然后 \`node cli/ds.mjs build && node cli/ds.mjs check\`。

## 内容

\`\`\`text
dist/
├── skills/       write-java · write-vue · write-sql · write-test（各自带 references/）
├── prompts/      review-java · review-vue · review-sql · review-fullstack
├── extensions/   pi 扩展：ds_check 工具 + 写前护栏
├── cli/          ds 运行时（自包含：读 catalog/，不依赖源码仓 rules/）
├── catalog/      机器可读规则索引
├── templates/    业务仓 L3 模板 + CI 门禁脚本
├── adapters/     claude · codex · cursor · copilot（薄壳）
├── AGENTS.md     常驻底线（AGENTS.md 生态通用）
└── package.json  pi package manifest（bin: ds）
\`\`\`

## 已知限制（先知道再装）

- **只有 ${cat.rules.filter((r) => r.deny.length).length}/${cat.rules.length} 条能自动判**：其余靠模型读条文；条文里写「需人工确认」的就是机器抓不到的，**没报不等于没问题**。
- **单栈**：只覆盖 JDK 8 + Vue 2（Options API）。JDK 17 / Vue 3 / TypeScript 没有规则域，接入会看到成片误报。
- **不替代 review**：判的是形态（\`private double amount;\`），判不了「这个事务边界对不对」。
- **护栏只拦 critical**，且覆盖不到 pi 的注册与事件路由（只能由宿主验证）。
- 与其他同名规范包 **不要同时装**（skill 同名会互相覆盖；\`ds doctor\` 会给 WARN）。

完整清单（含具体抓不到的形态）：见源码仓 \`docs/limits.md\`。

## 接入

### pi（一等公民）

\`\`\`bash
pi install /绝对路径/stdkit/dist        # skills + prompts 一起装上
\`\`\`

- \`/write-java\`：显式调用写 skill
- \`/review-java\`：pi 原生 prompt template，只手动触发
- \`ds_check\`：扩展注册的工具，模型可自行跑确定性检查
- 写前护栏：\`write\`/\`edit\` 命中 critical 级硬规则时拦截（\`STDKIT_GUARD=off\` 关闭）
- 机械检查：\`node <stdkit>/cli/ds.mjs brief --diff\`

### Claude Code

把本目录整体当插件用（不要在业务仓根做 cp -r，那会把产物铺进业务仓）：

\`\`\`bash
# 方案 A：插件安装（推荐）
claude --plugin-dir /绝对路径/stdkit/dist

# 方案 B：把 plugin.json 与审查命令装到用户级目录
mkdir -p ~/.claude/.claude-plugin ~/.claude/commands
cp adapters/claude/plugin.json ~/.claude/.claude-plugin/
cp adapters/claude/commands/*.md ~/.claude/commands/
\`\`\`

审查用 \`/review-java\`（skills 进 \`/\` 菜单，subagent 不装——会被模型自动委托）。

### Codex

\`\`\`bash
mkdir -p ~/.agents/skills
cp -r skills/* ~/.agents/skills/
cp -r adapters/codex/skills/review-* ~/.agents/skills/
\`\`\`

\`review-*/agents/openai.yaml\` 里的 \`allow_implicit_invocation: false\` 让它只能 \`$review-java\` 显式调用。

### Cursor / Copilot

- Cursor：\`adapters/cursor/rules/stdkit.mdc\` → 项目 \`.cursor/rules/\`
- Copilot：\`adapters/copilot/copilot-instructions.md\` → \`.github/copilot-instructions.md\`
- 任意支持 \`AGENTS.md\` 的工具：\`AGENTS.md\` → 仓根

## 门禁

\`templates/ci/gate.sh\` 可直接接 CI：\`STDKIT_HOME=... sh templates/ci/gate.sh origin/main\`。
逻辑 = 规则仓自检（\`ds check\`，仅当 \`STDKIT_HOME\` 有 \`rules/\`）+ \`ds scan --diff\`（行级）+ \`ds cross\`（仓级），
阻断级命中即非 0。\`--no-cross\` 跳过仓级检查，\`--help\` 看用法。

**\`STDKIT_HOME\` 指向源码仓（含 \`rules/\`）** 时才有自检那一步；指向本目录（dist 安装）时自动跳过，
\`scan\` 与 \`cross\` 照常。想把门禁跑全，就把 CI 的 checkout 指向源码仓。

## 冲突优先级

业务仓 \`AGENTS.md\`（L3） > \`skills/*/references/\` > \`policy/\` 默认值。
`;
}

function wrap(text, indent) {
  const pad = ' '.repeat(indent);
  const words = text.split(/(?<=，|。|；|、)/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + w).length > 96) {
      lines.push(cur);
      cur = w;
    } else cur += w;
  }
  if (cur) lines.push(cur);
  return lines.join('\n' + pad);
}

// ---------- 落盘与陈旧检测 ----------

export function writeDist(root = ROOT) {
  const files = buildFiles(root);
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  for (const [rel, content] of files) {
    const abs = path.join(root, 'dist', rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return files.size;
}

export function isDistStale(root = ROOT) {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) return { stale: true, reason: 'dist/ 不存在' };
  const fresh = buildFiles(root);
  const onDisk = new Map();
  for (const abs of walk(dist, () => true)) {
    onDisk.set(path.relative(dist, abs).split(path.sep).join('/'), readText(abs));
  }
  for (const [rel, content] of fresh) {
    if (!onDisk.has(rel)) return { stale: true, reason: `缺少 dist/${rel}` };
    if (onDisk.get(rel) !== content) return { stale: true, reason: `dist/${rel} 与规则不一致` };
  }
  for (const rel of onDisk.keys()) {
    if (!fresh.has(rel)) return { stale: true, reason: `dist/${rel} 是残留文件` };
  }
  return { stale: false };
}
