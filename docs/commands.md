# 命令手册

所有命令都是 `node cli/ds.mjs <子命令>`。全局装过（`npm i -g stdkit`）之后可以直接用 `ds <子命令>`；临时跑用 `npx stdkit <子命令>`——`npx ds` 会装到 npm 上另一个叫 `ds` 的包。
无第三方依赖，Node ≥ 18。

| 命令 | 一句话 |
|---|---|
| `check` | 规则仓自检（CI 跑这个） |
| `eval` | 确定性层回归 + 覆盖率断言 |
| `build` | `rules/` → `dist/` |
| `catalog` | 重建 `catalog/rules.json` |
| `scan` | 对业务仓跑确定性检查（按行） |
| `cross` | 仓级检查：回滚是否配齐、多方言是否齐（ADR 0001） |
| `brief` | 生成审查简报（喂给模型） |
| `init` | 业务仓接入：探测栈 → 生成 L3 + 基线 |
| `doctor` | 业务仓与 stdkit 自检 |
| `baseline` | 把当前命中快照成基线豁免 |
| `rules` | 检索规则 |
| `publish-check` | 发布前脱敏检查 |
| `install` | 把 dist/ 装到各客户端 |
| `version` | 版本 + 规则数（也可写 `--version`） |
| `help` | 帮助 |

**退出码是给 CI 的契约**，三档，不要混：

| 码 | 含义 | 典型场景 |
|---|---|---|
| **0** | 通过 | 无命中；`check` 在 dist 安装下「跳过」；`check`/`eval` 无问题 |
| **1** | 有阻断 / 失败 | `scan` 命中阻断级、`check` 有 error、`eval` 有失败或未覆盖、`doctor` 有 FAIL、`publish-check` 有命中 |
| **2** | **用法或环境错误** | 参数拼错（`--severity hight`）、未知参数/子命令、`--limit abc`、profile 不存在、`check` 指到既非规则仓也非 dist 的目录、git 缺失时的 `--diff` |

为什么要分开：CI 只看退出码。若「参数拼错」也返回 1，就和「发现了阻断级问题」无法区分——
人会去查代码，而实际是命令写错了。

## check

```bash
node cli/ds.mjs check                 # 本仓（规则仓）自检
node cli/ds.mjs check /path/to/stdkit # 指定目录：用来验证「这是不是规则仓」
node cli/ds.mjs check /path/to/dist   # dist 安装 → 一行说明 + exit 0
node cli/ds.mjs check /tmp/empty      # 走错目录 → exit 2
```

规则仓自我检查，CI 直接跑。它查：

- 规则 ID 唯一、格式合法、`level`/`severity`/`status`/`raw`/`noString` 取值合法；
- 每条 `deny` 能编译、能命中自己的 `// BAD`、不误命中 `// GOOD`（除非被同规则 `allow` 豁免）；
- `applies` 声明的每种文件格式都有对应语言的 BAD 样例；
- 示例代码不用 JDK 9+ 语法（`var` / `isBlank()` / `List.of` …）；
- 正文有 `**规则**` 与 `**为什么**`，无占位符；
- 例外措辞（「除 … 外」「只允许」「豁免」）是否落成了 `exclude` / `allow`；
- 正则有无**嵌套量词**（`(x+)+` 这类指数回溯）与超长单行回溯风险；
- `catalog/` 与 `dist/` 是否与 `rules/` 同步；
- prompt 与 SKILL 的规则清单是否等于该域全集（缺一条就报，并点名）；
- `DOMAINS` ↔ `SKILLS` ↔ `rules/<domain>/` 三向一致；
- `policy/*.json` 的单条覆盖键是否合法；
- `LICENSE` 与 `package.json.license` 是否一致；`docs/provenance.md` 是否存在。

**三分判定**（与 `doctor`、`gate.sh` 共用同一份 `detectLayout`）：

