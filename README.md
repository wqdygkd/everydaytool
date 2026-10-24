# everydaytool (edt)

多功能工具平台（`everydaytool`，简称 `edt`），基于 **Tauri 2（Rust 桌面壳）+ Vue 3 + Pinia + Element Plus + Vite**。
工具业务后端保留为 Rust 监管的 Node 运行时（sidecar，stdio JSON-RPC），桌面壳为 Tauri + Rust。

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

```
src-tauri/      Tauri 2 桌面壳（Rust）：窗口 / 菜单 / 系统能力 / Tauri commands / 子 Webview
sidecar/   Node 业务运行时：由 Rust 以子进程启动，承载 server/** 与 tools/*/server/**
src/       Vue 前端（原有页面 / 组件 / 样式 / 路由 / Store 全部保留）
src/desktop/  Tauri API 适配层：typed invoke / listen / 平台能力
shared/command-groups/  命令分组单一事实来源（前端 / Node / Rust 共用）
```

- 渲染层业务代码统一经 `createCommandHelpers` 调用按域注册的 Tauri commands。
- 系统能力（目录/文件对话框、打开路径、外链、WebView 缓存、窗口外观）由 Rust 实现；
  Rust 侧按域注册 commands，Node 侧校验命令所属域。
- `<webview>` 由 Tauri 子 Webview + `src/desktop/webviews.ts` 桥接（每环境独立 WebView2 数据目录）。

## 开发指南

### 环境要求

- Node.js 22+
- pnpm 10+（勿用 npm）
- Rust stable（MSVC 工具链）+ WebView2 Runtime（Windows）

### 常用命令

```bash
pnpm install        # 安装依赖

pnpm dev            # Tauri CLI 启动（beforeDevCommand 构建 sidecar 与 Vite）
pnpm web            # 纯浏览器预览（无桌面桥接，只出现 supportedTargets 含 web 的工具，设置页不可用）

pnpm build:web      # 仅构建前端
pnpm build:sidecar     # 仅构建 Node 业务运行时 bundle
pnpm typecheck      # TS 类型检查（前端 + 后端两套 tsconfig）
pnpm lint           # ESLint（含 tools 内文件）
pnpm lint:fix       # ESLint 自动修复
pnpm build          # Tauri CLI 构建并生成 NSIS 安装包
pnpm dist:installer # 同 pnpm build
```

> 仓库根即工程根（Tauri 项目）。`pnpm tauri` 使用本地安装的
> `@tauri-apps/cli@2.12.4`；`tauri build` 的 `beforeBuildCommand` 会先执行
> `prepare:sidecar` 和 `build:web`。

### 安装版（NSIS）

官方构建（推荐）：

```bash
pnpm tauri build
# 或 pnpm dist:installer
```

产物：

```text
src-tauri/target/release/bundle/nsis/everydaytool_<version>_x64-setup.exe
```

- 由 Tauri 官方 bundler 生成，自动处理 WebView2 安装策略、快捷方式、卸载项。
- 需要联网首次下载 NSIS 工具链（已缓存在 `%LOCALAPPDATA%\tauri`）。
- 安装范围 / WebView2 模式由 `tauri.conf.json` 的 `bundle.windows` 配置控制。

`pnpm dev` 会先 esbuild 打包 Node 业务运行时，再启动 Vite（5173）与 `cargo run`；Rust 启动后以
sidecar 方式拉起 `dist-sidecar/main.mjs`。修改后端后重新执行 `pnpm dev`（或先 `pnpm build:sidecar`）。

### 编码规范

完整规范见 **[AGENTS.md](./AGENTS.md)**（导入后缀、目录边界、command 调用、样式令牌等硬性约定）。
上手只需记住两条最容易踩的：

- **前端**（`src/**`、`tools/*/{pages,components,stores,composables}/**`）：相对导入**无后缀**，Vue SFC 保留 `.vue`；
  禁止直接 `import server/**`，必须经桌面适配层暴露的 Tauri command API 调用。
- **Node 运行时 / 后端**（`sidecar/**`、`server/**`、`tools/*/server/**`）：Node ESM，
  源码相对 TS 导入写 **`.ts`** 后缀；Rust 命令分组需与 `shared/command-groups/` 同步。

### 添加新工具

```bash
pnpm create:tool <tool-id>    # 生成目录骨架并自动注册
```

手动创建见 [AGENTS.md § 新增工具](./AGENTS.md#新增工具)（`defineTool` 完整字段说明与 `meta.toolId` 要求）。
工具页由 `defineTool` 自动包 `defineAsyncComponent`，按需加载，主包只保留首页与应用壳。

## 关联文档

| 文档 | 内容 |
| ------ | ------ |
| [AGENTS.md](./AGENTS.md) | **开发约定**：目录边界、命令规范、编码规范、设计系统硬性要求 |
| [DESIGN.md](./DESIGN.md) | **UI 设计**：设计令牌、半透明窗口透明度体系、UI 组件库、布局与动效 |
| [CLAUDE.md](./CLAUDE.md) | 入口指引（指向上述两份权威文档） |
| `../docs/TAURI_*.md` | 迁移分析 / 计划 / 状态 / API 映射 / 报告 |
