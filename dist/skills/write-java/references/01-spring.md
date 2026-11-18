# Java JDK8 · Spring

> Spring Boot 2.x（Java 8）。示例全部 Java 8 可编译。`p3c:` 为《Java 开发手册》章节序号，无对应条款写 `-`。

## 分层与依赖

### J8-SPR-01 依赖只允许向下：Controller → Service → Mapper

```txt rule
level: must
severity: high
tags: layering
applies: **/controller/**/*.java, **/*Controller.java
deny: (?:private|protected|public)\s+(?:final\s+)?\w*Mapper\s+\w+\s*;
p3c: 工程结构 2
```

**规则**：Controller 只做收参、`@Valid`、调 Service、包装响应。禁止注入 Mapper、禁止写业务 `if`/状态机/计价、禁止事务注解。

**为什么**：Controller 直连 Mapper 后，同一段业务规则会在多个接口里各写一遍，改口径时必然漏改；也让事务边界失去唯一落点。

```java
// GOOD
@RestController
@RequiredArgsConstructor
public class OrderController {
    private final OrderService orderService;

    @PostMapping("/orders")
    public Result<OrderResp> create(@Valid @RequestBody CreateOrderReq req) {
        return Result.ok(orderService.create(req));
    }
}

// BAD
@RestController
public class OrderController {
    @Autowired
    private OrderMapper orderMapper;

    @PostMapping("/orders")
    public Result<?> create(@RequestBody CreateOrderReq req) {
        if (req.getAmount().signum() < 0) {
            return Result.fail("ERR", "负数");
        }
        orderMapper.insert(req);
        return Result.ok(null);
    }
}
```

### J8-SPR-02 Controller 层禁止 @Transactional

```txt rule
level: must
severity: high
tags: transaction
applies: **/controller/**/*.java, **/*Controller.java
deny: @Transactional
p3c: -
```

> 本规则按路径机判，只抓 Controller；Mapper 侧由 `J8-MBT-13` 抓，其余位置（`@Component` / `@Repository` / 工具类）
> 正则判不了类身份，由 `J8-SPR-18` 进审查清单人工判。

**规则**：`@Transactional` 只放 Service（或明确的应用服务类）。只读查询用 `@Transactional(readOnly = true)`。Mapper 方法不加事务注解。

**为什么**：Controller 上的事务把参数校验、响应序列化也圈进事务，长事务锁行；Mapper 上的注解不参与 Service 事务边界，只在被单独调用时生效，语义分裂。

```java
// 正确位置：Service 内部方法上；只读查询加 readOnly
@Service
public class OrderService {
    @Transactional(rollbackFor = Exception.class)
    public OrderResp create(CreateOrderReq req) { }

    @Transactional(readOnly = true)
    public OrderResp get(Long id) { }
}

// BAD
@Transactional
@PostMapping("/orders")
public Result<?> create(@RequestBody CreateOrderReq req) { }
```

> 正确样例故意不加 `// GOOD` 标记：本规则的 `deny` 按路径限定（只查 controller），
> 若标 GOOD 会与自检“deny 不得命中 GOOD”相冲。写法见 `docs/rule-format.md` §自检。

### J8-SPR-03 事务内禁止远程调用与发消息

```txt rule
level: must
severity: critical
tags: transaction, outbound
applies: **/*.java
p3c: -
```

**规则**：事务方法内禁止 HTTP/RPC 调第三方、禁止发 Kafka/RocketMQ/AMQP、禁止等 SMTP/大文件 IO。副作用走 `afterCommit`、`@TransactionalEventListener(AFTER_COMMIT)` 或 Outbox 表。

**为什么**：对端超时会把本地事务拖成分钟级长事务，锁住行；更糟的是本地回滚而对端已扣款，产生无法自动修复的数据不一致。

