// check：仓内自检。结构性问题是 error（阻断），质量问题在 Java 侧是 warning。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, walk, readText, rel, readJSON, c, detectLayout } from './util.mjs';
import { parseRules, DOMAINS, LEVELS, SEVERITIES, STATUSES, BOOLEAN_META, NUMERIC_META, META_KEYS, codeFences, segments, compileRule } from './parse.mjs';
import { globToRegExp } from './scan.mjs';
import { isCatalogStale } from './catalog.mjs';
import { isDistStale, buildFiles, collectPromptRuleIds, REVIEWS, SKILLS } from './build.mjs';
import { CROSS_RULE_IDS } from './cross.mjs';
import { validateOverrides, listProfiles } from './policy.mjs';
import { listSemanticCases, validateSemanticCase } from './semantic.mjs';

// 条文声明「什么情况例外」却没落成机制时的提醒。
// `内部` / `不报` 太常见（Service 内部、边界陈述），不纳入，否则这条校验会被噪声淹掉。
export const EXCEPTION_WORDING =
  /例外|豁免|除[^，。；\n]{0,30}?外|(?:唯一|只)允许|不在管辖范围|由\s*L\d|可(?:省略|不加|不写)/;

// JDK9+ 构造清单只有一份：policy/jdk8-api.json。
// 这里派生「示例守卫」，J8-MOD-01 的 deny 由断言保持同步（同一份清单两端用）。
const J8_API = readJSON(path.join(ROOT, 'policy', 'jdk8-api.json'), { entries: [] });
const J8_ENTRIES = (J8_API.entries ?? []).filter((e) => e.guard !== false);
const J8_GUARD = J8_ENTRIES.map((e) => [new RegExp(e.pattern), e.hint]);

// 占位符：TBD/FIXME/XXX/__X__ 出现即报。
// TODO 只在行首才算「没处理完」——规则正文常拿 TODO(#1234) 当例子讲，不能一律拦（J8-CMT-02）。
const PLACEHOLDER = /\b(TBD|FIXME|XXX|__[A-Z_]+__)\b/;
const TODO_MARKER = /^\s*(?:[-*]\s*|\d+\.\s*)?TODO\b/m;

// 按「词法格式」分组而不是按扩展名：.vue 的 script 与 .js 同格式（同一正则有效），
// 而 java / yaml / properties 的字面量写法不同，必须各自有 BAD 样例。
const FORMAT_OF_EXT = {
  java: 'java',
  js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js',
  vue: 'sfc',
  xml: 'markup', html: 'markup',
  yml: 'yaml', yaml: 'yaml',
  properties: 'props', ini: 'props', txt: 'props',
  sql: 'sql',
  json: 'json',
};
const LANGS_OF_FORMAT = {
  java: ['java'],
  js: ['js', 'javascript', 'vue', 'ts', 'typescript', 'jsx', 'tsx'],
  sfc: ['vue', 'js', 'javascript', 'ts', 'typescript', 'css', 'scss', 'sass', 'less'],
  markup: ['xml', 'html'],
  yaml: ['yaml', 'yml'],
  props: ['properties', 'ini', 'txt'],
  sql: ['sql'],
  json: ['json'],
};

// 从 applies glob 取格式类别（例：**\/*.yml → yaml）
export function formatsOf(globs) {
  const out = new Set();
  for (const g of globs) {
    const m = g.match(/\.([A-Za-z0-9]+)$/);
    if (m) out.add(FORMAT_OF_EXT[m[1].toLowerCase()] ?? m[1].toLowerCase());
  }
  return [...out];
}

