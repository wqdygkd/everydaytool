# TypeScript 迁移设计

日期：2026-08-15
状态：已批准

## 1. 背景与目标

Tool Hub 是一个 Electron + Vue 3 + Pinia + Element Plus 多工具平台（`electron/main.js` → `tools/<tool>/backend` 为 Electron 主进程代码，`renderer/` + `tools/<tool>/renderer` 为前端）。当前全部为 JS/Vue 文件（约 80 个文件 / 6858 行），且 IPC 边界类型缺失——前端 `window.chromeSandbox` / `window.cdpInjector` 均为无类型的全局对象，后端 IPC handler 参数为隐式 any。

目标：全量迁移到 TypeScript（strict 模式），覆盖 renderer、全部 3 个工具的前后端、electron 入口。IPC 边界获得类型化封装，前后端数据模型共享类型。

## 2. 转换策略

| 决策点 | 选择 |
|--------|------|
| 范围 | 全量（renderer + 工具前后端 + electron） |
| 后端构建 | esbuild 打包编译到 `dist-backend/`，`tsc --noEmit` 单独做类型检查 |
| 类型严格度 | `strict: true` |
| JS→TS 重命名 | **原地重命名**（`a.js` → `a.ts`），不动目录结构 |
| 模块格式 | 保持 ESM（Node ≥22 + Electron 41 原生支持）。`import './x.ts'` → `import './x.js'`，编译后指向产物 |
| preload | 保持 `preload.cjs` JS 不变（preload 强制 CJS；用 JSDoc 提供类型）；但预填通道键改为从共享 TS 常量编译产物读取 |
| `import.meta.url` | 重写为 `new URL('./x', import.meta.url)`（esbuild 编译产物中保持相对路径） |
| 需复制的非 TS 资源 | `chrome-process-query.ps1`（process-manager 引用）——构建脚本复制到 `dist-backend/` 同路径 |

## 3. 目录布局（重命名后）

后端源码编译为 CJS，**逐文件、保目录结构**输出到 `dist-backend/`：

```
electron/main.ts              ──► dist-backend/electron/main.js      （package.json main）
tools/chrome-sandbox/backend/**/*.ts  ──► dist-backend/tools/chrome-sandbox/backend/**/*.js
tools/cdp-injector/backend/**/*.ts    ──► dist-backend/tools/cdp-injector/backend/**/*.js
tools/chrome-sandbox/backend/chrome/chrome-process-query.ps1  ──► dist-backend/tools/chrome-sandbox/backend/chrome/  （复制）
```

- `electron/preload.cjs` 保持原样，由构建脚本从共享常量编译产物读取通道键并重新生成（现有 `scripts/sync-ipc-channels.js` 的替代）。
- 前端（renderer）不编译，由 Vite 直接消费 `.ts` 源码。

## 4. 共享类型与 IPC 边界

新增 `shared/types.ts`（纯类型，编译后不参与产物），导出：

- `Sandbox`（来自 `sandbox-store.js` 的 `mapRow` 行映射）、`SandboxStatus`、`SandboxMetadata`、`LaunchOptions`、`SandboxCreatePayload`、`SandboxUpdatePayload`
- `Fingerprint`（来自 `fingerprint-store.js` 的 `mapRow` 行映射）、`FingerprintCreatePayload`、`FingerprintUpdatePayload`
- `AppConfig`、`AppConfigUpdate`、`SetupState`
- CDP 域：`CdpProfile`、`CdpScript`、`CdpDefaults`、`CdpRunningState`、`CdpTarget`、`CdpLaunchResult`、`CdpBatchResult`

类型来源原则：**以存储层 `mapRow` 的返回值 / 入参为准**。接口与实现共享类型；渲染层持有 `window.api.invoke()` 返回 `Promise<unknown>`，由 `useIpc`/store 做类型收窄。

preload 通过 JSDoc 描述形状：`preload.cjs` 中 `invoke(channel, ...args)` 的通道参数可用 TS 联合类型标注，由 sync 脚本将生成的通道常量注入其中（保持 JS，仅在注释中提供类型信息）。

## 5. 前端 IPC 封装（类型化）

