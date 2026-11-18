// scan：确定性检查层。把规则里的 deny / allow 正则在本机跑完，产出精确行号，零 token。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readText } from './util.mjs';
import { compileRule } from './parse.mjs';
import { effectiveSeverity } from './policy.mjs';
import { maskText } from './mask.mjs';

// 全层级都跳过：版本库元数据、依赖目录、虚拟环境——它们不可能是业务代码。
const SKIP_ALWAYS = new Set([
  '.git', '.svn', '.hg', '.idea', '.vscode', 'node_modules', '__pycache__', '.venv', 'venv', '.tox', '.cache', '.tmp',
]);

// 构建产物目录：**只当它出现在项目根（同级有 pom.xml / package.json 等）时才跳**。
// 按名字无条件跳会误伤 `com.x.log`、`com.x.build` 这类包名（P1-2）。
const SKIP_BUILD = new Set(['target', 'build', 'out', 'dist', 'coverage', 'logs', 'vendor', '.gradle']);
const PROJECT_MARKERS = [
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
  'package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml',
];

function isProjectRoot(dir) {
  return PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
}

/** glob → RegExp。支持 ** / * / ?，其余按字面量。大小写不敏感（`.VUE` 也算 vue）。 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

export const GIT = resolveGit();

function resolveGit() {
  if (process.env.DS_GIT) return process.env.DS_GIT;
  if (process.platform === 'win32') {
    // 按「装的人最多」的顺序探：Program Files → 环境变量里的自定义盘符 → PATH
    const roots = [
      'C:/Program Files/Git/bin/git.exe',
      'C:/Program Files (x86)/Git/bin/git.exe',
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git/bin/git.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git/bin/git.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs/Git/bin/git.exe'),
    ].filter(Boolean);
    for (const p of roots) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        // 非法盘符之类的路径直接跳过
      }
    }
  }
  return 'git';
}

function git(target, args) {
  // stdio 必须显式 pipe：execFileSync 默认把**子进程 stderr 透传**到父进程，
  // 于是「扫一个非 git 目录」会往 stderr 打一行 git fatal（--json 的调用方若把
  // stderr 一并读进缓冲区，机器可读输出就被这行污染了）。
  return execFileSync(GIT, ['-C', target, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 把 execFileSync 的失败信息拼成一条：message + git 自己写在 stderr 的话。 */
export function gitErr(e) {
  const err = typeof e?.stderr === 'string' ? e.stderr.trim().split(/\r?\n/)[0] : '';
  return err ? `${e.message}（${err}）` : String(e?.message ?? e);
}

/** git 输出里的路径可能被引号包裹（含空格等特殊字符时）。 */
export function parseGitPath(s) {
  const t = s.trim();
  if (!t.startsWith('"')) return t;
  return t.slice(1, -1).replace(/\\(["\\])/g, '$1');
}

/** 本次变更：{ 文件绝对路径 → Set<行号> | null }（null = 整文件） */
export function changedLines(target, ref = 'HEAD') {
  const map = new Map();
  let diff = '';
  try {
    diff = git(target, ['diff', '-U0', '--no-color', ref]);
  } catch (e) {
    // 「没装」和「装了但不在 PATH」的下一步不一样，别混成一句话
    if (e.code === 'ENOENT') {
      throw new Error(`没找到 git（尝试的是 ${GIT}）：装 Git，或设 DS_GIT 指向可执行文件`);
    }
    throw new Error(`git diff 失败（可用 DS_GIT 指定 git 路径）：${gitErr(e)}`);
  }
  let cur = null;
  for (const line of diff.split(/\r?\n/)) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) {
      cur = path.resolve(target, parseGitPath(f[1]));
      if (!map.has(cur)) map.set(cur, new Set());
      continue;
    }
    const h = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (h && cur) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      for (let n = start; n < start + count; n++) map.get(cur).add(n);
    }
  }
  // 未跟踪文件按整文件算。用 ls-files 而不是 status，避免「新目录」只输出目录本身。
  try {
    for (const rel of git(target, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/)) {
      if (!rel.trim()) continue;
      const p = path.resolve(target, parseGitPath(rel));
      if (fs.existsSync(p) && fs.statSync(p).isFile()) map.set(p, null);
    }
  } catch {
    /* 非 git 仓：忽略 */
  }
  return map;
}

