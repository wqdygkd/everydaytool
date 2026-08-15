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
│   └── config/tools.js       # 工具注册表
│
├── tools/                    # 工具目录
│   └── chrome-sandbox/       # Chrome沙箱 工具（完全独立）
│       ├── index.js          # 工具入口定义
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
│   ├── main.js               # 主进程入口
│   └── preload.cjs           # 预加载脚本
│
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
| `tools/<tool>/index.js` | 工具定义入口（导出 id, name, route 等） |
| `electron/` | 仅入口，加载 `tools/*/backend/` |
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

## 构建

```bash
pnpm build        # 前端构建
pnpm start        # 启动 Electron
pnpm dist         # 打包安装程序
```

## 添加新工具

1. 创建工具目录：
   ```
   tools/<tool>/
   ├── index.js        # 工具定义
   ├── renderer/       # 前端
   │   ├── components/
   │   ├── stores/
   │   └── pages/
   └── backend/        # 后端（可选）
   ```

2. 实现 `index.js`：
   ```javascript
   export default {
     id: 'tool-name',
     name: '工具名称',
     description: '工具描述',
     version: '1.0.0',
     color: '#color',
     route: {
       path: 'tool-name',
       name: 'tool-tool-name',
       component: ToolPage,
       meta: { toolId: 'tool-name' },
     },
   };
   ```

3. 注册：`renderer/config/tools.js`
4. 路由：`renderer/router/routes.js`

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
