# everydaytool 优化方案

> 基线：`591da25`（2026-11-12）加当日工作区，审计日期 2026-11-14。
> 范围：`electron/`、`backend/`、`shared/`、`renderer/`、`tools/` 下 8 个已注册工具、构建与发布配置。
> 不在范围：`tweb/` 上游源码；正在并行开发、尚未注册的 `tools/media-library/`。

## 0. 怎么读这份文档

每条结论后面带一个证据标记，三种含义不同，修之前请按标记决定要不要先复现：

| 标记 | 含义 |
| --- | --- |
| **实测** | 跑了命令并看到结果（构建产物、检查脚本、依赖统计、全仓检索） |
| **已读码** | 打开了对应文件的对应行，缺陷在代码里直接可见；没有在应用里跑过 |
| **待复核** | 来自分工具的并行审计，带文件与行号，但这些行没有二次打开核对。动手前先读一遍或复现 |

本次**没有做**的事：没有启动应用，没有测启动耗时，没有重新构建（并行会话正在改 `package.json` 和锁文件），没有在 macOS / Linux 上验证，没有执行 `docker load`。凡依赖这些的结论都写成了"预期"并给出验证办法。

优先级：**P0** 功能失效或数据丢失；**P1** 发布、工程基线与稳定性；**P2** 安全加固与性能；**P3** 可维护性。
工作量是估算：**S** 半天内，**M** 1–2 天，**L** 3 天以上。

---

## 1. 结论

1. **有 6 处用户可见的功能失效或数据丢失风险**，都能在半天到一天内修掉，应该最先做（第 4 节）。其中技能管理器的禁用回滚会永久删除技能目录。
2. **安装包里绝大部分是用不到的构建依赖。** 上一次打出的安装包中，asar 内容 100.56 MB，其中 98.48 MB 是 `node_modules`，应用自身代码只有 2.09 MB。主进程运行时真正需要的第三方包只有 `node-forge` 和 `ws`。改一处 `package.json` 即可解决（REL-1）。
3. **没有任何合并前的自动检查。** 仓库只有一条手动触发的发布流水线，它不跑 lint、类型检查和测试。当前 `pnpm lint` 和 `pnpm test:skill-manager` 在本机都是红的（CI-1 ~ CI-3）。
4. **发布形态与声明不一致**：流水线会打 Linux 包，但没有一个工具声明支持 Linux；Telegram 缓存工具依赖的 `tweb/dist` 不进安装包。这两项需要先做产品决定（第 3 节）。
5. **安装版出问题时无从排查**：日志只写控制台，没有落盘，也没有全局异常兜底（PLAT-1）。
6. 类型检查通过，目录边界、IPC 来源校验、数据分层、webview 加固这些基础做得扎实，不需要推翻重来（第 11 节）。

---

## 2. 现状体检

以下数字均为**实测**。

### 2.1 规模

| 项目 | 数值 |
| --- | --- |
| 受版本控制的源码（ts / vue / mjs / scss / js / py） | 350 个文件，61,551 行 |
| 最大的工具 | `skill-manager`，61 个文件 |
| 测试文件 | 13 个，全部在 `tools/skill-manager/tests/` |
| 其余 7 个工具、`shared/`、`backend/` 的测试 | 0 |

超过 1000 行的文件：

| 行数 | 文件 |
| --- | --- |
| 3649 | `tools/skill-manager/renderer/pages/SkillManagerPage.vue` |
| 1930 | `tools/interceptor/renderer/components/RulesPanel.vue` |
| 1722 | `tools/tweb-cache/backend/archive/message-store.ts` |
| 1265 | `renderer/pages/SettingsPage.vue` |
| 1237 | `tools/tweb-cache/renderer/pages/TwebCachePage.vue` |
| 1206 | `tools/wxp-enhancer/backend/services/injection-main.ts` |
| 1119 | `tools/interceptor/backend/services/proxy-service.ts` |

