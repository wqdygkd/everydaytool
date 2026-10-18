# interceptor（拦截器）设计分析

> 状态：已实现（2026-10-18 落地）。模块代码见 `tools/interceptor/`（backend 代理/证书/规则/WS 桥 + extension + renderer）；本文保留设计决策记录，与实现的差异处以「实现备注」标注。
> 目标：用户自己开的浏览器 + 配套扩展，与 edt 本地通信；在 edt 里实现接口代理、请求/响应修改、脚本注入。
> 本文是 2026-10-17 设计讨论的沉淀，实现前先读本文。

## 1. 总体结论与形态

可行。**主方案：edt 内置 MITM 代理，扩展通过 `chrome.proxy` 把浏览器流量挂过来，并负责脚本注入。**

- **扩展**（用户自己浏览器里解包安装一次，保持瘦）：只做三件事——用 `chrome.proxy` API 一键挂/摘代理（不动系统代理）、与 edt 的 WS 桥接、按 edt 指令做脚本注入与事件回传；
- **edt 工具模块**：大脑。本地跑 HTTP/HTTPS MITM 代理（改包、mock、日志全在这里），管理 CA 证书、规则、脚本与 UI；
- **通信**：edt 主进程起本地 WS 服务，扩展主动连入，双向 JSON-RPC。

已确认约束：浏览器用户自己开（不接管启动）；**不使用 `chrome.debugger`**（横幅 + 与 F12 冲突，明确否决）；不碰系统代理（只走扩展的 `chrome.proxy`）；**目标站既有域名/IP、又有字面 `127.0.0.1` / `localhost`（混合）→ 代理接入统一走 fixed_servers + `<-loopback>`**（§2）。

## 2. 代理方案（核心）

### 形态与能力

- edt 里跑真代理（Charles/Fiddler 同型）：明文 HTTP 直接接管，HTTPS 走 CONNECT + MITM 拆解；
- 能力：全量流量（页面加载、资源、第三方、XHR/fetch）的请求/响应体随便改，mock、改头、重定向、限速、断点、重放全支持，不受 MV3 限制；
- 日志：全量请求/响应（含 body）在 edt 侧落库，UI 实时看。

### 接入方式（按目标类型定策略）

- **B. 全量固定代理（fixed_servers + bypassList `<-loopback>`）**：域名、内网 IP、字面 `127.0.0.1` / `localhost` / `*.localhost` 全类型通吃——**目标混合时唯一能全包的方式**。全 profile 全量经 edt，"只改目标"由 edt 内部过滤 + 非目标透传完成；
- **A. 按域名路由（PAC）**：仅当目标**全部**是域名/IP（不含任何字面回环）时可用，非目标直连、完全不经 edt。字面回环它盖不住（隐式直连使 PAC 拿不到，见下），混合场景不可用；
- **结论（本项目）**：目标混合（域名/IP + 字面 `127.0.0.1` / `localhost`）→ 统一以 **B** 为基线；A 留作将来"纯域名且要最小化干扰"的可选优化，不进第一版。

### 关键前提：CA 证书

- HTTPS 需装一次本地 CA 才能看到内容（否则只能看域名/端口）；每浏览器 profile 一次；Chrome 走系统证书库（生成与安装/卸载方案见 §11）。

### loopback 与隐式直连（接入关键机制）

- Chromium 有**隐式直连规则**：`localhost`、`*.localhost`、`127.0.0.1/8`、`::1`、link-local（`169.254/16`、`fe80::/10`）默认不走代理；
- 解除办法：fixed_servers 的 bypassList 加特殊减法规则 `<-loopback>`。**PAC 模式无法解除**（Chromium 明确：PAC 拿不到 loopback 流量）→ 字面回环目标必须走 B 模式，PAC 只适用于 A 模式；
- hosts 映射成域名的地址（如 `erp.xxx` → 127.0.0.1）不在隐式直连名单内，本来就能走代理（A 模式可用）。
- 机制依据：Chromium 官方文档《Proxy support in Chrome》（net/docs/proxy.md）。

### 坑位与设计约束

