# Java JDK8 · 语言与基础

> 示例全部 Java 8 可编译。`p3c:` 指向《阿里巴巴 Java 开发手册（嵩山版）》章节序号，供人工对账，随手册版本微调。

## 命名

### J8-NAM-01 命名约定

```txt rule
level: must
severity: high
tags: naming
applies: **/*.java
p3c: 命名风格 1
```

**规则**：类/接口/枚举/注解 `UpperCamelCase`；方法、字段、参数、局部变量 `lowerCamelCase`；`static final` 常量 `UPPER_SNAKE_CASE`；包全小写反域名，无下划线译名。分层后缀固定：`*Controller` / `*Service` / `*ServiceImpl` / `*Mapper` / `*Task` / `*Job`。

**为什么**：命名是唯一不需要注释就能传信息的层，拼错后缀（`Contoller`）会让框架扫描和人工检索同时失效。

### J8-NAM-02 禁拼音、禁无意义缩写、DTO 后缀开口

```txt rule
level: must
severity: medium
tags: naming
applies: **/*.java
p3c: 命名风格 12
```

**规则**：禁止拼音（`yonghu`）、无意义缩写（`bx`、`w1`）。对外模型统一后缀：`*Req`/`*Request`、`*Resp`/`*Response`、`*PO`、`*DTO`、`*VO`；`PO` 只在持久化层流转，不出 Controller。

**为什么**：后缀是层间契约的可见标记，混用后「这个类能不能直接返回给前端」只能靠人记。

### J8-NAM-03 参数超过 3 个用参数对象，嵌套超过 3 层早返回

```txt rule
level: should
severity: medium
tags: readability, api
applies: **/*.java
p3c: -
```

> 本条不配 `deny`：参数个数与嵌套深度都要数括号与缩进，单行正则判不准（会误伤链式调用、匿名类）。
> 审查时按下面的口径人工确认。

**规则**：方法参数超过 3 个时传入参数对象（`*Query` / `*Req`），不要 `f(a, b, c, true, null)`；
嵌套超过 3 层（`if` / `for` / `try`）用早返回或拆方法。布尔参数一律换成语义参数对象。

**为什么**：`f(req, true, false, null)` 在调用点完全读不出含义，改一个参数的顺序就是一次线上事故；
嵌套 4 层以上时分支组合需要读 16 次才能确信覆盖全，评审时基本靠猜。

**审查口径**：数方法签名的逗号数（泛型内的逗号不算）；数同一方法体内 `if(`/`for(`/`while(`/`try` 的开括号深度。

```java
// GOOD — 参数对象 + 早返回
public PageResult<OrderVO> page(OrderQuery query) {
    if (query == null) return PageResult.empty();
    if (!query.isValid()) return PageResult.empty();
    return doPage(query);
}

// BAD — 参数多到看不出含义、嵌套深
public PageResult<OrderVO> page(int pageNum, int pageSize, String status, boolean asc, String tenantId) {
    if (pageNum > 0) {
        if (status != null) {
            for (String s : status.split(",")) {
                if (s.isEmpty()) {
                    continue;
                }
            }
        }
    }
    return null;
}
```

## 常量与不可变

### J8-CNT-01 魔法值提常量或枚举

```txt rule
level: must
severity: medium
tags: magic-value
applies: **/*.java
p3c: 常量定义 1
```

**规则**：业务状态码、类型、阈值、通道名禁止裸写数字/字符串，提为 `static final` 常量或 `enum`。豁免：`0`/`1`/`-1` 作循环与长度边界，`isEmpty` 类判断。

**为什么**：`status == 3` 无法搜索、无法改义；改口径时必然漏改。

### J8-OOP-01 协作依赖用 final 字段 + 构造器注入

```txt rule
level: must
severity: high
tags: di, immutability
applies: **/*.java
p3c: OOP 规约 6
```

**规则**：Spring 组件的协作 bean 一律 `private final` + 构造器注入（可用 `@RequiredArgsConstructor` 生成构造器）。禁止 `@Autowired` 字段注入。PO / 表单对象允许可变，不强制 final。

**为什么**：final 保证依赖不可变与 NPE 早失败；字段注入让单测必须起容器，也让循环依赖被藏住。

### J8-OOP-02 返回集合要防御性拷贝

