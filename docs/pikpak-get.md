# PikPak 下载（pikpak-get）

> 把 PikpakGet 的「转存 → 下载 → hash 校验 → 清理云端」能力做成可视化工具。
> **引擎已从 Python 重写为纯 TS**（`tools/pikpak-get/backend/engine/`）：本机模式在 app 内直接调用，NAS 模式把同一套 TS 引擎包成 Node HTTP 服务跑 Docker。
> 对照参照实现：`PikpakGet/`（Python，只读参照，**不修改其任何文件**）。

## 1. 边界与总体架构

- 引擎（数据面）：纯 TS（`tools/pikpak-get/backend/engine/`），只用 node:crypto / node:http / 可注入 fetch，无第三方依赖；本机内嵌调用，NAS 打包 Node 服务跑 Docker。
- 控制面（app）：`tools/pikpak-get/`，Electron 主进程是引擎的 HTTP 客户端，渲染层只经 IPC 操作。
- **渲染层永不直连引擎**：引擎 token 只在主进程；NAS token 走 safeStorage 密封，本机 token 由 app 生成并注入本机引擎进程。
- 连接设置支持「本机 / NAS」二选一：本机模式在 app 内直接调用 TS 引擎（无子进程 / 无 Python / 无依赖安装）；NAS 模式填地址 + token。
- app 内不提供命令行下载；`PikpakGet/` 原目录保留为独立 CLI + 移植参照 + headless 兜底，数据与引擎互不共享。
- `supportedTargets: ['win', 'mac']`（依赖主进程；web 预览无 IPC）。

```text
┌────────────────────────┐   HTTP/JSON + 1s 轮询进度   ┌─────────────────────────────┐
│  everydaytool（PC 控制面）│ ───────────────────────────► │  NAS：Docker 里的引擎          │
│  账号 / 链接 / 勾选 / 进度 │  http://<nas>:<port> (token) │  · 复用 pikpakget/（Python）   │
└────────────────────────┘                             │  · 薄控制层（新写）             │
                                                       │  · 直写 NAS 本地卷 /downloads  │
                                                       └─────────────────────────────┘
```

PC 关机后 NAS 引擎继续跑已提交任务；PC 再开，app 重连读回 `state.json` 断点。

## 2. 引擎（纯 TS，`tools/pikpak-get/backend/engine/`）

### 2.1 模块布局（`tools/pikpak-get/backend/engine/`）

```text
crypto.ts        edt-kdf:v1 信封（node:crypto scrypt + AES-256-GCM）
errors.ts        错误分类（PikpakError / TrafficCapped / MutationOutcomeUnknown + transient/replaySafe）
api.ts           PikpakClient：登录/续期/captcha_sign/walk_share/restore/download_url/cleanup/space（fetch 可注入）
stream.ts        单流下载（Range 续传 + 空闲超时）+ content_hash/verify_content（分段暂未实现）
pipeline.ts      转存→等就绪→下载→hash 校验→清理 编排 + State（state.json 断点）+ 选文件过滤
accounts.ts      加密账号池（edt-kdf 信封）+ 账号轮换/1 小时流量冷却
links.ts         分享链接 CRUD
engine.ts        PikpakEngine 门面：任务存储 + 选文件下载编排，本机/NAS 共用
service.ts       NAS HTTP 壳（node:http，零依赖）
service-entry.ts NAS 入口（读 env → new PikpakEngine → 起服务）
adapter.ts       统一门面：本机内嵌 / NAS HTTP 两种实现 + snake_case→camelCase 映射
```

- fetch 通过构造注入：本机注入 Electron `net.fetch`（走系统代理），NAS 用 Node 22 全局 fetch。
- 账号密码 / 会话 / device_id 用 `edt-kdf:v1` 信封加密落盘，masterKey 由 app（本机）或 `.env`（NAS）提供。
- 选文件下载：`Pipeline` 带 `selectedFileIds` 过滤，只对勾选文件走转存→下载→校验→清理。
- 分段下载（connections>1）暂未实现（免费号多连常更慢，默认单连接）。

### 2.3 HTTP API（控制面 → 引擎）

