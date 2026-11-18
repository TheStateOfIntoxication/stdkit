#!/usr/bin/env sh
# stdkit 安装 shim：真正逻辑在 cli/lib/install.mjs（单实现，五端一致）。
#   ./install.sh --claude            # 装到 ~/.claude
#   ./install.sh --all --dry-run     # 看会写哪些文件
#   ./install.sh --uninstall         # 反向删除
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$HERE/cli/ds.mjs" install "$@"
