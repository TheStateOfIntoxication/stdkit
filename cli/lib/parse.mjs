// 规则解析：把 rules/**/*.md 解析成结构化规则对象。
import path from 'node:path';
import { ROOT, walk, readText, rel } from './util.mjs';

// 规则目录 → ID 前缀。加域时在这里加一行（AGENTS.md §加域）。
export const DOMAINS = {
  'java-jdk8': 'J8',
  vue: 'V2',
  sql: 'SQL',
  test: 'UT',
};

export const LEVELS = ['must', 'should'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const STATUSES = ['active', 'retired'];
/** 布尔开关类元数据：只能写 true，写 yes/1 会被当未知值静默忽略。 */
export const BOOLEAN_META = ['raw', 'noString'];
export const META_KEYS = ['level', 'severity', 'tags', 'applies', 'exclude', 'p3c', 'see', 'deny', 'allow', 'status', 'raw', 'noString'];

const HEADING = /^###\s+([A-Z][A-Z0-9]*-[A-Z][A-Z0-9]*-\d{2})\s+(.+?)\s*$/;
const ANY_HEADING = /^#{1,3}\s/;
const FENCE = /^```(.*)$/;

// tags/applies/see 用逗号分隔；deny/allow 是正则，用分号分隔（正则内避免分号）。
const CSV_KEYS = ['tags', 'applies', 'exclude', 'see'];
const SEMI_KEYS = ['deny', 'allow'];

export function parseRules(root = ROOT) {
  const files = walk(path.join(root, 'rules'), (p) => p.endsWith('.md'));
  const rules = [];
  for (const file of files) rules.push(...parseFile(file, root));
  return rules;
}

function parseFile(file, root) {
  const lines = readText(file).split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(HEADING);
    if (!m) {
      i++;
      continue;
    }
    const [id, title] = [m[1], m[2]];
    const startLine = i + 1;
    let j = i + 1;
    let meta = null;
    // 紧跟标题的第一个 ``` 围栏，info 含 rule，即元数据块
    while (j < lines.length && lines[j].trim() === '') j++;
    const fence = j < lines.length ? lines[j].match(FENCE) : null;
    if (fence && /\brule\b/.test(fence[1])) {
      const body = [];
      j++;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) body.push(lines[j++]);
      j++; // 跳过闭合围栏
      meta = parseMeta(body);
    }
    const bodyStart = j;
    let k = j;
    let inFence = false;
    while (k < lines.length) {
      if (FENCE.test(lines[k])) inFence = !inFence; // 围栏内的 # 注释不是标题
      else if (!inFence && ANY_HEADING.test(lines[k])) break;
      k++;
    }
    const body = lines.slice(bodyStart, k);
    out.push({
      id,
      title,
      domain: rel(file).split('/')[1],
      file: rel(file),
      line: startLine,
      anchor: `#${slug(id + '-' + title)}`,
      meta,
      body: body.join('\n'),
      raw: lines.slice(i, k).join('\n'),
    });
    i = k;
  }
  return out;
}

function parseMeta(body) {
  const meta = {};
  const errors = [];
  for (const line of body) {
    if (!line.trim()) continue;
    const idx = line.indexOf(':');
    if (idx < 0) {
      errors.push(line);
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (CSV_KEYS.includes(key)) meta[key] = value.split(',').map((s) => s.trim()).filter(Boolean);
    else if (SEMI_KEYS.includes(key)) meta[key] = value.split(';').map((s) => s.trim()).filter(Boolean);
    else meta[key] = value;
  }
  meta.__errors = errors;
  return meta;
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '');
}

// 从代码围栏里抽代码块，按 // GOOD / // BAD 分段。用于 JDK8 语法越界扫描。
export function codeFences(body) {
  const lines = body.split(/\r?\n/);
  const fences = [];
  let cur = null;
  for (const line of lines) {
    const f = line.match(FENCE);
    if (cur === null && f) {
      cur = { lang: (f[1] || '').trim().split(/\s+/)[0], lines: [], start: fences.length };
      continue;
    }
    if (cur !== null && /^```\s*$/.test(line)) {
      fences.push(cur);
      cur = null;
      continue;
    }
    if (cur !== null) cur.lines.push(line);
  }
  return fences;
}

// 把围栏内容切成 { kind: 'good'|'bad'|'plain', line } 序列。
// 认可 java/sql/yaml 各类注释风格：// GOOD、-- BAD、<!-- BAD -->、# BAD
export function segments(fenceLines) {
  const out = [];
  let kind = 'plain';
  for (const line of fenceLines) {
    const m = line.match(/^\s*(?:\/\/|\/\*|<!--|--|#|\*)\s*(GOOD|BAD)\b/);
    if (m) kind = m[1].toLowerCase();
    out.push({ kind, line });
  }
  return out;
}

/** 规则的 deny/allow 正则：支持行首 (?i) 前缀。 */
export function compileRule(src) {
  return src.startsWith('(?i)') ? new RegExp(src.slice(4), 'i') : new RegExp(src);
}
