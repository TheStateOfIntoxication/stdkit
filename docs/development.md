# stdkit 开发文档

这份文档面向「要改这个仓的人」：加规则、改规则、加命令、修 bug、发版。
如果你只是想用它检查自己的项目，看 [README](../README.md) 和 [命令手册](commands.md) 就够了。

先说一句可能反直觉的话：**这个仓里最容易改的是规则，最难的是「改完之后所有产物与文档不打架」。**
下面大部分内容其实都在讲后者。

---

## 1. 五分钟跑起来

需要 Node 18 或更高。不需要装依赖——这个项目零运行时依赖。

```bash
git clone <repo> stdkit && cd stdkit

node cli/ds.mjs check      # 规则仓自检：0 error 才算干净
node cli/ds.mjs eval       # 确定性层回归：每个用例的命中行号都要对上
npm test                   # 60 条单测（跨平台入口：scripts/run-tests.mjs）
```

三个命令都绿，说明环境没问题。接着可以看看它怎么对付一个坏例子：

```bash
node cli/ds.mjs scan evals/cases/java-bad     # 会列出 7 条命中，末尾退出码 1
node cli/ds.mjs brief evals/cases/vue2-bad    # 看「审查简报」长什么样
```

改完规则之后的标准动作（记不住就记这一行）：

```bash
node cli/ds.mjs catalog && node cli/ds.mjs build && node cli/ds.mjs check && node cli/ds.mjs eval
```

`catalog` 重建机器索引，`build` 重建产物，`check` 校验一致性，`eval` 跑回归。顺序不能换：
`build` 读的是 `catalog`，`check` 比对的是前两者的产物。

---

## 2. 环境准备与三个平台坑

**Node ≥ 18。** 代码用了 `??=`、顶层 `await`、`node:test` 这些 18 才稳定的东西。

**git 不是必须的，但没有它会少一半能力。** 需要 git 的功能有三个：

- `ds scan --diff`（只看本次改动）；
- `ds publish-check`（扫描集合来自 `git ls-files`，这样 `.gitignore` 生效）；
- `ds publish-check --history`（扫历史）。

git 不在 PATH 时，用环境变量指过去：

```bash
# Windows（本仓开发者常用）
export DS_GIT="C:/Program Files/Git/bin/git.exe"    # 换成你自己的 git 路径
# 或者 PowerShell
$env:DS_GIT = "C:/Program Files/Git/bin/git.exe"
```

不设也不会静默退化——`ds publish-check` 会直接报错并提示设置 `DS_GIT`。这是刻意的：
静默退回目录遍历会让扫描集合既变大（扫到 IDE 的本地产物）又变小（漏掉 git 的忽略规则）。

### 坑一：Windows 上的换行符

仓库里 `.gitattributes` 写着 `* text=auto eol=lf`，索引里统一 LF。本地需要：

```bash
git config core.autocrlf false
```

如果设成 `true`，checkout 出来是 CRLF，而 `ds build` 生成的是 LF，`ds check` 的「dist 与规则同步」会误报。
这条必须在**第一次 `git add` 之前**设好，晚了整棵树已经按 CRLF 进了索引。

### 坑二：PowerShell 写文件会带 BOM

`Set-Content -Encoding UTF8` 在 PowerShell 5.1 里会写 UTF-8 **BOM**。后果是：

- `git commit` 的提交信息首行多一个看不见的字符，`git log --oneline` 显示成 `﻿docs: ...`；
- JSON 文件被 `jq` 或别的语言解析时报错（本仓的 `readText` 会剥 BOM，但外部工具不会）。

现在 `ds check` 有 BOM 断言，仓里的 `*.json` 与三份顶层 Markdown 带 BOM 会直接报错。
写文件优先用编辑工具，或者用 Node 写：

```bash
node -e "require('fs').writeFileSync('x.md', '内容', 'utf8')"
```

### 坑三：bash 里嵌套引号

