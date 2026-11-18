---
name: write-java
description: >
  按 stdkit 规则写或改 Java 8 / Spring Boot 2.x / MyBatis 后端代码。在要写接口、改 Controller/Service/Mapper、
  动 *.java 或 Mapper XML、改事务/分页/幂等/金额/日志/线程池、提到 JDK8 语法不可用、#{}、${}、BigDecimal、pageSize、多方言 XML，
  或输入 /write-java 时使用。不要用来写 sql/ 交付脚本（用 write-sql），也不要用来审代码（用 /review-java）。
---

# Java 8 后端

权威条文只在本目录 `references/`。规则用稳定 ID 引用（如 `J8-API-01`），不要按章节名回指。

栈：Java 8 · Spring Boot 2.x · MyBatis / MyBatis-Plus

## 条文

- `references/00-language.md`（本 skill 自带，规则正文与元数据）
- `references/01-spring.md`（本 skill 自带，规则正文与元数据）
- `references/02-mybatis.md`（本 skill 自带，规则正文与元数据）
- `references/03-engineering.md`（本 skill 自带，规则正文与元数据）

## 规则索引（71 条）

| 规则 ID | 级别 / 严重度 | 标题 |
|---|---|---|
| `J8-API-01` | must / high | Optional 只作返回值 |
| `J8-API-02` | must / high | long/Long 拆箱必须判空 |
| `J8-API-03` | must / medium | 字符串判空统一走 StringUtils |
| `J8-API-04` | must / critical | 金额必须 BigDecimal |
| `J8-API-05` | must / high | BigDecimal 用字符串构造、用 compareTo 比较 |
| `J8-CMT-01` | should / medium | 注释写为什么，不写是什么 |
| `J8-CMT-02` | should / medium | TODO 必须有工单号，公共方法补 Javadoc |
| `J8-CNT-01` | must / medium | 魔法值提常量或枚举 |
| `J8-COL-01` | must / high | Arrays.asList 定长、subList 是视图 |
| `J8-COL-02` | must / high | Collectors.toMap 必须防重复键 |
| `J8-COL-03` | must / high | 遍历中删除用 Iterator 或 removeIf |
| `J8-COL-04` | must / medium | 判空区分 null 与 empty |
| `J8-CON-01` | must / high | 单例组件禁可变业务字段 |
| `J8-CON-02` | must / high | 线程池必须有界且命名 |
| `J8-CON-03` | must / high | ThreadLocal 与 MDC 必须清理 |
| `J8-DAT-01` | must / high | 时区显式、SimpleDateFormat 不共享 |
| `J8-EXC-01` | must / critical | 禁止空 catch、禁止吞异常 |
| `J8-EXC-02` | must / high | 可关闭资源用 try-with-resources |
| `J8-LOG-01` | must / high | 日志用占位符，禁 System.out |
| `J8-LOG-02` | must / critical | 敏感信息禁止入日志 |
| `J8-MBT-01` | must / high | 复杂 SQL 只写在 XML，禁止注解拼串 |
| `J8-MBT-02` | must / critical | `${}` 只允许服务端白名单 |
| `J8-MBT-03` | must / high | 查询结果必须映射到类型，禁止 resultType="map" |
| `J8-MBT-04` | must / high | 禁止 SELECT *，禁止无 LIMIT 的全表意图 |
| `J8-MBT-05` | must / high | 禁止循环内按条查库（N+1） |
| `J8-MBT-06` | must / high | 批量写入与 IN 必须切批 |
| `J8-MBT-07` | must / critical | 多方言必须同一次提交改齐 |
| `J8-MBT-08` | must / high | 方言差异必须按引擎改写 |
| `J8-MBT-09` | must / high | 写库必须失效缓存，且尽量在提交后 |
| `J8-MBT-10` | must / high | 读路径必须防穿透、击穿与无 TTL |
| `J8-MBT-11` | must / critical | Wrapper 的字符串入口等价于 ${} |
| `J8-MBT-12` | should / low | @TableLogic 等价合规，不得再手写 deleted 条件 |
| `J8-MBT-13` | must / high | Mapper 只做数据访问 |
| `J8-MBT-14` | should / low | 审计字段交给框架填充 |
| `J8-MOD-01` | must / critical | JDK9+ API 与语法禁止进入 J8 代码 |
| `J8-NAM-01` | must / high | 命名约定 |
| `J8-NAM-02` | must / medium | 禁拼音、禁无意义缩写、DTO 后缀开口 |
| `J8-NAM-03` | should / medium | 参数超过 3 个用参数对象，嵌套超过 3 层早返回 |
| `J8-OOP-01` | must / high | 协作依赖用 final 字段 + 构造器注入 |
| `J8-OOP-02` | should / medium | 返回集合要防御性拷贝 |
| `J8-ORG-01` | should / low | 一个文件一个 public 类型，成员顺序固定 |
| `J8-SEC-01` | must / critical | 用户输入禁止进入命令、脚本与模板引擎 |
| `J8-SEC-02` | must / critical | 文件路径必须规范化并校验在允许目录内 |
| `J8-SEC-03` | must / critical | 服务端代请求用户 URL 必须做主机白名单 |
| `J8-SEC-04` | must / critical | 反序列化与危险库限制 |
| `J8-SEC-05` | must / critical | 越权：资源必须校验属主或租户 |
| `J8-SEC-06` | must / high | 定时任务必须防重跑、可观测、可安全重入 |
| `J8-SEC-07` | must / high | 分布式锁必须有 TTL 与持有者标识 |
| `J8-SEC-08` | must / critical | 消息消费必须幂等且有失败出口 |
| `J8-SEC-09` | must / high | 新增依赖必须有理由，配置分环境 |
| `J8-SEC-10` | must / high | 日志与错误响应不得带内部结构 |
| `J8-SPR-01` | must / high | 依赖只允许向下：Controller → Service → Mapper |
| `J8-SPR-02` | must / high | Controller 层禁止 @Transactional |
| `J8-SPR-03` | must / critical | 事务内禁止远程调用与发消息 |
| `J8-SPR-04` | must / high | 同类自调用不走事务代理 |
| `J8-SPR-05` | must / high | 实体不出参：Controller 返回 DTO，不返回 PO/Entity |
| `J8-SPR-06` | must / high | 写接口必须校验：@Valid + 约束注解 + Service 二次业务校验 |
| `J8-SPR-07` | must / high | 禁止 Controller 本地 catch 后把异常消息回给前端 |
| `J8-SPR-08` | must / medium | 同一服务只选一种响应契约 |
| `J8-SPR-09` | must / high | 系统错误只记日志，不回传内部细节 |
| `J8-SPR-10` | must / high | 列表接口必须分页，pageSize 必须有上限 |
| `J8-SPR-11` | must / high | 禁止内存分页与全量导出 |
| `J8-SPR-12` | must / critical | 写路径必须幂等或可安全重试 |
| `J8-SPR-13` | must / high | 并发改同一行必须用版本号或条件更新 |
| `J8-SPR-14` | must / high | 出站调用必须配超时与有限重试 |
| `J8-SPR-15` | must / critical | 环境地址与凭证禁止硬编码 |
| `J8-SPR-16` | must / high | 入口必须生成或透传 traceId 并写入 MDC |
| `J8-SPR-17` | should / medium | API 兼容：字段只增不删，破坏性变更走新路径 |
| `J8-SPR-18` | must / high | 事务注解只放在 Service 层 |
| `J8-SPR-19` | must / medium | 包结构按默认树落位，存量仓按 L3 映射 |
| `J8-STR-01` | should / medium | Stream 用于转换，不用于副作用 |

## 步骤

1. 读业务仓根 `AGENTS.md`（L3）：Java/Vue 版本、engines、API Mode、分页上限、时区、根包、存量包映射。
2. 新项目：复制 stdkit `templates/AGENTS.md` 到业务仓根填满；存量仓只跟随现有结构，禁止为对齐规范搬包。
3. 按需读命中章节：先看规则索引定位 ID，再在 `references/` 里读该条正文与示例。
4. 只改需求范围。多方言有几套改几套。
5. 机械检查自查：`ds scan` （22 条规则带正则守卫，本机可跑）。
6. 写完即止：不写测试、不触发审查、不提交；测试与审查仅人手动触发。

## 约束

- 冲突优先级：业务仓 `AGENTS.md` > 本 skill `references/` > stdkit `policy/` 默认值。
- 回指一律用规则 ID（`J8-API-01`），不用「文件名 §章节」。
- 条文没有的不要凭空发明；不确定先问。
- 示例全部 Java 8 / Vue 2.7 可运行；不要引入版本外语法。
