# telegram-cache 模块记忆

> 「Telegram 网络优化」工具的开发记忆。**改动相关文件前先读对应小节。**
> 方案来源：[telegram-network-resource-optimization-plan.md](./telegram-network-resource-optimization-plan.md)
> 当前实现阶段：**M0（被动观测）+ M1（资源索引 / 任务去重）+ M2（HTTP 缓存语义 / 配额淘汰 / 图片本地响应 + 音视频单区间 Range，默认关闭）+ M3-A（CDP 页面图片捕获，默认关闭）+ M3-B（MTProto 消息媒体下载，需 `.env` 凭据 + 会话）**，落地选择见 §1.2。

## 1. 概览

### 1.1 工具定位

内嵌 Telegram Web A（`https://web.telegram.org/a/`）的独立分区 webview，在**不改写页面请求、不注入脚本**的前提下：

1. 用 Electron `webRequest` 观测普通 HTTP(S) 请求（方法 / 类型 / 状态 / 响应头大小 / 缓存命中）；
2. 把观测到的资源按「规范 URL 哈希」建档（资源索引）；
3. 用户点「存库 / 归档」时先查资源库、再进单飞任务协调器，保证同一资源只有一个底层下载；
4. 提交前校验大小并计算 SHA-256，临时文件原子 rename 成内容对象；
5. 归档复制独立副本（内容寻址 + 自带 meta.json），不受以后缓存淘汰影响；
6. 按 HTTP 语义判定缓存准入与新鲜期，按配额 LRU 淘汰；可选地把命中缓存的**图片**用本地文件响应（默认关）；
7. 可选地通过 CDP 捕获页面**已经下载完成**的图片字节直接落库（M3 路径 A，默认关），
   并输出 M3 可行性报告（HTTP / WebSocket / blob 线索 + MTProto 前置条件）；
8. 提供能力矩阵、页面只读探测、自检（单飞 + HTTP 语义 + Range + 304）与**脱敏**诊断导出。

- 工具 id：`telegram-cache`；页签 / 子路由：`overview` / `resources` / `tasks` / `diagnostics`。
- `supportedTargets: ['win', 'mac']`（依赖主进程 webRequest 与文件写入，网页预览不注册）。
- 主题色 `#2aabee`，图标 `telegram`（`renderer/shared/components/ui/icons.ts`）。

### 1.2 本轮明确不做（不要擅自补上）

| 能力 | 状态 | 原因 |
| --- | --- | --- |
| 用本地缓存替换页面响应 | **受控可用，默认关闭** | 图片整份 + 音视频单区间 Range 各一个开关；只对已校验且新鲜的条目生效，见 §5 |
| 注入脚本 / 页面 DOM 加按钮 | 不做 | 用户选择工具侧面板；避免依赖 Telegram DOM |
| 页面媒体捕获（blob / 播放中数据） | 部分：HTTP 图片可捕获（CDP，默认关） | blob / 播放中数据 / MTProto 明文仍不可得 |
| 独立 MTProto 下载器（teleproto / api_id） | **可用（需 `.env` 凭据 + 会话）** | 按消息链接下载单条消息媒体；实现见 §6.3 |
| 消息级存档（正文 / 附件清单） | 部分：单条消息 | MTProto 下载会在归档旁写 `message.json`（正文 + 媒体清单）；不含相册/批量 |

## 2. 文件地图