/** 测试 fixture 目录：`<x>/evals/cases/` 这种结构是故意写坏的样例，不算违规。 */
function isFixtureDir(p) {
  return fs.existsSync(path.join(p, 'cases'));
}

/**
 * 路径级跳过判定（git 列表与目录遍历共用）：
 * 通用目录任意层级跳；构建目录只在项目根跳；带 cases/ 的 evals/ 是 fixture。
 */
export function skipByPath(abs, base) {
  const segs = path.relative(base, abs).split(path.sep);
  for (let i = 0; i < segs.length - 1; i++) {
    const self = path.join(base, ...segs.slice(0, i + 1));
    const parent = path.join(base, ...segs.slice(0, i));
    if (SKIP_ALWAYS.has(segs[i])) return true;
    // 构建目录看**父目录**是不是项目根（与 walkFiles 同一判定；看自己永远判不中）
    if (SKIP_BUILD.has(segs[i]) && isProjectRoot(parent)) return true;
    if (segs[i] === 'evals' && isFixtureDir(self)) return true;
  }
  return false;
}

/** 非 git 仓的退路：按目录名跳过（构建目录只在项目根跳过）。 */
function walkFiles(target) {
  const out = [];
  const stack = [target];
  while (stack.length) {
    const dir = stack.pop();
    const moduleRoot = isProjectRoot(dir);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_ALWAYS.has(e.name)) continue;
      if (SKIP_BUILD.has(e.name) && moduleRoot) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'evals' && isFixtureDir(p)) continue;
        stack.push(p);
      } else out.push(p);
    }
  }
  return out;
}

/**
 * git 仓里用 `ls-files` 而不是自己走目录：
 * 它会自动排除 `.gitignore` 里的东西（生成物、本地缓存），比我们手维护跳过名单靠谱。
 * 失败（非 git 仓 / 无 git）返回 null，交回 walkFiles。
 */