Windows 上通过 PowerShell 调 `bash -c '...'`，只要内容里有 `$`、`!`、反引号、中文引号，就很容易被吞。
写一次性脚本时，**用写文件的方式生成脚本再执行**，别在命令行里拼。

---

## 3. 仓库地图

```
rules/                  规则正文（唯一事实源，人读 + 模型读）
  java-jdk8/  01-spring.md 02-mybatis.md 03-engineering.md 00-language.md
  vue/        sql/        test/
policy/                 策略与豁免配置（severity 映射、阻断阈值、profile、发布脱敏）
  default.json  profiles/jdk8-vue2.json  publish.json  compat.json
catalog/rules.json      机器索引（生成物，勿手改）
dist/                   全部 Agent 产物（生成物，勿手改，但要提交）
cli/                    ds 的实现
  ds.mjs                命令入口（14 个子命令、参数解析、输出格式）
  lib/scan.mjs          确定性引擎（枚举、剥离注释、匹配、diff、maxHits）
  lib/parse.mjs         规则 Markdown → 结构化对象
  lib/catalog.mjs       结构化对象 → 机器索引
  lib/build.mjs         规则 + 策略 → dist/
  lib/check.mjs         规则仓自检（断言最多的地方）
  lib/eval.mjs          确定性层回归
  lib/semantic.mjs      语义层「记录 + 比对」
  lib/cross.mjs         仓级检查（回滚是否配齐、多方言是否齐）
  lib/policy.mjs        三层策略合并、阈值语义、单条覆盖校验
  lib/brief.mjs         生成审查简报（A 类/B 类/仓级/结论）
  lib/guard.mjs         写前护栏的判定（纯函数，可单测）
  lib/init.mjs          业务仓接入 + doctor 自检
  lib/install.mjs       装到五个客户端
  lib/publish.mjs       发布脱敏（工作树 + 历史）
  lib/mask.mjs          命中片段掩码
  lib/util.mjs          路径、遍历、UsageError、detectLayout
  lib/*.test.mjs        单测（4 个文件 / 60 条）
evals/cases/            确定性层用例（每个目录是一个小仓 + expect.json，23 个）
evals/semantic/         语义层用例（fixture + expect + 审查记录，2 个）
extensions/stdkit.ts    pi 扩展（注册工具 + 事件路由，判定全在 cli/lib/guard.mjs）
templates/              业务仓模板（AGENTS.md 的 L3 模板、CI 门禁脚本）
docs/                   文档（规则格式、架构、限制、命令、ADR、发布说明…）
scripts/run-tests.mjs   跨平台单测入口（CI 与 npm test 都走它）
```

**哪些能改、哪些不能改：**

| 路径 | 能手改吗 |
|---|---|
| `rules/` `policy/` `cli/` `evals/` `docs/` `templates/` `extensions/` | ✅ |
| `catalog/rules.json` `dist/` | ❌ 生成物。改了会在 `ds check` 里报「与规则不一致」 |
| `catalog/` 与 `dist/` | 必须和 `rules/` **同一次提交**，否则中间状态别人 checkout 下来是坏的 |

---

## 4. 写一条新规则：完整演练

假设要加一条：「`@Transactional` 方法里不许用 `System.out.println`」。这条不太好（规则本身值得再想想），
但作为演练正合适，它包含一次完整的「规则 → 索引 → 产物 → 用例 → 校验」。

### 第一步，选位置和 ID

ID 格式 `域-分类-序号`，前缀由域决定：`java-jdk8` → `J8`、`vue` → `V2`、`sql` → `SQL`、`test` → `UT`。
分类段沿用《阿里巴巴 Java 开发手册》的命名风格（`API` `SPR` `MBT` `SEC` `LOG` `EXC` …），方便和 p3c-pmd 对账。

我们的例子属于「日志」类，去 `rules/java-jdk8/01-spring.md` 找现有最大编号，接在后面。

### 第二步，写正文

