---
name: write-sql
description: >
  按 stdkit 规则写 sql/ 下的多库交付脚本（MySQL / PostgreSQL / Oracle / Kingbase）：目录布局、命名、中文文件头、同名回滚、
  幂等 DDL/DML、方言差异、风险分级。在要写升级/回滚脚本、改表、加字段、幂等、方言，或输入 /write-sql 时使用。
  不要用来改 MyBatis Mapper XML（用 write-java）。
---

# SQL 交付脚本

权威条文只在本目录 `references/`。规则用稳定 ID 引用（如 `SQL-BAN-01`），不要按章节名回指。

栈：MySQL / PostgreSQL / Oracle / Kingbase

## 条文

- `references/00-delivery.md`（本 skill 自带，规则正文与元数据）

## 规则索引（20 条）

| 规则 ID | 级别 / 严重度 | 标题 |
|---|---|---|
| `SQL-BAN-01` | must / critical | 禁止无 WHERE 的 DELETE |
| `SQL-BAN-02` | must / critical | 禁止 DROP DATABASE / SCHEMA |
| `SQL-BAN-03` | must / critical | 禁止明文凭证 |
| `SQL-BAN-04` | must / high | 禁止吞错 |
| `SQL-DIA-01` | must / critical | 变更必须覆盖 L3 声明的全部 engines |
| `SQL-DIA-02` | must / high | 各方言原生守卫，禁止跨方言照抄 |
| `SQL-DIA-03` | must / high | MySQL 专有语法不得出现在 PG / Kingbase 目录 |
| `SQL-DIR-01` | must / high | 目录布局固定：install / upgrade / rollback |
| `SQL-EXE-01` | must / high | install 与 upgrade 不得混跑 |
| `SQL-EXT-01` | must / high | 删列 / 收紧约束走扩展-收缩 |
| `SQL-HDR-01` | must / high | 文件头必填项不得留模板占位 |
| `SQL-IDM-01` | must / high | DDL 幂等用本引擎原生守卫 |
| `SQL-IDM-02` | must / high | seed 用存在性判断，别用覆盖写 |
| `SQL-IDM-03` | must / high | 幂等 ≠ 安全 |
| `SQL-NAM-01` | must / medium | 文件名 `{序号}_{描述}.sql`，不带产品版本号 |
| `SQL-RBK-01` | must / high | 正向必须配同名回滚，执行序为反序 |
| `SQL-RDM-01` | should / medium | `sql/README.md` 必须维护到可自助执行 |
| `SQL-RSK-01` | must / high | 按 L1 / L2 / L3 分级并写进「说明」 |
| `SQL-RSK-02` | must / high | DROP TABLE / TRUNCATE / 大表 ALTER 必须带控制措施 |
| `SQL-TYP-01` | must / medium | 类型按方言对照，不假设通用 |

## 步骤

1. 读业务仓根 `AGENTS.md`（L3）：Java/Vue 版本、engines、API Mode、分页上限、时区、根包、存量包映射。
2. 新项目：复制 stdkit `templates/AGENTS.md` 到业务仓根填满；存量仓只跟随现有结构，禁止为对齐规范搬包。
3. 按需读命中章节：先看规则索引定位 ID，再在 `references/` 里读该条正文与示例。
4. 只改需求范围。多方言有几套改几套。
5. 机械检查自查：`ds scan` （7 条规则带正则守卫，本机可跑）。
6. 写完即止：不写测试、不触发审查、不提交；测试与审查仅人手动触发。

## 约束

- 冲突优先级：业务仓 `AGENTS.md` > 本 skill `references/` > stdkit `policy/` 默认值。
- 回指一律用规则 ID（`SQL-BAN-01`），不用「文件名 §章节」。
- 条文没有的不要凭空发明；不确定先问。
- 示例全部 Java 8 / Vue 2.7 可运行；不要引入版本外语法。