### 2.2 检查脚本当前状态

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm data-layers:check` | 通过（43 个条目，0 处豁免） |
| `pnpm lint` | **失败**，2 个错误，都在 `scripts/.tmp-import/` 下的一个 `message.md` 里 |
| `pnpm test:skill-manager` | **失败**，`scanner.test.ts:47` 断言不成立 |

### 2.3 安装包（`release/` 下 2026-10-31 的产物）

| 项目 | 大小 |
| --- | --- |
| `everydaytool Setup 1.1.0.exe` | 120 MB |
| asar 内容合计 | 100.56 MB |
| 其中 `node_modules`（106 个包） | 98.48 MB |
| 其中 `dist` + `dist-electron`（应用自身） | 2.09 MB |
| `app.asar.unpacked` | 13.89 MB，主要是 `@parcel/watcher` 的编译中间文件（`.iobj` 8.61 MB、`.ipdb` 3.64 MB） |

这份产物早于移除 element-plus 的提交，所以具体的包名已经过时，但成因没变。按当前 `package.json` 统计，生产依赖闭包是 214 个包目录，里面有 `typescript`、`rolldown`、`esbuild`、`lightningcss`、`@parcel/watcher`，都是被 `@tailwindcss/vite` 和 `sass` 带进 `dependencies` 的。

### 2.4 前端产物（`dist/`，2026-11-08 构建）

总计 1042 KB、84 个文件。主包 `index-*.js` 209 KB，公共库 96 KB，各工具页按需加载（最大的是拦截器 89.5 KB）。分包已经合理，**前端体积不是优化重点**。

### 2.5 运行环境

本机 Node 26.13.0（`.node-version` 写的是 26），流水线用 Node 22，`package.json` 的 `engines` 是 `>=22.18.0`。三处不一致。

---

## 3. 需要先拍板的 5 件事

这几项不是纯技术问题，方案取决于你要什么。

| # | 问题 | 现状 | 选项 |
| --- | --- | --- | --- |
| D1 | 要不要支持 Linux | 流水线打 AppImage，但 8 个工具的 `supportedTargets` 都是 `['web','win','mac']`，`renderer/config/tools.ts` 按目标过滤，Linux 包首页预期是空的（**已读码**，未在 Linux 上跑） | A. 从发布矩阵去掉 Linux；B. 逐个工具验证后加上 `linux` |
| D2 | Telegram 缓存要不要进安装版 | `site-service.ts:36` 从 `app.getAppPath()/tweb/dist` 找产物，`electron-builder.json` 的 `files` 不含它；`tweb/` 是未跟踪的独立仓库，不是子模块，流水线里没有它（**实测**）。`tweb/dist` 79 MB，`tweb/public` 111 MB | A. 标为仅开发形态可用，安装版隐藏；B. 改为子模块并打进 `extraResources`，安装包增加约 190 MB（压缩前） |
| D3 | 网页预览要列出哪些工具 | 8 个工具都声明支持 `web`，但只有身份证生成器不依赖 IPC | 建议只保留身份证生成器的 `web` |
| D4 | 主进程要不要改成打包成单文件 | 现在是逐文件转译，`dist-electron/` 有 181 个文件，靠构建末尾的自检防漏文件 | 建议先按 PLAT-3 测出启动耗时再决定，不要凭感觉改 |
| D5 | 拦截器的请求体脚本按什么威胁模型对待 | 规则是用户自己写的，但会随备份包恢复、可导入 | 如果认为"规则可能来自别人"，就要做 SEC-4 的进程隔离；否则只需解决死循环卡死主进程 |

---

## 4. P0：功能失效与数据丢失

### P0-1 技能管理器：禁用 / 启用的回滚会永久删除技能目录

- **证据（已读码）**：`tools/skill-manager/backend/services/disabled.ts` 约 380–395 行的 `rollbackMoved`。两个分支都是先 `rm(item.to, { recursive: true })`，再 `moveDir(item.to, item.from)`。`item.to` 就是刚移过去的目录，删掉之后第二步必然失败，错误被 `.catch(() => {})` 吞掉。
- **触发条件**：批量禁用或启用时中途抛错，例如某个目录被占用，或写锁文件失败。
- **做法**：回滚只做"移回去"，不做删除。

  ```ts
  for (const item of [...moved].reverse()) {
    if (item.mode === 'copy') await moveDir(item.to, item.from)
    else if (enabling) await rm(item.to, { force: true }) // 只删链接本身，不递归
    else if (item.linkTarget) await symlink(item.linkTarget, item.from, linkType)
  }
  ```

  上面是方向示意，没有运行过；动手前先读完同文件 255 行之前的启用分支，确认 `from` / `to` 在两个方向上的含义。回滚中的失败要收集起来随原错误一起抛出，不要再吞。
- **验收**：补一个用例，两个技能批量禁用、让第二个的移动失败，断言第一个仍在原位且内容完整。
- **工作量**：S

### P0-2 技能管理器：只认 v1 的项目锁，而本仓库的锁已经是 v2

- **证据（实测）**：工作区的 `skills-lock.json` 第 2 行是 `"version": 2`（`HEAD` 里还是 1，是未提交的改动）；`shared/skill-manager.ts:332` 写死 `PROJECT_LOCK_VERSION = 1`；`project-lock.ts:123` 版本不等就整体判为不支持。
- **影响**：项目范围的锁读不进来，预期该范围下的技能全部显示为未托管。
- **做法**：先对照上游 `skills` CLI 确认 v2 与 v1 的字段差异，再让读取同时接受两个版本，写回时保留原版本号。`planner-core.ts` 约 554 行另有一处硬编码的 `version: 1`（**待复核**），要一起改，否则会把文件降级。
- **验收**：用 v1 和 v2 两份夹具各跑一遍读、改、写，断言版本号不变、未知字段不丢。
- **工作量**：M（含调研 v2 格式）

### P0-3 拦截器：浏览器扩展弹窗里的启用 / 禁用 / 移除全部不生效

> **历史 / 已修复**。扩展已迁至 `browser-extension/lib/features/interceptor/`（WXT）；popup → SW 映射与 WS `default` 警告均已落地。下列路径指迁移前的 `tools/interceptor/extension/*`。

- **证据（已读码 + 全仓检索）**：旧 `extension/popup.js` 发的是 `toggle-target`、`toggle-rule`、`remove-target-id`、`remove-rule`；旧 `extension/background.js` 曾原样转发；`ws-bridge.ts` 只认 `target-toggle` 等。
- **影响**：四个操作被静默丢弃，弹窗照样返回成功，刷新后开关弹回。
- **做法**：在 SW 里做显式映射，不透传弹窗的 `type`；`ws-bridge.ts` 的 `switch` 加 `default` 分支记一条警告。
- **验收**：加一个契约测试，断言扩展发出的 `type` 集合是 `shared/interceptor.ts` 里协议类型的子集。手动点一遍四个操作。
- **工作量**：S

### P0-4 离线包与 WorkBuddy2API：下载"取消"在响应头到达后失效，正文阶段没有超时

- **证据（已读码）**：`tools/offline-pack/backend/utils/http.ts:66–81` 与 `tools/workbuddy2api-panel/backend/utils/http.ts:20–40` 是同一种写法。`request()` 在 `net.fetch` 返回时（只到响应头）就在 `finally` 里清掉超时定时器，并摘掉外部取消信号的监听。之后读正文的循环既收不到取消，也没有超时。
- **影响**：
  - 点"取消"后下载继续，下完照常改名、写历史。WorkBuddy2API 这边下载完成后是否继续安装，取决于安装流程有没有再检查取消状态（**待复核**）。
  - 网络中途卡死时任务永远挂起。
  - 两处 `createWriteStream` 都没挂 `error` 监听，磁盘满时会变成主进程未捕获异常。
- **做法**：把两份 `http.ts` 的下载部分收敛成一个平台模块 `backend/utils/http-download.ts`，让取消信号和超时覆盖整个正文，并改用 `pipeline` 统一处理背压与错误。

  ```ts
  const signal = AbortSignal.any([external, idleTimeout.signal].filter(Boolean))
  const res = await net.fetch(url, { headers, signal })
  await pipeline(Readable.fromWeb(res.body), touchIdleTimer, createWriteStream(tmp), { signal })
  ```

  超时改成"多久没有新数据"而不是总时长。示意代码未运行。
- **验收**：起一个本地慢速 HTTP 服务，下载到一半取消，断言临时文件被删除、没有历史记录、没有 `completed` 事件；再测服务端停止发送数据时任务在空闲超时后失败。
- **工作量**：M

### P0-5 离线包：Chrome / Edge 扩展的名称搜索永远没有结果

- **证据（已读码）**：`searchChrome` / `searchEdge` 返回数组（`chrome-service.ts:8`、`edge-service.ts:19`），`handlers.ts` 的 `guard()` 原样返回；`ChromeDownloader.vue:60` 和 `EdgeDownloader.vue:52` 却把结果断言成 `{ results: [...] }` 再取 `.results`，得到 `undefined`，落到 `?? []`。
- **做法**：前端直接按数组用；返回类型从 `shared/offline-pack.ts` 导出，去掉组件里的手写断言。同步修正 `docs/offline-pack.md` 里的契约描述。
- **验收**：搜索一个常见扩展名，列表出现。
- **工作量**：S

### P0-6 离线包：导出的 Docker 镜像丢失启动配置

- **证据（已读码）**：`docker-service.ts` 约 394–444 行，写进 TAR 的镜像配置是手工拼的：`Cmd: null`、`Entrypoint: null`、`Env` 只有 `PATH`、`os` 写死 `linux`、没选平台时架构默认 `amd64`。
- **影响（预期，未执行 `docker load`）**：加载后的镜像没有启动命令、环境变量、工作目录和端口声明，多数镜像 `docker run` 会失败或行为异常。
- **做法**：把清单里 `config.digest` 指向的原始配置直接写成 `<sha256>.json`，`manifest.json` 的 `Config` 指向它。本地算出的每层 `diff_id` 与真实配置里的值逐层比对，顺带完成完整性校验。
- **验收**：下载 `nginx` 和一个 arm64 镜像，`docker load` 后 `docker inspect` 的 `Cmd` / `Entrypoint` / `Env` 与 `docker pull` 的结果一致，`docker run` 能起来。
- **工作量**：M

---

## 5. P1：发布与工程基线

### REL-1 依赖归位，安装包不再带构建工具

- **证据（实测）**：见 2.3 节。主进程代码的第三方导入只有 `electron`、`node-forge`、`ws`。
- **做法**：
  1. `package.json` 的 `dependencies` 只留 `node-forge` 和 `ws`，其余全部移到 `devDependencies`。渲染层的包由 Vite 打进 `dist/`，运行时不需要 `node_modules`。并行会话新加的 `@videojs/html` 也应放在 `devDependencies`。
  2. 删除 `gsap` 和 `renderer/shared/composables/useGsap.ts`：全仓没有任何引用，构建产物里也没有它（**实测**）。
  3. 生产依赖里没有原生模块之后，`postinstall` 的 `electron-builder install-app-deps` 可以去掉。
- **验收**：
  - `pnpm ls --prod --depth 0` 只列出两个包。
  - 打包后 asar 里的 `node_modules` 只有这两个包，`app.asar.unpacked` 里没有 `@parcel/watcher`。
  - 冒烟：应用能启动，拦截器能生成证书（用到 `node-forge`），WXP 增强能连上调试端口（用到 `ws`）。
- **预期收益**：以旧产物计，未压缩内容减少约 110 MB。安装包压缩后的降幅要打包后才知道。
- **工作量**：S

### REL-2 Node 版本统一

`.node-version` 是 26，流水线写死 22，`scripts/build-tweb.mjs` 的注释还提到 22.15。流水线改用 `node-version-file: .node-version`，并把 `engines` 对齐到你实际要支持的下限。**工作量**：S

### REL-3 发布了更新清单但应用里没有更新检查

`electron-builder.json` 配了 `publish: github`，流水线会上传 `latest.yml` 和 blockmap，但代码里没有 `autoUpdater`，依赖里也没有 `electron-updater`（**实测**）。要么接上应用内更新，要么停止上传这些文件。属于信息项，不紧急。

### CI-1 加一条合并前检查流水线

- **证据（实测）**：`.github/workflows/` 只有 `release.yml`，手动触发，步骤里没有 lint、类型检查和测试。
- **做法**：新增 `ci.yml`，在 push 和 PR 时跑：

  ```yaml
  - run: pnpm install --frozen-lockfile
  - run: pnpm lint
  - run: pnpm typecheck
  - run: pnpm data-layers:check
  - run: pnpm test
  - run: pnpm build   # 末尾自带产物导入自检
  ```

  `release.yml` 的构建任务前也加同样的检查。
- **附带发现**：在编辑器终端里跑 `pnpm lint` 会打印"Detected running in editor, some rules are disabled"，也就是本地跑的规则比流水线少。这是需要流水线兜底的又一个理由。
- **工作量**：S（前提是 CI-2、CI-3 先做完）

### CI-2 让 `pnpm lint` 变绿

- **证据（实测）**：两个错误都来自 `scripts/.tmp-import/` 下的 Markdown。这个目录被 `.gitignore` 的 `.tmp-*` 忽略，但 `eslint.config.mjs` 设了 `gitignore: false`，自己的忽略表里没有它；另外忽略表里的 `'*.md'` 只匹配仓库根目录。
- **做法**：忽略表加 `'**/.tmp*/**'`，把 `'*.md'` 改成 `'**/*.md'`。
- **工作量**：S