````markdown
### J8-LOG-03 事务方法内禁止向标准输出打印

```txt rule
level: must
severity: medium
tags: logging, spring
applies: **/*.java
p3c: -
```

**规则**：`@Transactional` 方法体内禁止 `System.out.println` / `System.err.println`。

**为什么**：事务里打日志到标准输出，容器重定向后大量丢失；线上排障时会误以为「这段没执行」。

```java
// BAD
@Transactional
public void create(OrderForm form) {
    System.out.println("create " + form.getOrderNo());
}

// GOOD
@Transactional
public void create(OrderForm form) {
    log.info("create orderNo={}", form.getOrderNo());
}
```
````

四条要求，写的时候就要满足：

1. **元数据块必须有** `level` `severity` `tags` `applies` `p3c`；没有手册对应条款就写 `-`。
2. **正文必须有** `**规则**` 与 `**为什么**`。写不出后果的规则，通常不值得存在。
3. **示例用 `// BAD` / `// GOOD` 标记**（SQL 用 `-- BAD`、Vue/HTML 用 `<!-- BAD -->`，`# BAD` 也认）。
4. **示例代码必须是 JDK 8 能编译的**。这个仓自己的规则就是不让你写 `var` / `record` / `list.of`。

### 第三步，加 `deny` 正则

这条能不能机判？能——只要在 `@Transactional` 附近出现 `System.out.print`。但「附近」没法用单行正则表达。
两个选择：写成不看上下文的 `System\.out\.print(ln|f)?\(`（会误报小工具类里的打印），或者干脆不机判。

假设我们接受误报风险（实际项目里会配合 `exclude` 限制到 service 层），写成：

```txt rule
deny: System\.(out|err)\.print(ln|f)?\(
```

加完必须补一条 `// BAD` 行能命中它（上面已有），否则 `ds check` 会报
「deny 正则未命中任何 // BAD 样例」。

### 第四步，重建索引与产物，让 check 把问题挑出来

```bash
node cli/ds.mjs catalog && node cli/ds.mjs build && node cli/ds.mjs check
```

第一次跑，通常会红一到两处，都是正常的：

- `prompts/review-java.md 缺少规则 J8-LOG-03` —— 因为 `build` 是从 catalog 生成的，重建后就有了；
  如果你忘了 `build`，就会看到这条。
- `README.md 规则数写 127，catalog 是 128` —— 数字断言在提醒你更新 README。

### 第五步，补回归用例

`ds eval` 有一条硬约束：**每条可机判规则至少在一个用例里命中过**。新规则没命中过，eval 会红并点名。
这条约束防的是「规则写错了也能全绿」——比如 `applies` glob 拼错、正则永不命中，没有它你根本发现不了。

两种做法：

- 放进已有的相关用例（改动小，但那个用例的 `expect.json` 要加一行）；
- 新建一个用例目录（推荐，尤其是规则有特殊形态时）。

新建的话：

```
evals/cases/java-log-out/
  expect.json
  src/main/java/com/x/service/OrderService.java   ← 故意写坏的样本
```

`expect.json`：

```json
{
  "domain": "java-jdk8",
  "findings": [
    { "ruleId": "J8-LOG-03", "file": "src/main/java/com/x/service/OrderService.java", "line": 12 }
  ]
}
```

行号是**手写的**，不是从实现反推的。这一点很重要：如果让实现自己生成期望值，用例就永远是对的，
它只能证明「代码没变」，不能证明「代码是对的」。

跑：

```bash
node cli/ds.mjs eval        # 会告诉你哪个用例漏报/多报
```

### 第六步，收尾

```bash
node cli/ds.mjs catalog && node cli/ds.mjs build
node cli/ds.mjs check && node cli/ds.mjs eval && npm test
git add -A && git commit
```

---

## 5. 改现有规则：三种改法，三种代价

**改措辞 / 改「为什么」**：最轻。改完 `build` + `check` 即可，`eval` 不受影响（除非你动了示例）。

