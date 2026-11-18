# 工程规范（stdkit）

java-jdk8 71 · sql 20 · test 10 · vue 26。规则以稳定 ID 引用；条文细节在对应 skill 的 `references/`。

## 开工

1. 先读业务仓 `AGENTS.md`（L3）与构建/依赖文件，再动手。
2. 非琐碎改动按信号激活写 skill：`write-java` / `write-vue` / `write-sql` / `write-test`（测试仅在明确要求时）。
3. 不确定先问；条文没有的不要凭空发明。

## 信号

| 信号 | 写（自动激活） | 审（仅手动） |
|---|---|---|
| `*.java` · Mapper XML · Spring · MyBatis | `write-java` | `/review-java` |
| `sql/install` · `sql/upgrade` | `write-sql` | `/review-sql` |
| `*.vue` · Vue 2 · Element UI | `write-vue` | `/review-vue` |
| 同一 PR 跨 Java + 前端 + SQL | 各走各 skill | `/review-fullstack` |

## 必须

- 只改需求范围。禁止顺手重构、搬包、全文件格式化存量。
- 金额用 `BigDecimal`，禁止 `double`/`float` 存算（`J8-API-04`）。
- 列表必须分页且 pageSize 有上限（`J8-SPR-10`）。
- 写路径必须幂等或可安全重试（`J8-SPR-12`）；事务内禁止远程调用与发消息（`J8-SPR-03`）。
- `${}` 只允许服务端白名单（`J8-MBT-02`）。
- 密钥只来自环境变量 / 配置中心；禁入仓库、日志、前端包（`J8-SPR-15`、`V2-SEC-01`）。
- 多方言同一次提交改齐（`J8-MBT-07`、`SQL-DIA-01`）。
- 写完即止：不写测试、不触发审查、不提交。

## 审查（人手动触发）

- 审查是独立动作：写侧不自行调用、不纳入写任务。
- 先跑 `ds scan --diff`（行级）+ `ds cross`（仓级），再谈语义审查。
- **审查只给修改建议，不代改**：每条带 `文件:行` + 具体改法 + 规则 ID；
  只有用户明确说「改」时才按 write-* skill 修改。
- `critical / high` 未修 → Block；历史存量非本次引入 → 不 Block。

## 提交

- 首行 `type: 摘要`（feat / fix / refactor / chore / docs / perf / test / revert）。
- 涉及 SQL / 多库 / 配置 / 任务 / 缓存 / API：提交说明带 `影响:` 行。
- 一个需求一个提交；大范围格式化单独提交。