- **死循环防护**：真正的循环只有"代理把请求发给自己"——代理上游连接一律直连 socket（不走自身/系统代理），并拒绝把请求转发到自身监听地址；
- **工具的 WS 端口**在 bypassList 里留直连条目（`127.0.0.1:<WS端口>`；ws 是否吃 host:port 规则实现时实测，不吃也只是多一跳本地转发、无循环风险）；
- **公司上游代理透传**：目标是回环（含 `*.localhost`、hosts 映射到回环的域名）时强制直连、不发上游；按解析结果判定，不看字面；
- **自签证书**：本地回环服务多为自签证书，MITM 对回环上游默认跳过上游证书校验（可配置），否则一开代理全部握手失败；
- **WS/SSE**：本地服务常带实时推送，代理需支持 Upgrade 转发（MITM 本身也要支持）；
- **逃生开关**：扩展 popup 保留"一键直连"，edt 挂掉不至于把浏览器流量卡死；
- **安全面**：`<-loopback>` 会连 link-local 一起放开，风险可控（edt 是本地可信进程），关开关即恢复；
- MITM 实现量大（CA 生成/管理、CONNECT、TLS 拆解），原计划用现成 Node 代理内核，不手写。
  实现备注：最终为完全掌控 CONNECT 分流时机（名单内 MITM / 名单外原始隧道）与规则注入点，代理内核为手写实现，见 `tools/interceptor/backend/services/proxy-service.ts`；WS 桥与证书仍用现成库（ws / node-forge）。

## 3. 代理作用域与页面级策略

`chrome.proxy` **没有 tab / 页面粒度**——作用域只有 regular / incognito 两个，设置即整个 profile 全局。想"只让某个页面走代理"，按目标类型分三种情况：

1. **目标全是域名/IP（无字面回环）**：可选 PAC 按 URL 路由（§2 的 A 模式）——只有目标经过 edt，其他站点直连、不被 MITM。注意是"按 URL"不是"按 tab"：同域名开多标签会一起走；本项目目标混合，此路不通；
2. **目标含字面回环（纯回环或混合）**：PAC 无解，统一 B 模式全量过 edt；"只对目标生效"在 edt 内实现——命中目标域名/规则才改包 + 记日志，其余走 CONNECT 透传隧道（**不拆 TLS**）；
3. **要让其他 tab 物理上完全不经 edt**：`chrome.proxy` 做不到。变通：独立浏览器 profile（专用 profile 才装扩展开代理）或无痕窗口（incognito 作用域，扩展允许无痕运行）；代价是登录态 / cookie 独立，内网系统要重登。Chrome 无真 per-tab 代理 API，此路不通。

反面教材：按"当前激活标签"动态全局开关代理的土办法——后台标签的请求也会被卷进来，不可靠。

### 处理名单（页面级控制的落地形态）

- **定位**：名单是 edt **处理层**的过滤器，不是浏览器路由层——固定代理下全量流量已进 edt，名单决定"谁被拆包/改包/记日志，谁走透传隧道（不拆 TLS）"。浏览器层没有"只把名单域名送进代理"的能力（fixed_servers 只有 bypass 黑名单，PAC 摸不到回环）；
- **控制入口**：扩展 popup。在目标页面上点扩展图标 → 读取当前标签 URL → "加入名单"/"移出名单"（经 WS 推给 edt，落 edt 存储）；
- **条目模型**：`{ host, port?, 匹配方式: 精确 / 后缀 (*.domain) / 正则 }`。回环目标必须带端口（如 `127.0.0.1:8089`），不然会圈进机器上所有本地服务；
- **相关域名提示**：一个页面往往调多个域（页面域 + API 域），popup 可从 edt 流量日志取"该页最近实际请求的域名"供勾选，避免漏网；
- **副产物**：非名单目标 HTTPS 走 CONNECT 透传、不拆 TLS → 名单同时控制着"谁会被 MITM"，证书风险面只在名单内；
- **前置条件**：代理开关处于"全量挂载"（B 模式）且名单为空 = 全部透传；名单存 edt（config.json），跨浏览器共享。

## 4. 路线决策记录

| 路线 | 能力 | 结论 |
|---|---|---|
| MITM 代理 + chrome.proxy | 全量含 body、无横幅、不受 MV3 限制；代价=装一次 CA | **选定** |
| chrome.debugger（CDP 拦截） | 全量 | 否决：出现"正在调试"横幅、同页面无法与 F12 并存 |
| 页面层 hook + DNR | 改头/重定向覆盖全量（DNR），改 body 仅覆盖页面 JS 请求（hook）；零安装 | 不采用为主骨架（body 覆盖不全）；需要时可当轻量辅助，不进第一版 |

## 5. 通信方案