function gitFiles(target) {
  try {
    const raw = git(target, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.']);
    return raw
      .split('\0')
      .filter(Boolean)
      .map((rel) => path.resolve(target, rel))
      .filter((p) => !skipByPath(p, target))
      .filter((p) => {
        try {
          return fs.statSync(p).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return null;
  }
}

export function listFiles(target) {
  const abs = path.resolve(target);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    throw new Error(`路径不存在：${target}`);
  }
  if (st.isFile()) return [abs];
  if (!st.isDirectory()) throw new Error(`不是普通文件也不是目录：${target}`);
  return gitFiles(abs) ?? walkFiles(abs);
}

/** target 是否可以当文件扫（不抛错）。 */
export function isFileTarget(target) {
  try {
    return fs.statSync(path.resolve(target)).isFile();
  } catch {
    return false;
  }
}

// ---------- 注释剥离 ----------
// 目的：注释里的示例代码不该被判违规。字符串内容默认保留（很多规则要看字符串里的 SQL）。

const C_LIKE = /\.(java|js|jsx|ts|tsx|kt|scala|mjs|cjs)$/i;
const SFC = /\.vue$/i;

/**
 * 标记语言（xml / html / md）注释剥离。
 *
 * 两件事必须同时成立：
 *   1. `<!--` 与 `-->` 常分处两行 → 需要状态；
 *   2. `<!--` 可能出现在字符串或 CDATA 里（`const t = "<!-- x"`、`<![CDATA[ a <!-- b ]]>`），
 *      不能当成注释开始，否则**文件剩余部分会被整段剥掉**，后半段对全部规则静默失效。
 * 所以这里跳过引号内内容与 CDATA 段：CDATA 里的 SQL 仍要参与匹配，只是不当注释。
 */
function stripHtmlComments(line, state = {}) {
  state.inHtml ??= false;
  state.inCdata ??= false;
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (state.inHtml) {
      const end = line.indexOf('-->', i);
      if (end < 0) return out;
      i = end + 3;
      state.inHtml = false;
      continue;
    }
    if (state.inCdata) {
      const end = line.indexOf(']]>', i);
      if (end < 0) {
        out += line.slice(i);
        break;
      }
      out += line.slice(i, end + 3);
      i = end + 3;
      state.inCdata = false;
      continue;
    }
    if (line.startsWith('<![CDATA[', i)) {
      state.inCdata = true;
      out += '<![CDATA[';
      i += 9;
      continue;
    }
    if (line.startsWith('<!--', i)) {
      state.inHtml = true;
      i += 4;
      continue;
    }
    const ch = line[i];
    if (ch === '"' || ch === "'") {
      const end = line.indexOf(ch, i + 1);
      if (end < 0) {
        out += line.slice(i);
        break;
      }
      out += line.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** CSS 只有 /* *\/ 注释，不能套 C 系的 `//`（`url(http://x)` 会被误切）。 */
function stripCssLine(line, state) {
  let out = '';
  let i = 0;
  if (state.inBlock) {
    const end = line.indexOf('*/');
    if (end < 0) return '';
    i = end + 2;
    state.inBlock = false;
  }
  while (i < line.length) {
    if (line[i] === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end < 0) {
        state.inBlock = true;
        break;
      }
      i = end + 2;
      continue;
    }
    out += line[i++];
  }
  return out;
}

/**
 * .vue 按块剥离：只在 <template>（以及块外）把 `<!-- -->` 当注释，
 * <script> 走 C 系、<style> 走 CSS。这样 script 里写 `"<!--"` 的字符串
 * 不会把后面整个文件吞掉。
 */
/** 这段文本结束时是否处在未闭合的引号里（用于判断 `<!--` 是否在属性值内）。 */
function endsInsideQuote(text) {
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
  }
  return q !== null;
}

/** 找第一个「不在引号里」的 `<!--`。`<div :title="'<!--'" />` 里的不算注释。 */
function findCommentStart(text) {
  let from = 0;
  for (;;) {
    const at = text.indexOf('<!--', from);
    if (at < 0) return -1;
    if (!endsInsideQuote(text.slice(0, at))) return at;
    from = at + 4;
  }
}

const SFC_BLOCK_TAG = /<(\/?)(template|script|style)\b/gi;

/**
 * 在文本里找下一个真的块标签。
 * script / style 体内只认自己这个块的闭合标签——JS 字符串里写 `<template>` 不该切换块。
 */
function findBlockTag(text, block) {
  SFC_BLOCK_TAG.lastIndex = 0;
  let m;
  while ((m = SFC_BLOCK_TAG.exec(text))) {
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if ((block === 'script' || block === 'style') && !(closing && name === block)) continue;
    return { index: m.index, closing, name };
  }
  return null;
}

/**
 * 一行 .vue 的剥离。state 由调用方跨行持有。
 *
 * 语义（三条边界都固定下来，别再打补丁）：
 *   1. markup 上下文（<template> 与块外）——剥 HTML 注释与 CDATA，引号内的 `<!--` 不算注释；
 *   2. <script> 走 C 系（行注释与块注释，字符串保留），<style> 只认 CSS 块注释；
 *   3. 注释正文里出现的任何标签（`</template>`、`<script setup>`）都只是文本，不会结束注释。
 *
 * repair=true 只在「这个文件有未闭合注释」时启用：允许注释在**行首**的块闭合标签处收手，
 * 否则写坏的文件会让后半段对全部规则静默失效。正常文件永远不会走到这里。
 */
function vueLine(state, line, repair) {
  let out = '';
  let rest = line;

  for (;;) {
    // 上一行留下的跨行注释
    if (state.html.inHtml) {
      const end = rest.indexOf('-->');
      const tagAt = repair ? rest.search(/^\s*<\/(?:template|script|style)\b/i) : -1;
      if (tagAt >= 0 && (end < 0 || tagAt < end)) {
        state.html.inHtml = false; // 坏文件：注释到块边界为止
        continue;
      }
      if (end < 0) return out;
      rest = rest.slice(end + 3);
      state.html.inHtml = false;
      continue;
    }
    if (!rest.length) return out;

    const block = state.block;
    const strip = (text) =>
      block === 'script' ? stripCLine(text, state.c) : block === 'style' ? stripCssLine(text, state.css) : stripHtmlComments(text, state.html);

    const tag = findBlockTag(rest, block);
    const commentAt = block === 'script' || block === 'style' ? -1 : findCommentStart(rest);

    if (commentAt >= 0 && (!tag || commentAt < tag.index)) {
      out += strip(rest.slice(0, commentAt));
      const end = rest.indexOf('-->', commentAt + 4);
      if (end < 0) {
        state.html.inHtml = true;
        return out;
      }
      rest = rest.slice(end + 3);
      continue;
    }
    if (!tag) {
      out += strip(rest);
      return out;
    }
    out += strip(rest.slice(0, tag.index));
    const gt = rest.indexOf('>', tag.index);
    if (gt < 0) {
      out += rest.slice(tag.index);
      return out;
    }
    out += rest.slice(tag.index, gt + 1);
    rest = rest.slice(gt + 1);
    state.block = tag.closing ? null : tag.name;
  }
}

function makeVueStripper() {
  const state = { block: null, html: {}, c: { inBlock: false }, css: { inBlock: false } };
  return (line) => vueLine(state, line, false);
}

/**
 * 按文件剥离（runScan / scanText 用）：.vue 先按正常语义跑一遍，
 * 只有「跑完仍在注释里」才用 repair 重跑一次。正常文件只跑一遍，行为与流式一致。
 */
export function stripLines(file, lines) {
  if (!SFC.test(file)) {
    const strip = makeStripper(file);
    return lines.map((l) => strip(l));
  }
  const run = (repair) => {
    const state = { block: null, html: {}, c: { inBlock: false }, css: { inBlock: false } };
    const out = lines.map((l) => vueLine(state, l, repair));
    return { out, unclosed: !!state.html.inHtml };
  };
  const first = run(false);
  return first.unclosed ? run(true).out : first.out;
}

function stripCLine(line, state) {
  let out = '';
  let i = 0;
  if (state.inBlock) {
    const end = line.indexOf('*/');
    if (end < 0) return '';
    i = end + 2;
    state.inBlock = false;
  }
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      out += ch;
      i++;
      while (i < line.length) {
        if (line[i] === '\\') {
          out += line[i] + (line[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += line[i];
        if (line[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end < 0) {
        state.inBlock = true;
        break;
      }
      i = end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function stripSqlLine(line, state) {
  let out = '';
  let i = 0;
  if (state.inBlock) {
    const end = line.indexOf('*/');
    if (end < 0) return '';
    i = end + 2;
    state.inBlock = false;
  }
  while (i < line.length) {
    if (line[i] === "'") {
      out += line[i++];
      while (i < line.length) {
        out += line[i];
        if (line[i] === "'" && line[i + 1] === "'") {
          out += line[++i];
          i++;
          continue;
        }
        if (line[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (line[i] === '-' && line[i + 1] === '-') break;
    if (line[i] === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end < 0) {
        state.inBlock = true;
        break;
      }
      i = end + 2;
      continue;
    }
    out += line[i++];
  }
  return out;
}

/** yaml / properties：`#`（或 `!`）注释必须在行首或空白之后，避免切掉值里的 `#`。 */
function stripHashComment(line, marks) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (marks.includes(ch) && (i === 0 || /\s/.test(line[i - 1]))) break;
    out += ch;
  }
  return out;
}

/** 按扩展名选剥离策略；返回去除注释后的文本（字符串内容保留）。 */
export function makeStripper(file) {
  const state = { inBlock: false };
  if (/\.sql$/i.test(file)) return (line) => stripSqlLine(line, state);
  if (/\.(xml|html|md)$/i.test(file)) return (line) => stripHtmlComments(line, state);
  if (SFC.test(file)) return makeVueStripper();
  if (/\.(yml|yaml)$/i.test(file)) return (line) => stripHashComment(line, '#');
  if (/\.(properties|ini)$/i.test(file)) return (line) => stripHashComment(line, '#!');
  if (C_LIKE.test(file)) return (line) => stripCLine(line, state);
  return (line) => line;
}

/** 把字符串字面量的内容抹空（保留引号），用于「不要在字符串里匹配」的规则。 */
export function stripStringContents(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      out += q;
      i++;
      while (i < line.length) {
        if (line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line[i] === q) {
          i++;
          break;
        }
        i++;
      }
      out += q;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// ---------- 扫描 ----------

/** 编译规则（deny/allow/globs），供 runScan 与 scanText 共用。 */
export function compileRules(catalog, { domain, severity, policy } = {}) {
  const rules = catalog.rules.filter(
    (r) => r.status !== 'retired' && r.deny.length > 0 && (!domain || r.domain === domain),
  );
  return rules.map((r) => ({
    rule: r,
    // 生效级：业务仓可以在 policy 里单条覆盖（降级），运行时按它判阻断
    sev: effectiveSeverity(r, policy),
    globs: r.applies.map(globToRegExp),
    excludes: (r.exclude ?? []).map(globToRegExp),
    deny: r.deny.map((s) => compileRule(s)),
    allow: r.allow.map((s) => compileRule(s)),
  }));
}

/** 单行匹配核心：runScan 与写前护栏共用这一份语义。 */
/**
 * @param {{mask?: boolean}} [opts] mask=true 时把命中片段里的凭证值掩掉（默认开）
 */
export function matchLine(compiled, relPath, rawLine, lineNo, waivers, stripped, opts = {}) {
  const out = [];
  if (!rawLine.trim()) return out;
  for (const c of compiled) {
    if (!c.globs.some((g) => g.test(relPath))) continue;
    if (c.excludes.some((g) => g.test(relPath))) continue;
    // 剥离结果由调用方按行算一次传进来：有状态剥离器（.vue 切块）若每条规则各调一次，
    // 同一行的结果会取决于规则顺序。传了 stripped 就复用它，没传才自己剥（兼容外部调用）。
    let probe = c.rule.raw ? rawLine : (stripped ?? (c.stripper ? c.stripper(rawLine) : rawLine));
    if (c.rule.noString) probe = stripStringContents(probe);
    if (!probe.trim()) continue;
    if (c.allow.some((re) => re.test(probe))) continue;
    for (const re of c.deny) {
      if (!re.test(probe)) continue;
      const found = {
        ruleId: c.rule.id,
        severity: c.sev ?? c.rule.severity,
        level: c.rule.level,
        file: relPath,
        line: lineNo,
        text: (opts.mask === false ? rawLine.trim() : maskText(rawLine.trim())).slice(0, 200),
        title: c.rule.title,
        rule: `${c.rule.file}:${c.rule.line}`,
      };
      const w = matchWaiver(waivers, found);
      out.push({ found, waiver: w });
      break;
    }
  }
  return out;
}

/**
 * 计数型规则的收口（`maxHits`）：同一文件里某规则命中超过上限时，**只保留越线那一处**。
 *
 * 为什么要它：有些规范说的是「数量」而不是「形态」——「一个页面里出现 5 个以上原始请求就抽到
 * api/」「一个组件里 3 处以上内联样式」这类，单行正则能判，但判据是次数。以前只能留给模型，
 * 现在规则写 `maxHits: 4` 就是「允许 4 处，第 5 处起报」。
 *
 * 只报越线那一处（而不是把第 5、6、7 处全报一遍）：一条已经说明问题的命中，重复刷没有信息量。
 */
export function capByMaxHits(findings, compiled) {
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, []);
    byRule.get(f.ruleId).push(f);
  }
  const out = [];
  for (const [ruleId, list] of byRule) {
    const c = compiled.find((x) => x.rule.id === ruleId);
    const max = Number(c?.rule?.maxHits);
    if (!Number.isFinite(max)) {
      // 普通规则：每一处命中都算
      out.push(...list);
      continue;
    }
    // 计数型规则：**没超过上限就不算违规**（这是与普通规则最大的区别）；超了只报越线那一处
    if (list.length <= max) continue;
    const over = list[max];
    out.push({ ...over, text: `${over.text}   ← 本文件第 ${max + 1} 处（上限 ${max}）` });
  }
  return out;
}

/** 内存文本扫描：给 pi 写前护栏用，避免第二套判定。 */
export function scanText({ relPath, text, catalog, baseline, policy, mask = true }) {
  const compiled = compileRules(catalog, { policy });
  const lines = text.split(/\r?\n/);
  const strippedLines = stripLines(relPath, lines);
  const waivers = baseline?.waivers ?? [];
  const findings = [];
  lines.forEach((line, idx) => {
    for (const { found, waiver } of matchLine(compiled, relPath, line, idx + 1, waivers, strippedLines[idx], { mask })) {
      // 基线豁免必须与 runScan 同语义：命中豁免且未过期就不算数（过期的重新计入）
      const expired = waiver ? isExpired(waiver.until) : false;
      if (!waiver || expired) findings.push(found);
    }
  });
  return capByMaxHits(findings, compiled);
}

/**
 * @returns {{findings: Array, waived: Array, expiredWaivers: Array, scanned: number, scannedFiles: string[], rules: number}}
 */
export function runScan({ target, catalog, domain, severity, diffRef, baseline, policy, mask = true }) {
  const compiled = compileRules(catalog, { domain, policy });
  const diff = diffRef ? changedLines(target, diffRef) : null;
  const files = diff ? [...diff.keys()] : listFiles(target);
  // 允许直接传一个文件：相对路径以它的父目录为基准，否则 relPath 会变成空串而永不命中
  const base = isFileTarget(target) ? path.dirname(path.resolve(target)) : path.resolve(target);

  const findings = [];
  const waived = [];
  const expiredWaivers = new Set();
  const waivers = baseline?.waivers ?? [];
  const scannedFiles = [];
  const candidates = severity ? compiled.filter((c) => c.sev === severity) : compiled;
  const rules = candidates.length;

  for (const file of files) {
    const relPath = path.relative(base, file).split(path.sep).join('/');
    const hit = candidates.filter(
      (c) => c.globs.some((g) => g.test(relPath)) && !c.excludes.some((g) => g.test(relPath)),
    );
    if (!hit.length) continue;
    let lines;
    try {
      lines = readText(file).split(/\r?\n/);
    } catch {
      continue;
    }
    scannedFiles.push(relPath);
    const strippedLines = stripLines(file, lines);
    const limit = diff ? diff.get(file) : null;

    // 顺序很关键：**先全量收命中 → 再 cap → 最后按 diff 过滤**。
    // maxHits 的判据是「这个文件里有多少处命中」，而 --diff 只告诉我们「哪几行改了」。
    // 先按 diff 过滤会把计数打残：文件里已有 4 处、本次新增第 5 处时，cap 只看到 1 处 → 不报。
    // 而 --diff 正是 gate.sh 与 ds brief --diff 的主路径（N45）。
    const fileFindings = [];   // 全文件命中（用于计数）
    const fileWaived = [];     // 全文件豁免（同样按 diff 过滤后上报）
    lines.forEach((src, idx) => {
      const lineNo = idx + 1;
      const stripped = strippedLines[idx];
      for (const { found, waiver } of matchLine(hit, relPath, src, lineNo, waivers, stripped, { mask })) {
        const expired = waiver ? isExpired(waiver.until) : false;
        if (waiver) {
          if (expired) expiredWaivers.add(`${waiver.ruleId}@${waiver.file ?? '*'}`);
          else fileWaived.push({ ...found, waiver: waiver.reason ?? '' });
        }
        if (!waiver || expired) fileFindings.push(found);
      }
    });

    // diff 语义（选项 A）：**越线那一行落在本次改动内才报** —— 只报新增问题。
    // 所以「文件里已有 4 处、这次新增第 5 处」会报（第 5 处在改动里）；
    // 「5 处都在历史里、这次只改了注释」不报（越线那行没动过）。
    const keep = (f) => !limit || limit.has(f.line);
    findings.push(...capByMaxHits(fileFindings, hit).filter(keep));
    waived.push(...fileWaived.filter(keep));
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || order[a.severity] - order[b.severity]));
  waived.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  return {
    findings,
    waived,
    expiredWaivers: [...expiredWaivers],
    scanned: scannedFiles.length,
    scannedFiles,
    rules,
    totalRules: compiled.length,
  };
}

/** 基线豁免：ruleId 必填；file 为 glob；line 可选（不给则整文件豁免）。 */
function matchWaiver(waivers, hit) {
  for (const w of waivers) {
    if (w.ruleId !== hit.ruleId) continue;
    if (w.file && !globToRegExp(w.file).test(hit.file)) continue;
    if (w.line && Number(w.line) !== hit.line) continue;
    return w;
  }
  return null;
}

/** 到期日按本地日末计算，避免 UTC 零点在 UTC+8 提前 8 小时失效。 */
export function isExpired(until) {
  if (!until) return false;
  const d = new Date(`${until}T23:59:59.999`);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}