### CI-3 测试封闭化，并统一成 `pnpm test`

- **证据**：
  - **实测**：`pnpm test:skill-manager` 失败。
  - **已读码**：`scanner.test.ts` 直接调用 `scanInventory()` 扫描真实仓库和真实主目录，并断言写死的数量（38 个目录、34 条锁）。
  - **待复核**：并行审计逐文件运行的结果是 51 个用例过 45 个，失败分布在 `scanner`、`locks`、`adopt`、`project-installer` 四个文件。后两个的原因是 Windows 路径分隔符（见 STAB-6）。
- **做法**：
  1. 从 `scanner.ts` 拆出可以注入全局目录和项目列表的 `scanner-core.ts`（现在写死了 `homedir()` 和 `process.cwd()`），测试全部改用临时目录夹具。
  2. 删除恒真断言（`presets.test.ts:87` 测的是 `JSON.parse` 本身，**待复核**）。
  3. `package.json` 增加 `test` 脚本，覆盖 `tools/*/tests/` 和后续新增的 `shared/`、`backend/` 测试。
- **工作量**：M

### PLAT-1 日志落盘与全局异常兜底

- **证据（实测）**：`backend/utils/logger.ts` 只写 `console`；全仓检索 `uncaughtException` 和 `unhandledRejection` 没有命中。
- **影响**：Windows 安装版没有控制台，日志全部丢失。用户报问题时拿不到任何线索。
- **做法**：
  1. `logger` 增加文件输出，写到缓存层的日志目录，按大小轮转（例如 5 MB 两个文件）。新落点要先登记到 `shared/data-layers.ts`。
  2. `electron/main.ts` 注册两个全局处理器，记录后继续运行，不弹默认的错误框。
  3. 设置页加一个"打开日志目录"入口。
