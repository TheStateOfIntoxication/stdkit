# 已知限制

这份文件是**对外承诺**：下面写着抓不到的，就是真的抓不到。修好一条就从这里删一条。

## 1. 只有 49/127 条能自动判

127 条规则里 49 条有 `deny` 正则（能本机判），其余 78 条靠模型读条文判断。

**典型抓不到的形态**：

| 形态 | 为什么抓不到 | 归谁 |
|---|---|---|
| 跨行空 `catch`（`catch (Exception e) {` 换行 `}`） | 单行匹配看不到块结构 | 人工 / 模型 |
| `JSON.parse(payload.data)` / `JSON.parse(result.data)` | 只认 `res` / `response` / `resp` 这几种命名 | 人工 |
| 注释里的 `var x = 1` 示例代码 | `noString` 抹掉了字符串内容（修误报的代价） | 不算违规 |
| `@Select(` 分行拼接且 `${}` 在后续行 | 行级匹配拿不到跨行上下文 | 人工 |
| `(a+)+b` 这类交替回溯 | 性能守卫的探测串只能发现「逐位回溯字母类」 | Code review |
| `.yml` 块标量（`password: |` 换行值） | 只覆盖单行 `key: value` | 人工 |
| `V2-CMP-07` 这类跨行属性（`el-form-item` 与它的 `prop` 分行） | 父子结构要解析模板 | 人工 |
| 语义类：事务边界、幂等、越权 | 要看调用链与数据关系 | 模型 + 人 |
| `J8-MBT-07` 多方言 XML 同步 | 要判两份 XML 是否语义等价（ADR 0001 明确不做） | 模型 + 人 |

**看到「需人工确认」四个字，就是这条**。没报不等于没问题。

## 2. 单栈：JDK 8 + Vue 2

- Java 侧按 JDK 8 判：`var` / `record` / `sealed` / `List.of` / `isBlank()` 一律 critical。
- Vue 侧按 Vue 2.7 + Options API 判：`<script setup>`、`defineProps`、Pinia、TypeScript 都是违规。
- **JDK 17 / Vue 3 / TS 没有规则域**。强行接入会看到成片误报——这不是 bug，是设计上不支持
  （Vue 3 / TS 有 `vue-tsc` + ESLint + Prettier 覆盖，本仓的差异化价值在「老栈 + 团队约定 + 确定性层」）。

## 3. 护栏的覆盖范围

写前护栏（pi 扩展）只覆盖**判定**，覆盖不到**注册与事件路由**：

- `pi.registerTool` / `pi.on('tool_call')` 是否真的挂上，只能由 pi 宿主验证；
- `edit` 事件的行号是**块内偏移**，不等于文件真实行号，因此护栏提示里的行号只能当参考；
- 只拦 `critical` 级（`high` / `medium` 交给审查），只拦 `write` / `edit` 两个工具；
- 需要判定逻辑单测见 `cli/lib/guard.test.mjs`，dist 布局的冒烟见 `docs/install.md` 的排查表。

## 4. 不替代 review，也不承诺零误报

- 判定的是**形态**：`private double amount;` 能判，「这个事务边界对不对」判不了。
- 误报的处理方式是**加一个 `*-clean` 用例**，不是放宽整条规则；个案放宽会让规则失去意义。
- 已有三道机制压误报：`allow`（行级）、`exclude`（文件级）、baseline（存量、带到期日）。

## 5. 与同名 skill 包不兼容

skill 目录按名字寻址（`write-java` / `write-vue` / `write-sql`），两套同名的规范包同时装会互相覆盖。
`ds doctor` 会在常见 skill 槽位探测到同名外部包时给 WARN，但**无法自动禁用**——这是宿主的职责。

`ds install` 写入的路径都会记在 manifest 里，`--uninstall` 只删自己写过的条目，不动别人的。

## 6. 不提供 demo 业务仓

本仓**没有**可 clone 的示例项目（一个「装了 stdkit 的业务仓」样板）。原因不是懒：

- demo 一旦像真项目，就会被人照抄，包括里面故意写坏的部分（demo 要演示命中，必须含违规代码）；
- 两份仓会漂移：demo 里的 Spring 版本、目录约定过一阵就跟 `rules/` 讲的对不上，
  而漂移的 demo 比没有 demo 更误导；
