# TypeScript 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Tool Hub（Electron + Vue 3 + Pinia）全量迁移到 TypeScript（strict 模式），前端由 Vite 消费 TS 源码，后端由 esbuild 编译到 `dist-backend/` 供 Electron 加载。

**Architecture:** 前端（renderer + 3 个工具 renderer + 组件）原地重命名 `.js → .ts` / `.vue` 脚本改 `lang="ts"`，Vite 直接编译；后端（electron + 两个工具 backend）原地重命名后由 esbuild 逐文件编译为 CJS 到 `dist-backend/`（保目录结构），`package.json` 的 `main` 指向编译产物。IPC 边界通过 `shared/types.ts` 类型化，preload 保持 CJS 但通道键由脚本从编译产物同步生成。验收：`pnpm typecheck` 零错误 + `pnpm build` + `pnpm dev` 冒烟测试。

**Tech Stack:** TypeScript 5.x、esbuild、Vite 8（`esbuild` 转译 TS，无需 vue-tsc）、Electron 41、Vue 3.5、Pinia 3、better-sqlite3、ws、Element Plus。

## Global Constraints

- 类型严格度：所有 tsconfig 使用 `strict: true`。
- 迁移方式：**原地重命名**，不改变目录结构、模块边界、导出名称、IPC 通道名、数据库 schema、CLI 脚本名。
- 后端模块格式：保持 **ESM**（package.json `"type": "module"`）；esbuild 输出 CJS（`format: "cjs"`）供 Electron 加载；import 说明符在编译后自动解析，源码统一写 `./x.js`。
- `__dirname` / `import.meta.url`：后端源码统一用 `new URL('./x', import.meta.url)` 计算路径，禁止 `fileURLToPath`。
- 文档与代码注释保持中文（项目现状）。
- `.gitignore` 追加 `dist-backend/`。
- 错误处理：迁移不改变现有 throw/catch 行为；仅让类型变严格。
- 命令：`pnpm typecheck`（tsc --noEmit）、`pnpm build:backend`、`pnpm build`、`pnpm dev`、`pnpm pack`。

---

### Task 1: 安装工具链 + tsconfig 基座

**Files:**
- Modify: `package.json`（devDependencies）
- Modify: `.gitignore`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`（由 `vite.config.js` 改）

**Interfaces:**
- Consumes: 无
- Produces: 两个 tsconfig；`scripts` 中的 `typecheck` / `build:backend`；vite 别名不变（`@renderer`/`@tools`/`@shared`）

- [ ] **Step 1: 安装依赖**

Run:
```bash
pnpm add -D typescript esbuild @types/node @types/better-sqlite3 @types/ws
```
预期：三个 @types 包 + typescript + esbuild 进入 devDependencies。

- [ ] **Step 2: 更新 package.json scripts 与 main**

将 `"main": "electron/main.js"` 改为 `"main": "dist-backend/electron/main.js"`，scripts 改为：

```json
"scripts": {
  "typecheck": "tsc --noEmit && tsc -p tsconfig.node.json --noEmit",
  "build:backend": "node scripts/build-backend.mjs",
  "dev": "pnpm run build:backend && concurrently -k \"vite\" \"wait-on tcp:5173 && cross-env NODE_ENV=development electron . --remote-debugging-port=0\"",
  "build": "pnpm run build:backend && vite build",
  "start": "electron . --remote-debugging-port=0",
  "postinstall": "electron-builder install-app-deps",
  "pack": "pnpm run build && electron-builder --dir",
  "dist": "pnpm run build && electron-builder",
  "sync:preload": "node scripts/sync-preload.mjs"
}
```

- [ ] **Step 3: 写 tsconfig.json（前端 + 共享类型检查）**

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
    "verbatimModuleSyntax": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": [],
    "baseUrl": ".",
    "paths": {
      "@renderer/*": ["renderer/*"],
      "@tools/*": ["tools/*"],
      "@shared/*": ["shared/*"]
    },
    "lib": ["ES2022", "DOM", "DOM.Iterable"]
  },
  "include": ["renderer", "tools/**/renderer", "shared", "vite.config.ts"]
}
```

- [ ] **Step 4: 写 tsconfig.node.json（后端类型检查）**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "types": ["node"],
    "lib": ["ES2022"]
  },
  "include": ["electron", "tools/**/backend", "scripts"]
}
```

- [ ] **Step 6: 改 vite.config.ts + index.html**

`vite.config.js` 重命名为 `vite.config.ts`，内容不变（esbuild 自动转译）。

`renderer/index.html` 的 `<script type="module" src="/main.js">` 改为 `src="/main.ts"`（Vite 会解析 TS 入口）。

- [ ] **Step 7: .gitignore 追加 dist-backend/**

在 `dist/` 后追加一行 `dist-backend/`。

- [ ] **Step 8: 验证**

Run: `pnpm typecheck`
预期：通过（当前还是纯 JS，tsc 只检查可推断的；allowJs 未开，TS 文件尚不存在则无输出）。若 `scripts/sync-ipc-channels.js` 报错（`tsconfig.node.json` 已 include scripts），记录后忽略——Task 3 会重建该脚本。

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsconfig.node.json vite.config.ts .gitignore renderer/index.html
git commit -m "build: add TypeScript toolchain and tsconfig base"
```

---

### Task 2: 共享类型 + IPC 类型化封装

**Files:**
- Create: `shared/types.ts`
- Create: `renderer/shared/ipc/types.ts`
- Create: `renderer/shared/ipc/useIpc.ts`
- Create: `renderer/shared/ipc/useCdpIpc.ts`
- Delete: `renderer/shared/composables/useIpc.js`
- Delete: `renderer/shared/composables/useCdpIpc.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `shared/types.ts` 导出：`SandboxStatus`、`Sandbox`、`SandboxMetadata`、`LaunchOptions`、`SandboxCreatePayload`、`SandboxUpdatePayload`、`Fingerprint`、`FingerprintCreatePayload`、`FingerprintUpdatePayload`、`AppConfig`、`AppConfigUpdate`、`SetupState`、`CdpProfile`、`CdpScript`、`CdpDefaults`、`CdpRunningState`、`CdpTarget`、`CdpLaunchResult`、`CdpBatchResult`、`IpcChannelMap`
  - `renderer/shared/ipc/useIpc.ts` 导出：`getChromeSandboxApi(): Window['chromeSandbox']`、`ipcChannels()`、`invokeIpc`、`onIpc`
  - `renderer/shared/ipc/useCdpIpc.ts` 导出：`getCdpInjectorApi()`、`cdpIpcChannels()`、`invokeCdpIpc`、`onCdpIpc`

- [ ] **Step 1: 写 shared/types.ts**

类型以现有存储层 `mapRow` 返回值与入参为基准：

```ts
export type SandboxStatus = 'running' | 'stopped';

export interface LaunchOptions {
  disableSafetyChecks?: boolean;
  disableCors?: boolean;
  customArgs?: string;
}

export interface SandboxMetadata {
  inheritExtensions?: boolean;
  launchOptions?: LaunchOptions;
  developerModeEnabled?: boolean;
}

export interface Sandbox {
  id: string;
  name: string;
  category: string | null;
  color: string | null;
  userDataPath: string;
  chromePid: number | null;
  status: SandboxStatus;
  fingerprintId: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  lastActiveAt: string | null;
  metadata: SandboxMetadata | null;
}

export interface SandboxCreatePayload {
  name: string;
  fingerprintData?: Fingerprint | null;
  inheritExtensions?: boolean;
  launchOptions?: LaunchOptions;
}

export interface SandboxUpdatePayload {
  name?: string;
  category?: string;
  color?: string;
  chromePid?: number | null;
  status?: SandboxStatus;
  fingerprintId?: string | null;
  lastUsedAt?: string | null;
  lastActiveAt?: string | null;
  metadata?: SandboxMetadata | null;
}

export interface FingerprintNavigator {
  userAgent: string;
  platform: string;
  language: string;
  hardwareConcurrency: number;
  deviceMemory: number;
}

