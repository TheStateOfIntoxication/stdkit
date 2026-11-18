# stdkit

写给 **JDK 8 + Vue 2 + SQL 交付脚本** 项目的工程规范与审查工具包。

规则只写一份（`rules/` 里的 Markdown，每条带稳定 ID），能靠正则一眼判出来的交给本机检查器，
剩下的交给模型读。规则改一次，各客户端要用的 skill / prompt / 适配器一次性重新生成。

**当前：127 条规则，其中 49 条可机器判定（行级）+ 2 条仓级判定；23 个回归用例；40+ 条单测（`npm test`，跨平台入口 `scripts/run-tests.mjs`）。**

## 它解决什么

团队里「代码该怎么写」的约定通常散在 wiki、肌肉记忆、code review 评论和几个 AI 指令文件里。
这些内容有两个通病：**会漂**（同一件事三处写得不一样，谁也不确定哪句最新）和**没法验**
（写了「禁止 double 存金额」，但除了盯着看没有任何东西保证它被遵守）。

stdkit 把这两件事交给机器：规则只有一份，每条有稳定编号；能机判的跑本机正则，判不了的才让模型读。
规则改一次，四类产物（skills / prompts / adapters / AGENTS.md）一起重新生成，不用抄第二遍。

## 五条硬能力

1. **确定性层**：49 条 `deny` 正则在本机跑（行级，精确到行号）+ `ds cross` 判文件集合（仓级：回滚是否配齐、多方言是否齐）。零 token，可接 CI 门禁。
2. **语义层**：77 条上下文规则交给模型，`ds brief` 把「已确认的命中」「仓级待跑的命令」「待判的清单」分开，
   模型不重复劳动。
3. **规则自带回归**：每条可机判规则至少有一个用例命中（`ds eval` 会点数，缺了就红）。
4. **规则仓自我校验**：`ds check` 检查 ID 唯一、`deny` 能命中自己的 `// BAD`、示例 JDK8 可编译、
   prompt 与规则清单一致、加域三向一致。
5. **写前护栏**（pi 扩展）：`write` / `edit` 命中 critical 级规则时直接拦下，与 `ds scan` 共用判定核心。

## 三条日常命令

```bash
npx stdkit scan                     # 全仓确定性检查
npx stdkit brief --diff             # 审查简报：A 类命中 + B 类待判规则
node cli/ds.mjs init <repo>     # 业务仓接入：探测技术栈 → 生成 AGENTS.md + 基线
```

`scan` 管行级、`cross` 管仓级（一条命令、不按行）：

```bash
node cli/ds.mjs cross           # 回滚是否配齐（SQL-RBK-01）、多方言是否齐（SQL-DIA-01）
```

`npx` 时包名是 `stdkit`（`npx stdkit scan`）；`ds` 是装完之后的命令名。

`scan` 的输出长这样：

```text
stdkit scan  /path/to/repo  (全量)  49 条可判规则 / 388 文件

src/main/java/com/x/order/OrderService.java
  37  [C] J8-API-04  private double amount;
  88  [H] J8-SPR-10  return orderMapper.selectAll();

critical 1 · high 1   共 2
```

## 文档

| 文档 | 内容 |
|---|---|
| [docs/install.md](docs/install.md) | 五端安装（pi / Claude Code / Codex / Cursor / Copilot）、卸载、排查 |
| [docs/commands.md](docs/commands.md) | 14 个命令与全部参数、退出码、策略与豁免 |
| [docs/concepts.md](docs/concepts.md) | 概念一页纸：rules / policy / catalog / dist / baseline 怎么串起来 |
| [docs/limits.md](docs/limits.md) | **已知限制**（38% 可判上限、单栈、护栏覆盖范围、不替代 review、不提供 demo） |
| [docs/rule-format.md](docs/rule-format.md) | 规则怎么写（元数据块、自检规则、推荐措辞） |
| [docs/architecture.md](docs/architecture.md) | 分层设计、为何不做 AST、与 p3c-pmd / ESLint 的分工 |
| [docs/static-analysis.md](docs/static-analysis.md) | 静态分析的边界：哪些形态抓不到 |
| [docs/provenance.md](docs/provenance.md) | 规则来源与原创性声明 |
| [docs/publish-checklist.md](docs/publish-checklist.md) | 发布前检查清单（含脱敏） |
| [docs/adr/](docs/adr/) | 架构决策记录：跨文件层只做两条、不做 Vue3/JDK17、语义层回归不进 CI |

## 先知道的三个限制

1. **只覆盖单栈**：JDK 8 + Vue 2（Options API）+ 团队约定的 SQL 交付脚本。JDK 17 / Vue 3 / TypeScript
   没有规则域，强行用会看到误报（`record`、`<script setup>` 都会被判违规）。
2. **可机判的是少数**：127 条里 49 条能自动判，其余 79 条靠模型读条文。条文里写「需人工确认」的，
   就是机器抓不到的——**没报不等于没问题**。
3. **不替代 review**：它管形态（`private double amount;`），判断不了「这个事务边界对不对」。

完整清单见 [docs/limits.md](docs/limits.md)。

## 与同名 skill 包共存

skill 目录按名字寻址（`write-java` / `write-vue` / `write-sql`），所以**同一台机器上不要同时启用
两套同名的规范包**——后装的会覆盖先装的。`ds doctor` 会在常见 skill 槽位探测到同名外部包时给 WARN。

`ds install --all` 装之前会打印目标路径，可以先确认有没有旧包占用（`--uninstall` 只删本仓写过的 manifest 条目）。
## 授权

MIT，见 [LICENSE](LICENSE)。规则来源与原创性说明见 [docs/provenance.md](docs/provenance.md)。