| 目录里有 | 判定 | 行为 |
|---|---|---|
| `rules/` | 规则仓 | 正常自检 |
| `catalog/rules.json` + `cli/ds.mjs`，无 `rules/` | dist 安装 | 打印一行说明，**exit 0**（`gate.sh` 带 `set -eu`，这里非 0 会拦死业务仓所有 PR） |
| 都没有 | 走错目录 | **exit 2** + 明确指出「既没有 rules/，也没有 catalog/rules.json + cli/ds.mjs」 |

第三类不是理论情况：`rules/` 被误删、`sparse checkout` 漏目录、`STDKIT_HOME` 写错层级都会命中。
把它当「跳过」处理，就等于让「没检查」伪装成「检查通过」。

## eval

```bash
node cli/ds.mjs eval
```

跑 `evals/cases/*`（每个用例是一个小仓 + `expect.json`）。

- `*-bad` 锁漏报：该报的必须报；
- `*-clean` 锁误报：不该报的一个都不许报；
- 每条可机判规则必须至少被一个用例命中，否则 exit 1 并点名（防「规则写错了也能全绿」）。

`expect.json` 支持的可选断言：`blocked`（阻断结论）、逐条 `severity`（生效级）、`waived`（豁免）。

### 语义层：`--semantic`（不调模型）

```bash
node cli/ds.mjs eval --semantic                       # 跑 evals/semantic/<case>
node cli/ds.mjs eval --record pay-retry --reported J8-SPR-12 --by 你的名字
```

`evals/semantic/<case>/` 结构：

| 路径 | 作用 |
|---|---|
| `fixture/` | 待审代码片段（小、真、能说明问题） |
| `expect.json` | `{ mustReport: [...], mustNotReport: [...], why: "为什么这段必须命中" }` |
| `result.json` | 一次人工/agent 审查的记录（`reported` + `recordedAt` + `recordedBy`），由 `--record` 写 |

**它不调模型**（ADR 0003：CI 不依赖模型与网络）。它做两件事：

1. 校验用例本身——`mustReport` 必须是**没有 `deny` 的规则**（有 `deny` 就该放进 `evals/cases`），
   fixture 不能为空，`why` 建议写（warning）；
2. 比对「上一次审查的记录」与期望：漏审 / 误报都算失败。

没记录的用例显示「未记录」并给出 `--record` 模板，**不算失败**；一旦记录过，改条文或 prompt 后
重跑发现判定变了，就是回归信号。`--by` 会写进 `result.json`——别人复核时要知道是谁审的。

## build / catalog

```bash
node cli/ds.mjs catalog   # 重建 catalog/rules.json
node cli/ds.mjs build     # rules/ → dist/
```

`build` 一次生成：4 个 skill、4 个 review prompt、4 个客户端适配文件 + `dist/AGENTS.md`，
并把 `cli/`、`catalog/`、`LICENSE` 一起拷进 `dist/`（所以 dist 自包含，可离线安装）。

**这是生成物，不要手改。** 改完 `rules/` 要 `catalog && build` 并与规则改动同一次提交。

## scan

```bash
node cli/ds.mjs scan                  # 全仓
node cli/ds.mjs scan src/main/java    # 某个目录
node cli/ds.mjs scan src/A.java       # 单个文件
node cli/ds.mjs scan --diff           # 只看本次改动（默认对比 HEAD）
node cli/ds.mjs scan --diff origin/main
```

`--diff` 走 `git diff` 的 hunk 行号；未跟踪的新文件按整文件算（`git ls-files --others`，
新建目录里的文件不会漏）。