**改 `severity` 或 `level`**：会影响 prompt 里的分级表格，以及阻断结论。改完 `build`，
然后看 `ds brief` 的输出有没有变。提交说明里要写 `影响: 规则 J8-XXX 判级 critical→high`。

**改 `deny` / `allow`**：最重。三件事必须一起做：

1. 确认新正则能命中本规则的 `// BAD`（`ds check` 会验）；
2. 确认不误命中 `// GOOD`（同上）；如果确实需要例外，用 `allow` 或 `exclude`，不要放宽整个正则；
3. 跑 `ds eval`，看有没有用例从绿变红。**漏报和误报都是回归**，都要处理：
   - 漏报 → 说明这个用例的期望值需要更新（先想清楚为什么以前没命中）；
   - 误报 → 优先收紧正则，其次加 `allow`，再次加 `exclude`。绝不通过「删掉那个用例」来解决。

有个真实教训：`V2-API-05` 从纯语义规则升级成机判（加了 `deny` + `maxHits: 4`）之后，
`vue2-bad` 用例里那个只有 1 处 `axios.get` 的文件**没有被新规则命中**（因为 1 < 4，没超限），
但 `eval` 报「多报」。原因是实现把「未超限的命中」也当成违规输出了。修的是实现，不是用例。

---

## 6. 加一个域（比如 `python`）

`check` 里有一条三向一致性断言：`DOMAINS`（ID 前缀）↔ `SKILLS`（哪个 skill 带这个域）↔ `rules/<domain>/` 目录。
漏一处就报「注册了域但没产物」。所以按这个清单走：

1. `rules/python/` 放规则文件（至少一个 `.md`）；
2. `cli/lib/parse.mjs` 的 `DOMAINS` 加一行 `python: 'PY'`；
3. `cli/lib/build.mjs` 的 `SKILLS` 加到对应 skill（或新建 skill）；
4. `cli/lib/build.mjs` 的 `REVIEWS` 加这个域，并在 `reviewPrompt()` 的 `scopes` 三元里给它一个 glob；
5. `cli/lib/init.mjs` 的 `SKILL_OF_DOMAIN` 加一行（doctor 用它校验 references 收录）。

然后：

```bash
node cli/ds.mjs catalog && node cli/ds.mjs build && node cli/ds.mjs check
```

`check` 会顺手告诉你 prompt 的 A/B 清单是否等于该域规则全集。新域的规则如果一条都没命中过，
`ds eval` 也会红。

---

## 7. 加一个子命令或参数

四个地方要改，`check` 会替你检查其中两处：

1. `cli/ds.mjs` 的 `main()` 里加 `case 'xxx':`；如果是布尔参或带值参数，还要加进 `BOOL_FLAGS` 或 `VALUE_FLAGS`
   （漏了会得到「未知参数」——这是刻意的：参数拼错必须报错，不能静默忽略）；
2. `HELP` 常量里加一行说明；
3. `docs/commands.md` 加一节。`check` 断言：**`ds help` 里出现的每个命令、每个 `--flag` 都必须在这份手册里出现**；
4. 如果这个命令有退出码语义，加进 `commands.md` 的退出码表，并想一下它属于 1（有阻断）还是 2（用法/环境错误）。

用法错误一律抛 `UsageError`（`cli/lib/util.mjs`），顶层 catch 会把它映射成 **exit 2**。
不要直接 `throw new Error`——那会退化成 1，CI 就没法区分「命令写错了」和「代码有问题」。

---

## 8. 代码导读：每个文件在干什么

**`cli/ds.mjs`（入口，约 640 行）**
只做三件事：解析参数、调用 lib、格式化输出。所有判定逻辑都不在这里。想看某个命令干什么，
先在这个文件里找到 `case`，再顺着调用的 lib 函数读下去。

