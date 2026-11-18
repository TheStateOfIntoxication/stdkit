# stdkit dist（生成物，勿手改）

由 `ds build` 从 `rules/` + `policy/` 生成。版本 v0.19.0，127 条规则。

改条文请改仓库根 `rules/`，然后 `node cli/ds.mjs build && node cli/ds.mjs check`。

## 内容

```text
dist/
├── skills/       write-java · write-vue · write-sql · write-test（各自带 references/）
├── prompts/      review-java · review-vue · review-sql · review-fullstack
├── extensions/   pi 扩展：ds_check 工具 + 写前护栏
├── cli/          ds 运行时（自包含：读 catalog/，不依赖源码仓 rules/）
├── catalog/      机器可读规则索引
├── templates/    业务仓 L3 模板 + CI 门禁脚本
├── adapters/     claude · codex · cursor · copilot（薄壳）
├── AGENTS.md     常驻底线（AGENTS.md 生态通用）
└── package.json  pi package manifest（bin: ds）
```

## 已知限制（先知道再装）

- **只有 49/127 条能自动判**：其余靠模型读条文；条文里写「需人工确认」的就是机器抓不到的，**没报不等于没问题**。
- **单栈**：只覆盖 JDK 8 + Vue 2（Options API）。JDK 17 / Vue 3 / TypeScript 没有规则域，接入会看到成片误报。
- **不替代 review**：判的是形态（`private double amount;`），判不了「这个事务边界对不对」。
- **护栏只拦 critical**，且覆盖不到 pi 的注册与事件路由（只能由宿主验证）。
- 与其他同名规范包 **不要同时装**（skill 同名会互相覆盖；`ds doctor` 会给 WARN）。

完整清单（含具体抓不到的形态）：见源码仓 `docs/limits.md`。

## 接入

### pi（一等公民）

```bash
pi install /绝对路径/stdkit/dist        # skills + prompts 一起装上
```

- `/write-java`：显式调用写 skill
- `/review-java`：pi 原生 prompt template，只手动触发
- `ds_check`：扩展注册的工具，模型可自行跑确定性检查
- 写前护栏：`write`/`edit` 命中 critical 级硬规则时拦截（`STDKIT_GUARD=off` 关闭）
- 机械检查：`node <stdkit>/cli/ds.mjs brief --diff`

### Claude Code

把本目录整体当插件用（不要在业务仓根做 cp -r，那会把产物铺进业务仓）：

```bash
# 方案 A：插件安装（推荐）
claude --plugin-dir /绝对路径/stdkit/dist

# 方案 B：把 plugin.json 与审查命令装到用户级目录
mkdir -p ~/.claude/.claude-plugin ~/.claude/commands
cp adapters/claude/plugin.json ~/.claude/.claude-plugin/
cp adapters/claude/commands/*.md ~/.claude/commands/
```

审查用 `/review-java`（skills 进 `/` 菜单，subagent 不装——会被模型自动委托）。

### Codex

```bash
mkdir -p ~/.agents/skills
cp -r skills/* ~/.agents/skills/
cp -r adapters/codex/skills/review-* ~/.agents/skills/
```

`review-*/agents/openai.yaml` 里的 `allow_implicit_invocation: false` 让它只能 `$review-java` 显式调用。

### Cursor / Copilot

- Cursor：`adapters/cursor/rules/stdkit.mdc` → 项目 `.cursor/rules/`
- Copilot：`adapters/copilot/copilot-instructions.md` → `.github/copilot-instructions.md`
- 任意支持 `AGENTS.md` 的工具：`AGENTS.md` → 仓根

## 门禁

`templates/ci/gate.sh` 可直接接 CI：`STDKIT_HOME=... sh templates/ci/gate.sh origin/main`。
逻辑 = 规则仓自检（`ds check`，仅当 `STDKIT_HOME` 有 `rules/`）+ `ds scan --diff`（行级）+ `ds cross`（仓级），
阻断级命中即非 0。`--no-cross` 跳过仓级检查，`--help` 看用法。

**`STDKIT_HOME` 指向源码仓（含 `rules/`）** 时才有自检那一步；指向本目录（dist 安装）时自动跳过，
`scan` 与 `cross` 照常。想把门禁跑全，就把 CI 的 checkout 指向源码仓。

## 冲突优先级

业务仓 `AGENTS.md`（L3） > `skills/*/references/` > `policy/` 默认值。