| 开关 | 用途 |
|---|---|
| `--json` | 机器可读（CI 与评测用） |
| `--fail-on high` | 门禁阈值：high 及以上退出 1（阈值语义，不是精确集合） |
| `--severity high` | 只跑该级规则，首行会同时给「本级 N 条 / 全部 M 条」 |
| `--domain java-jdk8` | 只跑某个域（`java-jdk8` / `vue` / `sql` / `test`） |
| `--limit 50` | 终端最多显示多少条（默认 200；`--json` 不受限） |
| `--profile jdk8-vue2` | 用某个策略档（`policy/profiles/<name>.json`） |
| `--no-mask` | 命中片段不掩码。默认把 `password=xxx` 之类替换成 `***`——命中行往往就是密钥本身，原样打出来等于二次泄漏到 CI 日志与模型上下文 |

## cross

```bash
node cli/ds.mjs cross                  # 当前目录
node cli/ds.mjs cross /path/to/repo --json
```

与 `scan` 的分工：`scan` 按行判、给行号；`cross` 判**文件集合**层面的事，报告的是文件级问题。
混进 `scan` 会让 `--diff`、baseline 行级豁免失去意义，所以单独一个命令。

目前只做 ADR 0001 定下的两条（误报最低、价值最高）：

| 规则 | 判据 |
|---|---|
| `SQL-RBK-01`（high） | `sql/upgrade/<dialect>/00N_x.sql` 必须有 `rollback/00N_x.sql`（或 `sql/rollback/<dialect>/00N_x.sql`） |
| `SQL-DIA-01`（critical） | L3 `engines` 声明的每个方言目录都存在，且各目录脚本序号集合一致 |

**只认标准布局**：不是 `sql/upgrade/<dialect>/…` 结构的仓直接跳过，不误报。

这两条**不会**出现在 `ds brief` 的 B 类语义清单里——`brief` 会单独给一段「仓级：跑 `ds cross` 得到的才算数」，
避免模型重复劳动（ADR 0001）。
命中 `critical` / `high` 时退出 1。

在 CI 门禁里（`templates/ci/gate.sh`）它排在 `scan --diff` 之后；非标准布局的仓不适用时，
给 `gate.sh` 加 `--no-cross` 关掉——这是脚本参数，不是 `ds cross` 的参数。

## brief

```bash
node cli/ds.mjs brief --diff
node cli/ds.mjs brief --json
node cli/ds.mjs brief --fail      # 有阻断项时退出 1（默认始终 0）
```

输出三段：**A 类**（已确认的机判命中，含 `文件:行`）、**B 类**（该域需要模型判断的规则清单，
带级别）、**结论**（blocked / 未阻断）。`blocked` 与 `scan` 用同一套阈值语义，两个命令不会互相打架。

默认不因「有阻断项」退出非 0：审查 prompt 把 brief 当信息收集步骤，非 0 会让模型误判成命令失败。

## init

```bash
node cli/ds.mjs init                     # 探测当前目录
node cli/ds.mjs init /path/to/repo --dry-run
node cli/ds.mjs init /path/to/repo --scaffold --dry-run
node cli/ds.mjs init /path/to/repo --scaffold
node cli/ds.mjs init /path/to/repo --force
```

读 `pom.xml` / `build.gradle` / `package.json` / MyBatis 配置，判断 JDK 版本、Spring Boot 版本、
持久化框架、数据库方言、根包名，生成：

- `AGENTS.md`（L3：本仓的具体变量），探测不到的格子留空，结束时列出「待人工填（N）」；
- `.stdkit/baseline.json`（存量豁免，空快照）。

`--scaffold` 按 `J8-SPR-19` 的默认树建 `src/main/java/<根包>/{controller,service,...}`：
**只建空目录、不放文件、幂等**。`--force` 覆盖已存在的 `AGENTS.md`。

## doctor

```bash
node cli/ds.mjs doctor
node cli/ds.mjs doctor /path/to/repo
```

业务仓检查：`AGENTS.md` 存在；JDK / Spring Boot / 方言 / 根包与探测结果一致（版本只比主版本）；
声明的规范版本；`.stdkit/baseline.json` 可解析、是否过期或缺 `reason`；`.stdkit/policy.json` 的覆盖键合法；
`sql/upgrade/<方言>/` 是否配了 `rollback/`；是否装了两套同名 skill。
另外检查 stdkit 自身 catalog / dist 是否同步、规则是否都被对应 skill 收录。

