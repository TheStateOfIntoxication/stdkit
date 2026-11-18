# 安装

两种来源，选一个：

```bash
# A. 从源码仓（推荐给要改规则的人）
git clone <repo> stdkit
cd stdkit && node cli/ds.mjs check       # 先确认仓是好的

# B. 从 npm（只用来跑规则的人）
npm i -g stdkit      # 装完有 ds 命令；临时用 npx stdkit
```

各客户端装的是 **`dist/`**（`ds build` 的产物）。`dist/` 自带 `cli/`、`catalog/`、`LICENSE`，
装到任何地方都能独立运行：`scan` / `brief` / `cross` / `install` / `publish-check` 都可用，
不需要 `STDKIT_HOME`。

**`dist/` 里没有 `rules/`**，所以 `ds check`（规则仓自检）与 `ds doctor` 的自身一致性部分会自动跳过，
并打印一行说明——这不是报错。CI 门禁要跑全（含自检那一步），`STDKIT_HOME` 就必须指向**源码仓**：

```bash
STDKIT_HOME=/path/to/stdkit-source sh templates/ci/gate.sh origin/main   # 自检 + 行级 + 仓级
STDKIT_HOME=/path/to/stdkit/dist   sh templates/ci/gate.sh origin/main   # 行级 + 仓级（自检跳过）
```

**一条命令装完（推荐）**：

```bash
node cli/ds.mjs install --all --dry-run     # 先看会写哪些文件
node cli/ds.mjs install --all               # 装 pi + 四个客户端适配
node cli/ds.mjs install --uninstall         # 反向删除（只删它装过的）
```

`install.sh` / `install.ps1` 是它的薄 shim，Windows 与 *nix 行为一致（同一份实现）。


## pi

```bash
pi install /abs/path/stdkit/dist
```

装完：

- 写 Java / Vue / SQL 时 skill `write-java` / `write-vue` / `write-sql` 自动激活；
- `/write-java`、`/review-java`、`/review-vue`、`/review-sql`、`/review-fullstack` 可用；
- 多一个本地工具 `ds_check`（模型写完代码可以自己自查）；
- 多一层**写前护栏**：`write` / `edit` 命中 critical 级规则时直接拦下（`STDKIT_GUARD=off` 关闭）。

## Claude Code

```bash
cp -r dist/adapters/claude/.claude-plugin /path/to/your-repo/
cp -r dist/skills /path/to/your-repo/.claude/skills/
cp -r dist/adapters/claude/commands /path/to/your-repo/.claude/commands/
```

触发方式：`/review-java`。

## Codex

```bash
mkdir -p ~/.agents/skills
cp -r dist/adapters/codex/skills/* ~/.agents/skills/
```

触发方式：`$review-java`。适配文件里带 `allow_implicit_invocation: false`，只手动触发。

## Cursor

```bash
mkdir -p /path/to/your-repo/.cursor/rules
cp dist/adapters/cursor/rules/stdkit.mdc /path/to/your-repo/.cursor/rules/
```

`alwaysApply: true`，作为常驻规则。

## Copilot

```bash
mkdir -p /path/to/your-repo/.github
cp dist/adapters/copilot/copilot-instructions.md /path/to/your-repo/.github/
```

## 任意客户端 / 自研

```bash
cp dist/AGENTS.md /path/to/your-repo/AGENTS.md
```

`AGENTS.md` 是通用约定（L3 模板见 `templates/AGENTS.md`），大多数 Agent 会自动读取。

## 卸载

- pi：`pi uninstall stdkit`（或删掉安装目录）
- 其它客户端：删掉上面复制进去的文件/目录即可（stdkit 不写全局状态）

## 排查

| 现象 | 原因 / 处理 |
|---|---|
| pi 里没有 `/review-java` | `dist/` 是从旧版本装的 → 重跑 `ds build` 再 `pi install` |
| 护栏不生效 | `STDKIT_GUARD=off` 被设过；或 `cli/` 不在 `dist/` 里（重装）；或文件在 `dist/`、`node_modules/` 等项目根的构建目录下 |
| `ds_check` 报「找不到 CLI」 | 用 `pi install` 装而不是手动拷 `extensions/`；或设 `STDKIT_HOME` 指向 stdkit 根 |
| skill 没自动激活 | 检查 `dist/skills/<name>/SKILL.md` 的 `description` 是否还在（手改 dist 会坏） |
| 与同名 skill 包冲突 | 两者 skill 同名（`write-java` / `write-vue` / `write-sql`），**不要同时装**；`ds doctor` 会提示；`ds install --uninstall` 只删本仓写的条目 |