- edt 侧：主进程起 `127.0.0.1` WS 服务端，端口绑定回环；
- 扩展侧：MV3 service worker 作 WS 客户端。SW 会休眠，需 ping 保活（Chrome 116+ 有 WS 流量即可续命）+ 自动重连；
- 安全：Origin 校验（只接受 `chrome-extension://<本扩展 id>`）+ 握手 token，防本机其他进程/页面乱连；
- 代理开关状态同步：扩展挂/摘代理、浏览器侧异常（如证书未装导致的报错提示）经 WS 回传 edt；
- 端口策略（待定）：固定端口段轮询（edt 取首个空闲端口，扩展按同段探测），或由扩展配置页手填。

## 6. 脚本注入

- 动态脚本并入规则体系：规则的一种类型（`InterceptorRule.type = 'script'`，配置 `InterceptorRule.script{code, world, runAt}`），在规则列表与整页编辑器统一管理，无独立页签；
- edt 侧 `script-compile.ts` 把 script 规则编译为 `InjectedScript`：source 条件编译成窄 chrome match pattern（注册范围）+ 代码外套运行时守卫（对 `location` 复刻 source 匹配语义，URL 留空 = 所有页面、不守卫）；随规则变更经 WS `scripts-sync` 下发，扩展用 `chrome.userScripts.register`（MAIN / USER_SCRIPT、document_start/end/idle）注册执行，扩展零改动；
- 脚本正文存 edt（rules.json），扩展只管注册执行、开关、日志回传；改动对已打开页面在下次导航生效；
- 不采用"代理往 HTML 里塞 script"的方式：受页面 CSP 限制、注入时机晚。

## 7. 扩展更新策略（"扩展零更新"原则）

原则：**扩展只放通用原语**（代理开关、WS 桥、脚本注入、事件回传），规则/改包/日志/mock 全在 edt 的代理里跑；edt 负责编译规则与下发指令。

| 改动 | 要动扩展吗 |
|---|---|
| 加规则、加脚本、加匹配逻辑、加面板功能 | 否（纯 edt 侧） |
| 新增原语能力（如 cookie 操作、截图） | 是，更新一次 |
| manifest 权限变化 | 是 |

分发：解包自托管（不走商店），更新成本 = 覆盖扩展目录 + chrome://extensions 点"重新加载"。第一版把原语集规划全，之后基本不用碰扩展。

## 8. 架构取舍：为什么必须拆 edt + 瘦插件

- MV3 扩展**跑不了 TCP 代理服务**（没有 raw socket 能力）→ 代理天生只能放 edt，全塞插件方案直接不成立；
- edt 侧才能承载：完整规则编辑器、流量日志面板（含 body 落库）、多浏览器统一管理；
- 代价：edt 不开时代理全停（这是选定方案的固有形态，不算坑）。

## 9. 模块结构（规划）

```
tools/interceptor/
  index.ts                # 工具注册
  renderer/pages/         # 管理页：目标清单 / 规则（含动态脚本）/ 流量日志 / 代理开关 / CA 证书引导
  backend/
    index.ts              # ToolBackend 入口
    ipc/                  # channels + handlers
    services/             # ws-server（桥）/ proxy（MITM 内核）/ ca-manager（CA 生成与签发）/
                          # rule-engine（规则模型与执行）/ mock-service / script-compile（脚本规则编译）/
                          # body-script（动态请求体 JS 沙箱执行）
    store/                # 规则（含动态脚本）、日志（走 data-root）
  extension/              # MV3 扩展源码（manifest / background / content / injected）
```

数据根目录：`data/interceptor/`（config.json / rules.json / 日志库；旧 scripts.json 启动时一次性迁移进规则）。

## 10. 功能覆盖核对（对照同级项目 winex-tool）

winex-tool 是 Tampermonkey 用户脚本（页面内浮动面板 + GM 存储），本方案对其全部工具的映射：

| winex-tool 工具 | 性质 | 覆盖方式 |
|---|---|---|
| request-modify（请求头 set/append/delete、状态码、响应体 full/replace/merge、延迟） | 网络层（ajax-hook，仅 XHR） | 代理规则引擎；覆盖面更全（fetch / 资源 / 非页面请求都管） |
| param-mock（按 paramNo 改 paramConfigs） | 响应体 JSON 变换 | 代理规则（JSON 变换动作） |
| devops-dashboard（getAppMenuByUserAndCollect / getUserInfo 响应注入） | 响应体 JSON 注入 | 代理规则 |
| event-mock（`window.winning.dispatchEvent` 桥 mock） | JS API 层 | 脚本注入（document_start、MAIN world）；规则/预设存 edt |
| disable-traceid（URLSearchParams / URL 原型 hook） | 页内 JS | 脚本注入 |
| devops-login（登录页 DOM 调整） | 页内 DOM | 脚本注入 |
| show-identity-label（TFS 页 DOM 增强） | 页内 DOM | 脚本注入 |
| storage-copy（cookie + local/sessionStorage 跨环境搬运） | 页内存储 | 脚本注入（storage）+ 快照存 edt；cookie 要含 HttpOnly 需给扩展加 cookie 原语 |