```java
// GOOD — 本地事务 + 提交后事件
@Transactional
public void create(CreateOrderReq req) {
    orderMapper.insert(toPO(req));
    publisher.publishEvent(new OrderCreatedEvent(req.getOrderNo()));
}

// BAD — 事务内远程，对端超时即长事务
@Transactional
public void create(CreateOrderReq req) {
    orderMapper.insert(toPO(req));
    payClient.preAuth(req);
}
```

### J8-SPR-04 同类自调用不走事务代理

```txt rule
level: must
severity: high
tags: transaction
applies: **/service/**/*.java
p3c: -
```

**规则**：`@Transactional` 方法不得被同一个类内的方法用 `this.xxx()` 调用后当作有事务使用。需要事务的步骤抽到另一个 Bean，或自注入代理。

**为什么**：Spring 事务基于代理，自调用绕过代理，注解静默失效——第二次写失败时第一次写已提交。

### J8-SPR-05 实体不出参：Controller 返回 DTO，不返回 PO/Entity

```txt rule
level: must
severity: high
tags: api, dto
applies: **/controller/**/*.java
deny: Result<\s*\w*(?:PO|Entity|DO)\s*>
p3c: 工程结构 5
```

**规则**：对外接口入参用 `*Req`，出参用 `*Resp`/`*VO`。`*PO` 只在持久化层流转。映射可手写或 MapStruct。

**为什么**：PO 直接出参等于把表结构暴露成 API 契约，加一个内部字段就是一次对外不兼容变更，还会连带泄漏 `deleted`、`create_by` 等内部列。

```java
// GOOD
@GetMapping("/orders/{id}")
public Result<OrderResp> get(@PathVariable Long id) {
    return Result.ok(orderService.get(id));
}

// BAD
@GetMapping("/orders/{id}")
public Result<OrderPO> get(@PathVariable Long id) {
    return Result.ok(orderService.getPO(id));
}
```

## 入口校验与异常

### J8-SPR-06 写接口必须校验：@Valid + 约束注解 + Service 二次业务校验

```txt rule
level: must
severity: high
tags: validation, security
applies: **/controller/**/*.java
p3c: 安全规约 1
```

**规则**：`@RequestBody` 必须配 `@Valid`/`@Validated`，DTO 上用 `@NotNull`/`@Size`/`@Pattern` 等约束；跨字段、依赖库内数据的规则放 Service。

**为什么**：只靠前端校验等于没有校验；只在 Service 校验又会让错误码与字段名丢失，前端拿不到可展示的定位信息。

### J8-SPR-07 禁止 Controller 本地 catch 后把异常消息回给前端

```txt rule
level: must
severity: high
tags: exception, security
applies: **/*.java
deny: catch\s*\(\s*(?:Exception|Throwable)\s+\w+\s*\)\s*\{\s*return\s+Result\.\w*\([^)]*getMessage
p3c: 异常处理 4
```

**规则**：异常统一由 `@RestControllerAdvice` 转换。禁止 `catch (Exception e) { return Result.fail(e.getMessage()); }`。

**为什么**：`getMessage()` 里常含 SQL 片段、表名、文件路径、内网地址，等于免费给攻击者做结构探测。

```java
@ExceptionHandler(BusinessException.class)
public Result<Void> handleBiz(BusinessException ex) {
    return Result.fail(ex.getCode(), ex.getMessage());
}

// BAD
try {
    return Result.ok(orderService.create(req));
} catch (Exception e) { return Result.fail("ERR", e.getMessage()); }
```

> `deny` 只抓单行 `catch (...) { return ... getMessage() }`；跨行写法由模型判（`J8-SPR-07` 属半自动规则）。
> GOOD 段里的 `ex.getMessage()` 在 `@ExceptionHandler` 上是正确用法，不得误报。

### J8-SPR-08 同一服务只选一种响应契约

```txt rule
level: must
severity: medium
tags: api
applies: **/controller/**/*.java
p3c: 前后端规约 1
```

