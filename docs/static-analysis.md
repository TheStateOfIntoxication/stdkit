# 规则落点：谁该执行哪条

同一条约束有三种执行方式，用错地方就白花成本。

| 落点 | 适合 | 特点 |
|---|---|---|
| 静态分析（p3c-pmd / ESLint / Checkstyle / SpotBugs） | 纯语法、AST 可判、团队已有 IDE 插件 | 编辑器里实时红，成本最低，规则最成熟 |
| `ds scan`（stdkit `deny` 正则） | 行内形态可疑、但现有插件没覆盖（JDK9+ API、`${}`、明文密钥、SQL 无 WHERE） | 零 token、随 stdkit 版本走，可加豁免 |
| 人 / 模型 | 需调用链、跨文件、语义（幂等、事务边界、越权、多方言同步） | 唯一能判的一类，也是唯一必须花钱的一类 |

## 建议分工

| 规则族 | 首选落点 | 补充 |
|---|---|---|
| `J8-NAM-*` 命名 | p3c-pmd（`LowerCamelCaseVariableNamingRule`、`ClassNamingShouldBeCamelRule` 等在 IDE 里实时提示） | — |
| `J8-CMT-01` 注释约定 | p3c-pmd（类/方法 javadoc 规则） | `ds check` 不查业务仓注释风格 |
| `J8-CON-02` 线程池 | p3c-pmd（禁止 `Executors` 手工建池类规则） | `J8-CON-02` 的 `deny` 作为双保险 |
| `J8-API-04` 金额 double | **stdkit `ds scan`**（p3c 无等价） | 写前护栏也拦 |
| `J8-MOD-01` JDK9+ API | **stdkit `ds scan`**（静态分析需要配置 JDK 版本矩阵，成本高） | 写前护栏 |
| `J8-MBT-02` `${}` | **stdkit `ds scan`**（XML + Java 两侧） | 人工确认白名单 |
| `J8-SPR-15` / `V2-SEC-01` 凭证 | **stdkit `ds scan`** | 仓库侧再配 Secret 扫描（gitleaks 等） |
| `SQL-BAN-*` 危险 SQL | **stdkit `ds scan`** | 大表/锁评估只能人工 |
| `V2-QLT-01` console / debugger | ESLint（`no-console`、`no-debugger`） | `ds scan` 兜底 |
| `V2-BASE-01` 禁 script setup | ESLint（`vue/no-*` / 自定义） | `ds scan` 兜底 |
| `J8-SPR-03` 事务内远程、`J8-SPR-12` 幂等、`J8-SEC-05` 越权 | **只能人 / 模型** | `ds brief` 把它们列进 B 类清单 |
| `SQL-DIA-01` 全量方言集 | **`ds cross`**（仓级：比对方言目录与脚本序号） |

## 怎么用

1. CI 里先跑 `templates/ci/gate.sh`（`ds check` + `ds scan --diff`）——这一步不花钱。
2. 静态分析工具按团队既有配置跑，不重复配置上面的 stdkit `deny`。
3. 审查时 `ds brief --diff`，模型只读 B 类清单。

## 不做什么

- 不把 `deny` 写成 AST 分析器。需要语义的规则就老实交给模型，硬用正则只会制造误报。
- 不复制 p3c-pmd 已有规则。已有的就用已有的，stdkit 只补它没覆盖的部分。
- 不追求「零误报」。误报用 `allow` 或 `.stdkit/baseline.json` 压，不为个别误报放宽整条规则。
