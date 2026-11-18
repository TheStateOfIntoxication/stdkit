# 1.0 冻结评估：catalog / policy / --fail-on

> 目的：判断这三处**公开契约**现在能不能冻、冻了会卡住什么、冻之前必须先修什么。
> 这不是一份"决定"，是**决策前的证据**——每条结论都附了读取方（`文件:行`），可复核。

## 0. 结论

| 表面 | 现在能冻吗 | 理由 |
|---|---|---|
| `--fail-on` | ✅ **能** | 语义清晰（阈值 + 逗号列表取最宽松 + 默认取 `blockOn`），有测试；本轮补上了「用法错误 = exit 2」这条边界 |
| `catalog/rules.json` | ⚠️ **加一个字段后能** | 19 个键 + 1 个可选 `maxHits`；但缺 **schema 版本号**，且 `version` 是 stdkit 版本（极易被外部误读成数据格式版本） |
| `policy/*.json` | ❌ **现在冻会冻住一半死键** | `domains` / `extends` / `version` / `stack` **没有任何读取方**；`warnOn` 只影响 prompt 文案，不参与判定 |

另：本轮发现一处契约**不成立**（已修）——用法错误（`--severity hight`、未知参数、`--limit abc`）原来返回 **1**，
与「发现了阻断级问题」无法区分。CI 只看退出码，这会让人去查代码而实际是命令写错了。

## 1. `catalog/rules.json`

**当前形状**（`cli/lib/catalog.mjs:17-42`，实测 127 条规则）

```jsonc
{
  "$comment": "生成物，勿手改。node cli/ds.mjs catalog",
  "version": "0.19.1",          // ← stdkit 版本，不是数据结构版本
  "domains": ["java-jdk8", "sql", "test", "vue"],
  "counts": { "J8": 71, "SQL": 20, "UT": 10, "V2": 26 },
  "rules": [{
    "id": "J8-API-04", "title": "…", "domain": "java-jdk8",
    "file": "rules/java-jdk8/00-language.md", "line": 597, "anchor": "#…",
    "level": "must", "severity": "critical",
    "tags": ["money"], "applies": ["**/*.java"], "exclude": [],
    "p3c": "OOP 规约 10", "see": [],
    "deny": ["…"], "allow": [],
    "status": "active", "raw": false, "noString": false
    // 可选（目前仅 1 条规则用了）："maxHits": 4
  }]
}
```

**谁在读**（这是"能不能冻"的真正判据）

| 消费方 | 读哪些字段 | 位置 |
|---|---|---|
| 写前护栏（pi 扩展） | 整个 catalog 交给 `scanText` | `extensions/stdkit.ts:66-88` |
| `ds scan` / `brief` | `deny` / `allow` / `applies` / `exclude` / `severity` / `status` / `raw` / `noString` / `maxHits` | `cli/lib/scan.mjs:606-624` |
| `ds rules` / `ds brief` / prompt 生成 | `id` / `title` / `level` / `tags` / `domain` / `file` / `line` | `cli/lib/brief.mjs`、`cli/lib/build.mjs` |
| 外部工具（潜在） | 未知——这正是要冻结的原因 | — |

**冻结规则（建议）**

- **可以**：新增**可选**字段（例如这次 `maxHits`）；新增 `domains` 值；规则条目增删（规则本身用 ID 稳定性约束，与 catalog 格式无关）。
- **不可以**：改键名、改类型、删键、改语义（例如把 `applies` 从「相对业务仓根的 glob」改成绝对路径）。
- **必须先补**：`schema: 1`（数据格式版本），与 `version`（stdkit 版本）分开——否则外部工具无法判断"我读的是不是我能读的格式"。

## 2. `policy/*.json`

**三层覆盖 + 浅合并**（`cli/lib/policy.mjs:8-22`）

```text
policy/default.json  ←  policy/profiles/<name>.json  ←  <业务仓>/.stdkit/policy.json
                          （每个键整体替换，不做深合并）
```

