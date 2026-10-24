#!/usr/bin/env bash
# macOS 原生开发入口：检查环境后启动 Tauri dev（beforeDevCommand 会拉起 Vite）。
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/../.." && pwd)

# shellcheck source=/dev/null
. "$SCRIPT_DIR/env.sh"

exec node "$ROOT_DIR/node_modules/@tauri-apps/cli/tauri.js" dev "$@"
