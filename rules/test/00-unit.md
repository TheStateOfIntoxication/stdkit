# 单元测试

> 测试由人手动触发，不由写侧 agent 顺手生成。本章管「写测试时怎么算合格」。
> 栈：JDK8 侧 JUnit 4 + Mockito（存量），Vue2 侧 Jest + `@vue/test-utils`；若 L3 声明 JUnit 5，按对应 API 替换。`p3c:` 为《Java 开发手册》章节序号。

## 测什么

### UT-GEN-01 测行为与边界，不测私有实现

```txt rule
level: must
severity: high
tags: test-design
applies: **/src/test/**/*.java, **/*.spec.js, **/*.test.js
p3c: 单元测试 2
```

**规则**：断言方法/组件的**可观察行为**（返回值、抛出的错误码、对外调用、渲染结果、emit 的事件）。禁止对私有方法反射调用、禁止断言内部调用顺序与次数（除「不得调用」这类契约）。

**为什么**：测实现的测试会和实现一起改——重构时它不保护你，只增加改动量；而它带来的「绿色」会让人误以为行为被覆盖了。

### UT-GEN-02 必须覆盖清单

```txt rule
level: must
severity: high
tags: test-coverage
applies: **/src/test/**/*.java, **/*.spec.js, **/*.test.js
p3c: 单元测试 1
```

**规则**：以下路径必须有正例 + 反例：幂等重复提交、状态非法迁移、金额与精度舍入、空值与空集合、分页上限与越界页码、越权访问他人资源、外部依赖超时/异常。

**为什么**：这份清单不是覆盖率指标，而是「线上出过事的地方」。金额、幂等、越权三类的共同点是**错得安静**——不报错，只是数据悄悄不对。

### UT-GEN-03 一个用例一个意图，用例间互不依赖

```txt rule
level: must
severity: medium
tags: test-design
applies: **/src/test/**/*.java, **/*.spec.js, **/*.test.js
p3c: 单元测试 5
```

**规则**：每个用例只验证一件事；不共享可变静态状态；不依赖执行顺序；每个用例自建数据、自行清理。`@Before` 里只放与业务无关的装配。

**为什么**：互相依赖的测试只能整体跑，一失败就要猜是哪个先被污染；而 `-Dtest=XxxTest#one` 单独跑会挂的测试，等于没有。

### UT-GEN-04 禁提交被禁用的用例

```txt rule
level: must
severity: high
tags: test-hygiene
applies: **/src/test/**/*.java, **/*.spec.js, **/*.test.js
deny: @Ignore; @Disabled; \.only\(; xit\(; xdescribe\(
p3c: 单元测试 6
```

**规则**：`@Ignore`、`@Disabled`、`it.only`、`xit` 在提交前处理掉：能修则修，不能修则删并写明原因。跳过原因必须写进提交说明。

**为什么**：被禁用的用例是隐形的红灯：它不失败，也不保护任何人，只在半年后让人以为「这块有测试」。

```java
// GOOD
@Test
public void create_duplicateRequest_returnsFirstResult() { }

// BAD
@Ignore
@Test
public void create_duplicateRequest_returnsFirstResult() { }
@Disabled
public void another() { }
```

```js
// BAD
it.only('x', () => {})
xit('x', () => {})
xdescribe('x', () => {})
```

### UT-NAM-01 用例命名说清场景与期望

```txt rule
level: should
severity: low
tags: test-naming
applies: **/src/test/**/*.java, **/*.spec.js, **/*.test.js
p3c: 单元测试 3
```

**规则**：`方法_场景_期望`（Java）或 `should xxx when yyy`（JS）。禁止 `test1`、`testCreate2`。

**为什么**：失败报告里只显示用例名。名字说不清场景时，看到红灯还得点进去读代码才知道坏了什么。

## 怎么跑

### UT-GEN-05 禁 sleep 等待异步

