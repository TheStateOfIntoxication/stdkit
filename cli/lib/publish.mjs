// publish-check：发布前脱敏。扫待公开的仓，命中 policy/publish.json 里的 forbidden 就退出 1。
//
// 为什么单独一个命令而不是塞进 check：日常开发不需要它，而发布是一次性动作。
// 也正因为「一次性」，才更需要机器执行——人一定会在发版那天忘掉其中一条。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, readText } from './util.mjs';
import { execFileSync } from 'node:child_process';
import { listFiles, globToRegExp, GIT, gitErr, parseGitPath } from './scan.mjs';
import { maskText } from './mask.mjs';

/** 读规则表；缺文件时用空表（不阻断，但会在结果里说明）。 */
export function loadPublishPolicy(root = ROOT) {
  const p = path.join(root, 'policy', 'publish.json');
  if (!fs.existsSync(p)) return { forbidden: [], allowPaths: [], historyAllow: [], missing: true };
  const raw = readJSON(p, {}) ?? {};
  return { forbidden: raw.forbidden ?? [], allowPaths: raw.allowPaths ?? [], historyAllow: raw.historyAllow ?? [], missing: false };
}

/**
 * 发布检查要扫「真正会发出去的文件」——所以不能用 ds scan 的 listFiles：
 * 它会跳过项目根的 dist/（而 dist/ 正是 npm files 里发布的重点）。
 */
function listPublishFiles(base) {
  try {
    const raw = execFileSync(GIT, ['-C', base, '-c', 'core.quotePath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'], // 同 scan.mjs：不把 git 的 stderr 透传到我们的输出
    });
    return raw
      .split('\0')
      .filter(Boolean)
      .map((rel) => path.resolve(base, rel))
      .filter((f) => {
        try {
          return fs.statSync(f).isFile();
        } catch {
          return false;
        }
      });
  } catch (e) {
    // 这是 git 仓却调不动 git —— 静默降级成目录遍历会让扫描集合悄悄变大（把 .gitignore 里的
    // .idea/、本地草稿都算进来），也会悄悄变小（漏掉 git 才能识别的忽略规则）。宁可报错。
    if (fs.existsSync(path.join(base, '.git'))) {
      throw new Error(
        `publish-check 需要 git 才能取到「真正会发布」的文件列表，但调用失败（${GIT}）：${gitErr(e)}\n` +
          '  · git 不在 PATH 时设 DS_GIT 指向可执行文件（例如 DS_GIT=/usr/bin/git）\n' +
          '  · 或者在一个非 git 的目录上跑（那种情况下退回目录遍历）',
      );
    }
    // 非 git 仓：遍历，只跳机器/IDE 产物（dist/ 与 docs/ 都要扫）
    const out = [];
    const stack = [base];
    while (stack.length) {
      const dir = stack.pop();
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['.git', '.idea', '.vscode', '.tmp', 'node_modules'].includes(e.name)) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(abs);
        else out.push(abs);
      }
    }
    return out;
  }
}

/** 允许路径：支持 glob（相对根），也允许直接写目录前缀。 */
function isAllowed(rel, allowPaths) {
  return allowPaths.some((g) => {
    if (rel === g) return true;
    if (g.endsWith('/') && rel.startsWith(g)) return true;
    if (!/[.*?]/.test(g)) return rel === g || rel.startsWith(g + '/');
    return globToRegExp(g).test(rel);
  });
}

/**
 * 扫一个或多个根目录。
 * @returns {{root:string, rel:string, line:number, id:string, why:string, snippet:string}[]}
 */
/**
 * 历史里的已知豁免：按 (规则 id, 路径 glob) 精确到条。
 * 历史改不掉，所以「接受」必须写下来并给出理由——否则这道检查会长期红着，最后被关掉。
 */
function isHistoryAllowed(id, rel, list = []) {
  return list.some((x) => x.id === id && (!x.path || globToRegExp(x.path).test(rel)));
}

/**
 * 扫 **git 历史**（只看新增行）。
 *
 * 为什么要它：force-push 只改引用不删对象，工作树干净不代表历史干净；而「这条泄漏是不是
 * 以前提交过」是发布前最该答的问题。只扫新增行（\`-\` 行是删掉的，不算泄漏），
 * allowPaths 按 diff 里的路径过滤（evals/ 那种故意写坏的 fixture 不该在这里炸）。
 *
 * @returns {{root:string, commit:string, rel:string, line:number, id:string, why:string, snippet:string}[]}
 */
export function runHistoryCheck(root, policy = loadPublishPolicy(), opts = {}) {
  const maxCommits = opts.maxCommits ?? 500;
  const patterns = [];
  for (const f of policy.forbidden) {
    try {
      patterns.push({ ...f, re: new RegExp(f.pattern) });
    } catch (e) {
      throw new Error(`policy/publish.json 的 forbidden "${f.id}" 正则无法编译：${e.message}`);
    }
  }

  let raw;
  try {
    raw = execFileSync(
      GIT,
      ['-C', root, 'log', '-p', '--all', '--no-color', '--no-ext-diff', '--format=commit %H %s', '-n', String(maxCommits)],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`历史检查需要 git：${gitErr(e)}（安装 Git 或设 DS_GIT）`);
    if (fs.existsSync(path.join(root, '.git'))) throw new Error(`历史检查需要 git：${gitErr(e)}`);
    return []; // 非 git 目录：没有历史可查
  }

  const hits = [];
  let commit = '';
  let rel = '';
  for (const line of raw.split(/\r?\n/)) {
    const cm = line.match(/^commit ([0-9a-f]{7,40})\b/);
    if (cm) {
      commit = cm[1].slice(0, 7);
      continue;
    }
    const fm = line.match(/^\+\+\+ b\/(.+)$/);
    if (fm) {
      rel = parseGitPath(fm[1]);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (rel && isAllowed(rel, policy.allowPaths)) continue;
    const body = line.slice(1);
    for (const f of patterns) {
      if (!f.re.test(body)) continue;
      if (isHistoryAllowed(f.id, rel, policy.historyAllow)) continue;
      hits.push({ root: path.resolve(root), commit, rel, line: 0, id: f.id, why: f.why ?? '', snippet: maskText(body.trim()).slice(0, 120) });
    }
  }
  return hits;
}

export function runPublishCheck(roots, policy = loadPublishPolicy()) {
  const hits = [];
  const patterns = [];
  for (const f of policy.forbidden) {
    try {
      patterns.push({ ...f, re: new RegExp(f.pattern) });
    } catch (e) {
      // 写了不生效是历史高发坑（同 status: retird）：直接报出来，不静默丢
      throw new Error(`policy/publish.json 的 forbidden "${f.id}" 正则无法编译：${e.message}`);
    }
  }

  for (const root of roots) {
    const base = path.resolve(root);
    if (!fs.existsSync(base)) continue;
    for (const file of listPublishFiles(base)) {
      const rel = path.relative(base, file).split(path.sep).join('/');
      if (isAllowed(rel, policy.allowPaths)) continue;
      let text;
      try {
        text = readText(file);
      } catch {
        continue;
      }
      // 二进制/超大文件跳过：脱敏关心的是文本
      if (text.includes('\u0000') || text.length > 2 * 1024 * 1024) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        for (const f of patterns) {
          if (!f.re.test(line)) continue;
          hits.push({
            root: base,
            rel,
            line: i + 1,
            id: f.id,
            why: f.why ?? '',
            snippet: maskText(line.trim()).slice(0, 120),
          });
        }
      });
    }
  }
  return hits;
}