**键的实际效力**（逐个查过读取方）

| 键 | 有读取方？ | 作用 |
|---|---|---|
| `blockOn` | ✅ `policy.mjs:39`、`build.mjs:226,346`、`brief.mjs:63` | 阻断阈值（该级及以上） |
| `severity` | ✅ `policy.mjs:60`、`validateOverrides` | 单条规则降级（长期决策） |
| `warnOn` | ⚠️ 仅 `build.mjs:227,292` | **只用来渲染 prompt 里的一句文案**，不参与任何判定 |
| `domains` | ❌ **0 处** | 死键：域来自规则本身，`--domain` 用 catalog 校验 |
| `version` | ❌ **0 处** | 死键：写了但没有任何校验 |
| `extends`（profile） | ❌ **0 处** | 死键：`loadPolicy` 是把 default 摊开再摊 profile，本来就不读 `extends` |
| `stack`（profile） | ❌ **0 处** | 装饰：`build.mjs:21` 里的 `stack` 是 SKILLS 常量，与此无关 |

**已知语义（必须写进契约，否则冻的是猜测）**

- **浅合并**：业务仓写 `stack` 会整块替换 profile 的 `stack`，不是深合并。
- **`.stdkit/policy.json` 没有白名单**（`policy.mjs:18-21`）：写错键名（`blockon`）不会报错，只是不生效。
  只有 `severity` 走 `validateOverrides` 校验。
- `severity` 覆盖是「长期降级」（无到期日），`baseline` 是「存量豁免」（必须写 `until`）——两者不互相替代。

**结论**：现在冻，等于把「一半没人读的键」写成契约。建议先在 1.0 前做三件事（见 §4）。

## 3. `--fail-on`

**当前语义**（`cli/lib/policy.mjs:38-54`）

| 用法 | 结果 |
|---|---|
| `--fail-on high` | `{high, critical}`（**阈值**：该级及以上） |
| `--fail-on critical,high` | 同上（逗号列表取**最宽松**那个） |
| 省略 | 取 `policy.blockOn`（默认 `["critical","high"]`） |
| `--fail-on hight` | 用法错误 → **exit 2**（本轮修完后成立） |

- 与 `ds brief --fail` 共用同一集合（`cli/lib/brief.mjs:61-63` 有注释说明：曾经一边用 `includes` 精确匹配，
  导致两个命令给出相反结论）。
- **不能改成「精确集合」**：`blockOn: ["low"]` 若按精确集合理解会放过 critical——这条已在代码注释里写明。

**结论**：语义自洽、有测试（`selftest.test.mjs` 的 `resolveFailOn` 用例 + 本轮新增的退出码矩阵），可以冻。

## 4. 冻结前必须先做的（按优先级）

| # | 事项 | 为什么必须在 1.0 前 | 工时 |
|---|---|---|---|
| 1 | ~~用法错误 → exit 2~~ | ✅ **本轮已修**（`UsageError` + 顶层 catch；`commands.md` 写成三档契约；测试覆盖 5 种用法错误） | 已做 |
| 2 | **删 `policy.domains` / `extends`** | 死键冻结后就成了"以后必须一直支持"的负担；且它们是「写了不生效」的教科书案例 | ✅ 0.20.0 |
| 3 | **`policy.version` 加校验**（`check` 断言 `=== 1`） | 否则 policy 格式变了没人知道；顺手让这个键变成活的 | ✅ 0.20.0 |
| 4 | **`catalog.schema: 1`** | 外部工具需要判断数据格式；`version` 是产品版本，不能兼职 | ✅ 0.20.0 |
| 5 | **`.stdkit/policy.json` 白名单校验**（未知键 → error） | 拼错键名静默不生效是本仓反复踩过的坑（`status: retird`、`raw: yes`、`historyAllow` 拼错） | ✅ 0.20.0 |
| 6 | `warnOn` 语义写清 | 它只影响 prompt 文案；不写清会被当成"把某级变成 warning"的开关 | ✅ 0.20.0 |
| 7 | `policy.stack` 明确为「文档性」或删 | 同上：没有读取方的东西不该长得像配置 | ✅ 0.20.0（保留 + 注释写清） |

