# 0004 1.0 冻结范围：catalog / policy / 退出码

## 状态

已采纳（0.20.0 起生效）。评估过程与证据见 `docs/v1-freeze-review.md`。

## 背景与问题

三处是**对外契约**，别人会依赖它们写代码：

1. `catalog/rules.json` —— 机器可读索引，pi 扩展、`ds scan` / `ds brief` / 外部工具都读它；
2. `policy/*.json` —— 业务仓用 `.stdkit/policy.json` 覆盖，键名就是 API；
3. `--fail-on` 与退出码 —— CI 门禁只看这两样。

0.19.x 的评估发现两件事，使「现在就冻」不成立：

- **policy 有一半是死键**：`domains` / `extends` / `version` / `stack` 没有任何读取方，`warnOn` 只影响
  prompt 里的一句话；`.stdkit/policy.json` 也没有键白名单（拼错键名静默不生效）。
- **退出码语义不成立**：用法错误（`--severity hight`、未知参数）返回 1，与「发现了阻断级问题」无法区分。
  CI 只看退出码，于是「命令拼错」会被当成「代码有问题」。

## 决策

**只冻形状 + 三条语义**，不冻结具体值或规则集合。

1. **形状快照**：`policy/compat.json` 记录三处契约的键与类型，`cli/lib/compat.test.mjs` 断言
   「键存在且类型不变」。**允许新增可选字段**（进 `ruleOptional`），不算破坏；改名/删键/改类型 → 测试红，
   并直接给出升级步骤（改大版本 + 改快照 + 写 ADR）。
2. **`catalog.schema`**：新增数据格式版本 `schema: 1`，与 `version`（stdkit 产品版本）分开——
   外部工具据此判断「我读的是不是我能读的格式」。
3. **删死键**：`policy.domains` / profile 的 `extends` 删除；`policy.version` 变为活的（`check` 断言 `=== 1`）；
   `stack` 保留但注释写明「没有任何判定读它」（ADR 0002 明确不做多栈，写成配置会误导）。
4. **policy 键白名单**：`default` / `profiles/<n>` / `.stdkit/policy.json` 三层各有允许键集合，
   未知键直接报错（配置写错属「环境错误」→ exit 2；`check` 在 CI 里提前拦）。
   `.stdkit/policy.json` 不允许写 profile 的结构性字段（`stack`）。
5. **退出码三档**：`0` 通过 / `1` 有阻断或失败 / `2` 用法或环境错误。由 `UsageError` 统一，`compat.test.mjs`
   对三种典型命令各断言一次。
6. **三条语义写进快照**（`compat.semantics`，测试断言它们真的被写下来）：
   - `blockOn` / `--fail-on` 是**阈值语义**（该级及以上），逗号列表取最宽松那一级，不是精确集合；
   - policy 三层覆盖是**浅合并**：后者整体替换同名键，不做深合并；
   - `catalog.applies` 是**相对业务仓根**的 glob，不是绝对路径。

## 后果

**好处**

- 外部工具可以按 `schema` 判断兼容性；业务仓写错 policy 键名会立刻报错，而不是「配了但没生效」；
- 「破坏性变更」从口头约定变成一条会红的测试，且提示里直接写着三步升级流程；
- 退出码可以用来区分「代码有问题」与「命令写错了」——这是 CI 最常见的误判来源。

**代价**

- 以后想给规则加**必填**元数据、或给 policy 改键名，都要走大版本；这是刻意的刹车；
- 形状冻结不覆盖语义细节：例如新增可选字段后，其语义仍需在 `docs/rule-format.md` / ADR 里说明。

**触发复盘的时机**

1. 出现「外部工具按旧 schema 解析被静默误读」的事故；
2. 某次改动必须改形状才能完成，且无法作为可选字段兼容——那就走 2.0 流程，顺手更新本文。