| 端点 | 说明 |
|---|---|
| `POST /auth/check` | 校验 `Authorization: Bearer <token>`，返回引擎信息（版本、dest、账号数） |
| `GET /accounts` | 账号列表（含占用 / 流量冷却 / 云盘用量；不含明文密码） |
| `POST /accounts/login` | `{label, password}` → 登录并保存会话（密码不落盘） |
| `POST /accounts/{id}/refresh` | 强制续期 / 密码重登 |
| `POST /accounts/{id}/reveal-password` | 解密返回明文密码（UI 查看密码用；受 token 保护） |
| `DELETE /accounts/{id}` | 退出并删除本地会话与 device_id |
| `GET/POST/PATCH/DELETE /links` | 分享链接 CRUD |
| `POST /links/{id}/parse` | `walk_share` 枚举文件树（零云盘占用），缓存快照 |
| `GET /tasks` / `GET /tasks/{id}` | 任务与文件级状态（重连后读回断点） |
| `POST /tasks` | `{linkId, fileIds[], dest?}` 只下载勾选的文件 |
| `POST /tasks/{id}/cancel` | 中断当前任务（保留 `.part` 与云端副本，可续传） |

进度：v1 用 `GET /tasks/{id}` **1s 轮询**（与 workbuddy2api-panel 的 3s 状态轮询同套路），不引入 WebSocket 依赖；后续需要再升级 SSE/WS。

### 2.4 数据落点（NAS 卷）

```text
/config/                              # 账号库 / 链接库（密文，可整体备份还原）
  accounts.json                        # [{id,label,password_sealed,traffic_capped_at,created_at,updated_at}]
  accounts/<id>/session.edt            # 信封 {access_token,refresh_token,token_type,sub,expires_at}
  accounts/<id>/device_id.edt          # 信封 uuid（保持设备指纹稳定）
  links.json                           # [{id,url,title,folder,share_id,pass_code,root_id,created_at,updated_at}]
/downloads/                            # NAS 本地卷，直写不走 SMB
  <系列>/.pikpakget/state.json          # 断点续传（复用 State，库可整体搬迁）
  <系列>/…文件与 .part / .segs*
```

`traffic_capped_at` 明文（非敏感，且需在解密前参与账号选择）；`device_id` 一起加密并随备份还原——**搬到新服务器后对 PikPak 仍是同一台设备**，不会因换机触发额外风控。本机模式落点相同，只是 `/config` 换成 `<data>/config/pikpak-get/engine`、`/downloads` 换成 `<assets>/pikpak-get`。

### 2.5 加密信封 `edt-kdf:v1`

一套格式，Node 实现（`node:crypto`），换机可解：

| 组成 | 规格 |
|---|---|
| KDF | `scrypt(n=16384, r=8, p=1, dkLen=32)`（`node:crypto.scryptSync`） |
| 加密 | AES-256-GCM（nonce 12B，tag 16B，tag 拼在密文尾） |
| 盐 / nonce | 每条独立随机（盐 16B、nonce 12B） |
| AAD | `pikpakget:<accountId>:<field>`，field ∈ `password` / `session` / `device_id` |

信封文本：

```text
edt-kdf:v1:<salt_b64url>:<nonce_b64url>:<payload_b64url>
```

- `salt` = 16 字节随机，urlsafe-base64（无 padding）
- `nonce` = 12 字节随机，urlsafe-base64（无 padding）
- `payload` = `ciphertext || tag`，urlsafe-base64（无 padding）
- `key = scrypt(master_key_utf8, salt, 16384, 8, 1, 32)`
- `plaintext = AES-256-GCM.decrypt(key, nonce, payload, aad)`

`v1` 固定代表上述参数；以后换参数升 `v2`，旧数据仍可读。Node 侧用 `node:crypto`：`scryptSync` 派生密钥、`createCipheriv('aes-256-gcm')` + 密文尾 16 字节 `setAuthTag`。

### 2.6 主密钥与换机还原

- 一个**主密钥串**放在引擎部署配置（`.env`），不进账号 JSON；数据密文与主密钥分开管理。
- `PIKPAK_ENGINE_MASTER_KEY`（随机长串）只用于派生数据密钥；`PIKPAK_ENGINE_TOKEN`（app 连引擎的 API token）与主密钥分开。
- 主密钥错误时，账号解密会抛「cannot decrypt secret」（AEAD 校验失败），引擎报错并**绝不静默生成空账号库写回**（否则会覆盖真实密文）。

**换机还原** = 恢复 `config/` 卷 + 提供同一份 `.env`：

1. 备份：`config/` 卷（全密文，可随便放）+ `.env`（主密钥 + token，建议放密码管理器）。
2. 新 NAS / 换本机引擎：同 compose + 同 `.env`，恢复 `config/` → 启动即解密还原全部账号（密码、会话、device_id、冷却时间）。
3. 验证：`GET /accounts` 能列出 → 触发一次 `refresh` 成功。

### 2.7 Docker / Compose（Synology Container Manager）

DSM 7.2+ 用「Container Manager」的 Compose 项目；DSM 6 用「Docker」套件。示例：