- **工作量**：M

### PLAT-2 平台级 JSON 写入原子化

- **证据（已读码 + 实测）**：`backend/utils/file-ops.ts:111` 的 `writeJson` 是直接 `writeFile`，没有临时文件加改名。全仓有 13 处调用，包括拦截器的规则与配置、WXP 的配置与数据缓存、离线包的下载历史，以及平台自己的窗口外观、数据目录和资产目录的待迁移标记。
- **影响**：写到一半崩溃会留下半截 JSON。按约定这些数据本该走 `json-store.ts`。
- **做法**：分两步。
  1. 先把 `writeJson` 本身改成"写临时文件再改名"，临时文件名带随机后缀。一处改动覆盖 13 个调用点。
  2. 再逐个把工具的存储迁到 `json-store.ts`，顺带获得进程内缓存和损坏备份。拦截器的两个存储优先，可参照 `tools/interceptor/backend/store/rules-store.ts`。
- **工作量**：第一步 S，第二步 M

### PLAT-3 启动路径：去掉多余的等待，先量再优化

- **证据（已读码）**：`electron/main.ts:378–390` 串行 `await` 七个工具的 `initialize()`，全部完成后才建窗。其中 `tweb-cache` 和 `workbuddy2api-panel` 各自再 `await loadDataDirectoryOverride()` 一次，而 `main.ts:35` 已经同步加载过；后者还会 `ensureWb2apiDirs()` 建 6 个目录，并提前实例化自己的 webview 分区（后两点**待复核**）。
- **做法**：
  1. 删掉两处重复的 `loadDataDirectoryOverride()` 和启动期的建目录，让所有工具的 `initialize()` 变成同步的"只注册 IPC"。
  2. 加一个 `EDT_STARTUP_TRACE=1` 开关，在 `initializeBackend`、`createWindow`、`did-finish-load` 三个点打时间戳。
  3. 拿到数字后再决定 D4。
- **说明**：启动耗时本次没有测，所以这一项不承诺收益，第 1 步的价值首先是让"工具没打开就不产生副作用"的约定成立。
- **工作量**：S

---

## 6. P1：稳定性

下表中标"已读码"的是亲自核对过的，其余为待复核。

