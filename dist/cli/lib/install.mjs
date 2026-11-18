// install：把 dist/ 装到各客户端。
//
// 计划里原本是两个 shell/ps1 脚本，这里改成「Node 实现 + 两个三行 shim」：
// 五端的目标目录、探测、卸载要一模一样，两份实现必然漂移；单实现还能进单测。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, readJSON, writeJSON } from './util.mjs';

export const MANIFEST = path.join(os.homedir(), '.stdkit', 'install-manifest.json');

/** 各客户端的落位规则。project=true 表示装到业务仓（需 --project），否则装到用户目录。 */
export function planInstall({ distDir = path.join(ROOT, 'dist'), home = os.homedir(), project = process.cwd(), targets = ['claude'] } = {}) {
  const plan = [];
  const add = (target, from, to) => plan.push({ target, from, to });

  for (const t of targets) {
    if (t === 'claude') {
      add('claude', path.join(distDir, 'adapters/claude/plugin.json'), path.join(home, '.claude/.claude-plugin/plugin.json'));
      for (const f of list(path.join(distDir, 'adapters/claude/commands'))) {
        add('claude', f, path.join(home, '.claude/commands', path.basename(f)));
      }
      for (const d of listDirs(path.join(distDir, 'skills'))) {
        addDir('claude', path.join(distDir, 'skills', d), path.join(home, '.claude/skills', d), add);
      }
    } else if (t === 'codex') {
      for (const f of list(path.join(distDir, 'adapters/codex/skills'))) add('codex', f, path.join(home, '.agents/skills', path.basename(path.dirname(f)), path.basename(f)));
      for (const d of listDirs(path.join(distDir, 'adapters/codex/skills'))) {
        addDir('codex', path.join(distDir, 'adapters/codex/skills', d), path.join(home, '.agents/skills', d), add);
      }
      for (const d of listDirs(path.join(distDir, 'skills'))) {
        addDir('codex', path.join(distDir, 'skills', d), path.join(home, '.agents/skills', d), add);
      }
    } else if (t === 'cursor') {
      add('cursor', path.join(distDir, 'adapters/cursor/rules/stdkit.mdc'), path.join(project, '.cursor/rules/stdkit.mdc'));
    } else if (t === 'copilot') {
      add('copilot', path.join(distDir, 'adapters/copilot/copilot-instructions.md'), path.join(project, '.github/copilot-instructions.md'));
    } else if (t === 'pi') {
      // pi 用 pi install；这里只描述，不复制文件
      add('pi', distDir, '<pi install>');
    } else {
      throw new Error(`未知目标 "${t}"（可用：pi / claude / codex / cursor / copilot / all）`);
    }
  }
  return plan;
}

function list(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 目录递归展开成「逐文件」条目（卸载时才知道该删哪些）。 */
function addDir(target, from, to, add) {
  const walk = (src, dst) => {
    let entries;
    try {
      entries = fs.readdirSync(src, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) walk(s, d);
      else add(target, s, d);
    }
  };
  walk(from, to);
}

/** 执行计划：复制文件，并写一份 manifest 供卸载。 */
export function applyInstall(plan, { dryRun = false } = {}) {
  const written = [];
  for (const item of plan) {
    if (item.to === '<pi install>') continue;
    written.push(item.to);
    if (dryRun) continue;
    fs.mkdirSync(path.dirname(item.to), { recursive: true });
    fs.copyFileSync(item.from, item.to);
  }
  if (!dryRun) {
    const prev = readJSON(MANIFEST, { files: [] })?.files ?? [];
    writeJSON(MANIFEST, { $comment: 'stdkit 安装记录：ds install --uninstall 按它删除', files: [...new Set([...prev, ...written])] });
  }
  return { plan, written, dryRun };
}

/** 卸载：只删 manifest 里记过的文件（不碰用户自己的东西），再清空目录。 */
export function uninstall({ dryRun = false } = {}) {
  const files = readJSON(MANIFEST, null)?.files ?? [];
  const removed = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    removed.push(f);
    if (!dryRun) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* 权限问题忽略，下次再删 */
      }
    }
  }
  if (!dryRun) {
    // 清掉空目录（从深到浅）
    for (const f of [...files].sort((a, b) => b.length - a.length)) {
      let dir = path.dirname(f);
      for (let i = 0; i < 4 && dir.startsWith(os.homedir()); i++) {
        try {
          if (fs.readdirSync(dir).length) break;
          fs.rmdirSync(dir);
        } catch {
          break;
        }
        dir = path.dirname(dir);
      }
    }
    if (fs.existsSync(MANIFEST)) fs.unlinkSync(MANIFEST);
  }
  return { removed, dryRun };
}

/** pi 走它自己的安装命令；没有 pi 时返回提示而不是报错。 */
export function installPi(distDir, { dryRun = false } = {}) {
  const cmd = `pi install ${distDir}`;
  if (dryRun) return { cmd, ran: false };
  try {
    const out = execFileSync('pi', ['install', distDir], { encoding: 'utf8', stdio: 'pipe' });
    return { cmd, ran: true, out };
  } catch (e) {
    return { cmd, ran: false, error: String(e.message || e) };
  }
}