```yaml
services:
  pikpakget-engine:
    build: .
    restart: unless-stopped
    ports:
      - "8787:8787"                    # 绑 NAS 局域网（app 才能连）；token 鉴权；外网走 Tailscale，不做端口转发
    env_file: .env
    environment:
      - PIKPAK_DEST=/downloads
    volumes:
      - /volume1/docker/pikpakget/config:/config
      - /volume1/media/pikpak:/downloads
```

`.env`（Synology 上权限 600）：

```env
PIKPAK_ENGINE_MASTER_KEY=<一次生成的长随机串>
PIKPAK_ENGINE_TOKEN=<另一个长随机串>
```

安全底线：端口不裸开公网；token 必填；`.env` 不与 `config/` 卷打进同一普通备份包。

## 3. App（控制面，TS）

### 3.1 工具定义与 UI

```text
tools/pikpak-get/
  index.ts                     defineTool；supportedTargets: win/mac
  backend/
    index.ts                   initialize → registerHandlers；dispose → 停止轮询
    ipc/channels.ts            channels（含 EVENT_*）
    ipc/handlers.ts            safeHandle → engine client 代理
    engine/client.ts           net.fetch + 1s 轮询（主进程持 NAS token）
    store/connection.ts        引擎连接设置（url + token sealed）
    utils/paths.ts             resolveLayerPath 取连接设置路径
  renderer/
    ipc.ts                     唯一 createIpcHelpers 实例
    stores/…                   pinia store
    tabs.ts                    子路由映射
    pages/PikpakGetPage.vue
```

三个子路由（`WorkspaceSpine` 竖脊）：

1. **账号池**：账号列表（标签 / 占用 / 流量冷却 / 云盘用量 / 订阅到期）+ 添加登录（账号 + 密码）+ 退出 / 重登 / 查看密码。
2. **分享链接**：链接列表 + 批量粘贴添加 + 「解析」→ 分享标题与文件树（文件夹折叠、文件带大小/后缀、勾选框）。
3. **下载任务**：勾选后「开始下载」→ 任务队列（当前文件进度、速度、ETA、阶段 转存/校验/清理）+ 历史 + 续传 + 取消 + 打开目录。

布局沿用平台件：左栏 `ToolFormPane`/`ToolFormSection`，表格 `UiTable`，进度 `UiProgress`；细节以 DESIGN.md 为准。

### 3.2 IPC 通道

| 通道 | 入参 → 出参 |
|---|---|
| `CONNECTION_GET` / `CONNECTION_SET` / `CONNECTION_TEST` | — → 连接设置（token 不回传明文） |
| `ACCOUNTS_LIST` | — → 账号列表（脱敏） |
| `ACCOUNTS_LOGIN` | label, password → 账号 |
| `ACCOUNTS_REFRESH` / `ACCOUNTS_LOGOUT` / `ACCOUNTS_REVEAL_PASSWORD` | id → 结果 |
| `ACCOUNTS_WHOAMI` | id → 云盘用量 / 订阅 |
| `LINKS_LIST` / `LINKS_ADD` / `LINKS_UPDATE` / `LINKS_DELETE` | … → 链接 |
| `LINKS_PARSE` | id → 文件树快照 |
| `TASKS_LIST` / `TASKS_START` / `TASKS_CANCEL` / `TASKS_OPEN_DIR` | … → 任务 |
| `EVENT_TASK_PROGRESS` | 主进程 → 渲染层（任务 / 文件进度，1s 节流） |

渲染层不直连 NAS；主进程 `engine/client.ts` 把 IPC 翻译成 §2.3 的 HTTP 调用，token 从 config 层 sealed 读取。

### 3.3 数据落点与分层

| 数据 | 位置 | 说明 |
|---|---|---|
| 引擎连接设置 | `<config>/pikpak-get/connection.json` | `{name?, url, tokenSealed}`；token 走 `secret-box`（safeStorage） |
| 账号 / 链接 / 任务 / 文件树快照 | **引擎侧（NAS）**，不在 app 分层内 | app 只在 Pinia 内存缓存只读视图，重连后重拉 |

仅连接设置进 app 的 `DATA_LAYER_ENTRIES`（token 标 `sensitive`）。账号凭据、会话、device_id、链接库、下载进度全部归引擎（NAS 卷），不属于 app 数据根，不参与 app 的备份/清缓存。

## 4. 数据模型（要点）