| 编号 | 问题 | 位置 | 做法 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| STAB-1 | 拦截器：只要存在一条启用的改请求体规则，所有名单内请求都整包缓冲，超过 8 MB 直接回 502 | `proxy-service.ts:349–374` | 先用不需要请求体的条件预筛，预筛后仍有规则需要请求体才缓冲 | 已读码 | M |
| STAB-2 | 拦截器：响应体替换命中大响应时写出截断内容；解码失败时响应头已按替换体改写，写出的却是原始压缩字节 | `proxy-service.ts:643–677` | 有整体替换时直接丢弃上游响应体并写出替换体，删掉三个分支 | 已读码 | M |
| STAB-3 | 拦截器：三处裸 `pipe`，上游中途断开时浏览器请求不收尾；透明转发无超时 | `proxy-service.ts:556、673、693` | 改用 `stream.pipeline` 并在回调里统一收尾 | 待复核 | M |
| STAB-4 | WXP：自动采集的 `ticking` 是模块级变量，停止时若有一轮在跑就永久卡住，之后所有会话都不再采集 | `auto-collect-service.ts:17、40、60` | 把 `ticking` 改成 `startAutoCollect` 闭包内的局部变量 | 已读码 | S |
| STAB-5 | WXP：注入循环没有逐目标的异常处理，一个页面注入失败会让排在后面的页面都得不到注入；轮询里的错误被静默吞掉 | `cdp-client.ts:273–275、317–322` | 逐目标 `try/catch` 并记日志，失败目标退避重试 | 已读码 | S |
| STAB-6 | 技能管理器：Windows 上写进项目锁的相对来源带反斜杠，跨平台对不上 | `project-installer.ts:283–287`、`adopt-core.ts:40–44` | 写入前统一成 `/`，两份 `projectSource` 合并 | 待复核 | S |
| STAB-7 | 技能管理器：设置里保存的访问令牌只用于解析目录，下载和克隆时没带上，私有仓库能列出但装不上 | `installer-core.ts:267–278` | 暂存阶段复用同一个凭据提供方 | 待复核 | S |
| STAB-8 | 技能管理器：禁用失败的兜底会把原本不存在的锁和登记表写成空文件 | `disabled.ts:334–339` | 原文件不存在时回滚应删除而不是写空；登记表一律走 `json-store` | 已读码（写回逻辑），后果待复核 | S |
| STAB-9 | Telegram 缓存：媒体索引 `media-index.json` 不在数据分层清单里，备份不包含它，损坏后也没有重建入口 | `shared/data-layers.ts:134–136`、`backup-service.ts:125` | 清单补上该文件和 `messages-index/`；规范化扫描时顺带重建索引 | 已读码 | M |
| STAB-10 | Telegram 缓存：同一消息目录的元数据读改写没有串行化，临时文件名还相同 | `message-store.ts:455–460` 等 | 按消息目录加一个 Promise 队列；临时文件名加随机后缀 | 待复核 | M |
| STAB-11 | WorkBuddy2API：晋升新版本的两次改名之间失败没有回滚，会变成"未安装"而旧版本躺在 `previous/` | `install-service.ts:89–98` | 第二步失败时把 `previous` 改回 `current`；第一步失败按错误码区分 | 已读码 | S |
| STAB-12 | WorkBuddy2API：找占用端口的进程用子串匹配，端口 3000 会匹配到 30000–30009，命中后直接强杀进程树 | `process-service.ts:249–282` | 按列精确比较；只有探活确认是本服务时才提供"结束占用" | 待复核 | S |
| STAB-13 | WorkBuddy2API：运行配置非原子写，损坏后初始化因"文件存在"被跳过，重装也修不好 | `config-service.ts:99–117` | 原子写；解析失败时备份并重建 | 待复核 | S |
| STAB-14 | 离线包：下载历史是异步读改写且无锁，两个下载同时完成会丢一条；删除历史时按记录里的路径递归强删，不校验是否在下载目录内 | `history.ts:45–47、70–73` | 迁到 `json-store`；删除前校验路径并改用非递归删除 | 待复核 | S |
| STAB-15 | 离线包：退出或崩溃会遗留 `.part` 文件，Docker 的临时文件名不带任务号，同镜像并发下载互相覆盖 | `docker-service.ts:468`、`backend/index.ts` | 增加 `dispose()` 取消进行中的任务；启动时清扫；临时文件名带任务号 | 已读码（文件名与无 `dispose`） | S |
| STAB-16 | 离线包：直连时除 `ghcr.io` 外一律按 Docker Hub 处理，输入 `quay.io/...` 实际请求的是 Docker Hub 上的同名仓库 | `docker-service.ts:101–107` | 未知仓库地址明确报错或走通用的鉴权质询 | 待复核 | M |
| STAB-17 | 拦截器：规则的 `source` 字段没有校验，一条坏规则会让代理的请求处理在 `try` 之外抛错 | `handlers.ts:63–65`、`proxy-service.ts:349–390` | 入参与加载时都校验；`handleRequest` 整体包进 `try/catch` | 待复核 | S |
| STAB-18 | 拦截器：子视图没有缓存，切页签会丢规则草稿 | `InterceptorPage.vue:137–139` | 包一层 `<KeepAlive>` 或把草稿提到 store | 待复核 | S |

---

## 7. P2：安全加固

这是一款本机工具，下面多数条目的前提是"渲染层被注入"或"导入了别人给的数据"。按第 3 节 D5 的结论决定做到哪一步。

