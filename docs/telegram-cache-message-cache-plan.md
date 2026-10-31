# telegram-cache 消息级缓存与本地回放（方案 v4：自托管 telegram-tt）

> 状态：**方案 v4（架构已改为源码形态，未动代码）**。基线：`telegram-tt@12.0.48`
> （commit `6002824b6532f3d913997ce496d9ab5f9b86bc22`，GPL-3.0-or-later，submodule）。
> v4 变更：**放弃"包装 web.telegram.org + 注入"路线**，改为 submodule 引入 telegram-tt、源码层接入媒体缓存、
> 主进程用 loopback HTTP 同源托管。注入 / CDP 捕获 / 自定义 scheme / 原生查看器接管 / 对原站的本地响应**全部取消**。
> 集成细节见 [telegram-cache-telegram-tt-integration.md](./telegram-cache-telegram-tt-integration.md)；
> 旧版（v3，原站路线）的分析保留在 git 历史里，其中 tgapp 参考实现分析仍然有效：
> [telegram-cache-tgapp-video-takeover-analysis.md](./telegram-cache-tgapp-video-takeover-analysis.md)。
> 实现后请把结论回写到 [telegram-cache.md](./telegram-cache.md)（§1.1 定位、§2 文件地图、§11 数据目录）。

## 0. 需求拆解与结论

| # | 需求 | 实现位置（v4） | 结论 | 关键约束 |
| --- | --- | --- | --- | --- |
| R1 | 消息旁"缓存"按钮，点击缓存整条消息到本地，磁盘可查看 | telegram-tt 的消息组件 + 右键菜单（源码级） | ✅ 可控 | 需要改 4 个触点；文案走 `lang()` |
| R2 | 图片/视频已在页面缓存里时复用，不重新下载 | `mediaLoader` 先查页面 Cache Storage / 后端对象库 | ✅ 可行 | 页面已下载的字节可直接读；后端只做持久化 |
| R3 | 目录按 `群id/消息id/资源` | 后端 `messages/<acc>/<peer>/<mid>/` | ✅ 纯后端 | 硬链去重；删除进回收站 |
| R4 | 重开群聊检测/标记；完整则本地展示 | 页面读后端状态渲染角标；`mediaLoader` 返回 `/media/<mediaKey>` | ✅ 与 tgapp 同构 | 必须同源托管 + SW 作用域正确 |
| R5 | 原消息不可用时本地仍保留 | 本地索引 + manifest 快照 + 影库（工具侧 `library`） | ✅ 必须做 | 播放/列表不经过 Telegram |

**一句话**：这次不是"给远程页面打补丁"，而是"我们自己就是客户端"——媒体 URL、消息对象、播放器都在手里，
之前最难的三件事（本地 URL、消息身份、查看器接管）全部消失。

## 1. 现状 → 目标：哪些复用、哪些退役

当前仓库里的 telegram-cache 仍按"原站包装"实现；v4 只替换**页面与媒体接入层**，后端资产大部分保留。

| 现有模块 | v4 处置 |
| --- | --- |
| `observation-service.ts`（webRequest 观测） | **保留**，但目标从远程站点变成本地 origin（仍能看 CDN/HTTP 资源与 SW 分片）；MTProto 流量不计 |
| `resource-registry.ts` / `cache-manager.ts` / 配额 | **保留**，作为对象库与 LRU 层 |
| `task-manager.ts` / 单飞 / 重试 | **保留**（归档分块与 headless 下载复用） |
| `archive-service.ts`（内容寻址归档） | **替换**为 `message-store.ts`（消息目录 + manifest + text.md + 硬链）；`archive/resources/` 删除 |
| `page-capture-service.ts`（CDP 图片捕获） | **退役**（源码形态不需要） |
| `local-response-service.ts`（接管 http(s) 本地响应） | **退役**（媒体层直接返回本地 URL） |
| `probe-service.ts`（页面探测 + 导航闸） | 探测退役；导航闸保留并改为"只允许本地 origin + 外部链接走系统浏览器" |
| `mtproto-service.ts`（独立 MTProto 下载） | **降级为可选 headless 补档**（默认关）；归档主路径改用页面自己的 GramJS |
| `feasibility-service.ts`（M3 报告） | **退役**（不再需要"能否捕获页面数据"的判定） |
| `self-test-service.ts` | 保留并改写：新增消息目录、Range/416、token、硬链、manifest 校验；删除 CDP/scheme 项 |
| `snapshot-service.ts` / 工具侧 Vue 面板 | **保留**（统计、任务、诊断、影库入口） |
| `docs/telegram-cache.md` | 迁移完成后按新架构重写 |