```txt rule
level: must
severity: high
tags: test-flaky
applies: **/src/test/**/*.java
deny: Thread\.sleep\(
p3c: 单元测试 4
```

**规则**：异步结果用可控时钟、`Awaitility`、Mockito 的 `verify(timeout)`，或把时间源注入后推进。禁止 `Thread.sleep` 等结果，禁止用重试掩盖不稳定。

**为什么**：`sleep` 的时长由测试机负载决定——本地 100ms 够，CI 上不够，于是出现「改一行重跑就绿」的假绿灯。

```java
// GOOD
verify(payClient, timeout(1000)).charge(orderNo);

// BAD
Thread.sleep(2000);
assertTrue(payClient.isCharged());
```

### UT-GEN-06 用例必须可重复：不依赖真实时间、随机、网络

```txt rule
level: must
severity: high
tags: test-flaky
applies: **/src/test/**/*.java
deny: LocalDateTime\.now\(; Instant\.now\(; new Date\(\); Math\.random\(
p3c: 单元测试 7
```

**规则**：当前时间通过 `Clock` / `Supplier<Instant>` 注入，随机数用可播种的 `Random`，外部地址一律 Mock。测试里禁止直接取系统时间与无种随机。

**为什么**：这两种依赖让同一个用例在不同日期的结果不同，而失败信息完全不能指向原因——最终大家都学会「再跑一次」。

```java
// GOOD
Clock fixed = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC);
service.setClock(fixed);

// BAD
LocalDateTime createTime = LocalDateTime.now();
Instant now = Instant.now();
Date d = new Date();
double r = Math.random();
UUID id = UUID.randomUUID();
```

### UT-J8-01 单测不连真库、真 Redis、真 MQ

```txt rule
level: must
severity: high
tags: test-isolation
applies: **/src/test/**/*.java
p3c: 单元测试 8
```

**规则**：模块测试 Mock 外部依赖；确需真实 DB 行为的用同进程内存库或 Testcontainers，并在 L3 登记。禁止连开发/测试环境的共享实例。

**为什么**：共享实例会被别人的数据污染，也会被自己的测试残留污染；更麻烦的是它让 CI 依赖网络，失败原因永远要二次判断。

### UT-J8-02 断言走断言库，不靠打印

```txt rule
level: must
severity: medium
tags: test-assert
applies: **/src/test/**/*.java
deny: System\.(?:out|err)\.print
p3c: 单元测试 5
```

**规则**：用 `assertEquals` / `assertThat` / `assertThrows`（JUnit 4.13+）。金额比较用 `compareTo` 或大数字比较器，不用 `equals`（`J8-API-05`）。

**为什么**：靠打印「看起来对」的测试永远会通过；而 `assertEquals` 比 BigDecimal 会因 scale 不同误报失败。

```java
// GOOD
assertEquals(0, actual.getAmount().compareTo(new BigDecimal("10.00")));

// BAD
System.out.println("amount = " + actual.getAmount());
```

## 前端

### UT-VUE-01 Vue2 单测测 props / emit / 渲染，不测内部方法

```txt rule
level: must
severity: medium
tags: test-vue
applies: **/*.spec.js, **/*.test.js
p3c: -
```

**规则**：`@vue/test-utils` 挂载组件，断言渲染文本、`emitted()`、`props` 变化后的重渲染。禁止直接调用 `wrapper.vm.someMethod()` 断言内部实现；异步更新用 `await wrapper.vm.$nextTick()`。

**为什么**：Options API 的 `this` 上挂的都是实现细节，测它等于把重构成本翻倍——而组件真正对外的东西只有渲染结果和事件。

```js
// GOOD
const wrapper = mount(OrderList, { propsData: { orderId: '1' } })
await wrapper.vm.$nextTick()
expect(wrapper.text()).toContain('待审批')

// BAD
wrapper.vm.loadList()
expect(wrapper.vm.list.length).toBe(3)
```