新目录 `renderer/shared/ipc/`（原 `composables/useIpc.js`、`useCdpIpc.js` 迁入）：

```
renderer/shared/ipc/
├── types.ts        # 由 shared/types.ts 再导出；窗口全局类型声明（declare global Window）
├── useIpc.ts       # getChromeSandboxApi/ipcChannels/invokeIpc/onIpc 及类型化 API 对象
└── useCdpIpc.ts    # cdp 对应的类型化封装
```

## 6. 各模块迁移要点

### 6.1 Electron 入口（`electron/main.ts`）

- `__dirname` 改为 `new URL('.', import.meta.url)`。
- `preload: path.join(__dirname, 'preload.cjs')`：从 main 编译产物位置指向 `../preload.cjs`，仍用 `path.join(new URL('.', import.meta.url).pathname, 'preload.cjs')`。
- `loadFile(path.join(__dirname, '../dist/index.html'))` 保持相对路径。

### 6.2 Chrome 沙箱后端

- `backend/utils/path-helper.ts`：`__dirname` → `new URL('.', import.meta.url)`，`APP_ROOT_DEV` 相对计算不变（从 `tools/chrome-sandbox/backend/utils/` 上溯 4 级到项目根）。dev/prod 下路径行为需保持不变。
- `backend/chrome/process-manager.ts`：`WINDOWS_QUERY_SCRIPT` 用 `new URL('./chrome-process-query.ps1', import.meta.url)`；构建脚本负责把 `.ps1` 复制到编译产物同目录。
- `backend/store/database.ts`、`sandbox-store.ts`、`fingerprint-store.ts`、`config-store.ts`、`config-setup.ts`：导出类型化接口；`better-sqlite3` 行类型定义。
- `backend/ipc/channels.ts`：保留共享通道常量。
- `backend/ipc/handlers.ts`：`ipcMain.handle(channel, (_event, data: SandboxCreatePayload) => ...)` 等显式入参类型。
- `backend/services/sandbox-service.ts`、`chrome/*`、`fingerprint/*`、`profile/*`、`utils/*`：加上模型类型。

### 6.3 CDP 注入工具后端

- `backend/services/cdp-client.ts`：`ws` 事件 / `message` 类型化；`CdpInjectionSession` 属性与方法类型化。
- `backend/services/injector-service.ts`：运行态、批量结果类型化。
- `backend/services/devtools-service.ts`、`launcher-service.ts`、`store/config-store.ts`、`utils/*`、`ipc/*` 同上。

### 6.4 前端 renderer 与工具 renderer

- `tools/<tool>/index.ts`：`ToolDefinition` 类型（`route.meta.toolId` 等）。
- `renderer/config/tools.ts`、`router/*`、`App.vue`、`HomePage.vue`、`ToolLayout.vue`、`ToolCard.vue`。
- 各组件 `.vue`：`<script setup lang="ts">`；`defineProps<T>()`、`defineEmits` 类型化。
- stores（`sandboxStore.ts`、`cdpInjectorStore.ts`）：`ref<Sandbox[]>([])` 等。
- 共享工具模块：`launchOptions.ts`、`sandbox.ts`（渲染层常量）、`generator.ts`、`area-codes.ts`。

### 6.5 工具 index.js → index.ts

三个工具 `index.js` 均改为 `index.ts`（`ToolDefinition` 类型 + 组件类型导入）。`renderer/config/tools.ts` 的导入路径相应改为 `@tools/<tool>/index.js`（编译后由 Vite 解析 TS）。

## 7. 配置文件

