# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/)。版本以 `package.json` 为唯一源。

**版本策略**：`0.x` 期间结构可能变（`catalog` 字段、`policy` 键名、`--fail-on` 语义）；
升 `1.0.0` 的触发条件是这三处冻结、且连续两个版本无 breaking。

## [0.19.0] — 2026-11-17

### Added

- **`ds eval --semantic`**（ADR 0003 的 backlog 项）：语义层回归的「记录 + 比对」骨架。
  **不调模型**——CI 仍然不依赖模型与网络，它只做两件事：
  1. 校验 `evals/semantic/<case>/` 的结构：`mustReport` 必须是**没有 `deny` 的语义规则**
     （有 `deny` 就该进 `evals/cases`，这是最容易犯的错），fixture 不能为空；
  2. 比对上一次审查的 `result.json`：漏审 / 误报都算失败。
  没记录的用例显示「未记录」并给 `--record` 模板，**不算失败**（还没审过不等于错）。
- **`ds eval --record <case> --reported <ID,ID> --by <who>`**：把一次审查结果写进 `result.json`
  （带日期与记录者）。工具不判对错，只负责存与比。
- 两个种子用例：`tx-remote-call`（`@Transactional` 里调远程服务 → `J8-SPR-03`）、
  `idempotent-write`（支付回调无幂等键 → `J8-SPR-12`）；两条都是真实形态的最小复现，`why` 写明判据。

### Changed

- `docs/commands.md` 增「语义层」小节（用例结构、两条断言、`--record` 用法）；
  `limits.md` 写明它的绿灯只代表「判定没变」——记录可以写错，用例也只有个位数，覆盖不了 78 条。
- ADR 0003 补「后续」一节：备选项已按不引入模型依赖的形态落地，原决策不变。
- README 的语义层能力补上 `--semantic` 一句。

### 测试

- 51 → **53**：结构校验能拦「把可机判规则塞进语义用例」；未记录 = skipped 不算失败；
  记录漏审/误报都判失败；本仓两个种子用例结构合法且已记录。

## [0.18.0] — 2026-11-17

### Added

- **计数型规则 `maxHits`**：有些规范的判据是**次数**而不是形态（「同一页面 5 个以上原始请求必须抽到
  `api/`」）。规则写 `deny` + `maxHits: 4` = 「允许 4 处，第 5 处起报」，且只报越线那一处。
  `runScan` 与写前护栏 `scanText` 共用 `capByMaxHits`，不存在第二套判定。
  `ds check` 三条约束：必须在有 `deny` 时使用、必须是正整数、`// BAD` 命中数必须超过上限。
- **`V2-API-05` 从语义规则变成可机判**：`deny`（`request|http|api|axios` 的动词调用 + `this.$http.*`）
  + `maxHits: 4`。它因此自动从 prompt 的 B 类挪进「可机械判定」，`ds brief` 也算进 A 类。
- 新 fixture `evals/cases/vue-api-05`：5 处请求的页面报第 15 行；**恰好 4 处**的页面一处都不报
  （验证上限是「超过」而不是「达到」）。

### Changed

- 可机判规则 48 → **49**（README / limits / concepts / architecture 同步；ADR 属历史记录不动）。
- `docs/rule-format.md` 增 `maxHits` 元数据行与正则规则第 10 条；`static-analysis.md` 落点表补一行；
  `limits.md` 写明「计数型只按单文件计，跨文件同一接口归人工审查」。

### 测试

- 49 → **51**：`capByMaxHits` 语义（未超不报 / 超了只报越线一处 / 普通规则不受影响）与 `scanText` 同语义。

## [0.17.3] — 2026-11-17

四次审计（`08-四次审计-v0.17.2-剩余问题.md`）的 N40–N44。这轮的核心是**「历史泄漏」这种不可撤回的坑**：
上一轮改写历史发生在 push 之后，而「工作树干净」被当成了「已经没泄漏」。

### Added

- **`ds publish-check --history`**（N41）：连 git 历史一起扫，只看 diff 的**新增行**，`allowPaths` 按路径过滤。
  存在的理由：`force-push` 只改引用、不删对象，所以「这条泄漏是不是以前提交过」必须机器来答。
  实测：临时仓里提交一个内网 IP 再删掉 → 工作树检查 0 命中，`--history` 抓出
  `<commit>  bad.md`。CI 的 tag job 同步加上这一步。
- **`policy/publish.json` 的 `historyAllow`**：历史里的命中改不掉，所以「已知且接受」要**逐条枚举并带理由**
  （`{id, path, reason}`）。本仓现有 8 条（CHANGELOG 里的决策记录、规则示例里早年的假凭证等），
  不接受「它一直在那儿」这种理由。

### Changed

- **`docs/publish-checklist.md` §1.1「公开前置检查」**（N41）：`publish-check --history` 0 命中、
  `git log --all -- <曾泄漏的文件>` 无输出、`git cat-file -e <旧 SHA>:<文件>`、确认真实远端可见性；
  真出过凭证就**删仓重建**（最省事）或请平台 GC。
- **CHANGELOG 0.17.2 的措辞改了**（N41）：原文写「未 push 的仓可安全改写」，与事实不符——本仓当时已经
  push 过两次。改成「改写发生在 push 之后，远端对象库可能仍留有旧提交，需按清单确认」。

### Fixed

- **`doctor` 输出分组**（N38）：`-- 业务仓 --` 与 `-- stdkit 自身 --` 两段，`references` 这种看不出归属的
  条目不再混排；新增 `--json` 给 CI 用。
- **`scan --diff` 的 git 报错分两句**（N39）：`ENOENT` → 「没找到 git：装 Git 或设 `DS_GIT`」；
  其他 → 「git diff 失败（可用 DS_GIT 指定 git 路径）：…」。原来两种情况都提示「设 DS_GIT」，
  对「根本没装」的人无解。
- **README 去掉精确单测数**（N37）：改成「40+ 条单测（`node --test cli/lib/*.test.mjs`）」。
  这个数字没有机制保护（`check` 不跑测试），而 CHANGELOG 已经因此漂过一次（写 46，实际 47）。
  CHANGELOG 0.17.2 的 `46` 更正为 `47`。
- **`commands.md §check` 补 `ds check <目录>` 示例**（N39）：三分判定的三种结果各给一行命令。

### N40 的验证结论（远端历史）

| 查什么 | 结果 |
|---|---|
| 本地对象库是否还有旧提交 | **有**：`8b0fc45` / `a9889d3` / `35dcd0a` / `06cdaa0` 里均含 `.cm3.txt` 或 `ovl.mjs` |
| 当前 refs 覆盖的历史 | **干净**：`git log --all -- .cm3.txt ovl.mjs` 无输出 |
| 远端 head | **`395213d`（干净树）**，`git ls-remote origin refs/heads/main` 已确认 |
| 远端旧对象是否仍可达 | **CLI 判定不了**（GitHub 默认禁止按 SHA 取对象）；仓库 API 目前返回 404（私有或未公开） |

结论：**远端引用已是干净状态；远端对象库要不要处理，取决于这个仓是否曾经公开**。若从未公开，无需动作；
若已公开过，删仓重建最省事（`docs/publish-checklist.md` §1.1 有判定命令）。

### 回滚点

- 本地分支 `backup/pre-n31` → `ae3208a`：本轮改动之前的干净状态（**故意不指向含泄漏的旧提交**）。

> 本节出现的 SHA（`8b0fc45` / `a9889d3` / `395213d` / `ae3208a`）属于**重建前的旧私有仓**。
> 若在本仓 `git cat-file -e <sha>` 查不到，那是正常的：历史已按 `docs/publish-checklist.md` §1.2 重建，
> 现在的仓只有一个起点提交。旧仓保持在私有状态（或已删除）——它才是那些对象的唯一来源。

## [0.17.2] — 2026-11-17

三次审计（`07-三次审计-v0.17.1-剩余问题.md`）的 N31–N34。这轮的主题是**「自己的门禁抓不到自己的杂物」**：
仓根留着两个实现期产物（含本机绝对路径与另一套规范包的名字），而 `publish-check` 报「无命中」。

### Fixed

- **N31 发布前脱敏补三条 pattern**：`local-abs-path`（`<盘符>:/work/…` 这类本机路径）、
  `workspace-name`（内部工作区目录名）、`legacy-package-name`（另一套同名规范包的名字）。
  加完立刻抓到真实泄漏：`.idea/workspace.xml` 里既有本机路径也有工作区名（现已不被扫描，见下）、
  CHANGELOG 里 4 处点名那套包（已改成中性表述）。
- **N31 `publish-check` 不再静默降级**：原来是 `try { git ls-files } catch { 目录遍历 }`——
  本机 git 不在 `PATH` 时，它会去遍历 `.idea/`、`.vscode/` 这些本地产物（把每台机器的本机路径都算进来），
  同时又漏掉只有 git 才认的忽略规则。现在：git 仓调不到 git → **直接报错并提示设 `DS_GIT`**；
  只有真的非 git 目录才退回遍历，且遍历也跳过 `.idea` / `.vscode` / `.tmp` / `node_modules`。
  顺带 `resolveGit()` 多探 `ProgramFiles` / `ProgramFiles(x86)` / `LOCALAPPDATA` 下的 Git，减少踩这个坑的概率。
- **N31 仓根白名单进 checklist**：`publish-checklist.md` 增「仓根只放白名单文件」。

