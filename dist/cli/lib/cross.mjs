// cross：跨文件（仓级）确定性检查。
//
// 与 ds scan 的分工：scan 按行判、给行号；cross 判「文件集合」层面的事，
// 报告的是文件级问题，没有单一行号可给。混进 scan 会让 --diff / baseline 行级豁免失去意义。
//
// 只做 ADR 0001 里定下的两条（误报最低、价值最高）：
//   SQL-RBK-01 正向脚本必须有同名回滚
//   SQL-DIA-01 L3 声明的每个方言目录都要有，且各目录脚本序号一致
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON } from './util.mjs';
import { listFiles } from './scan.mjs';

const DIALECTS = ['mysql', 'postgres', 'oracle', 'kingbase'];

/**
 * 仓级机判的规则 ID（单一事实源）。
 * 用途：build 生成 review prompt、brief 生成 B 类清单时都要把它们排除——
 * 否则 ADR 0001「语义层少两条」就只是文档里的一句话。
 */
export const CROSS_RULE_IDS = ['SQL-RBK-01', 'SQL-DIA-01'];

/** 从相对路径里解析 sql 布局；不是标准布局返回 null（宁可不查，也不误报）。 */
function parseLayout(rel) {
  // 先匹配回滚（更具体），再匹配正向——否则 `upgrade/mysql/rollback/x.sql` 会被当成正向脚本
  let m = rel.match(/^sql\/(upgrade|install)\/([a-z]+)\/rollback\/(.+\.sql)$/i);
  if (m) return { phase: m[1].toLowerCase(), dialect: m[2].toLowerCase(), file: m[3], rollback: true };
  m = rel.match(/^sql\/rollback\/([a-z]+)\/(.+\.sql)$/i);
  if (m) return { phase: 'upgrade', dialect: m[1].toLowerCase(), file: m[2], rollback: true };
  // sql/upgrade/<dialect>/00N_x.sql  或  sql/install/<dialect>/00N_x.sql
  m = rel.match(/^sql\/(upgrade|install)\/([a-z]+)\/(.+\.sql)$/i);
  if (m) return { phase: m[1].toLowerCase(), dialect: m[2].toLowerCase(), file: m[3], rollback: false };
  return null;
}

/** 取仓里 engines 声明：只读 AGENTS.md 的 engines 一格（不猜别的字段）。 */
export function readDeclaredEngines(target) {
  const agentsPath = path.join(target, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) return null;
  const text = fs.readFileSync(agentsPath, 'utf8').replace(/^\uFEFF/, '');
  const m = text.match(/^\|\s*\**engines\**\s*\|([^|]+)\|/im);
  if (!m) return null;
  const list = m[1]
    .replace(/（[^）]*）/g, '')
    .split(/[,，/、\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => DIALECTS.includes(s));
  return list.length ? list : null;
}

/**
 * @returns {{ruleId:string, file:string, line:number, severity:string, msg:string}[]}
 */
export function runCrossCheck(target, { engines } = {}) {
  const base = path.resolve(target);
  if (!fs.existsSync(base)) throw new Error(`路径不存在：${target}`);

  const files = listFiles(base)
    .map((f) => path.relative(base, f).split(path.sep).join('/'))
    .map((rel) => ({ rel, layout: parseLayout(rel) }))
    .filter((x) => x.layout);

  const findings = [];
  const byPhaseDialect = new Map(); // "upgrade/mysql" → { ups: Set, rbs: Set }
  for (const { layout } of files) {
    const key = `${layout.phase}/${layout.dialect}`;
    if (!byPhaseDialect.has(key)) byPhaseDialect.set(key, { ups: new Set(), rbs: new Set() });
    const bucket = byPhaseDialect.get(key);
    (layout.rollback ? bucket.rbs : bucket.ups).add(layout.file);
  }

  // SQL-RBK-01：每个正向脚本都要有同名回滚
  for (const [key, { ups, rbs }] of byPhaseDialect) {
    for (const file of ups) {
      if (rbs.has(file)) continue;
      findings.push({
        ruleId: 'SQL-RBK-01',
        file: `sql/${key}/${file}`,
        line: 1,
        severity: 'high',
        msg: `缺同名回滚（${key}/rollback/${file} 或 sql/rollback/${key.split('/')[1]}/${file}）`,
      });
    }
  }

  // SQL-DIA-01：声明了 engines 时，每个方言都要有目录，且脚本清单一致
  const declared = engines ?? readDeclaredEngines(base);
  if (declared?.length) {
    const upgrading = [...byPhaseDialect.keys()].filter((k) => k.startsWith('upgrade/'));
    if (upgrading.length) {
      const present = new Set(upgrading.map((k) => k.split('/')[1]));
      for (const d of declared) {
        if (!present.has(d)) {
          findings.push({
            ruleId: 'SQL-DIA-01',
            file: `sql/upgrade/${d}/`,
            line: 1,
            severity: 'critical',
            msg: `L3 声明了 ${d}，但没有 sql/upgrade/${d}/ 目录（已声明：${declared.join(',')}）`,
          });
        }
      }
      // 以文件数最多的方言为基准，比脚本清单
      const lists = upgrading.map((k) => ({ dialect: k.split('/')[1], ups: byPhaseDialect.get(k).ups }));
      const widest = lists.reduce((a, b) => (b.ups.size > a.ups.size ? b : a), lists[0]);
      for (const { dialect, ups } of lists) {
        if (dialect === widest.dialect) continue;
        for (const file of widest.ups) {
          if (ups.has(file)) continue;
          findings.push({
            ruleId: 'SQL-DIA-01',
            file: `sql/upgrade/${dialect}/`,
            line: 1,
            severity: 'critical',
            msg: `${widest.dialect} 有 ${file}，${dialect} 缺同序号变更`,
          });
        }
      }
    }
  }

  return findings;
}