**规则**：内部服务默认 Mode B——HTTP 200 + `{code, message, data}`，成功码写死（`0` / `SUCCESS`）。对外开放 REST 可用 Mode A——语义化 HTTP 状态码。同一服务禁止混用，除非 L3 声明迁移期与截止迭代。系统错误 message 固定通用文案，不含堆栈。

**为什么**：混用后前端必须为每个接口写一套判断；错误时结构与成功不一致，全局拦截器就失效。

### J8-SPR-09 系统错误只记日志，不回传内部细节

```txt rule
level: must
severity: high
tags: exception, security
applies: **/*.java
p3c: 异常处理 3
```

**规则**：未捕获异常统一走 `SYSTEM_ERROR` + 通用文案 + `log.error(..., ex)`。返回体禁止堆栈、SQL、类名、路径。

**为什么**：内部细节是免费的渗透线索，且对用户毫无价值——他只需要知道「稍后重试」和「找谁报单号」。

## 分页

### J8-SPR-10 列表接口必须分页，pageSize 必须有上限

```txt rule
level: must
severity: high
tags: paging
applies: **/*.java
deny: \w{1,64}Mapper\.selectAll\(\)
p3c: -
```

> `\w+` 在长行上会 O(n²) 回溯（单行 20 万字符能跑 30 秒），所以量词带上界；
> 类名超过 64 字符的 `XxxMapper` 不常见，就算漏也无害。

**规则**：返回集合的接口必须分页（page/size），`pageSize` 上限来自配置（如默认 20 / 最大 100）。响应带 `list` + `total`。

**为什么**：上限不写死的分页等于给了一个 `size=1000000` 的 DoS 入口，且随数据量增长把 DB 和内存一起打穿。

```java
// GOOD
int size = Math.min(req.getPageSize(), props.getMaxPageSize());
return orderMapper.selectPage(req, (req.getPage() - 1) * size, size);

// BAD
return orderMapper.selectAll();
```

### J8-SPR-11 禁止内存分页与全量导出

```txt rule
level: must
severity: high
tags: paging
applies: **/*.java
p3c: 集合处理 9
```

> 本条不配 `deny`：`.subList(` 单独出现无法区分「内存分页」与「图表取前 N 条」，硬写成正则只会造成大量误报（真实项目实测 3 处均为误报）。
> `subList` 的视图陷阱由 `J8-COL-01` 管；本条只看是否「全量拉取 + 内存切」。

**规则**：禁止 `selectAll()` 后在内存 `subList` / `stream().skip()`。导出走游标或分批拉取 + 流式写出。

**为什么**：内存分页把「慢」变成「OOM」，而且是随数据增长必然触发的那一类；`subList` 还顺带返回视图，删改原列表就炸。

```java
// GOOD
List<OrderPO> rows = orderMapper.selectPage(query, offset, size);

// BAD
List<OrderPO> all = orderMapper.selectAll();
return all.subList(from, to);
```

## 写路径

### J8-SPR-12 写路径必须幂等或可安全重试

```txt rule
level: must
severity: critical
tags: idempotency
applies: **/*.java
p3c: -
```

**规则**：支付、下单、审批、回调、开放 API 写操作必须有幂等手段：`Idempotency-Key`、业务唯一号、DB 唯一约束，三选一以上。先判重后产生副作用；重复请求返回首次结果，不返回 500。

**为什么**：网络超时重试、网关重发、消息重投是常态。没有幂等 = 每次重投都多一条订单/多扣一次款，且事后无法判断哪条是真的。

### J8-SPR-13 并发改同一行必须用版本号或条件更新

```txt rule
level: must
severity: high
tags: concurrency, transaction
applies: **/*.java
p3c: -
```

**规则**：状态、库存、余额的修改禁止「先 select 再无条件 update」。用 `version` 乐观锁（`WHERE id=? AND version=?`）或条件更新（`WHERE id=? AND status=?`），`affected != 1` 转业务错误或重试。状态迁移有显式允许表，非法迁移抛业务异常。

