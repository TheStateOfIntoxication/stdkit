# 发布检查清单

发布（push 到公开仓 / `npm publish` / 发 tag）前逐条勾。机器能做的只有第 2 条，
**其余都得人过一遍**——这也是这份清单存在的理由。

## 1. 授权

- [ ] `LICENSE` 存在，`package.json` 的 `license` 与之一致（`ds check` 会校验）
- [ ] **著作权人三处一致**：`LICENSE` 的 `Copyright (c) <年> <人>`、`package.json` 的 `author`、
      `docs/provenance.md` 的署名段落（`ds check` 会校验）。用 GitHub 账号最省事——与 `repository`
      的 owner 一致，别人一眼能对上是同一个人
- [ ] 若仓此前是 `UNLICENSED` 且已 push 过：README 写明「自 vX.Y.Z 起采用 MIT」，
      不假装历史提交是有授权的
- [ ] `docs/provenance.md` 存在，且**只声明原创**：不写「从某仓迁入」之类的措辞
      （`ds check` 会拦 `迁入` / `迁移自` / `取自旧仓`）——一句话能引来整串授权追问
- [ ] 引用第三方规范（例如《阿里巴巴 Java 开发手册》）只做**名称与编号对齐**，
      不复刻正文；`p3c:` 字段的存在不等于搬运授权
- [ ] **对外口径只以 `docs/provenance.md` 为准**：CHANGELOG 会保留历史表述（0.16.0 曾写过
      "迁入"、0.16.1 撤销），那只是变更记录，不是授权声明。被问到时指 provenance，不指 CHANGELOG

- [ ] **仓根只放白名单文件**（`AGENTS.md` / `CHANGELOG.md` / `README.md` / `LICENSE` / `package.json` /
      `install.sh` / `install.ps1` / `.gitattributes` / `.gitignore`）：根目录出现陌生文件本身就是信号，
      临时脚本放 `.tmp/`（已忽略）或仓外。`ds check` 会给 warning

### 1.1 公开前置检查（不可撤回，放在最前面）

工作树干净 ≠ 历史干净。`force-push` 只改引用不删对象，所以历史改写之后必须查一遍：

```bash
node cli/ds.mjs publish-check --history           # 工作树 + 可达历史，0 命中才算过
git log --all --oneline -- <曾泄漏的文件>          # 应无输出
git cat-file -e <旧 SHA>:<曾泄漏的文件>            # 本地对象库若还在 → 远端多半也在
```

- [ ] `publish-check --history` **0 命中**（历史里的命中若有正当理由，写进 `policy/publish.json` 的
      `historyAllow`，带 `reason`——不接受「它一直在那儿」这种理由）
- [ ] 确认真实远端：仓库是否**曾经公开过**（`curl -sL -o /dev/null -w "%{http_code}" https://github.com/<owner>/<repo>`）
- [ ] 历史里出现过真凭证 / 内部路径时，二选一：**删仓重建**（最省事）、或推完请平台 GC 并接受
      fork / 缓存可能残留

### 1.2 重建仓历史（只在「历史里混进过不该公开的东西」时做）

适用于：旧提交里含真凭证 / 本机路径 / 内部仓名，且远端对象库不可控（`force-push` 只改引用、不删对象）。
做完本仓只有 **1 个提交**，于是 `publish-check --history` 会**trivially 绿**——它证明不了过去，
只证明「从现在起干净」。过去那部分只能靠第 10 步（删旧仓）解决，别把绿当清白。

**0) 先备份**（后悔时能全拿回来，含所有分支与 33 个提交）

```bash
git bundle create ../stdkit-$(date +%F).bundle --all
```

```bash
# 1) 确认工作树就是要发布的内容（连忽略项一起看）
git status --porcelain --ignored

# 2) 关掉编辑器 / Git GUI（Windows 上 .git 里的 packfile 可能被占用）

# 3) 删掉历史
rm -rf .git                                   # PowerShell: Remove-Item -Recurse -Force .git

# 4) 重新初始化 + 本地身份（**只用 --local**，别动 --global）
git init                                      # git < 2.28 没有 init -b
git checkout -b main
git config user.name  "<GitHub 账号>"
git config user.email "<邮箱>"
git config core.autocrlf false                # 必须在 add 之前：否则整树被换行符重写
git config core.sshcommand "ssh -i <私钥路径> -o IdentitiesOnly=yes"
git config pull.ff only
git remote add origin git@github.com:<owner>/stdkit.git

# 5) add 之前先过门禁（此时还没有 .git 的东西可查历史，两道都是工作树级）
node cli/ds.mjs check
node cli/ds.mjs publish-check

# 6) add + 核对：文件数要对得上，忽略项不能混进来
git add -A
git ls-files | wc -l
git ls-files | grep -E '\.idea|\.tmp' || echo '无忽略项混入'

# 7) 一次提交
git commit -m "chore: stdkit vX.Y.Z（历史重建：起点提交）"

# 8) push：**新仓必须是空的**（别勾 Add a README / .gitignore，否则先删那个提交或 force）
git push -u origin main

# 9) push 后确认
git ls-remote origin refs/heads/main
node cli/ds.mjs publish-check --history

# 10) 旧仓：删除，或永久保持私有
```

**第 10 步别省**：旧仓里仍留着那些对象，哪天手滑公开就前功尽弃。

## 2. 脱敏（可执行）

```bash
node cli/ds.mjs publish-check /path/to/stdkit /path/to/另一个仓
```

- [ ] 两个仓都 **0 命中**
- [ ] 命中项若确认可公开，加进 `policy/publish.json` 的 `allowPaths`（并在 PR 里说明原因）
- [ ] `git log -p --since="3 months ago" | grep -nE '(内网 IP|sk_live_|cloud-integration)'`
      抽样人眼过一遍（正则只能抓已知形态）

## 3. 内容

- [ ] `CHANGELOG.md`、README、docs 里无内部仓名 / 内网 IP / 公司内部域名
- [ ] 示例代码里没有「长得像真凭证」的字符串（假密钥也用明显假的形态）
- [ ] `docs/limits.md` 的已知限制与实际一致（修好了的要删掉）
- [ ] README 里没有夸大表述：「替代 review」「零误报」「支持所有客户端」这类说法必须改掉
- [ ] demo / 截图 / 录屏已脱敏

## 4. 构建与产物

```bash
node cli/ds.mjs catalog && node cli/ds.mjs build && node cli/ds.mjs check && node cli/ds.mjs eval
node --test cli/lib/*.test.mjs
npm pack --dry-run   # 看 files 列表是否合理
```

- [ ] `check` 0 error、`eval` 全过、单测全过
- [ ] `dist/` 与 `rules/` 同一次提交（`check` 会报 stale）
- [ ] 在空目录里 `npx <tgz> scan` 能跑出结果（验证 dist 自包含）

## 5. 版本

- [ ] `CHANGELOG.md` 写明本次版本与 `0.x` 的语义
- [ ] 若升到 `1.0.0`：`--fail-on` 语义、`catalog` 结构、`policy` 键名三处已冻结
- [ ] tag 与 `package.json` 的 version 一致

## 6. 发布后

- [ ] GitHub Release 附 CHANGELOG 对应段落
- [ ] 在 README 首屏确认 `npx` 一行可用
- [ ] 把本次的脱敏遗漏（如果有）回填进 `policy/publish.json`，下次自动拦住
