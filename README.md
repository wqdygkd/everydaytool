# everydaytool (edt)

多功能工具平台（`everydaytool`，简称 `edt`），基于 **Tauri 2（Rust）+ Vue 3 + Pinia + Element Plus + Vite**。
桌面壳与全部业务后端均为 Rust 原生实现，**没有 Node 运行时**。

采用单体仓库子目录架构：主壳只负责首页导航、页签与设置，各工具独立存放在 `tools/` 下，
按需加载、互不耦合。内置 7 个工具模块：

| 工具 | 分类 | 说明 |
| ------ | ------ | ------ |
| Chrome沙箱 | 浏览器工具 | 多沙箱浏览器管理 |
| 环境浏览器 | 浏览器工具 | 多环境独立登录、应用内沙箱、Tab 多开 |
| 拦截器 | 浏览器工具 | 本地 MITM 代理：改包 / mock / 流量日志，配合浏览器扩展接管流量与脚本注入 |
| 离线包下载 | 开发工具 | 下载 VSCode 插件、Chrome/Edge 扩展、Docker 镜像、Microsoft Store 应用离线安装包 |
| Treease 编辑器 | 开发工具 | 在线树形结构编辑器（treease.com/editor） |
| WXP 增强 | 自动化工具 | 通过 CDP 启动 WXP：缓存登录会话、备份与恢复转发收藏，并注入增强角标 |
| 身份证号生成器 | 生成器 | 随机生成中国大陆 18 位身份证号 |

## 架构

```text
src-tauri/                 Tauri 2 桌面壳 + 全部业务后端（Rust）
  src/app_domain.rs        应用壳域：数据目录 / 磁盘用量 / 缓存清理 / DevTools
  src/appearance.rs        窗口外观（半透明 / 系统材质）+ 数据根目录解析
  src/env_browser.rs       环境浏览器
  src/chrome_sandbox/      Chrome 沙箱（profile / 指纹 / 进程 / 开发者模式）
  src/offline_pack/        离线包下载（HTTP / 市场源 / Docker / Store）
  src/treease.rs           Treease 编辑器拦截
  src/wxp/                 WXP 增强（CDP / 注入脚本 / 进程）
  src/interceptor/         拦截器（证书 / 规则引擎 / WS 桥 / MITM 代理）
  src/webviews.rs          子 Webview 桥
  src/platform.rs          平台能力（对话框 / 打开路径 / 外链）
src/                       Vue 渲染层（页面 / 组件 / 样式 / 路由 / Store）
src/desktop/               Tauri API 适配层：typed invoke / listen / 平台能力
shared/command-groups/     命令分组单一事实来源（渲染层与 Rust 共用）
scripts/                   开发 / 构建 / 环境检查脚本（按平台分目录）
.github/workflows/         CI（三平台原生构建）与 Release（tag 触发）
```

- 渲染层业务代码统一经 `createCommandHelpers` 调用按域注册的 Tauri commands。
- 命令分组必须与 `shared/command-groups/` 同步（Rust 侧按域注册，渲染层按域调用）。
- `<webview>` 由 Tauri 子 Webview + `src/desktop/webviews.ts` 桥接（每环境独立 WebView2 数据目录）。

## Development Setup

### 项目要求

| 项 | 版本 |
| ------ | ------ |
| Node.js | 22+（仓库 `.node-version` 记录开发机版本） |
| pnpm | 10+（**勿用 npm**，本仓库无 `package-lock.json`） |
| Rust | stable（CI 固定 1.96.0；`Cargo.toml` 的 `rust-version` 为 MSRV 1.80） |
| Tauri CLI | 2.12.4（随 `pnpm install` 安装，无需全局） |

**完整 IDE 是可选的。** 你只需要「编译器工具链」，不需要装 Visual Studio IDE / Xcode IDE。
VS Code、Cursor 或纯终端都可以开发。

### Windows

需要 **MSVC C++ 构建工具**（不是完整 IDE）：