```
shared/telegram-cache.ts                 共享类型 / 常量 / 默认值（纯类型与纯函数）
shared/webview.ts                        TELEGRAM_WEBVIEW_PARTITION（webview 与后端共用）

tools/telegram-cache/index.ts            工具定义（子路由）
renderer/config/tools.ts                 注册表
electron/tool-registry.ts                backend 注册（必须最后初始化，见 §7）
electron/ipc-namespaces.ts               preload 命名空间 telegramCache
scripts/build-electron.mjs               backend 入口 glob（漏加会运行时 Cannot find module）
scripts/telegram-session.mjs             一次性 MTProto 登录（打印 session，不写文件）
.env.example                             凭据字段示例（.env 已被 gitignore 忽略）

tools/telegram-cache/backend/
  index.ts                               初始化 / 退出顺序
  ipc/channels.ts                        30 个通道（EVENT_ 前缀为推送）
  ipc/handlers.ts                        safeHandle + 入参校验（只接受资源键 / id / 枚举 / 消息链接）
  store/config-store.ts                  config.json（观测 / 并发 / 上限 / 配额 / 本地响应 / 页面捕获）
  store/resource-registry.ts             registry.json（内容对象 + HTTP 缓存元数据 + 来源类型 / 指纹）
  services/telegram-session.ts           分区 session 单一来源
  services/identity.ts                   URL 身份 / 脱敏展示 / 键格式校验
  services/observation-service.ts        M0：webRequest 观测、统计、资源内存表
  services/http-semantics.ts             M2：Cache-Control / Vary / 新鲜度 / 单区间 Range 纯函数
  services/cache-manager.ts              M2：配额记账 / LRU 淘汰 / 显式清理 / 计量
  services/benchmark-core.ts             M2：基准计数差值纯函数（含回绕检测）
  services/benchmark-service.ts          M2：基准测试开始/结束/落盘（benchmarks.json）
  services/local-response-service.ts     M2：受控 protocol.handle 本地响应（默认不安装）
  services/page-capture-service.ts       M3-A：CDP 页面图片捕获（默认不附加）
  services/feasibility-service.ts        M3：环境 / 依赖 / §19 检查清单 / 流量分类
  services/mtproto-link.ts               M3-B：消息链接解析（t.me / tg://，拒绝邀请链接）
  services/mtproto-download-core.ts      M3-B：分块下载核心（追加写 / 增量哈希 / committed / 取消，可离线测试）
  services/mtproto-chunk-plan.ts         M3-B：库无关分块与续传字节数学（纯函数）
  services/mtproto-service.ts            M3-B：teleproto 连接 / 续传下载 / 归档清单 / 取消
  services/telegram-media-adapter.ts     M3-B：运行要求与报告文案（不连接、不读凭据值）
  services/snapshot-service.ts           快照聚合 + 700ms 节流推送
  services/task-manager.ts               单飞协调器（优先级 / 并发 / 取消 / 重试）
  services/download-service.ts           下载、哈希、大小校验、原子提交、页面捕获落库
  services/archive-service.ts            归档副本 + meta.json + 索引
  services/probe-service.ts              guest 只读探测 + 导航 allowlist
  services/diagnostics-service.ts        脱敏诊断包（含 M3 报告）
  services/self-test-service.ts          18 项自检（单飞 7 + HTTP 3 + Range + 304 + 分块 2 + 下载核心 2 + 链接 + 基准）
  utils/env.ts                           .env / 环境变量读取（api_id / api_hash / session，仅主进程）
  utils/session-store.ts                 safeStorage 加密会话读写（<data>/config/telegram-cache/telegram-session.bin）
  utils/paths.ts                         分层布局 + 索引相对路径的层路由

tools/telegram-cache/renderer/
  pages/TelegramCachePage.vue            左 webview + 右面板，路由驱动视图
  components/{Overview,Resources,Tasks,Diagnostics}Panel.vue
  stores/telegramCacheStore.ts           快照 + 事件订阅 + 动作
  tabs.ts / ipc.ts / webview.ts / utils/format.ts
```

## 3. M0：观测口径（重要）

挂载点：`telegramCacheBackend.initialize()` → `attachTelegramObservation()`，在 webview 首次导航前完成。

只注册 **3 个非阻塞回调**：`onResponseStarted` / `onCompleted` / `onErrorOccurred`。
**不要**改用 `onBeforeRequest` / `onHeadersReceived` / `onBeforeSendHeaders`——它们是阻塞型监听器，
必须调用 callback 才能放行请求，一旦漏调就会让页面请求挂起（观测模式不该进入那条路径）。
本工具不调用任何 callback、不改响应头、不改请求头。

统计规则：

- **只记录有 `webContentsId` 的请求**。主进程自己的 `session.fetch`（资源下载）没有 webContentsId，
  会被排除，否则下载会被重复计成页面流量。Service Worker 发起的请求也可能没有归属 → 页面探测会提示这是盲区。
- 大小取 `content-length`（压缩响应即压缩后大小）；缺失则记入 `unknownSizeCount`，**不计入 networkBytes**。
- `durationMs` 是「首字节 → 完成」的**响应阶段耗时**，不是请求总耗时；`at` 是完成时刻。
- `networkBytes` 只累加「非 `fromCache`」的完成请求；`fromCache` 单列并用于命中率。
- `cacheHitRate` 是**观测口径**，不等于省流量；UI 与诊断包都这么写，不要改成「已节省」。
- 资源清单只收 `GET` 的 http(s) 请求；ws/wss 计入类型统计但不进资源清单（不可下载）。
- 内存表：最近请求 300 条、资源 300 条；主进程与渲染层共用 `shared/telegram-cache.ts` 的上限常量。

**隐私硬约束**（改动观测 / 诊断时必须保持）：

- 响应头白名单：`content-type` / `content-length` / `content-encoding` / `cache-control` / `etag` /
  `last-modified` / `accept-ranges` / `age` / `access-control-allow-origin`；
  **永不存 Cookie / Authorization / 请求头原文 / 响应体 / 消息正文**。
- 展示地址：`scheme://host/path?参数名=***`（最多 4 个参数名）；完整 `fetchUrl` 只留在主进程内存，
  不写日志、不落盘（重启后该资源不能再按地址重新下载，但已入库内容仍可归档）。
- referrer 不记录，只记录 resourceType / 方法 / 状态 / 大小 / 耗时。