export interface Fingerprint {
  id: string;
  navigator: FingerprintNavigator;
  canvas: { noiseLevel: 'low' | 'medium' | 'high'; noiseSeed: number };
  webgl: { vendor: string; renderer: string };
  screen: { width: number; height: number; colorDepth: number; devicePixelRatio: number };
  audio: { noiseEnabled: boolean; noiseLevel: number };
  timezone: { offset: number; name: string };
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type FingerprintCreatePayload = Omit<Fingerprint, 'createdAt' | 'updatedAt'>;
export type FingerprintUpdatePayload = Partial<Omit<Fingerprint, 'id'>>;

export interface AppConfig {
  chromePath: string;
  defaultProfile: string;
  dataDirectory: string;
  autoRestoreOnStartup: boolean;
  preserveDataOnClose: boolean;
}

export interface AppConfigUpdate {
  chromePath?: string;
  defaultProfile?: string;
  dataDirectory?: string;
  autoRestoreOnStartup?: boolean;
  preserveDataOnClose?: boolean;
}

export interface SetupState extends AppConfig {
  dataDirectoryConfigured: boolean;
  dataDirectoryChanged?: boolean;
}

export interface CdpProfile {
  id?: string;
  name: string;
  executable: string;
  args?: string;
  debugPort: number;
  scriptId: string;
  startupDelayMs?: number;
}

export interface CdpScript {
  id?: string;
  name: string;
  description?: string;
  content: string;
}

export interface CdpDefaults {
  startupDelayMs: number;
  pollIntervalMs: number;
  cdpTimeoutMs: number;
}

export interface CdpRunningState {
  profileId: string;
  name: string;
  port: number;
  pid?: number;
  status: 'launching' | 'waiting' | 'connecting' | 'running' | 'error' | 'stopped';
  message: string;
  targetCount?: number;
  updatedAt: number;
}

export interface CdpTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  parentId: string | null;
  devToolsUrl: string;
}

export interface CdpLaunchResult {
  profileId: string;
  ok: boolean;
  state?: CdpRunningState;
  error?: string;
}
```

- [ ] **Step 2: 写 renderer/shared/ipc/types.ts**

```ts
import type { AppConfig, SetupState, Sandbox, SandboxCreatePayload, SandboxUpdatePayload, Fingerprint, FingerprintCreatePayload, FingerprintUpdatePayload, CdpProfile, CdpScript, CdpRunningState, CdpTarget, CdpLaunchResult } from '../../../shared/types';

export interface IpcInvokeApi {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, callback: (payload: unknown) => void): () => void;
  channels: Record<string, string>;
}

declare global {
  interface Window {
    chromeSandbox: IpcInvokeApi;
    cdpInjector: IpcInvokeApi;
  }
}

export {};
```

- [ ] **Step 3: 写 renderer/shared/ipc/useIpc.ts**

```ts
import type { AppConfig, SetupState, Sandbox, SandboxCreatePayload, SandboxUpdatePayload, Fingerprint, FingerprintCreatePayload, FingerprintUpdatePayload } from '../../../shared/types';
import type { IpcInvokeApi } from './types';

export function getChromeSandboxApi(): IpcInvokeApi {
  const api = window.chromeSandbox;
  if (!api) {
    throw new Error('未检测到 Electron IPC，请通过 pnpm dev 或 pnpm start 启动 Tool Hub');
  }
  return api;
}

export function ipcChannels() {
  return getChromeSandboxApi().channels;
}

export function invokeIpc<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return getChromeSandboxApi().invoke(channel, ...args) as Promise<T>;
}

export function onIpc<T = unknown>(channel: string, callback: (payload: T) => void): () => void {
  return getChromeSandboxApi().on(channel, callback as (payload: unknown) => void);
}

/** 类型化调用：按通道返回已知负载类型。用法：await typedInvoke(channels.SANDBOX_GET_ALL) 返回 Sandbox[]。 */
export async function sandboxGetAll(): Promise<Sandbox[]> {
  return invokeIpc<Sandbox[]>(ipcChannels().SANDBOX_GET_ALL);
}
export async function sandboxCreate(payload: SandboxCreatePayload): Promise<Sandbox> {
  return invokeIpc<Sandbox>(ipcChannels().SANDBOX_CREATE, payload);
}
export async function sandboxActivate(id: string): Promise<Sandbox> {
  return invokeIpc<Sandbox>(ipcChannels().SANDBOX_ACTIVATE, id);
}
export async function sandboxClose(id: string): Promise<Sandbox> {
  return invokeIpc<Sandbox>(ipcChannels().SANDBOX_CLOSE, id);
}
export async function sandboxDelete(id: string): Promise<boolean> {
  return invokeIpc<boolean>(ipcChannels().SANDBOX_DELETE, id);
}
export async function sandboxUpdate(id: string, payload: SandboxUpdatePayload): Promise<Sandbox> {
  return invokeIpc<Sandbox>(ipcChannels().SANDBOX_UPDATE, id, payload);
}
export async function fingerprintGenerateRandom(): Promise<Fingerprint> {
  return invokeIpc<Fingerprint>(ipcChannels().FINGERPRINT_GENERATE_RANDOM);
}
export async function fingerprintGetById(id: string): Promise<Fingerprint | null> {
  return invokeIpc<Fingerprint | null>(ipcChannels().FINGERPRINT_GET_BY_ID, id);
}
export async function fingerprintUpdate(id: string, payload: FingerprintUpdatePayload): Promise<Fingerprint> {
  return invokeIpc<Fingerprint>(ipcChannels().FINGERPRINT_UPDATE, id, payload);
}
export async function configGet(): Promise<SetupState> {
  return invokeIpc<SetupState>(ipcChannels().CONFIG_GET);
}
export async function configUpdate(payload: AppConfig): Promise<SetupState> {
  return invokeIpc<SetupState>(ipcChannels().CONFIG_UPDATE, payload);
}
export async function selectDataDirectory(): Promise<string | null> {
  return invokeIpc<string | null>(ipcChannels().CONFIG_SELECT_DATA_DIRECTORY);
}
```

- [ ] **Step 4: 写 renderer/shared/ipc/useCdpIpc.ts**

```ts
import type { CdpProfile, CdpScript, CdpRunningState, CdpTarget, CdpLaunchResult } from '../../../shared/types';
import type { IpcInvokeApi } from './types';

export function getCdpInjectorApi(): IpcInvokeApi {
  const api = window.cdpInjector;
  if (!api) {
    throw new Error('未检测到 CDP 注入 IPC，请通过 pnpm dev 或 pnpm start 启动 Tool Hub');
  }
  return api;
}

export function cdpIpcChannels() {
  return getCdpInjectorApi().channels;
}

export function invokeCdpIpc<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return getCdpInjectorApi().invoke(channel, ...args) as Promise<T>;
}

export function onCdpIpc<T = unknown>(channel: string, callback: (payload: T) => void): () => void {
  return getCdpInjectorApi().on(channel, callback as (payload: unknown) => void);
}