```txt rule
level: should
severity: medium
tags: immutability
applies: **/*.java
p3c: OOP 规约 5
```

**规则**：跨模块 public 方法返回内部可变集合时用 `Collections.unmodifiable*` 或拷贝一份。

**为什么**：调用方一次 `add` 就把内部状态改了，且问题在现场表现为「莫名多出一条」。

## 空值与 Optional

### J8-API-01 Optional 只作返回值

```txt rule
level: must
severity: high
tags: optional, npe
applies: **/*.java
p3c: OOP 规约 9
```

**规则**：`Optional` 只用于「可能无结果」的方法返回值。禁止作字段、方法参数、集合元素、`Map` value。禁止裸 `.get()`，用 `orElseThrow` / `map` / `orElse` / `ifPresent`。

**为什么**：Optional 作参数等于把判空责任推给调用方且无法用编译期检查；裸 `get()` 换了个地方抛 NPE。

### J8-API-02 long/Long 拆箱必须判空

```txt rule
level: must
severity: high
tags: npe
applies: **/*.java
p3c: OOP 规约 7
```

**规则**：包装类型参与运算、比较、三元表达式前必须判空，或用 `Long.valueOf(0)` 之类的显式默认。三元表达式两侧类型不一致时，包装类型会被整体拆箱。

**为什么**：`flag ? null : 1L` 会在 flag 为 true 时直接 NPE；`Long` 与 `long` 比较用 `==` 比较的是引用。

### J8-API-03 字符串判空统一走 StringUtils

```txt rule
level: must
severity: medium
tags: npe, string
applies: **/*.java
p3c: OOP 规约 8
```

**规则**：判空统一用 `org.apache.commons.lang3.StringUtils.isBlank` / `isNotBlank`（null、空串、空白串一次覆盖）。JDK 8 没有 `String#isBlank`，不要写 `str.isBlank()`；也不要用 `str.isEmpty()` 当判空。

**为什么**：`String#isBlank` 是 Java 11 才有的方法，在 J8 编译期就炸；`isEmpty()` 不处理 null 与空白。

## 金额与精度

### J8-API-04 金额必须 BigDecimal

```txt rule
level: must
severity: critical
tags: money, precision
applies: **/*.java
deny: \b(?:double|float|Double|Float)\b\s*(?:\[\s*\]\s*)?\w*(?:[Aa]mount|[Pp]rice|[Ff]ee|[Bb]alance|[Tt]otal|[Rr]ate); (?:List|Set|Collection|Map|Optional)\s*<\s*(?:Double|Float)\b
p3c: OOP 规约 10
```

**规则**：金额、费率、税额、余额禁止 `double` / `float`，含 DTO、PO、中间变量、Builder 字段。落库用 `DECIMAL` / `NUMERIC`。

**为什么**：二进制浮点无法精确表示 `0.1`，累加、四舍五入后对不上账，且误差随单据量级放大。

```java
// GOOD
private BigDecimal amount;
private List<BigDecimal> amountList;

// BAD
private double amount;
private float taxRate;
private double[] amountArr;
private Double price;
private List<Double> amountList2;
```

> 覆盖三种形态：基本类型、数组（`double[] amountArr`）、泛型（`List<Double>`）。

### J8-API-05 BigDecimal 用字符串构造、用 compareTo 比较

```txt rule
level: must
severity: high
tags: money, precision
applies: **/*.java
deny: new\s+(?:java\.math\.)?BigDecimal\s*\(\s*[0-9]+\.[0-9]
p3c: OOP 规约 10
```

**规则**：构造只用 `new BigDecimal("0.1")` 或 `BigDecimal.valueOf(0.1)`；禁止 `new BigDecimal(0.1)`。比较用 `compareTo`，禁止 `equals`。除法必须显式给精度和舍入模式。

**为什么**：`new BigDecimal(0.1)` 会带入 double 的二进制误差；`equals` 连 scale 一起比，`10.0` 与 `10.00` 直接判不等。

```java
// GOOD
BigDecimal b = a.divide(three, 2, RoundingMode.HALF_UP);
if (a.compareTo(b) >= 0) { }

// BAD
BigDecimal b = new BigDecimal(0.1);
BigDecimal c = new java.math.BigDecimal(0.1);
if (a.equals(b)) { }
```

## 集合