## 2. 总体架构

```
┌──────────────────────────── Electron 主进程 ────────────────────────────┐
│  site-server (127.0.0.1:0, 随机 token)                                  │
│    GET /                 → telegram-tt/dist/index.html（写入 __EDT__ bootstrap）│
│    GET /assets/*         → 静态资源（SW 响应带 Service-Worker-Allowed:/）│
│    GET /media/<mediaKey> → 本地文件流 Range/206/416                     │
│    /api/*                → 缓存 / 归档 / 状态 / 影库 / 回收站            │
│    GET /events           → SSE 进度                                     │
│                                                                         │
│  message-store / registry / cache-manager / task-manager / trash        │
│  mtproto（可选 headless）/ snapshot / diagnostics / self-test            │
└───────────────────────────────▲─────────────────────────────────────────┘
                                │ 同源 HTTP（无 preload、无 IPC）
┌───────────────────────────────┴─────────────────────────────────────────┐
│ <webview partition="persist:telegram-cache"> http://127.0.0.1:<port>/   │
│   telegram-tt 12.0.48（submodule，GPL-3.0）                              │
│     src/util/edt/*        缓存/归档客户端（新增，自包含）                 │
│     src/util/mediaLoader  命中本地→返回 /media/…；未命中→原 progressive  │
│     Message/ContextMenu   角标、缓存/取消、在文件夹中显示                  │
│     Service Worker        progressive 分片：先问本地 Range，再走 GramJS   │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
<assets>/telegram-cache/messages/<acc>/<peer>/<mid>/…
<assets>/telegram-cache/trash/…        <cache>/telegram-cache/objects/<ab>/<sha256>
```

### 2.1 托管要点（决定成败的三条）

1. **同源**：页面、`/api`、`/media` 必须同一个 `http://127.0.0.1:<port>`。telegram-tt 的 CSP 是
   `default-src 'self'`、`media-src 'self' blob: data:`、`connect-src 'self' …`，同源即放行，**不需要改 CSP**。
2. **SW 作用域**：构建产物 `assets/service.worker-<hash>.js` 的响应必须带 `Service-Worker-Allowed: /`，
   否则作用域只有 `/assets/`，`/progressive/*` 不被拦截 → 视频播放直接坏。Vite dev server 已有该头
   （`vite.config.ts:210-213`），生产托管要自己补。
3. **构建 Node 版本**：telegram-tt 要求 Node ^24.15 || ^26、npm ^11/12；everydaytool 用 Node 22。
   必须分离（fnm/volta 切换；脚本启动前检查），否则 `npm ci`/`vite build` 直接失败。

### 2.2 目录结构

```
<assets>/telegram-cache/
  messages/
    acc-<sha8(accountId)>/
      peer-<-1001234567890>/
        000000000000042/
          manifest.json          # messageKey / peer 快照 / sender / date / media[] / origin
          text.md                # 正文 + caption（默认写，逐条可关）
          media/001.jpg 002.mp4  # 应用生成名；同卷硬链到 objects，跨卷复制
  trash/
    2026-10-29T12-00-00_<peer>_<mid>/
      trash.json  manifest.json  text.md  media/…
<cache>/telegram-cache/
  objects/<ab>/<sha256>          # 内容库（去重/配额）
  tmp/*.part                     # 下载临时文件
  diagnostics/*.json
```