/** 类型化调用：PROFILE_GET_ALL 返回 { profiles, scripts, defaults } */
export async function cdpProfileGetAll(): Promise<{ profiles: CdpProfile[]; scripts: CdpScript[]; defaults: CdpDefaults }> {
  return invokeCdpIpc(cdpIpcChannels().PROFILE_GET_ALL);
}
export async function cdpSaveProfile(profile: CdpProfile): Promise<CdpProfile | undefined> {
  return invokeCdpIpc(ipcChannels().PROFILE_SAVE, profile);
}
export async function cdpDeleteProfile(id: string): Promise<CdpProfile[]> {
  return invokeCdpIpc(ipcChannels().PROFILE_DELETE, id);
}
export async function cdpSaveScript(script: CdpScript): Promise<CdpScript | undefined> {
  return invokeCdpIpc(ipcChannels().SCRIPT_SAVE, script);
}
export async function cdpDeleteScript(id: string): Promise<CdpScript[]> {
  return invokeCdpIpc(ipcChannels().SCRIPT_DELETE, id);
}
export async function cdpGetRunning(): Promise<CdpRunningState[]> {
  return invokeCdpIpc(ipcChannels().GET_RUNNING);
}
export async function cdpLaunchBatch(ids: string[]): Promise<CdpLaunchResult[]> {
  return invokeCdpIpc(ipcChannels().LAUNCH_BATCH, ids);
}
export async function cdpStop(profileId: string): Promise<boolean> {
  return invokeCdpIpc(ipcChannels().STOP, profileId);
}
export async function cdpStopAll(): Promise<void> {
  return invokeCdpIpc(ipcChannels().STOP_ALL);
}
export async function cdpReinject(profileId: string): Promise<number> {
  return invokeCdpIpc(ipcChannels().REINJECT, profileId);
}
export async function cdpFetchTargets(port: number): Promise<CdpTarget[]> {
  return invokeCdpIpc(ipcChannels().GET_TARGETS, port);
}
export async function cdpOpenDevTools(payload: { devToolsUrl?: string; title?: string; external?: boolean; port?: number }): Promise<boolean> {
  return invokeCdpIpc(ipcChannels().OPEN_DEVTOOLS, payload);
}
```

注意：`cdpProfileGetAll` 中 `CdpDefaults` 需从 `'../../../shared/types'` 导入。

- [ ] **Step 5: 删除旧 composables**

```bash
git rm renderer/shared/composables/useIpc.js renderer/shared/composables/useCdpIpc.js
```

- [ ] **Step 6: 验证类型**

Run: `pnpm typecheck`
预期：由于旧文件被删且尚无调用方，此步应零错误（`useDialogVisible.js`/`useNavigation.js` 暂留，不引用被删文件）。若 TS 对 `verbatimModuleSyntax` 报本文件类型导入误用，修正 import 写法。

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts renderer/shared/ipc package.json tsconfig.json
git commit -m "feat: add shared types and typed IPC wrappers"
```

---

### Task 3: 后端构建链（build-backend + sync-preload + electron 入口）

**Files:**
- Delete: `scripts/sync-ipc-channels.js`
- Create: `scripts/build-backend.mjs`
- Create: `scripts/sync-preload.mjs`
- Create: `electron/main.ts`（由 `electron/main.js` 改）

**Interfaces:**
- Consumes: Task 1 的 scripts/main；`tools/*/backend/ipc/channels.ts`（Task 4 创建，此处脚本按存在处理）
- Produces: `dist-backend/`（electron/main.js + 各 backend JS）；`electron/preload.cjs`（重新生成）

- [ ] **Step 1: 写 scripts/build-backend.mjs**

esbuild 逐文件编译，保持相对目录结构。**不打包（`bundle: false`）**——保留模块间 ESM→CJS 转换与相对路径，用 glob 枚举后端全部 `.ts` 入口，避免遗漏新建文件：

```js
import { build } from 'esbuild';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist-backend');

// 相对 rootDir 的后端源码入口（glob，逐文件编译、保目录结构）
const entryPoints = [
  'electron/main.ts',
  'tools/chrome-sandbox/backend/**/*.ts',
  'tools/cdp-injector/backend/**/*.ts',
];

// 需复制的非 TS 资源（相对 rootDir）
const assets = [
  'tools/chrome-sandbox/backend/chrome/chrome-process-query.ps1',
];

await fs.emptyDir(outDir);

await build({
  entryPoints,
  outdir: outDir,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  bundle: false,
  sourcemap: false,
  outbase: rootDir,
  logLevel: 'info',
  external: ['electron'],
});

for (const asset of assets) {
  const src = path.join(rootDir, asset);
  const dest = path.join(outDir, asset);
  await fs.ensureDir(path.dirname(dest));
  await fs.copy(src, dest);
  if (!(await fs.pathExists(dest))) {
    throw new Error(`资源复制失败: ${asset}`);
  }
}

console.log('✓ backend 编译到 dist-backend/');
```

说明：`bundle: false` 时 esbuild 不会打包第三方依赖，但**会**将源码 ESM import 改写为 CJS require，并输出到与源码相对位置一致的 `dist-backend/` 目录。外部依赖（better-sqlite3、ws、fs-extra、electron 等）保持 `require(...)` 指向 node_modules——打包时 electron-builder 会将其打入 app。`**/*.ts` glob 由 esbuild 原生支持。

- [ ] **Step 2: 写 scripts/sync-preload.mjs**

从编译产物读取通道键，重新生成 `electron/preload.cjs`：

```js
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const channelsDir = path.join(rootDir, 'dist-backend/tools/chrome-sandbox/backend/ipc');
const cdpChannelsDir = path.join(rootDir, 'dist-backend/tools/cdp-injector/backend/ipc');
const preloadPath = path.join(rootDir, 'electron/preload.cjs');

async function extractChannels(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const match = content.match(/const (\w+) = \{([\s\S]*?)\};/);
  if (!match) throw new Error(`无法解析通道常量: ${filePath}`);
  const body = match[2]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n  ');
  return { name: match[1], body };
}

const { body: sandboxChannels } = await extractChannels(path.join(channelsDir, 'channels.js'));
const { body: cdpChannels } = await extractChannels(path.join(cdpChannelsDir, 'channels.js'));

const preloadTemplate = `const { contextBridge, ipcRenderer } = require('electron');

// Auto-generated from dist-backend by scripts/sync-preload.mjs — do not edit by hand.
const IPC_CHANNELS = {
  ${sandboxChannels}
};

const CDP_IPC_CHANNELS = {
  ${cdpChannels}
};

