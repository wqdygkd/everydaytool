#!/usr/bin/env bash
# macOS 原生构建入口：检查环境后执行 Tauri build（beforeBuildCommand 会构建前端）。
# 默认产出 .app + .dmg；显式传 --bundles 时以参数为准。
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)

# shellcheck source=/dev/null
. "$SCRIPT_DIR/env.sh"

BUNDLES="--bundles app,dmg"
case "$*" in
  *--bundles*) BUNDLES="" ;;
esac

# shellcheck disable=SC2086
exec node "$ROOT_DIR/node_modules/@tauri-apps/cli/tauri.js" build $BUNDLES "$@"