### J8-COL-01 Arrays.asList 定长、subList 是视图

```txt rule
level: must
severity: high
tags: collection
applies: **/*.java
p3c: 集合处理 5
```

**规则**：`Arrays.asList` 返回定长列表，禁止 `add`/`remove`；要可变用 `new ArrayList<>(Arrays.asList(...))`。`List#subList` 返回视图，原列表结构变更后视图操作抛 `ConcurrentModificationException`，跨方法传递前用 `new ArrayList<>(sub)` 固化。

**为什么**：这两处都是运行期才炸，且异常信息指向 append/remove 的位置，不指向来源。

### J8-COL-02 Collectors.toMap 必须防重复键

```txt rule
level: must
severity: high
tags: collection, exception
applies: **/*.java
p3c: 集合处理 8
```

**规则**：`Collectors.toMap` 必传合并函数（`(a, b) -> a` 或按业务取舍），并确认 value 不为 null。

**为什么**：默认实现遇重复键抛 `IllegalStateException`，遇 null value 抛 NPE，都在数据上线后才暴露。

```java
// GOOD
Map<Long, OrderPO> byId = list.stream()
        .collect(Collectors.toMap(OrderPO::getId, o -> o, (a, b) -> a));

// BAD
Map<Long, OrderPO> byId = list.stream()
        .collect(Collectors.toMap(OrderPO::getId, o -> o));
```

### J8-COL-03 遍历中删除用 Iterator 或 removeIf

```txt rule
level: must
severity: high
tags: collection, exception
applies: **/*.java
p3c: 集合处理 7
```

**规则**：`for-each` 内禁止对同一集合 `add`/`remove`；用 `Iterator#remove`、`removeIf`，或先收集再批量删。

**为什么**：`modCount` 校验会抛 `ConcurrentModificationException`，且只在「删到不是最后一个」时复现。

### J8-COL-04 判空区分 null 与 empty

```txt rule
level: must
severity: medium
tags: collection, npe
applies: **/*.java
p3c: 集合处理 2
```

**规则**：明确区分「无数据」与「未查询」。内部流转用空集合（`Collections.emptyList()`），禁止 `return null` 表示无数据；外部入参用 `CollectionUtils.isEmpty` 一次判 null 与空。

**为什么**：`null` 与空集合混用后，每处调用都要重复判空，漏一处就是线上 NPE。

## 时间

### J8-DAT-01 时区显式、SimpleDateFormat 不共享

```txt rule
level: must
severity: high
tags: time, concurrency
applies: **/*.java
p3c: 日期时间 3
```

**规则**：新代码用 `java.time`（`Instant` / `LocalDate` / `LocalDateTime`）。禁止依赖 `ZoneId.systemDefault()` 做业务判断，时区从配置取或由 L3 约定。`SimpleDateFormat` 线程不安全，禁止作为共享字段或 `static`；存量需包一层或用 `DateTimeFormatter`。

**为什么**：默认时区随容器镜像变化，跨环境差 8 小时；共享 `SimpleDateFormat` 在并发下产出错乱日期甚至抛异常。

## 并发

### J8-CON-01 单例组件禁可变业务字段

```txt rule
level: must
severity: high
tags: concurrency
applies: **/*.java
p3c: 并发处理 1
```

**规则**：`@Service` / `@Component` 等单例里禁止用可变实例字段承载业务状态（计数器、无同步的缓存 Map、请求级上下文）。需要缓存或计数用进程外存储或带并发保护的容器，并写清失效策略。

**为什么**：单例字段被所有请求共享，改一次就是全站串数据，且并发下不可复现。

### J8-CON-02 线程池必须有界且命名

```txt rule
level: must
severity: high
tags: concurrency
applies: **/*.java
deny: Executors\.newCachedThreadPool\(; Executors\.newFixedThreadPool\(; Executors\.newSingleThreadExecutor\(; CompletableFuture\.(runAsync|supplyAsync)\s*\([^,)]*\)
p3c: 并发处理 3
```

**规则**：业务异步必须显式线程池：核心/最大线程数、有界队列、拒绝策略、线程名前缀。`@Async` 指定该池。禁止 `Executors.newCachedThreadPool` / `newFixedThreadPool`（无界队列）与无 Executor 参数的 `CompletableFuture.*Async`（默认 `ForkJoinPool.commonPool`）。