结论：全覆盖。需接受的三点形态差异：

1. 网络层改包的前提从"装脚本"变成"装 CA 证书"（HTTPS MITM）；不装证书时该类功能退回脚本注入 hook fetch/XHR（等价现状，只覆盖页面请求）；
2. JS API / 页内 DOM 类工具全部走脚本注入通道（方案内既有原语），形态从"内置工具 + 页面浮动面板"变为"edt 管理的注入脚本"；
3. 数据（规则 / 脚本 / 存储快照）从 GM 存储迁到 edt，跨浏览器共享；cookie 若要读写 HttpOnly 需给扩展加 chrome.cookies 原语（一次更新）。

## 11. CA 证书方案（生成 / 安装 / 卸载，定稿）

仅需支持 Chrome（Windows / macOS）。

### 生成（edt 后端，跨平台同一套）

- 根 CA（RSA 2048 或 ECDSA P-256，10 年）+ 运行时按域名动态签叶证书（SAN 含域名与 IP，内存缓存）；
- 库：node-forge（纯 JS 零原生依赖；不依赖系统 OpenSSL——Windows 不自带）；
- 存放：`data/interceptor/certs/`（`ca.key` 收紧权限 / `ca.crt` / 叶证书缓存）；卸载时一并清理；
- 命名固定（如 `edt Interceptor CA`），便于用户识别与卸载定位。

### Windows 安装 / 卸载

- 主路径：**当前用户根证书库，免提权**：`certutil -user -addstore Root ca.crt`；
- Chrome 读 Windows 系统证书库（含 `CurrentUser\Root`）→ 装完即生效、无 UAC；
- 卸载：`certutil -user -delstore Root <SHA1 指纹>`（按指纹删，幂等、防同名误删）；
- 兜底：企业策略锁用户库时 → 提权装 `LocalMachine`（UAC）或手工向导（双击 → 安装证书 → 当前用户 → 受信任的根证书颁发机构）。

### macOS 安装 / 卸载

- 主路径：**系统钥匙串 + 管理员授权**：`security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt`；Electron 内经 `osascript ... with administrator privileges` 弹原生授权框；
- 备选（免 sudo 尝试，待实测）：登录钥匙串（`-k ~/Library/Keychains/login.keychain-db`），Chrome 吃用户信任设置，可能可行；
- 卸载：`security delete-certificate -Z <SHA1> /Library/Keychains/System.keychain`（登录钥匙串同理）；
- 手工兜底：`open ca.crt` → 钥匙串访问导入 → 双击 → 始终信任。

### 状态检测与 UI

- 检测：Windows `certutil -user -store Root <指纹>`；macOS `security find-certificate` + 信任设置；
- UI 对称：一键安装 / 一键卸载 / 状态（未装 / 已装 / 失败：区分"取消授权"与"策略拒绝"）/ 手工模式的命令复制；
- 幂等：查、删均走 SHA1 指纹。

## 12. Requestly 代理模式参考（对照校准）

来源：`D:\project\requestly`（客户端 monorepo；桌面端 Electron 主进程与代理内核在独立仓库 `requestly-desktop-app`，不在本地——本节覆盖扩展、桌面端 UI 与两端可见的接口面）。

### 12.1 架构对照（vs 本文档方案）

