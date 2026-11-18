# Java JDK8 · MyBatis

> Mapper 接口 + XML。数据库选型由 L3 `engines` 决定（mysql / postgres / kingbase / oracle）。

## 接口与 XML

### J8-MBT-01 复杂 SQL 只写在 XML，禁止注解拼串

```txt rule
level: must
severity: high
tags: mybatis, sql
applies: **/*.java
allow: @(?:Select|Insert|Update|Delete)\s*\(\s*"[^"$+]*"\s*\)
deny: @(?:Select|Insert|Update|Delete)\s*\(\s*"; @(?:Select|Insert|Update|Delete)\s*\([^\n]*\$\{; (?i)^\s*"\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^\n]*\$\{
p3c: -
```

> 按**危险特征**而不是写法形态匹配，因为形态有无数个：`@Select("…")`、`@Insert(value = "…")`、
> `@Select({"…"})`、`@Select(` 换行再接字面量。所以三道 deny：
> ① 注解后跟字面量（普通注解 SQL，用 `allow` 放过安全写法）；
> ② 注解同行出现 `${}`（不限于紧跟括号，`@Insert(value = "… (col) … ${id}")` 也能接住）；
> ③ **行首引号** + SQL 词 + `${}`（接住换行形态）。
>
> ③ 为何锁「行首引号」而不是「任意位置」：换行形态的第二行本来就是以引号开头的 SQL 字面量，
> 而 `throw new X("UPDATE failed for ${id}")`、`return "DELETE FROM cache, ${n} rows"` 这种
> 普通文案的引号在行中间。不锁行首就会把文案当成 SQL 拦下。

> `allow` 放过单行、参数化、无拼接的注解 CRUD（`@Select("… WHERE id = #{id}")`）；
> 只要出现 `${}` 或 `+` 拼接就不在豁免范围，一律报。
>
> **边界**：分行拼接且 `${}` 落在后续行时（`@Select(` 换行 `"SELECT a " +` 换行 `"WHERE b = ${b}"`）
> 行级匹配拿不到上下文，三道都接不住。这类归人工审查；正则不该假装能判跨行结构。

**规则**：动态 SQL、多表、统计一律写 XML。Mapper 接口只留签名；多参数用 `@Param`。
单行、参数化（只用 `#{}`）、无字符串拼接的极简 CRUD 可以用注解，其余一律进 XML。

**为什么**：注解里的 SQL 无法用 `<if>` 组织，作者只能靠字符串拼接，最终必然演化成注入点和不可读的长行；XML 也是多方言分文件维护的前提。

```java
// GOOD 极简单表 CRUD：单行、参数化、无拼接
@Select("SELECT id, amount FROM t_order WHERE id = #{id}")
OrderPO selectById(@Param("id") Long id);

// GOOD 复杂 SQL 进 XML
public interface OrderMapper {
    OrderPO selectById(@Param("id") Long id);
}

// BAD 拼接与 ${}
@Select("SELECT * FROM t_order WHERE status = '" + "${status}" + "'")
List<OrderPO> list(String status);

// BAD 换个写法也一样命中：命名属性、数组、换行
@Insert(value = "INSERT INTO t_order (id) VALUES (${id})")
@Select({ "SELECT * FROM t_order WHERE status = ${status}" })
@Select(
    "SELECT * FROM t_order WHERE id = ${id}")
```

### J8-MBT-02 `${}` 只允许服务端白名单

```txt rule
level: must
severity: critical
tags: sql-inject
applies: **/mapper/**/*.xml, **/*Mapper.xml
deny: \$\{
p3c: MySQL 建表规约 1
```

> 只看 MyBatis 的 Mapper XML：`**/mapper/**/*.xml` 与 `*Mapper.xml`。
> `pom.xml` 的 `${spring-boot.version}`、`logback-spring.xml` 的 `${log.path}` 不是注入面，不得误报（实测过的误报形态）。

**规则**：参数绑定默认 `#{}`。`${}` 仅用于表名、列名、排序方向等无法预编译的位置，且值必须来自服务端枚举/字典白名单，不能直通用户字符串。

**为什么**：`${}` 是字符串直插，等价于把用户输入当 SQL 执行；排序字段是最高频的注入入口，因为它天然「看起来像个参数」。

```xml
<!-- GOOD -->
WHERE name = #{name}

<!-- BAD -->
WHERE name = '${name}'
ORDER BY ${sortColumn}
```