- `archive/resources/` **删除**（当前无内容，不兼容、不迁移）。
- **实现偏差（2026-10 落地后回填）**：`acc-<sha8>` 那一级最终没有接线（`/api/archive/bind` 一直是 501，页面从不告知账号），
  实际路径是 `messages/peer-<群 id>/<消息 id 补零 15 位>/`；`text.md` 也扩展成带抬头的 `message.md`，
  媒体名用 `media/<mediaKey>.<ext>`。旧 `acc-default/` 目录由 `migrateTelegramAccountLayout()` 幂等上移一级。
- 索引：`<config>/telegram-cache/messages-index/<peerId>.json`（按 peer 分片，避免全量写放大）。
- 配额：消息目录独立 `messageCacheMaxBytes`，按 `mediaKey`/`sha256` 去重计量（硬链不重复计费）。

## 3. 需求 → 方案对照

### 3.1 R1 缓存按钮与消息归档

- 入口：消息右键菜单（与 tgapp 的 `ContextMenuContainer` 同构）＋ 媒体角标旁的按钮（可选）。
- 点击后页面把 `ApiMessage` 快照交给 `src/util/edt/archive.ts`：`prepare` → 逐媒体取字节 → `append` → `commit`。
- 字节优先取"页面已下载"（memory blob / Cache Storage），否则用页面自己的 GramJS 按 `start/end` 分块下载，
  再 `PUT /api/archive/append`；`commit` 最后写 `manifest.json`（完成标记）。
- 相册：`groupedId` 相同视为一组，右键任一张 = 逐条归档整组；**每条消息保留自己的目录与 manifest**
  （同一 `groupedId`，便于逐条状态、正文与失败重试），而不是合并进一个目录。
- 受保护消息（`noforwards`）：**不缓存媒体、不写正文**，按钮置灰并说明原因（不绕过保护）。
- 大文件：分块 4–8MB；照片整图；视频/文件支持断点（`.part` + 连续前缀，规则见 §4 D5）。

### 3.2 R2 复用页面缓存

源码形态下不需要"读 Chromium 缓存文件"，也不需要 CDP：

1. **页面自己的缓存**：`cacheApi.fetch(MEDIA_CACHE_NAME, url, Type.Blob)`（按账号作用域）＋
   `mediaLoader.getFromMemory(url)`（blob URL 需再 `fetch` 回 Blob）→ 直接 `PUT` 到后端（0 网络）。
   12.0.48 没有现成的 `getExistingBlob`，由 `src/util/edt/pageCache.ts` 补一个。
2. **后端对象库**：`mediaKey`/`sha256` 命中 → 直接建目录/硬链（0 网络）。
3. **页面 GramJS 分块下载**：`downloadMedia({ start, end })`，边下边 `append`（一次网络）。
4. **`session.fetch` 命中磁盘缓存**：仅对 HTTP CDN 资源有意义，作为补充路径（不再是主路径）。

播放侧的复用：`mediaLoader` 先问 `/media/<mediaKey>`，命中就返回本地 URL（连页面缓存都不用读）。
未命中则走原 progressive；页面侧处理 SW 的分片请求时先问后端 Range——播放过的区间会写回 `.part`，下次可直接命中。

### 3.3 R3 消息目录

- 命名、manifest 字段、硬链/复制、回收站、配额见 §2.2 与 §4。
- 路径只由数值 id 与 MIME 生成；**不用群名/用户名/原始文件名**；标题与发送者只进 manifest 快照。
- 同一媒体被多条消息归档：`mediaKey` 相同 → 内容库一份，消息目录各自硬链（同卷）或复制（跨卷）。

### 3.4 R4 打开聊天检测、标记、本地展示

- 检测：打开聊天时按可见 `mid` 批量请求 `GET /api/archive/status`（≤200 条/次），落到 `statusStore`；
  SSE 增量更新。虚拟列表只查可视区 + 缓冲。