1. 安装 [Build Tools for Visual Studio](https://aka.ms/vs/17/release/vs_BuildTools.exe)
2. 勾选工作负载 **Desktop development with C++**（含 MSVC x64 工具集 + Windows SDK）
3. 安装 Rust：`winget install Rustlang.Rustup` 或 https://rustup.rs
4. 安装 Node.js 22+ 与 pnpm：`corepack enable`

**不需要手动设置 `INCLUDE` / `LIB`，也不需要在项目配置里写 MSVC 或 Windows SDK 版本号。**
`scripts/windows/_env.bat` 会用 `vswhere.exe` 自动发现 VS 实例，并用 `VsDevCmd.bat` 在构建进程链里初始化环境。
产物就在仓库 `target/`（见 `.cargo/config.toml`）；脚本不搬迁构建目录。

> 如果你在「x64 Native Tools Command Prompt」里开发，脚本检测到 `INCLUDE`/`LIB` 已就绪会直接复用，不会重复初始化。
> 想显式指定构建目录：`$env:CARGO_TARGET_DIR = 'D:\my-target'`（脚本会尊重该变量）。

### macOS

```bash
xcode-select --install     # Command Line Tools（不需要完整 Xcode）
curl https://sh.rustup.rs -sSf | sh
corepack enable            # 提供 pnpm
```

本项目为纯桌面应用，不需要 iOS / 特定 Apple SDK；只有启用签名与公证时才需要开发者账号证书。

### Linux（Ubuntu 22.04 / 24.04）

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libxdo-dev patchelf pkg-config build-essential
```

Fedora / Arch 的包名不同（`webkit2gtk4.1-devel` / `webkit2gtk-4.1` 等），`pnpm doctor` 会按能力检查并给出提示。

### 环境检查

```bash
pnpm install
pnpm doctor
```

`pnpm doctor` 只做只读检查（不安装、不修改系统环境），输出 `OK / MISSING / NOT INITIALIZED / WARN / UNSUPPORTED`，
存在阻塞构建的问题时退出码为 1（可直接用于 CI）。检查项：

- 通用：平台、Node、pnpm、rustc/cargo（含 host triple）、Tauri CLI、依赖目录、rustup 目标
- Windows：vswhere → VS Build Tools → **实际执行一次 VsDevCmd** → `cl.exe` / `INCLUDE` / `LIB` / Windows SDK → 构建目录与磁盘余量
- macOS：`xcode-select -p`、Apple SDK、clang
- Linux：C 编译器、pkg-config、`gtk+-3.0` / `webkit2gtk-4.1` / `javascriptcoregtk-4.1` / `libsoup-3.0`（含 `ayatana-appindicator3` / `openssl` / `xdotool` 的可选提示）

## 本地开发

```bash
pnpm dev        # 按平台分派：Windows → scripts/windows/dev.bat；macOS/Linux → scripts/<os>/dev.sh
pnpm web        # 纯浏览器预览（无桌面桥接：只出现 supportedTargets 含 web 的工具，设置页不可用）
```

`pnpm dev` 走 Tauri CLI 的 `dev`，`beforeDevCommand` 会启动 Vite（5173）；改 Rust 后自动重编译，改前端热更新。

底层等价命令：

```bash
pnpm tauri:dev:raw      # 直接走 Tauri CLI（仍会做平台环境初始化）
pnpm tauri <args>       # 透传任意 Tauri CLI 子命令，如 pnpm tauri icon
```

## 本地构建

```bash
pnpm build              # 按平台分派到原生构建脚本
pnpm build:web          # 只构建前端
pnpm dist:installer     # 同 pnpm build
```

产物位置：

| 平台 | 路径 |
| ------ | ------ |
| Windows | `target\release\bundle\nsis\everydaytool_<version>_x64-setup.exe` |
| macOS | `target/release/bundle/dmg/*.dmg`（以及 `bundle/macos/*.app`） |
| Linux | `target/release/bundle/deb/*.deb`（如需 AppImage：`pnpm build -- --bundles appimage`） |

> 构建目录由 `.cargo/config.toml` 的 `target-dir = target` 指定（仓库根）。需要换位置时自行设置 `CARGO_TARGET_DIR`。
> 从旧版本升级的仓库可能残留 `src-tauri/target`，可以删除。

## 代码检查

```bash
pnpm typecheck                        # 渲染层 TS
pnpm lint                             # ESLint（含 tools）
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## CI 构建

`.github/workflows/ci.yml`：

| Job | Runner | 内容 |
| ------ | ------ | ------ |
| `quality` | ubuntu-22.04 | doctor / typecheck / lint / cargo fmt / clippy / cargo test |
| `build (windows)` | windows-latest | doctor / 前端构建 / `--bundles nsis` / 上传 exe |
| `build (macos)` | macos-latest | doctor / 前端构建 / `--bundles app,dmg` / 上传 dmg |
| `build (linux)` | ubuntu-22.04 | doctor / 前端构建 / `--bundles deb` / 上传 deb |

- 三平台各自使用**原生 Runner**，不做跨平台编译、不依赖 Docker。
- 版本固定：Node 22、Rust 1.96.0、pnpm（由 `packageManager` 决定）、Ubuntu 22.04。
- 三平台产物路径统一为仓库 `target/release/bundle/...`（D8050 已在 `Cargo.toml` 里根治，无需特殊路径）。

## Release

`.github/workflows/release.yml`：

```text
git tag v1.1.0 && git push origin v1.1.0
  ↓ GitHub Actions（push tag 触发）
  ↓ 三平台原生构建（doctor → 前端 → Tauri bundle）
  ↓ 上传 Artifacts
  ↓ GitHub Release（自动生成 release notes）
```

也可用 `workflow_dispatch` 手动指定 tag（默认 draft）。

- **签名是可选的**：未配置证书时产出未签名安装包，流程不会因此失败，也不会伪称已签名。
- macOS 签名 / 公证：配置 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`、
  `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 后自动导入证书并启用。
- Windows 签名：配置 `WINDOWS_CERTIFICATE`（base64 pfx）、`WINDOWS_CERTIFICATE_PASSWORD` 后导入证书存储
  （还需在 `tauri.conf.json` 配置 `bundle.windows.certificateThumbprint` 才会实际签名）。
- 证书私钥**不得提交到仓库**，一律走 GitHub Secrets。

## 常见问题

**`stddef.h` / `windows.h` 找不到（C1083）**
MSVC 环境未初始化。用 `pnpm doctor` 确认 `INCLUDE` 为 `OK`；不要手动设置 `INCLUDE`/`LIB`，
直接跑 `pnpm dev` / `pnpm build`（脚本会调 `VsDevCmd.bat`）。

**`cl: 命令行 error D8050`**
MSVC 在 `/Z7` + `-Brepro` 下会把命令行写进调试记录，路径过长（实测阈值约 22–25 字符）就写不进去。
`/Z7` 来自 dev profile 的调试信息，所以修复方式是**只对 ring 这一个 C 依赖关掉 C 侧调试信息**，
已在 `src-tauri/Cargo.toml` 固化：

```toml
[profile.dev.package.ring]
debug = false
```

Rust 代码的调试信息完全不受影响，构建目录也不需要搬出仓库。如果你自己新增了 C 依赖并遇到同样报错，
照这个形状给该依赖加一条 `[profile.dev.package.<crate>] debug = false` 即可。
**不要**用全局 `debug = false` 掩盖问题。

**`vswhere.exe` 不存在 / 找不到 C++ 工作负载**
装 Build Tools 并勾选 "Desktop development with C++"；不需要完整 Visual Studio IDE。

**Linux 上 `webkit2gtk-4.1` 找不到**
按上文安装 `libwebkit2gtk-4.1-dev`（Ubuntu）或 `webkit2gtk4.1-devel`（Fedora）。

**macOS 上 `xcrun: error`**
`xcode-select --install` 安装 Command Line Tools，无需完整 Xcode。

**pnpm install 报 lockfile 不匹配**
本仓库使用 pnpm。请使用 `pnpm install --frozen-lockfile`（CI 即如此），不要用 npm。

## 关联文档

| 文档 | 内容 |
| ------ | ------ |
| [AGENTS.md](./AGENTS.md) | **开发约定**：目录边界、命令规范、编码规范、设计系统硬性要求 |
| [DESIGN.md](./DESIGN.md) | **UI 设计**：设计令牌、半透明窗口透明度体系、UI 组件库、布局与动效 |
| [CLAUDE.md](./CLAUDE.md) | 入口指引（指向上述两份权威文档） |
