# telegram-cache 模块记忆

> 「Telegram 网络优化」工具的开发记忆。**改动相关文件前先读对应小节。**
> 方案来源：[telegram-network-resource-optimization-plan.md](./telegram-network-resource-optimization-plan.md)
> 当前实现阶段：**M0（被动观测）+ M1（资源索引 / 单飞任务）+ M2（HTTP 缓存语义 / 配额淘汰）+ M3-B（MTProto 消息媒体下载，需 `.env` 凭据与会话）**。

## 0. 与 Electron 版的实现差异（重要，先看这一节）

本项目是 Tauri 2 + Rust 原生后端，Electron 独占的三项能力**没有等价 API**，按「方案 B」改写并记录于此：

| Electron 能力 | 本项目处理 | 影响 |
| --- | --- | --- |
| `webRequest` 观测（M0） | 改为**子 Webview 注入只读采集脚本**：脚本只读 `performance.getEntriesByType('resource')`，宿主每 2s 用游标轮询取回新增条目并经 `observation:report` 上报。脚本由桌面壳下发（`telegram-cache:observation:script`），不改写请求、不碰页面 DOM。 | 观测口径变为「资源计时 API 的量级」；`websocket` 类型只能看 `other` 类线索，不再是精确的请求类型 |
| `protocol.handle` 本地响应（M2，默认关） | **不支持**：wry 无法拦截 https 请求。配置项 `localResponseEnabled` / `localMediaRangeEnabled` 与 `serveClass` 计算保留，`cache.handlerInstalled` 恒 `false`。 | 打开开关不会有任何效果；HTTP 语义与配额逻辑仍完整（供归档判定与未来实现） |
| CDP 页面图片捕获（M3-A，默认关） | **不支持**：Tauri 没有 CDP 客户端。`enablePageCapture` 保留，`pageCaptureAttached` 恒 `false`。 | 页面已下载的字节拿不到 |
| teleproto（Node MTProto） | 改为 **grammers（Rust MTProto 2.0 实现）**：`grammers-client` + 自实现 `FileSession`（会话加密落盘）。 | 需要 `TG_API_ID` / `TG_API_HASH` 与已登录会话；不依赖 Node 运行时 |

> 除此之外（资源身份 / 索引 / 单飞任务 / 下载 / 归档 / 诊断 / 自检 / 基准 / 配额 / MTProto 语义）
> 与 Electron 版**逐项对齐**，`shared/telegram-cache.ts` 的数据契约保持不变。

## 1. 概览

### 1.1 工具定位

内嵌 Telegram Web A（`https://web.telegram.org/a/`）的独立分区子 Webview，在**不改写页面请求、不注入 DOM**的前提下：

1. 只读观测页面资源（资源计时 API）；
2. 把观测到的资源按「规范 URL 哈希」建档（资源索引）；
3. 用户点「存库 / 归档」时先查资源库、再进单飞任务协调器，保证同一资源只有一个底层下载；
4. 提交前校验大小并计算 SHA-256，临时文件原子 rename 成内容对象；
5. 归档复制独立副本（内容寻址 + 自带 meta.json），不受以后缓存淘汰影响；
6. 按 HTTP 语义判定准入与新鲜期，按配额 LRU 淘汰；
7. 可选地通过 MTProto 按消息链接下载单条消息的媒体，并在归档旁写 `message.json`；
8. 提供能力矩阵、页面只读探测、自检（单飞 + HTTP 语义 + Range + 分块 + 下载核心 + 链接）与**脱敏**诊断导出。

- 工具 id：`telegram-cache`；页签 / 子路由：`overview` / `resources` / `tasks` / `diagnostics`。
- `supportedTargets: ['win', 'mac']`（依赖桌面壳文件写入与子 Webview，网页预览不注册）。
- 主题色 `#2aabee`，图标 `telegram`（`src/shared/components/ui/icons.ts`）。

### 1.2 本轮明确不做（不要擅自补上）

| 能力 | 状态 | 原因 |
| --- | --- | --- |
| 用本地缓存替换页面响应 | **不做**（配置项保留） | wry 无 `protocol.handle` 等价能力 |
| 注入脚本改写页面 / DOM 加按钮 | 不做（只允许**只读**采集脚本） | 避免依赖 Telegram DOM，也避免破坏页面 |
| 页面已下载媒体捕获（blob / 播放中数据） | 不做 | 无 CDP 客户端 |
| 消息级批量 / 相册存档 | 不做 | 只做单条消息 |
| MTProto 其它能力（发送、会话管理 UI） | 不做 | 只做「按链接下载媒体」 |

## 2. 文件地图

