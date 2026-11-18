# 概念一页纸

```text
rules/*.md  ──catalog──▶  catalog/rules.json  ──build──▶  dist/
    ▲                          │                            │
    │                          ▼                            ▼
 你改这里               ds scan / brief / eval        skills / prompts /
                                                       adapters / AGENTS.md
                        ▲
                        │
policy/*.json ──────────┘（阻断阈值 + 单条降级）
业务仓 .stdkit/policy.json ─┘
业务仓 .stdkit/baseline.json ──▶ 豁免（有到期日）
业务仓 AGENTS.md（L3）──▶ 给模型看的本仓变量（机判不读）
```

## 五个概念

**rules/** — 唯一事实源。每条规则是一个 `###` 标题 + 一个 ```txt rule 元数据块 + 正文。
规则只写在这里，其余全是生成物。

**catalog/** — `ds catalog` 生成的机器可读索引（`rules.json`）。`ds scan` 与 `ds build` 都读它；
`ds check` 会校验它与 `rules/` 一致。

**dist/** — `ds build` 的完整产物：4 个 skill、4 个 review prompt、4 个客户端适配文件、
`AGENTS.md`，外加 `cli/` 与 `catalog/` 的副本（所以 dist 自包含）。
**不要手改 dist**，改了 `rules/` 重新 build 即可。

**policy/** — 决定「什么级别算阻断」。三层覆盖：`policy/default.json` ←
`--profile <name>` ← 业务仓 `.stdkit/policy.json`。还能按单条规则改生效级：
`{"severity":{"J8-SPR-10":"medium"}}`。

**baseline** — 业务仓 `.stdkit/baseline.json`，把「历史存量、本次不动」的点登记掉。
豁免是**文件级**的，必须写 `until`，过期自动失效并重新计入。

## 规则的五个机制

一条规则能用的手段只有这五个，其它都是它们的组合：

| 机制 | 作用 | 例子 |
|---|---|---|
| `deny` | 命中即违规（确定性层） | `deny: private\s+double\s+\w+` |
| `allow` | 行级例外，命中则豁免 | 登录兜底 `window.location.href = '/login'` |
| `exclude` | 文件级例外，整文件不查 | `exclude: **/utils/fetch.js` |
| `raw` | 不剥注释（规则本身要看注释） | `TODO` 检查：`TODO` 就在注释里 |
| `noString` | 先抹空字符串内容再匹配 | 词法关键字：`var` / `record` |

对应的写法约束见 `docs/rule-format.md`；它们的**边界**见 `docs/limits.md`。

## 两类约束，两种处理

| | 形态可判 | 上下文可判 |
|---|---|---|
| 例子 | `private double amount;`、空 `catch`、`${}`、`SELECT *` | 事务边界、幂等、越权、多方言同步 |
| 手段 | `deny` 正则，本机跑 | 条文正文，模型读 |
| 成本 | 0 token，精确到行 | 要读调用链 |
| 命令 | `ds scan` | `ds brief` 的 B 类清单 |
| 数量 | 49 条 | 78 条 |

`specific` 的分工细节见 `docs/architecture.md`。

## 一条规则的生命周期

1. 在 `rules/<domain>/xx.md` 里写条文（元数据 + 规则 + 为什么 + GOOD/BAD 示例）。
2. `ds catalog && ds build` —— 生成索引与产物。
3. `ds check` —— 自检：`deny` 能不能命中自己的 BAD、示例是不是 JDK8、prompt 清单是否完整。
4. 在 `evals/cases/` 加一个 fixture（命中的算 `*-bad`，不该命中的算 `*-clean`），`ds eval`。
5. 如果它是 `critical` / `high`，`ds scan` 会开始阻断——**新规则上线前先拿真实仓量一遍误报**。