**为什么**：无界队列在流量尖峰时把内存吃满后 OOM，而不是触发拒绝；commonPool 与框架共用会互相拖死。

```java
// GOOD
ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
ex.setCorePoolSize(4);
ex.setMaxPoolSize(8);
ex.setQueueCapacity(500);
ex.setThreadNamePrefix("order-async-");
ex.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
ex.initialize();

// BAD
Executors.newCachedThreadPool();
Executors.newFixedThreadPool(8);
Executors.newSingleThreadExecutor();
CompletableFuture.runAsync(this::heavyJob);
```

### J8-CON-03 ThreadLocal 与 MDC 必须清理

```txt rule
level: must
severity: high
tags: concurrency, trace
applies: **/*.java
p3c: 并发处理 8
```

**规则**：`ThreadLocal.set` / `MDC.put` 后必须 `try { } finally { remove() }`，异步任务启动前显式传递、结束前清理。

**为什么**：线程池复用线程，残留值会让下一个请求带上别人的 userId / traceId，既是串号也是越权隐患。

```java
// GOOD
try {
    MDC.put("traceId", traceId);
    doWork();
} finally {
    MDC.remove("traceId");
}

// BAD
MDC.put("traceId", traceId);
doWork();
```

## 异常与资源

### J8-EXC-01 禁止空 catch、禁止吞异常

```txt rule
level: must
severity: critical
tags: exception
applies: **/*.java
deny: catch\s*\([^)]*\)\s*\{\s*\}
p3c: 异常处理 1
```

**规则**：`catch` 必须有处理动作：恢复并记录、转译后抛出、或落到业务错误码。禁止空块、禁止只 `log.debug` 了事、禁止 `catch (Exception e) { return null; }`。

**为什么**：吞掉的异常在线上表现为「数据没写进去但接口返回成功」，这是最难查的一类问题。

```java
// GOOD
try {
    orderService.cancel(id);
} catch (BusinessException e) {
    log.warn("cancel_rejected orderId={} code={}", id, e.getCode());
    throw e;
}

// BAD
try {
    orderService.cancel(id);
} catch (Exception e) { }
```

> `deny` 是行级形态检查，只能抓单行空 catch；跨行空块需人工或模型补位。

### J8-EXC-02 可关闭资源用 try-with-resources

```txt rule
level: must
severity: high
tags: resource
applies: **/*.java
p3c: 异常处理 6
```

**规则**：`InputStream` / `OutputStream` / `Reader` / `Writer` / `Connection` / `ResultSet` 等用 try-with-resources。禁止裸 `close()` 且无 `finally`。JDK 8 没有 `InputStream#transferTo`，流拷贝用 `IOUtils.copy` 或缓冲循环。

**为什么**：`close()` 本身可能抛异常，写在 `finally` 里会覆盖原始异常；漏关连接在线上一周就耗尽连接池。

## 日志与注释

### J8-LOG-01 日志用占位符，禁 System.out

```txt rule
level: must
severity: high
tags: logging
applies: **/*.java
exclude: **/src/test/**
deny: System\.(out|err)\.print; \.printStackTrace\(\)
p3c: 日志规约 1
```

> 测试代码里的 `System.out` 归 `UT-J8-02`（用打印代替断言），不重复报。

**规则**：SLF4J 占位符 `log.info("fetch_order id={}", id)`；异常作为最后一个参数 `log.error("failed id={}", id, ex)`。禁止 `System.out` / `printStackTrace` / 字符串拼接主消息。

**为什么**：拼接在 debug 关闭时仍然付出字符串构造开销；`printStackTrace` 写到 stderr，落不进日志平台。

```java
// GOOD
log.info("fetch_order id={}", id);

// BAD
System.out.println("id=" + id);
ex.printStackTrace();
```

### J8-LOG-02 敏感信息禁止入日志

```txt rule
level: must
severity: critical
tags: security, logging
applies: **/*.java
p3c: 安全规约 4
```

**规则**：密码、token、AK/SK、会话、完整证件号与银行卡号禁止出现在日志、异常消息、返回体、注释。手机号等 PII 需脱敏。

**为什么**：日志平台权限远比数据库宽，一次打全量 token 就等于长期泄露。

### J8-CMT-01 注释写为什么，不写是什么