- **N32 `ds check` 增仓根白名单 warning**：根目录出现白名单外的文件/目录就点名（不阻断，避免误伤 lockfile），
  提示「临时脚本放 `.tmp/`（已忽略）或仓外」。`AGENTS.md` §提交 同步加一条。

- **N33 三分判定（`detectLayout`）**：`check` / `doctor` / `gate.sh` 共用同一份判定——
  `rules/` → 规则仓；`catalog/rules.json` + `cli/ds.mjs` → dist 安装（skip，exit 0）；
  两者都不是 → **exit 2**。原来只要没有 `rules/` 就 skip，于是「`rules/` 被误删」「sparse checkout 漏目录」
  「`STDKIT_HOME` 写错层级」都能绿着通过——等于让「没检查」伪装成「检查通过」。
  `gate.sh` 同步三分守卫，第三个分支直接 exit 2 并说明「既不是规则仓也不是 dist 安装」。
  `ds check` 现在也接受路径参数（`ds check <dir>`），否则「走错目录」这条根本测不出来。

- **顺手修一个验证时撞出来的真 bug**：`execFileSync` 默认把子进程 stderr **透传**到父进程，
  于是「扫一个非 git 目录」会往 stderr 打一行 `fatal: not a git repository`。平时只是噪音，
  但 `--json` 的调用方若把 stderr 一并读进缓冲区（我们的测试就是这么读的），机器可读输出会被污染。
  `scan` 与 `publish-check` 的 git 调用改为显式 `stdio: [ignore, pipe, pipe]`，并把 git 自己的话
  拼进报错（`git diff 失败：…（not a git repository）`），噪音变成信息。

- **N34** 未改代码：`docs/commands.md` / `docs/limits.md` / `README` 同步上述行为。

### 测试

- 单测 40 → **47**：`detectLayout` 三态、`check` unknown → exit 2、仓根白名单（只点名 `ovl.mjs`、
  不误伤 `README.md` / `cli/` / `.idea/`）、`gate.sh` 三分守卫、`publish-check` 在 git 仓缺 git 时报错、
  非 git 目录遍历跳过 `.idea`。

### 注

- 上一轮的两个产物（`.cm3.txt` / `ovl.mjs`）已从**本地全部可达历史**中移除。
  **注意：改写发生在已经 push 过之后**——`force-push` 只改引用、不删对象，远端对象库里可能仍留有
  含这两个文件的旧提交（`8b0fc45` / `a9889d3`），需要按 `docs/publish-checklist.md` §1 的
  「公开前置检查」逐条确认（删仓重建，或确认远端已 GC）。本句早先写的「未 push 的仓可安全改写」是错的。
  回滚点：`ae3208a`（本轮改动之前的干净状态，本地分支 `backup/pre-n31` 指向它）。

## [0.17.1] — 2026-11-17

### Added

- **`docs/limits.md` §6「不提供 demo 业务仓」**（上一轮审计 O2 的遗留项）：写明为什么不提供样板仓
  ——demo 要演示命中就必须含违规代码 → 会被照抄；两份仓必然漂移，漂移的 demo 比没有更误导；
  维护成本高于规则本身。给出四条替代路径：拿 `evals/cases/` 看命中长什么样、拿自己的仓跑
  `init` + `brief`、`init --scaffold` 建骨架、`templates/AGENTS.md` 当可抄的规范文件。
  同时点明「别把 `evals/cases/` 当模板抄」与补 demo 的触发线（同类反馈 ≥2 次，与 ADR 0003 同一风格）。
- README 的文档索引同步点出这条限制。

## [0.17.0] — 2026-11-17

二次审计（`06-二次审计-v0.16.1-剩余问题.md`）的 N21–N27。这轮的共同点是 **`dist/` 单独安装时的失败模式**：
能力都在，但装到客户端后跑 `check` / `doctor` 会喷几百条假错误，且经 `gate.sh` 会放大成「业务仓所有 PR 被拦」。

### Fixed（P1）

- **N21/N20 `dist/` 安装下的自检降级**：`check` 在无 `rules/` 的目录下**一行提示 + exit 0**
  （「本目录没有 rules/，是 dist/ 安装而不是规则仓」）。exit 0 是刻意的——`gate.sh` 带 `set -eu`，
  非 0 会让业务仓所有 PR 被拦，而真实原因跟业务仓无关。实测：`node dist/cli/ds.mjs check`
  由 **465 error → 0 error**。
  `doctor` 同理：`ROOT` 无 `rules/` 时跳过 catalog / dist / references 四项（原来会去找 `dist/dist`），
  明确标 `SKIP` 而不是 FAIL。
- **N22 `gate.sh` 的自检步加守卫**：`[ -d "$STDKIT/rules" ]` 成立才跑 `ds check`，否则打印
  「跳过规则仓自检（… 是 dist/ 安装）」。实测 `STDKIT_HOME=<dist>` 跑 gate 仍是完整的 scan + cross 门禁。

### Fixed（P2）

- **N23 `gate.sh` 参数解析**：原来把第一个位置参数无条件当 base-ref，于是 `--no-cross` 被当成了 git ref，
  `git diff` 直接失败且 `set -e` 中断。改为先剥选项再取第一个位置参数；未知选项 / 多个 ref 一律 exit 2；
  新增 `-h` / `--help`。冒烟覆盖五种组合：源码仓 + `--no-cross`、dist + 正常 ref、未知选项、两个 ref、
  无 `STDKIT_HOME`。
- **N24 逃生参数进手册**：`docs/commands.md` 补 `--no-mask`（scan）与 `--no-cross`（门禁），
  新增「门禁脚本」一节；`ds help` 补 `--no-mask`。`check` 新增断言：**`ds help` 里出现的每个
  `--flag` 都必须在 commands.md 里出现**（删掉 `--no-mask` 的说明 → error）。
- **N25 fixture BOM**：`evals/cases/cross/expect.json` 去掉 BOM（`readJSON` 会剥，但 jq / 其它语言会炸）。
  `check` 新增断言：仓内与 `dist/` 的 `*.json`、以及三份顶层 Markdown 不得以 BOM 开头。
- **N26 `policy/jdk8-api.json` 进文档**：`docs/rule-format.md` 增「JDK9+ 构造清单」小节
  （两处用途、`guard` / `rule` 语义、加一条要改哪两处、各自的报错文案）；`AGENTS.md` §改规则 加第 9 条指针。
  原来只改规则会被断言拦住，但读文档根本不知道有这文件。

### Changed

- **N27 CHANGELOG 口径收尾**：0.16.1 条目加「（取代 0.16.0 的 N7 表述）」；
  `publish-checklist.md` 补一条：对外授权口径只以 `docs/provenance.md` 为准，CHANGELOG 是变更记录不是授权声明。

### 验证

- `check` 0/0、`eval` 22/22、`test` 40/40、`doctor` 0 fail、`publish-check` 0、`cross` 0
- `node dist/cli/ds.mjs check` → 一行提示，exit 0；`node dist/cli/ds.mjs doctor` → 0 fail（含 SKIP）
- `gate.sh` 五种参数组合冒烟通过（未知选项与多 ref 均 exit 2）
- 注入验证：删 commands.md 的 `--no-mask` → error；给 fixture 塞 BOM → error

## [0.16.1] — 2026-11-17

### Changed

- **著作权人改为 GitHub 账号** `TheStateOfIntoxication`：`LICENSE` 的 `Copyright (c) 2026 <人>`、
  `package.json` 的 `author`、`docs/provenance.md` 的署名段落三处一致（与 `repository` 的 owner 相同，
  别人一眼能确认是同一个人）。`ds check` 新增断言：三处任一不一致直接 error。
- **删掉此前那节「迁入的规则」表述（取代 0.16.0 的 N7）**，`provenance.md` 改为单一声明——**本仓条文为原创**，
  不继承任何第三方包的授权。`ds check` 断言 `provenance.md` 不得出现 `迁入` / `迁移自` / `取自旧仓`
  （这类措辞会把整串授权追问引回来，而语句本身解决不了任何问题）。
  实测 6 条曾被标注「迁入」的规则（`J8-CMT-02` / `J8-ORG-01` / `J8-NAM-03` / `J8-STR-01` /
  `V2-CMP-06` / `V2-CMP-07`）与本仓前身仓的文本**零 8 字重合**，本来就是重写而非复制，声明与事实一致。
- 与《阿里巴巴 Java 开发手册》的关系收紧为「只做命名与结构对齐」：分类段与 `p3c:` 字段只用于对账，
  不复刻正文、不打包内容。

### Fixed

- 文档里的「旧仓」措辞全部改为中性表达（`README` 改「与同名 skill 包共存」、`limits.md` §5、
  `install.md` 排障表、`init` 的 WARN 文案、`dist/AGENTS` 的限制清单、`adr/0002` 的背景段），
  只保留「同名会互相覆盖」这个实际冲突，不暗示血缘关系。
- `docs/publish-checklist.md` 授权段补两条：著作权人三处一致、只声明原创（不写迁移）。

### 验证

- `check` 0/0（新增两条断言）、`eval` 22/22、`test` 38/38
- 注入验证：`package.json` 的 `author` 改成别人 → error；`provenance.md` 塞回「迁入」→ error

## [0.16.0] — 2026-11-17

执行后审计（`05-执行后审计-遗漏与补充项.md`）的 N1–N13 全部处理。这轮修的几乎都是同一件事：
**能力做出来了，但没接进交付路径**——`ds cross` 没有门禁在用、ADR 说「语义层少两条」但 prompt 没改、
README 已经按「已发布」写却还是 `private`。

