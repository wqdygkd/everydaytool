# Telegram Web A（telegram-tt）网络资源优化与缓存复用方案

> 版本：1.0  
> 文档性质：可实施的工程设计与验收方案  
> 目标形态：Electron 外部包装层，不修改 `Ajaxy/telegram-tt` 仓库源码  
> 核心目标：减少重复网络传输、避免重复下载、复用页面已取得的媒体数据，并保持 Telegram Web A 原有聊天体验。

---

## 1. 执行摘要

建议实现一个运行在 Electron 外部包装层中的**网络资源协调器（Resource Coordinator）**，统一协调：

1. 页面自身已有的缓存和媒体数据；
2. Electron 可观察、可安全接管的普通 HTTP(S) 资源；
3. 独立 Telegram API / MTProto 媒体下载器；
4. 本地持久缓存；
5. 用户主动触发的消息存档任务。

本方案不把“拦截全部网络请求”作为前提。Telegram Web A 使用自定义 GramJS/MTProto、Worker、媒体流及多层缓存；部分媒体数据可能不经过普通 HTTP 图片/视频请求路径。必须先做网络路径探测，再对不同资源类型采用不同策略。

**核心原则：**

- 能复用页面已取得的数据，就不重新下载。
- 相同资源的并发请求合并为一个任务（single-flight）。
- 不主动下载用户尚未需要的完整媒体。
- 缓存允许淘汰，用户存档默认不可被缓存淘汰策略删除。
- 只在协议、资源身份和完整性都可确认时，才使用本地数据替代网络请求。
- 无法确认时，回退原始网络路径，不破坏页面行为。
- 流量节省必须用实际网络字节和可复现的基准测试验证，不能只数缓存命中次数。

## 2. 目标与非目标

### 2.1 目标

- 减少相同媒体被页面、存档工具或多个 UI 消费者重复下载的情况。
- 复用页面已经取得且可访问的媒体数据。
- 对普通 HTTP(S) 资源实现可验证的本地缓存复用。
- 对 Telegram 原生媒体建立独立的 MTProto 下载适配器，支持任务去重和可行的分块续传。
- 对下载任务提供优先级、并发限制、取消、失败重试和状态可观测性。
- 通过 Electron 注入脚本添加缓存/存档状态 UI，但不修改 telegram-tt 仓库文件。
- 缓存与存档共用经过验证的内容文件时，仍保持不同的生命周期和删除策略。

### 2.2 非目标

- 不保证所有 Telegram Web A 内部媒体请求都能通过 Electron `webRequest` 拦截。
- 不假设页面的私有模块、Worker 或媒体解码器一定可被注入脚本访问。
- 不承诺将所有 HTTPS 请求透明改写为本地协议；需要按资源类型逐类验证。
- 不修改 Telegram Web A 内部的 MTProto 协议实现。
- 不通过伪造 Telegram 服务器响应或绕过 Telegram 访问控制来取得媒体。
- 不将临时 URL、文件名、文件大小单独作为可信资源身份。
- 不把浏览器缓存命中直接视为“存档已完整”。

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│ Electron Renderer: Telegram Web A（原版页面）              │
│  - 原有聊天 UI、播放器、消息渲染                             │
│  - 外部注入脚本：资源观察、状态按钮、存档操作入口             │
└──────────────────────────┬─────────────────────────────────┘
                           │ 受限、版本化的 IPC
┌──────────────────────────▼─────────────────────────────────┐
│ Electron Main Process                                      │
│                                                            │
│  Resource Coordinator                                      │
│   ├─ Resource Registry / Identity Resolver                 │
│   ├─ Single-flight Task Manager                            │
│   ├─ Priority Queue / Concurrency / Cancellation           │
│   ├─ HTTP Cache Adapter                                    │
│   ├─ Page-Media Capture Adapter（可选、需能力探测）          │
│   ├─ Telegram MTProto Download Adapter                    │
│   ├─ Cache Manager                                         │
│   ├─ Archive Manager                                       │
│   └─ Metrics / Diagnostics                                 │
│                                                            │
│  Storage                                                   │
│   ├─ Cache Index + verified cache files                    │
│   ├─ Archive Index + immutable-by-default archive files     │
│   └─ temp / partial files                                  │
└────────────────────────────────────────────────────────────┘
                           │
           ┌───────────────┴────────────────┐
           ▼                                ▼
    普通 HTTP(S) 源站                 Telegram API / MTProto
