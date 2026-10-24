#!/usr/bin/env bash
# Linux 原生构建入口：检查环境后执行 Tauri build（beforeBuildCommand 会构建前端）。
# 默认产出 .deb；显式传 --bundles 时以参数为准（如 appimage / rpm）。
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)

# shellcheck source=/dev/null
. "$SCRIPT_DIR/env.sh"

BUNDLES="--bundles deb"
case "$*" in
  *--bundles*) BUNDLES="" ;;
esac

# shellcheck disable=SC2086
exec node "$ROOT_DIR/node_modules/@tauri-apps/cli/tauri.js" build $BUNDLES "$@"