## baseline

```bash
node cli/ds.mjs baseline                      # 快照当前全部命中
node cli/ds.mjs baseline /path/to/repo --days 90
node cli/ds.mjs baseline --dry-run
```

按「规则 + 文件」聚合成 `.stdkit/baseline.json` 的豁免项。**豁免是文件级的**（改个空行不会失效，
但该文件新增的同类代码也会被放过），到期自动失效并重新计入。

```json
{ "waivers": [{ "ruleId": "J8-API-04", "file": "src/legacy/**", "until": "2026-12-31", "reason": "Q1 重构" }] }
```

## rules

```bash
node cli/ds.mjs rules --tag money
node cli/ds.mjs rules --level must
node cli/ds.mjs rules --domain vue --severity high --json
```

显示格式是 `ID  level/生效级  标题`，被 `policy` 单条覆盖过的会显示成 `high → medium`，
末尾统计本仓覆盖了几条。

## publish-check

```bash
node cli/ds.mjs publish-check                    # 扫本仓
node cli/ds.mjs publish-check /path/a /path/b    # 多仓一起扫
```

按 `policy/publish.json` 的 `forbidden` 扫（内网 IP、`sk_live_`、私钥头、内部仓名、内部账号…），
命中 exit 1；确认可公开的加进 `allowPaths`。CI 里只在打 tag 时跑。

输出里的命中片段**始终掩码**（这个命令的整个意义就是别把密钥打出来）；要看原文去读文件，
不要为了让输出「完整」而关掉掩码。

覆盖的形态（`policy/publish.json`，加一条不用改代码）：内网 IP、云厂商 key、支付平台密钥、私钥头、
内部仓名与账号域名、**本机绝对路径**（`<盘符>:/work/…`、`/home/<you>/…` 这类，泄漏工作区布局与用户名）、
**内部工作区目录名**、**另一套同名规范包的名字**。

**必须有 git**：扫描集合来自 `git ls-files`（含未跟踪但未忽略的文件，即真正会提交的东西），
这样 `.gitignore` 才生效。这是 git 仓却调不到 git 时**直接报错**，不会静默退回目录遍历——
静默降级会让扫描集合悄悄变大（把 `.idea/` 里的本机路径全算进来）又悄悄变小（漏掉忽略规则）。
git 不在 `PATH` 时设 `DS_GIT`。

**`--history` 连历史一起查**（只看 diff 的**新增行**，`allowPaths` 按路径过滤）：

```bash
node cli/ds.mjs publish-check --history
```

为什么需要它：`force-push` 只改引用、不删对象，**工作树干净不代表历史干净**。历史里的命中改不掉
（只能删仓重建，或确认远端已 GC），所以「已知且接受」的历史命中写进 `policy/publish.json` 的
`historyAllow`（`{id, path, reason}`），逐条枚举、带理由；不接受「它一直在那儿」这种理由。

## install

```bash
node cli/ds.mjs install --all --dry-run        # 先看会写哪些文件
node cli/ds.mjs install --pi                   # 交给 pi install
node cli/ds.mjs install --claude --codex       # 用户级：~/.claude、~/.agents/skills
node cli/ds.mjs install --cursor --copilot --project /path/to/repo
node cli/ds.mjs install --uninstall            # 按 manifest 反向删除
```

| 目标 | 落位 |
|---|---|
| `--pi` | 执行 `pi install <dist>`（找不到 pi 时只打印命令） |
| `--claude` | `~/.claude/{.claude-plugin/plugin.json,commands/,skills/}` |
| `--codex` | `~/.agents/skills/{write-*,review-*}` |
| `--cursor` | `<project>/.cursor/rules/stdkit.mdc` |
| `--copilot` | `<project>/.github/copilot-instructions.md` |

