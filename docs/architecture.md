# 架构

## 四层判定

判定按「判据在哪」分四层，每层只做自己能做的那部分：

| 层 | 判据 | 命令 | 产出 |
|---|---|---|---|
| 行级 | 单行文本形态 | `ds scan` | `规则ID:行号` |
| 仓级 | 文件集合（目录、文件名） | `ds cross` | `规则ID:文件` |
| 语义 | 调用链、数据关系、跨文件语义 | 模型（`ds brief` 的 B 类） | 审查结论 |
| 人工 | 规范说不清的取舍 | 人 | 「需人工确认」 |

生成链只有一条：

```text
rules/   规则正文（人读 + 模型读）       ← 唯一事实源
policy/  严重级、阻断阈值、profile      ← 可调，不改规则
产物     skills / prompts / adapters    ← 生成，不手改
```

任何一份产物都能由 `rules/` + `policy/` 重建。改产物 = 改错层。

## 确定性检查层

规范里有两类约束，混在一起是传统做法的最大浪费。

**A 类｜形态可判**：看单个文件的一段文本就能下结论。

```text
金额字段声明成 double                → 正则
catch 块为空                        → 正则
new BigDecimal(0.1)                 → 正则
SQL 里出现 ${}                       → 正则
Controller 直接返回 *PO              → 正则
UPDATE / DELETE 无 WHERE            → 正则
日志里拼 "password=" + pwd           → 正则
```

**B 类｜上下文可判**：要看多个文件、调用链、语义才能下结论。

```text
这次写路径是否幂等（要查唯一键、状态机、重试语义）
事务里是否夹了远程调用（要跟调用栈）
这个接口有没有水平越权（要资源属主关系）
多方言 XML 是否只改了一侧（要比对目录）
缓存写库后有没有失效（要追读路径）
```

传统做法把 A 和 B 一起塞给模型 → 模型必须把全文读进上下文，逐行「看」，A 类占了大半 token，还是概率性命中。

**确定性检查层**：把 A 类抽成规则里的 `deny` / `allow` 正则，由 `ds scan` 在本机跑完，输出带 `规则ID:行号` 的精确清单：**零 token、可复现、单行形态零漏报**。模型只审 B 类，读的也只剩 B 类规则。

它能做到和做不到的，分开说清楚：

| 能做到 | 做不到 |
|---|---|
| 单行形态（金额 double、空 catch、`${}`、JDK9+ API）零漏报 | 跳行结构：跳行空 `catch`、多行 `UPDATE ... WHERE` |
| 结果可复现，不受模型随机性影响 | 语义：幂等、事务边界、越权、多方言同步 |
| 误报可用 `allow`（行级）/ `exclude`（文件级）/ 基线豁免压下去 | 看文件名之外的结构（除 `exclude` 的整文件例外） |

代价与边界：

- 正则只能覆盖「形态」，不能覆盖「意图」。误报用 `allow` 压，不要为此放宽 `deny`。
- 每条 `deny` 必须有对得上的 GOOD/BAD 示例，否则就是凭想象写的正则。
- 确定性检查层**不替代**审查，它替代的是「让模型数行数」。

实现已完成（`cli/lib/scan.mjs`）：

```bash
$ ds scan --diff          # 只查本次变更

src/main/java/com/example/OrderService.java
  8   [C] J8-API-04  private double amount;
  15  [C] J8-MOD-01  String s = id.isBlank() ? "x" : id;
  19  [C] J8-EXC-01  } catch (Exception e) { }

critical 2 · high 1   共 3      # 退出码 1
```

### 仓级（`ds cross`）

有些问题判据不在单行文本里，而在**文件集合**：某个正向脚本有没有同名回滚、L3 声明的方言目录是否齐。
这类给不出「单一行号」，给的是「哪个文件有问题」，所以用独立命令而不是塞进 `ds scan`
（否则 `--diff` 与 baseline 的行级豁免语义会被破坏）。

```bash
$ ds cross
  SQL-RBK-01  [H]  sql/upgrade/mysql/002_b.sql
      缺同名回滚（upgrade/mysql/rollback/002_b.sql 或 sql/rollback/mysql/002_b.sql）
```

只做判据是**目录与文件名**的两条（ADR 0001）：需要「语义等价」判断的（如两份 XML 是否同步）不做。
非标准布局直接跳过——宁可不查，也不误报。

### 与审查流程的衔接

`ds brief` 把三层分开放：A 类（行级命中，含行号）、仓级（提示跑 `ds cross`）、B 类（要模型判的清单）。
模型拿到的不是「全文」，而是「已经确认的 + 只有你能判的」，不重复劳动。

## 为什么规则带 ID

中文章节名做引用（`01-spring.md §事务边界`）的问题：

1. 改一次标题，全仓引用断链，且无人发现。
2. 不是有效的 URL 锚点，工具无法校验。
3. 判级只能附着在章节上，没法「只给这一条降级」。

规则 ID 解决三件事：引用可校验、判级可单条覆盖、可被 lint/CI/评测复用。

## 目录与生成关系

```text
rules/  ──parse──▶ catalog/rules.json ──build──▶ skills/ prompts/ adapters/
   │                     │
   └──check──────────────┘   check 同时扫 policy/ 与 package.json（版本同步）
```

`catalog/rules.json` 是唯一中间产物：确定性可复现（无时间戳）、随规则同提交。

## 冲突优先级

业务仓 `AGENTS.md`（L3） > stdkit `rules/` > `policy/` 默认值。

L3 里只能写**本仓特有**的变量（Java 版本、engines、API Mode、分页上限、时区、根包、存量包映射），不能重写通用规则——那会让规则失去可校验性。

## 里程碑

| 阶段 | 内容 |
|---|---|
| M1 | 骨架 · 规则格式 · `ds check` · `ds catalog` · JDK8 语言规则 |
| M2 | Spring / MyBatis / SQL / Vue2 / 测试规则；L3 模板 ✅ |
| M3 | `ds build` → skills / prompts / adapters（pi 一等公民）✅ |
| M4 | 确定性检查引擎 ✅ · `ds scan --diff` ✅ · `ds brief` ✅ · JSON 输出 ✅ · 接入审查流程 ✅ · 基线豁免 ✅ · CI 门禁 ✅ · pi 扩展（ds_check + 写前护栏）✅ |
| M5 | `evals` 回归 · baseline / waiver · 跨平台安装器 ✅ |
| M6 | 可靠性：护栏抽 `cli/lib/guard.mjs` 可测 · `policy` 单条判级 · prompt ↔ catalog 断言 ✅ |
| M7 | 内容：Java 手艺 5 条 · Element 2 条 · `init --scaffold` · SQL 登记表 ✅ |
| M8 | 分发与开源就绪：LICENSE · `ds publish-check` · 文档重构 · `ds install` ✅ |
| M9 | 决策记录（`docs/adr/`）+ 落地 `ds cross` ✅ |