```
shared/telegram-cache.ts                 共享类型 / 常量 / 默认值（纯类型与纯函数）
shared/command-groups/telegram.ts        命令表（前后端共用，单一事实来源）
src/config/tools.ts                      工具注册表
src/shared/components/ui/icons.ts        telegram 图标

tools/telegram-cache/
  index.ts                               工具定义（4 个子路由）
  api.ts                                 唯一 createCommandHelpers 实例 + 外链出口
  tabs.ts                                页签 / 子路由映射（路由驱动面板切换）
  utils/format.ts                        展示层纯格式化
  composables/useTelegramPage.ts         子 Webview 桥 + 观测轮询 + 探测脚本执行
  stores/telegramCacheStore.ts           快照 + 增量事件 + 动作（所有失败向上抛）
  pages/TelegramCachePage.vue            左内嵌页面 / 右面板 + 观测开关
  components/{Overview,Resources,Tasks,Diagnostics}Panel.vue

src-tauri/src/telegram/
  mod.rs             命令分发 / 观测摄入 / 快照聚合 / 配置 / 清缓存 / 基准
  types.rs           与 shared/telegram-cache.ts 对应的 serde 契约
  identity.rs        URL 身份 / 脱敏展示 / 键格式校验（纯函数 + 测试）
  http_semantics.rs  Cache-Control / Vary / 新鲜度 / 单区间 Range（纯函数 + 测试）
  chunk.rs           分块 / 续传区间数学（纯函数 + 测试）
  store.rs           <data>/telegram-cache 布局 + JSON 文档 + 配额 LRU
  tasks.rs           单飞协调器 + HTTP 下载 + 内容对象提交 + 归档
  probe.rs           观测采集脚本 / 只读探测脚本 / 探测结果白名单解析
  diagnostics.rs     脱敏诊断包导出 + M3 可行性报告
  self_test.rs       自检（身份 / HTTP 语义 / Range / 分块 / 链接 / 下载核心 / 基准 / 配置 / 会话）
  mtproto.rs         链接解析 / grammers 客户端 / 断点续传 / 归档 + message.json
  session.rs         FileSession：可持久化的 grammers Session 实现
  session_store.rs   会话加密落盘（Windows DPAPI / Unix 0600）
```

## 3. M0：观测口径

- 采集脚本（`probe.rs::observation_script`）只读 `performance.getEntriesByType('resource')`：
  - `transferSize === 0 && decodedBodySize > 0` → 视为**来自缓存**（Chromium 语义）；
  - `transferBytes` 只统计「非缓存命中 + 有大小」的条目；没有大小的计入 `unknownSizeCount`；
  - `durationMs` 取资源计时（页面侧可见的那段）。
- 上报入口 `telegram-cache:observation:report` 做**窄校验**：只接受结构化字段（不含任意命令 / 路径）。
- 观测开关关闭时：轮询仍在跑但桌面壳直接丢弃（`observationEnabled=false`），可快速重开。

## 4. 资源身份与索引

- 身份键 = `sha256(origin + pathname + search)` 前 40 位，前缀 `http:v1:` / `ws:v1:`；**不删任何 query 参数**（Telegram 的短期签名在 query 里，归一化会把不同资源压成同一键）。
- 展示地址一律脱敏：query 与值替换为 `key=***`，最多展示 4 个参数名。
- 内存表按 `lastSeenAt` 收敛到 `TELEGRAM_RESOURCE_LIMIT`（300）；已落库条目不受此限制（磁盘 `registry.json` 是事实来源）。
- `fetch_url` 只在进程内保留，不落盘、不进诊断包。

## 5. M2：HTTP 缓存语义与配额

- 准入（`http_semantics::evaluate_response_caching`）：图片 / 音视频 MIME + 200 + 未声明 `no-store/private/no-cache` + `max-age>0` + Vary 仅 `accept-encoding`。
- 新鲜期 = `storedAt + (max-age - Age) * 1000`；`no-store` 只为归档保留：`quotaManaged=false`，不占配额、不参与 LRU。
- 配额（`store::evict_for_quota`）：只统计 `quotaManaged && !archived`，按 `updatedAt` 由旧到新淘汰；归档副本永不淘汰。
- 基准（`benchmark:start/stop`）：计数器区间差值，发现回绕会记 `note`（不把无效样本当结论）。

## 6. MTProto（M3-B）

- 前置：`TG_API_ID` / `TG_API_HASH`（环境变量或 `<data>/telegram-cache/.env`）+ 已登录会话（`<data>/telegram-cache/telegram-session.bin`，加密）。
- 流程：解析链接（拒绝邀请链接）→ 连接（grammers）→ 解析频道 → 取单条消息 → 媒体 → 分块下载（可从 committed offset 续传）→ SHA-256 → 内容对象 → 归档副本 + `message.json`。
- 取消：命令置取消标记，下载循环在下一块退出并清理临时文件。
- 会话：`FileSession` 实现 `grammers_session::Session`，每次 `set_dc_option` / `set_home_dc_id` 后加密落盘；Windows 用 DPAPI，Unix 用 0600 + 压缩封装。

## 7. 单飞任务协调器