### Fixed（P0）

- **N1 `ds cross` 接入交付路径**：`templates/ci/gate.sh` 增加仓级检查步（带 `--no-cross` 逃生开关）；
  `templates/AGENTS.md` 与 `dist/AGENTS.md` 的机械校验行改为「`scan --diff`（行级）+ `cross`（仓级）」；
  README / `docs/install.md` 同步。实测：缺回滚的业务仓跑 gate → exit 1 并报 `SQL-RBK-01`；`--no-cross` → exit 0。
- **N2 语义层清单与 ADR 对齐**：`cross.mjs` 导出 `CROSS_RULE_IDS`（单一事实源），
  `reviewPrompt` 与 `buildBrief` 都把它从 B 类排除，改输出独立段落（prompt 里是「仓级」清单 + `ds cross`，
  brief 里是「仓级：跑 `ds cross` 得到的才算数」）。`review-sql` 的 B 类从 13 条降到 11 条。
  `check` 增加双向断言：仓级规则必须全在 prompt 的仓级段、不得出现在 B 类、`CROSS_RULE_IDS` 必须存在且无 `deny`。
- **N3 命中片段掩码**：新增 `cli/lib/mask.mjs`，`scan` 的 `text` 与 `publish-check` 的 `snippet` 默认把
  `password=xxx` / `sk_live_xxx` 之类替换成 `***`（命中行往往就是密钥本身，原样输出会二次泄漏到
  CI 日志与模型上下文）；`--no-mask` 供本地排障。实测 `config-secret` 用例输出无明文。
- **N4 发布链打通**：摘掉 `package.json` 的 `private`；`npx ds` → `npx stdkit`（前者会装到 npm 上另一个包）；
  补 `description` / `repository` / `files`。实测 `npm pack` 102 文件，解包后在空目录跑 `cli/ds.mjs scan`
  能正确报出 `J8-API-04`。

### Fixed（P1）

- **N5 文档纠偏**：`static-analysis.md` 把 `SQL-DIA-01` 从「人 / 模型」改为 `ds cross`；`limits.md` 三处
  （「scan 不读 L3」改为「scan 不读；cross 只读 engines 一格」、多方言同步拆成 `SQL-DIA-01`（仓级）与
  `J8-MBT-07`（不做）、补 cross 布局边界与掩码行为）；`architecture.md` 重写为「四层判定」+ 仓级一节 +
  里程碑补到 M9；README 数字对齐。
- **N6 `publish-check` 扫描集合**：改用 `git ls-files`（含 `dist/`——那才是真正会发布的内容），
  非 git 仓退回遍历且不跳 `dist/`；`evals/` 显式进 `allowPaths`（fixture 故意像真凭证）；
  写坏的 `forbidden` 正则不再静默丢弃，直接报错。实测往 `dist/` 塞内网 IP → 命中。
- **N7 授权追溯**：`provenance.md` 增加「从另一套同名规范包迁入的规则」一节，列出 6 个 ID 与授权依据；
  `check` 断言这 6 个 ID 仍在文中（删了会报错）。
- **S6 数字机制化**：`check` 断言 README 的「规则数 / 可机判数 / 回归用例数 / 命令数」与
  catalog、`evals/cases`、`ds.mjs` 一致（注入错误数字 → 报错）；`architecture.md` 里提到的
  `ds <cmd>` 必须是有效子命令。

### Added / Changed

- **N8 `ds --version`**（`-v` / `version`）：`stdkit 0.16.0（127 条规则 / 48 可机判）`；版本只从
  `package.json` 读。
- **N9 JDK9+ 清单收敛**：新增 `policy/jdk8-api.json`（25 条，单一事实源），`check` 的示例守卫从它派生，
  并断言 `J8-MOD-01` 的 `deny` 与它逐条一致（漏改任一端 → 报错）。补上原先漏掉的 12 类
  （`List.copyOf`、`Map.entry`、`String#lines/#repeat`、`Files.mismatch`、`Optional#orElseThrow()` 无参、
  `Objects.requireNonNullElse(Get)`、`Collectors#toUnmodifiable*/teeing`、`instanceof` 模式匹配、
  lambda 形参 `var`）。
- **N10 eval 支持仓级断言**：`expect.json` 新增 `cross` 字段，新增 `evals/cases/cross`；
  eval 文案区分「行级 48/48」与「仓级 2 条由 ds cross 覆盖」。22 个用例。
- **N11 CI 矩阵**：`node 18 / 20 / 22` + 一条 `windows-latest`（跑 check、单测、`install --dry-run`、
  `install.ps1`）。
- **N13 仓卫生**：`.tmp/`（117 个一次性脚本）与 `.idea/` 已从工作区删除。
- `publish-checklist.md` 增补审计第 6 节的 8 条检查项。

### 验证

- `check` 0/0、`eval` 22/22（行级 48/48 + 仓级 2）、`test` 38/38、`doctor` 0 fail
- `publish-check` 0 命中（现已覆盖 `dist/`）；`cross` 自仓 0 命中；`scan` 自仓 0 命中
- 真实仓对照：掩码后终端不再出现明文口令；12 类新 JDK9+ 构造零误报；总计仍 27 命中 / 712 豁免
- 注入验证：README 数字写错 → error；`provenance` 删 ID → error；删命令手册条目 → error；
  gate 缺回滚仓 → exit 1；`dist/` 塞内网 IP → publish-check 命中

## [0.15.0] — 2026-11-17

开发计划 M4 的三份决策记录落地，并把 ADR 0001 里定下的两条仓级检查**实现出来**（计划原本只说「先写 ADR」，
这里把「价值最高、误报最低」的两条直接做了，其余仍不做）。

### Added

- **`docs/adr/`**（决策记录，只增不改）：
  - `0001` 跨文件确定性层：只做 `SQL-RBK-01` / `SQL-DIA-01`，`J8-MBT-07` / `V2-API-05` 不做
  - `0002` 不做 Vue 3 / TypeScript / JDK 17 规则域（含「为什么要新域而不是 profile」）
  - `0003` 语义层回归不进 CI（保留 `ds eval --semantic` 的 backlog 形态与触发条件）
- **`ds cross [路径] [--json]`** + `cli/lib/cross.mjs`：ADR 0001 的实现
  - `SQL-RBK-01`（high）：每个 `sql/upgrade/<dialect>/00N_x.sql` 必须有同名回滚
  - `SQL-DIA-01`（critical）：L3 `engines` 声明的每个方言目录都存在，且各目录脚本序号一致
  - **只认标准布局**：不是 `sql/upgrade/<dialect>/…` 的仓直接跳过，宁可不查也不误报
- `check` 新增断言：`docs/adr/` 存在、每份 ADR 有「状态 / 决策 / 后果」三节、README 索引指向它。

### 说明（与计划的差异）

计划里 E10 的结论是「先写 ADR 再说」。这次把 ADR 写完后又顺手实现了其中误报最低的两条：

- 这两条的判据是**文件名与目录**，不需要语义等价判断，`ds doctor` 里已有雏形；
- 放进独立命令 `ds cross` 而不是 `ds scan`：`scan` 按行给行号，跨文件检查给不出单一行号，
  混在一起会让 `--diff` / baseline 行级豁免失去意义；
- 复用既有规则 ID（`SQL-RBK-01` / `SQL-DIA-01`），**没有**引入第二套规则格式。

`J8-MBT-07`（多方言 XML 同步）与 `V2-API-05`（接口调用抽 `api/`）仍未做——前者要判「两个 XML 是否
语义等价」，后者要解析导入导出关系，误报风险明显高于收益，理由写在 ADR 0001。

### 验证

- `check` 0/0、`eval` 21/21（48/48）、`test` **38**/38、`doctor` 0 fail、`publish-check` 0 命中
- `ds cross` 实测：本仓 0 命中；`sql-batch`（缺回滚）报 `SQL-RBK-01`；`sql-rollback`（配齐）0 命中；
  造的多方言仓（postgres 缺 002）同时报 `SQL-RBK-01` + `SQL-DIA-01`
- 注入验证：删掉 ADR 的「后果」一节 → check 报 error

## [0.14.0] — 2026-11-17

开发计划 M3 收尾：E13（安装脚本）+ E15 的可用性验证。到这版为止，计划里 M1–M3 的采纳项全部落地。

### Added

- **`ds install`**：一条命令装到五个客户端（`--pi` / `--claude` / `--codex` / `--cursor` / `--copilot` / `--all`），
  支持 `--project`（cursor / copilot 落业务仓）、`--dry-run`（一个字节都不写）、`--uninstall`。
- **`install.sh` / `install.ps1`**：各自三行 shim，真正的逻辑在 `cli/lib/install.mjs`。
  两个 shim 随 `ds build` 打进 `dist/`。
- 安装记录 `~/.stdkit/install-manifest.json`：`--uninstall` 只删自己写过的文件，不碰用户自己的东西。
- `docs/commands.md` 补 `install` 一节；`docs/install.md` 改成「一条命令装完」，手抄 cp 作为备选保留。

### 说明（与计划的差异）

计划里 E13 写的是「shell + ps1 两套对等实现」，这里改成**一份 Node 实现 + 两个薄 shim**：

- 五端的目标目录、探测、卸载必须一模一样，两套实现必然漂移（而漂移正是这个项目在治的病）；
- 单实现能进单测：`planInstall` 的落位、`--dry-run` 不落盘、未知目标报错都有断言。

### 验证