### 7.1 `tsconfig.json`（类型检查用）

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": {
      "@renderer/*": ["renderer/*"],
      "@tools/*": ["tools/*"],
      "@shared/*": ["shared/*"]
    }
  },
  "include": ["renderer", "tools", "electron", "shared"]
}
```

### 7.2 新增 devDependencies

- `typescript`
- `esbuild`
- `@types/node`
- `@types/better-sqlite3`
- `@types/ws`

### 7.3 `scripts/` 构建脚本

- `scripts/build-backend.mjs`：esbuild 逐文件编译 `electron/main.ts` + 两个工具 backend 为 CJS 到 `dist-backend/`（保持相对目录结构）；复制 `chrome-process-query.ps1`。
- `scripts/sync-preload.mjs`：从 `dist-backend` 的 channels 产物读取通道键，重新生成 `electron/preload.cjs`（替代现有 sync-ipc-channels.js）。

### 7.4 package.json

```json
{
  "main": "dist-backend/electron/main.js",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build:backend": "node scripts/build-backend.mjs",
    "build": "pnpm run build:backend && vite build",
    "dev": "pnpm run build:backend && concurrently -k \"vite\" \"wait-on tcp:5173 && cross-env NODE_ENV=development electron . --remote-debugging-port=0\"",
    "pack": "pnpm run build && electron-builder --dir",
    "dist": "pnpm run build && electron-builder",
    "sync:preload": "node scripts/sync-preload.mjs"
  }
}
```

`vite.config.ts`：同构化（原 vite.config.js 改 ts，配置不变）。

### 7.5 electron-builder.json

- `files` 增加 `"dist-backend/**/*"`，保留 `"tools/**/*"`（extension/ 等资源仍需要）。
- `extraResources` 中 `tools/chrome-sandbox/extension` → `extension` 不变（path-helper 在 prod 引用 `process.resourcesPath/extension`）。

## 8. 迁移顺序

1. 基础：装依赖；`tsconfig.json`；`shared/types.ts`；`vite.config.ts`；`electron/main.ts` + `electron-builder.json` + package.json；构建脚本（build-backend + sync-preload）。
2. 前端：`renderer/shared/ipc/`（types + useIpc + useCdpIpc）；`tools/*/index.ts`；`renderer/config` + `router`；共享模块；App/HomePage/ToolLayout/ToolCard。
3. 工具前端：stores → composables → components → pages（chrome-sandbox、cdp-injector、id-card-generator）。
4. 后端：chrome-sandbox backend（channels → constants → utils → store → fingerprint → profile → chrome → services → handlers）→ cdp-injector backend。
5. 收尾：运行 `pnpm typecheck`（类型检查）、`pnpm build:backend` + `pnpm vite build`（构建验证）、`pnpm dev` 冒烟测试。补 `tools/chrome-sandbox/renderer/shared/sandbox.ts` 与后端 constants 的同步说明。

## 9. 错误处理与风险

- **保留策略**：为所有路径行为、常量、IPC 通道、数据库 schema 保持一致；JS 迁移尽量做等值机械转换，降低回归风险。
- **构建链变更**：`dev`/`start` 前先 `build:backend`；若 Electron 入口未找到编译产物会启动失败（控制台报错明确）。
- **esbuild 与 tsc 分离**：类型错误不会阻断构建（`typecheck` 单独跑）；CI 可先 `typecheck` 再 build。
- **ps1 资源**：如果复制遗漏，`process-manager` 的 Windows 查询会失败——build-backend 脚本中加存在性断言。
- **`noUnusedLocals`/`noUnusedParameters`**：严格开启，但迁移期如遇非必要告警可临时按需调整，最终以零告警为目标。
- **打包**：`electron-builder.json` 的 `files` 需同时含 `dist-backend/**/*` 与 `tools/**/*`（extension 模板、指纹注入资源仍在源码目录被引用）。

## 10. 验证

- `pnpm typecheck`：零错误。
- `pnpm build`：vite 前端构建 + backend 编译成功。
- `pnpm dev` 冒烟测试：应用启动、Chrome 沙箱创建/启动/关闭、CDP 注入、身份证生成正常。
- `pnpm pack`（electron-builder --dir）产出的 win-unpacked 能正常启动（含 better-sqlite3 原生模块解包）。

## 11. 交付物清单

- `tsconfig.json`、`vite.config.ts`、`shared/types.ts`、`renderer/shared/ipc/*.ts`
- 全部 `.js`/`.vue` 的 TS 化文件
- `scripts/build-backend.mjs`、`scripts/sync-preload.mjs`
- `dist-backend/`（构建产物，gitignore）
- 更新后的 `package.json`、`electron-builder.json`、`electron/preload.cjs`（由脚本生成）