```

### 3.1 组件边界

- **注入脚本**只负责识别页面可见的消息/资源线索、呈现 UI、发送用户意图和显示状态。不要让它直接拥有文件系统权限。
- **主进程**负责路径、文件写入、下载队列、索引、完整性校验和权限控制。
- **HTTP 适配器**处理普通 HTTP(S) 请求；先观察，后缓存，最后才考虑替换响应。
- **页面媒体适配器**尝试捕获页面已经拿到的数据。必须通过能力探测决定是否启用，不能假定内部下载函数可访问。
- **MTProto 适配器**只负责 Telegram 原生媒体下载与协议级分块；不能把 HTTP `Range` 逻辑直接套用到 MTProto。
- **缓存与存档**可共享同一份已验证内容，但各自维护引用、策略和生命周期。

## 4. 核心工作流

### 4.1 页面需要一个资源

1. 页面正常发起请求或用户触发媒体/存档动作。
2. 资源观察器尽可能提取资源线索：来源类型、稳定 ID、消息 ID、媒体属性、HTTP URL（如适用）。
3. Identity Resolver 生成或查找资源身份键。
4. Coordinator 查询页面可复用数据、持久缓存索引和正在运行的任务。
5. 如果有**已验证、完整、兼容当前请求**的缓存，允许适配器返回本地内容。
6. 如果有相同活动任务，将新消费者合并到该任务。
7. 否则根据资源类型、用户意图和优先级选择 HTTP 下载、页面数据捕获或 MTProto 下载。
8. 下载写入临时文件/分块；验证完成后原子提交并更新索引。
9. 各消费者得到完成状态；存档任务另外写入消息元数据与清单。

### 4.2 用户点击“存档消息”

1. 注入脚本读取可见消息的候选标识；无法可靠识别时，要求用户从消息菜单/详情中确认，而不是猜测。
2. 主进程验证请求并创建 archive job。
3. 存档先保存消息元数据和正文；附件按策略分配任务。
4. 对每个附件检查：页面已取得的可用数据 → 持久缓存完整文件 → 活动下载任务 → 新下载任务。
5. 所有附件均完整且清单提交成功后，消息存档状态变为 `complete`；否则标为 `partial` 或 `failed`，不能假报成功。
6. 归档可引用缓存中的同一内容对象，但不得因为缓存淘汰而失去归档文件。

### 4.3 页面播放与存档同时发生

1. 播放器请求资源，协调器（若能观测到该入口）创建任务。
2. 用户点击存档时，资源身份解析到同一资源。
3. 存档加入现有任务，复用已验证的数据或同一下载流。
4. 若播放器只能消费流而无法暴露完整字节，存档不能把“已播放部分”误认为完整文件；应继续补齐剩余数据。
5. 若资源身份无法确认，不合并任务，避免错误文件污染。

## 5. 资源身份与索引

### 5.1 资源身份不能只靠 URL

普通 HTTP URL 可能含短期签名参数；同一 URL 的内容也可能变化。Telegram 媒体身份可能依赖 peer、message、media/document ID、access hash、DC、文件引用或版本信息。不能把所有来源压成一种键。

建议采用带命名空间的键：

- HTTP：`http:v1:<normalized-url-or-origin-key>:<validator-scope>`
- Telegram 媒体：`tgmedia:v1:<account-scope>:<stable-media-id>:<variant>`
- 消息：`tgmsg:v1:<account-scope>:<peer-id>:<message-id>`

这些是逻辑格式示例，不应在尚未验证字段稳定性时直接把示例字段写死。

### 5.2 身份策略

**HTTP(S)：**
- 优先使用标准缓存语义：`Cache-Control`、`ETag`、`Last-Modified`、`Vary`、响应状态与内容类型。
- 对带授权或用户隔离的资源，缓存键必须包含适当的用户/会话隔离范围；不要将私人响应跨账户共享。
- 规范化 URL 时，只删除经过验证的无语义跟踪参数；不得盲目剥除所有 query 参数，因为它们可能影响内容或权限。
- 内容哈希可用于确认字节相同，但哈希需要在数据可用后计算。

**Telegram 原生媒体：**
- 使用 MTProto 适配器能取得且稳定的媒体标识。
- 如果页面只提供消息 ID，必须在正确账号与 peer 范围内解析媒体对象。
- 文件大小、MIME 类型、文件名只能作为辅助属性，不能单独确定身份。
- 文件引用过期、DC 变化或下载凭证更新时，应允许刷新引用，而不是把旧请求无限重试。

**来源不明：**
- 使用临时任务 ID，不进入可跨会话复用的持久缓存。
- 不确定时宁可不命中，也不要错误命中。

### 5.3 建议的资源记录

```ts
type ResourceRecord = {
  resourceKey: string;
  sourceType: "http" | "telegram-mtproto" | "page-captured";
  accountScope?: string;
  messageKey?: string;
  mimeType?: string;
  expectedSize?: number;
  actualSize?: number;
  etag?: string;
  lastModified?: string;
  sha256?: string;
  relativePath?: string;
  completeness: "unknown" | "partial" | "complete";
  verification: "unverified" | "verified";
  cacheRefs: number;
  archiveRefs: number;
  lastAccessedAt?: number;
  createdAt: number;
  updatedAt: number;
};
```

持久化时间戳可用 Unix 毫秒或 ISO 字符串，但全项目必须统一。

## 6. 下载任务协调器

### 6.1 Single-flight

维护 `Map<ResourceKey, ActiveTask>`。创建任务前先查同一键是否已有活动任务；若有，则添加消费者而不是创建第二个任务。

```ts
async function acquireResource(key, consumer, options) {
  const cached = await cacheManager.findVerifiedComplete(key, options);
  if (cached && isCompatible(cached, options)) {
    return cached;
  }

  const active = activeTasks.get(key);
  if (active) {
    return active.addConsumer(consumer);
  }

  const task = taskManager.create(key, consumer, options);
  activeTasks.set(key, task);

  try {
    return await task.run();
  } finally {
    if (activeTasks.get(key) === task) activeTasks.delete(key);
  }
}
```

以上是接口示意，不是可直接编译的实现。实际代码需要处理消费者取消、任务失败、键冲突、重试以及同一资源不同字节范围等情况。

### 6.2 任务优先级

建议默认优先级（数字越小越优先）：

| 优先级 | 任务 | 说明 |
|---:|---|---|
| 0 | 用户正在观看的媒体所需数据 | 不应明显拖慢播放 |
| 1 | 用户主动点击的存档/下载 | 用户明确发起 |
| 2 | 当前可视区域的资源 | 页面正常显示需要 |
| 3 | 用户当前聊天的补齐任务 | 可限速 |
| 4 | 后台旧消息补齐 | 可暂停 |
| 5 | 预取/预下载 | 默认关闭 |

不能为了“存档”而无条件抢占播放数据。应允许一个底层任务有多个消费者，并根据消费者优先级动态调度。

### 6.3 并发、限速和取消

- 对同一资源最多一个兼容的下载任务。
- HTTP 与 MTProto 使用独立并发池，避免某一类任务阻塞另一类。
- 允许用户暂停低优先级后台任务。
- 某个消费者取消，不应取消其他消费者仍需要的任务。
- 只有所有消费者都取消、且任务可安全停止时才中断底层下载。
- 重试采用指数退避并设上限；对鉴权失败、权限错误等不可重试错误不要盲目重试。

## 7. HTTP 缓存适配器

### 7.1 推荐实施顺序

1. **观察模式**：只记录请求元信息，不改写请求。
2. **持久缓存模式**：对经过确认的 GET 资源进行缓存，并遵循 HTTP 缓存语义。
3. **本地复用模式**：仅对明确支持的资源使用本地响应。
4. **逐类扩展**：图片、缩略图先行；视频/音频 Range 请求单独验收。
5. 对不支持、身份不明、跨域语义复杂或缓存策略不允许的请求，回退网络。

### 7.2 必须遵守的 HTTP 语义

- `Cache-Control: no-store` 的响应不得持久化。
- 正确处理 `no-cache`、`private`、`Vary`、认证和 Cookie 隔离。
- 缓存过期时使用 ETag / Last-Modified 条件验证（若源站支持）。
- 对 Range 请求，确保 `206 Partial Content`、`Content-Range`、`Content-Length` 和字节区间一致。
- `HEAD`、错误响应、重定向、压缩编码与内容长度必须按实际协议处理。
- 不能把不完整的 206 响应登记为完整文件。
- 避免把带有敏感授权参数的 URL 或响应头写入普通日志。
- 不应随意覆盖 CSP、CORS 或安全响应头来强行实现本地响应。

### 7.3 Electron 实现边界

Electron `webRequest` 适合监听和修改部分请求行为，但不是任意 HTTP 响应体替换 API。`protocol.handle()` 可注册自定义协议处理器，但将原站请求透明改写为本地协议可能受到 CORS、Cookie、CSP、Range、重定向和页面内部资源加载方式的限制。

因此建议：
- 先让 `webRequest` 做被动观测；
- 对可控的本地资源 URL 使用自定义协议；
- 只有针对某一明确请求类型完成端到端测试后，才启用响应替换；
- 不要对所有 HTTPS 请求进行全局重定向；
- 保留快速关闭缓存替换功能的 feature flag。

### 7.4 HTTP 缓存条目状态

`miss → downloading → verified → available → stale/evicted`

失败时使用 `failed` 并记录可重试原因。下载过程中只能向支持流式读取的消费者提供已确认数据；不能把临时文件当作完整缓存文件公开。

## 8. Telegram MTProto 媒体适配器

### 8.1 两条路径

**路径 A：复用页面已取得的数据（优先尝试）**
- 在 Electron preload/注入脚本中做能力探测。
- 检查页面是否有可观察的下载入口、媒体 Blob、对象 URL 或可订阅的资源事件。
- 如果数据已经完整、可访问且来源身份可确认，将数据交给主进程持久化。
- 若只能取得播放中已消费的片段，则记录已取得范围，不能标记完整。
- Worker/模块闭包内的数据通常不一定能从页面全局访问；探测失败就明确禁用此能力，不做脆弱的深度 monkey-patch 作为唯一方案。

**路径 B：独立 MTProto 下载器（可靠兜底）**
- 用户明确触发存档或完整下载后，使用独立 Telegram API 客户端按消息/媒体标识下载。
- 账号授权必须由用户完成，凭证安全存放，主进程不向 renderer 暴露 session string、API hash 或访问令牌。
- 尽可能复用已有下载任务与已验证的分块。
- 对文件引用失效、会话过期、限流和权限错误分别处理。
- 不要假定 GramJS 的任意 `downloadMedia(start, end)` 都支持可靠续传；必须针对当前使用的库版本验证偏移语义、块边界、内存占用和返回值。

### 8.2 MTProto 分块续传

- 根据实际下载 API 允许的偏移单位与对齐要求分块。
- 每块写入临时文件或分块文件，并保存区间、长度与校验信息。
- `committedOffset` 只能表示已确认连续有效的前缀，不能简单等于收到的最大偏移。
- 若采用稀疏区间记录，合并区间前要验证没有空洞。
- 文件最终完成后检查预期大小（若可得）、分块完整性和整体 SHA-256，再原子提交。
- 对源文件身份或访问凭证发生变化的情况，不能将旧分块盲目拼接到新资源上。

### 8.3 页面捕获与独立下载如何协作

优先级建议：

1. 已验证的完整页面捕获数据；
2. 已验证的完整持久缓存；
3. 可加入的同一活动任务；
4. 可验证复用的部分分块；
5. 独立 MTProto 下载；
6. 无法确认身份时，重新下载到独立临时对象，不与旧对象合并。

## 9. 消息存档与缓存共存

### 9.1 存档目录建议

```text
TelegramArchive/
  account-<scope>/
    peer-<peer-id>/
      message-<message-id>/
        message.json
        text.md
        archive.meta.json
        media/
          <resource-key-or-safe-name>