- `check` 0/0、`eval` 21/21（48/48）、`test` **37**/37、`doctor` 0 fail、`publish-check` 0 命中
- `ds install --all --dry-run` 规划 37 个文件（claude 16 / codex 19 / cursor 1 / copilot 1）+ pi 一条命令
- `dist/install.sh`、`dist/install.ps1` 随 build 生成

### 版本

仍在 `0.x`：`policy` 与 `catalog` 这轮才稳定下来（`severity` 覆盖是 0.11.0 加的），
按 CHANGELOG 顶部写的触发条件，至少还要两个版本无 breaking 才考虑 `1.0.0`。

## [0.13.0] — 2026-11-17

开发计划 M3「分发与开源就绪」落地（E17/E14/E12/E16/E18）。这批的目标是让这个仓**可以被公开**：
把「发布前别忘的事」从文档清单变成可执行检查，并把对外承诺写清楚。

### Added

- **`LICENSE`（MIT）** + `package.json` 补 `license` / `description` / `repository` / `files`；
  `ds build` 会把 `LICENSE` 复制进 `dist/`，dist 的 `package.json` 与两个 plugin.json 的
  `license` 字段跟随根 `package.json`（不再硬编码 `UNLICENSED`）。
- **`ds publish-check [路径...]`** + `cli/lib/publish.mjs` + `policy/publish.json`：
  按规则表扫待公开的仓（内网 IP、`sk_live_`、AWS key、私钥头、内部仓名、内部账号/域名），
  命中 exit 1；确认可公开的加 `allowPaths`。支持多根（连旧仓一起查）。
  首次运行就抓出 9 处：`CHANGELOG` 里 5 处内部仓名 + 规则示例里的 2 个「像真凭证」的假密钥/内网 IP。
- **`docs/provenance.md`**（规则来源与原创性）、**`docs/publish-checklist.md`**（发布前人工清单）。
- 文档重构：README 从 420 行瘦到 100 行（首屏 + 五条能力 + 三条命令 + 三个限制 + 两仓关系），
  拆出 **`docs/install.md`**、**`docs/commands.md`**、**`docs/concepts.md`**、**`docs/limits.md`**。
  `dist/README.md` 也带上「已知限制」一节（装完 dist 的人看不到源码仓的 docs/）。
- `ds doctor` 新增**同名外部 skill 探测**：在常见 skill 槽位发现同名外部包的痕迹
  （「文件 §章节」式回指 / `00-vue3.md` 引用）时给 WARN。
- CI：单测改为跑全部 `cli/lib/*.test.mjs`（原先只跑 `selftest`，guard/structure 没进 CI）；
  新增 tag 触发的 `publish-check` job。

### Changed

- `check` 新增断言：`LICENSE` 与 `package.json.license` 一致、`docs/provenance.md` 存在、
  `docs/commands.md` 覆盖 `ds` 的每个子命令、`docs/limits.md` 里提到的规则 ID 必须存在、
  `dist/*.test.mjs` 不随包发布。
- `.gitattributes`：`dist/** linguist-generated=true -diff`（评审只看 `rules/` 与 `cli/`）。
- 规则示例里的假凭证换成不敏感的形态（`192.0.2.10` 文档保留地址、无前缀的假 token），
  避免「示例看起来像真密钥」。

### 说明

- 计划里 E16 的版本策略：**仍在 0.x**。`1.0.0` 的触发条件是「`catalog` 结构、`policy` 键名、
  `--fail-on` 语义」三处冻结，这三处这轮刚改过（新增 `severity` 覆盖），现在跳 1.0 会立刻打脸。
- `LICENSE` 的著作权人写的是 `stdkit contributors`；若要署个人或公司名，改这一行即可。

### 验证

- `check` 0/0、`eval` 21/21（48/48）、`test` 36/36、`doctor` 0 fail、`publish-check` **0 命中**
- 注入验证：删命令手册里的两个命令名 → check 报 2 error；`limits.md` 写不存在的规则 ID → 报 error；
  在 `~/.agents/skills` 放假 skill → doctor WARN
- `npm pack --dry-run` 98 文件、158KB；`dist/cli/ds.mjs` 在空目录（不设 `STDKIT_HOME`）可跑

## [0.12.0] — 2026-11-17

开发计划 M2「内容」落地（E4/E5/E6/E7）。目标是把同名规范包里有、stdkit 里缺的
手艺类条文补上，同时**不让存量仓 CI 变红**。

### Added（规则 120 → 127）

Java 手艺（E4）：

- `J8-CMT-02` TODO 必须有工单号，公共方法补 Javadoc。`deny: (?<![\w#])TODO(?!.{0,3}\d)`，**必须 `raw: true`**
  ——`TODO` 几乎总在注释里，不关剥离就永远匹配不到（写规则时踩到的坑，已写进正文）。
  `@author` / `@date` 个人署名头**不做** deny：那是团队约定，写进通用规则会让一半人莫名违规。
- `J8-ORG-01` 一个文件一个 public 类型、成员顺序固定（`should/low`，无 deny：要数类与缩进）。
- `J8-NAM-03` 参数超 3 个用参数对象、嵌套超 3 层早返回（`should/medium`，无 deny）。
- `J8-STR-01` Stream 用于转换不用于副作用，`deny: \.stream\(\)\s*\.forEach\(`（`should/medium`）。
- `J8-SPR-19` 包结构默认树 + 依赖方向（`must/medium`，无 deny，内嵌默认树，`see: J8-SPR-01`）。

Vue Element（E5）：

- `V2-CMP-06` `el-table` 必须给高度、列给 `min-width` + `align`（`must/low`，无 deny：跨行属性）。
- `V2-CMP-07` `el-form` 走 `:model` + `:rules`，`el-form-item` 必须 `prop`（`must/medium`，无 deny）。
- `V2-BASE-02` 补 deny：`lang="less|stylus"`、`from 'tailwindcss'`、`@tailwind` ——
  原文只写了「禁 Less/Stylus/Tailwind」，没有机制；这次按「一件事只写一处」合并进原规则，
  **没有**新建 `V2-STY-04`。

脚手架（E6）：

- `ds init --scaffold`：按 `J8-SPR-19` 的默认树建 `src/main/java/<根包>/{controller,service,...}`，
  只建空目录、不放文件，幂等；`--dry-run` 打印将创建的目录。
- `templates/AGENTS.md` 新增「Element UI 本项目约定」小节：表格默认高度、`page-sizes`、
  图标集、路由模式等**产品特定值**下沉到 L3，不进通用规则。

SQL（E7）：

- `SQL-RDM-01` 补「交付登记表最小字段集」（version / script / dialect / risk_level /
  irreversible / applied_at / applied_by / rollback_script / rollback_at），表名由业务仓 L3 声明。

### 验证（重点：不误伤存量仓）

- 一个真实 Spring 仓（388 个 java + 522 文件）：新增两条 deny **只多出 1 条命中**
  （`// TODO Auto-generated catch block`，medium，不阻断）；critical 仍是 27、豁免仍 712。
- 先量后写：`@author` 在该仓有 61 处 → 决定不做 deny；`.stream().forEach(` 0 处 → 安全上线。
- `check` 0/0、`eval` 21/21（48/48 覆盖）、`test` 34/34、`doctor` 0 fail、自仓 `scan` 零命中
- 护栏 dist 冒烟：按 dist 布局（`extensions/` + `cli/` + `catalog/`）加载，critical 拦截 ✓、
  合规放行 ✓、`dist/` 内跳过 ✓

### 说明（与计划的差异）

- 计划里的 `V2-EVT-03`（禁 `v-slot` 用 `slot-scope`）**没有做**：Vue 2.7 推荐 `v-slot`，
  把它写成通用规则会让别的仓被迫违规——这正是计划 §7「不把产品特定值写进通用规则」自己的原则。
- 计划里的 `V2-STY-04` 合并进 `V2-BASE-02`，不新建重复条文。

## [0.11.0] — 2026-11-17

开发计划 M1「可靠性」落地（E1/E2/E3/E11/E20 + T4/T5）。这批改动只做一件事：
**把「声明 vs 实现」的漂移变成机器能抓的错误**。

### Added

- **`cli/lib/guard.mjs`**：把写前护栏的判定从 `extensions/stdkit.ts` 抽成纯函数
  （`relPathOf` / `isSkippedPath` / `pickGuardTarget` / `criticalViolations` /
  `loadBaselineFile` / `formatBlockReason`），扩展只剩 pi 胶水。
  此前护栏是唯一「会阻止人落盘」却没有测试的部件。
- **`cli/lib/guard.test.mjs`**（7 例）：write/edit 两类事件、edit 块内偏移、
  `isSkippedPath` 与 `listFiles` 对齐（业务包名 `log` 不跳、业务仓 `evals/` 照看）、
  baseline 在护栏路径生效、`formatBlockReason` 内容、扩展是薄壳的结构断言。单测 26 → 33。
- **`policy.severity` 单条判级覆盖**：`{"severity":{"J8-SPR-10":"medium"}}` 只改生效级，
  不动条文。接入 `scan` / `brief` / `rules` / `eval` 四条路径，共用 `effectiveSeverity`。
  `ds rules` 显示 `high → medium` 并统计覆盖条数。
- **`check` 新增三类断言**：
  ① prompt ↔ catalog：每个 review prompt 的 A 类 = 该域有 deny 的规则、A∪B = 该域全部规则、
  无重复、括号里的级别与 catalog 一致；SKILL 索引同样逐 ID 对齐。
  ② 域注册三向一致：`DOMAINS` ↔ `SKILLS` ↔ `rules/<domain>/`。
  ③ `policy/*.json` 的覆盖键：ID 必须存在且 active，取值必须合法。