**`cli/lib/parse.mjs`**
把规则 Markdown 切成结构化对象：标题里的 ID 与标题、元数据块、正文、以及代码围栏里按
`// GOOD` / `// BAD` 分段的示例。所有「格式」相关的规则都在这里，比如元数据键白名单、CSV/分号分隔的解析。

**`cli/lib/scan.mjs`（最长的文件）**
确定性引擎。几个值得单独看的地方：

- `stripLines()` / `makeStripper()`：注释剥离，按文件类型分派；`.vue` 按块处理；
- `listFiles()`：git 优先、遍历兜底；
- `matchLine()`：单行匹配核心，`runScan`（仓扫描）与 `scanText`（护栏）共用它，所以护栏不会跑出第二套判定；
- `capByMaxHits()`：计数型规则收口；
- `changedLines()`：`--diff` 的行号集合。

**`cli/lib/check.mjs`**
规则仓自检。这是断言最密集的地方，也是「这个项目怎么约束自己」的答案。改规则/改命令后红的一般都是它。

**`cli/lib/build.mjs`**
生成 `dist/`。里面用模板字符串拼 Markdown，改的时候注意：**模板字符串里不能出现裸反引号**，
否则会提前终止（这个坑踩过三次，报错信息是 `SyntaxError: Unexpected identifier`）。

**`cli/lib/policy.mjs`**
三层策略合并 + 阈值语义 + 单条覆盖校验 + 键白名单。`resolveFailOn()` 里的注释解释了
「为什么不能把 blockOn 当精确集合」。

**`cli/lib/brief.mjs`**
生成审查简报。A 类（已确认的命中）、B 类（待模型判的清单）、仓级（要跑 `ds cross`）、L3 提示、结论。
它和 `scan` 共用同一套阈值语义，两个命令不会互相打架。