### J8-MBT-03 查询结果必须映射到类型，禁止 resultType="map"

```txt rule
level: must
severity: high
tags: mybatis
applies: **/*.xml
deny: resultType\s*=\s*["']map["']
p3c: -
```

**规则**：业务查询返回 `*PO`/`*DTO`；开启 `map-underscore-to-camel-case` 或用显式 `<resultMap>`。

**为什么**：`map` 把字段名变成运行时字符串，改表后只有生产环境才会暴露；类型丢失也导致金额、日期无法按预期转换。

```xml
<!-- GOOD -->
<select id="selectById" resultType="com.example.app.po.OrderPO">
    SELECT id, order_no, total_amount, status
    FROM t_order
    WHERE id = #{id} AND deleted = 0
</select>

<!-- BAD -->
<select id="selectById" resultType="map">
    SELECT * FROM t_order WHERE id = #{id}
</select>
```

### J8-MBT-04 禁止 SELECT *，禁止无 LIMIT 的全表意图

```txt rule
level: must
severity: high
tags: mybatis, paging
applies: **/*.xml
deny: (?i)select\s+\*
p3c: MySQL 建表规约 5
```

**规则**：显式列出需要的列；列表查询必须在 SQL 层带 `LIMIT` / `OFFSET`（或分页插件）。禁止 `selectAll` + Java 内存分页。

**为什么**：`SELECT *` 在加列后会让出参悄悄变宽，也让索引覆盖失效；无 LIMIT 的列表在数据量上来后是第一个打挂库的查询。

```xml
<!-- GOOD -->
SELECT id, order_no FROM t_order WHERE deleted = 0 ORDER BY id DESC LIMIT #{size} OFFSET #{offset}

<!-- BAD -->
SELECT * FROM t_order
```

### J8-MBT-05 禁止循环内按条查库（N+1）

```txt rule
level: must
severity: high
tags: mybatis, performance
applies: **/*.java
p3c: -
```

**规则**：禁止 `for (row : rows) { mapper.selectByXxx(row.getId()); }`。用 JOIN 一次取，或 `IN` 批量取后在内存分组装配。

**为什么**：N+1 在测试数据下毫无异样，上量后是 500 次往返——延迟线性叠加，同时白占连接池。

```java
// GOOD
List<OrderItemPO> items = itemMapper.selectByOrderIds(orderIds);

// BAD
for (OrderPO o : orders) {
    o.setItems(itemMapper.selectByOrderId(o.getId()));
}
```

### J8-MBT-06 批量写入与 IN 必须切批

```txt rule
level: must
severity: high
tags: mybatis, batch
applies: **/*.xml
p3c: -
```

**规则**：`foreach` 批量插入/更新单批不超过 500 条（L3 可调），超出切批。`IN (...)` 列表同样切批。

**为什么**：一条超长 SQL 会撞 `max_allowed_packet` / 解析开销，且大事务放大了锁持有时间，切批反而更快更稳。

### J8-MBT-07 多方言必须同一次提交改齐

```txt rule
level: must
severity: critical
tags: multi-dialect, mybatis
applies: **/mapper/**/*.xml
p3c: -
```

**规则**：L3 声明 `engines` 数 ≥2 时，任一关系型变更必须在**同一次提交**里改齐每个已声明方言的 Mapper XML（同文件名、同 statement `id`）与对应 DDL，提交说明标 `影响: SQL(多库)`。禁止把方言 A 的 XML 原样复制到方言 B 目录而不改语法。

**为什么**：只改一侧时测试环境（通常单库）全绿，另一个客户现场报错；复制粘贴则是把语法错误变成运行期异常。

### J8-MBT-08 方言差异必须按引擎改写

```txt rule
level: must
severity: high
tags: multi-dialect
applies: **/mapper/**/*.xml
p3c: -
```

**规则**：分页、自增、upsert、字符串拼接、布尔、`FETCH FIRST` 等按方言改写；吃不准时结构对齐并标注「方言细节需人工确认」，不要假设一种语法通吃。