特点：**一份实现**（`cli/lib/install.mjs`），`install.sh` / `install.ps1` 只是三行 shim，
五端行为不会漂移。装完会在 `~/.stdkit/install-manifest.json` 记下写过的文件，
`--uninstall` 只删这些（不碰你自己的东西）。`--dry-run` 一个字节都不写。

## version

```bash
node cli/ds.mjs --version      # 等价于 -v / version
# stdkit 0.17.0（127 条规则 / 48 可机判）
```

版本只从 `package.json` 读（单一源），规则数来自 `catalog/`。

## 门禁脚本（`templates/ci/gate.sh`）

CI 里的一步到位版本，任何 CI 都能跑：

```bash
STDKIT_HOME=/path/to/stdkit ./gate.sh                 # 对比 origin/main
STDKIT_HOME=/path/to/stdkit ./gate.sh main            # 指定 base-ref
STDKIT_HOME=/path/to/stdkit ./gate.sh --no-cross      # 跳过仓级检查
STDKIT_HOME=/path/to/stdkit ./gate.sh --help
```

| 参数 | 用途 |
|---|---|
| `base-ref` | 对比基线，默认 `origin/main`；只判本次变更，历史存量不拦 |
| `--no-cross` | 跳过 `ds cross`（非标准布局的仓用） |
| `-h` / `--help` | 用法 |

`STDKIT_HOME` 有三种情况：指向**源码仓**（含 `rules/`）→ 先跑 `ds check`；指向 `dist/` 安装（有
`catalog/rules.json` + `cli/ds.mjs`）→ 跳过自检，`scan` 与 `cross` 照常；**两者都不是**（写错层级）→
直接 exit 2 并说明原因，而不是跑到 `scan` 才报 ENOENT。

退出码：0 通过 / 1 有阻断命中 / 2 用法或环境错误。

## 策略与豁免

**严重级三层覆盖**（后者覆盖同名键）：

```text
policy/default.json            ← 默认（critical + high 阻断）
policy/profiles/<name>.json    ← --profile 指定
<业务仓>/.stdkit/policy.json    ← 单仓覆盖，优先级最高
```

**单条降级**（长期决策，不动条文）：

```json
{ "severity": { "J8-SPR-10": "medium" } }
```

写错 ID 或非法级别，`ds check` / `ds doctor` 都会报错点名。**降级 vs 豁免**：
降级是「这条在本仓就该是 medium」（长期、无到期日）；豁免是「历史代码这次不动」（必须写 `until`）。

**允许的键**（三层各有白名单，写错直接报错——拼错的键是「配了但没生效」的经典来源）：

| 层 | 允许的键 |
|---|---|
| `policy/default.json` / `profiles/<name>.json` | `version` / `blockOn` / `warnOn` / `severity`（profile 另可写 `stack`） |
| `<业务仓>/.stdkit/policy.json` | `version` / `blockOn` / `warnOn` / `severity`（**不允许 `stack`**：那是 profile 的结构性字段） |

- `version` 是策略文件格式版本，当前只支持 `1`（`ds check` 会断言）。
- **`warnOn` 只用于生成 prompt 里的一句话**（「这一级算 Warning」），不参与任何判定——它不是「把某级变成 warning」的开关。
- profile 的 `stack` 是**给人看的**：没有任何判定读它（ADR 0002 明确不做多栈，写成配置会误导）。
- 三层覆盖是**浅合并**：后者整体替换同名键，不做深合并。

契约的形状由 `policy/compat.json` + `cli/lib/compat.test.mjs` 守着（见 [ADR 0004](adr/0004-v1-freeze.md)）。

## 环境变量

| 变量 | 用途 |
|---|---|
| `DS_GIT` | `git` 不在 PATH 时指定可执行文件（`--diff` 用） |
| `STDKIT_HOME` | pi 扩展找不到 `cli/` 时指定 stdkit 路径 |
| `STDKIT_GUARD=off` | 关闭写前护栏 |