- 标记：消息组件读 `statusStore` 渲染 `已缓存 / 缓存中 xx% / 部分 / 原始消息不可用 / 失败`；
  角标文案走 `lang()`，图标用现有 `Icon`。
- 本地展示：`mediaLoader` 的 `Progressive`/`DownloadUrl` 分支命中后端时返回 `/media/<mediaKey>`；
  `BlobUrl`（图片）先 `cacheApi.fetchBlob` 再 `URL.createObjectURL`。查看器与内联播放都走同一条路径，
  **不需要接管查看器**（它拿到的就是本地 URL）。
- "原始消息不可用"：只在用户点"检查原消息"时请求远端；失败只更新 `origin.reachable`，不改 `status`、不删文件。

### 3.5 R5 原消息不可用时保留

| 场景 | 行为 |
| --- | --- |
| 消息被删/撤回 | 目录、正文、媒体全部保留；角标显示"已缓存（原消息不可用）" |
| 频道被 ban / 失权 | 页面进不去也能在工具侧影库浏览/播放（只读本地索引） |
| 归档时 MTProto/页面报错 | 已有完整副本 → 直接返回本地结果，不报错、不覆盖 |
| 本地文件被外部删除 | manifest 保留，状态改 `missing`，不静默删记录 |
| 清理缓存/LRU | 只动 `objects/` 与索引，不碰消息目录（硬链保证独立存活） |
| 删除 | 唯一路径，二次确认 → 回收站（默认 30 天） |

## 4. 关键设计决策

**D1 页面与后端同源**：`http://127.0.0.1:<port>` 单一 origin（静态 + API + 媒体）。不改 CSP、不需 preload；
自动获得安全上下文（SW、crypto）与无 CORS 的 `<video>`/`fetch`。

**D2 安全边界**：只绑 `127.0.0.1`；随机端口 + 32 字节 token（写进 `index.html` 的 bootstrap）；校验 Host 与 Origin；
媒体只接受索引内的 `mediaKey`；静态路径 realpath 必须留在 `dist/`；写接口只收数字 id / 偏移 / 字节。

**D3 媒体键**：`mediaKey = photo_<id> | document_<id>`（跨会话稳定）；`messageKey = peer:mid`（目录/标记）；
`sha256`（完整性/去重）。三者都进 manifest，缺失时降级而不猜。

**D4 媒体接入点**：只改 `mediaLoader`（URL 解析 + SW 分片）与消息组件（角标/菜单），其余逻辑放
`src/util/edt/**`；目标 ≤4 个上游触点，便于 rebase。

**D5 断点与完整性**：`.part` 只维护连续前缀（跳写丢弃）；`complete` 由 `x-edt-complete` 或"已接收 ≥ 期望"判定；
完成后校验大小 + SHA-256；**禁止**用"播放过"当完整。

**D6 硬链优先**：同卷 `link`，跨卷/不支持时复制；`linkMode` 写 manifest；删除前按 `sha256` 判断是否仍有引用。

**D7 正文落盘**：`text.md` 默认写（正文 + caption，entities 渲染为 Markdown）；manifest 只存元数据；
`noforwards` 不写。

**D8 本地优先**：所有列表/播放路径先本地索引；远端失败只更新 `origin` 字段，不改变 `status`、不删除。

**D9 回收站**：删除 = 目录整体移入 `trash/<时间>_<peer>_<mid>/` + `trash.json`；30 天到期清理，可恢复/清空。

**D10 双轨会话**：页面登录（GramJS，主路径）与 `.env` MTProto（headless 补档，可选）分开显示；
归档使用页面客户端，避免重复下载；两套会话都不出主进程/不写日志。

**D11 上游跟踪**：submodule pin commit；我们的修改在 `edt/main` 分支；升级 = rebase；触点越少越好。