| 编号 | 问题 | 位置 | 做法 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| SEC-1 | 技能管理器：`git` 调用的位置参数前没有 `--`，来源与分支名不拒绝 `-` 开头，可能被当成选项 | `sources/git.ts:74–76、168–170` | 位置参数前加 `'--'`；解析阶段拒绝 `-` 开头；限定协议 | 已读码（参数拼接），可利用性未验证 | S |
| SEC-2 | 技能管理器：锁文件的键名不校验，直接拼进移动到回收站的路径 | `project-lock.ts:127–128`、`preset-apply-core.ts:110–112` | 读锁时对键做名称校验；移动前断言目标仍在技能目录内 | 待复核 | S |
| SEC-3 | IPC 来源白名单在安装版也信任任意本机回环端口的页面 | `backend/utils/ipc-sender.ts:40–43` | 回环来源只在开发形态信任，并限定到开发服务器的端口 | 已读码 | S |
| SEC-4 | 拦截器：请求体脚本的 `vm` 沙箱注入了宿主的 `URL`、`TextEncoder` 和日志函数，不构成隔离；`await` 之后的死循环不受超时约束，会卡死主进程 | `body-script.ts:50–84` | 放进 `worker_threads` 或 `utilityProcess`，超时即终止 | 已读码 | M |
| SEC-5 | 拦截器：扩展的 WS 桥只校验 `Origin`，本机任何进程带上这个头就能连入、读取名单与脚本、修改名单 | `ws-bridge.ts:220–226` | 握手增加每次启动轮换的共享令牌；入站消息做类型校验；限制消息体大小 | 已读码（校验方式） | M |
| SEC-6 | 拦截器：根证书私钥明文落盘，先以默认权限写出再收紧 | `cert-service.ts:150–153` | 创建时就指定权限；用已有的 `secret-box.ts` 做静态加密 | 待复核 | S |
| SEC-7 | Treease 编辑器：按路径写 JSON 时不拦 `__proto__` 等键，可污染主进程的对象原型 | `intercept-service.ts:73–80` | 拒绝 `__proto__`、`constructor`、`prototype` 路径段 | 待复核 | S |
| SEC-8 | WorkBuddy2API：工具自己的弹窗处理器覆盖了平台的"一律拒绝"，任意本机端口都能弹出不受导航限制的新窗口 | `guest-guards.ts:40–44` | 一律拒绝；确需弹窗时只放行当前配置的端口 | 已读码 | S |
| SEC-9 | 离线包：下载内容不校验摘要（Docker 层、GitHub 资产），Docker 加速地址可以是任意地址，包括 `http://` | `docker-service.ts:75、493–508` | 流式下载时增量计算 sha256 并比对；加速地址走白名单或至少强制 https | 已读码（循环内无校验） | M |
| SEC-10 | 离线包：下载通道对 VSCode 和应用商店两类接受任意地址，等于让主进程抓取任意网址 | `handlers.ts:200–203` | VSCode 改为传发布者、扩展名、版本，由后端拼地址；应用商店限定域名 | 待复核 | S |
| SEC-11 | WXP：保存设置时只检查路径非空，注释却写着"避免被写成任意可执行程序"；额外参数不设限 | `handlers.ts:31–35` | 只接受来自文件选择对话框或自动检测返回过的路径；参数做黑名单 | 待复核 | S |
| SEC-12 | Telegram 缓存：引导脚本不需要令牌，跨站 `<script src>` 可以读到令牌；HTTP 入口的参数校验比 IPC 入口松 | `site-server.ts:297–300、361–365`、`api.ts:281–283` | 校验 `Sec-Fetch-Site`；两个入口共用同一套校验函数 | 待复核 | S |

---

## 8. P2：性能

本节没有一条做过耗时测量。每条都先加打点，拿到数字再动手，避免优化了不存在的瓶颈。

| 编号 | 问题 | 位置 | 做法 | 证据 | 量 |
| --- | --- | --- | --- | --- | --- |
| PERF-1 | 离线包：Docker 每一层整包进内存，用同步解压，所有层解压后的数据都留在数组里直到最后才写盘 | `docker-service.ts:478–509` | 逐层流式处理：边下边算摘要，经流式解压落到临时文件，再流式写入 TAR | 已读码 | L |
| PERF-2 | 离线包：进度事件每个数据分片广播一次，没有节流 | `utils/downloads.ts:46–50` | 按任务节流到 100–200 ms 一次，终态事件不节流 | 待复核 | S |
| PERF-3 | Telegram 缓存：每完成一个附件、每存一张缩略图，都同步全量重写整份媒体索引 | `message-store.ts:567–575` | 索引分片；写入合并去抖；退出时落盘 | 待复核 | M |
| PERF-4 | Telegram 缓存：状态查询一批最多 500 个，逐条串行读文件，绝大多数是未命中 | `message-store.ts:1667–1671` | 先查内存里的消息索引，命中才读文件 | 待复核 | M |
| PERF-5 | Telegram 缓存：全库规范化在每次打开工具时都跑；影库列表先截断后排序，超过 1000 条会漏掉新消息 | `TwebCachePage.vue:622–631`、`message-library.ts:135–141` | 记布局版本号，完成过就跳过；列表从索引取数，先排序再截断 | 待复核 | M |
| PERF-6 | 拦截器：每条流量连同两份最多 64 KB 的正文立即广播；流量表每条事件都全量过滤、反转、渲染 1000 行 | `interceptor-service.ts:63–66`、`TrafficPanel.vue:17–23` | 主进程按 50–100 ms 批量推送摘要，详情按需拉取；表格用虚拟滚动 | 待复核 | M |
| PERF-7 | 拦截器：流量采样先缓冲最多 8 MB 再全量解压，解压不设输出上限 | `proxy-service.ts:200–210、688–701` | 只保留前若干字节，流式解压并限制输出 | 已读码 | M |
| PERF-8 | 拦截器：每个新主机首次访问时在主进程同步生成 2048 位 RSA 密钥 | `cert-service.ts:87–88` | 所有叶证书共用一把异步生成的密钥；缓存改存 Promise | 待复核 | S |
| PERF-9 | 拦截器：通配规则每次匹配都重新编译正则 | `shared/interceptor.ts:101–102` | 复用已有的正则缓存 | 待复核 | S |
| PERF-10 | 技能管理器：每个读接口和每次变更都整盘重扫；挂载时串行检查所有仓库的更新，结果只用来数一个数字 | `ipc/handlers.ts:296–301`、`SkillManagerPage.vue:880–885` | 后端做短时缓存和进行中请求去重；自动检查改为有限并发并保留结果 | 待复核 | M |
| PERF-11 | 技能管理器：安装一个技能要把整个仓库的压缩包读进内存并同步解压 | `services/archive.ts:70–84` | 异步流式解压，只落盘选中的子路径 | 待复核 | M |
| PERF-12 | WXP：注入后立即断开调试连接，"新文档启动时注入"的注册随连接关闭失效，整页刷新后要等轮询抽查才能补上 | `cdp-client.ts:116–139` | 每个目标保持一条常驻连接 | 已读码（用完即断），空窗时长待复核 | M |