## 4. 资源身份与索引（M1）

- 键格式：`http:v1:<sha256(origin+pathname+search)[0..40]>`；WebSocket 用 `ws:v1:` 前缀。
  **不删除任何 query 参数**：Telegram 的短期签名在 query 里，归一化会错误合并不同资源。
- 只丢弃 fragment 与 URL 凭据；大小写 / 默认端口由 `URL` 规范化。
- 索引 `registry.json`：只登记 `completeness=complete && verification=verified` 的条目；
  下载中的 `.part` 永远不进索引。
- 内容对象 `objects/<sha[0:2]>/<sha256>`：文件名即哈希，天然按内容去重。
- 启动恢复：`pruneTelegramRegistry()` 删除「索引指向的文件已不存在」的条目（等价 cache miss）。
- 索引上限 500 条，超出优先淘汰「最久未访问且 `archiveRefs=0`」的条目，并顺手删除不再被任何条目引用的对象文件。
- 记录里的 `cache` 字段保存 HTTP 语义（见 §5）；旧索引没有该字段时按「不可本地复用」处理。

## 5. M2：HTTP 缓存语义、配额与本地响应（默认关闭）

### 5.1 缓存准入（`http-semantics.ts`，纯函数）

- 解析 `Cache-Control` 子集：`no-store` / `no-cache` / `private` / `public` / `max-age` /
  `must-revalidate` / `immutable`，以及 `Vary` / `ETag` / `Last-Modified` / `Age`。
- **不使用启发式新鲜度**：没有 `max-age` 就 `freshUntil=null`，永不本地复用（`Expires` 也不参与）。
- 可本地复用（`cacheable`）必须同时满足：`image/*` 或 `video/*` 或 `audio/*`（`serveClass` 分别为
  `image` / `media`）+ 状态 200 + 非 `no-store/private/no-cache` + `max-age > 0` +
  `Vary` 只有 `accept-encoding`。
- 具体能否被响应由模式开关决定：`image` 只受 `localResponseEnabled` 控制，
  `media` 只受 `localMediaRangeEnabled` 控制（音视频需单独验收）。
- `quotaManaged = !no-store`：`no-store` 内容只作为用户主动保存 / 归档的数据保留，不占缓存配额、不参与 LRU。
- 新鲜期会扣掉上游 `Age`：`freshUntil = storedAt + (max-age - age) * 1000`。
- 原响应的 `access-control-allow-origin` 会随记录保存，本地响应时原样回放（否则跨域 fetch 形态的图片会被 CORS 拦下）。

### 5.2 配额与淘汰（`cache-manager.ts`）

- 配额 `config.cacheMaxBytes`：默认 3GB，clamp 256MB–20GB；按「唯一相对路径」记账，同内容多键不重复计费。
- 超出后按 `lastAccessedAt` 从最久未访问开始淘汰，跳过：
  1. 正在 queued / running 的资源键（由 download-service 注入 provider 实时读取）；
  2. `quotaManaged=false`（no-store 用户保存内容）；
  3. `archiveRefs>0` 且**归档副本真实存在**的条目——有独立副本时删缓存对象是安全的；
     只有指针、文件已不存在的归档引用会阻止删除。
- 删除条目后，只有「没有其它条目引用同一对象文件」时才删文件（内容寻址共享）。
- 「清理缓存」= 同一套跳过规则下的全量清理（用户主动操作），保留唯一副本与 no-store 内容。

### 5.3 本地响应复用（`local-response-service.ts`，**默认关闭**）

- 两个独立开关：`localResponseEnabled`（图片）与 `localMediaRangeEnabled`（音视频单区间 Range）。
  任一开启才注册 `session.protocol.handle('http'/'https')`；全部关闭即 `unhandle` 卸载。
  启动时按配置决定是否安装。
- 命中条件（全部满足才返回本地文件）：
  `GET` + 请求未声明 `no-cache/no-store`（强制刷新一律回源）+ http(s) 资源键 + 索引中校验完整 +
  `cacheable` + 对应模式开关开启 + 仍在新鲜期（或 304 验证通过）+ 对象文件存在 +
  请求 `Accept` 兼容 MIME + Vary 可接受。
- 整份响应：`content-type` / `content-length` / `etag` / `last-modified` /
  `cache-control: public, max-age=<剩余>` / `age` / 原 ACAO / `accept-ranges: bytes` /
  `x-edt-telegram-cache: hit`；页面带 `If-None-Match` 且 ETag 相同时直接 304。
- **单区间 Range**（媒体开关下）：`bytes=start-end` / `start-` / `-suffix` → `206` +
  `Content-Range: bytes start-end/total` + 正确的 `Content-Length`；
  起点越界 → `416` + `Content-Range: bytes */size`；多区间、非法语法、`If-Range` 不匹配 → 回源（不自行拼接）。
  图片默认整份响应，但同样支持区间（不会改变既有行为）。