**D12 许可证**：当前不对外分发，GPL 义务不触发；若分发必须先处理（整仓 GPL 或独立 GPL 组件）。

## 5. 未实现清单（backlog）

> 工作量：S ≈ 半天内，M ≈ 1–3 天，L ≈ 3 天以上（含实测与回归）。

| # | 需求 | 缺口 | 工作量 | 依赖/风险 |
| --- | --- | --- | --- | --- |
| G1 | 基础设施 | submodule 注册（`git submodule add` 被本机沙箱的 git 子进程阻断，需在普通终端执行） | S | 见集成文档 §1 |
| G2 | 基础设施 | Node 24 构建链（`pnpm telegram:install/build`，版本检查与错误提示） | S–M | 与 everydaytool 的 Node 22 分离 |
| G3 | 基础设施 | `site-server`：静态托管 + `Service-Worker-Allowed: /` + index bootstrap + SPA fallback | M | SW 作用域是硬门槛 |
| G4 | 基础设施 | 同源 API 框架（token/Host/Origin 校验、错误码、SSE） | M | 安全边界 |
| G5 | R1 | 消息快照 → `archive.prepare/append/commit`（相册、caption、entities） | M–L | 依赖 G6/G7 |
| G6 | R1 | 消息目录 + manifest + text.md + 硬链/复制 + per-peer 索引 | M–L | 同步 `data-layers.ts` |
| G7 | R1 | 分块写入与断点（`.part` 连续前缀、大小/SHA 校验） | M | 参考现有 `mtproto-download-core` |
| G8 | R1 | 右键菜单 + 按钮 + 进度/状态 | M | telegram-tt 规范（Teact/lang） |
| G9 | R2 | `mediaLoader` 命中本地返回 `/media`；`BlobUrl` 读后端 | M | 必须覆盖 Progressive/DownloadUrl/BlobUrl 三支 |
| G10 | R2 | SW `requestPart` 先查后端 Range、下载后写回 | M–L | 分片语义；只维护连续前缀 |
| G11 | R2 | 页面缓存优先（`cacheApi` + `getFromMemory`，自建 `pageCache.getExistingBlob`）与"已下载不重下" | S–M | 页面缓存 API 可用性 |
| G12 | R3 | 双键模型贯穿目录/索引/manifest/URL | M | 与 G6 同批 |
| G13 | R4 | 批量状态 + `statusStore` + 角标（已缓存/缓存中/部分/失败/不可用） | M | 虚拟列表性能 |
| G14 | R4 | 本地媒体服务 Range/206/416 + 缩略图 | M | 复用 `parseByteRange`，补 416 |
| G15 | R4 | SSE/轮询进度与断线重连 | S | 与 G4 同批 |
| G16 | R5 | 影库（工具侧 `library` 子路由，读本地索引） | M | 页面不可达时唯一入口 |
| G17 | R5 | 回收站（列表/恢复/清空/到期） | M | 与删除、配额联动 |
| G18 | R5 | 本地优先与防误删（远端失败不删/不覆盖） | S | 改写现有下载流程 |
| G19 | R5 | 文件缺失/损坏检测 + `missing` 状态 | S | 不做自动删除 |
| G20 | 清理 | 删除 `page-capture` / `local-response` / `feasibility` / `archive/resources` 及文档 | M | `data-layers:check`、自检 |
| G21 | 诊断 | 自检改写（消息目录、Range/416、token、硬链、manifest） | S–M | 与 G14/G6 同批 |
| G22 | 文档 | 模块记忆重写（新架构、目录、命令、验收） | S | 迁移完成后 |

## 6. 分阶段落地