```txt rule
level: should
severity: medium
tags: comment
applies: **/*.java
p3c: 注释规约 1
```

**规则**：注释写业务约束、坑、非直觉决策；禁止变更史（`2024-xx 改成`）、过程注释（`我修改了`）、逐行翻译、注释掉的死代码、`@author`/`@date` 文件头。代码改了必须同步改注释。

**为什么**：过时注释比没有注释更贵——它会让下一个读者（或模型）按错误前提改代码。

### J8-CMT-02 TODO 必须有工单号，公共方法补 Javadoc

```txt rule
level: should
severity: medium
tags: comment
applies: **/*.java
raw: true
deny: (?<![\w#])TODO(?!.{0,3}\d)
p3c: 注释规约 2
```

> `@author` / `@date` 这类个人署名头属于团队约定（写在业务仓 L3），不进通用规则：
> 有的团队强制写，有的团队明令禁止，写成 deny 会让一半人莫名其妙违规。

> 本条必须 `raw: true`：`TODO` 几乎总写在注释里，而扫描默认先剥注释——不关剥离就永远匹配不到。

**规则**：`TODO` 必须带工单号（`TODO(#1234)` 或 `TODO: 1234`）。`public` / `protected` 方法写 Javadoc：参数含义、返回值、会抛什么异常。

**为什么**：没有工单的 `TODO` 是“以后再说”的另一种写法，三个月后没人敢删也找不到负责人。
Javadoc 缺失不是风格问题——调你方法的人只能读实现，而实现随时会改。

```java
// GOOD — 带工单
// TODO(#1234) 缓存失效改成提交后事件
public class OrderService {
    /**
     * 创建订单。库存不足抛 BizException(ERR_STOCK)。
     */
    public Result<Long> create(CreateOrderReq req) { }
}

// BAD — 无工单的 TODO
// TODO 缓存失效改成提交后事件
public class OrderClean { }
```

## 代码组织

### J8-ORG-01 一个文件一个 public 类型，成员顺序固定

```txt rule
level: should
severity: low
tags: structure
applies: **/*.java
p3c: -
```

> 本条不配 `deny`：数 public 类、看成员顺序都要跨行读整文件，单行正则只会造误报。
> 审查时人工确认，口径见下。

**规则**：一个 `.java` 只放一个 `public` 顶级类型（同名文件）；其他类写成包私有。成员顺序：静态常量 → 静态块 → 实例字段 → 构造器 → 公共方法 → 私有方法。

**为什么**：一个文件里塞多个 public 类，`grep` 出来的结果永远对不上文件名；成员顺序乱放会让 diff 里「改字段」和「改方法」混在一起，评审时看不出意图。

**审查口径**：数 `^public\s+(class|interface|enum|@interface)` 出现次数 > 1 就是违规；
单个文件超过 500 行、或有 3 个以上包私有类时，也建议按领域拆开。

```java
// GOOD — 一个 public 类型（文件名 OrderQuery.java）
public class OrderQuery {
    private static final int MAX_PAGE = 100;
    private final String status;

    public OrderQuery(String status) { this.status = status; }

    public String getStatus() { return status; }
}

// BAD — 一个文件两个 public 类型
public class OrderQuery { }
public class OrderExtra { }
```

## Stream

### J8-STR-01 Stream 用于转换，不用于副作用

```txt rule
level: should
severity: medium
tags: stream, readability
applies: **/*.java
noString: true
deny: \.stream\(\)\s*\.forEach\(
p3c: -
```

**规则**：`stream().forEach(...)` 只在该循环内部**只读**时用；内部修改外部集合、发请求、写库一律用 `for` 循环。管道段数 ≤ 4，`peek` 不写业务逻辑。

**为什么**：`forEach` 里做副作用时，读者要同时在脑子里跑两种执行模型（声明式管道 + 命令式副作用）；
而管道超过 4 段后，出错时定位不到是哪一段。

```java
// GOOD — 转换用管道，副作用用 for
List<String> nos = orders.stream().map(Order::getNo).collect(Collectors.toList());
for (Order o : orders) {
    cache.put(o.getNo(), o);
}

// BAD — 副作用塞进 forEach
orders.stream().forEach(o -> cache.put(o.getNo(), o));
```

## 版本门禁

### J8-MOD-01 JDK9+ API 与语法禁止进入 J8 代码