---

## 9. P3：可维护性

### 9.1 拆分超大文件

**排在所有缺陷修复之后做。** 先修再拆，否则缺陷修复的改动会淹没在搬代码的差异里。

| 文件 | 建议边界 |
| --- | --- |
| `SkillManagerPage.vue`（3649 行） | 约 11 个组合式函数（清单与筛选、安装对话框、更新计划、回收站、接管、收藏、预设、设置与项目、自动检查等）加约 15 个子组件（工具栏、技能库视图、更新视图、各对话框）。手写的表格、下拉框、复选框换成平台组件 `UiTable` / `UiSelect` / `UiCheckbox` |
| `RulesPanel.vue`（1930 行） | `RulesList.vue`、`RuleEditor.vue`、`rule-forms/` 下九种动作表单；选项常量与草稿校验抽成纯函数文件，后者可以直接单测 |
| `message-store.ts`（1722 行） | 文件读写工具、内容快照、媒体索引、别名索引、消息索引、目录迁移、规范化各自成文件，原文件只留归档主流程 |
| `proxy-service.ts`（1119 行） | HTTP 头工具、正文编解码、请求处理、隧道与升级各自成文件，原文件只留生命周期 |
| `injection-main.ts`（1206 行） | 这是注入到目标页面的脚本，靠 `toString()` 序列化，所以只能写成单函数、不能导入。仿照 `preload.ts` 单独打成一个产物，源码就可以按功能拆分并复用 `shared/wxp-favorite.ts` |
| `TwebCachePage.vue`（1237 行）、`SettingsPage.vue`（1265 行） | 按面板拆子组件；前者六处手拼的页面脚本合并成一个调用函数 |

各文件的逐行拆分清单见并行审计记录，这里只保留边界。

### 9.2 清理

| 项目 | 证据 |
| --- | --- |
| `shared/sandbox.ts`、`shared/env.ts` 没有任何引用，是早期"Chrome 沙箱"项目的遗留 | 实测 |
| `gsap` 依赖与 `useGsap.ts` 没有任何引用 | 实测 |
| `package.json` 的 `keywords` 还有 `sandbox`、`fingerprint`；`json-store.ts` 首行注释还在讲"沙箱列表 / 指纹 / 环境账号" | 实测 |
| 图标来源有三套：自有的 `UiIcon`、`@lucide/vue`（只有 `UiSelect` 用）、`@radix-icons/vue`（只有 `UiToaster` 用） | 实测 |
| `App.vue` 样式注释里的"左轨 68px"与实际的 48px 不符 | 已读码 |
| Windows 标题栏原生按钮区高度是 44，标题栏本身是 48，`main.ts` 的注释写的是"对齐"。确认是否有意 | 已读码 |
| 技能管理器：约 10 个后端导出、8 个前端 IPC 封装没有调用方；回收站的保留期清理函数只有测试在调用；14 种技能状态里有 3 种从不赋值，对应的筛选恒为 0 | 待复核 |
| Telegram 缓存：`http-semantics.ts` 约 200 行只用到一个函数；有一份消息索引只写不读；`objects/` 目录没有读取方 | 待复核 |
| WXP：采集的令牌字段在目标应用改为 cookie 会话后恒为空，类型和界面还保留着；`REINJECT` 通道没有调用方 | 待复核 |
| 拦截器：扩展弹窗的"相关域名建议"只会建议已在名单里的主机 | 待复核 |

### 9.3 文档

- 模块文档与实现有多处不一致（**待复核**）：`docs/interceptor.md` 写了视图缓存而代码没有；`docs/tweb-cache.md` 写的"闲置 5 分钟停站点"实际是立即停；`docs/workbuddy2api-panel.md` 写的目标平台与代码不同。建议每次改行为时同步改对应文档，并在 CI-1 之后考虑加链接与路径检查。
- `eslint.config.mjs` 的注释把 `tweb` 称为子模块，实际不是（**实测**）。随 D2 的决定一起修正。
- `AGENTS.md` 是每次对话都会加载的规则文件，约 1.6 万字符。其中不少是"曾经踩过的坑"的叙述，可以挪到 `docs/` 并只留下规则本身。