| 点 | MySQL | PostgreSQL | Oracle / Kingbase(Oracle-like) |
|---|---|---|---|
| 分页 | `LIMIT offset,size` | `LIMIT size OFFSET offset` | `OFFSET n ROWS FETCH NEXT m ROWS ONLY` |
| upsert | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO UPDATE` | `MERGE INTO` |
| 拼接 | `CONCAT(a,b)` | `a \|\| b` | `a \|\| b` |
| 布尔 | `TINYINT(1)` | `boolean` | `NUMBER(1)` |

**为什么**：方言差异不会在开发机暴露，只会在某个客户的库上暴露，且往往发生在发布窗口。

## 缓存

### J8-MBT-09 写库必须失效缓存，且尽量在提交后

```txt rule
level: must
severity: high
tags: cache
applies: **/*.java
p3c: -
```

**规则**：Cache-Aside：写库成功后删 key（或版本 bump），优先在事务提交后执行；禁止只写 DB 不管缓存。key 规则、TTL、失效时机写进 L3 或模块注释。

**为什么**：写后不失效会造成「改完刷新还是旧值」，且这种脏数据没有自动过期路径，只能靠人工清缓存。

### J8-MBT-10 读路径必须防穿透、击穿与无 TTL

```txt rule
level: must
severity: high
tags: cache
applies: **/*.java
p3c: -
```

**规则**：回源无结果时缓存短 TTL 空值（或布隆/合法 ID 校验）；热点 key 加互斥回源或逻辑过期；业务 key 必须有 TTL；禁止把无界集合塞进单个 key。

**为什么**：缓存不是「加速层」而是「保护层」—— miss 无保护时缓存挂掉等于把全部流量直接压给 DB。

## MyBatis-Plus

### J8-MBT-11 Wrapper 的字符串入口等价于 ${}

```txt rule
level: must
severity: critical
tags: sql-inject
applies: **/*.java
deny: \.last\(\s*"|\.apply\(\s*"
p3c: -
```

**规则**：`LambdaQueryWrapper` 的列名与方法引用是安全的；`apply(...)` / `last(...)` / `orderByAsc(String)` 里拼用户输入等价于 `${}`。`QueryWrapper` 的字符串列名必须有白名单证据。

**为什么**：MyBatis-Plus 的安全边界只到「值走预编译」，一旦把用户输入放进 SQL 片段方法，注入面与手写 `${}` 完全一样，而代码看起来像用了框架。

```java
// GOOD
new LambdaQueryWrapper<OrderPO>()
        .eq(OrderPO::getStatus, req.getStatus())
        .orderByDesc(OrderPO::getCreateTime);

// BAD
wrapper.apply("status = '" + req.getStatus() + "'");
wrapper.orderByAsc(req.getSortColumn());
```

### J8-MBT-12 @TableLogic 等价合规，不得再手写 deleted 条件

```txt rule
level: should
severity: low
tags: mybatis, soft-delete
applies: **/*.xml
p3c: -
```

**规则**：L3 声明 MyBatis-Plus 且用 `@TableLogic` 时，XML 里不再手写 `deleted = 0`（框架自动拼）；审查不得按「XML 未过滤删除标记」误报。未用 `@TableLogic` 的表，查询默认带 `deleted = 0`。

**为什么**：两处都管会造成条件重复与互相矛盾；漏了则已删数据回流到列表。

## 事务与审计

### J8-MBT-13 Mapper 只做数据访问

```txt rule
level: must
severity: high
tags: mybatis, layering
applies: **/mapper/**/*.java
deny: @Transactional
p3c: 工程结构 2
```

**规则**：Mapper 不放业务规则、不加 `@Transactional`、不调 RPC。事务边界在 Service（`J8-SPR-02`）。

**为什么**：Mapper 上的事务只在「无外层事务时」生效，一旦被 Service 事务包住就静默变成空操作，让人误以为有独立提交点。

```java
// GOOD
public interface OrderMapper {
    int updateStatus(@Param("id") Long id, @Param("to") String to);
}

// BAD
@Transactional
public interface OrderMapper {
    int updateStatus(@Param("id") Long id, @Param("to") String to);
}
```

### J8-MBT-14 审计字段交给框架填充

```txt rule
level: should
severity: low
tags: audit
applies: **/*.java
p3c: -
```

**规则**：`create_time` / `update_time` / `create_by` 由 DB 默认值或 `MetaObjectHandler` 填充，业务代码不手写；确需手写时集中在一个工具方法里。

**为什么**：散落手写必然出现某条路径忘了填，事后无法回溯是哪个操作改的数据。