- 维护 demo 的成本高于维护规则本身，收益只落在「第一次跑通」那五分钟。

**替代路径**（按推荐顺序）：

| 想做的事 | 怎么做 |
|---|---|
| 看命中长什么样 | `node cli/ds.mjs scan evals/cases/java-bad`——`evals/cases/` 就是反例库，每个用例都是真实形态的最小复现 |
| 看本仓会被报什么 | `ds init --dry-run` → `ds init` → `ds brief`。五分钟出的是**你自己仓**的真实清单，比 demo 有用 |
| 要一个空骨架 | `ds init --scaffold` 按 `J8-SPR-19` 建 `src/main/java/<根包>/{controller,service,...}`（只建空目录，不放文件） |
| 要能抄的规范文件 | `templates/AGENTS.md`（业务仓 L3 模板）与 `dist/AGENTS.md`（Agent 用的仓级约定） |

**别把 `evals/cases/` 当模板抄**：那里的文件是**故意写坏的**，用来证明规则会命中。
照抄会一次踩完全部违规。

**什么时候会补 demo**：出现 ≥2 次「文档看完仍不知道怎么接入」的反馈，就补一个最小 demo 仓
（门槛与 ADR 0003 的语义层回归一致：同类反馈两次才动结构，不靠猜）。

## 7. 其他

- **`ds scan` 不读业务仓 L3**：只读 `rules/` 与 `policy/`，不解析 `AGENTS.md`。
  想要「按仓豁免」请用 `policy.severity` 或 baseline。
- **`ds cross` 只读 `AGENTS.md` 的 `engines` 一格**（用来判「声明的方言是否都有脚本」），
  其余字段一概不看——它不是「读你的仓然后猜」，只有明确声明的那一格参与判定。
- **`publish-check` 依赖 git**：扫描集合来自 `git ls-files`，所以 `.gitignore` 生效。
- **`publish-check --history` 只看可达历史**（`git log --all`）：改写后被 gc 或已不可达的提交扫不到，
  所以它证明的是「当前 refs 覆盖的历史没有泄漏」，不是「远端对象库里没有」。后者只能靠平台 GC 或删仓重建。
  它也只看 diff 的**新增行**：某条内容在提交 A 加入、提交 B 删掉，仍会被算作命中（那正是要查的）。
  git 仓却调不到 git 时**直接报错**（不静默退回遍历——那会让扫描集合既变大又变小）；
  git 不在 `PATH` 就设 `DS_GIT`。`scan --diff` 同理。
- **`ds check` 在 dist 安装下是「跳过」而非「通过」**：它只对规则仓有意义；目录既不是规则仓
  也不是 dist 安装时 **exit 2**（走错目录要吵，不能伪装成已检查）。
- **只在有 `deny` 时才机判**：语义规则无论怎么写都不会被 `ds scan` 检查。
- **`ds eval` 不覆盖 `--diff` 模式**：用例都是全量扫描。`maxHits` 在 diff 下的语义（先计数、再按改动行过滤）
  由 `cli/lib/structure.test.mjs` 的单测守着（需要 git，CI 上必跑、无 git 的机器跳过）。
- **`eval --semantic` 的绿灯只代表「判定没变」**：它比对的是上一次审查的**记录**，不调模型。
  记录可以写错（人或 agent 审错），所以它是回归网，不是正确性证明；用例数也只有个位数，
  覆盖不了 79 条语义规则。
- **计数型规则只按单文件计**（`maxHits`）：跨文件的「同一接口被两处调用」判不了——那需要知道两个 URL
  是不是同一个接口，属语义层。
- **`ds cross` 只认标准布局**（`sql/upgrade/<dialect>/` + `rollback/`）：非标准布局直接跳过，
  不误报也不报——这类仓需要人工确认目录约定（`SQL-DIR-01` 属语义层）。
- **命中片段默认掩码**：`scan --json` 与 `publish-check` 会把 `password=xxx` 这类值替换成 `***`
  （命中行本身往往就是密钥，原样输出会二次泄漏到 CI 日志与模型上下文）；本地排障加 `--no-mask`。
