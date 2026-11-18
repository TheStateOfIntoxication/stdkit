// policy：默认策略 ← profile ← 业务仓覆盖。三层，后者只覆盖列出的键。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, UsageError } from './util.mjs';

export const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

/** 策略文件允许的键。加键要同时改 policy/compat.json（1.0 起由 compat.test.mjs 守住）。 */
export const POLICY_KEYS = ['version', 'blockOn', 'warnOn', 'severity'];
export const PROFILE_KEYS = [...POLICY_KEYS, 'stack'];
/** 业务仓覆盖只允许影响判定的键：profile 的结构性字段（stack）不该在单仓里改写。 */
export const OVERRIDE_KEYS = ['version', 'blockOn', 'warnOn', 'severity'];
export const POLICY_VERSION = 1;

const META_KEYS = new Set(['$comment']);

/** 未知键 / 非法 version → 抛 UsageError（配置写错属于「环境错误」，exit 2，不是「有命中」）。 */
export function validatePolicyShape(policy, { where = 'policy', allowed = POLICY_KEYS } = {}) {
  if (!policy || typeof policy !== 'object') throw new UsageError(`${where} 不是对象`);
  const unknown = Object.keys(policy).filter((k) => !META_KEYS.has(k) && !allowed.includes(k));
  if (unknown.length) {
    throw new UsageError(`${where} 有未知键：${unknown.join(', ')}（允许：${allowed.join(', ')}）——拼错的键会静默不生效，所以这里直接报错`);
  }
  if (policy.version !== undefined && Number(policy.version) !== POLICY_VERSION) {
    throw new UsageError(`${where} 的 version=${policy.version}，当前只支持 ${POLICY_VERSION}（改格式请升级 stdkit）`);
  }
  return policy;
}

export function loadPolicy(root = ROOT, { profile, target } = {}) {
  let policy = validatePolicyShape(readJSON(path.join(root, 'policy', 'default.json'), {}) ?? {}, { where: 'policy/default.json' });
  if (profile) {
    const prof = readJSON(path.join(root, 'policy', 'profiles', `${profile}.json`), null);
    if (!prof) {
      const names = listProfiles(root);
      throw new UsageError(`找不到 profile "${profile}"（可用：${names.join(', ') || '无'}）`);
    }
    validatePolicyShape(prof, { where: `policy/profiles/${profile}.json`, allowed: PROFILE_KEYS });
    policy = { ...policy, ...prof };
  }
  if (target) {
    const override = readJSON(path.join(target, '.stdkit', 'policy.json'), null);
    if (override) {
      // 单仓覆盖不允许写 profile 的结构性字段（如 stack）：那是 profile 的事
      validatePolicyShape(override, { where: `${target}/.stdkit/policy.json`, allowed: OVERRIDE_KEYS });
      policy = { ...policy, ...override };
    }
  }
  return policy;
}

export function listProfiles(root = ROOT) {
  try {
    const dir = path.join(root, 'policy', 'profiles');
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

/** `--fail-on high` = high 及以上；支持逗号列表，取其中最宽松（最低）一级。 */
export function resolveFailOn(value, policy) {
  const levels = policy.blockOn ?? ['critical', 'high'];
  // 无论来自 --fail-on 还是 policy.blockOn，都按「该级及以上」处理；
  // 不能把 blockOn 当精确集合用，否则 blockOn:["low"] 会把 critical 放过。
  const asked = value
    ? String(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : levels;
  const unknown = asked.filter((s) => !SEVERITY_ORDER.includes(s));
  if (unknown.length) throw new UsageError(`阻断级别取值非法：${unknown.join(', ')}（可用：${SEVERITY_ORDER.join(' / ')}）`);
  const lowest = asked.reduce((a, b) => (SEVERITY_ORDER.indexOf(b) < SEVERITY_ORDER.indexOf(a) ? b : a), asked[0]);
  const idx = SEVERITY_ORDER.indexOf(lowest);
  return new Set(SEVERITY_ORDER.slice(idx));
}

/**
 * 生效级 = 业务仓（或 profile）对该规则的单条覆盖，没配就用规则默认。
 * 存在的意义：存量仓需要「这条我放宽到 medium」时，不必用 baseline（豁免有到期日、鼓励清理），
 * 也不必去改 rules/（那是全仓共享的条文）。
 */
export function effectiveSeverity(rule, policy) {
  return policy?.severity?.[rule.id] ?? rule.severity;
}

/**
 * 校验 policy 里的单条覆盖（severity 映射）。
 * 写错 ID / 值非法必须报错——否则又是「写了不生效」的坑（历史上踩过 status: retird）。
 */
export function validateOverrides(policy, rules) {
  const errors = [];
  const warnings = [];
  const byId = new Map(rules.map((r) => [r.id, r]));
  for (const [id, sev] of Object.entries(policy?.severity ?? {})) {
    const rule = byId.get(id);
    if (!rule) errors.push(`severity 覆盖的规则 ${id} 不存在`);
    else if (rule.status === 'retired') warnings.push(`severity 覆盖的规则 ${id} 已 retired，覆盖不会生效`);
    if (!SEVERITY_ORDER.includes(sev)) errors.push(`severity 覆盖 ${id} 的取值 "${sev}" 非法（可用：${SEVERITY_ORDER.join(' / ')}）`);
  }
  return { errors, warnings };
}