```

路径中的名称应由应用生成，不直接使用未经清洗的用户消息文本或原始文件名。

### 9.2 存档清单示例

```json
{
  "schemaVersion": 1,
  "messageKey": "tgmsg:v1:<account-scope>:<peer-id>:<message-id>",
  "status": "partial",
  "savedAt": "2026-01-01T00:00:00.000Z",
  "textFile": "text.md",
  "attachments": [
    {
      "resourceKey": "tgmedia:v1:<account-scope>:<stable-media-id>:original",
      "relativePath": "media/attachment-001.bin",
      "expectedSize": null,
      "actualSize": 0,
      "sha256": null,
      "status": "pending"
    }
  ]
}
```

上述 ID 和时间仅为格式示例。生产数据应使用真实值并统一时间标准；不得在代码中硬编码示例标识。

### 9.3 原子提交

1. 先写 `.part` 或临时目录。
2. 持续写入并更新进度。
3. 校验长度、哈希与协议完整性。
4. flush 并关闭文件。
5. 原子 rename 到最终路径（跨卷时需要复制并再次校验）。
6. 最后提交索引与归档清单状态。
7. 启动恢复任务检查中断遗留的临时文件。

缓存可通过引用计数或索引关系知道哪些文件被存档引用。清理缓存时必须跳过仍被归档引用的文件，或将归档复制到独立的归档存储区。

## 10. 注入脚本与 UI

### 10.1 注入脚本职责

- 在页面稳定后注入轻量脚本，或使用受控 preload。
- 观察可见消息元素与可访问的 DOM 元数据。
- 添加“存档消息”入口与资源状态提示。
- 向主进程发送最小化请求：消息候选 ID、用户动作、当前页面上下文。
- 显示 `未检查 / 可复用 / 下载中 / 部分可用 / 已完整 / 失败` 等状态。
- 不在 renderer 中直接拼接本地文件路径。
- 不将任意网页字符串当作可信 IPC 命令。
- 采用 MutationObserver 时进行节流，避免滚动/虚拟列表导致性能问题。

### 10.2 消息识别的可靠性

不要只靠 DOM 顺序或文本内容确定 message ID。优先使用页面已有、可验证的消息标识。若只能获得不可靠的候选 ID：
- UI 显示“无法确认消息身份”；
- 要求用户重新选择或确认；
- 不启动会污染索引的自动归档。

### 10.3 注入稳定性

- 将 DOM 选择器和页面版本作为单独的适配模块。
- 启动时做能力探测；页面结构变化时禁用增强按钮或显示兼容性提示。
- 不依赖压缩后的私有函数名作为唯一接口。
- 所有实验性 hook 都应可通过配置关闭。
- 维护一个无注入模式：页面原样运行，缓存协调器仍可对可观察的 HTTP 资源工作。

## 11. Electron 安全设计

- 开启 `contextIsolation: true`、`nodeIntegration: false`。
- 通过 preload 暴露窄接口，不向网页暴露任意 IPC、文件系统或 shell 能力。
- 所有 IPC 都验证参数 schema、大小、类型与来源 frame。
- 文件路径必须在主进程内规范化，并验证最终路径仍位于允许的根目录。
- 防止路径穿越、符号链接逃逸、任意覆盖文件和恶意文件名。
- renderer 不得自行传入任意绝对路径供主进程写入。
- 访问令牌、MTProto session、API hash 等秘密不写入日志，不发送到注入页面。
- 对远程网页导航、弹窗和外部协议做 allowlist；拒绝不需要的权限请求。
- 对 HTML/脚本注入来源、版本和完整性进行控制。
- 本地自定义协议只暴露允许的资源键，不接受任意文件路径参数。
- 缓存和存档目录按账号/会话隔离，防止多账号内容交叉暴露。

## 12. 指标与日志

### 12.1 指标定义

| 指标 | 定义 | 注意事项 |
|---|---|---|
| `networkBytesReceived` | 可观测的网络接收字节数 | 需标明观测覆盖范围 |
| `cacheBytesServed` | 从本地缓存提供的字节数 | 不等于节省的网络字节 |
| `duplicateTaskJoined` | 加入已有活动任务的消费者数量 | 任务数不直接等于流量节省 |
| `duplicateBytesAvoidedEstimate` | 经基准测试估算避免的重复字节 | 必须标注为估算值 |
| `partialResumeBytes` | 从已验证的缺失区间补齐的数据量 | 需要协议级区间记录 |
| `pageCaptureBytes` | 从页面已有数据捕获并持久化的字节数 | 不应再计作新增网络接收 |
| `archiveCompleteCount` | 完整提交的消息存档数 | 部分存档另行统计 |
| `cacheHitRate` | 命中次数 / 可缓存请求次数 | 不足以证明省流量 |

### 12.2 隐私与日志

- 默认不记录消息正文、完整私人 URL、Cookie、Authorization 或媒体内容。
- 资源 ID 采用适当的脱敏或会话内哈希。
- 诊断日志应允许用户主动导出并查看内容。
- 统计“节省流量”时，清楚区分实际测量与估算。

## 13. 缓存清理与一致性

### 13.1 缓存淘汰

- 可配置容量上限，例如默认 2–5 GB（由用户设置，而非硬编码）。
- 使用 LRU/最近访问策略时，跳过正在使用、正在下载或被存档引用的内容。
- 清理前更新索引，失败时保留可恢复状态。
- 清理后若索引指向不存在的文件，应自动修复并标记 cache miss。

### 13.2 数据完整性

- 下载中：`partial/unverified`
- 下载完成但未校验：`complete/unverified`
- 校验通过：`complete/verified`
- 校验失败：隔离文件、记录原因、禁止作为缓存命中
- 元数据或源标识变化：标记 stale 并重新验证
- 不把只存在文件名或路径的条目视为有效缓存

## 14. 错误处理

| 错误 | 建议行为 |
|---|---|
| HTTP 超时/连接中断 | 保留安全的临时数据；仅在支持且验证 Range 时续传 |
| HTTP 401/403 | 不盲目重试；按页面正常认证语义回退 |
| HTTP 429/限流 | 退避重试、降低并发 |
| MTProto 会话失效 | 暂停任务，提示用户重新授权 |
| Telegram 文件引用过期 | 刷新媒体引用后重试，避免拼接不相容数据 |
| 本地磁盘空间不足 | 暂停低优先级任务，提示清理空间 |
| 校验失败 | 隔离失败文件，禁止命中，必要时完整重下 |
| 页面 DOM 变更 | 禁用消息操作入口，保留基础页面功能 |
| IPC 参数不合法 | 拒绝请求并记录脱敏错误 |
| 程序崩溃/强制退出 | 启动时扫描临时文件与任务日志，恢复或清理 |

## 15. 分阶段实施计划

### M0：网络路径探测（先做，不做响应替换）

**工作项**
- 建立 Electron 包装应用与安全 preload。
- 使用 `webRequest` 等可用机制记录普通网络请求的元信息。
- 记录 URL 主机、资源类型、方法、状态码、响应头中的必要字段、可观测大小和时间。
- 观察页面 Blob URL、媒体播放器行为和 Worker 相关线索；只做能力探测，不假设可访问内部数据。
- 为敏感字段做脱敏。

**交付**
- `network-observation.md`：请求类型分布、普通 HTTP 与 MTProto/Blob 路径判断。
- 可导出的脱敏诊断日志。
- 一份明确列出“可观察 / 可捕获 / 不可访问”的能力矩阵。

**验收**
- 常见聊天、图片预览、视频播放、文件下载场景均有记录。
- 观测模式不改变原页面行为。
- 记录中不泄露 Cookie、授权头或消息正文。

### M1：资源索引与任务去重

**工作项**
- 实现 Resource Registry、资源身份解析器与 SQLite/JSON 索引（建议 SQLite 作为后续可扩展的默认选择）。
- 实现 single-flight 任务协调器、优先级队列、并发限制和消费者取消。
- 先支持普通 HTTP 资源和用户主动存档任务的内部任务去重。

**交付**
- `ResourceCoordinator`、`ResourceRegistry`、`TaskManager`。
- 单元测试：相同键合并、不同键隔离、取消传播、失败清理、并发竞争。

**验收**
- 两个消费者同时请求同一资源时，底层只创建一个兼容任务。
- 任一消费者取消，不影响其他仍在等待的消费者。
- 任务失败后，活动任务表不会残留僵尸任务。

### M2：普通 HTTP 持久缓存

**工作项**
- 实现遵循 HTTP 缓存语义的磁盘缓存。
- 先从图片和缩略图开始。
- 添加内容校验、原子提交、LRU 清理和命中指标。
- 仅在单类资源通过测试后启用本地响应复用。

**交付**
- `HttpCacheAdapter`、缓存索引、缓存管理界面/日志。
- 请求兼容性测试用例。

**验收**
- 同一资源重复访问时，本地缓存可命中且不发生不必要的源站传输。
- 对过期缓存执行正确的条件验证或回源。
- `no-store`、私人授权资源和 `Vary` 场景按策略处理。
- 不支持的请求能安全回退网络。

### M3：页面媒体数据复用与 MTProto 兜底

**工作项**
- 探测可访问的页面媒体数据入口。
- 实现页面捕获适配器，仅接受身份可确认、字节完整性可验证的数据。
- 实现独立 MTProto 下载器或连接已有下载实现。
- 验证分块偏移、续传、文件引用刷新和完整性检查。

**交付**
- `PageMediaCaptureAdapter`（可选能力）。
- `TelegramMediaAdapter`。
- MTProto 分块/续传测试记录。

**验收**
- 页面已完整取得媒体时，存档可复用该数据，且基准测试证明没有第二次完整媒体下载。
- 页面数据不可访问时，独立下载器可完成用户明确请求的媒体。
- 不会把播放中的部分数据误标为完整。
- 分块恢复后最终文件与完整下载的 SHA-256 一致。

### M4：存档 UI 与稳定化

**工作项**
- 注入“存档消息”入口与状态展示。
- 保存消息元数据、正文、附件清单。
- 处理部分失败、重试、取消、恢复、磁盘空间不足。
- 增加用户可见的缓存容量与清理设置。

**交付**
- 存档目录结构、消息清单、任务状态 UI。
- 完整测试矩阵和故障恢复说明。

**验收**
- 存档只有在正文、必要元数据和所有声明为必需的附件完整后才标记 complete。
- 部分成功清楚标记为 partial。
- 清理缓存不会删除被存档引用的唯一内容。
- 应用重启后能恢复或安全清理未完成任务。

## 16. 测试矩阵

| 场景 | 预期结果 |
|---|---|
| 首次打开包含图片的聊天 | 正常请求资源并按策略缓存 |
| 再次打开同一聊天 | 可复用的资源不重复完整下载 |
| 同时播放与存档同一媒体 | 共享任务或复用页面已取得数据 |
| 页面只加载了视频前几秒 | 不误报完整缓存/完整存档 |
| 两个组件同时请求相同资源 | single-flight 合并任务 |
| 两个不同媒体大小相同 | 不发生错误缓存命中 |
| HTTP ETag 变化 | 旧缓存失效或重新验证 |
| HTTP Range 断点续传 | 区间与最终文件内容正确 |
| MTProto 中途断网 | 仅续传经验证且身份一致的部分 |
| 文件引用过期 | 刷新引用或明确失败，不拼接不兼容数据 |
| 用户取消一个消费者 | 其他消费者仍可完成 |
| 磁盘空间不足 | 任务安全暂停/失败，不损坏已有文件 |
| 缓存清理 | 不删除活动任务或存档唯一引用 |
| 页面 DOM 改版 | 增强入口安全降级，原页面仍可用 |
| 账号切换 | 不跨账号复用私人资源 |
| 应用崩溃后重启 | 恢复索引一致性，不把 `.part` 当完整文件 |

## 17. 性能目标与基准测试

不要在没有基准测试前承诺固定节省百分比。先采集基线，再设目标。

建议基准流程：
1. 清空应用持久缓存，记录一次完整测试的网络接收字节。
2. 打开指定聊天，浏览图片并播放一段视频。
3. 对同一消息执行存档。
4. 重复打开聊天，再次播放并存档。
5. 对比网络字节、缓存提供字节、下载任务数、完成时间和文件哈希。
6. 在相同账号、相同消息集合、相同媒体动作下重复至少三轮。

建议先把验收目标定义为：
- 同一活动资源键只出现一个兼容底层下载任务。
- 已验证完整的持久缓存命中时，不产生该资源的完整源站重下载。
- 页面捕获路径只有在可证明数据已完整时才标记为完整复用。
- 所有存档文件通过哈希校验，或明确记录校验能力受限。
- 基准结果同时报告实际传输量与估算节省量。

## 18. 配置建议

示例配置（数值应根据实测和用户设置调整）：

```ts
type ResourceOptimizationConfig = {
  observationOnly: boolean;          // 初期必须 true
  enableHttpPersistentCache: boolean;
  enableLocalHttpResponse: boolean;  // 默认 false，逐资源类型开启
  enablePageMediaCapture: boolean;   // 仅能力探测成功后开启
  enableTelegramDownloader: boolean;
  cacheMaxBytes: number;
  maxHttpConcurrency: number;
  maxTelegramConcurrency: number;
  backgroundBandwidthLimitBytesPerSecond?: number;
  prefetchEnabled: boolean;          // 默认 false
  retainCacheReferencedByArchive: boolean; // 必须 true
};
```

生产版本需要使用 schema 校验、合理默认值和迁移策略。不要让远程页面通过 URL 参数直接开启高风险的响应替换功能。

## 19. 开发前必须验证的技术问题

以下项目必须通过目标 Electron 版本和目标页面实测确认：

1. telegram-tt 当前构建与 Electron 版本是否兼容。
2. 页面实际媒体流量中，普通 HTTP、Blob、Worker 和 MTProto 各占多少。
3. Electron 能观测到哪些请求、响应头和字节大小；哪些内容在 webRequest 之外。
4. 页面是否存在可稳定捕获完整媒体数据的公开或可观察入口。
5. 独立 MTProto 下载器使用的库版本是否支持预期的分块下载和恢复语义。
6. HTTP 缓存替换是否受 CORS、CSP、Cookie、Range 或重定向限制。
7. 账号授权与会话数据如何安全保存，是否需要用户单独授权下载器。
8. 项目许可证、依赖许可证及 Telegram API 使用要求是否符合产品计划。

任何一项没有验证，都不应把相关能力作为架构的硬性前提。

## 20. 参考资料

实施时请核对与锁定版本对应的官方文档和仓库当前内容：

- Telegram Web A 仓库：<https://github.com/Ajaxy/telegram-tt>
- Electron `webRequest`：<https://www.electronjs.org/docs/latest/api/web-request>
- Electron `protocol`：<https://www.electronjs.org/docs/latest/api/protocol>
- Electron 安全建议：<https://www.electronjs.org/docs/latest/tutorial/security>
- GramJS 仓库/文档：<https://github.com/gram-js/gramjs>

API 细节、媒体路径与项目结构可能随版本变化；在编码前应针对实际锁定版本验证，不应只依赖本文示意。

---

## 附录 A：推荐的目录结构

```text
src/
  main/
    resource/
      ResourceCoordinator.ts
      ResourceRegistry.ts
      ResourceIdentity.ts
      TaskManager.ts
      PriorityQueue.ts
      CacheManager.ts
      ArchiveManager.ts
      adapters/
        HttpCacheAdapter.ts
        PageMediaCaptureAdapter.ts
        TelegramMediaAdapter.ts
      storage/
        SqliteResourceStore.ts
        AtomicFileWriter.ts
      metrics/
        NetworkMetrics.ts
    ipc/
      resourceIpc.ts
      archiveIpc.ts
  preload/
    index.ts
    bridge.ts
  injected/
    pageAdapter.ts
    messageObserver.ts
    archiveButton.ts
  shared/
    schemas.ts
    resourceTypes.ts