- **过期条目的条件验证**（仅无 Range 的请求）：带 `If-None-Match` / `If-Modified-Since` 回源；
  - `304` → 用响应头（缺省沿用旧头）刷新新鲜期，写入索引后返回本地内容；
  - `200` → **失效旧条目**（删索引，必要时删对象）并把新响应交给页面；
    不在这里二次落盘，避免与页面消费争抢同一份流量；
  - 其它状态 / 网络失败 → 原样交给页面或回源。
  带 Range 的过期请求不做验证，直接回源（否则会把 200 整份响应塞给期待 206 的播放器）。
- **未命中一律回源**：`session.fetch(request, { bypassCustomProtocolHandlers: true })`，
  绝不返回半份内容；任何异常也回源；下载任务本身也带该标志，避免自己命中自己。
- 代价：`protocol.handle` 接管分区 http(s) 后，页面请求可能不再出现在 webRequest 观测里
  （取决于 Electron 版本）。UI 明确写「观测覆盖与本地复用不能同时保证」，这是可接受的取舍而不是 bug。
- 多账号：**当前不做自动隔离**。无法从页面可靠取得账号身份；缓存按 session 分区共享。
  切换账号前必须「清理缓存」并关闭本地复用（UI 与文档都有提示）。真正的账号级隔离要等能拿到
  稳定的 account scope（M3 MTProto 或页面身份）后再做，**不要用猜测字段实现**。

### 5.4 基准测试（`benchmark-service.ts`）

- 目的：用「开始 / 结束累计计数的差值」验证流量变化，而不是只数缓存命中次数。
- 计数来源：webRequest 观测（requests / completed / failed / fromCache / networkBytes /
  unknownSizeCount）+ 缓存计量（servedBytes / localHits / localMisses / revalidations）+ 页面捕获字节。
- 同一时间只允许一段测试；开始记录快照，结束把差值写入 `benchmarks.json`（最多 50 条，可清空）。
- 测试期间清空观测会让计数回绕：`diffBenchmarkCounters` 检测后把字段归零，并在样本 `note` 标注「可能无效」。
- 口径：`networkBytes` 来自响应头 `content-length`，只覆盖可观测 HTTP 请求，**不等于网卡真实流量**；
  `cacheServedBytes` 是本地返回的响应体大小。建议 baseline（本地响应关）→ with-cache（开启）同场景对照。

## 6. M3：页面数据捕获（路径 A）与可行性报告

### 6.1 捕获适配器（`page-capture-service.ts`，默认关闭）

- 开关 `config.enablePageCapture`；开启后对 guest `webContents.debugger.attach('1.3')`，
  `Network.enable`（总缓冲 64MB、单资源 20MB），监听 `Network.responseReceived` /
  `loadingFinished` / `loadingFailed`。
- 只处理 `type=Image` 且 `mimeType=image/*` 的响应；`loadingFinished` 后串行调用
  `Network.getResponseBody`（base64），**上限 16MB**，超限/取不到 body 记 miss，不重试。
- 落库复用 `storeCapturedContent()`：SHA-256 → 内容寻址对象 → 索引（`sourceType=page-captured`），
  **不产生额外网络请求**；同内容已存在时只更新访问时间。
- HTTP 缓存元数据同样从 CDP 响应头计算（`Cache-Control` / `ETag` / `Vary` / `Age` / ACAO），
  因此捕获到的条目也能参与 M2 的本地响应与配额。
- 与开发者工具**互斥**：`debugger.attach` 被占用时抛错 → 记录 `attachError` 并保持关闭；
  DevTools 打开导致 detach 时同样记录原因，页面本身不受影响。
- 关闭 / 页面销毁 / 退出：`Network.disable` + `detach` + 清空 pending；不做任何页面写入。
- 不捕获：`blob:`、播放中数据、MTProto 明文、视频/音频（首轮只验证图片）。

### 6.2 可行性报告（`feasibility-service.ts`）

`M3_REPORT` 返回并写入诊断包：

- `environment`：Electron / Chromium / Node 版本、guest UA、页面地址、SW / blob / 媒体元素线索；
- `dependencies`：teleproto 是否安装与版本（只 resolve，不 import、不连接）；
- `checks`：§19 检查清单（`pass` / `fail` / `blocked` / `manual`），覆盖运行时、页面探测、
  媒体路径判定、teleproto、凭据、会话存储、分块数学、完整性校验、账号 scope；
- `observation`：图片 / 媒体 / WebSocket 请求计数、按类型分布、Top 主机、最近探测的 blob 线索；
- `capture`：可用性、是否附加、命中 / 失败 / 捕获字节、支持范围与限制；
- `mtproto`：`available=false` + 前置条件清单；
- `decision.httpMediaMajority`：`true`（样本媒体全走 HTTP）/ `false`（几乎没有 HTTP 媒体）/
  `null`（数据不足或两条路径并存）+ 一句可执行的结论。

