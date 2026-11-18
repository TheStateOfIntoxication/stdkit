// catalog：把规则编译成机器可读索引（确定性、无时间戳）。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, writeJSON, readJSON } from './util.mjs';
import { parseRules } from './parse.mjs';

export const CATALOG_PATH = path.join(ROOT, 'catalog', 'rules.json');
const CATALOG_PATH_FOR = (root) => path.join(root, 'catalog', 'rules.json');

export function buildCatalog(root = ROOT) {
  // dist 安装后没有 rules/：直接读随包发布的 catalog，保证扩展与 CLI 可用
  if (!fs.existsSync(path.join(root, 'rules'))) {
    const cached = readJSON(CATALOG_PATH_FOR(root), null);
    if (cached) return cached;
  }
  const rules = parseRules(root).map((r) => ({
    id: r.id,
    title: r.title,
    domain: r.domain,
    file: r.file,
    line: r.line,
    anchor: r.anchor,
    level: r.meta?.level ?? null,
    severity: r.meta?.severity ?? null,
    tags: r.meta?.tags ?? [],
    applies: r.meta?.applies ?? [],
    exclude: r.meta?.exclude ?? [],
    p3c: r.meta?.p3c ?? '-',
    see: r.meta?.see ?? [],
    deny: r.meta?.deny ?? [],
    allow: r.meta?.allow ?? [],
    status: r.meta?.status ?? 'active',
    raw: r.meta?.raw === 'true',
    noString: r.meta?.noString === 'true',
    // 计数型规则：同一文件命中超过 maxHits 处才算违规（缺省 = 每命中一处都算）
    ...(r.meta?.maxHits ? { maxHits: Number(r.meta.maxHits) } : {}),
  }));
  rules.sort((a, b) => a.id.localeCompare(b.id));
  const version = readJSON(path.join(root, 'package.json'), {})?.version ?? '0.0.0';
  const domains = [...new Set(rules.map((r) => r.domain))].sort();
  return {
    $comment: '生成物，勿手改。node cli/ds.mjs catalog',
    version,
    domains,
    counts: countBy(rules),
    rules,
  };
}

function countBy(rules) {
  const counts = {};
  for (const r of rules) counts[r.id.split('-')[0]] = (counts[r.id.split('-')[0]] ?? 0) + 1;
  return counts;
}

export function writeCatalog(root = ROOT) {
  const cat = buildCatalog(root);
  writeJSON(path.join(root, 'catalog', 'rules.json'), cat);
  return cat;
}

export function isCatalogStale(root = ROOT) {
  const onDisk = readJSON(path.join(root, 'catalog', 'rules.json'), null);
  const fresh = buildCatalog(root);
  return {
    stale: JSON.stringify(onDisk) !== JSON.stringify(fresh),
    fresh,
    onDisk,
  };
}