tests/
  unit/
  integration/
  fixtures/
```

## 附录 B：建议的 IPC 合约

仅暴露窄接口，不提供通用文件系统能力：

```ts
type ResourceBridge = {
  getCapabilities(): Promise<{
    httpObservation: boolean;
    pageMediaCapture: boolean;
    telegramDownloader: boolean;
  }>;

  getResourceStatus(input: {
    candidateResourceKey?: string;
    messageKey?: string;
  }): Promise<ResourceStatus>;

  requestArchive(input: {
    messageCandidate: MessageCandidate;
  }): Promise<{ jobId: string }>;

  cancelJob(input: {
    jobId: string;
  }): Promise<{ accepted: boolean }>;

  subscribeJobEvents(
    callback: (event: ResourceJobEvent) => void
  ): () => void;
};
```

这只是接口形状示例。所有输入都必须在主进程验证；页面不能自行指定磁盘目标路径、任意 URL 下载目的地或任意文件读取路径。

## 附录 C：第一周最小可行任务清单

- [ ] 固定 telegram-tt commit、Electron 版本与构建方式。
- [ ] 建立只观测、不改写请求的 Electron 原型。
- [ ] 选取固定的测试聊天与媒体集合。
- [ ] 记录首次打开、重复打开、播放、存档各阶段的可观测网络字节。
- [ ] 确认 HTTP、Blob、Worker、MTProto 的媒体路径分类。
- [ ] 实现资源键与 single-flight 单元测试。
- [ ] 对一类普通图片资源实现磁盘缓存，不启用全局响应替换。
- [ ] 验证缓存命中、过期、账号隔离、删除和恢复。
- [ ] 写出观测结果与能力矩阵，决定 M3 的页面捕获路径是否可行。

**最终决策门槛：**如果 M0 发现大部分目标媒体只通过无法从外部稳定捕获的 MTProto/Worker 路径传递，就不要继续投入全局网络拦截；转而将优化重点放在独立 MTProto 下载器、single-flight、分块恢复、页面可复用数据探测和存档复用上。
