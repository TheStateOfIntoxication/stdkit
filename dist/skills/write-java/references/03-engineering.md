# Java JDK8 · 工程（安全 · 异步 · 依赖）

> 横切面规则：安全基线、任务与消息、依赖与配置变更。示例全部 Java 8 可编译。`p3c:` 为《Java 开发手册》章节序号。

## 安全基线

### J8-SEC-01 用户输入禁止进入命令、脚本与模板引擎

```txt rule
level: must
severity: critical
tags: security, inject
applies: **/*.java
deny: Runtime\.getRuntime\(\)\.exec\(.*\+; new\s+ProcessBuilder\([^)]*\+
p3c: 安全规约 2
```

**规则**：禁止把用户输入拼进 `Runtime.exec` / `ProcessBuilder` / `ScriptEngine` / 模板表达式。确需执行外部命令时用参数列表 + 白名单，禁止 shell 拼接。

**为什么**：命令注入的载荷是操作系统级别的，一次成功就等于拿到应用进程的全部权限，且不会有任何业务异常表面可见。

```java
// GOOD
new ProcessBuilder("ping", "-c", "1", whitelistedHost(userHost)).start();

// BAD
Runtime.getRuntime().exec("ping " + userHost);
ProcessBuilder pb = new ProcessBuilder("sh", "-c", "ping " + userHost);
```

### J8-SEC-02 文件路径必须规范化并校验在允许目录内

```txt rule
level: must
severity: critical
tags: security, path
applies: **/*.java
p3c: 安全规约 3
```

**规则**：用户提供的文件名/路径先 `toRealPath()` 或 `normalize()`，再断言 `startsWith(base)`。上传要做类型白名单、大小上限、存储名随机化；下载禁止任意路径与任意 URL。禁止 Web 可执行目录可写。

**为什么**：`../` 穿越能读到任意文件，而校验「不以 .. 开头」是无效的——`a/../../` 与编码变形都能绕过。

```java
// GOOD
Path base = Paths.get(uploadDir).toRealPath();
Path target = base.resolve(userRelative).normalize();
if (!target.startsWith(base)) {
    throw new BusinessException("INVALID_PATH", "非法路径");
}

// BAD
File f = new File("/data/upload/" + filename);
```

### J8-SEC-03 服务端代请求用户 URL 必须做主机白名单

```txt rule
level: must
severity: critical
tags: security, ssrf
applies: **/*.java
p3c: 安全规约 3
```

**规则**：按用户提供的 URL 出站时限制协议与主机白名单，禁止内网段、metadata 地址、`file://`。默认禁止「代抓任意 URL」这类开放接口。

**为什么**：SSRF 能把服务端当成进入内网的跳板，云环境的 metadata 端点更是直接泄漏临时凭证。

### J8-SEC-04 反序列化与危险库限制

```txt rule
level: must
severity: critical
tags: security, deserialization
applies: **/*.java
deny: new\s+ObjectInputStream\(; enableDefaultTyping\(; activateDefaultTyping\(
p3c: 安全规约 5
```

**规则**：禁对不可信流使用 `ObjectInputStream`；Jackson 关闭默认多态；新代码禁止引入 Fastjson（存量固定安全版本并关 AutoType，优先迁 Jackson）；YAML 只解析可信配置源。新依赖评估 CVE，无维护的库不引入。

**为什么**：反序列化漏洞等于「只要能让服务端解析你给的字节就能执行代码」，补丁窗口期往往已足够被利用。

```java
// GOOD
ObjectMapper om = new ObjectMapper();
OrderReq req = om.readValue(json, OrderReq.class);

// BAD
ObjectInputStream in = new ObjectInputStream(socket.getInputStream());
mapper.enableDefaultTyping();
om.activateDefaultTyping(polymorphicTypeValidator);
```

### J8-SEC-05 越权：资源必须校验属主或租户

```txt rule
level: must
severity: critical
tags: security, authz
applies: **/*.java
p3c: 安全规约 4
```