- **账号**：`id = sha256(sub)[:24]`（沿用 PikpakGet）；`label` 登录名；`passwordSealed` / `session.edt` / `device_id.edt` 为信封；`trafficCappedAt` 明文。
- **链接**：`url`（可带 `?password=` 与子目录 `/s/<id>/<folderId>/…`）、`title`、`folder`（本地归档目录）、`shareId`、`passCode`。
- **文件节点**：`{id, name, path, parentId, isFolder, size, hash, mime}`（来自 `walk_share`）。
- **任务**：`{id, linkId, fileIds[], dest, accountId, status, files:[{nodeId, state, downloaded, total, speed, eta, error}]}`。
- **进度**：单文件 `downloaded/total` + 近几秒速度 + 近 1 分钟均速估 ETA（沿用 `TransferProgress` 的采样口径，渲染端实现）。

## 5. 关键事务

1. **登录 / 续期 / 重登**：`POST /accounts/login` 存会话；日常走 refresh_token 续期；refresh 被拒时用 sealed 密码重登（「加密密码 + 会话」的意义）。
2. **解析**：`walk_share` 只枚举不占云盘；`PROHIBITED` 报错，不把空清单记完成；快照缓存于引擎，重开不重拉。
3. **勾选下载**：`POST /tasks` 带 `fileIds` 白名单；`task_runner` 按「转存 → 等就绪 → 下载 `.part` → hash 校验 → 清理云端」串行处理，未勾选不碰云盘。
4. **断点续传**：复用 `State`（`state.json` v5）；`.part` 续传、`.segs*` 片段、`source_hash/mtime` 记忆校验跳过。
5. **账号轮换 / 冷却**：`TrafficCapped` → 记 `trafficCappedAt` → 换下一账号；全冷却则等最早到期；1 小时为重试间隔。
6. **换机还原**：见 §2.6，device_id 随迁，PikPak 侧设备指纹不变。

## 6. 状态机

- 账号：`unknown / ready / cooling / in-use / session-dead`。
- 链接：`idle / parsed / parse-error`。
- 任务：`queued / restoring / downloading / verifying / cleaning / paused / cancelled / done / partial / error`；文件级 `pending / restoring / downloading / unverified / done / too_big / failed`（沿用 PikpakGet 语义）。

## 7. 已知坑 / 风险

- 同一 PikPak 账号只归一个引擎所有；不要同时在 PC 本机引擎和 NAS 引擎登录（device_id / 出口 IP 不一致易触发风控）。
- `captcha_sign` 的 md5 盐链、客户端头、`decode_share_file_id`、hash 的「块 SHA-1 的 SHA-1」候选分片，任一不同都会登录/枚举/校验失败——引擎侧直接复用 `pikpakget` 规避。
- `restore` 丢失响应时「结果未知、停止重发、下次启动查副本」，不能盲重试。
- 主密钥丢失 = 账号密码不可恢复（会话可重登但密码拿不回）；务必保管 `.env`。
- PikPak 接口 / 配额 / 风控可能变化；多账号轮换不保证每个都成功。
- 外网访问用 Tailscale/WireGuard，**不要**把引擎端口做公网端口转发。

## 8. 验证

```bash
pnpm test            # app 侧 engine client / store 单测（本地 HTTP mock）
pnpm typecheck
pnpm data-layers:check
```

手工验收：

1. NAS 起引擎 → app 填 `http://<nas>:8787` + token → `CONNECTION_TEST` 通过。
2. 添加账号 → 列表可见 → `WHOAMI` 显示云盘用量。
3. 粘贴分享链接 → 「解析」出文件树 → 勾选子集 → 开始下载 → 进度实时刷新 → 完成后 NAS `/downloads` 落盘正确。
4. 下载中断 → 重启引擎 → 重连 app → 任务显示可续传 → 续传成功。
5. 备份 `config/` + `.env` → 换目录/换机还原 → 账号完整、device_id 不变、可续期。
6. 主密钥错误时启动报「主密钥错误」且不覆盖 `accounts.json`。

## 9. 落地状态与剩余验收

已落地：引擎纯 TS（`tools/pikpak-get/backend/engine/`，含加密/账号/链接/任务/HTTP），本机内嵌调用 + NAS HTTP 服务（`deploy/pikpak-get-nas/` 打包 `service.mjs` 跑 Node Docker），控制面三视图（账号池 / 分享链接 / 下载任务）与「本机/NAS」切换，`edt-kdf:v1` 信封换机还原。

自动化验证已过：`vue-tsc` / `tsc` / `data-layers:check` / `eslint`；引擎侧 `py_compile` + `edt-kdf:v1` 加密单测 + PikpakGet 原 311 项回归全通过。

剩余为真实环境手工验收：NAS 部署、本机引擎启动、真实 PikPak 账号端到端下载（见 §8）。