function exposeIpcApi(channels) {
  return {
    invoke(channel, ...args) {
      return ipcRenderer.invoke(channel, ...args);
    },
    on(channel, callback) {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    channels,
  };
}

contextBridge.exposeInMainWorld('chromeSandbox', exposeIpcApi(IPC_CHANNELS));
contextBridge.exposeInMainWorld('cdpInjector', exposeIpcApi(CDP_IPC_CHANNELS));
`;

await fs.writeFile(preloadPath, preloadTemplate);
console.log('✓ electron/preload.cjs 已同步');
```

- [ ] **Step 3: 写 electron/main.ts**

把 `electron/main.js` 原地改名（`git mv electron/main.js electron/main.ts`），头部适配：

```ts
import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from '../tools/chrome-sandbox/backend/ipc/handlers.js';
import { registerCdpInjectorHandlers } from '../tools/cdp-injector/backend/ipc/handlers.js';
import { injectorService } from '../tools/cdp-injector/backend/services/injector-service.js';
import { getDatabase, closeDatabase } from '../tools/chrome-sandbox/backend/store/database.js';
import { loadDataDirectoryOverride, getDataDirectory } from '../tools/chrome-sandbox/backend/utils/path-helper.js';
import { logger } from '../tools/chrome-sandbox/backend/utils/logger.js';

app.commandLine.appendSwitch('remote-debugging-port', '0');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let backendInitialized = false;

async function initializeBackend() {
  if (backendInitialized) return;
  backendInitialized = true;
  await loadDataDirectoryOverride();
  await fs.ensureDir(getDataDirectory());
  getDatabase();
  registerIpcHandlers();
  registerCdpInjectorHandlers();
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'Tool Hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}
```

保留原文件其余逻辑（`app.whenReady`、`window-all-closed`、`activate`、`before-quit`），仅补类型、删除重复的 `fileURLToPath` 导入。**唯一例外**：本入口文件允许用 `__dirname` 变量（原 JS 即有），因编译产物 `dist-backend/electron/main.js` 中 `import.meta.url` 仍指向该文件所在目录，`preload.cjs` 位于 `dist-backend/electron/` 同目录——相对关系不变。其他后端文件按约束统一用 `fileURLToPath(new URL(...))`。

- [ ] **Step 4: 删除旧脚本**

```bash
git rm scripts/sync-ipc-channels.js
```

- [ ] **Step 5: 验证构建链**

Run:
```bash
pnpm run build:backend
```
预期：esbuild 编译成功，`dist-backend/electron/main.js`、`dist-backend/tools/.../handlers.js` 等存在，`chrome-process-query.ps1` 已复制。

Run: `node scripts/sync-preload.mjs`
预期：`electron/preload.cjs` 重新生成，含两个通道常量对象。

- [ ] **Step 6: Commit**

```bash
git add scripts electron/main.ts electron/preload.cjs
git commit -m "build: add esbuild backend build and preload sync; convert electron entry to TS"
```

---

### Task 4: Chrome 沙箱后端 TS 化（constants/utils/store/fingerprint/profile/chrome）

**Files:**
- Rename: `tools/chrome-sandbox/backend/constants/sandbox.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/utils/logger.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/utils/file-ops.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/utils/path-helper.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/store/database.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/store/config-store.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/store/config-setup.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/store/sandbox-store.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/store/fingerprint-store.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/fingerprint/generator.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/fingerprint/config-writer.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/profile/cloner.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/chrome/detector.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/chrome/launcher.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/chrome/window-controller.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/chrome/developer-mode.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/chrome/process-manager.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/ipc/channels.js` → `.ts`
- Rename: `tools/chrome-sandbox/backend/services/sandbox-service.js` → `.ts`

**Interfaces:**
- Consumes: `shared/types.ts` 类型；Task 3 的 build-backend（channels 是入口）
- Produces: 各模块类型化导出；`sandbox-store.ts` 行映射类型 `SandboxRow`；`fingerprint-store.ts` 行映射类型 `FingerprintRow`；`config-store.ts` 的 `DEFAULTS`

- [ ] **Step 1: 全局重命名**

Run:
```bash
for f in \
  tools/chrome-sandbox/backend/constants/sandbox.js \
  tools/chrome-sandbox/backend/utils/logger.js \
  tools/chrome-sandbox/backend/utils/file-ops.js \
  tools/chrome-sandbox/backend/utils/path-helper.js \
  tools/chrome-sandbox/backend/store/database.js \
  tools/chrome-sandbox/backend/store/config-store.js \
  tools/chrome-sandbox/backend/store/config-setup.js \
  tools/chrome-sandbox/backend/store/sandbox-store.js \
  tools/chrome-sandbox/backend/store/fingerprint-store.js \
  tools/chrome-sandbox/backend/fingerprint/generator.js \
  tools/chrome-sandbox/backend/fingerprint/config-writer.js \
  tools/chrome-sandbox/backend/profile/cloner.js \
  tools/chrome-sandbox/backend/chrome/detector.js \
  tools/chrome-sandbox/backend/chrome/launcher.js \
  tools/chrome-sandbox/backend/chrome/window-controller.js \
  tools/chrome-sandbox/backend/chrome/developer-mode.js \
  tools/chrome-sandbox/backend/chrome/process-manager.js \
  tools/chrome-sandbox/backend/ipc/channels.js \
  tools/chrome-sandbox/backend/services/sandbox-service.js \
; do git mv "$f" "${f%.js}.ts"; done
```
确认 git 识别到所有 rename。

- [ ] **Step 2: import 说明符加 `.js` 后缀**

对上述全部 `.ts` 文件执行：所有 `from './x.js'`、`from '../x.js'` 保留（已经是 `.js` 的说明符恰好匹配编译后 ESM→CJS 产物，esbuild 会解析到同目录 `.js` 产物）。检查是否有写成 `./x`（无后缀）的，一律改为 `./x.js`。

- [ ] **Step 3: 类型化 store 层**

- `database.ts`：`getDatabase(): Database.Database`（`import Database from 'better-sqlite3'`，`let db: Database.Database | null = null`）。
- `sandbox-store.ts`：
  ```ts
  import type { Sandbox, SandboxStatus, SandboxMetadata, SandboxUpdatePayload } from '../../../../shared/types.js';
  interface SandboxRow { id: string; name: string; category: string | null; color: string | null; user_data_path: string; chrome_pid: number | null; status: SandboxStatus; fingerprint_id: string | null; created_at: string; last_used_at: string | null; last_active_at: string | null; metadata: string | null; }
  function mapRow(row: SandboxRow | undefined): Sandbox | null { ... }
  ```
  `update(id: string, data: SandboxUpdatePayload): Sandbox | null`；`create(data: { id: string; name: string; category?: string; color?: string; userDataPath: string; fingerprintId: string | null; metadata?: SandboxMetadata | null }): Sandbox | null`。
- `fingerprint-store.ts`：定义 `FingerprintRow` 行接口；`mapRow`、`create`、`update` 使用 `Fingerprint` / `FingerprintCreatePayload` / `FingerprintUpdatePayload`。
- `config-store.ts`：`DEFAULTS: AppConfig`；`getAll(): AppConfig`；`get<T = unknown>(key: string): T`；`update(data: AppConfigUpdate): AppConfig`。
- `config-setup.ts`：`withSetupState(config: AppConfig, extra: Record<string, unknown> = {}): Promise<SetupState>`。

- [ ] **Step 4: 类型化 path-helper / logger / file-ops**

- `path-helper.ts`：路径计算用 `fileURLToPath(new URL(import.meta.url))` 得到本文件真实目录（编译产物 `dist-backend/...` 中仍解析到产物所在目录，dev 下 `APP_ROOT_DEV` 上溯 4 级到项目根逻辑不变）。`getChromePaths()` 返回 `{ userDataRoot: string; defaultProfile: string; executables: string[] }`；所有函数补返回类型。
- `logger.ts`：`logger` 方法 `(message: string, meta?: Record<string, unknown>) => void`。
- `file-ops.ts`：`readJsonFile<T = unknown>(filePath: string, fallback: T | null = null): Promise<T | null>`；其余函数补参数/返回类型。

- [ ] **Step 5: 类型化 fingerprint / profile / chrome**

- `generator.ts`：`generateRandomFingerprint(): Fingerprint`（用 `FingerprintCreatePayload` 形状，`id: uuid`）。
- `config-writer.ts`：`updateFingerprintConfig(targetPath: string, fingerprint: Fingerprint): Promise<void>`；`prepareFingerprintExtension` 同。
- `cloner.ts`：`cloneProfile`/`initSandboxUserData`/`repairSandboxProfile` 补类型。
- `detector.ts`：`detectChromePath(): Promise<string>`。
- `launcher.ts`：`launchChrome(options: LaunchChromeOptions): Promise<{ pid: number; debugPort: number | null }>`，定义 `LaunchChromeOptions`。
- `window-controller.ts`：`focusChromeWindow(pid: number): Promise<boolean>`。
- `developer-mode.ts`：`setupSandboxDeveloperMode(debugPort: number, windowBounds: { x: number; y: number; width: number; height: number }): Promise<boolean>`；`shouldSkipDeveloperModeSetup(sandbox: Sandbox): Promise<boolean>`；`getFreePort(): Promise<number>`。
- `process-manager.ts`：`WINDOWS_QUERY_SCRIPT` 改为 `fileURLToPath(new URL('./chrome-process-query.ps1', import.meta.url))`；`registerProcess(sandboxId: string, childProcess: import('child_process').ChildProcess, userDataDir: string)`；`onProcessExit(handler: (sandboxId: string) => void)`；`queryChromeSandboxProcesses(userDataDir: string): Promise<{ pids: number[] }>`；`killProcess(sandboxId: string, userDataDir?: string | null): Promise<boolean>`；`isRunning(sandboxId: string, userDataDir?: string | null, opts?: { allowProcessQuery?: boolean }): boolean`；`findRunningPid(sandboxId: string, userDataDir?: string | null): number | null`；`invalidateChromeProcessCache(userDataDir?: string): void`。顶部 `fileURLToPath(new URL(import.meta.url))` 计算 `__dirname`（或直接用变量名 `scriptDir`），保持与现文件一致的 `WINDOWS_QUERY_SCRIPT` 位置。

- [ ] **Step 6: 类型化 channels.ts**

```ts
export const IPC_CHANNELS = {
  SANDBOX_CREATE: 'sandbox:create',
  // ... 其余键保持与现文件一致
} as const;
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
```

- [ ] **Step 7: 类型化 sandbox-service.ts**

```ts
import type { Sandbox, SandboxCreatePayload, SandboxMetadata, Fingerprint, LaunchOptions } from '../../../../shared/types.js';
import { IPC_CHANNELS } from '../ipc/channels.js';
let statusEmitter: ((channel: string, payload: unknown) => void) | null = null;
export function setStatusEmitter(emitter: (channel: string, payload: unknown) => void): void { ... }
```
`create(data: SandboxCreatePayload): Promise<Sandbox>`；`activate(sandboxId: string): Promise<Sandbox | null>`；`update(sandboxId: string, data: SandboxUpdatePayload): Sandbox | null`；`getAll/getById/close/delete/refreshStatus` 同理。`updateSandboxFingerprint(sandboxId: string, fingerprintData: FingerprintUpdatePayload): Promise<Fingerprint | null>`。`setStatusEmitter` 由 `handlers.ts` 注入，其类型应与 Task 4 定义一致（`(channel: string, payload: unknown) => void`）。

- [ ] **Step 8: 验证**

Run: `pnpm run build:backend`
预期：esbuild 编译全部 backend 文件到 `dist-backend/`（含 main.ts），`.ps1` 复制成功。

Run: `pnpm typecheck`
预期：`tsconfig.node.json` 覆盖的 backend 文件零错误。

- [ ] **Step 9: Commit**

```bash
git add tools/chrome-sandbox/backend
git commit -m "refactor(chrome-sandbox): convert backend to TypeScript"
```

---

### Task 5: Chrome 沙箱后端 IPC handlers TS 化

**Files:**
- Rename: `tools/chrome-sandbox/backend/ipc/handlers.js` → `.ts`

**Interfaces:**
- Consumes: Task 4 的 channels/service/store 导出
- Produces: `registerIpcHandlers(): void`（类型化 handle 回调）

- [ ] **Step 1: 重命名并类型化**

```bash
git mv tools/chrome-sandbox/backend/ipc/handlers.js tools/chrome-sandbox/backend/ipc/handlers.ts
```

handler 回调加类型：
```ts
import type { SandboxCreatePayload, SandboxUpdatePayload, AppConfigUpdate, FingerprintUpdatePayload } from '../../../../shared/types.js';
ipcMain.handle(IPC_CHANNELS.SANDBOX_CREATE, async (_event, data: SandboxCreatePayload) => { ... });
ipcMain.handle(IPC_CHANNELS.SANDBOX_UPDATE, (_event, sandboxId: string, data: SandboxUpdatePayload) => sandboxService.update(sandboxId, data));
ipcMain.handle(IPC_CHANNELS.FINGERPRINT_UPDATE, (_event, sandboxId: string, data: FingerprintUpdatePayload) => updateSandboxFingerprint(sandboxId, data));
ipcMain.handle(IPC_CHANNELS.CONFIG_UPDATE, async (_event, data: AppConfigUpdate) => { ... });
```
`broadcast(channel: string, payload: unknown): void`；`registerIpcHandlers(): void`。

- [ ] **Step 2: 验证**

Run: `pnpm run build:backend` 与 `pnpm typecheck`
预期：均通过。

- [ ] **Step 3: Commit**

```bash
git add tools/chrome-sandbox/backend/ipc/handlers.ts
git commit -m "refactor(chrome-sandbox): type IPC handlers"
```

---

### Task 6: CDP 注入工具后端 TS 化

**Files:**
- Rename: `tools/cdp-injector/backend/ipc/channels.js` → `.ts`
- Rename: `tools/cdp-injector/backend/ipc/handlers.js` → `.ts`
- Rename: `tools/cdp-injector/backend/store/config-store.js` → `.ts`
- Rename: `tools/cdp-injector/backend/services/cdp-client.js` → `.ts`
- Rename: `tools/cdp-injector/backend/services/devtools-service.js` → `.ts`
- Rename: `tools/cdp-injector/backend/services/injector-service.js` → `.ts`
- Rename: `tools/cdp-injector/backend/services/launcher-service.js` → `.ts`
- Rename: `tools/cdp-injector/backend/utils/resolve-executable.js` → `.ts`
- Rename: `tools/cdp-injector/backend/utils/sleep.js` → `.ts`

**Interfaces:**
- Consumes: `shared/types.ts`；`chrome-sandbox/backend/utils/logger`、`path-helper`
- Produces: 各模块类型化导出；`CdpInjectionSession` 类完整类型；`processLauncher` 单例类型

- [ ] **Step 1: 重命名并统一 import 后缀**

```bash
for f in \
  tools/cdp-injector/backend/ipc/channels.js \
  tools/cdp-injector/backend/ipc/handlers.js \
  tools/cdp-injector/backend/store/config-store.js \
  tools/cdp-injector/backend/services/cdp-client.js \
  tools/cdp-injector/backend/services/devtools-service.js \
  tools/cdp-injector/backend/services/injector-service.js \
  tools/cdp-injector/backend/services/launcher-service.js \
  tools/cdp-injector/backend/utils/resolve-executable.js \
  tools/cdp-injector/backend/utils/sleep.js \
; do git mv "$f" "${f%.js}.ts"; done
```
所有 `from './x.js'` / `from '../x.js'` 说明符保留，确认无缺后缀。

- [ ] **Step 2: 类型化 channels / config-store / 工具**

- `channels.ts`：`as const` + 导出 `CdpIpcChannel` 联合类型。
- `config-store.ts`：
  ```ts
  import type { CdpProfile, CdpScript, CdpDefaults } from '../../../../shared/types.js';
  interface CdpConfig { profiles: CdpProfile[]; scripts: CdpScript[]; defaults: CdpDefaults; }
  ```
  `saveProfile(profile: CdpProfile): Promise<CdpProfile | undefined>`；`saveScript(script: CdpScript): Promise<CdpScript | undefined>`；其余方法补类型。
- `sleep.ts`：`export function sleep(ms: number): Promise<void>`。
- `resolve-executable.ts`：`resolveExecutablePath(executablePath: string): Promise<string>`。

- [ ] **Step 3: 类型化 cdp-client.ts**

```ts
import WebSocket from 'ws';
import type { CdpTarget } from '../../../../shared/types.js';
export function buildDevToolsUrl(webSocketDebuggerUrl: string, port: number): string
export function isAllowedDevToolsUrl(url: string): boolean
export async function listPageTargets(port: number): Promise<CdpTarget[]>
export async function waitForCdpPort(port: number, timeoutMs?: number): Promise<CdpTarget[]>
export async function injectOnce(port: number, scriptSource: string): Promise<number>

interface CdpTargetRaw {
  id: string; title?: string; url?: string; type: string; parentId?: string | null;
  devtoolsFrontendUrl?: string; webSocketDebuggerUrl?: string;
}
type CdpCaller = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;

interface CdpInjectionSessionOptions {
  port: number; scriptSource: string; pollIntervalMs?: number;
  onTargetsInjected?: (info: { count: number; total: number }) => void;
}
interface TargetState { url: string; scriptIdentifier: string }

export class CdpInjectionSession {
  port: number; scriptSource: string; pollIntervalMs: number;
  onTargetsInjected?: (info: { count: number; total: number }) => void;
  private targetState = new Map<string, TargetState>();
  private stopped = false; paused = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private injecting = false;
  get injectedTargetCount(): number
  async pause(): Promise<void>
  resume(): void
  async start(): Promise<void>
  async stop(): Promise<void>
  private pruneInactiveTargets(activeIds: Set<string>): void
  private async injectIntoTarget(target: CdpTargetRaw, opts?: { force?: boolean }): Promise<boolean>
  setScriptSource(scriptSource: string): void
  async scanAndInject(): Promise<number>
  async reinjectAll(): Promise<number>
}
```
`createCdpCaller` 返回的 call 函数 `message`/`message.error`/`message.result` 以 `Record<string, unknown>` 收窄。`fetchTargets` 返回 `CdpTargetRaw[]`。

- [ ] **Step 4: 类型化 injector-service / launcher-service / devtools-service / handlers**

- `injector-service.ts`：`sessions: Map<string, CdpInjectionSession>`；`runningState: Map<string, CdpRunningState>`；`setCdpStatusEmitter(emitter: (payload: { running: CdpRunningState[] }) => void)`；`setState`/`clearState` 补类型；`launchProfile(profileId: string): Promise<CdpRunningState>`；`launchBatch(profileIds: string[]): Promise<CdpBatchResult[]>`；`stopProfile`/`reinjectProfile`/`pauseByPort(port: number)`/`resumeByPort(port: number)`。
- `launcher-service.ts`：类属性 `private processes = new Map<string, { pid: number; child: import('child_process').ChildProcess }>()`；`launch(profileId: string, executable: string, argsString: string, debugPort: number): Promise<{ pid: number; args: string[] }>`；`parseArgs(argsString: string): string[]`。
- `devtools-service.ts`：`devtoolsWindows: Map<string, BrowserWindow>`；`pauseCountByPort: Map<number, number>`；`extractPortFromDevToolsUrl(devToolsUrl: string): number | null`；`openDevToolsWindow(devToolsUrl: string, title?: string): Promise<{ reused: boolean }>`；`openDevToolsIndex(port: number, title?: string): Promise<{ reused: boolean }>`；`openDevToolsExternal(devToolsUrl: string): Promise<void>`；`openDevToolsFromPayload(payload: string | { devToolsUrl?: string; title?: string; external?: boolean; port?: number | null }): Promise<boolean>`。
- `handlers.ts`：handler 回调类型化；`registerCdpInjectorHandlers(): void`。

- [ ] **Step 5: 验证**

Run: `pnpm run build:backend` 与 `pnpm typecheck`
预期：均通过。

- [ ] **Step 6: Commit**

```bash
git add tools/cdp-injector/backend
git commit -m "refactor(cdp-injector): convert backend to TypeScript"
```

---

### Task 7: 工具定义与共享前端模块 TS 化

**Files:**
- Rename: `tools/chrome-sandbox/index.js` → `.ts`
- Rename: `tools/cdp-injector/index.js` → `.ts`
- Rename: `tools/id-card-generator/index.js` → `.ts`
- Rename: `tools/id-card-generator/renderer/shared/generator.js` → `.ts`
- Rename: `tools/id-card-generator/renderer/shared/area-codes.js` → `.ts`
- Rename: `tools/chrome-sandbox/renderer/shared/sandbox.js` → `.ts`
- Rename: `tools/chrome-sandbox/renderer/shared/launchOptions.js` → `.ts`
- Rename: `tools/chrome-sandbox/renderer/composables/useDataDirectoryPicker.js` → `.ts`
- Rename: `renderer/config/tools.js` → `.ts`
- Rename: `renderer/router/routes.js` → `.ts`
- Rename: `renderer/router/index.js` → `.ts`
- Rename: `renderer/main.js` → `.ts`
- Create: `renderer/shims-vue.d.ts`
- Create: `renderer/shared/types/tool.ts`
- Modify: `renderer/shared/components/ToolCard.vue`（脚本类型化）
- Modify: `renderer/App.vue`、`renderer/pages/HomePage.vue`、`renderer/layouts/ToolLayout.vue`（脚本类型化，随 Task 8）

**Interfaces:**
- Consumes: `shared/types.ts`；`renderer/shared/ipc/*`
- Produces: `ToolDefinition` 类型（`renderer/shared/types/tool.ts`）；`toolRegistry`、`getToolById`、`getActiveTools`；`main.ts` 入口

- [ ] **Step 1: 建 ToolDefinition 类型**

Create `renderer/shared/types/tool.ts`：

```ts
import type { RouteRecordRaw } from 'vue-router';

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  color: string;
  disabled?: boolean;
  route: {
    path: string;
    name: string;
    component: unknown;
    meta?: { toolId?: string };
  };
}
```

（`component` 用 `unknown`，避免 vue 组件类型解析依赖；`renderer/config/tools.ts` 中使用 `route.component as never` 或 `RouteRecordRaw` 断言在路由构建处收窄。）

- [ ] **Step 2: 建 renderer/shims-vue.d.ts**

```ts
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
```

- [ ] **Step 3: 改三个工具 index.ts**

`git mv` 每个 `index.js` → `.ts`，导入改为 `import type { ToolDefinition } from '../../renderer/shared/types/tool.js'`（`tools/chrome-sandbox/index.ts` 到 `renderer/shared/types/tool.ts` 的相对路径是 `../../renderer/shared/types/tool.js`；cdp-injector 与 id-card-generator 同理）。导出对象标注 `ToolDefinition`：

```ts
import type { ToolDefinition } from '../../renderer/shared/types/tool.js';
import ChromeSandboxPage from './renderer/pages/ChromeSandbox.vue';

const tool: ToolDefinition = { ... };
export default tool;
```

- [ ] **Step 4: 改 renderer/main.js → main.ts**

`git mv renderer/main.js renderer/main.ts`，内容仅改导入后缀 `.ts`：

```ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import { router } from './router/index.js';
import './shared/styles/main.css';
```

（`index.js` → `index.ts` 后，说明符写 `./router/index.js` 由 Vite 解析到 `index.ts`；或直接写 `./router/index.js` 均可。）

- [ ] **Step 5: 改 renderer/config/tools.ts + router + ToolCard**

- `config/tools.ts`：`import chromeSandbox from '@tools/chrome-sandbox/index.js'`（说明符 `.js` 保留，Vite 解析到 `.ts` 源码）；`export const toolRegistry: ToolDefinition[] = [...]`；`getToolById(id: string): ToolDefinition | undefined`；`getActiveTools(): ToolDefinition[]`。
- `router/routes.ts`：`import type { RouteRecordRaw } from 'vue-router'`；`export const routes: RouteRecordRaw[] = [...]`；组件导入 `.vue` 不变；工具 route 对象用 `route.component as RouteRecordRaw['component']` 收窄或直接展开。
- `router/index.ts`：`router` 导出类型推断。
- `ToolCard.vue`：`<script setup lang="ts">`，`defineProps<{ tool: ToolDefinition }>()`、`defineEmits<{ click: [] }>()`，导入类型。

- [ ] **Step 6: 共享前端模块 TS 化**

- `generator.ts`：`export const GENDER = { MALE: 'male', FEMALE: 'female', RANDOM: 'random' } as const; export type Gender = (typeof GENDER)[keyof typeof GENDER];`；`export interface IdCardResult { id: string; areaCode: string; areaName: string; birthDate: string; birthDateDisplay: string; gender: Gender; genderLabel: string; }`；`export function generateIdCard(options?: { gender?: Gender; minAge?: number; maxAge?: number }): IdCardResult`。
- `area-codes.ts`：`export const AREA_CODES: Array<{ code: string; name: string }> = [...]`。
- `sandbox.ts`：`import type { SandboxStatus } from '../../../../shared/types.js'`（相对上溯 4 级）；`export function formatSandboxStatus(status: SandboxStatus): string`。
- `launchOptions.ts`：`export interface LaunchOptionsForm { disableSafetyChecks: boolean; disableCors: boolean; enableCustomArgs: boolean; customArgs: string; }`；`LAUNCH_OPTION_FORM_FIELDS: LaunchOptionsForm`；`syncLaunchOptionsForm(form: LaunchOptionsForm, launchOptions?: LaunchOptions | null): void`；`buildLaunchOptionsPayload(form: LaunchOptionsForm): LaunchOptions`；`hasLaunchOptions(metadata: SandboxMetadata | null | undefined): boolean`。类型 `LaunchOptions`、`SandboxMetadata` 从 `shared/types.js` 导入。
- `useDataDirectoryPicker.ts`：改用 `selectDataDirectory` 类型化函数（从 `@renderer/shared/ipc/useIpc.js`），返回 `Promise<string | null>`。

- [ ] **Step 7: 验证**

Run: `pnpm vite build`（前端 TS 编译）
预期：构建通过。`.vue` 组件脚本 TS 报错在 vite 转译下通常不拦截（无类型检查），但若模板编译报错会失败——本步以 vite build 通过为准。

Run: `pnpm typecheck`
预期：`renderer/` 与 `tools/**/renderer` 中非 `.vue` 的 `.ts` 文件零错误（`.vue` 通过 shims 只提供默认导出类型）。若 `App.vue`/`HomePage.vue` 等导入的工具类型报错，属 Task 8 范围，本步以 `.ts` 文件为准。

- [ ] **Step 8: Commit**

```bash
git add tools/*/index.ts tools/*/renderer/shared renderer/config renderer/router renderer/shared/types renderer/shared/components renderer/main.ts renderer/shims-vue.d.ts
git commit -m "refactor: convert tool definitions and shared frontend modules to TS"
```

---

### Task 8: renderer 主应用与共享 composables TS 化

**Files:**
- Modify: `renderer/App.vue`、`renderer/pages/HomePage.vue`、`renderer/layouts/ToolLayout.vue`（`<script setup lang="ts">`，Template 保持）
- Rename: `renderer/shared/composables/useDialogVisible.js` → `.ts`
- Rename: `renderer/shared/composables/useNavigation.js` → `.ts`

**Interfaces:**
- Consumes: Task 2 的 ipc 封装、Task 7 的 tool 类型
- Produces: 各页面/布局类型化

- [ ] **Step 1: 改 useDialogVisible.ts**

```ts
import { computed, type ComputedRef, type Ref } from 'vue';

export function useDialogVisible(
  props: { modelValue: boolean },
  emit: (event: 'update:modelValue', value: boolean) => void,
): ComputedRef<boolean> {
  return computed({
    get: () => props.modelValue,
    set: (value: boolean) => emit('update:modelValue', value),
  });
}
```

- [ ] **Step 2: 改 useNavigation.ts**

```ts
import { useRouter, useRoute } from 'vue-router';
import { computed } from 'vue';

export function useNavigation() {
  const router = useRouter();
  const route = useRoute();
  function goToHome(): void { router.push({ name: 'home' }); }
  function goToTool(toolId: string): void { router.push({ name: `tool-${toolId}` }); }
  function goBack(): void {
    if (route.meta?.toolId) { goToHome(); } else { router.back(); }
  }
  const currentTool = computed(() => (typeof route.meta?.toolId === 'string' ? route.meta.toolId : null));
  const isHome = computed(() => route.name === 'home');
  return { goToHome, goToTool, goBack, currentTool, isHome };
}
```

- [ ] **Step 3: 改 App.vue / HomePage.vue / ToolLayout.vue**

- 每个 `<script setup>` 改为 `<script setup lang="ts">`。
- `App.vue`：`const currentTool = computed(() => (typeof route.meta?.toolId === 'string' ? route.meta.toolId : null));` 导入 `ToolDefinition` 类型用于 `toolRegistry.find`。
- `HomePage.vue`：`function goToTool(toolId: string)`。
- `ToolLayout.vue`：同上 toolId 收窄。

- [ ] **Step 4: 验证**

Run: `pnpm vite build`
预期：构建通过。

Run: `pnpm typecheck`
预期：`.ts` 文件零错误。

- [ ] **Step 5: Commit**

```bash
git add renderer
git commit -m "refactor: convert renderer app shell and shared composables to TS"
```

---

### Task 9: chrome-sandbox 工具前端 TS 化

**Files:**
- Rename: `tools/chrome-sandbox/renderer/stores/sandboxStore.js` → `.ts`
- Modify: `tools/chrome-sandbox/renderer/pages/ChromeSandbox.vue`（`<script setup lang="ts">`，Template 保持）
- Modify: 以下组件（`<script setup lang="ts">`，Template 保持）：`Sidebar.vue`、`StatusPanel.vue`、`CreateDialog.vue`、`SettingsDialog.vue`、`EditDialog.vue`、`FingerprintEditor.vue`、`DataDirectorySetupDialog.vue`、`DataDirectoryField.vue`、`ActionBar.vue`、`SandboxCard.vue`、`LaunchOptionsFields.vue`

**Interfaces:**
- Consumes: Task 2 的 ipc 类型化函数、Task 7 的 launchOptions/sandbox 工具、`shared/types.ts`
- Produces: 类型化 store（`useSandboxStore`）与全部组件 props/emits

- [ ] **Step 1: 改 sandboxStore.ts**

```ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Sandbox, SandboxCreatePayload, SandboxUpdatePayload, Fingerprint } from '../../../../shared/types.js';
import { invokeIpc, ipcChannels } from '@renderer/shared/ipc/useIpc.js';
```
（相对路径：`tools/chrome-sandbox/renderer/stores/` 上溯 4 级到 `shared/`。也可直接用 `@shared` 别名——项目规定工具内部用相对路径，保持相对。）

```ts
export const useSandboxStore = defineStore('chrome-sandbox/sandbox', () => {
  const sandboxes = ref<Sandbox[]>([]);
  const selectedId = ref<string | null>(null);
  const fingerprint = ref<Fingerprint | null>(null);
  const selectedSandbox = computed(() => findSandbox(selectedId.value));
  function findSandbox(id: string | null): Sandbox | null { ... }
  async function loadAll(): Promise<void> { sandboxes.value = await invokeIpc<Sandbox[]>(ipcChannels().SANDBOX_GET_ALL); ... }
  async function create(data: SandboxCreatePayload): Promise<Sandbox> { ... }
  async function update(id: string, data: SandboxUpdatePayload): Promise<void> { ... }
  async function loadFingerprint(sandboxId: string): Promise<void> { ... }
  return { sandboxes, selectedId, selectedSandbox, fingerprint, loadAll, select, create, activate, close, remove, update, loadFingerprint };
});
```

- [ ] **Step 2: 改 ChromeSandbox.vue**

`<script setup lang="ts">`；`const channels = ipcChannels()`；`invokeIpc<SetupState>(channels.CONFIG_GET)`；`onIpc<unknown>` 事件回调保持 `() => store.loadAll()`；错误变量 `catch (error)` 用 `error instanceof Error ? error.message : String(error)` 或 `(error as Error).message`（项目现有写法 `error.message`，转 TS 后需收窄）。

- [ ] **Step 3: 组件逐一类型化**

每个组件 `<script setup lang="ts">`，props 用 `defineProps<T>()`，emits 用 `defineEmits<{ ... }>()`：

- `Sidebar.vue`：`defineProps<{ sandboxes: Sandbox[]; selectedId: string | null }>()`；`defineEmits<{ select: [id: string]; create: []; settings: [] }>()`。
- `StatusPanel.vue`：`defineProps<{ sandbox: Sandbox | null; fingerprint: Fingerprint | null }>()`；emits `['activate','close','delete','edit-fingerprint']`。`inheritExtensions` computed 用 `Boolean(props.sandbox?.metadata?.inheritExtensions)`。
- `CreateDialog.vue`：`defineProps<{ modelValue: boolean }>()`；`defineEmits<{ 'update:modelValue': [value: boolean] }>()`；`form` 类型 `SandboxCreateForm`（`name: string; inheritExtensions: boolean; ...LaunchOptionsForm`）。
- `SettingsDialog.vue`：`defineProps<{ modelValue: boolean }>()`；`form: AppConfig` 类型的 reactive（`Object.assign(form, await invokeIpc<SetupState>(channels.CONFIG_GET))`）。
- `EditDialog.vue`：props `{ modelValue: boolean; sandbox: Sandbox | null }`。
- `FingerprintEditor.vue`：props `{ modelValue: boolean; fingerprint: Fingerprint | null; sandboxId: string | null }`；`local = ref<Fingerprint | null>(null)`。
- `DataDirectorySetupDialog.vue`：props `{ modelValue: boolean }`。
- `DataDirectoryField.vue`：props `{ modelValue: string }`。
- `ActionBar.vue`：props `{ running: boolean }`。
- `SandboxCard.vue`：props `{ sandbox: Sandbox; active: boolean }`。
- `LaunchOptionsFields.vue`：props `{ form: LaunchOptionsForm }`。

store 的 `loadAll` 内部 `findSandbox` 需处理 `selectedId.value` 为 null 的收窄。

- [ ] **Step 4: 验证**

Run: `pnpm vite build`
预期：构建通过。

Run: `pnpm typecheck`
预期：`.ts`（含 store、composables）零错误；`.vue` 不参与 tsc。

- [ ] **Step 5: Commit**

```bash
git add tools/chrome-sandbox/renderer
git commit -m "refactor(chrome-sandbox): convert renderer to TypeScript"
```

---

### Task 10: cdp-injector 与 id-card-generator 工具前端 TS 化

**Files:**
- Rename: `tools/cdp-injector/renderer/stores/cdpInjectorStore.js` → `.ts`
- Modify: `tools/cdp-injector/renderer/pages/CdpInjector.vue`（`<script setup lang="ts">`，Template 保持）
- Modify: `tools/id-card-generator/renderer/pages/IdCardGenerator.vue`（`<script setup lang="ts">`，Template 保持）

**Interfaces:**
- Consumes: Task 2 的 cdp ipc 类型化函数、Task 7 的 generator 类型
- Produces: 类型化 cdp store、两个页面

- [ ] **Step 1: 改 cdpInjectorStore.ts**

```ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CdpProfile, CdpScript, CdpRunningState, CdpTarget, CdpLaunchResult } from '../../../../shared/types.js';
import { cdpProfileGetAll, cdpGetRunning, cdpLaunchBatch, cdpStop, cdpStopAll, cdpReinject, cdpFetchTargets, cdpOpenDevTools, cdpIpcChannels, onCdpIpc, invokeCdpIpc } from '@renderer/shared/ipc/useCdpIpc.js';
```
（相对路径上溯 4 级；store 内 `channels = cdpIpcChannels()`。）
`profiles = ref<CdpProfile[]>([])`；`scripts = ref<CdpScript[]>([])`；`running = ref<CdpRunningState[]>([])`；`load()` 用 `cdpProfileGetAll()` + `cdpGetRunning()`；`bindStatusEvents` 用 `onCdpIpc<{ running: CdpRunningState[] }>`；`saveAndReload` 用 `cdpSaveProfile`/`cdpSaveScript`；`getRunningState(profileId: string): CdpRunningState | undefined`。

- [ ] **Step 2: 改 CdpInjector.vue**

`<script setup lang="ts">`；`selectedIds = ref<string[]>([])`；`targetsCache = reactive<Record<string, CdpTarget[]>>({})`；`targetsLoading = reactive<Record<string, boolean>>({})`；`selectedTargetId = reactive<Record<string, string>>({})`；`profileForm: CdpProfile`（含 `id?: string`）；`scriptForm: CdpScript`；`statusLabel/statusTagType/isRunning` 参数 `profileId: string`；`reportLaunchResults(results: CdpLaunchResult[])`；`openDevToolsForTarget(target: CdpTarget, options?: { external?: boolean })`；`openDevToolsIndex(row: CdpRunningState)`；`onRunningExpandChange(row: CdpRunningState, expandedRows: CdpRunningState[])`。`store.running.map((item) => item.profileId)` 的 watch 收窄为 `(profileIds: string[])`。Element Plus 模板内 `row`/`target` 均为 any（模板类型不强制）。

- [ ] **Step 3: 改 IdCardGenerator.vue**

`<script setup lang="ts">`；`import { generateIdCard, GENDER, type Gender, type IdCardResult } from '../shared/generator.js'`；`gender = ref<Gender>(GENDER.RANDOM)`；`ageRange = ref<[number, number]>([18, 60])`；`result = ref<IdCardResult | null>(null)`；`handleGenerate()` 类型化。

- [ ] **Step 4: 验证**

Run: `pnpm vite build`
预期：构建通过。

Run: `pnpm typecheck`
预期：`.ts` 零错误。

- [ ] **Step 5: Commit**

```bash
git add tools/cdp-injector/renderer tools/id-card-generator/renderer
git commit -m "refactor: convert cdp-injector and id-card-generator renderer to TS"
```

---

### Task 11: 收尾（electron-builder 配置 + 全量验证 + 文档）

**Files:**
- Modify: `electron-builder.json`
- Modify: `README.md`
- Modify: `CLAUDE.md`（新增 TS 相关规范段落）
- Modify: `.gitignore`（若 Task 1 未做）

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 可打包配置；类型检查/构建/冒烟全通过；文档更新

- [ ] **Step 1: electron-builder.json**

`files` 增加 `"dist-backend/**/*"`，其余保留（`tools/**/*` 仍包含 extension 模板、指纹注入等运行时资源）：

```json
"files": [
  "dist-backend/**/*",
  "electron/**/*",
  "tools/**/*",
  "dist/**/*",
  "shared/**/*",
  "package.json"
]
```

- [ ] **Step 2: 一次性全量验证**

Run:
```bash
pnpm typecheck
pnpm build
node scripts/sync-preload.mjs
pnpm dev
```
预期：typecheck 零错误；build 产出 `dist/` + `dist-backend/`；sync-preload 重新生成 `electron/preload.cjs`；dev 正常启动 Electron 窗口。冒烟：主页工具网格显示 3 个工具；进入 Chrome沙箱可创建沙箱（如环境可运行 Chrome）；CDP 注入页能加载配置；身份证生成器可用。**若验证发现错误，修复后重跑整套命令直至全绿**（这是唯一一次验证，之后不再逐步验证）。

在"开发"或"技术栈"部分增加 TypeScript：说明前端 Vite 消费 TS 源码、后端 esbuild 编译到 `dist-backend/`、`pnpm typecheck`、`pnpm build:backend`、`pnpm sync:preload` 命令。

- [ ] **Step 5: 更新 CLAUDE.md**

- 架构图目录增加 `dist-backend/`（构建产物）。
- 增加"TypeScript 规范"小节：
  - 前端（renderer、工具 renderer）：`.ts` + `.vue` 内 `<script setup lang="ts">`，strict 模式。
  - 后端（electron、工具 backend）：`.ts`，esbuild 编译为 CJS 到 `dist-backend/`；import 说明符用 `.js` 后缀；路径计算用 `fileURLToPath(new URL(import.meta.url))`（入口处）或 `new URL(...)`；**不得**使用 `__dirname`/`__filename` 变量（除非显式声明）。
  - IPC 边界：`shared/types.ts` 定义共享类型；前端 `renderer/shared/ipc/*` 提供类型化调用；preload 由 `scripts/sync-preload.mjs` 生成，勿手改。
  - 新工具同样遵守：index.ts 用 `ToolDefinition` 类型。
- 命令表更新：`pnpm dev`（先 build:backend）、`pnpm typecheck`、`pnpm build`（含 build:backend）、`pnpm pack`。

- [ ] **Step 6: 提交**

```bash
git add electron-builder.json README.md CLAUDE.md .gitignore
git commit -m "chore: finalize TS migration config and docs"
```

---

## Self-Review 记录

- **Spec 覆盖**：设计文档各节 → 对应任务：§2 策略 → Task 1/3；§4 共享类型 → Task 2；§5 IPC 封装 → Task 2；§6 各模块 → Task 4-10；§7 配置 → Task 1/3/11；§8 顺序 → 任务序；§9 风险（ps1、build 链）→ Task 3/11；§10 验证 → Task 11。
- **占位符扫描**：无 TBD/TODO；每个步骤含具体代码或命令。
- **类型一致性**：`Sandbox`/`Fingerprint`/`CdpProfile` 等在共享类型中定义并在 store/handler/组件间一致使用；`SandboxCreatePayload`、`SandboxUpdatePayload`、`AppConfigUpdate`、`FingerprintUpdatePayload` 与后端 handler 入参对齐；`CdpRunningState`、`CdpLaunchResult` 与 injector-service/devtools 返回对齐；`useDialogVisible` 的 emit 签名与各 dialog 组件一致。
- **已知取舍**：`.vue` 组件脚本不纳入 `tsc`（无 vue-tsc），以 vite build 转译为准；`ToolDefinition.component` 用 `unknown` 并在路由处收窄；`tsconfig.json` 的 `include` 不含 `.vue`，`allowImportingTsExtensions` 允许源码写 `.ts` 说明符。