> 2/3/4/6/7 是**删或注明**，5 是**加校验**。做完之后三个表面才谈得上「冻」。

## 5. 冻结机制（建议：形状快照 + 显式升级）

文档承诺会漂，机制不会。建议在 1.0 时加一个**形状快照**（只断言"键存在且类型不变"，不断言值）：

```jsonc
// policy/compat.json —— 冻结的形状，不是内容
{
  "schemaVersion": 1,
  "catalog": {
    "rootKeys": ["$comment", "version", "domains", "counts", "rules", "schema"],
    "ruleKeys": ["id", "title", "domain", "file", "line", "anchor", "level", "severity",
                 "tags", "applies", "exclude", "p3c", "see", "deny", "allow",
                 "status", "raw", "noString"],
    "ruleOptional": ["maxHits"]
  },
  "policy": { "keys": ["version", "blockOn", "warnOn", "severity"], "profileKeys": ["stack"] },
  "exitCodes": { "pass": 0, "blocked": 1, "usage": 2 }
}
```

`cli/lib/compat.test.mjs` 断言：

1. `catalog.rules[*]` 的键集合 ⊇ 快照；类型一致；未在 `ruleOptional` 里的键不得出现；
2. `policy/default.json` 的键集合 == 快照；
3. `ds help` 里的 `--fail-on` 仍在，且 `resolveFailOn` 的语义用例仍过；
4. 快照自身的 `schemaVersion` 与 `catalog.schema` / `policy.version` 一致。

破坏性变更时测试失败，报错文案直接写**升级步骤**（改大版本号 + 改快照 + 写 ADR），而不是一句"断言失败"。

## 6. 冻结后能做 / 不能做

| 想做的事 | 冻结后 | 说明 |
|---|---|---|
| 加规则、改规则正文、退役规则 | ✅ | 规则 ID 稳定性本来就独立于格式 |
| 给规则加新元数据（如 `maxHits`） | ✅ | 必须是**可选**字段，进 `ruleOptional` |
| 加新命令 / 新 `--flag` | ✅ | 不破坏已有调用 |
| 改 `policy` 键名（`blockOn` → `failAt`） | ❌ | 业务仓 `.stdkit/policy.json` 会静默失效 |
| 改 `--fail-on` 从阈值到精确集合 | ❌ | 语义反转，`blockOn: ["low"]` 会放过 critical |
| 改退出码 2 的含义 | ❌ | CI 靠它区分"拼错参数"与"代码有问题" |
| 改 `catalog` 的 `applies` 语义 | ❌ | 扩展与 scan 都会按旧语义解释 |
| 加必填元数据字段 | ❌ | 会让所有存量规则立刻不合法 |

## 7. 需要你决策的 5 件事

1. **`policy.domains` / `extends`**：删（建议）还是实现？实现意味着 `--domain` 的合法值来自 policy，与 catalog 形成第二事实源。
2. **`warnOn`**：保留为「prompt 文案」并写清（建议），还是删掉？
3. **`.stdkit/policy.json` 未知键**：error（建议）还是 warning？（error 会让已写错键的仓立刻红，但正是我们要的）
4. **`catalog.schema`**：现在加（建议）还是等到 1.0 一起加？
5. **冻结粒度**：只冻形状（建议）+ 把三条语义（阈值、浅合并、`applies` 相对根）写进 ADR 0004？

---

**§4 已全部完成（0.20.0）**：三处都能冻了，机制是 `policy/compat.json` + `cli/lib/compat.test.mjs` + ADR 0004。
现在的破坏性变更会让 `npm test` 红，并在报错里直接给出三步升级流程（改大版本 / 改快照 / 写 ADR）。
