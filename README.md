# everydaytool (edt)

多功能工具平台（`everydaytool`，简称 `edt`），基于 **Electron + Vue 3 + Pinia + Element Plus + Vite**。

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

## 开发指南

### 环境要求

- Node.js 22+
- pnpm 10+（勿用 npm）

### 常用命令

```bash
pnpm install        # 安装依赖

pnpm dev            # 开发模式（Vite HMR + Electron）
EDT_DEVTOOLS=1 pnpm dev   # 同上，启动时自动打开 DevTools
pnpm web            # 纯浏览器预览（无 preload / IPC，只出现 supportedTargets 含 web 的工具，设置页不可用）

pnpm vite build     # 仅构建前端
pnpm typecheck      # TS 类型检查（前端 + 后端两套 tsconfig）
pnpm lint           # ESLint（含 tools 内文件）
pnpm lint:fix       # ESLint 自动修复
pnpm build          # 完整构建（Electron 主进程 + 前端）
pnpm start          # 运行已构建产物
pnpm dist           # 打包安装程序
```

`pnpm dev` 会启动 Vite 前端 HMR，并监听 `electron/`、`shared/`、`backend/`、`tools/*/backend/` 的变化，
重建 `dist-electron/` 后自动重启 Electron。

### 编码规范

完整规范见 **[AGENTS.md](./AGENTS.md)**（导入后缀、目录边界、IPC 调用、样式令牌等硬性约定）。
上手只需记住两条最容易踩的：

- **前端**（`renderer/**`、`tools/*/renderer/**`）：相对导入**无后缀**，Vue SFC 保留 `.vue`；
  禁止直接 `import backend/**`，必须经 preload 暴露的 IPC API 调用。
- **Electron / 后端**（`electron/**`、`backend/**`、`tools/*/backend/**`）：Node ESM，
  源码相对 TS 导入写 **`.ts`** 后缀（构建时由 esbuild 插件还原为 `.js`）。

### 添加新工具

```bash
pnpm create:tool <tool-id>    # 生成目录骨架并自动注册
```

手动创建见 [AGENTS.md § 新增工具](./AGENTS.md#新增工具)（`defineTool` 完整字段说明与 `meta.toolId` 要求）。
工具页由 `defineTool` 自动包 `defineAsyncComponent`，按需加载，主包只保留首页与应用壳。

## 关联文档

| 文档 | 内容 |
| ------ | ------ |
| [AGENTS.md](./AGENTS.md) | **开发约定**：目录边界、IPC 规范、编码规范、设计系统硬性要求 |
| [DESIGN.md](./DESIGN.md) | **UI 设计**：设计令牌、半透明窗口透明度体系、UI 组件库、布局与动效 |
| [CLAUDE.md](./CLAUDE.md) | 入口指引（指向上述两份权威文档） |
| [docs/wxp-enhancer.md](./docs/wxp-enhancer.md) | WXP 增强模块记忆：目标应用逆向、注入脚本约束、验证手法 |
| [docs/interceptor.md](./docs/interceptor.md) | 拦截器模块说明 |
| [docs/offline-pack.md](./docs/offline-pack.md) | 离线包下载模块说明 |