- 同一 `resourceKey` 在任意时刻只有一个底层任务；后来的消费者加入同一任务（`consumers` / `joinedConsumers`）。
- `resource:acquire` **同步返回结果**（面板的「存库 / 归档」按完成态渲染）；已有任务在跑时等它结束再取结果。
- 取消按消费者计数：全部取消才真正中止；`TASK_MAX_ATTEMPTS`（3）内对瞬时错误重试，4xx / 超限不消耗尝试次数。
- 并发：`maxHttpConcurrency`（1–8，默认 3）由进程内信号量约束。

## 8. 下载 / 归档 / 诊断

- 下载：先写 `<data>/telegram-cache/tmp/<slot>.part`，校验大小上限（`maxResourceBytes`）后原子 rename 成 `objects/<sha 前 2 位>/<sha256>`。
- 归档：`archive/<sha 前 16 位>-<时间戳>.bin` + `.meta.json`；配额淘汰不碰归档。
- 诊断导出：`<data>/telegram-cache/diagnostics/diagnostics-<时间戳>.json`，**脱敏**：只有展示地址与统计，不含 fetchUrl / cookie / 会话 / 凭据。

## 9. 命令与注册

命令名集中在 `shared/command-groups/telegram.ts`，Rust 侧 `telegram::handle` 按同一张表分发：

- 状态 / 配置：`snapshot:get`、`config:set`、`observation:set-enabled`、`observation:clear`、`observation:script`、`observation:report`、`traffic:get`
- 页面：`page:attach`（子 Webview id）、`page:probe`（无参 → 返回脚本；带原始结果 → 返回解析后的探测对象）
- 资源 / 任务：`resource:acquire`、`task:cancel`、`archive:list`、`archive:open-dir`、`cache:clear`
- 自检 / 诊断：`self-test`、`m3:report`、`diagnostics:export`、`open-data-dir`
- MTProto：`mtproto:status|download|cancel|session:migrate|session:clear`
- 基准：`benchmark:status|start|stop|clear`
- 事件：`event:snapshot`（700ms 节流）、`event:traffic`、`event:task`、`event:mtproto`、`event:benchmark`

## 10. 页面宿主与安全

- 子 Webview `telegram-web`，profile `<data>/webview-profiles/telegram-cache`（登录态跨重启保留）。
- 导航闸在 `src-tauri/src/webviews.rs` 的 `preset: 'telegram'`：只允许 Telegram 自己的域名
  （`web.telegram.org` / `telegram.org` / `t.me` 及其子域），其余地址转 `new-window` 事件 → 渲染层用系统浏览器打开。
- 采集 / 探测脚本只读：`probe::tests` 断言脚本里不出现 `fetch(` / `XMLHttpRequest` / `appendChild`。

## 11. 数据目录

```text
<data>/telegram-cache/
  config.json             观测 / 并发 / 上限 / 配额 / 本地响应 / 页面捕获开关
  registry.json           资源索引（含已落库 StoredInfo）
  archives.json           归档索引
  benchmarks.json         基准记录（最近 20 条）
  objects/<前2位>/<sha256>  内容对象（内容寻址）
  archive/*.bin|meta.json / messages           归档副本
  tmp/                    下载中临时文件（取消 / 失败即清理）
  diagnostics/            脱敏诊断包
  telegram-session.bin    MTProto 会话（加密）
```

## 12. 手工验收清单

1. 打开工具 → 页面加载出 Telegram Web A（登录态保留）；顶部「观测」开着。
2. 在页面里滚一次聊天列表 → 「概览」的请求数 / 类型分布增长；「资源」出现条目。
3. 资源页对一个资源点「存库」→ 任务完成、`cache.entryCount` +1、数据目录出现对象文件。
4. 同一资源再点一次 → 命中已有任务 / 复用，不会重复下载（单飞）。
5. 「归档」→ `archive/` 出现 `.bin` 与 `.meta.json`；清缓存后归档仍在。
6. 「诊断」页：自检全绿；导出诊断包，确认里面没有完整 URL 值 / 凭据。
7. 配置里把配额调到最小 → 再存一个大文件 → 旧条目被淘汰（`cache.evictions` 增长）。
8. MTProto：配置 `.env` 与会话后粘贴 `t.me/<频道>/<消息号>` → 进度推进、归档出现 `message.json`；中途取消 → 临时文件被清理。

## 13. 待验证 / 已知限制

- 观测粒度受资源计时 API 限制：WebSocket / MTProto 长连接只体现为 `other` 类线索，不能按请求类型精确计数。
- 本地响应替换与 CDP 捕获在本项目不可用（见 §0）；若将来 wry 提供请求拦截或 Tauri 暴露 CDP，再按原方案补齐。
- MTProto 会话导入目前只有「加密落盘 / 清理 / 迁移自检」三个入口；登录流程（验证码 / 2FA）需要在外部完成后导入会话。
