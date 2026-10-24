#!/usr/bin/env bash
# macOS 构建环境检查（只检查，不安装任何东西）。
# 由 dev.sh / build.sh source，也可单独执行：sh scripts/macos/env.sh
#
# 说明：本项目是纯 Tauri 桌面应用，不需要完整 Xcode IDE，只要 Command Line Tools。
# 如果将来启用 macOS 签名 / 公证，才需要 Xcode（codesign + notarytool 随 CLT 也可用，
# 但导出 Developer ID 证书需要登录开发者账号）。

set -euo pipefail

edt_fail() {
  printf '\033[31m[ERROR]\033[0m %s\n' "$*" >&2
  exit 1
}

edt_warn() {
  printf '\033[33m[WARN]\033[0m %s\n' "$*" >&2
}

edt_ok() {
  printf '\033[32m[OK]\033[0m %s\n' "$*"
}

# --- Xcode Command Line Tools -------------------------------------------------
if ! xcode-select -p >/dev/null 2>&1; then
  edt_fail "Xcode Command Line Tools missing. Run: xcode-select --install"
fi
edt_ok "Xcode CLT: $(xcode-select -p)"

# --- Apple SDK ----------------------------------------------------------------
if ! SDK_PATH=$(xcrun --show-sdk-path 2>/dev/null); then
  edt_fail "Apple SDK not found (xcrun --show-sdk-path failed). Reinstall Command Line Tools."
fi
edt_ok "Apple SDK: $SDK_PATH"

# --- clang（ring / 其他 C 依赖要用） ------------------------------------------
if ! command -v clang >/dev/null 2>&1; then
  edt_fail "clang not found. Install Xcode Command Line Tools: xcode-select --install"
fi
edt_ok "clang: $(clang --version | head -n 1)"

# --- Rust ---------------------------------------------------------------------
if ! command -v cargo >/dev/null 2>&1; then
  edt_fail "cargo not found. Install Rust: https://rustup.rs"
fi
edt_ok "cargo: $(cargo --version)"

if ! rustc --print target-list 2>/dev/null | grep -qx 'aarch64-apple-darwin'; then
  edt_warn "Rust does not list aarch64-apple-darwin; Apple Silicon builds may need: rustup target add aarch64-apple-darwin"
fi

# --- Node / pnpm --------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  edt_fail "node not found. Install Node.js 22+ (https://nodejs.org) or via fnm/nvm."
fi
edt_ok "node: $(node --version)"

if ! command -v pnpm >/dev/null 2>&1; then
  edt_warn "pnpm not found. Install with: corepack enable  (or npm i -g pnpm@10)"
fi

# --- 项目依赖 -----------------------------------------------------------------
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  edt_fail "node_modules missing. Run: pnpm install"
fi
if [ ! -f "$ROOT_DIR/node_modules/@tauri-apps/cli/tauri.js" ]; then
  edt_fail "Tauri CLI missing. Run: pnpm install"
fi
edt_ok "project deps ready"