- **`doctor` 校验业务仓 `.stdkit/policy.json`**：写错 ID/级别给 FAIL。
- **`evals/cases/policy-severity`**：断言「降级后不再阻断」（新增 `blocked` 与逐条
  `severity` 断言能力），eval 18 → 19。
- `check` 新增**嵌套量词静态告警**：`(x+)+` 这类结构性回溯运行期守卫是盲的，现在直接 warning。

### Fixed

- **`scanText` 忽略 baseline 豁免**（护栏路径的真 bug）：它把 `matchLine` 返回的命中
  无条件计入，导致「业务仓已豁免的代码，写的时候仍被拦」。现在与 `runScan` 同语义
  （豁免且未过期的不计，过期的重新计入）。这个 bug 是写护栏单测时暴露的。
- 删除死代码 `severityAtOrAbove`（导出但无人使用）。

### Docs

- README / `AGENTS.md`：加域从「3 处」纠正为实际 **5 处**（并说明漏哪处会怎样）。
- README 新增「降级 vs 豁免」对照表：`policy.severity` 是长期判级决策（无到期日），
  `.stdkit/baseline.json` 是临时欠账（必须写 `until`）。

### 说明（与计划的差异）

计划里的 `policy.disable`（临时关规则）**没有实现**：关规则会让「这条为什么没报」变成
需要考古的问题，而业务仓在这件事上已有两个更好的工具——`severity` 降级（长期）和
baseline 豁免（短期，带到期日）。保留在文档里作为"最后手段"的说明即可。

### 验证

- `check` 0/0、`eval` 19/19（46/46 覆盖）、`test` 33/33、`doctor` 0 fail、自仓 `scan` 零命中
- 注入缺陷验证：「prompt 漏 4 条语义规则」→ check 报 9 条 error 并逐条点名；
  「加假域 ghost」→ check 报 error；「嵌套量词 `(\w+)+x`」→ warning 且不阻断
- 真实仓对照：真实仓仍 27 命中 / 712 豁免

## [0.10.0] — 2026-11-17

第十一轮报告 R-3 处理，顺便把 `.vue` 剥离器的**语义定死**（已改坏三次）。

### Fixed

- **R-3**（P3）注释正文里提到闭合标签（`</template>` / `</script>`）会「提前收手」，
  同一注释块里剩下的文本被当代码扫 → high 误报。

### Changed（结构性）

- `.vue` 剥离器改为**整文件两遗**：先按正常语义跑一遍；**只有**“跑完仍在注释里”
  （即文件存在未闭合注释）才用 repair 模式重跑，允许注释在**行首**块结束标签处收手。
  这样「正常文件永不受启发式影响」不再是一个需要“小心不要碰坏”的约束，
  而是结构上保证的性质
- 块标签识别重写：单条 `/<(\/?)(template|script|style)\b/gi` 同时认开/闭标签，
  且 `script` / `style` 体内只认自己这个块的闭标签（JS 字符串里的 `<template>` 不再切块）；
  旧代码里 `closing` 分支实际是死代码（正则根本匹配不到 `</template>`）
- 新增 `stripLines(file, lines)`：`runScan` / `scanText` 改为按文件剥离；
  `makeStripper(file)` 保留流式语义（非 `.vue` 行为不变）

### Added

- 单测新增**注释剥离边界矩阵**（14 个 `.vue` 场景 + 3 个 XML 场景）：
  跨行/行内注释、未闭合、正文提标签、引号内 `<!--`、CDATA、
  `<template #header>` 嵌套、`<script>` 在前/在后/单块、style `url(http://)` 等
- `evals/cases/vue2-clean` 新增 `CommentNotes.vue`：注释里刻意写 `</template>`、
  `document.getElementById(...)`、`data: { }`，验证不被扫到（旧版本会报 2 条 high）
- 单测 24 → 25（矩阵与两条旧用例合并），其中矩阵用现象锁定而非实现锁定

### 验证

- 19 个边界场景逐条对账（包括反向 10 个「不应报」场景）
- 真实仓对照：真实仓仍 27 命中 / 712 豁免，逐条一致
- 200KB 单行 Java 耗时不变（扫描路径未动）

## [0.9.9] — 2026-11-17

第十轮确认报告的 1 条 P3 + 1 条设计备注处理。

### Fixed

- **R-1**（P3）`<template>` 里注释忘闭合时，后续 `</template>` 与 `<script>` 会被一起吞掉，
  文件后半段静默不扫。现在已剥离器在注释状态里盯**当前块的结束标签**
  （`</template>` / `</script>` / `</style>`），碰到就重置注释状态、接着处理。
  只认闭合标签：注释正文里写到 `<script setup>` 很常见，不能让它提前结束
- **R-2**（设计备注）同一个有状态剥离器被多条规则重复调用，`.vue` 切块时
  同一行的 probe 结果会取决于规则顺序。`matchLine` 新增可选参数 `stripped`，
  `runScan` / `scanText` 改为**每行剥一次**再交给全部规则（仍兼容外部调用）

### Added

- 单测 22 → 24：未闭合注释遇 `</template>` 收手；`matchLine` 传了 `stripped`
  就不再调剥离器

### 验证

- 反向验证：注释正文提到 `<script setup>` 不会提前结束（`-->` 先到）、
  正常闭合的注释仍不报、`<script>` 行照旧只走 C 系
- 真实仓对照：真实仓仍为 27 命中 / 712 豁免，与上版逐条一致

## [0.9.8] — 2026-11-17

第九轮全量审查的 1 条 P2 + 4 条 P3 处理。

### Fixed

- **N-1**（P2）HTML 注释状态机在非注释语境泄漏：字符串 / 模板属性 / CDATA 里出现裸 `<!--`
  时，**文件剩余部分被整段当注释剥掉**，后半段对全部规则静默失效
  （写前护欄同路径）。两种修法都做了：
  1. `stripHtmlComments` 加引号跳过与 CDATA 状态（CDATA 内容仍参与匹配，只是不当注释）；
  2. `.vue` 改为**按块剥离**：只在 `<template>`（及块外）认 HTML 注释，`<script>` 走 C 系、
     `<style>` 走 CSS（不套 `//`，`url(http://x)` 不会被误切）；
     同一行里注释里的 `<script setup>` 也不会被当成真块标签；
     属性值里的 `<!--` 同理不算注释
- **N-2**（P3）`skipByPath`（git 模式）用目录自身找 `pom.xml`，`target/` 永远判不中，
  与 walk 模式（看父目录）不一致。改成两边都看父目录
- **N-3**（P3）`.ini` 分支原本是死代码（无规则 applies 到 `.ini`）：
  `J8-SPR-15` 的 applies 补 `**/*.ini`，部署配置里的明文口令也能拦
- **N-4**（P3）`.tmp` 回到全层级跳过名单
- **N-5**（P3）性能守卫的提示文案注明探测串为「全 x 长行」，并说明它对
  其他字符上的回溯（如 `(a+)+b`）是盲的

### Added

- `evals/cases/comment-leak`：三种泄漏形态（script 字符串 / 模板属性 / XML CDATA）
  各一条断言，同时验证 CDATA 内的 SQL 仍被扫到；eval 17 → 18 用例
- 单测 19 → 22：`.vue` 按块剥离、`skipByPath` 父目录判定、`.ini` 口令拦截

## [0.9.7] — 2026-11-17

第八轮全量审查的 16 条（3 P1 / 7 P2 / 6 P3）全部处理。

### 性能与扫描正确性（P1）

- **P1-1** `J8-SPR-10` 的 `\w+Mapper\.selectAll\(\)` 在超长单行上 O(n²) 回溯：
  20 万字符单行 30 秒，且写前护欄走同一路径。量词加上界后同一输入 **127ms**；
  `check` 新增性能守卫：单条正则跑 2 万字符 > 100ms 给 warning
- **P1-2** `SKIP_DIRS` 按目录名无条件跳过，误伤 `com.x.log` / `com.x.tmp` / `com.x.build` 这类包名
  （该包下所有规则静默失效，且与护栏不一致）。拆成：全层级跳过（版本库/依赖/虚拟环境）
  与**仅项目根**跳过的构建目录（同级有 pom.xml / package.json 才算）
- **P1-3** 多行 HTML 注释不剥离：`<!--` 与 `-->` 分处两行时，注释掉的旧 SQL / 旧模板
  照常参与匹配（XML 注释一段 `${}` 直接一条 critical）。`stripHtmlComments` 改成有状态

### 机制（P2）

- **P2-1** `check` 新增校验：`status` 必须 `active|retired`、`raw`/`noString` 只能写 `true`、
  `see` 不能引用自己。以前 `status: retird` / `raw: yes` 会被静默当默认值
- **P2-2** `eval` 新增**覆盖率断言**：每条可机判规则至少被一个用例命中，否则 exit 1 并点名。
  这是「规则写错了也能全绿」的唯一防线（死 glob 靠它拓）
- **P2-3** `init` / `doctor` 新增技术栈覆盖告警：探测到 Java > 8 或 Vue 主版本 ≠ 2 时说明
  「当前规则集按 JDK8 + Vue2 写」，不然 JDK17 仓的 `record` 被判 critical 而 doctor 全 PASS
- **P2-4** `--severity` 拼错不再静默：`--severity hight` 直接报错；同时 `--severity HIGH` /
  `--level MUST` / `--domain VUE` 大小写宽容（P3-5 一并修）
