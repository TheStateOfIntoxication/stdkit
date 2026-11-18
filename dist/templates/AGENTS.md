# AGENTS.md — 项目 L3

> 复制到业务仓根，初始化时填满。只写**本项目**的变量与现状，不重写通用规则。
> 冲突优先级：本文件 > stdkit `rules/` > `policy/` 默认值。

## 项目信息（必填）

| 项 | 值 |
|---|---|
| 项目名 | |
| 仓类型 | 全栈 / 仅后端 / 仅前端 |
| Java | 8（`<maven.compiler.source/target>`、`.toolchain`） |
| Spring Boot | 2.x |
| 持久化 | MyBatis / MyBatis-Plus（写版本） |
| **engines** | mysql,postgres,kingbase,oracle（逗号分隔，只写本项目实际支持的） |
| Mapper 路径 | `resources/mapper/<dialect>/` 或扁平 `resources/mapper/` |
| SQL 目录 | `sql/`（install / upgrade / rollback 见 `SQL-DIR-01`） |
| API 契约 | Mode B（`{code,message,data}`，成功码 `0`）/ Mode A |
| 成功码 | |
| 分页 | 默认 20 / 最大 100（实现：PageHelper / MyBatis-Plus / 手写 LIMIT） |
| 时区 | `Asia/Shanghai` / UTC 存储 + 展示转换 |
| 根包 | `com.xxx.yyy` |
| 包结构 | `new-default`（按技术层）/ `feature`（按业务域）/ `legacy`（存量，禁搬包） |
| 存量包映射 | 例：`web≈controller，biz≈service，dao≈mapper` |
| 测试 | JUnit 4 + Mockito / JUnit 5；Jest + @vue/test-utils |
| 规范版本 | stdkit vX.Y.Z |

## 前端信息（全栈/前端仓填）

| 项 | 值 |
|---|---|
| Vue | 2.7 |
| UI | Element UI 2.15 |
| 语言 | JavaScript（ES6+，禁 TS） |
| 状态 | Vuex 3（`namespaced: true`） |
| 路由 | Vue Router 3（hash） |
| HTTP 封装 | `@/utils/fetch` |
| 接口基址 | 环境变量 / 全局配置（禁页面内拼 IP） |
| 构建 | vue-cli / webpack（版本） |
| 别名 | `@/` → `src/` |
| i18n 目录 | `src/language/`（中英 Key 必须一一对应） |

### Element UI 本项目约定（产品特定值写这里，不写进通用规则）

| 项 | 值 |
|---|---|
| 表格默认高度 | 如 `:height="tableHeight"`，列表页统一取 `window.innerHeight - 220` |
| 分页 `page-sizes` | 如 `[20, 50, 100, 200]`（与后端 `pageSize` 上限一致） |
| 图标 | 只用 Element UI 内置图标集（本项目不引入第二个图标库） |
| 路由模式 | hash / history（与部署方式一致） |
| 弹窗宽度 | 如 720 / 900 两档，禁止百分比宽度 |

> 这些值因项目而异（分页档位、图标集、路由模式），所以放 L3 而不是 `rules/vue/`：
> 通用规则里写死具体数字，别的仓就得删规则。

## 本项目约定（填了就生效，留空即按默认）

- 金额精度与舍入：
- 软删字段与审计字段：
- 缓存 key 规则与 TTL：
- 出站超时（连接/读）与重试：
- 定时任务框架与分布式锁：
- 日志 logger 名与 MDC 字段：
- 越权校验方式（资源属主/租户）：
- 业务硬约束（状态机、不可逆操作、审批规则）：

## 存量现状（legacy 仓必填）

- 已知与规范不符但暂不动的项（基线债，本次不引入不 Block）：
- 迁移计划与截止迭代：

## Agent（勿删）

- 写：按 skill `write-java` / `write-vue` / `write-sql` 的规则 ID 执行。
- 审：只手动触发 `/review-java` / `/review-vue` / `/review-sql` / `/review-fullstack`。
- 机械校验先跑 `node <stdkit>/cli/ds.mjs scan --diff`（行级）+ `node <stdkit>/cli/ds.mjs cross`（仓级：回滚是否配齐、多方言是否齐），再谈语义审查。
- 只改需求范围；不为对齐规范搬包、不为对齐目录改存量。
