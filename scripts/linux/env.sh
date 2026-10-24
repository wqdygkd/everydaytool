#!/usr/bin/env bash
# Linux 构建环境检查（只检查，不安装任何东西）。
# 由 dev.sh / build.sh source，也可单独执行：sh scripts/linux/env.sh
#
# 目标发行版：Ubuntu 22.04 / 24.04 LTS（与 CI runner 一致）。
# Tauri 2 在 Linux 依赖 WebKitGTK 4.1 与 GTK3；不同发行版包名不同，这里只做能力检查：
#   Debian/Ubuntu: build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
#                  libayatana-appindicator3-dev librsvg2-dev libssl-dev libxdo-dev
#   Fedora:        @development-tools webkit2gtk4.1-devel gtk3-devel \
#                  libappindicator-gtk3-devel librsvg2-devel openssl-devel libxdo-devel
#   Arch:          base-devel webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg openssl xdotool

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

# --- C 工具链（ring / 其他 C 依赖） -------------------------------------------
if command -v cc >/dev/null 2>&1; then
  edt_ok "cc: $(cc --version | head -n 1)"
elif command -v gcc >/dev/null 2>&1; then
  edt_ok "gcc: $(gcc --version | head -n 1)"
elif command -v clang >/dev/null 2>&1; then
  edt_ok "clang: $(clang --version | head -n 1)"
else
  edt_fail "No C compiler found. Install build-essential (Debian/Ubuntu) or @development-tools (Fedora)."
fi

# --- pkg-config ---------------------------------------------------------------
if ! command -v pkg-config >/dev/null 2>&1; then
  edt_fail "pkg-config not found. Install: sudo apt install pkg-config"
fi
edt_ok "pkg-config: $(pkg-config --version)"

# --- Tauri 2 需要的开发库 ------------------------------------------------------
check_pkg() {
  local module="$1"
  local hint="$2"
  if pkg-config --exists "$module"; then
    edt_ok "$module: $(pkg-config --modversion "$module")"
  else
    edt_fail "$module not found. $hint"
  fi
}

check_pkg "gtk+-3.0" "Install libgtk-3-dev (Debian/Ubuntu) / gtk3-devel (Fedora)."
check_pkg "webkit2gtk-4.1" "Install libwebkit2gtk-4.1-dev (Debian/Ubuntu) / webkit2gtk4.1-devel (Fedora)."
check_pkg "javascriptcoregtk-4.1" "Install libwebkit2gtk-4.1-dev (Debian/Ubuntu)."
check_pkg "libsoup-3.0" "Install libsoup-3.0-dev (Debian/Ubuntu)."

# 可选：托盘图标 / SSL / xdotool
pkg-config --exists ayatana-appindicator3-0.1 && edt_ok "ayatana-appindicator3" || edt_warn "ayatana-appindicator3-0.1 not found (tray icon may be unavailable)"
pkg-config --exists openssl && edt_ok "openssl: $(pkg-config --modversion openssl)" || edt_warn "openssl dev headers not found (libssl-dev)"
command -v xdotool >/dev/null 2>&1 && edt_ok "xdotool present" || edt_warn "xdotool not found (needed by some Tauri window APIs: libxdo-dev)"

# --- Rust ---------------------------------------------------------------------
if ! command -v cargo >/dev/null 2>&1; then
  edt_fail "cargo not found. Install Rust: https://rustup.rs"
fi
edt_ok "cargo: $(cargo --version)"

# --- Node / pnpm --------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  edt_fail "node not found. Install Node.js 22+."
fi
edt_ok "node: $(node --version)"

command -v pnpm >/dev/null 2>&1 && edt_ok "pnpm: $(pnpm --version)" || edt_warn "pnpm not found. Install with: corepack enable"

# --- 项目依赖 -----------------------------------------------------------------
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if [ ! -f "$ROOT_DIR/node_modules/@tauri-apps/cli/tauri.js" ]; then
  edt_fail "node_modules / Tauri CLI missing. Run: pnpm install"
fi
edt_ok "project deps ready"