**注意**：分类来自 resourceType 计数，不含字节量；WebSocket 数量不能推断媒体体积，
所以「判定」只用于决定下一步验证方向，不代替基准测试。

### 6.3 MTProto 路径 B（已实现，需 `.env` 凭据）

- 依赖：`teleproto@1.232.0`（GramJS 的活跃维护分支；会话 `StringSession` 同为 version 1 格式）。
  teleproto 的 `iterDownload(file, params)` 直接接受 number offset，不再需要显式 `big-integer`。
  连接用 `transport: new WebSocketTransport()` 取代旧版的 `useWSS: true`。
- 凭据只从进程环境或 `.env` 读取（项目根 → 数据目录 → userData，`process.env` 优先）：
  `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION`。**绝不出主进程、不进日志、不发渲染层**。
- 会话存储：首次用 `.env` 明文连接成功后，自动迁移到 Electron `safeStorage` 加密文件
  （`<data-root>/config/telegram-cache/telegram-session.bin`，Windows DPAPI / macOS Keychain）；之后优先读加密存储，
  解密失败才回退 `.env`。诊断页提供「迁移到加密存储 / 清除加密会话」，并显示来源与 safeStorage 是否可用。
  **注意**：safeStorage 不可用的平台上仍会回退 `.env` 明文，UI 会明确标出。
- 登录：`pnpm telegram:session`（交互输入手机号 / 验证码 / 二步密码，打印 session 让你粘回 `.env`；
  脚本不写文件、不保存会话）。`.env` 已被 `.gitignore` 忽略。
- 入口：诊断页「MTProto 消息下载」输入
  `https://t.me/<name>/<id>` 或 `https://t.me/c/<channelId>/<id>`。
  私密链接要求频道已在当前账号对话列表中（access hash 来自会话实体缓存）。
- 资源键：`tg:v1:<accountId>:<peer>:<messageId>:<kind>`，`sourceType=telegram-mtproto`；
  同一消息媒体用指纹（kind + mediaId + size）判断是否已下载。
- 下载：`client.iterDownload(file, { offset, limit, requestSize, signal })` 从已提交偏移续传；
  每块写入后更新哈希与 committed，800ms 落盘断点（`mtproto/partial/<sha1>.json`）。
  完成后校验总大小并计算 SHA-256；`FILE_REFERENCE_EXPIRED` 会重新拉取消息重试一次，
  若媒体大小变化立即停止（避免拼接错误内容）。
- 完成：内容对象进 `objects/`，归档副本旁写 `message.json`
  （link / peer / messageId / date / 正文截断 20k / 文件名 / MIME / 大小 / SHA）。
- 约束：单任务串行；取消保留断点；退出时 abort 并断开客户端；`noforwards` 消息直接拒绝（不绕过保护）。
- 限制：只处理单条消息的媒体；相册/批量消息、话题分组、受保护内容不做；
  会话优先存 OS 加密文件，`.env` 仅作首次引导与回退（该文件权限由用户负责）。

### 6.4 §19 验证状态

- `mtproto-download-core.ts`：把「追加写 / 增量哈希 / committed 推进 / 取消」抽成不依赖 Electron 的核心；
  自检用真实临时文件验证「取消后按 committed 续传」「异常后截断续传」两条路径，最终 SHA-256 与源数据一致。
- `mtproto-chunk-plan.ts`：库无关的分块 / 续传字节数学，已通过自检
  （`planChunks`、`mergeRanges`、`committedBytes`、`missingRanges`、`isComplete`）。
  它不替代对 teleproto 真实 offset 语义的验证——接入是否按 `limit` 返回字节仍需固定媒体实测。
- 自检共 18 项（单飞 7 + HTTP 语义 3 + Range + 304 + 分块 2 + 下载核心 2 + 链接解析 + 基准差值）。
- 报告 `checks` 区分「已配置 / 受阻（凭据、会话、账号 scope）/ 待人工验证（SHA-256 对照）」。

## 7. 单飞任务协调器

`SingleFlightTaskManager<T>`（不依赖 Electron，可注入 runner）：

- `acquire()`：同键有活动任务 → 作为消费者**合并**（`joinedConsumers++`），否则建任务排队；
- 优先级：0 正在观看 / 1 用户主动（归档）/ 2 可视区（存库）/ 3 聊天补齐 / 4 后台 / 5 预取；
  同优先级 FIFO；排队中的任务被更高优先级消费者加入时会提升（仅 archive）；
- 并发：单池 `maxHttpConcurrency`（配置 1–8，默认 3），`pump()` 按优先级启动；
- 取消：`cancelConsumer` 只影响该消费者；全部消费者取消才 abort 底层下载；
- 失败：`NonRetryableTaskError`（4xx / 超限 / 空响应 / 大小校验失败）不重试；
  其它错误按 `maxAttempts`（3）指数退避重试（300ms → 600ms，上限 4s）；
