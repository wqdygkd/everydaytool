# everydaytool (edt)

多功能工具平台（`everydaytool`，简称 `edt`），基于 Electron + Vue 3。首个工具模块 Chrome 沙箱提供多实例浏览器管理。

## 架构概览

采用单体仓库子目录架构，主仓库仅负责首页导航，各工具独立存放于 `tools/` 目录。

```
project/
├── renderer/                 # 主应用（首页导航）
│   ├── App.vue               # 应用 Shell
│   ├── router/               # 路由配置
│   ├── layouts/              # 页面布局
│   ├── pages/HomePage.vue    # 主页工具网格
│   ├── shared/               # 前端共享资源
│   └── config/tools.ts       # 工具注册表
│
├── tools/                    # 工具目录
│   └── chrome-sandbox/       # Chrome沙箱 工具（完全独立）
│       ├── index.ts          # 工具入口定义
│       ├── renderer/         # 工具前端
│       │   ├── components/   # Vue 组件
│       │   ├── stores/       # Pinia 状态管理
│       │   └── pages/        # 工具页面
│       ├── backend/          # 工具后端（Electron 主进程）
│       │   ├── ipc/          # IPC 通道与处理
│       │   ├── services/     # 服务层
│       │   ├── store/        # 数据库操作
│       │   ├── chrome/       # Chrome 检测与启动
│       │   ├── fingerprint/  # 指纹生成
│       │   └── utils/        # 工具函数
│       ├── extension/        # 指纹伪造 Chrome 扩展
│       └── assets/           # 工具资源
│
├── electron/                 # Electron 入口
│   ├── main.ts               # 主进程入口源码
│   └── preload.ts            # 预加载脚本源码，构建为 preload.cjs
│
├── dist-electron/            # Electron 主进程与 preload 构建产物
├── shared/                   # 跨工具共享代码（预留）
├── data/                     # 运行时数据
└── docs/                     # 文档
```

## 目录职责

| 目录 | 职责 |
|------|------|
| `renderer/` | 仅首页导航，不含任何工具代码 |
| `tools/<tool>/renderer/` | 工具前端代码 |
| `tools/<tool>/backend/` | 工具后端代码（Electron 主进程） |
| `tools/<tool>/index.ts` | 工具定义入口（导出 id, name, route 等） |
| `electron/` | 仅入口，加载 `tools/*/backend/` |
| `dist-electron/` | Electron 主进程、工具后端、preload 构建产物 |
| `shared/` | 跨工具共享代码（预留） |
| `data/` | 运行时数据（config.db, sandboxes/） |

## Chrome沙箱 工具功能

- 独立 Chrome Profile 沙箱管理（从系统 Chrome 可选继承书签、密码、扩展）
- 指纹伪造扩展（Canvas / WebGL / Navigator）
- 沙箱创建、启动、关闭、删除
- 指纹参数编辑

## 环境要求

- Node.js 22+
- pnpm 10+（勿用 npm）

## 开发

```bash
pnpm install
pnpm dev
```

`pnpm dev` 会启动 Vite 前端 HMR，并监听 `electron/`、`shared/`、`tools/*/backend/` 变化，重建 `dist-electron/` 后自动重启 Electron。

## 构建

```bash
pnpm build        # 构建 Electron 侧与前端
pnpm build:electron
pnpm start        # 启动 Electron
pnpm dist         # 打包安装程序
```

## TypeScript 与导入规范

- 源码统一使用 TypeScript / Vue SFC；构建产物才是 JavaScript。
- 前端范围（`renderer/**`、`tools/*/renderer/**`、`tools/*/index.ts`）导入 TS 模块使用无后缀，Vue SFC 保留 `.vue`。
- Electron / 后端范围（`electron/**`、`tools/*/backend/**`）是 Node ESM，源码中的相对 TS 模块导入使用 `.js` 运行时后缀，不导入 `.ts`。
- `preload` 源码为 `electron/preload.ts`，由 `scripts/build-electron.mjs` 打包为 `dist-electron/electron/preload.cjs`。
- 前端不得直接导入 `backend/**`，统一通过 preload 暴露的 IPC API 调用。

## 添加新工具

1. 创建工具目录：
   ```
   tools/<tool>/
   ├── index.ts        # 工具定义
   ├── renderer/       # 前端
   │   ├── components/
   │   ├── stores/
   │   └── pages/
   └── backend/        # 后端（可选）
   ```

2. 实现 `index.ts`：
   ```ts
   import { defineTool } from '../../renderer/shared/tool/defineTool';
   import ToolPage from './renderer/pages/ToolPage.vue';

   export default defineTool({
     id: 'tool-name',
     name: '工具名称',
     description: '工具描述',
     version: '1.0.0',
     color: '#color',
     category: { key: 'general', name: '通用工具' },
     keywords: ['tool-name'],
     supportedTargets: ['web', 'win', 'mac'],
     route: {
       path: 'tool-name',
       component: ToolPage,
     },
   });
   ```

3. 注册：`renderer/config/tools.ts`
4. 路由由工具注册表自动汇总

## 工具端支持配置

工具在不同客户端的可用性配置在每个工具的 `index.ts` 中：

```ts
supportedTargets: ['web', 'win', 'mac'],
```

- `web`：网页端
- `win`：Windows 桌面端
- `mac`：macOS 桌面端

`renderer/config/toolAvailability.ts` 负责识别当前客户端并过滤首页工具列表与路由。

## 文档

- [CLAUDE.md](CLAUDE.md) — Claude Code 项目指南
- [docs/](docs/) — 设计文档和规范