> 当前进度：**阶段 0 进行中**。已完成构建脚本、loopback 托管（16/16 冒烟）、主进程/快照/IPC/页面切换、
> 导航闸与观测过滤、telegram-tt 适配层骨架与 `mediaLoader` 接入；剩余 submodule 注册（沙箱阻断）、
> Node 24 下的 `npm ci/build` 与真实登录验证。详见
> [集成指南 §0.1](./telegram-cache-telegram-tt-integration.md#01-实现进度阶段-0)。

**阶段 0：集成打通（先做）**
submodule + Node 24 构建 + `site-server`（同源 + SW 头）+ 登录 + 一条图片和一条视频的"命中本地→本地播放"。
验收：断网后已缓存的媒体仍可播放；SW 作用域为 `/`。

**阶段 1：归档闭环（R1 + R3 基础）**
右键缓存单条消息（含相册/caption/entities）→ 目录 + `text.md` + `manifest.json` + 硬链；工具面板与"打开目录"可查看；
`.part` 断点与 SHA 校验。

> 进度：后端已落地（`message-store` / `archive-api` / `media-resolver` / `telegram-tt` 的 `archive.ts`）；
> 已用 Electron 桩验证 12/12（含 prepare/跳写/commit/manifest/媒体索引），剩余应用内真实登录验收。

**阶段 2：标记（R4 前半）**
批量状态 + `statusStore` + 角标 + 菜单三态（缓存/取消/在文件夹中显示）+ SSE 进度；重启后状态一致。

> 进度：右键三态（缓存 / 在文件夹中显示 / 移除）、相册整组、`MessageMeta` 角标、回收站后端
> （删除 / 列表 / 恢复 / 清空）已接入；SSE 进度与影库/回收站 UI 仍待做。

**阶段 3：媒体复用（R2）**
`mediaLoader` 三支命中；SW 分片先查后端并写回；页面缓存优先；"为什么没省流量"的可解释提示。

**阶段 4：本地优先与保留（R5）**
远端失败不删/不覆盖；`missing` 状态；"原消息不可用"标记；断网可用性验收。

**阶段 5：影库与稳定化**
`library` 子路由（搜索/播放/删除）、回收站 UI、配额审计、诊断扩展、清理旧模块（G20）、模块记忆重写。

> 进度：影库与回收站 UI 已接入（`LibraryPanel.vue` + `message-library.ts` + IPC，含内置播放）；
> SSE 实时进度已接入（`/events` + `statusStore` EventSource）。G20 已退役 page-capture / local-response /
> feasibility / telegram-media-adapter / archive-service（含 MTProto 与 HTTP「归档」）；模块记忆已重写；
> 仅剩 cache-manager 本地响应计量与 `serveClass` 元数据两处无害残留。

## 7. 验收清单（手工）

1. `npm ci && npm run build:production`（Node 24）通过；`dist/index.html` 存在；`npm run check:ts/css` 通过。
2. 主进程托管后：页面加载、登录、重启仍登录；SW 作用域 `/`。
3. 右键缓存一条「图片 + 视频 + 长文」消息：目录/`text.md`/`manifest.json`/媒体齐全，可在资源管理器打开。
4. 相册：右键任一张 → 整组逐条归档（每条一个目录/manifest，`groupedId` 一致），编号与正文正确。
5. 同一媒体被两条消息缓存：`objects/` 一份；硬链模式磁盘增量≈0。
6. 播放已缓存视频：`<video src>` 指向 `/media/...`；拖动进度条正常；网络面板无 CDN 请求。
7. 断网重启：已缓存图片/视频可播放；影库可浏览；页面不因网络失败而丢状态。
8. 删除消息后：本地内容仍在，角标"原消息不可用"；影库可播放。
9. 删除进回收站：恢复回原路径；到期/清空后目录与无引用对象释放。
10. 清理缓存/LRU：消息目录文件仍可打开（硬链/复制都验证）。
11. 本地服务安全：无 token / 外部 Origin / 越界路径 → 401/403/404；Range 越界 → 416。
12. 切换账号：不串号；提示清理。
13. 关闭"保存正文"：磁盘无 `text.md`。
14. 自检全绿（消息目录、Range、token、硬链、manifest）。

## 8. 风险与回滚

| 风险 | 触发 | 缓解 |
| --- | --- | --- |
| SW 作用域错误导致视频不可播 | 托管未加 `Service-Worker-Allowed` | 阶段 0 首项验收；服务端单测该响应头 |
| Node 版本冲突导致构建失败 | 用 everydaytool 的 Node 构建 telegram-tt | 版本检查 + 文档 + CI 分 job |
| 上游升级破坏触点 | telegram-tt 改 `mediaLoader`/消息组件 | pin commit、`edt/main` 分支、rebase 流程、触点 ≤4 |
| 登录态迁移（origin 变化） | 从原站切到本地 origin | 一次性重新登录；会话落在 `<data>/session` 并随迁移 |
| 本地服务被探测 | 端口/token | 只绑 127.0.0.1、随机端口、token+H-C 校验、只读 |
| 磁盘膨胀 | 视频批量归档 | 独立配额 + 硬链优先 + 回收站 + 影库用量 |
| 硬链被误解 | 用户手动删文件 | 文档说明；删除只走工具入口并做引用判断 |
| GPL 分发 | 未来对外发布 | 先定许可证（整仓 GPL / 独立组件），否则不分发 |

## 9. 决策记录

**已定（v4）**
1. 前端用 telegram-tt **源码**（submodule），不保留原站功能路径。
2. everydaytool **不对外分发**（GPL 分发义务不触发）。
3. 主进程 **loopback HTTP 同源托管**（静态 + API + 媒体），页面无 preload、无 IPC。
4. 媒体接入在 `mediaLoader` + 消息组件（≤4 触点），不做注入/CDP/自定义 scheme/查看器接管。
5. 影库 `library` 子路由；删除进回收站；`archive/resources/` 删除、不迁移。
6. 消息目录 + 硬链 + `text.md` + manifest 快照；原消息不可用时本地保留。
7. MTProto 独立客户端降级为可选 headless 补档。

**遗留**
1. 相册之外的多消息批量归档（选择范围/整个话题）是否第一期做？
2. 影库是否需要"按大小/时间排序 + 批量删除"（第一版只做搜索与单条）？
3. 回收站到期是静默清理还是清理前提示一次？
4. 是否把 `.env` 的 MTProto 会话用于页面自动登录（跳过手机号登录）——技术上可行但会模糊两套会话边界，默认不做。

## 10. 本轮不做

- 不做原站（`web.telegram.org`）的任何功能，也不保留原站路径；回滚只靠 submodule 版本。
- 不读/解析 Chromium 磁盘缓存文件。
- 不接管消息发送、上传、已读等其它逻辑；只做媒体缓存/归档/播放。
- 不绕过 `noforwards` 等内容保护。
- 不分发安装包（GPL 结论未定前）。

## 附：文件地图变化（目标）

```
新增
  telegram-tt/（submodule，未修改上游历史）
  telegram-tt/src/util/edt/{env,cacheApi,mediaBridge,archive,statusStore,types}.ts
  tools/telegram-cache/backend/services/{site-server,message-store,message-library,trash-service,local-media-server}.ts
  tools/telegram-cache/renderer/pages/LibraryPage.vue（子路由 library）
删除/退役
  tools/telegram-cache/backend/services/{page-capture-service,local-response-service,feasibility-service}.ts
  tools/telegram-cache/backend/services/archive-service.ts（由 message-store 取代）
  <assets>/telegram-cache/archive/resources/（无内容，直接删）
修改
  tools/telegram-cache/backend/index.ts（启动 site-server、注册新服务）
  electron/main.ts（若需要，允许该 webview 加载 loopback；导航闸复用）
  shared/telegram-cache.ts（消息/回收站/影库类型；移除注入与 M3 报告相关类型）
  shared/data-layers.ts（messages/trash 条目；删除 telegram-cache.archive）
  tools/telegram-cache/backend/services/{observation,snapshot,self-test}.ts
  docs/telegram-cache.md（迁移完成后重写）
```