export function runCheck(root = ROOT) {
  // 三分判定（与 doctor、gate.sh 共用 detectLayout）：
  //   dist 安装 —— 没有 rules/，这里「规则 ↔ 产物」的断言全是反证，跑下去必成片假错误（实测 90+ 条），
  //                装 dist 的人应该用 scan / brief / cross
  //   不认识的目录 —— 走错目录了。跳过会让「rules/ 被误删」「sparse checkout 漏目录」都绿着通过，
  //                所以必须明确失败（exit 2），而不是伪装成「已检查」
  const layout = detectLayout(root);
  if (layout !== 'rules-repo') {
    return { layout, skipped: layout === 'dist-install', errors: [], warnings: [], ruleCount: 0, domains: [] };
  }

  const errors = [];
  const warnings = [];
  const err = (file, line, msg) => errors.push({ file, line, msg });
  const warn = (file, line, msg) => warnings.push({ file, line, msg });

  const files = walk(path.join(root, 'rules'), (p) => p.endsWith('.md'));
  const rules = parseRules(root);
  const ids = new Map();

  for (const file of files) {
    const f = rel(file);
    const domain = f.split('/')[1];
    const lines = readText(file).split(/\r?\n/);

    // 围栏必须成对，否则解析会吞掉后续内容
    const fences = lines.filter((l) => l.startsWith('```')).length;
    if (fences % 2 !== 0) err(f, 0, `代码围栏未闭合（共 ${fences} 个 \`\`\`）`);

    // rules/ 下的 ### 一律必须是规则标题
    lines.forEach((l, i) => {
      if (/^###\s/.test(l) && !/^###\s+[A-Z][A-Z0-9]*-[A-Z][A-Z0-9]*-\d{2}\s+\S/.test(l)) {
        err(f, i + 1, `### 标题缺少合法规则 ID：${l.trim()}`);
      }
    });

    if (!Object.prototype.hasOwnProperty.call(DOMAINS, domain)) {
      err(f, 0, `未知规则域 "${domain}"，需在 cli/lib/parse.mjs 的 DOMAINS 登记`);
    }
  }

  for (const r of rules) {
    const { id, file, line, meta, body } = r;
    const at = (msg) => err(file, line, `${id} ${msg}`);

    if (ids.has(id)) err(file, line, `${id} 重复（另见 ${ids.get(id)}）`);
    else ids.set(id, `${file}:${line}`);

    const prefix = DOMAINS[r.domain];
    if (prefix && !id.startsWith(prefix + '-')) at(`ID 前缀应为 ${prefix}-，与目录 rules/${r.domain}/ 一致`);

    if (!meta) {
      at('缺少 ```txt rule 元数据块');
      continue;
    }
    if (meta.__errors.length) at(`元数据块有不合法行：${meta.__errors.join(' | ')}`);
    for (const key of Object.keys(meta)) {
      if (key === '__errors') continue;
      if (!META_KEYS.includes(key)) at(`未知元数据键 "${key}"`);
    }
    if (!LEVELS.includes(meta.level)) at(`level 应为 ${LEVELS.join(' / ')}，实际 "${meta.level ?? ''}"`);
    if (!SEVERITIES.includes(meta.severity)) at(`severity 应为 ${SEVERITIES.join(' / ')}，实际 "${meta.severity ?? ''}"`);
    // 枚举值与布尔开关必须严格校验：以前 status: retird / raw: yes 这类拼错会被静默当默认值，
    // 于是「已退役的规则」照样参与扫描、「不剥注释」也从未生效（P2-1）。
    if (meta.status !== undefined && !STATUSES.includes(meta.status)) {
      at(`status 应为 ${STATUSES.join(' / ')}，实际 "${meta.status}"`);
    }
    for (const key of BOOLEAN_META) {
      if (meta[key] !== undefined && meta[key] !== 'true') at(`${key} 只能写 true，实际 "${meta[key]}"`);
    }
    // 数值元数据：写成 0 / -1 / "5 处" 会被静默忽略，等于规则没生效
    for (const key of NUMERIC_META) {
      if (meta[key] === undefined) continue;
      const n = Number(meta[key]);
      if (!Number.isInteger(n) || n < 1) at(`${key} 必须是正整数，实际 "${meta[key]}"`);
      else meta[key] = String(n);
    }
    if (meta.maxHits !== undefined && !meta.deny?.length) at('maxHits 只在有 deny 时有意义（没有正则就没有「命中次数」）');
    if (!meta.tags?.length) at('tags 不能为空');
    if (!meta.applies?.length) at('applies 不能为空');
    for (const [key, globs] of [['applies', meta.applies], ['exclude', meta.exclude]]) {
      for (const g of globs ?? []) {
        // 允许三种：带扩展名（**\/*.java）或无扩展名文件（Dockerfile 等）或目录形态（**\/src\/test\/**）
        const hasExt = /\.\w+$/.test(g);
        const dirLike = /\/\*\*$/.test(g);
        const namedFile = /(^|\/)(Dockerfile|Makefile|Jenkinsfile|Procfile|Vagrantfile|mvnw|gradlew)$/.test(g);
        if (!hasExt && !dirLike && !namedFile) at(`${key} 的 glob 既无扩展名也不是目录形态，也不在无扩展名白名单：${g}`);
        try {
          globToRegExp(g);
        } catch (e) {
          at(`${key} 的 glob 不可用：${g}（${e.message}）`);
        }
      }
    }
    if (!meta.p3c) at('p3c 必填，无对应手册条款写 -');
    for (const ref of meta.see ?? []) {
      if (ref === id) at(`see 引用了自己（${ref}）`);
      else if (!rules.some((x) => x.id === ref)) at(`see 引用了不存在的规则 ${ref}`);
    }

    if (!/\*\*规则\*\*/.test(body)) at('正文缺少 **规则** 段');
    if (!/\*\*为什么\*\*/.test(body)) warn(file, line, `${id} 正文缺少 **为什么** 段`);

    const ph = body.match(PLACEHOLDER);
    if (ph) err(file, line, `${id} 正文含占位符 "${ph[1]}"`);
    if (TODO_MARKER.test(body)) err(file, line, `${id} 正文含未处理的 TODO 标记（行首 TODO）`);

    // deny 必须能对上本规则自己的 BAD 样例，否则就是凭想象写的正则
    const segs = codeFences(body).flatMap((fence) => segments(fence.lines));
    const hasBad = segs.some((s) => s.kind === 'bad');
    if (meta.deny?.length && !hasBad) warn(file, line, `${id} 有 deny 正则但没有 // BAD 样例`);

    // allow 是 deny 的豁免通道：被 allow 命中的 GOOD 行不算误报
    const allowRes = (meta.allow ?? [])
      .map((src) => {
        try {
          return compileRule(src);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    for (const [key, wantBad] of [['deny', true], ['allow', false]]) {
      for (const source of meta[key] ?? []) {
        let re;
        try {
          re = compileRule(source);
        } catch (e) {
          err(file, line, `${id} ${key} 正则无法编译：${source}（${e.message}）——若正则需要字面分号请写 \\x3b`);
          continue;
        }
        const hitBad = segs.some((s) => s.kind === 'bad' && re.test(s.line));
        const hitGood = segs.some((s) => s.kind === 'good' && re.test(s.line));
        const hitGoodExempted = segs.some(
          (s) => s.kind === 'good' && re.test(s.line) && allowRes.some((a) => a.test(s.line)),
        );
        if (wantBad && hasBad && !hitBad) err(file, line, `${id} deny 正则未命中任何 // BAD 样例：${source}`);
        if (wantBad && hitGood && !hitGoodExempted)
          err(file, line, `${id} deny 正则误命中 // GOOD 样例（且未被 allow 豁免）：${source}`);
        if (!wantBad && !hitGood && segs.some((s) => s.kind === 'good')) {
          warn(file, line, `${id} allow 正则未命中任何 // GOOD 样例：${source}`);
        }
        // 结构性问题：嵌套量词 (x+)+ / (x*)* 会指数级回溯，运行期守卫对这类是盲的
        if (/\([^()]*[+*]\)[+*{]/.test(source)) {
          warn(file, line, `${id} ${key} 正则含嵌套量词，可能指数级回溯：${source}（把内层量词加上界，如 \\w{1,64}）`);
        }
        // 性能守卫：无界量词在超长单行上会 O(n²) 回溯（P1-1 曾让 200KB 单行跑到 30 秒）。
        // 探测串是全 `x` 的长行：只对「逐位回溯字母类」有效，对其他字符上的回溯（如 (a+)+b）盲。
        const longLine = 'x'.repeat(20000);
        const t0 = Date.now();
        re.test(longLine);
        const cost = Date.now() - t0;
        if (cost > 100)
          warn(file, line, `${id} ${key} 正则跑 2 万字符全 x 耗时 ${cost}ms，可能有回溯风险：${source}`);
      }
    }

    // 计数型规则：BAD 样例里的命中数必须超过上限，否则这条规则演示不出自己的违规
    if (meta.maxHits !== undefined && meta.deny?.length) {
      const max = Number(meta.maxHits);
      const compiled = meta.deny
        .map((src) => {
          try {
            return compileRule(src);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const badHits = segs.filter((x) => x.kind === 'bad' && compiled.some((re) => re.test(x.line))).length;
      if (badHits <= max) {
        err(file, line, `${id} maxHits: ${max}，但 // BAD 只命中 ${badHits} 处——样例本身演示不出「超过上限」`);
      }
    }

    // 声明了就要演示：applies 里每个词法格式都得有一条能命中 deny 的 BAD 样例。
    // 这条正是防「applies 写了 .yml，正则却只认带引号的 Java 字面量」。
    if (meta.deny?.length) {
      const compiled = (meta.deny ?? [])
        .map((src) => {
          try {
            return compileRule(src);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      for (const fmt of formatsOf(meta.applies ?? [])) {
        const langs = LANGS_OF_FORMAT[fmt] ?? [fmt];
        const fences = codeFences(body).filter((fence) => langs.includes(fence.lang));
        if (!fences.length) {
          err(file, line, `${id} applies 声明了 .${fmt} 格式，但正文没有 ${langs.join('/')} 语言的 BAD 样例`);
          continue;
        }
        const hitBad = fences.some((fence) =>
          segments(fence.lines).some((s) => s.kind === 'bad' && compiled.some((re) => re.test(s.line))),
        );
        if (!hitBad) err(file, line, `${id} 的 .${fmt} 格式 BAD 样例未命中任何 deny 正则`);
      }
    }

    // 条文里写了例外（「除 … 外」「只允许用于 …」）却没落成 exclude / allow。
    // 这类漂移让规则在自己的正例上开火，而正文读起来完全正确（N-1 / N-2 就是这么漏的）。
    if (meta.deny?.length && !meta.exclude?.length && !meta.allow?.length) {
      const m = body.match(EXCEPTION_WORDING);
      if (m) warn(file, line, `${id} 正文有例外措辞「${m[0]}」，但既无 exclude 也无 allow——确认是落成机制还是标「需人工确认」`);
    }

    // JDK8 语法越界：只查 java 围栏的 GOOD / plain 段
    if (r.domain === 'java-jdk8') {
      for (const fence of codeFences(body)) {
        if (!/^java/.test(fence.lang)) continue;
        for (const { kind, line: src } of segments(fence.lines)) {
          if (kind === 'bad') continue;
          for (const [re, hint] of J8_GUARD) {
            if (re.test(src)) err(file, line, `${id} 示例越界（JDK8 不可用）：${hint} → ${src.trim()}`);
          }
        }
      }
    }  }

  // prompt ↔ catalog 一致性：prompt 里的清单少一条，模型就永远不会审它，而且不报错。
  // 这是本轮加的「声明 vs 实现」第三道机判（前两道：applies 格式覆盖、references 齐备）。
  const generated = buildFiles(root);
  const activeRules = rules.filter((r) => r.status !== 'retired');
  // 仓级规则 ID 必须真实存在且 active（拼错了 cross 会静默少查一条）
  for (const id of CROSS_RULE_IDS) {
    const r = activeRules.find((x) => x.id === id);
    if (!r) err('cli/lib/cross.mjs', 0, `CROSS_RULE_IDS 里的 ${id} 在 catalog 中不存在`);
    else if (r.meta?.deny?.length) err('cli/lib/cross.mjs', 0, `${id} 既有 deny 又在 CROSS_RULE_IDS 里（会重复报）`);
  }

  // JDK9+ 清单两端同步：policy/jdk8-api.json（示例守卫）↔ J8-MOD-01.deny（业务代码）
  {
    const mod = rules.find((r) => r.id === 'J8-MOD-01');
    if (!mod) err('rules/java-jdk8/00-language.md', 0, '找不到 J8-MOD-01（JDK9+ 版本门禁）');
    else {
      const deny = (mod.meta?.deny ?? []).join('; ');
      for (const e of J8_ENTRIES.filter((x) => x.rule)) {
        if (!deny.includes(e.pattern)) {
          err('policy/jdk8-api.json', 0, `条目 "${e.id}" 已在清单里，但 J8-MOD-01 的 deny 没有它（业务代码不会被拦）`);
        }
      }
      const inJson = new Set(J8_ENTRIES.filter((x) => x.rule).map((x) => x.pattern));
      for (const src of mod.meta?.deny ?? []) {
        if (!inJson.has(src)) err('rules/java-jdk8/00-language.md', 0, `J8-MOD-01 的 deny "${src}" 不在 policy/jdk8-api.json 里（清单会漂）`);
      }
    }
  }

  // 域注册一致性：加新域实际要动 5 处，漏一处就「注册了域但没产物」或「产物指向空目录」
  for (const [domain, prefix] of Object.entries(DOMAINS)) {
    const skill = SKILLS.find((x) => x.domain === domain);
    if (!skill) err('cli/lib/build.mjs', 0, `域 ${domain}（${prefix}-）没有对应 skill：在 SKILLS 里加一项，否则规则不会出现在任何 skill 里`);
    if (!activeRules.some((r) => r.domain === domain)) {
      warn('rules/', 0, `域 ${domain} 没有任何 active 规则`);
    }
  }
  for (const skill of SKILLS) {
    if (!DOMAINS[skill.domain]) {
      err('cli/lib/build.mjs', 0, `SKILLS 里的 ${skill.name} 指向未注册的域 ${skill.domain}（先在 parse.mjs 的 DOMAINS 注册）`);
    }
    if (!fs.existsSync(path.join(root, 'rules', skill.domain))) {
      err('cli/lib/build.mjs', 0, `SKILLS 里的 ${skill.name} 指向不存在的目录 rules/${skill.domain}/`);
    }
  }

  for (const review of REVIEWS) {
    const rel = `prompts/${review.name}.md`;
    const md = generated.get(rel);
    if (!md) {
      err(rel, 0, `未生成 ${review.name}（检查 build.mjs 的 REVIEWS）`);
      continue;
    }
    const { machine, semantic, cross } = collectPromptRuleIds(md);
    const domainRules = activeRules.filter((r) => review.domains.includes(r.domain));
    const wantMachine = new Set(domainRules.filter((r) => r.meta?.deny?.length).map((r) => r.id));
    const wantCross = new Set(domainRules.filter((r) => CROSS_RULE_IDS.includes(r.id)).map((r) => r.id));
    const wantAll = new Map(domainRules.map((r) => [r.id, r]));

    // 仓级段落必须正好是该域的 CROSS_RULE_IDS（少一条 = 模型永远不跑那条命令）
    for (const id of wantCross) {
      if (!cross.some((x) => x.id === id)) err(rel, 0, `缺仓级规则 ${id}（应由 \`ds cross\` 判定）`);
    }
    for (const x of cross) {
      if (!wantCross.has(x.id)) err(rel, 0, `${x.id} 不应出现在仓级段（不属于该域或不在 CROSS_RULE_IDS）`);
    }
    for (const x of semantic) {
      if (CROSS_RULE_IDS.includes(x.id)) err(rel, 0, `${x.id} 由 ds cross 机判，不该进 B 类语义清单`);
    }

    const seen = new Set();
    for (const id of [...machine, ...semantic.map((x) => x.id), ...cross.map((x) => x.id)]) {
      if (seen.has(id)) err(rel, 0, `规则 ${id} 在 prompt 里出现多次`);
      seen.add(id);
    }
    for (const id of wantAll.keys()) {
      if (!seen.has(id)) err(rel, 0, `缺规则 ${id}（该域共 ${wantAll.size} 条，prompt 只列了 ${seen.size} 条）`);
    }
    for (const id of seen) {
      if (!wantAll.has(id)) err(rel, 0, `多出规则 ${id}（不属于 ${review.domains.join('/')}）`);
    }
    for (const id of machine) {
      if (!wantMachine.has(id)) err(rel, 0, `${id} 没有 deny 正则，不该出现在「可机械判定」里`);
    }
    for (const id of wantMachine) {
      if (!machine.includes(id)) err(rel, 0, `${id} 有 deny 正则，但没出现在「可机械判定」清单里`);
    }
    for (const item of semantic) {
      const rule = wantAll.get(item.id);
      if (rule && rule.meta?.deny?.length) err(rel, 0, `${item.id} 有 deny 正则，不该出现在语义清单里`);
      const want = rule?.meta?.severity;
      if (want && item.severity !== want) err(rel, 0, `${item.id} 的级别写成 ${item.severity}，catalog 是 ${want}`);
    }
  }

  // SKILL.md 的规则索引必须与 catalog 同条数、同 ID（少一条 = Agent 看不到那条规则）
  for (const skill of SKILLS) {
    const rel = `skills/${skill.name}/SKILL.md`;
    const md = generated.get(rel);
    if (!md) {
      err(rel, 0, `未生成 skill ${skill.name}`);
      continue;
    }
    const ids = new Set([...md.matchAll(/^\| \`([A-Z][A-Z0-9]*-[A-Z0-9]+-\d{2})\` \|/gm)].map((m) => m[1]));
    const want = activeRules.filter((r) => r.domain === skill.domain).map((r) => r.id);
    for (const id of want) if (!ids.has(id)) err(rel, 0, `规则索引缺 ${id}`);
    for (const id of ids) if (!want.includes(id)) err(rel, 0, `规则索引多出 ${id}`);
  }

  // README 的数字必须与 catalog / fixtures 一致（历史上漂过两次）
  // 命令数：与 ds.mjs 的 case 列表（去掉 help）比对
  {
    const dsSrcForCmds = readText(path.join(root, 'cli', 'ds.mjs'));
    const cmdCount = [...new Set([...dsSrcForCmds.matchAll(/case '([a-z][a-z-]*)':/g)].map((m) => m[1]))].filter((x) => x !== 'help').length;
    const declaredCmds = readmeCmdCount(readText(path.join(root, 'README.md')));
    if (declaredCmds !== null && declaredCmds !== cmdCount) {
      err('README.md', 0, `命令数写 ${declaredCmds}，cli/ds.mjs 实际 ${cmdCount} 个（不含 help）`);
    }
  }

  const readme = readText(path.join(root, 'README.md'));
  const num = (re) => {
    const m = readme.match(re);
    return m ? Number(m[1]) : null;
  };
  const declaredRules = num(/\*\*当前：(\d+) 条规则/);
  const declaredMachine = num(/其中 (\d+) 条可机器判定/);
  const declaredCases = num(/(\d+) 个回归用例/);
  const realMachine = activeRules.filter((r) => r.meta?.deny?.length).length;
  const realCases = fs.existsSync(path.join(root, 'evals', 'cases'))
    ? fs.readdirSync(path.join(root, 'evals', 'cases'), { withFileTypes: true }).filter((e) => e.isDirectory()).length
    : 0;
  if (declaredRules === null) warn('README.md', 0, '未找到「当前：N 条规则」数字行');
  else if (declaredRules !== activeRules.length) err('README.md', 0, `规则数写 ${declaredRules}，catalog 是 ${activeRules.length}`);
  if (declaredMachine !== null && declaredMachine !== realMachine) {
    err('README.md', 0, `可机判数写 ${declaredMachine}，实际 ${realMachine}`);
  }
  if (declaredCases !== null && declaredCases !== realCases) {
    err('README.md', 0, `回归用例数写 ${declaredCases}，evals/cases 下是 ${realCases}`);
  }

  // 著作权人三处一致：LICENSE 署名 / package.json author / provenance 声明
  {
    const lic = readText(path.join(root, 'LICENSE'));
    const pkg = readJSON(path.join(root, 'package.json'), {});
    const licHolder = (lic.match(/Copyright \(c\) \d{4} (.+)/) ?? [])[1]?.trim() ?? '';
    if (!licHolder) err('LICENSE', 0, '找不到 "Copyright (c) <年> <著作权人>" 行');
    else if (pkg.author && licHolder !== pkg.author) {
      err('LICENSE', 0, `署名 "${licHolder}" 与 package.json author "${pkg.author}" 不一致`);
    }
    const provPath = path.join(root, 'docs', 'provenance.md');
    if (fs.existsSync(provPath)) {
      const prov = readText(provPath);
      if (licHolder && !prov.includes(licHolder)) {
        err('docs/provenance.md', 0, `未声明著作权人 ${licHolder}`);
      }
      // 不要再出现「从某仓迁入」的表述：那会把授权问题引回来
      for (const bad of ['迁入', '迁移自', '取自旧仓']) {
        if (prov.includes(bad)) err('docs/provenance.md', 0, `出现"${bad}"表述；本仓条文声明为原创，不应留迁移措辞`);
      }
    }
  }

  // ADR：战略决策要可追溯，且每份都得有「状态 / 决策 / 后果」三节
  const adrDir = path.join(root, 'docs', 'adr');
  if (!fs.existsSync(adrDir)) err('docs/adr/', 0, '缺少 ADR 目录（战略决策要留档）');
  else {
    const adrs = fs.readdirSync(adrDir).filter((n) => /^\d{4}-.*\.md$/.test(n));
    if (!adrs.length) err('docs/adr/', 0, 'ADR 目录为空');
    for (const f of adrs) {
      const text = readText(path.join(adrDir, f));
      for (const sec of ['## 状态', '## 决策', '## 后果']) {
        if (!text.includes(sec)) err(`docs/adr/${f}`, 0, `缺少「${sec.replace('## ', '')}」一节`);
      }
    }
    const readme = readText(path.join(root, 'README.md'));
    if (!readme.includes('docs/adr/')) warn('README.md', 0, '文档索引里没指向 docs/adr/');
  }

  {
    const archPath = path.join(root, 'docs', 'architecture.md');
    if (fs.existsSync(archPath)) {
      const arch = readText(archPath);
      const cmds = [...arch.matchAll(/ds ([a-z][a-z-]*)/g)].map((m) => m[1]);
      const known = new Set(['scan', 'cross', 'brief', 'check', 'eval', 'build', 'catalog', 'rules', 'init', 'doctor', 'baseline', 'install', 'publish-check', 'version', 'help']);
      for (const c of new Set(cmds)) {
        if (!known.has(c)) err('docs/architecture.md', 0, `提到的 \`ds ${c}\` 不是有效子命令（文档漂移）`);
      }
    }
  }

  // 文档与实现一致：命令表漏一个命令 / limits 里写了不存在的规则 ID，都会误导读者
  const dsSrc = readText(path.join(root, 'cli', 'ds.mjs'));
  const cmds = [...dsSrc.matchAll(/case '([a-z][a-z-]*)':/g)].map((m) => m[1]).filter((c) => c !== 'help');
  const cmdDoc = path.join(root, 'docs', 'commands.md');
  if (!fs.existsSync(cmdDoc)) err('docs/commands.md', 0, '缺少命令手册');
  else {
    const doc = readText(cmdDoc);
    for (const cmd of new Set(cmds)) {
      if (!doc.includes(`\`${cmd}\``)) err('docs/commands.md', 0, `缺少命令 \`${cmd}\` 的说明（cli/ds.mjs 里有这个子命令）`);
    }
    // 逃生开关最容易只在代码里存在：--no-mask / --no-cross 这类用户真会查的，手册必须有
    const helpStart = dsSrc.indexOf('const HELP = `');
    const helpText = helpStart >= 0 ? dsSrc.slice(helpStart, dsSrc.indexOf('\n`;', helpStart)) : '';
    for (const m of helpText.matchAll(/--[a-z][a-z-]*/g)) {
      if (!doc.includes(m[0])) err('docs/commands.md', 0, `缺少参数 \`${m[0]}\` 的说明（ds help 里出现了）`);
    }
  }
  const limitsDoc = path.join(root, 'docs', 'limits.md');
  if (!fs.existsSync(limitsDoc)) err('docs/limits.md', 0, '缺少已知限制说明（对外承诺必须写）');
  else {
    const text = readText(limitsDoc);
    const known = new Set(rules.map((r) => r.id));
    for (const m of text.matchAll(/\b([A-Z][A-Z0-9]*-[A-Z0-9]+-\d{2})\b/g)) {
      if (!known.has(m[1])) err('docs/limits.md', 0, `提到了不存在的规则 ${m[1]}（ID 漂移会让文档指向空气）`);
    }
  }

  // 开源就绪：license 与 LICENSE 文件一致；规则来源声明不能被误删
  const pkg = readJSON(path.join(root, 'package.json'), {});
  const licensePath = path.join(root, 'LICENSE');
  if (!fs.existsSync(licensePath)) {
    err('LICENSE', 0, '缺少 LICENSE 文件（开源仓必须有；内部使用也要写明）');
  } else {
    const text = readText(licensePath);
    const declared = pkg.license ?? 'UNLICENSED';
    if (declared === 'UNLICENSED' && !/内部|internal|proprietary/i.test(text)) {
      err('LICENSE', 0, 'package.json 声明 UNLICENSED，但 LICENSE 正文没写「内部使用」');
    }
    if (declared === 'MIT' && !/MIT License/i.test(text)) {
      err('LICENSE', 0, `package.json 写 MIT，但 LICENSE 正文不是 MIT`);
    }
    if (declared !== 'UNLICENSED' && declared !== 'MIT' && !/Apache License/i.test(text)) {
      warn('LICENSE', 0, `package.json 声明 ${declared}，LICENSE 正文未识别`);
    }
  }
  const provPath = path.join(root, 'docs', 'provenance.md');
  if (!fs.existsSync(provPath)) err('docs/provenance.md', 0, '缺少规则来源声明');
  else if (!/阿里巴巴/.test(readText(provPath))) warn('docs/provenance.md', 0, '未提到手册来源（p3c 对账方式）');

  // publish.json 的 historyAllow：逐条枚举的豁免必须真的生效，否则就是「写了但不起作用」
  {
    const pubPath = path.join(root, 'policy', 'publish.json');
    const repoFiles = walk(root, () => true).map((f) => rel(f));
    if (fs.existsSync(pubPath)) {
      const pub = readJSON(pubPath, null);
      if (!pub) err('policy/publish.json', 0, 'JSON 解析失败');
      else {
        const ids = new Set((pub.forbidden ?? []).map((f) => f.id));
        for (const [i, x] of (pub.historyAllow ?? []).entries()) {
          const at = (m) => err('policy/publish.json', 0, `historyAllow[${i}]：${m}`);
          if (!x || typeof x !== 'object') {
            at('必须是对象 { id, path, reason }');
            continue;
          }
          if (!ids.has(x.id)) at(`id "${x.id}" 不在 forbidden 里（写错就是静默不生效）`);
          if (!x.path) at('缺少 path（glob，如 "CHANGELOG.md" / "docs/**"）');
          else if (x.path === '**' || x.path === '**/*') at(`path "${x.path}" 是全域放行——要么逐条列，要么把 pattern 删掉`);
          else if (/^\//.test(x.path) || x.path.includes('..') || x.path.includes('\\')) {
            at(`path 必须是仓内相对路径（不能以 / 开头、不能含 .. 或反斜杠）：${x.path}`);
          } else {
            // 拼错的 glob 照样能编译（[ 会被转义），所以真正能拦住 typo 的判据是：
            // 「这个 glob 在仓里至少配到一个真实文件」——否则它就是永远不会命中的空气条目
            let re;
            try {
              re = globToRegExp(x.path);
            } catch (e) {
              at(`path glob 不可用：${x.path}（${e.message}）`);
            }
            if (re && !repoFiles.some((f) => re.test(f))) {
              at(`path "${x.path}" 在仓里一个文件都配不到（拼错或已过期），它永远不会生效`);
            }
          }
          const reason = typeof x.reason === 'string' ? x.reason.trim() : '';
          if (reason.length < 8) at(`reason 太短（"${reason}"）：不接受「历史原因」「一直在」这类没有信息量的理由`);
        }
      }
    }
  }

  // policy 单条覆盖：ID 必须存在且 active，取值必须合法
  const policyFiles = ['default.json', ...listProfiles(root).map((n) => `profiles/${n}.json`)];
  for (const rel of policyFiles) {
    const file = path.join(root, 'policy', rel);
    if (!fs.existsSync(file)) continue;
    const pol = readJSON(file, null);
    if (!pol) {
      err(`policy/${rel}`, 0, 'JSON 解析失败');
      continue;
    }
    const { errors: oErr, warnings: oWarn } = validateOverrides(pol, rules);
    for (const m of oErr) err(`policy/${rel}`, 0, m);
    for (const m of oWarn) warn(`policy/${rel}`, 0, m);
  }

  // BOM：readText 会剥掉，所以本仓自己读不炸；但 jq / 其它语言 / 编辑器会把它当内容。
  // 一份 JSON 只要被外部工具读过一次，BOM 就是实打实的兼容问题。
  for (const file of [...walk(root, (p) => /\.json$/.test(p)), ...walk(path.join(root, 'dist'), (p) => /\.json$/.test(p))]) {
    const head = fs.readFileSync(file, 'latin1').slice(0, 3);
    if (head === '\u00ef\u00bb\u00bf') err(rel(file), 0, 'JSON 文件带 UTF-8 BOM（去掉；外部工具会解析失败）');
  }
  for (const name of ['README.md', 'AGENTS.md', 'CHANGELOG.md']) {
    const file = path.join(root, name);
    if (fs.existsSync(file) && fs.readFileSync(file, 'latin1').slice(0, 3) === '\u00ef\u00bb\u00bf') {
      err(name, 0, 'Markdown 文件带 UTF-8 BOM');
    }
  }

  // 仓根白名单：根目录出现陌生文件本身就是信号（上一轮的两个工作产物就是长在这里的）。
  // 只 warning 不阻断——lockfile 之类合法新增不该被拦。
  for (const stray of rootStrayFiles(root)) {
    warn(stray, 0, '仓根出现白名单外的文件/目录；临时脚本放 .tmp/（已忽略）或仓外，确认要留的加进 check 的白名单');
  }

  // 语义层用例：结构要在，且 mustReport 必须是「没有 deny 的规则」——有 deny 就该进 evals/cases
  for (const name of listSemanticCases(root)) {
    const { errors: sErr, warnings: sWarn } = validateSemanticCase(root, name);
    for (const m of sErr) err(`evals/semantic/${name}`, 0, m);
    for (const m of sWarn) warn(`evals/semantic/${name}`, 0, m);
  }

  // catalog 与规则必须同步
  const { stale, fresh } = isCatalogStale(root);
  if (stale) {
    errors.push({
      file: 'catalog/rules.json',
      line: 0,
      msg: `索引与规则不一致（当前应有 ${fresh.rules.length} 条），执行 node cli/ds.mjs catalog`,
    });
  }

  // dist 必须与规则同步
  const dist = isDistStale(root);
  if (dist.stale) {
    errors.push({
      file: 'dist/',
      line: 0,
      msg: `产物与规则不一致（${dist.reason}），执行 node cli/ds.mjs build`,
    });
  }

  // 版本与 CHANGELOG 首条一致（CHANGELOG 缺失时只告警，不用 ENOENT 栈吓人）
  const version = readJSON(path.join(root, 'package.json'), {})?.version;
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const changelog = fs.existsSync(changelogPath)
    ? readText(changelogPath)
        .split(/\r?\n/)
        .find((l) => /^##\s/.test(l))
    : null;
  if (!changelog) warn('CHANGELOG.md', 0, '缺失或没有任何版本条目');
  else if (version && !changelog.includes(version)) {
    warn('CHANGELOG.md', 0, `首个版本条目与 package.json version=${version} 不一致：${changelog.trim()}`);
  }

  return { errors, warnings, ruleCount: rules.length, domains: [...new Set(rules.map((r) => r.domain))] };
}

/** 仓根白名单：规范工具仓的根目录应当只有这些，别的都是信号。 */
export const ROOT_ALLOW_FILES = new Set([
  'AGENTS.md', 'CHANGELOG.md', 'README.md', 'LICENSE', 'LICENSE.md', 'NOTICE',
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'install.sh', 'install.ps1', '.gitattributes', '.gitignore', '.npmignore',
  '.editorconfig', '.gitmodules', '.npmrc',
]);
export const ROOT_ALLOW_DIRS = new Set([
  'rules', 'policy', 'catalog', 'dist', 'cli', 'docs', 'evals', 'templates', 'extensions',
  'scripts', 'test', 'tests', '.github', '.git', '.tmp', '.idea', '.vscode', 'node_modules',
]);

/** 返回仓根里不在白名单内的条目（相对名，已排序）。watch 只看一层。 */
export function rootStrayFiles(root = ROOT) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => (e.isDirectory() ? !ROOT_ALLOW_DIRS.has(e.name) : !ROOT_ALLOW_FILES.has(e.name)))
    .map((e) => e.name)
    .sort();
}

/** README 里「N 个命令」的 N（docs 表格里的那个）。 */
function readmeCmdCount(readme) {
  const m = readme.match(/docs\/commands\.md\) \| (\d+) 个命令/);
  return m ? Number(m[1]) : null;
}

export function printCheck(result) {
  if (result.layout === 'unknown') {
    console.log(c.bold('stdkit check') + c.red('  不是规则仓') + c.dim('  这个目录既没有 rules/，也没有 catalog/rules.json + cli/ds.mjs'));
    console.log(c.dim('  规则仓自检要在源码仓根跑；检查业务仓用 ds scan / brief / cross。'));
    return 2;
  }
  if (result.skipped) {
    // 退出码 0：gate.sh 带 set -eu，这里非 0 会让业务仓所有 PR 被拦，而真实原因与业务仓无关
    console.log(c.bold('stdkit check') + c.yellow('  跳过') + c.dim('  本目录没有 rules/，是 dist/ 安装而不是规则仓'));
    console.log(c.dim('  自检只在源码仓可用；日常检查用 ds scan / brief / cross，装客户端用 ds install。'));
    return 0;
  }
  const { errors, warnings, ruleCount, domains } = result;
  console.log(c.bold(`stdkit check`) + c.dim(`  ${ruleCount} 条规则 / ${domains.length} 域`));
  for (const e of errors) console.log(`${c.red('E')} ${c.dim(loc(e))} ${e.msg}`);
  for (const w of warnings) console.log(`${c.yellow('W')} ${c.dim(loc(w))} ${w.msg}`);
  const tail = `${errors.length} error, ${warnings.length} warning`;
  console.log(errors.length ? c.red(tail) : warnings.length ? c.yellow(tail) : c.green(tail));
  return errors.length === 0 ? 0 : 1;
}

const loc = (x) => (x.line ? `${x.file}:${x.line}` : x.file);