```txt rule
level: must
severity: critical
tags: jdk8, version
applies: **/*.java
noString: true
deny: (?<!Collectors)\.toList\(\); (?<!StringUtils)\.isBlank\(\); (?<!StringUtils)\.strip\(\); \.lines\(\); \.repeat\(\s*\d+\s*\); \.transferTo\(; List\.of\(; Map\.of\(; Set\.of\(; List\.copyOf\(; Map\.entry\(; Files\.readString\(; Files\.writeString\(; Files\.mismatch\(; \bvar\s+\w+\s*=[^=]; \brecord\s+[A-Z]\w*\s*\(; \bsealed\s+(class|interface); \.formatted\(; \.orElseThrow\(\s*\); Objects\.requireNonNullElse\(; Objects\.requireNonNullElseGet\(; Collectors\.toUnmodifiable\w+; Collectors\.teeing\(; instanceof\s+[A-Z]\w*\s+[a-z]\w*\b; \(\s*var\s+\w+\s*\)\s*->
p3c: -
```

**规则**：J8 工程禁止使用下表构造。新增第三方库同理，先确认其运行时 J8 兼容。

| 构造 | 最低版本 | J8 替代 |
|---|---|---|
| `var` | 10 | 显式类型 |
| `List.of` / `Map.of` / `Set.of` | 9 | `Arrays.asList` / `Collections.unmodifiable*` |
| `Stream#toList` | 16 | `Collectors.toList()` |
| `String#isBlank` / `#strip` / `#formatted` | 11 / 11 / 15 | `StringUtils.isBlank` / `trim` / `String.format` |
| `InputStream#transferTo` | 9 | `IOUtils.copy` |
| `Files#readString` / `#writeString` | 11 | `Files.readAllBytes` + 显式编码 |
| `Optional#isEmpty` | 11 | `!opt.isPresent()` |
| `record` / `sealed` | 16 / 17 | final 类 + getter |
| `List.copyOf` / `Map.entry` | 10 / 9 | `new ArrayList<>(src)` / `new AbstractMap.SimpleEntry<>(k, v)` |
| `String#lines` / `#repeat` | 11 / 11 | `split("\\R")` / `StringUtils.repeat` |
| `Optional#orElseThrow()` 无参 / `#stream` | 10 / 9 | `orElseThrow(Supplier)` / `isPresent() ? Stream.of(get()) : Stream.empty()` |
| `Objects#requireNonNullElse(Get)` / `Files#mismatch` | 9 / 12 | 手写 null 判断 / 逐块比对 |
| `Collectors#toUnmodifiable*` / `#teeing` | 10 / 12 | `Collections.unmodifiable*` / 两次收集 |
| `instanceof` 模式匹配 / lambda 形参 `var` | 16 / 11 | 显式强转 / 省略类型 |

**为什么**：本地 JDK 版本高于生产时会编译通过，上线才炸 `NoSuchMethodError`，且堆栈指向框架。

```java
// GOOD — J8
List<String> names = new ArrayList<String>();
names.add("a");
String s = " a ".trim();
if (StringUtils.isBlank(s)) {
    return;
}

// BAD — 每行一种越界写法
var names = new ArrayList<String>();
List<String> l = List.of("a");
Map<String, String> m = Map.of("a", "b");
Set<String> set = Set.of("a");
List<String> l2 = list.stream().toList();
if (name.isBlank()) { }
String s2 = raw.strip();
in.transferTo(out);
String s3 = Files.readString(path);
Files.writeString(path, s3);
String s4 = "%s".formatted(x);
String s5 = raw.lines().findFirst().get();
String s6 = "ab".repeat(3);
List<String> l3 = List.copyOf(l);
Map.Entry<String, String> e = Map.entry("a", "b");
boolean same = Files.mismatch(a, b) == -1;
Object v = opt.orElseThrow();
String s7 = Objects.requireNonNullElse(x, "y");
String s8 = Objects.requireNonNullElseGet(x, () -> "y");
Set<String> u = l.stream().collect(Collectors.toUnmodifiableSet());
Object t = l.stream().collect(Collectors.teeing(a, b, (p1, p2) -> p1));
if (obj instanceof String str) { }
list.forEach((var item) -> log.info("{}", item));

public record OrderResp(Long id) { }

public sealed class A permits B { }
```
