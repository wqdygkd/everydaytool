# CLAUDE.md

everydaytool（简称 `edt`，包名 `everydaytool`）多功能工具平台的 Claude Code 项目指南。

## 项目概述

Electron + Vue 3 + Pinia + Element Plus + Vite 多工具平台。Chrome沙箱 是首个工具模块，提供多沙箱浏览器管理功能。

## 架构

```
renderer/              → 主应用 Shell（首页导航）
tools/<tool>/renderer/ → 工具前端（Vue 组件）
tools/<tool>/backend/  → 工具后端（Electron 主进程代码）
tools/<tool>/index.js  → 工具定义入口
electron/              → Electron 入口（仅加载 backend）
shared/                → 跨工具共享代码（预留）
data/                  → 运行时数据（项目根目录）
```

## 目录结构

```
project/
├── renderer/
│   ├── App.vue              # 应用 Shell（header + router-view + footer）
│   ├── main.js              # Vue 入口
│   ├── router/              # 路由配置
│   ├── layouts/             # ToolLayout（返回按钮 + 标题）
│   ├── pages/HomePage.vue   # 主页工具网格
│   ├── shared/
│   │   ├── components/      # ToolCard 等通用组件
│   │   ├── composables/     # useIpc, useDialogVisible, useNavigation
│   │   └── styles/main.css  # CSS 变量定义
│   └── config/tools.js      # 工具注册表
│
├── tools/chrome-sandbox/
│   ├── index.js             # 工具定义（id, name, route）
│   ├── renderer/
│   │   ├── components/      # SandboxCard, StatusPanel, ActionBar 等
│   │   ├── stores/          # sandboxStore（命名空间 chrome-sandbox/sandbox）
│   │   ├── pages/           # ChromeSandbox.vue
│   │   └── shared/          # sandbox.js 常量
│   ├── backend/
│   │   ├── ipc/             # channels.js + handlers.js
│   │   ├── services/        # sandbox-service.js
│   │   ├── store/           # database.js, config-store.js
│   │   ├── chrome/          # Chrome 启动和管理
│   │   ├── fingerprint/     # 指纹生成
│   │   ├── constants/       # sandbox.js 常量（后端用）
│   │   └── utils/           # path-helper.js, logger.js
│   ├── extension/           # 指纹伪造 Chrome 扩展
│   └── assets/              # 工具资源
│
├── electron/
│   ├── main.js              # 引用 tools/chrome-sandbox/backend
│   └── preload.cjs          # IPC 通道暴露
│
├── shared/                  # 跨工具共享（预留）
└── data/                    # 运行时数据（config.db, sandboxes/）
```

## 路径别名

| 别名 | 路径 | 用途 |
|------|------|------|
| `@renderer` | `renderer/` | 主应用前端 |
| `@tools` | `tools/` | 工具目录 |
| `@shared` | `shared/` | 跨工具共享 |

**注意**：工具内部代码使用相对路径，不依赖别名。

## 编码规范

### 工具定义（index.js）

```javascript
export default {
  id: 'chrome-sandbox',           // 唯一标识
  name: 'Chrome沙箱',             // 显示名称
  description: '多沙箱浏览器管理',
  version: '1.0.0',
  color: '#3b82f6',               // 卡片颜色
  route: {
    path: 'chrome-sandbox',
    name: 'tool-chrome-sandbox',
    component: ChromeSandboxPage,
    meta: { toolId: 'chrome-sandbox' },
  },
};
```

### CSS 变量

全局变量定义于 `renderer/shared/styles/main.css`：

| 类别 | 变量 |
|------|------|
| 颜色 | `--color-primary`, `--color-surface`, `--color-text-*`, `--color-border-*` |
| 字体 | `--font-size-*` (xs/sm/base/lg/xl/2xl), `--font-weight-*` |
| 间距 | `--spacing-*` (xs/sm/md/lg/xl/2xl) |
| 圆角 | `--radius-*` (sm/md/lg/xl) |
| 阴影 | `--shadow-*` (sm/md/lg) |
| 过渡 | `--transition-*` (fast/base/slow) |

### Flex 布局

高度链必须完整，否则内容溢出：

```css
.container {
  display: flex;
  flex-direction: column;
  min-height: 0;    /* 关键：允许收缩 */
}
.child {
  flex: 1;
  min-height: 0;    /* 关键：允许收缩 */
  overflow: auto;   /* 滚动 */
}
```

### IPC 调用

前端调用后端：

```javascript
import { invokeIpc, ipcChannels } from '@renderer/shared/composables/useIpc.js';

const channels = ipcChannels();
await invokeIpc(channels.SANDBOX_CREATE, { name: '新沙箱' });
```

IPC 通道定义：`tools/chrome-sandbox/backend/ipc/channels.js`

### Pinia Store

使用模块命名空间避免冲突：

```javascript
defineStore('chrome-sandbox/sandbox', () => { ... });
```

### 常量文件

工具常量（如 sandbox.js）同时存在于：
- `tools/<tool>/renderer/shared/` — 前端使用
- `tools/<tool>/backend/constants/` — 后端使用

两份文件应保持同步。

## 添加新工具

1. 创建目录结构：
   ```
   tools/<tool>/
   ├── index.js
   ├── renderer/
   │   ├── components/
   │   ├── stores/
   │   └── pages/
   └── backend/              # 可选，如需后端代码
   ```

2. 实现 `index.js` 工具定义

3. 注册到 `renderer/config/tools.js`：
   ```javascript
   import newTool from '@tools/new-tool/index.js';
   export const toolRegistry = [chromeSandbox, newTool];
   ```

4. 路由添加到 `renderer/router/routes.js`：
   ```javascript
   children: [
     chromeSandbox.route,
     newTool.route,
   ]
   ```

## 常用命令

```bash
pnpm dev          # 开发模式（Electron + Vite）
pnpm vite build   # 仅构建前端
pnpm build        # 完整构建
pnpm dist         # 打包安装程序
```

## 文件定位速查

| 查找内容 | 位置 |
|----------|------|
| 工具注册 | `renderer/config/tools.js` |
| 工具端支持声明 | `tools/<tool>/index.ts` 的 `supportedTargets` |
| 当前端过滤逻辑 | `renderer/config/toolAvailability.ts` |
| 路由配置 | `renderer/router/routes.js` |
| IPC 通道 | `tools/chrome-sandbox/backend/ipc/channels.js` |
| IPC 处理 | `tools/chrome-sandbox/backend/ipc/handlers.js` |
| 沙箱服务 | `tools/chrome-sandbox/backend/services/sandbox-service.js` |
| 数据库 | `tools/chrome-sandbox/backend/store/database.js` |
| 路径计算 | `tools/chrome-sandbox/backend/utils/path-helper.js` |
| 全局样式 | `renderer/shared/styles/main.css` |
| IPC 前端封装 | `renderer/shared/composables/useIpc.js` |

## 数据目录

运行时数据存放于项目根目录 `data/`：
- `config.db` — 应用配置和沙箱元数据
- `sandboxes/` — 各沙箱的 Chrome Profile 数据
- `shared/` — 共享资源（指纹扩展模板）

**注意**：`data/` 不应放在 `tools/` 目录内。