| 环节 | Requestly | 本文档 |
|---|---|---|
| 代理节点 | 桌面端本地 MITM 代理，默认 8080、可配置（改端口需重启） | edt 本地 MITM 代理 |
| 控制通道 | 桌面端 WS 服务端，默认 **59763**（扫描 +4），握手 `{type:"handshake"}` → `{type:"handshakeResponse"}`；同端口响应 HTTP GET 供存活探测 | edt 主进程 WS + token / Origin 校验 |
| 端口下发 | 扩展连上后发 `get-proxy`，桌面端回 `{proxyPort}`；扩展不硬编码代理端口 | 同思路（§5） |
| 扩展开代理 | `chrome.proxy.settings.set`：`fixed_servers` + `singleProxy(scheme:"http")` + `bypassList`（blocked domains 及其 `*.` 子域 + 硬编码 `meet.google.com` / `*.requestly.io`），scope `regular` | B 模式；bypassList 加自有端口 + `<-loopback>`（他们不处理 loopback 目标） |
| 掉线策略 | fail-open：WS close/error → `removeProxy()` 自动直连 | 见 §13 待定项，参考其 fail-open |
| 身份 | UA 嗅探 appId（`existing-chrome`/`existing-edge`/…）+ 连接携 `connectedExtensionClientId`（区分多 profile） | 见 §13，可复用此模型 |
| 心跳 | 桌面端 → 扩展 `heartbeat`，扩展回声；Chrome 116 起 WS 收发重置 SW 空闲计时 ⇒ 探活 + 保 SW 存活 | §5 心跳机制确认 |
| 单主原则 | 连接后扩展全局停用自己的规则引擎（弹窗明示"断开前扩展不工作"），改包全由桌面代理执行 | 我们扩展本就瘦；注入能力保留（差异点） |

### 12.2 处理名单 / SSL 拦截（对应 §3）

- `SSLProxyingModal`（当前被 feature flag 隐藏）：按 host 的**包含 / 排除双模式**——Enable All = 全拦 + 排除表，或仅拦包含表；operator 支持 Equals / Contains / Matches / Wildcard；存桌面端 storage（`SSL_PROXYING:*`）。默认全量拆包。
- 我们是名单驱动、空名单 = 全透传（混合目标场景更安全，保护日常浏览不被 MITM）；表达力可借鉴其"包含 / 排除双模式"。
- 流量表**右键一键建规则**（Redirect / Modify Response / Modify Request / Headers / Replace 预填）——"从捕获流量加入名单 / 建规则"的 UX 直接可用。

### 12.3 CA 证书（对应 §11，结论一致）

- 桌面主进程提供：`system-wide-cert-status` → `{installed, trusted}`、`system-wide-cert-trust` 一键安装信任、`save-root-cert` 导出 PEM（`RQProxyCA.pem`）、`renew-ssl-certificates` 重签（"遇信任问题可重置"）。
- UI：**Automatic / Manual 双 tab**——自动按钮 + 手动图文步骤（Windows 受信任的根证书颁发机构导入；macOS 钥匙串导入 + 始终信任，标注 "Admin permissions required"）+ 配 gif。
- 可借：双 tab 形态、状态双标签（Installed / Trusted）、重签入口；实现细节与 §11 的校准见 12.8。

### 12.4 配置页面清单（桌面端 UI）

| 页面 | 作用 | 机制 |
|---|---|---|
| Header 代理状态 + Connect | `ip:port` / No Proxy / "Waiting for proxy server to start"；已连接数 → Connected Apps 弹窗 | Redux `desktopSpecificDetails`，IPC 推送更新 |
| Settings → 默认代理端口 | 合法区间 1024 < port ≤ 65536；先关闭托管浏览器；重启生效 | `USER_PREFERENCE:UPDATE_DEFAULT_PORT` |
| Settings → Regenerate SSL Certificate | 重签根证书 | `renew-ssl-certificates` |
| Connected Apps 弹窗 | 托管源管理（浏览器 profile / 设备 / 终端 / 全局）激活 / 断开 | `activate-app` / `deactivate-app` / `disconnect-extension` |
| 说明向导（每类源） | 分步指南；System-wide 有 Automatic / Manual；终端一键 `. <(curl localhost:{helperPort}/tpsetup)` | `system-wide-proxy-start` / `system-wide-cert-trust` 等 |
| 流量表（InterceptTraffic） | 推送 `log-network-request-v2`（HAR entry，UA 识别来源 app）；筛选 / 暂停 / HAR 导出 / 保存会话 / 右键建规则；仅表格挂载时 `enable-request-logger` | RTK entity；filters 持久化 |
| 扩展 popup | 未检测到 = 什么都不显示（装了没跑 / 没装不可区分）；检测到 = Connect 卡；已连 = Connected 视图 + Disconnect；纯请求/响应式，无推送监听 | `CHECK_IF_DESKTOP_APP_OPEN` / `IS_PROXY_APPLIED` 等 |

### 12.5 借鉴 / 不跟