**为什么**：先查后改在并发下就是丢失更新——两个请求都读到 `PENDING`，都写成功，最终状态取决于谁跑得慢。

```java
// GOOD
int n = orderMapper.updateStatus(id, from, to);
if (n != 1) {
    throw new BusinessException("ORDER_STATE_CONFLICT", "状态已变更");
}

// BAD
OrderPO po = orderMapper.selectById(id);
po.setStatus(PAID);
orderMapper.updateById(po);
```

### J8-SPR-14 出站调用必须配超时与有限重试

```txt rule
level: must
severity: high
tags: outbound
applies: **/*.java
p3c: -
```

**规则**：HTTP/RPC 客户端必须配连接超时 + 读超时。重试只对幂等读或带幂等键的写，次数有上限并退避；非幂等写默认不重试。客户端单例复用，禁止每次 `new RestTemplate()`。

**为什么**：无超时的一次调用就能占满线程池，把一个接口的故障放大成全站不可用。

## 配置

### J8-SPR-15 环境地址与凭证禁止硬编码

```txt rule
level: must
severity: critical
tags: security, config
applies: **/*.java, **/*.yml, **/*.yaml, **/*.properties, **/*.ini
deny: (?i)\b(password|passwd|pwd|secret|secretkey|accesskey|token)\s*[:=]\s*"(?=[^"\n]{6,}")[^"+\n]*[\d!@#$%^&*_\-][^"+\n]*"; (?i)^\s*[\w.\-]*(?:password|passwd|pwd|secret|secretkey|accesskey|token)\s*[:=]\s*(?![$\\])(?=[^\s]*[\d!@#$%^&*_\-])[^\s(,)\x3b`"]{6,}\s*$; (?i)jdbc:[a-z]+://[^"\s]*(password|pwd)=
allow: \$\{|process\.env|os\.environ|\bENC\(\{
p3c: 安全规约 1
```

**规则**：密钥/凭证只来自环境变量、配置中心或 KMS，配置里写成 `${PAY_SECRET}` 占位符。环境 IP、域名同样不写进代码。业务配置用 `@ConfigurationProperties` 收口，避免散落 `@Value`。

**为什么**：硬编码凭证一次提交就永久留在 git 历史里，删掉也仍可 checkout；配置散落 `@Value` 则改一个环境要全仓搜字符串。

> 正则卡的是「字面量长了且带数字/符号」——`private final String password = "Xxx#2021!"` 就是它；
> 而 `TOKEN = "token"`（参数名常量）、`"?token=" + token`（拼接）不是凭证，不得误报。
>
> yml / properties 的无引号写法那条正则额外排除了三类误报（真实仓实测）：
> 以 `$` / `\` 开头的值（占位符、i18n 转义）、含 `(` `;` `,` 的值（方法调用、语句）、
> 以及全是字母的值（`appSecret: PetroChina`）。
> 占位符 `${...}`、`process.env.*`、`os.environ` 另通过 `allow` 豁免。

```java
// GOOD
@ConfigurationProperties(prefix = "app.pay")
public class PayProperties {
    private String secret;
    private int connectTimeoutMs = 2000;
}

// BAD
private String password = "root123";
private String secretKey = "9f2c8a71b3d4e5f6";
private String url = "jdbc:mysql://192.0.2.10:3306/order?password=root123";
```

```yaml
# GOOD
spring:
  datasource:
    password: ${DB_PASSWORD}

# BAD
spring:
  datasource:
    password: root123
```

```properties
# GOOD
spring.datasource.password=${DB_PASSWORD}

# BAD
spring.datasource.password=root123
app.pay.secret=9f2c8a71b3d4e5f6
```

## 可观测

### J8-SPR-16 入口必须生成或透传 traceId 并写入 MDC

```txt rule
level: must
severity: high
tags: trace, observability
applies: **/*.java
p3c: 日志规约 5
```

**规则**：HTTP 入口生成或透传 `traceId`（`X-Request-Id` 或网关约定头），写入 MDC；日志 pattern 含 `%X{traceId}`；请求结束 `MDC.remove`。业务失败日志必须带业务主键。定时任务与消息消费自建 traceId 并清理。

**为什么**：没有 traceId 时「这次请求到底打了哪几条 SQL、调了哪个下游」只能靠时间戳猜，高峰期完全不可用。

### J8-SPR-17 API 兼容：字段只增不删，破坏性变更走新路径

```txt rule
level: should
severity: medium
tags: api, compatibility
applies: **/*.java
p3c: 前后端规约 3
```

**规则**：出参字段只增不删；废弃字段标注并保留至少一个发布周期；枚举新增要保证旧客户端可解析。破坏性变更走新路径或版本前缀，并在提交说明标 `影响: API`。

**为什么**：前后端不同步发布是常态。删字段对服务端只是清理，对线上旧前端是一次白屏。

### J8-SPR-18 事务注解只放在 Service 层

```txt rule
level: must
severity: high
tags: transaction
applies: **/*.java
p3c: -
```

> 无 `deny`：位置是否合规要看类身份，正则判不了。Controller 侧由 `J8-SPR-02` 机判，
> Mapper 侧由 `J8-MBT-13` 机判，这条接住剩下的位置（`@Component` / `@Repository` / 工具类 / 定时任务）。

**规则**：`@Transactional` 只加在 `@Service` 类（或明确的 `*ServiceImpl` 应用服务）的方法上。
`@Component`、`@Repository`、静态工具类、`@Scheduled` 任务类不加。

**为什么**：事务边界属于用例层。事务加在工具类上，调用方以为只是查缓存却开了事务；
加在定时任务上，一次批处理就是一个长事务，锁行时间随数据量线性变长。

**边界**：显式事务 API（`TransactionTemplate`、`@TransactionalEventListener`）不属注解式代理，不在管辖范围。

### J8-SPR-19 包结构按默认树落位，存量仓按 L3 映射

```txt rule
level: must
severity: medium
tags: structure, layering
applies: **/*.java
see: J8-SPR-01
p3c: 工程结构 1
```

> 本条不配 `deny`：落地位置是目录结构问题，正则判不了；真正的手段是 `ds init --scaffold` 建骨架。
> 存量仓禁止为对齐本树而搬包（见下文「存量仓」）。

**规则**（新项目默认树）：

```text
src/main/java/<root>/
├── controller/    // 只做参数校验 + 调 Service，无业务分支
├── service/       // 用例编排与事务边界；接口 + impl/
├── mapper/        // MyBatis 接口，只留签名
├── entity/        // 持久化对象（*PO），只在 service 与 mapper 之间流转
├── model/         // 对外契约：*Req / *Resp / *Query / *VO
├── convert/       // PO 与 model 互转，禁把转换写在 controller
├── config/        // 配置类、拦截器、AOP
└── common/        // 常量、枚举、异常、工具；不得反向依赖上面任何包
```

**依赖方向**：`controller → service → mapper`，`common` 不依赖任何业务包。反向 import（mapper 引 controller）视为违规。

**为什么**：目录不是审美问题——它决定了新人找代码的路径，也让「该在哪加业务」不再需要问人。
依赖方向一旦反向，编译期就拆不出模块，后续任何拆分都要先还债。

**存量仓**：按业务仓 L3 的「存量包映射」登记（如 `web≈controller，biz≈service，dao≈mapper`），
`J8-SPR-01` 的依赖方向约束照样生效，但**不为对齐默认树而搬包**——搬包会让 git 历史断裂、review 不可读。

```java
// GOOD — 依赖方向正确
package com.x.order.controller;

public class OrderController {
    private final OrderService orderService;   // controller → service

    public OrderController(OrderService orderService) { this.orderService = orderService; }
}

// BAD — 反向依赖：mapper 引 controller
package com.x.order.mapper;

public class OrderMapper {
    private OrderController orderController;   // mapper → controller，依赖反向
}
```
