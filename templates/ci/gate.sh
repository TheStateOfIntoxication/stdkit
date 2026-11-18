#!/usr/bin/env sh
# stdkit 门禁：机械检查 + 规则仓自检。任何 CI 都能跑。
#
#   STDKIT_HOME=/path/to/stdkit ./gate.sh [base-ref] [--no-cross]
#   STDKIT_HOME=/path/to/stdkit ./gate.sh --help
#
# base-ref 默认 origin/main：只判本次分支引入的问题，历史存量不拦。
# STDKIT_HOME 指向**源码仓**（有 rules/）时先跑规则仓自检；指向 dist/ 时自动跳过那一步
# （dist 里没有 rules/，自检无意义；scan / cross 照常可用）。
# 退出码：0 = 通过；1 = 有阻断级命中（critical / high）；2 = 用法/环境错误。
set -eu

usage() {
  cat <<'EOF'
用法: STDKIT_HOME=/path/to/stdkit ./gate.sh [base-ref] [--no-cross]

  base-ref      对比基线，默认 origin/main（只判本次变更）
  --no-cross    跳过仓级检查（非标准布局的仓用）
  -h, --help    本帮助

环境变量:
  STDKIT_HOME   stdkit 根目录。指向源码仓（含 rules/）会先跑规则仓自检；
                指向 dist/ 安装目录时自动跳过自检，仍是完整的 scan + cross 门禁。
EOF
}

STDKIT="${STDKIT_HOME:-}"
if [ -z "$STDKIT" ] || [ ! -f "$STDKIT/cli/ds.mjs" ]; then
  echo "gate: 请设置 STDKIT_HOME 指向 stdkit 根目录（须含 cli/ds.mjs）" >&2
  exit 2
fi

# 选项与位置参数分开解析：直接取 $1 当 ref 会把 --no-cross 当成 git ref（git diff 会失败）。
BASE=""
NO_CROSS=0
for a in "$@"; do
  case "$a" in
    -h|--help) usage; exit 0 ;;
    --no-cross) NO_CROSS=1 ;;
    -*) echo "gate: 未知选项 $a（用 --help 看用法）" >&2; exit 2 ;;
    *) if [ -z "$BASE" ]; then BASE="$a"; else echo "gate: 多余的参数 $a（只接受一个 base-ref）" >&2; exit 2; fi ;;
  esac
done
BASE="${BASE:-origin/main}"

if [ -d "$STDKIT/rules" ]; then
  echo "== stdkit 规则仓自检 =="
  node "$STDKIT/cli/ds.mjs" check
elif [ -f "$STDKIT/catalog/rules.json" ] && [ -f "$STDKIT/cli/ds.mjs" ]; then
  # dist 安装：没有 rules/，自检那 200+ 条「规则 ↔ 产物」断言全部无从比对。
  # 显式说一句，避免以后有人以为门禁漏跑了一步。
  echo "== 跳过规则仓自检（$STDKIT 没有 rules/，是 dist/ 安装） =="
else
  # 第三个分支不是理论情况：STDKIT_HOME 写错一个层级时，前两个都不成立，
  # 少了它就会一路跑到 scan 才报 ENOENT，而错误信息指向的是业务仓。
  echo "gate: STDKIT_HOME=$STDKIT 既不是规则仓（无 rules/）也不是 dist 安装（无 catalog/rules.json）" >&2
  exit 2
fi

echo
echo "== 行级检查（diff vs $BASE） =="
# 未跟踪文件也会被计入；命中阻断级则退出 1
node "$STDKIT/cli/ds.mjs" scan --diff "$BASE"

# 仓级检查：回滚是否配齐、多方言是否齐（ADR 0001）。
# 非标准布局的仓会直接跳过（不误报）；确实不适用时用 --no-cross 关掉。
if [ "$NO_CROSS" = "0" ]; then
  echo
  echo "== 仓级检查（ds cross） =="
  node "$STDKIT/cli/ds.mjs" cross
fi