- **借**：高随机控制端口 + 握手扫描；`get-proxy` 下发代理端口；fail-open；UA appId + clientId 多 profile；Automatic / Manual 证书双 tab；右键建规则；包含 / 排除双模式。
- **不跟 / 改进**：扩展与桌面两端 WS 均无 token / Origin 校验（源码已确认，任意本地进程可连）——保留我们的 token + Origin 校验；无自动重连（无 alarms、端口缓存后不重扫）——我们做 SW 启动探测 + 失败重扫；popup 缺"未运行"态且无推送——我们做全；连接后扩展全停用——我们的注入能力保留；不处理 loopback——我们靠 `<-loopback>` 支撑混合目标。
- **权限面**：proxy / tabs / storage / scripting 必备；他们含 webRequest / DNR（自带规则引擎需要，我们不需要），缺 alarms（我们加）。

### 12.6 对 §13 待定项的参考值

- 降级：fail-open 自动撤代理（Requestly 实践）；
- 身份：UA appId + 每连接 clientId；
- 端口：控制通道高随机段 + 扫描握手，代理端口走 WS 下发；
- 重连：他们只做"popup 打开时探测"，无自动重连——短板，我们补。

### 12.7 规则编辑 UI（修改请求 / 修改响应）

- **规则结构**：一条规则 = 多个「If(Source) / Then(Target)」pair（折叠卡片，首个不可删、其余可删；底部虚线「Add a new condition」）。
- **Source 构造器**：key(URL/Host/Path) + operator(Equals/Contains/Matches/Wildcard) + value；placeholder 随 key+operator 变化；regex/wildcard 提供「Test」（试匹配弹窗、可回写）与「Try example regex」；高级过滤器（resource type / method / page URL / payload / page domains）走 Modal，按钮带数量 Badge。
- **请求体编辑**：工具栏 Radio「Static Data (JSON) / Dynamic (JavaScript)」；**切换不丢草稿**（按模式双缓存，切动态自动填默认 JS 模板 `modifyRequestBody(args)`）。
- **响应编辑**：状态码 AutoComplete（可自由输入、留空 = 回退原始码、自动补 statusText）+ 响应体三态（Static / Dynamic JS / Local File，本地文件路径支持 `$1` 捕获组）+「不调服务器直接返回」checkbox（mock 化）。
- **Headers**：Request / Response 双 Tab + 数量 Badge；行 = 类型下拉（Add / Remove / Override）+ 名称 AutoComplete（静态建议表）+ 值 + 删除；空态用 Add / Remove / Override 三个虚线入口引导。
- **QueryParam**：类型（Add/Replace、Remove、Remove All）联动禁用 Param/Value；至少保留一行。
- **从流量一键建规则**：流量表右键（Redirect / Modify Response Body / Modify Request Body / Modify Headers / Replace + More 子菜单）→ 弹窗编辑器（920px），自动预填 source（URL Equals）+ 原始 body，打开即聚焦首个输入框；保存后 toast 内「View rule」跳整页编辑；已应用规则可从流量列表图标回跳编辑器。另有「Edit and Replay」直达 API Client 编辑重放。
- **编辑器选型**：CodeMirror 6 + VS Code 深色主题（JSON/JS/HTML/CSS），行内 lint、美化/压缩、复制、全屏、字符计数；保存前静态 body 自动 minify；正则保存前做 RE2 兼容校验；编辑器/列表启停 Switch 切换即保存。
- **差异注意**：其改包 body 仅 Static/Dynamic 两态，**无 content-type / form-data / 文件上传**（multipart 编辑在 API Client 模块）；我们不涉及表单，body 编辑按 Static(JSON) / Dynamic(JS) 两态对齐（已实现；「Select Resource Type」REST/GraphQL 卡也已复刻，GraphQL 因引擎未支持而置灰 + 提示）。