- **P2-5** `brief` 的域推断补上 `.properties` / `.ini` / `pom.xml`：只改 `application.properties`
  的 PR 不再被当成四个域全开（语义清单 74 条 → 实际域）
- **P2-6** 路径错误不再抛原始 Node 错误：不存在 → `路径不存在：xxx`；
  传单个文件现在直接扫那个文件（之前 relPath 为空，扫了 0 个）
- **P2-7** 不读 `.gitignore`：git 仓改用 `git ls-files --cached --others --exclude-standard`
  取文件列表，`.gitignore` 自动生效；非 git 目录退回目录遍历

### 其他（P3）

- **P3-1** glob 改为大小写不敏感：`A.VUE` 也算 Vue 文件
- **P3-2** `docs/rule-format.md` 元数据表补 `status` 行，`deny` 行补「量词要有上界」
- **P3-3** README 的上手示例输出改成真实格式（命中那一行的代码，不是规则标题）
- **P3-4** `check` 在 `CHANGELOG.md` 缺失时给 warning，不再抛 `ENOENT` 栈
- **P3-6** `J8-API-05` 补上全限定名写法 `new java.math.BigDecimal(0.1)`

### 测试

- 单测 14 → **19 条**：跨行 HTML 注释、包名 log/tmp/build 不误跳、glob 大小写、单文件扫描、
  eval 覆盖率自检

## [0.9.6] — 2026-11-17

第七轮复核的 2 条（均为「代理特征」边界）处理。

### Fixed

- **S-1**（中低）`J8-MBT-01` 的第三道 deny 误伤普通字符串：
  `throw new IllegalStateException("UPDATE failed for ${id}")`、`return "DELETE FROM cache, ${n}"`
  这类文案同时含 SQL 词与 `${`，被当成注解 SQL 拦截（high → Block）。
  把该分支锁到**行首引号**：`(?i)^\s*"\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^\n]*\$\{`
  （换行形态的第二行本来就以引号开头）
- **S-2**（低）`doctor` 的 `engines` 假 WARN：L3 写 `mysql / kingbase`、探测出
  `mysql,kingbase`，分隔符不同就被判不一致。`matchesDeclared()` 改造：
  多值字段拆成集合只要求探测值 ⊆ 声明值（`,` `，` `/` `、` 空白都认，括号里的说明先去掉）；
  单值字段仍走主版本号 / 字符串包含。L3 模板的 engines 行同步改成逗号写法

### Fixed（顺带发现）

- `detectEngines()` 探不到「仓根就是 `sql/` 或 `mapper/`」的项目：它的三个模式都带前导 `/`，
  而 `path.relative` 在仓根布局下给不出前导分隔符（多模块仓因为路径中间有 `/mapper/mysql/`
  才幸存）。给相对路径补前导 `/` 后正常

### Added

- `java-mapper-anno` 用例新增 `Msg.java`：四种「文案含 SQL 词 + `${`」的写法，应为零命中
- 单测：`matchesDeclared` 扩到 10 组（含斜杠/逗号/顺序/子集），新增 `detectEngines` 5 组

## [0.9.5] — 2026-11-17

第六轮复核的 1 条中等 + 3 条文档偏差全部处理。

### Fixed

- **R-1**（中）`J8-MBT-01` 的注解写法旁路：`@Insert(value = "… ${a}")`、
  `@Select({"… ${status}"})`、`@Select(` 换行再接字面量三种写法全部绕过。
  改按**危险特征**而非语法形态匹配，拆成三道 deny：
  ① 注解调用里出现 `${}`（同行）；② SQL 关键词行里出现 `${}`（接住换行形态）；
  ③ 注解后跟字面量（原形态，仍用 `allow` 放过安全写法）。
  正文与 BAD 样例同步补上四种写法
- **R-2** `doctor` 实际不比对 `Spring Boot`（README 写了会）。补进比对列表，
  并新增 `matchesDeclared()`：版本号只比主版本，L3 写 `2.x`、实际 `2.3.1.RELEASE` 算一致
- **R-3** README 的分类表列了不存在的 `J8-ENG`、漏了 `J8-CMT`。
  改成从 catalog 实际分类生成的四域对照表（带条数），并指向 `ds rules` 查全量
- **R-4** README 说 `init` 的模板留了 `TODO` 标记（实际没有，`check` 也拒收 `TODO`）。
  改为真实行为：留空单元格，`init` 结束列出「待人工填（N）：…」

### Added

- `java-mapper-anno` 用例补上四种注解写法（`#{}` 放行的数组/换行形态，
  `${}` 的 `value=` / 数组 / 换行形态），5 条断言
- 单测新增 `matchesDeclared`（`2.x` vs `2.3.1.RELEASE` 等 6 组）

## [0.9.4] — 2026-11-17

第五轮复核的 4 条全部处理，外加 README 重写。

### Fixed

- **M-1**（中高）`SQL-RSK-02` 与 `SQL-RBK-01` 互斥：`SQL-RBK-01` 强制每个正向脚本配回滚，
  而新建表的回滚只能是 `DROP TABLE`，被 `SQL-RSK-02` 按 high 拦——「写了就必被拦」。
  加 `exclude: sql/**/rollback/**`，回滚的破坏性改由 `SQL-RSK-01`（分级）与
  `SQL-RBK-01`（不可逆写备份/恢复方案）两条语义规则管；两条正文都补了说明
- **M-2**（中高）`J8-MBT-01` 承诺「由 L3 声明豁免」，但 `ds scan` 从不读业务仓 `AGENTS.md`，
  通道不存在。改为可执行机制：`allow` 放过单行、参数化（`#{}`）、无拼接的注解 CRUD；
  带 `${}` 或 `+` 拼接的照旧报（含多行拼接）。正文删掉「由 L3 声明」
- **M-3**（低）`V2-API-01` 补上 `window.fetch(...)` / `self.fetch(...)` 的覆盖，
  `this.fetch(` / `obj.fetch(` / 方法声明 `fetch(page) {` 仍然不报
- **M-4**（低）`EXCEPTION_WORDING` 补 `豁免` / `由 L3 声明` / `可省略` 等措辞，
  并将这些措辞写进 `docs/rule-format.md` 的推荐写法（写不出机制就明写「归人工审查」）

### Added

- `evals/cases/sql-rollback`：建表 + 同名回滚，两个文件都应零命中
- `evals/cases/java-mapper-anno`：安全注解放行，`${}` 与多行拼接照报
  → eval 15 → 17 用例，46 条可机判规则仍全覆盖

### Changed

- **`README.md` 重写**：从条目式改成带背景、上手路径、命令手册、常见问题、
  维护约定的叙述体，补上每命令的实际用途与坑

## [0.9.3] — 2026-11-17

第四轮复核的 3 条全部处理。根因同一类：**条文写了文件级例外，却没落成 `exclude`**。

### Fixed

- **N-1**（high）`V2-API-01` 把统一封装文件自己 `import axios` 判成违规。
  加 `exclude: **/utils/{fetch,request,http,axios}.js, **/api/{request,http}.js`
  （glob 不支持 `{}`，写成了 6 条独立 glob）
- **N-2**（high）`V2-API-04` 把拦截器里的 `JSON.parse(response.data)` 判成二次解析。
  与 N-1 共用同一份 `exclude`
- **N-3**（high）`V2-API-01` 的 `fetch\(` 命中同名方法（`fetch(page) {`）与自建封装。
  deny 收窄为 `fetch\(\s*['\"\x60]`（带字面量实参的调用）；变实参的 `fetch(url)` 不报，已在正文写明

### Added

- `evals/cases/vue-api-clean`：封装层正例（`utils/fetch.js` + `api/request.js` 导出 `fetch`
  + 组件内 `fetch(page)` 同名方法），锁住 N-1/N-2/N-3 三个误报形态；eval 14 → 15
- `check` 新增**例外措辞弱校验**（warning）：正文含「除 … 外」「只/唯一允许」
  「不在管辖范围」而规则既无 `exclude` 也无 `allow` 时提醒。
  `EXCEPTION_WORDING` 已导出并有单测（不误伤「Service 内部」「组件内部」这类措辞）

### Changed

- `docs/rule-format.md`：元数据 `exclude` 行与自检第 9 条写明
  「条文里的文件级例外必须落成 `exclude`」

## [0.9.2] — 2026-11-17

第三轮复核的 7 条遗留全部处理。

### Fixed

- **R-1**（中）拆分「`@Transactional` 位置」的双重承诺：`J8-SPR-02` 改名为
  「Controller 层禁止 @Transactional」（只机判它真能判的），新增 `J8-SPR-18`
  （B 类，无 deny）接住 `@Component` / `@Repository` / 工具类 / 定时任务——
  这些位置原来的空档是「既不被 `scan` 抓，也不在 `brief` 语义清单里」
- **R-2**（中）`V2-RTR-01` 的 `allow` 支持模板字符串：
  `window.location.href = `/login`` 不再误报（原来只认 `'` / `"`，而 Vue 项目
  拼 `` `/login?redirect=${path}` `` 很常见，high 级误报直接 Block）
- **R-3** `J8-LOG-01` 加 `exclude: **/src/test/**`：测试里的 `System.out` 归 `UT-J8-02`，
  不再同一行双报；`test-batch` 期望同步去掉