**规则**：按 ID 操作资源前校验其属主/租户与当前登录身份一致。禁止只信客户端传来的 `userId`/`tenantId`；禁止「查得到即有权操作」。

**为什么**：水平越权是最常见的业务漏洞——接口鉴权通过（已登录）但对象鉴权缺失，改一个 ID 就能操作别人的单子。

```java
// GOOD
OrderPO order = orderService.requireOwned(req.getOrderId(), currentUserId());

// BAD
OrderPO order = orderMapper.selectById(req.getOrderId());
orderService.cancel(order);
```

## 异步与任务

### J8-SEC-06 定时任务必须防重跑、可观测、可安全重入

```txt rule
level: must
severity: high
tags: scheduled
applies: **/*.java
p3c: 并发处理 10
```

**规则**：多实例部署的定时任务用分布式锁或分片，禁止双跑双写；调度线程只做触发，重活提交业务线程池；每次触发自建 `traceId` 并 `MDC.remove`；失败日志含分片键/业务单号，禁止空 catch；cron 时区与 L3 一致；任务本身幂等，可安全重跑。

**为什么**：`@Scheduled` 在每个实例都会跑，三副本就是三倍数据量；而重跑不幂等的任务在补数时会把数据翻倍。

### J8-SEC-07 分布式锁必须有 TTL 与持有者标识

```txt rule
level: must
severity: high
tags: lock
applies: **/*.java
p3c: -
```

**规则**：锁 key 按业务粒度（任务名/分片/资源 id），TTL ≥ 最坏执行时间或可续期；释放前校验持有者 token，只解自己的锁；拿不到锁则跳过或短路，禁止假装成功继续写库。

**为什么**：无 TTL 的锁在进程崩溃后永久阻塞后续任务；无 token 的解锁会删掉别人刚拿到的锁，制造并发。

```java
// GOOD
String token = lock.tryLock(key, Duration.ofMinutes(4));
if (token == null) {
    return;
}
try {
    doWork();
} finally {
    lock.unlock(key, token);
}

// BAD
redis.set("lock:scan", "1");
redis.del("lock:scan");
```

### J8-SEC-08 消息消费必须幂等且有失败出口

```txt rule
level: must
severity: critical
tags: mq, idempotency
applies: **/*.java
p3c: -
```

**规则**：消费幂等（唯一键 / 消费表 / 状态守卫），成功后再 ack；失败有重试上限 + 死信或失败表 + 告警；退避带 jitter；禁止无限重试；禁止消费内长事务再远程（`J8-SPR-03`）。

**为什么**：MQ 至少一次投递是常态，「重复消费」不是异常分支而是主路径；没有幂等时一条重投消息就是一笔重复账。

## 依赖与配置

### J8-SEC-09 新增依赖必须有理由，配置分环境

```txt rule
level: must
severity: high
tags: deps, config
applies: **/*.xml, **/*.gradle, **/*.yml, **/*.yaml, **/*.properties
p3c: -
```

**规则**：新增依赖说明用途、评估许可证与 CVE、优先复用现有栈；禁引入重复能力的库（两个 JSON、两个 HTTP 客户端）。配置按 `dev`/`test`/`prod` 分离，prod 不默认打开调试开关（尤其 SQL 全量 DEBUG）。改数据源、线程池、出站超时、开关、网关须在提交说明标 `影响: 配置` 并写回滚方式。

**为什么**：依赖是长期负债，重复能力会让同一件事有两种行为（两个 JSON 库对 null 与日期格式的处理并不一致）。

### J8-SEC-10 日志与错误响应不得带内部结构

```txt rule
level: must
severity: high
tags: security, logging
applies: **/*.java
p3c: 日志规约 3
```

**规则**：对外响应不含堆栈、SQL、类名、文件路径、内部服务地址；日志不含密码/token/AK/SK、完整证件号与银行卡号，手机号等 PII 脱敏。登录、权限变更、导出操作保留审计日志。

**为什么**：错误信息是最容易被自动扫描的低成本情报——它直接告诉攻击者你用了什么框架、什么表名、哪个下游。