**我们的取舍（v2，已实现）**：单规则单动作（不做多 pair 折叠），10 种类型 `redirect / replace / queryParam / cancel / delay / headers / userAgent / request / response / script`（源模型 `shared/interceptor.ts` → `InterceptorRule.type`；script 为动态脚本，浏览器侧注入执行、不进代理）；高级过滤器内联在 If 卡片（method / resourceType（Sec-Fetch-Dest 推断）/ pageUrl / requestPayload，无 Modal、无 Badge）；执行顺序：cancel 短路 > redirect 本地 30x（302 默认，可 301/307/308，支持 `$1` 捕获 + 保留查询串）> replace / queryParam 透明改写上游 URL > delay（上限 30s）> 请求头 / UA / 请求体（`request` 两态互斥、后者胜：static 整体替换 / code 动态改写在代理侧 vm 沙箱执行 `modifyRequestBody(args)`，args = `{ method, url, body, bodyAsJson }`，支持 async，1s 超时，失败 / 超时 / 未返回时保留原体，content-length 同步）> mock 或上游 > 响应头 / 响应体 / 状态码；流量条目标记 取消 / 重定向 / 延迟 / 实际改写目标（`canceled / redirectedTo / delayedByMs / rewrittenTo`）。UI 见 `RulesPanel.vue`（「新建规则」按钮挂 Requestly 式类型下拉：URL 改写 / API Mock / 请求头 / 其他 四组，组标题 + 分隔线，条目 = 图标 + 标题 + 描述，含「动态脚本」直接进编辑器——脚本已并入规则体系，无独立页签；选中类型进入 Requestly 式**整页编辑器**（非弹窗）：左侧类型导航（点击就地切换类型）、顶部面包屑（规则 › 创建规则 / 编辑规则）+ 启用 Switch + 保存规则（支持 Ctrl+S）、标题行内重命名（pencil）+ 描述（可选，`InterceptorRule.description` 仅展示不参与引擎）、「If 请求匹配」折叠卡片（source 行 + 高级过滤内联展开；脚本类型显示「If 页面匹配」并隐藏高级过滤，URL 留空 = 所有页面）、Then 动作区（redirect 为「重定向到」+ 目标 URL 输入 + 单选 另一个 URL / 本机文件（禁用）/ 文件服务器（禁用）+ 状态码与保留查询串，request 为「选择资源类型」卡（REST API 选中 / GraphQL API 禁用 + 提示，对齐 Requestly）+「请求体」区（Radio 静态数据 / 动态（JavaScript）带 ⓘ tooltip；切换不丢草稿——按模式双缓存，切动态自动填 `modifyRequestBody(args)` 模板；等宽代码框 + 字符计数），script 为「插入脚本」（world + runAt + 代码编辑 + 字符数），queryParam 为 Requestly 式参数修改行（类型文本下拉 添加 / 替换·删除·清空全部；参数 / 值 输入行——值仅 add 可用、removeAll 禁参数名；✕ 行删除；虚线「添加参数修改」按钮；空列表自动补一行），其他类型为「动作」+ 对应表单）、底部「添加新条件」禁用占位（置于 If 折叠卡外，折叠时仍可见；暂不支持多条件）；返回按钮丢弃草稿，保存回列表；script 规则保存后由 `script-compile.ts` 编译为注入脚本（窄 match pattern + location 守卫）经 WS 下发给扩展 chrome.userScripts 注册）。列表页对齐 Requestly my-rules 的 content-list 布局（浅色适配）：面包屑「规则 > 过滤项」+ 工具栏（搜索 / 全部·已固定·已启用计数 pill / 新建规则）+ 表格（多选、钉选 `pinned`、名称链接（点开编辑器）、类型、启停 Switch、更新时间、行操作 复制 / 删除）+ 底部批量操作栏（启用 / 停用 / 删除），列头可排序（名称 / 类型 / 更新时间，循环 升→降→按执行顺序）。

### 12.8 证书方案（Requestly 实际实现，源码级）

来源：桌面端 `src/renderer/actions/apps/os/ca/*` + npm 包 `@requestly/requestly-proxy@1.5.2`（`dist/lib/proxy/lib/ca.js`——结构即 http-mitm-proxy 的 CA 模块 fork；`dist/constants/cert.js`）。

**生成**：

- node-forge，RSA 2048，SHA-256 签名，16 字节随机序列号；
- 根 CA：CN/O = `RQProxyCA`、OU=CA、C/ST/L=Internet；basicConstraints cA=true + keyUsage keyCertSign + extKeyUsage(serverAuth/clientAuth/…) + subjectKeyIdentifier；
- **有效期 = 当前-1 天 至 +365 天**（源码注释"延长需谨慎"）；代理启动时发现过期自动重签；
- 落盘：`certs/ca.pem` + `keys/ca.private.key` / `ca.public.key`；叶证书按 host 落盘 `certs/<host>.pem`（`*`→`_`）+ 对应密钥；
- 叶证书：CN=host，SAN 含 DNS 与 IP（IPv4 正则 → type 7），每 host 现场生成独立 2048 位密钥；
- 重签：清空旧 certs/keys → `onCARegenerated(path)` 回调 → 桌面端从系统库删除旧证书（下次需重新信任）。