- **R-4** `docs/rule-format.md` 补 `noString` 元数据与使用场景（词法关键字类规则）
- **R-5** 扩展改为**动态加载** `cli/lib/scan.mjs`：`cli/` 缺失时只关护欄并 warning，
  不再在模块加载阶段抛 `ERR_MODULE_NOT_FOUND`（`ds_check` 子进程路径仍可用）；
  三种布局（全量 / 有 catalog 无 cli / 都没有）实测通过
- **R-6** `scan` 的「N 条可判规则」随 `--severity` 收敛，并同时给出全量数（`totalRules`）
- **R-7** 新增 `cli/lib/structure.test.mjs`（4 条）：`build` 产物与 `rules/` 双向一致、
  `dist` 同步、CLI 参数校验与 `init --dry-run` 不落盘；
  `npm test` 改为跑全部 `*.test.mjs`（7 → 11 条）。
  `ds scan` 在 stdkit 根目录不再恒红：只跳过**带 `cases/` 的 `evals/`**，
  业务仓同名目录照常扫

### Added

- 规则 119 → 120（`J8-SPR-18`）
- `check` 的 glob 校验接受目录形态（`**/src/test/**`），不再要求必须带扩展名

## [0.9.1] — 2026-11-17

审查口径落地 + 回归覆盖面补齐。

### Changed

- **审查只给建议，不落地**：生成的 `review-*` prompt 新增「产出形式：只给修改指令」一节——
  每条带 `文件:行` + 具体改法 + 规则 ID；只有用户当轮明确说「改」才转入 `write-*` 流程。
  `dist/AGENTS.md`、根 `AGENTS.md`、`README.md` 同步这条约定
- `J8-SPR-02` 的 `applies` 收窄到 Controller（Mapper 侧由 `J8-MBT-13` 管），
  避免同一行 `@Transactional` 被两条规则重复报
- `V2-API-04` 正文补「只覆盖 res/response/resp 常见命名，其他需人工确认」，
  避免审查时把未覆盖当成已覆盖

### Added

- eval 新增 3 个批量用例（`java-batch` 13 条 / `sql-batch` 2 条 / `test-batch` 5 条 /
  `vue-batch` 5 条），把剩余 24 条无断言的可机判规则全部锁住：
  **46 条可机判规则 → 46 条有显式断言**（原 22 条）

## [0.9.0] — 2026-11-16

按第二份审查清单逐条修：1 条口径不一致 + 3 条阻断级误报 + 4 条漏报 + 8 条残留。
按文档建议顺序执行。

### Fixed（A 口径）

- **A-1** `ds brief` 的阻断判定改为复用 `resolveFailOn`，与 `ds scan` 同一套阈值语义
  （原来用 `blockOn.includes()` 精确匹配，`blockOn:["high"]` 时 scan exit 1、brief 说无阻断）

### Fixed（B 阻断级误报）

- **B-1** `V2-CMP-02` 只匹配顶层 `data:`（缩进 0–4），ECharts `series[].data` 等深层键不再报
- **B-2** 新增规则元数据 `noString`：先抹空字符串字面量内容再匹配。`J8-MOD-01` 启用以避免
  `String t = "var x = 1"` 被当成 JDK9+ 语法
- **B-3** `.vue` 先剥 `<!-- -->` 再走 C 系剥离（模板注释里写 `<script setup>` 不再报）

### Fixed（C 漏报）

- **C-1** `.yml/.yaml/.properties` 新增注释剥离（`#` / `!`，仅行首或空白后），
  `password: root123   # 生产口令` 不再因行尾注释漏报
- **C-2** `J8-API-04` 补数组（`double[] amountArr`）与泛型（`List<Double>`）两种形态
- **C-3** `V2-RTR-01` 的 `allow` 从「行内出现关键词」收窄为「跳转目标为 /login /logout /sso 或 401/expired」，
  `/order?token=` 这类业务跳转重新纳入
- **C-4/C-5** 未改规则，已在正文/`docs/architecture.md` 明示能力边界

### Fixed（D 残留）

- **D-1** 写前护栏不再自带一套判定：新增 `scanText` 供扩展调用，注释剥离、`noString`、
  `exclude`、baseline 豁免与 `ds scan` 完全一致；`edit` 提示行号为块内偏移
- **D-2** eval 从 8 → 10 个用例（`java-money`、`vue2-rtr`），并把 B-1/B-2/B-3/C-1 的误报形态写进 clean 用例
- **D-3** `applies`/`exclude` 的 glob 校验从「必须有扩展名」放宽为「有扩展名或属无扩展名白名单」
  （`**/Dockerfile` 等可建规则）
- **D-4** 非法 `--domain` 直接报错（不再静默「无命中」）
- **D-5** 删除死配置 `severityWeights` / `review.*`（保留真正生效的 `blockOn` / `warnOn`）
- **D-6** `--severity` 同时作用于 `findings` 与 `waived`（两者都基于过滤后的候选集）
- **D-7** `V2-STY-01` 的 `exclude` 补 `**/layout/**/*.vue`、`**/layouts/**/*.vue`
- **D-8** README 退出码重复口径合一

### Changed

- 扫描核心重构成 `compileRules` / `matchLine` / `scanText` / `runScan` 四层，护栏与 CLI 共用

## [0.8.0] — 2026-11-16

按外部审查清单修 5 条 P1 实伤 + 一批 P2。核心变化：让「声明范围」与「实际覆盖」绑在一起。

### Fixed（P1，每条都有回归或实测）

- **P1-1 `J8-SPR-15` 在 yml / properties 上完全失效**：deny 只认带双引号的 Java 字面量。
  补无引号分支（`password: root123` / `password=root123`），`${...}` / `process.env` / `os.environ` 走 `allow`。
  根因治理：`ds check` 新增「`applies` 里每个词法格式都得有一条能命中 deny 的 BAD 样例」
- **P1-2 `pi install dist` 下扩展不可用**：dist 现在带 `cli/` 与 `catalog/`，`buildCatalog` 在无 `rules/` 时回退读 catalog；
  缺 CLI 时打 warning 不再静默降级；`dist/package.json` 补 `bin.ds`
- **P1-3 `--fail-on` 语义是“等于”而非“及以上”**：改为阈值（按 critical>high>medium>low 序数），支持逗号列表；
  同时修正 `policy.blockOn` 也按阈值展开（原来 `blockOn:["low"]` 会放过 critical）
- **P1-4 `--diff` 漏掉“全新目录”下的文件**：未跟踪文件改用 `git ls-files --others --exclude-standard`，
  不再因为 `git status` 只输出目录条目而整目录丢弃
- **P1-5 新增 rules 文件不进 references，产生悬空规则 ID**：skill references 改为「该域目录全量收录」，
  不再写死文件名；doctor 新增 references 齐备校验

### Fixed（P2）

- P2-1/P2-2 兑现策略扩展点：`loadPolicy` = default ← `--profile` ← 业务仓 `.stdkit/policy.json`
- P2-3 注释误报：扫描前剥离 `//` / `/* */` / `--` / `<!-- -->` 注释（保留字符串内容）；
  要看注释本身的规则用 `raw: true`（`SQL-HDR-01`）
- P2-4 文档口径：`architecture.md` 的“零漏报”改为“单行形态零漏报”，并列明能/不能
- P2-5 包装类型：`Double` / `Float` 也按金额规则拦
- P2-6 写前护栏现在读业务仓 `.stdkit/baseline.json`（与 `ds scan` 同语义）
- P2-7 护栏跳过 `evals/` `dist/` 等自身产物目录
- P2-8 `SKIP_DIRS` 补 `.tmp` `tmp` `logs` `vendor` `.venv` 等
- P2-9 参数校验：`--limit` 非数字、`--tag` 缺值、未知参数均报错；`--severity` 改为过滤**命中**
- P2-10 `check` 新增 `applies`/`exclude` glob 可用性校验；JDK8 示例越界由 warning 升为 error
- P2-11 `--diff` 处理 git 引号路径（`core.quotePath=false` + 去引号反转义）
- P2-12 仓库自身 CI：`.github/workflows/ci.yml`（check + eval + node --test）
- P2-13 补纯函数单测 `cli/lib/selftest.test.mjs`（glob / 路径 / 注释剥离 / 过期 / 阈值 / 格式归并 / 围栏解析）
- P2-14 `ds brief` 默认不再因“有阻断项”退出非 0（避免模型误判），需要门禁语义时加 `--fail`
- P2-16 豁免到期改为本地日末比较，不再在 UTC+8 提前 8 小时失效
- P2-17 基线排序比较器补 `0` 分支；`isExpired` 不再重复计算
- P2-18 `ds doctor` 检查每个规则文件是否进了对应 skill references

### Added

- 规则元数据新增 `exclude`（文件维度例外）与 `raw`（不对注释做剥离）；用来表达条文里的“例外”
- `V2-STY-01` 用 `exclude: **/App.vue`；`V2-RTR-01` / `V2-API-04` 收窄到真实误报形态
- eval 新增 `config-secret`（P1-1）、`vue2-clean`（Vue 侧误报），共 8 个用例

## [0.7.0] — 2026-11-16

真实业务仓实测（真实业务仓：388 java / 66 mapper XML / 双方言）后修正精度，并补齐存量仓落地能力。

### Added

- `ds baseline [路径] [--days N]`：把当前命中快照成基线豁免（按 规则+文件 聚合，
  720 条命中 → 200 条豁免）。未过期即生效，到期自动重新计入