- 结算后一定从活动表删除、归还并发槽、写历史（上限 50 条），不会留僵尸任务。

自检 `runTelegramSelfTest()` 覆盖 12 项不变量（单飞 7 + HTTP 语义 3 + Range 1 + 304 刷新 1），
可在 Node 下直接跑（无需 Electron）：

```bash
node --experimental-strip-types --input-type=module -e "import('./tools/telegram-cache/backend/services/self-test-service.ts').then(m => m.runTelegramSelfTest()).then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 1) })"
```

## 8. 下载 / 归档 / 诊断

下载（`download-service.ts`）：

1. 资源库命中且对象文件存在 → 直接复用（`reused=true`），**不产生网络请求**；
2. 否则从观测表取完整地址（渲染层只传资源键），进单飞任务；
3. 写 `tmp/<随机>.part`，边写边算 SHA-256；`content-length` 存在且响应未压缩时校验大小；
4. 原子 rename 到 `objects/…`；同哈希已存在则复用对象、删临时文件；
5. 写索引；`kind=archive` 的消费者在完成后做归档复制。

归档（`archive-service.ts`）：`archive/resources/res-<sha前16位>/resource.<ext>` + `meta.json`；
文件名由 MIME 推断，**不用原始文件名 / 用户文本**；`archive-index.json` 记录指针；
同一内容幂等（只加引用计数）；复制同样走「临时文件 → 校验大小 → rename」。

诊断（`diagnostics-service.ts`）：导出到 `cache/telegram-cache/diagnostics/diagnostics-<时间>.json`，
含 runtime 版本、配置、能力矩阵、缓存统计、M3 可行性报告、统计、请求、资源、任务、归档，全部已脱敏。

## 9. IPC 与注册

通道（`backend/ipc/channels.ts`）：`SNAPSHOT_GET` / `CONFIG_SET` / `OBSERVATION_SET_ENABLED` /
`OBSERVATION_CLEAR` / `TRAFFIC_GET` / `PAGE_ATTACH` / `PAGE_PROBE` / `ACQUIRE` / `TASK_CANCEL` /
`ARCHIVE_LIST` / `ARCHIVE_OPEN_DIR` / `CACHE_CLEAR` / `SELF_TEST` / `M3_REPORT` / `MT_STATUS` /
`MT_DOWNLOAD` / `MT_CANCEL` / `MT_SESSION_MIGRATE` / `MT_SESSION_CLEAR` / `BENCHMARK_STATUS` /
`BENCHMARK_START` / `BENCHMARK_STOP` / `BENCHMARK_CLEAR` / `DIAGNOSTICS_EXPORT` / `OPEN_DATA_DIR` /
`EVENT_SNAPSHOT` / `EVENT_TRAFFIC` / `EVENT_TASK` / `EVENT_MTPROTO` / `EVENT_BENCHMARK`。

`CONFIG_SET` 同时承担四个即时生效项：观测开关、HTTP 并发、本地响应处理器安装 / 卸载、CDP 页面捕获附加 / 分离。
所有路径、URL、shell 参数都由主进程决定，渲染层只传资源键 / 页面内核 ID / 枚举 / 消息链接。

入参校验：资源键必须匹配 `^(http|ws):v1:[0-9a-f]{40}$`；webContentsId 必须是正整数且
`guest.session === session.fromPartition('persist:telegram-cache')`；kind 只接受 `cache|archive`。

新增工具时必须同步四处（漏一处就运行不起来）：

1. `renderer/config/tools.ts` 导入并加入 `allToolRegistry`；
2. `electron/tool-registry.ts` 加入 `toolBackends`（**放在最后**：`chrome-sandbox` 会 `loadDataDirectoryOverride()`，
   本工具也自己调用，但排在后面能拿到已加载的覆盖配置）；
3. `electron/ipc-namespaces.ts` 暴露 `telegramCache` 命名空间；
4. `scripts/build-electron.mjs` 的 `backendEntryPoints` 加入 `tools/telegram-cache/backend/**/*.ts`。

## 10. 页面宿主与安全

- webview：`partition="persist:telegram-cache"`，不加 `allowpopups`、不关 webSecurity；
  `electron/main.ts` 的 `will-attach-webview` 已剥离 preload 并强制隔离。
- 导航 allowlist（`probe-service.ts`）：`web.telegram.org` / `telegram.org` / `*.telegram.org` /
  `t.me` / `*.t.me`；其余 `will-navigate` / `will-redirect` 一律 preventDefault，
  仅 http(s) 交给系统浏览器；`window.open` 全部 deny 后外跳。
- 页面探测脚本是固定只读 IIFE（performance / 媒体元素 / Service Worker），返回值逐字段强转；
  永不把页面返回的字符串当命令 / 路径使用。