**信任安装**：

- Windows：`certutil -user -addstore Root <ca.pem>`（用户库、免管理员）；检测 `certutil -user -verifystore Root RQProxyCA`；trusted ≡ installed；删除 `certutil -delstore -user Root RQProxyCA`；
- macOS：`osascript "do shell script \"security add-trusted-cert -r trustRoot -k $HOME/Library/Keychains/login.keychain …\" with prompt …"`——**登录钥匙串 + osascript 确认框，不用 System.keychain、无需管理员**；检测 `security find-certificate -c RQProxyCA <login.keychain>`；信任状态 `security dump-trust-settings`（用户信任设置里非 Deny 即视为信任）；
- 自动安装时机：① 扩展 WS 上报 `browser-connected` → 先装证书再通知 UI；② 激活 system-wide 源 → 先装证书再接代理；
- Firefox/NSS：仓库打包整套 NSS `certutil` 工具链（darwin/linux/win32）；Android：按 openssl `-subject_hash_old`（DN 的 MD5）规则命名证书文件。

**其余**：导出 `save-root-cert`（保存 `RQProxyCA.pem`）；重签入口 `renew-ssl-certificates`；上游 TLS 校验另有 `allowInsecureCerts` 开关（默认校验）。

**对 §11 的校准**：

- Windows 路径与 §11 一致（certutil -user 用户库）；
- macOS 主路径建议改为登录钥匙串 + osascript 确认框（Requestly 量产验证、无管理员），System.keychain + sudo 降为兜底；
- 有效期：他们 365 天 + 到期自动重签（重签会清掉系统库旧证书，用户需重新信任）；§11 的 10 年省事但轮换不友好——按需二选一；
- 删除策略：他们按 CN 名删（同名多证书会误删）；§11 按指纹删更稳，保留。

## 13. 待定项（实现前需拍板）
- 端口与 token 握手策略（WS 端口 + 代理端口；固定端口段轮询 vs 扩展配置手填）；
- 第一版范围：代理骨架（HTTP/HTTPS MITM + 改头/改体/mock/日志）+ 扩展开关与 WS 链路 + 脚本注入；限速/断点/重放二期；
- B 模式为基线（混合目标唯一解）；A 模式是否保留、何时启用待定（纯域名场景优化）；
- 代理存活降级策略：edt 掉线 / 代理进程崩溃时，扩展是自动切直连（并通知）还是保持等 popup 手动恢复；
- 上游代理透传的探测与链式转发策略（回环强制直连已定，公司代理探测待定）；
- 扩展 popup 逃生开关的交互形态；
- 处理名单：popup"加入/移出名单"交互、条目匹配语义（精确 / 后缀 / 回环带端口）、相关域名提示的数据来源；
- 多浏览器 / 多 profile 的连接与代理身份区分；
- 扩展目录位置与首次安装引导（edt 打包资源附带 + "打开扩展目录"入口）。

## 14. URL 路由（页签 / 规则类型深链）

路由即页签状态：每个页签、每个规则类型各一条顶层路由（hash 模式），URL 可深链、前进后退可用：

| 路由 | 视图 |
|---|---|
| `/tools/interceptor` | 重定向到 `/status` |
| `/tools/interceptor/status` | 状态页签 |
| `/tools/interceptor/targets` | 处理名单页签 |
| `/tools/interceptor/rules` | 规则列表（全部类型） |
| `/tools/interceptor/rules/<type>` | 规则列表按类型过滤（10 种类型各一条） |
| `/tools/interceptor/traffic` | 流量页签 |

实现：工具定义新增可选 `subRoutes`（`shared/types/tool.ts` 的 `ToolSubRoute`），`renderer/router/routes.ts` 拍平为 `/tools/<工具>/<子路径>`；子路由继承主路由组件与 `meta.toolId`（页签高亮 / 常驻挂载依赖它），主路由为纯 redirect 记录（不带 component，重定向在渲染前完成）落到第一个子路由。页签与类型映射集中在 `tools/interceptor/renderer/tabs.ts`（`INTERCEPTOR_TABS` / `ruleTypeRouteName` / `tabKeyFromPath` / `ruleTypeFromPath`），页面与规则面板共用。规则类型过滤在规则列表工具栏的「类型」下拉；面包屑「规则」点击清空本地过滤并回到全部类型路由。规则编辑器（创建 / 编辑）仍是组件内视图，不进路由。