**`cli/lib/guard.mjs`**
护栏判定，纯函数。`relPathOf()` 里有一段注释讲 Linux 上 `path.sep` 不把 `\` 当分隔符导致 CI 红灯的教训。

**`cli/lib/publish.mjs`**
发布脱敏。`listPublishFiles()`（git 优先）与 `runHistoryCheck()`（扫历史新增行）是两块核心。

**`cli/lib/semantic.mjs`**
语义层「记录 + 比对」。不调模型，只读 `evals/semantic/<case>/result.json`。

**`cli/lib/util.mjs`**
路径与遍历工具、`UsageError`、`detectLayout()`（判断当前目录是规则仓 / dist 安装 / 其他）。

---

## 9. 调试手册

**想知道某条规则为什么没命中**

```bash
node cli/ds.mjs rules --tag money          # 先确认它在索引里、applies 对不对
node cli/ds.mjs scan <文件> --json | jq '.findings'   # 只看这一个文件
```

`applies` 是相对**业务仓根**的 glob。常见错误是写成绝对路径，或者在子目录里跑 `ds scan`
导致相对根变了。

**想验证掩码**

```bash
node cli/ds.mjs scan evals/cases/config-secret            # 应该是 password=***
node cli/ds.mjs scan evals/cases/config-secret --no-mask  # 本地排障看原文
```

**`--json` 输出被污染 / 解析失败**
检查是不是有人往 stdout 打了日志。所有诊断信息都必须走 `console.error`。
另外 git 子进程的 stderr 曾经会透传出来（`execFileSync` 的默认行为），现在两处 git 调用都显式
`stdio: [ignore, 'pipe', 'pipe']`。新加 git 调用时照抄这一行。

**diff 模式不报，全量模式报**
先怀疑「计数与过滤的顺序」。`maxHits` 的计数必须在 diff 过滤之前，否则文件里已有的命中数不到阈值。
单测 `runScan --diff + maxHits` 就是守这个的。

**CI 红了但本地绿**
本地是 Windows、而且可能没有 git，恰好绕过两类问题：Linux 的路径语义、无 git 时的 fail-closed 行为。
先看 CI 的 step summary（`scripts/run-tests.mjs` 会把失败的用例名写进去），再想本地怎么复现。
需要 git 的用例在有 git 的环境才会跑。

**只想跑一个测试文件**

```bash
node --test cli/lib/compat.test.mjs
# 只想跑名字里带某段文字的一条：
node --test --test-name-pattern="maxHits" cli/lib/structure.test.mjs
```

**想确认某条断言真的有用（注入验证）**
把被保护的东西故意改坏，看它是否报错，再改回来。这个项目所有关键断言都这么验过一次。例如：

```bash
# 把 policy 里删掉的死键加回去，check 应该报「未知键」
node -e "const f='policy/default.json',j=require('./'+f);j.domains=['vue'];require('fs').writeFileSync(f,JSON.stringify(j,null,2))"
node cli/ds.mjs check
git checkout policy/default.json
```

**想看看某个命令的退出码**

```bash
node cli/ds.mjs scan evals/cases/java-bad >/dev/null; echo $?    # 1：有阻断
node cli/ds.mjs scan --severity hight >/dev/null; echo $?        # 2：用法错误
node cli/ds.mjs check >/dev/null; echo $?                        # 0：通过
```

---

## 10. 测试怎么写

三层，各写各的：

**单测（`cli/lib/*.test.mjs`）** 针对纯函数与 CLI 行为。不依赖网络、模型、真实业务仓。
写的时候注意两点：

1. 需要 git 的用例，开头做一次可用性检查，没有 git 就 `return`（CI 上一定跑得到）；
2. 断言文件路径时**不要**在测试里替函数做 `split(path.sep).join('/')`——那会把跨平台 bug 掩盖掉。
   这正是 `relPathOf` 那个 Linux 专属 bug 逃过本地测试的原因。

**确定性层用例（`evals/cases/<case>/`）** 针对「规则在真实形态上对不对」。期望行号手写。
好用例的设计原则：

- 一对一对地写：`*-bad` 锁漏报，`*-clean` 锁误报；
- 边界用同一个用例覆盖（例如 `vue-api-05` 同时放了「5 处请求」与「恰好 4 处」两个文件）；
- 故意写坏的样例放 `evals/cases/` 下，`ds scan` 会整体跳过 `evals/cases`，不会自我误报。

**语义层用例（`evals/semantic/<case>/`）** 针对「模型拿到条文后判得对不对」。工具不调模型，
只做两件事：校验结构（`mustReport` 必须是没有 `deny` 的规则）、比对上次审查记录。

```bash
# 审完 fixture 后记录结论（写进 result.json，带日期和记录人）
node cli/ds.mjs eval --record tx-remote-call --reported J8-SPR-03 --by 你的名字
```

`reported` 里的 ID 会被校验是否存在——写错 ID 只会表现为「漏审」，提示太绕，所以直接拦住。

---

## 11. 常见坑（都是真踩过的）

| 现象 | 原因 | 怎么避 |
|---|---|---|
| 规则永不命中 | `deny` 里用了字面分号 `;`，被当成列表分隔符 | 写成 `\x3b` |
| 规则只在行首匹配不到 | 想让大小写不敏感 | 只能写行首前缀 `(?i)`，不支持行内 |
| 规则匹配不到注释内容 | 匹配前注释已被剥掉 | 加 `raw: true` |
| `var` 规则在示例字符串里误报 | 字符串内容参与匹配 | 加 `noString: true` |
| 条文说「除 X 外」但规则照样在那误报 | 例外只写在文字里，没有机制 | 加 `exclude`（文件级）或 `allow`（行级），`check` 会提醒 |
| 某个 `applies` 格式从不命中 | 正则只认一种语言的字面量 | `check` 要求每种格式都有 BAD 样例 |
| `build.mjs` 报 `SyntaxError: Unexpected identifier` | 模板字符串里出现裸反引号 | 用 `\`` 转义，或改成数组 `join` |
| 提交信息首行有个看不见的字符 | PowerShell `Set-Content -Encoding UTF8` 带 BOM | 用 Node 写文件，或改完 `git commit --amend` |
| `ds publish-check` 报 `.idea/workspace.xml` | git 不在 PATH，静默退回了目录遍历 | 设 `DS_GIT`（现在会直接报错提示） |
| `ds check` 报「产物与规则不一致」 | 改了规则没 `build`（或反了） | `catalog && build && check` |
| `dist` 与 `catalog` 的改动散在两个提交里 | 生成物没跟规则同提交 | 记住：规则、catalog、dist 永远一起提交 |
| 业务仓 `policy.json` 配了没生效 | 键名拼错（`blockon`） | 现在会报错并点名；以前是静默忽略 |
| `--severity` 拼错时 CI 显示「有阻断」 | 用法错误曾返回 1 | 已修：用法错误 exit 2 |
| 单测在 CI 上红、本地绿 | 本地 Windows 没有 git，跳过了一起 git 用例 | 用 git bash 跑一遍 `node scripts/run-tests.mjs` |
| `node --test cli/lib/*.test.mjs` 在 Windows CI 上找不到文件 | pwsh 不展开 glob | 统一用 `npm test`（走 `scripts/run-tests.mjs`） |

---

## 12. 提交与发布

**提交信息**首行 `type: 摘要`，type 取 `feat` `fix` `refactor` `chore` `docs` `perf` `test` `revert`。
动到规则、判级、多方言、配置、任务、缓存、API 的，加一行 `影响:` 说明波及面，例如：

```
影响: 规则 V2-API-05 从语义规则变为可机判（新增 maxHits: 4）；prompt 的 A/B 分类随之变化
```

一个需求一个提交。大范围格式化单独一个提交（否则 review 时什么都看不出来）。

**发版流程**（本地能做的部分）：

1. 改 `package.json` 的 `version`；
2. `CHANGELOG.md` 顶部加一节（`check` 会断言首个版本条目与 `package.json` 一致）；
3. `node cli/ds.mjs catalog && node cli/ds.mjs build`；
4. 跑全套：`check` / `eval` / `eval --semantic` / `npm test` / `doctor` / `publish-check --history`；
5. 按 [发布检查清单](publish-checklist.md) 过一遍（含「最近一次 CI 四个 job 全绿」这条硬前置）；
6. `git tag -a vX.Y.Z -m "..."` 并 push 标签——标签会额外触发 `publish-check`（工作树 + 历史）；
7. GitHub Release 的正文来自 `docs/release-notes/vX.Y.Z.md`。

**1.0 之后要注意**：`catalog` 形状、`policy` 键、退出码语义都被 `policy/compat.json` +
`cli/lib/compat.test.mjs` 冻住了。想改名/删键/改类型，测试会红并给出三步升级流程
（改大版本 → 改快照 → 写 ADR）。**新增可选字段不算破坏**，加进 `compat.json` 的 `ruleOptional` 即可。

---

## 13. 文档地图

改代码之前，先看哪份文档对症：

| 你要做的事 | 看这份 |
|---|---|
| 理解整体设计、为什么这么分层 | [design.md](design.md) |
| 写一条规则、元数据每个键的含义 | [rule-format.md](rule-format.md) |
| 用命令、看退出码、参数 | [commands.md](commands.md) |
| 概念之间怎么串起来（rules / policy / catalog / dist / baseline） | [concepts.md](concepts.md) |
| 这类问题为什么抓不到 | [limits.md](limits.md) |
| 哪些形态抓不到（静态分析边界） | [static-analysis.md](static-analysis.md) |
| 装到各客户端、排障 | [install.md](install.md) |
| 发布前要过哪些检查 | [publish-checklist.md](publish-checklist.md) |
| 战略决策记录（不做 Vue3、语义层不进 CI、1.0 冻什么） | [docs/adr/](adr/) |
| 1.0 冻结评估的完整证据 | [v1-freeze-review.md](v1-freeze-review.md) |
