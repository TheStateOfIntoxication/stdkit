# 本仓开发须知

改 stdkit 之前读这个。业务仓的规范不在本文件，在 `rules/`。

## 结构职责

| 路径 | 职责 | 手改 |
|---|---|---|
| `rules/**/*.md` | 唯一事实源。规则正文 + 机器可读元数据块 | ✅ |
| `policy/*.json` | 严重级映射、阻断阈值、profile | ✅ |
| `catalog/rules.json` | 机器可读索引 | ❌ 由 `ds catalog` 生成 |
| `dist/` | 全部 Agent 产物（skills · prompts · extensions · adapters · templates） | ❌ 由 `ds build` 生成 |
| `extensions/` | pi 扩展源码（`ds_check` 工具 + 写前护栏） | ✅ |
| `evals/cases/` | 确定性层回归用例（fixtures + 手写期望行号） | ✅ |
| `cli/` | `ds` 实现 | ✅ |
| `templates/` | 业务仓 L3 模板 + CI 门禁 | ✅ |
| `docs/` | 规则格式 · 架构 · 规则落点分工 | ✅ |

`catalog/` 与 `dist/` 必须与 `rules/` 同一次提交；`ds check` 会报 stale。
改完规则的标准动作：`node cli/ds.mjs catalog && node cli/ds.mjs build && node cli/ds.mjs check && node cli/ds.mjs eval`。

动 `deny`/`allow` 时必须同步 `evals/cases/` 的期望：回归会告诉你到底漏报还是误报，不要靠读正则猜。

## 改规则

1. **事实只放一处。** 同一约束不要在 `rules/` 里写两遍，也不要写进 `cli/` 或 `docs/`。
2. **稳定 ID。** 格式 `域-分类-序号`，一经发布不改号；删规则保留 ID 并标 `status: retired`。
3. **正文写「为什么 + 边界」。** 不写「是什么」，不复述代码。
4. **示例必须 J8 可编译。** `ds check` 会扫 `record` / `var` / `isBlank()` / `transferTo` 等 JDK9+ 构造。
5. **回指用规则 ID**，不用文件名+中文章节名（改名即断链）。
6. **不写占位符。** `TBD` / `TODO` / `xxx` / `__X__` 会被 `ds check` 拒。
7. 判级写进元数据块 `severity`，不写进正文。正文提到级别只在「同一条规则因上下文升/降级」时说明。
8. **条文里写不出来的例外用机制表达**，不要写「建议注意」：行内 `allow`、文件级 `exclude`、
   看注释用 `raw`、词法关键字避开字符串用 `noString`。写不出来就在正文里明写「需人工确认」。
9. **加 JDK9+ 构造**（`List.of` / `var` / `record` 这类版本闸门）要改**两处**：
   `policy/jdk8-api.json` + `J8-MOD-01` 的 `deny`（pattern 逐字一致），
   并在 `// BAD` 补一行样例。细节见 `docs/rule-format.md` §JDK9+ 构造清单。

## 审查约定

- 审查（`/review-*`、`ds brief`）**只产出修改建议**：`文件:行` + 具体改法 + 规则 ID，**不代改**。
- 修改只在用户明确指令后执行；写侧不自行发起审查，审查侧不自行改代码。
- 给业务仓提修复建议时同样遵守：不改对方代码，只说改哪、怎么改；要不要豁免由人决定。

## 加域

新域实际要动 **5 处**，漏一处就会「注册了域但没产物」：

1. `rules/<domain>/`（规则文件）
2. `cli/lib/parse.mjs` `DOMAINS`（ID 前缀）
3. `cli/lib/build.mjs` `SKILLS`（哪个 skill 带这个域）
4. `cli/lib/build.mjs` `REVIEWS` + `reviewPrompt` 里的 `scopes` 三元（prompt 指向的文件）
5. `cli/lib/init.mjs` `SKILL_OF_DOMAIN`（doctor 校验 references 收录）

收尾跑 `ds catalog && ds build && ds check && ds eval`；`check` 会断言三向一致（DOMAINS ↔ SKILLS ↔ 目录）与 prompt/SKILL 清单完整。

## 提交

- 首行 `type: 摘要`，type ∈ `feat` `fix` `docs` `refactor` `chore` `test`。
- 改规则、改判级、改 ID → 提交说明带 `影响:` 行，写明影响面（如 `影响: 规则 J8-API-02 判级 critical→high`）。
- `catalog/` 生成物与规则必须同一次提交，避免索引与正文不一致。
- `dist/` 同理：`ds check` 对 catalog 与 dist 都做陈旧检测。
- 新增文件必须 `git add`；交付前 `git status --porcelain` 的 `??` 必须为空。
- **仓根只放白名单文件**（`AGENTS.md` / `CHANGELOG.md` / `README.md` / `LICENSE` / `package.json` /
  `install.*` / `.*`）：一次性脚本放 `.tmp/` 或仓外。`ds check` 会给 warning 点名——
  根目录出现陌生文件，在这个仓里本身就是「有人手工绕过了机制」的信号。

## 原则

简洁、清晰、高效：宁可少一条规则，也不要写一条无法判定、无法举例、无法回指的规则。