- `ds scan --limit N`：终端最多显示 N 条（默认 200），避免大仓刷屏；`--json` 不受限
- `ds init` 支持多模块 Maven/Gradle：扫各模块的 `mapper/<dialect>/`、
  `src/main/java` 公共包前缀，输出模块数与“SQL 脚本散在仓内”提示
- `DS_GIT` 未设时自动探测 Windows 默认安装路径
- eval 新用例 `mapper-scope`，锁住 MBT-02 的作用域

### Fixed（真实仓跑出的 4 处误报，均补了回归）

- `J8-MBT-02` `${}`：作用域从 `**/*.xml` 收到 `**/mapper/**/*.xml` + `*Mapper.xml`。
  原来把 `pom.xml` 的 `${spring-boot.version}`、`logback` 的 `${log.path}` 当注入面（真实仓 65 处误报）
- `J8-SPR-15` 凭证：排除字符串拼接（`"?token=" + token`）并卡“值长度 ≥6 且含数字/符号”，
  `TOKEN = "token"` 这类参数名常量不再误报。同时仍能抓到真实硬编码口令
- `J8-SPR-11` 内存分页：去掉 `deny: \.subList\(`。单看 `.subList(` 无法区分内存分页与
  “取前 N 条”，真实仓 3 处均为误报；视图陷阱归 `J8-COL-01`
- `J8-API-05` BigDecimal：`new BigDecimal(0)`（int 构造，精确）不再误报，只卡十进制字面量

## [0.6.0] — 2026-11-16

M5：质量闭环 + 业务仓接入。

### Added

- `ds eval` + `evals/cases/`：确定性层回归。5 个用例（java-bad 7 / java-clean 0 /
  vue2-bad 10 / sql-bad 6 / waiver）期望行号**手写**，不由实现反推。
  同一条正则改松或改紧，立刻出现“漏报/误报”具体到 `规则|文件|行号`
- `ds init [路径]`：探测栈（pom/gradle 的 Java 版本、Spring Boot、MyBatis-Plus、
  engines、根包、package.json 的 vue）→ 回填 `templates/AGENTS.md` 表格行 →
  落 `AGENTS.md` + `.stdkit/baseline.json`；报告「待人工填」项；支持 `--dry-run` / `--force`
- `ds doctor [路径]`：L3 存在与版本声明、探测值 vs L3 声明、基线豁免（过期/缺 reason）、
  `sql/upgrade/<dialect>/rollback` 存在性、stdkit 自身 catalog/dist 同步。FAIL → 非 0
- `docs/static-analysis.md`：规则落点分工——哪些交 p3c-pmd/ESLint，哪些留 stdkit `deny`，
  哪些只能人/模型；避免三处重复配置互相对抗

### Fixed

- `Java: 1.8` 归一为 `8`；表格键去 `**` 后匹配（`**engines**` → `engines`）；
  空值单元格也能被回填 / 计入待填清单

## [0.5.0] — 2026-11-16

M4：接入审查流程。机械清单直达模型，门禁可接 CI，豁免可登记，
写前护栏可拦 critical 级硬规则。

### Added

- `ds brief [路径] [--diff] [--json]`：一份审查简报 = A 类机械命中（含行号）+
  B 类需语义判定的规则清单 + 阻断判定。按本次文件类型自动推断域，
  Java 改动不会拿 SQL/前端规则去审
- 基线豁免：业务仓 `.stdkit/baseline.json`（`ruleId` + `file` glob + `line` + `until` + `reason`）。
  过期豁免自动失效并重新计入，`scan` / `brief` 都提示清理
- `extensions/stdkit.ts`：pi 扩展
  - 工具 `ds_check`：模型自行跑确定性检查（diff / 全量 / 指定域）
  - 写前护栏：`write`/`edit` 落盘前按 critical 级 deny 正则拦截，`STDKIT_GUARD=off` 可关
- `templates/ci/gate.sh` + `github-actions.yml`：门禁 = `ds check` + `ds scan --diff`，
  阻断级命中即非 0；只判本次分支引入的问题
- `dist/` 新增 `extensions/` 与 `templates/`，`pi install dist` 后开箱可用；
  `dist/package.json` 补 `pi.extensions` 与 `peerDependencies`

### Changed

- 审查 prompt 第一步从 `ds scan --diff --json` 改为 `ds brief --diff`（一次拿齐两列表）

## [0.4.0] — 2026-11-16

M3：`ds build` 落地，规则一次编写、产物全生成；pi 一等公民。

### Added

- `cli/lib/build.mjs` + `ds build`：`rules/` + `policy/` → `dist/`，纯函数、产物确定、无时间戳
- `dist/skills/`：`write-java`（4 份 references）· `write-vue` · `write-sql` · `write-test`，各自自包 references（Agent Skills 标准，name == 目录名）
- `dist/prompts/`：`review-java` · `review-vue` · `review-sql` · `review-fullstack`，
  每份自动注入“可机械判定的规则 ID 清单”+“需语义判定的规则清单”，审查分两步走
- `dist/AGENTS.md`：常驻底线（AGENTS.md 生态通用，信号表 + 硬约束 + 提交约定）
- `dist/package.json`：pi package manifest（`pi.skills` / `pi.prompts`），`pi install dist` 即装
- `dist/adapters/`：claude（plugin + commands）· codex（plugin + 只显式调用的审查 skill）·
  cursor（alwaysApply 规则）· copilot（instructions）
- `ds check` 新增 dist 陈旧检测：产物与规则不一致 / 有残留文件 → error

### Added（规则补齐）

- `rules/java-jdk8/03-engineering.md`（10 条）：命令/路径/SSRF/反序列化/越权、定时任务、
  分布式锁、消息消费、依赖与配置、日志与错误响应——补齐旧规范库的工程横切面

### Changed

- 规则总数 109 → 119

## [0.3.0] — 2026-11-16

M2：Spring / MyBatis / SQL / Vue2 / 单测四域规则落地，共 109 条。

### Added

- `rules/java-jdk8/01-spring.md`（17 条）：分层依赖、事务边界与自调用、事务内禁远程、
  实体不出参、入口校验、异常不外泄、响应契约、分页与内存分页、幂等与并发写、
  出站超时、配置与密钥、traceId、API 兼容
- `rules/java-jdk8/02-mybatis.md`（14 条）：XML 与注解边界、`${}` 白名单、结果映射、
  `SELECT *`、N+1、批量切批、多方言同步与差异、缓存读写路径、Wrapper 注入面
- `rules/sql/00-delivery.md`（19 条）：目录与命名、全量方言集、跨方言照拄、原生幂等守卫、
  seed、回滚、文件头、无 WHERE 的 DML、DROP/TRUNCATE、明文凭证、吞错、L1-L3、扩展-收缩
- `rules/vue/00-vue2.md`（19 条）：Options API 边界、禁 Pinia/换库、data/props、
  组件体积与泄漏、DOM 与提示、请求封装与基址、样式作用域、路由与 Vuex、console/var、前端密钥
- `rules/test/00-unit.md`（10 条）：测行为不测实现、必须覆盖清单、用例隔离、禁跳过、
  禁 sleep、可重复（时间/随机注入）、不连真库、断言库、Vue2 组件测试
- `templates/AGENTS.md`：业务仓 L3 模板（填表式，含存量现状与基线债段）

### Changed

- `segments` 支持 `-- GOOD` / `<!-- BAD -->` / `/* GOOD */` / `# BAD` 多注释风格
- `deny`/`allow` 支持行首 `(?i)` 大小写不敏感前缀（JS 不支持 `(?i:...)` 修饰组）
- 规则 ID 允许分类段含数字（`UT-J8-01`）
- 约定：正则内需字面 `;` 时写 `\x3b`，避开列表分隔符

## [0.2.0] — 2026-11-16

确定性检查层落地：机械类违规本机跑完，不花 token。

### Added

- `cli/lib/scan.mjs` + `ds scan [路径]`：按规则 `applies` glob 选文件，逐行跑 `deny`/`allow` 正则
- `ds scan --diff [ref]`：只查本次变更（git diff `-U0` 解析行区间），未跟踪文件按整文件算
- `ds scan --json`：输出 `{ruleId,severity,file,line,text,rule}`，供 CI / 评测消费
- 退出码：命中 `policy/default.json` 的 `blockOn` 级别 → 1；可用 `--fail-on` 覆盖
- `DS_GIT` 环境变量：`git` 不在 PATH 时显式指定

### Changed

- `ds` 增加 `scan` 子命令；`main()` 调用移到模块末尾（避免 const 的 TDZ）

## [0.1.0] — 2026-11-16

M1：骨架 + 规则格式 + 自检。JDK8 语言层规则落地。

### Added

- `rules/java-jdk8/00-language.md`：23 条 JDK8 规则（命名·常量·不可变·Optional·集合·时间·并发·异常·日志·版本门禁），全部示例 Java 8 可编译，`p3c:` 对齐《阿里巴巴 Java 开发手册》
- `cli/`：`ds check` / `ds catalog` / `ds rules`
- `ds check` 校验：规则 ID 唯一与前缀、元数据键与取值、`see` 引用可达、`规则`/`为什么` 段、占位符、代码围栏闭合、**JDK8 API 越界扫描**（跳过 `// BAD` 段）、`deny` 正则是否有 BAD 样例、catalog 同步、版本同步
- `policy/`：严重级与阻断阈值外置，`profiles/jdk8-vue2.json`
- `docs/rule-format.md` · `docs/architecture.md`（含确定性检查层设计）

### Changed

- 规则引用从「中文章节名」改为稳定规则 ID；判级从正文散文移入元数据 + `policy/`