### 9.4 数据分层检查的盲区

`pnpm data-layers:check` 只拦"绕过 `resolveLayerPath` 直接拼数据根"，拦不住"经它解析出目录后，在里面写了清单没登记的文件"。STAB-9 就是这样漏过去的。建议开发形态启动时扫描配置层，对不属于任何清单条目的文件打警告。

---

## 10. 路线图

每个阶段结束都应该能独立发布。

| 阶段 | 内容 | 条目 | 估算 |
| --- | --- | --- | --- |
| 0 止血 | 修掉功能失效与数据丢失 | P0-1 ~ P0-6 | 约 1 周 |
| 1 工程基线 | 安装包瘦身、流水线、lint 与测试变绿、日志落盘、原子写第一步 | REL-1、REL-2、CI-1 ~ CI-3、PLAT-1、PLAT-2 第一步、PLAT-3，并落实 D1 ~ D3 | 约 1 周 |
| 2 稳定性 | 第 6 节剩余条目，每修一条补一个回归测试 | STAB-1 ~ STAB-18、PLAT-2 第二步 | 约 2 周 |
| 3 加固与性能 | 按 D5 的结论做安全项；性能项先打点再动手 | SEC-*、PERF-* | 约 2–3 周 |
| 4 可维护性 | 拆大文件、清理、文档对齐 | 第 9 节 | 持续进行 |

顺序上的约束：

- REL-1 与并行开发的 `media-library` 都在改 `package.json`，合并前先对齐，避免互相覆盖。
- CI-1 依赖 CI-2 和 CI-3，否则流水线一上来就是红的。
- P0-4 抽出的下载模块是 PERF-1、SEC-9、STAB-15 的基础，这几条按这个顺序做。
- 拆 `SkillManagerPage.vue` 之前先做完 P0-1、P0-2 和 CI-3。

### 建议补的测试

仓库已有 `node --test` 的用法，不需要引入新框架。以下都是不依赖 Electron 的纯逻辑，按价值排序：

1. `shared/window-bounds.ts` 的 `resolveWindowPlacement`、`shared/appearance.ts` 的能力判定、`shared/data-layers.ts` 的路径拼接。这三个是平台级的纯函数，目前没有测试。
2. `shared/interceptor.ts` 的来源匹配，以及 `rule-engine.ts` 的请求规划和响应改写。
3. `shared/offline-pack.ts` 的 GitHub 地址校验、文件名清洗、Docker 镜像名解析。前两个是安全边界。
4. 身份证校验位算法（用公开样例 `11010519491231002X`）和年龄、日期边界。
5. 技能管理器的禁用回滚、锁的 v1 / v2 读写、锁键校验。
6. Telegram 缓存的字节区间解析、别名索引、路径穿越防护。
7. WorkBuddy2API 的端口占用解析、版本晋升与回滚的状态机。
8. 扩展与主进程之间的消息类型契约。

---

## 11. 已确认没有问题、不必再查的部分

以下是审计中专门核对过、结论是处理得当的地方：

- **类型检查**：前后端两套配置都通过，开了 `strict` 和未使用检查。
- **目录边界**：渲染层没有直接导入后端；每个工具只有一个 IPC 封装实例；后端相对导入都带 `.ts` 后缀。
- **IPC**：所有处理器都经 `safeHandle` 校验调用来源；preload 按命名空间做通道白名单。
- **窗口加固**：`contextIsolation`、`sandbox` 开启；webview 挂载时剥离 preload；新窗口默认拒绝；主窗口禁止整页导航；页面声明了 CSP。
- **数据分层**：所有工具的数据路径都经 `resolveLayerPath`，检查脚本通过且没有豁免。
- **懒启动**：拦截器、WXP、Telegram 缓存站点、WorkBuddy2API 的进程都是工具页挂载时才拉起，关闭即停。
- **监听地址**：拦截器代理、WS 桥、Telegram 缓存站点都只绑回环地址。
- **子进程**：全部用参数数组启动，不经 shell。
- **前端分包**：工具页按需加载，主包 209 KB。
- **组件展示页**：`UiShowcasePage.vue` 只在开发形态注册路由，不进生产构建。
- **身份证生成器**：校验位权重与映射表正确，行政区划数据只在该工具的按需加载包里。

---

## 12. 本次没有覆盖的范围

- 没有启动应用，所有界面行为和耗时都没有实测。
- `tweb/` 的页面侧代码没有审，Telegram 缓存里依赖页面行为的条目（调用频率、上传时机）只依据 `docs/tweb-cache.md`。
- 若干文件的样式块没有读：`RulesPanel.vue`、`TwebCachePage.vue`、`Workbuddy2apiPanelPage.vue`、`IdCardGeneratorPage.vue` 的 `<style>` 部分。
- `renderer/shared/components/ui/` 下 49 个平台组件没有逐个审，`HomePage.vue`、`SettingsPage.vue`、`AppRail.vue`、`CommandPalette.vue` 只做了定点检索。
- `backend/utils/` 里的备份恢复、数据目录迁移、布局升级只读了与结论相关的片段。
- `tools/media-library/` 正在开发中，没有审。
- 行政区划数据没有逐条核对正确性。