- 渲染层不持有完整 URL、不持有文件路径；所有写入路径由主进程按数据根目录拼。

## 11. 数据目录

分层布局（判据见 [data-layers.md](./data-layers.md)）：**配置 / 资产 / 会话 / 缓存**四层分开放，
路径全部由 `backend/utils/paths.ts` 解析，工具内不手拼根目录。

```
<data-root>/session/                    Chromium 会话数据（会话层）
  Partitions/telegram-cache/            Telegram Web A 的 Cookies / Local Storage / IndexedDB / Cache
<data-root>/config/telegram-cache/      配置层（不可再生）
  config.json            观测开关 / 并发 / 上限 / 缓存配额 / 图片与媒体 Range / 页面捕获开关
  registry.json          资源索引（含 HTTP 缓存元数据 / 来源 / MTProto 指纹）
  archive-index.json     归档索引
  telegram-session.bin   MTProto 会话密文（safeStorage；旧位置文件会自动迁移）
  benchmarks.json        基准测试样本（最多 50 条）
<assets>/telegram-cache/archive/resources/…   资产层：归档副本（含 meta.json；MTProto 另有 message.json）
                                              默认 <data>/assets；设置页可改到另一块盘；**源可能已被删，不可再生**
<data-root>/cache/telegram-cache/      缓存层（可再生）
  objects/<ab>/<sha256>  内容对象（HTTP 与 MTProto 共用，按内容去重）
  tmp/*.part             下载临时文件（崩溃后可安全删除）
  mtproto/partial/*.json MTProto 断点（key / 指纹 / 总大小 / committed）
  diagnostics/*.json     脱敏诊断包
```

**索引里的路径不带层前缀**：`registry.json` / `archive-index.json` 的 `relativePath` 是相对「工具命名空间」的
（`objects/ab/hash`、`archive/resources/…`），由 `resolveTelegramRelativePath()` 按首段路由到 cache / assets / config。
所以归档从数据目录搬到独立资产根后，**旧索引不需要改写**；清理缓存删掉 `objects/` 后，
索引按 `existsSync` 判定缺失并重新下载。

**会话目录物理落盘**：`electron/main.ts` 在 `ready` **之前**读取数据目录覆盖并调用
`app.setPath('sessionData', <data-root>/session)`（`backend/utils/session-data.ts`）。
Chromium 的所有会话数据（Cookies / LocalStorage / IndexedDB / Cache / `Partitions/*`）都直接写在该目录，
**不使用 junction / 软链**。首次采用 sessionData 时不迁移 userData 中的旧 Chromium 缓存；
用户主动切换数据目录时走整体迁移。应用自身的收藏 / 页签也存在 localStorage，会随 sessionData 一起迁移。

切换数据目录后：设置页只写 `data-root.pending.json` 并提示重启；本工具在重启时读取新目录。
**sessionData 只在启动时设置**：运行期不会立刻改变 Chromium 会话目录；下次启动在 ready 之前
把旧目录整体复制到新目录（含 `session`），成功后才切换，因此缓存与登录态保持有效；
迁移失败则继续使用旧目录并保留 pending，下次重试。

## 12. 手工验收清单

1. **观测**：打开工具 → Telegram 页面加载 → 概览里出现请求 / 类型 / 主机分布；关闭「观测」后新增请求不再记录，
   重新打开继续记录。页面行为无变化。
2. **隐私**：表格与诊断包里看不到 `?token=` 的值（只有 `***`）、看不到 Cookie。
3. **缓存命中路径**：资源行「存库」→ 任务完成 → 再点「归档」→ 提示「复用资源库内容，未重新下载」，tasks 里没有新的下载任务。
4. **单飞**：同一资源快速点两次「存库」（或先后点存库与归档）→ 任务列表出现 `合并 2 个消费者`，只有一个底层任务。
5. **取消**：下载中点「取消」→ 任务变已取消，活动任务数归零；重启后 `tmp/` 不产生可用对象。
6. **哈希与归档**：归档目录里出现 `resource.<ext>`、`meta.json`；`sha256` 与资源库记录一致。
7. **自检**：诊断页「运行自检」18 项全绿（单飞 7 + HTTP 3 + Range + 304 + 分块 2 + 下载核心 2 + 链接 + 基准）。
8. **能力状态**：诊断页探测应看到关于 blob / Service Worker / MTProto 的结论性提示；
   「MTProto 下载器」显示「已连接 / 已配置 / 需 .env」之一（不再是固定「未实现」）；
   「页面数据捕获」显示可用但默认关闭。
9. **缓存准入**：图片入库后资源行出现「可本地命中」或「已过期 · 条件验证」；
   非媒体 / `no-store` / `private` 的条目显示「不本地复用」；媒体条目在开关关闭时显示「媒体 Range 未开」。
