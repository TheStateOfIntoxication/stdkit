// 通用工具：文件遍历、读取、路径、终端着色。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function walk(dir, filter) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

/**
 * 这个目录是什么？三处（check / doctor / gate.sh）必须用同一套判定，否则迟早漂成三种。
 *   rules-repo   : 有 rules/ —— 规则源仓，自检有意义
 *   dist-install : 有 catalog/rules.json + cli/ds.mjs 但没有 rules/ —— 客户端安装
 *   unknown      : 两者都不是 —— 走错目录了，要明确失败而不是「跳过」
 */
export function detectLayout(root = ROOT) {
  const hasRules = fs.existsSync(path.join(root, 'rules'));
  if (hasRules) return 'rules-repo';
  const hasCatalog = fs.existsSync(path.join(root, 'catalog', 'rules.json'));
  const hasCli = fs.existsSync(path.join(root, 'cli', 'ds.mjs'));
  return hasCatalog && hasCli ? 'dist-install' : 'unknown';
}

/**
 * 用法 / 环境错误（参数写错、profile 不存在…），与「有命中」区分开。
 *
 * 为什么重要：CI 门禁只看退出码。参数拼错若也返回 1，就与「发现了阻断级问题」无法区分——
 * 于是「--severity hight 拼错」会被当成「代码有问题」，人去查代码，实际是命令写错了。
 * 约定：0 = 通过；1 = 有阻断/失败；2 = 用法或环境错误。
 */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.usage = true;
  }
}

export const readText = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');

export const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

export function readJSON(p, fallback = null) {
  try {
    return JSON.parse(readText(p));
  } catch {
    return fallback;
  }
}

export function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
export const c = {
  red: (s) => (color ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (color ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (color ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s) => (color ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (color ? `\x1b[1m${s}\x1b[0m` : s),
};
