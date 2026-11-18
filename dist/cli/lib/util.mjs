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