10. **配额淘汰**：把配额调到 256MB，反复存大图直到超限 → 概览「累计淘汰」增长；
    已归档的对象在归档目录里仍然完好；`no-store` 保存内容不会被清理。
11. **图片本地响应（可选，默认关）**：诊断页打开开关 → 重新打开聊天 → 概览「本地命中 / 复用字节」增长；
    关闭开关后应完全回源（`handlerInstalled` 变 false）。**开启期间观测覆盖可能下降，属已知取舍。**
12. **媒体 Range（可选，默认关）**：打开媒体开关 → 播放已入库的视频，DevTools Network 里该请求应为
    `206` 且 `Content-Range` 与实际范围一致；拖动进度条仍可播放；关闭开关恢复源站 206。
13. **条件验证**：对已入库且已过期的图片重新打开聊天 → 概览「条件验证 / 304」计数增长；
    若源站返回 200，资源行应回到「仅观测/资源库失效」状态（旧条目已失效）。
14. **页面捕获（可选，默认关）**：诊断页打开「页面数据捕获」→ 重新打开聊天 →
    概览「页面捕获字节 / 命中」增长，资源清单里出现新条目（来源 page-captured）；
    打开开发者工具应导致捕获自动停止并显示分离原因；关闭开关后 CDP 附加状态为 false。
15. **M3 报告**：诊断页「运行检查」→ 显示图片 / 媒体 / WebSocket 计数、环境 / 依赖、§19 检查清单与判定；
    导出诊断包内应包含 `m3` 节点。`teleproto` 未安装时对应检查应为「受阻」，不会出现假通过。
16. **MTProto 配置**：`.env` 填好 api_id / api_hash 并运行 `pnpm telegram:session` 后，
    诊断页 MTProto 面板显示「已读取」、会话来源（`.env` 明文 / OS 加密存储）与 safeStorage 是否可用；
    缺字段时显示缺失清单，下载按钮应报错而不是静默失败。
17. **会话加密迁移**：首次连接成功后来源应变为「OS 加密存储」并出现
    `<数据目录>/config/telegram-cache/telegram-session.bin`；删除 `.env` 的 `TELEGRAM_SESSION` 后重启仍能连接；
    「清除加密会话」后回退到 `.env`（若仍存在）或显示缺失。
18. **登录缓存位置**：诊断页「Web 登录缓存」应显示 `<数据目录>/session/Partitions/telegram-cache` 并标记「数据目录」；
    该目录是**真实目录**（不是 junction / 软链），内容为 Chromium 的 Cookies / LocalStorage / IndexedDB / Cache。
    切换数据目录后应提示重启；重启会先把旧目录整体迁移到新目录再切换（**缓存与登录态保持有效**）。
19. **MTProto 下载**：公开链接与私密链接各试一条 → 进度条推进 → 完成显示 SHA-256 与归档相对路径；
    归档目录（`<assets>/telegram-cache/archive/…`）里出现 `resource.<ext>`、`meta.json`、`message.json`（正文截断 20k）。
20. **断点续传**：下载中取消 → `<数据目录>/cache/telegram-cache/mtproto/partial/` 出现断点；再次下载同一消息，
    面板显示「从 X 续传」，最终 SHA-256 与一次完整下载一致。
21. **基准测试**：关闭本地响应 → 开始 baseline → 固定聊天滚动/播放 → 结束；
    开启本地响应后重复 with-cache；诊断页应显示两条样本与「网络字节 Δ / 本地复用 Δ」。
    测试中清空观测会得到带「可能无效」note 的样本，而不是错误的负值。

## 13. 下一步（未实现 / 需验证）

- **MTProto 真实媒体验证**：分块 offset 语义、取消后续传、文件引用刷新、最终 SHA-256 对照
  仍需在固定聊天 / 媒体集合上跑一遍；自动化测试在这里无法覆盖网络与登录。
- **MTProto 扩展**：相册 / 多条消息批量、话题分组、受保护内容（noforwards）不做；
  会话已支持 safeStorage 加密与 `.env` 回退，safeStorage 不可用的平台仍为明文。
- **多账号隔离**：缓存按 session 分区共享；切换账号前必须清理缓存。稳定 account scope 已进入
  MTProto 资源键（`tg:v1:<accountId>:...`），但 HTTP 资源键仍无法区分账号。
- **页面捕获扩展**：目前只覆盖图片；视频（体积 / 内存 / 播放器 Range 交互）需单独验收；
  blob / 播放中数据仍不可得。
- 已从 GramJS 迁移到 `teleproto@1.232.0`（`telegram` / `big-integer` 依赖已移除）。
  `StringSession` 为同一 version 1 编码，旧 GramJS 会话通常可直接读取；若加载失败，重新运行
  `pnpm telegram:session` 生成即可。后续只需跟踪 teleproto 的 `iterDownload` 变更。
- 目前无法对「页面已播放的部分」做完整性判断，因此**不要**把 `fromCache` 或播放进度当成归档完成。
