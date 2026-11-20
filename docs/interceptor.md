# interceptor（拦截器）

> 工具域在 `tools/interceptor/`（backend 代理 / 证书 / 规则 / WS 桥 + Vue 管理页）；浏览器侧在平台扩展 `browser-extension/`（interceptor feature）。配置落在 `config/interceptor/`（`config.json` / `rules.json` / `certs/`）。
> 一句话：**处理名单决定"进不进处理层"，规则决定"这个请求怎么处理"。**

## 1. 形态与取舍

- **edt 内置 MITM 代理**（Charles / Fiddler 同型）：HTTP 明文直接接管，HTTPS 走 CONNECT + MITM；改包、mock、日志、脚本都在 edt 侧。
- **扩展保持瘦**：只放原语——`chrome.proxy` 一键挂 / 摘代理、与控制端口的 WS 桥、`chrome.userScripts` 脚本注入、事件回传。
- **为什么代理必须在 edt**：MV3 扩展没有 raw socket，跑不了 TCP 代理；规则编辑器、body 日志、多浏览器统一管理也只能在 edt。
- **扩展零更新原则**：加规则 / 改匹配 / 加面板 → 不动扩展；只有新增原语（如 cookie 操作）或改 manifest 权限才需要更新（解包自托管，覆盖目录后 `chrome://extensions` 重新加载即可）。
- 边界：浏览器由用户自己开（不接管启动）、**不碰系统代理**（只走扩展的 `chrome.proxy`）。
- 固有代价：edt 不开时代理全停；HTTPS 要装一次根 CA（每个浏览器 / profile 各一次）。

## 2. 代理接入（B 模式：全量固定代理）

- 扩展用 `chrome.proxy.settings.set`：`fixed_servers` + `singleProxy(http, 127.0.0.1:<代理端口>)` + `bypassList`；
- `bypassList` 只有两项内容：**`<-loopback>`**（解除 Chromium 对 localhost / 127.0.0.1 / ::1 的隐式直连，否则回环目标根本进不来）和**控制端口段**（`127.0.0.1:59763…59767`，避免 WS 被自身代理圈住）；
- 「只对目标生效」由 edt 内部完成：命中名单才拆包 / 记录 / 跑规则，其余走 **CONNECT 原始隧道**（不拆 TLS），见 §3；
- **能力**：改请求 / 响应头与 body、重定向、mock、延迟、UA、脚本注入；**WebSocket / SSE 以隧道桥接**（v1 不改帧，握手进流量）；
- **边界与坑**：`<-loopback>` 会连 link-local（`169.254/16`、`fe80::/10`）一起放开（edt 是本地可信进程，关开关即恢复）；hosts 映射到 `127.0.0.1` 的域名本来就不在隐式直连名单里，正常走代理；
- **死循环防护**：上游连接一律直连 socket（不走系统 / 自身代理），并拒绝把请求转发到自己的监听端口；
- **回环上游**多为自签证书，MITM 对回环目标默认跳过上游证书校验，否则一开代理全部握手失败；
- 为什么不用 PAC：Chromium 的 PAC 拿不到 loopback 流量，且 `chrome.proxy` 只有 regular / incognito 两个作用域，**没有 per-tab**（真要隔离就用独立 profile 或无痕）；
- 端口：控制通道固定段 `59763 +5`（edt 占首个空闲，扩展按段探测，无手填）；代理端口首次启动在 20000–59000 随机取一个并落盘，之后固定，可在状态页改为 1024–65535 任意值，改端口会重启代理并经 WS 通知扩展重挂（扩展不硬编码端口）；
- **监听双栈** `127.0.0.1` 与 `::1`（插件里填 `localhost` 时 Windows 可能解析到 `::1`）。

## 3. 处理名单（白名单闸门）

- **定位**：名单不是浏览器路由，而是 edt 处理层的白名单。命中 → 拆包、记流量、跑规则；没命中 → 整条透传（不改包、不记录、**规则一条都不跑**）。
- **条目模型**：`{ origin, enabled, noCache }`，一个条目 = 一个 origin，例如 `https://www.a.com`、`http://127.0.0.1:8089`。
- **判定**（`targetMatchesOrigin`）：请求 origin 与条目**字符串相等**（scheme + host + port），默认端口归一（`https://a.com:443` ≡ `https://a.com`）。
  因此 `https://www.a.com` 不匹配 `http://www.a.com`，也不匹配 `https://api.www.a.com`——子域、兄弟域都是独立 origin。
- **输入归一**（`parseTargetOrigin`）：粘整条 URL 只取 origin；纯域名默认 https；回环（`localhost` / `127.0.0.1` / `[::1]`）默认 http；非 http(s)、通配符、路径一律拒绝（路径 / 正则筛选用规则）。
- **`noCache`（强制回源，默认开）**：该 origin 的响应去掉 `cache-control` / `expires` / `etag` / `last-modified` / `age` / `pragma` 并改写 `no-store`，上行去掉 `if-none-match` / `if-modified-since` / `if-range`。
  不开的话浏览器命中缓存就**不产生请求**，流量页会莫名空白；关掉 = 尊重上游缓存。开关生效前已缓存的资源仍需强刷一次。
- **生效时机**：名单增删改后**断开所有透传隧道**，下一次请求重新 CONNECT 并按新名单分流（浏览器会长期复用旧连接，不断开新条目对它无效）。
- **相关域名提示**：popup 从流量日志取「该页最近实际请求的域名」，方便逐条加 origin。
- 空名单 = 全部透传；名单存 edt，跨浏览器共享。

## 4. 规则（名单内的流量怎么处理）

- 结构：`{ type, source{ key, operator, value }, filters?, 动作配置 }`。
  `key` = url / host / path，`operator` = equals / contains / matches（正则）/ wildcard；`filters` = 方法 / 资源类型 / 页面 URL / 请求体字段。
- **单条规则内部是 AND**：`source` 命中 **且** `filters` 全部满足。
- 十种类型：重定向、替换 URL、查询参数、取消请求、延迟（上限 30s）、修改请求 / 响应头、修改 UA、修改请求体（静态或 `modifyRequestBody` 脚本）、修改响应体 / Mock、动态脚本（浏览器侧注入，不进代理）。
- 动态脚本：`world` = `MAIN` / `ISOLATED`，`runAt` = `document_start` / `document_end` / `document_idle`。
- **多条规则之间是并集**：命中几条跑几条，按列表顺序叠加；合并语义按类型定：

  | 类型 | 合并 | 顺序影响 |
  |---|---|---|
  | 取消 | 任意一条命中即取消 | 无 |
  | 重定向 | 第一条生效，后续 redirect / replace / queryParam 跳过 | 窄的放前 |
  | 替换 URL / 查询参数 | 依次作用在上一条改写后的 URL 上 | 有 |
  | 改头 | 逐条执行 add / override / remove | 有 |
  | 延迟 / UA / 请求体 / 响应状态与响应体 | 后者覆盖 | 有 |
  | Mock | 第一条生效并短路（不请求上游） | 窄的放前 |

- 引擎管线：取消 → 重定向 → URL 改写 → 延迟 → 请求头 / UA / 请求体 → Mock 或上游 → 响应头 / 响应体 / 状态码；流量条目标记 `canceled / redirectedTo / delayedByMs / rewrittenTo / matchedRule*`。
- 脚本规则编译：`script-compile.ts` 把 script 规则编译成窄 match pattern + `location` 运行时守卫，随规则变更经 WS 下发，扩展用 `chrome.userScripts.register` 注册；改动对已打开页面下次导航生效（不采用"往 HTML 里塞 script"，受 CSP 限制且时机晚）。

## 5. 流量

- 流量页只记录**命中名单的请求**，内存环形 1000 条（不落库），body 超过 64KB 截断；详情里显示的是**实际发给浏览器**的响应头。
- 渲染层只持有**摘要**：主进程每 80ms 批量推送 `TrafficSummary`（不含请求/响应头与正文），打开详情时再按 id 经 `TRAFFIC_GET_ENTRY` 拉取完整条目；流量表用 `UiTable` 的虚拟滚动，只渲染可视区行。
- 实现约束：请求体需要改体或 payload 过滤时先整体缓冲，上限 **8MB**（超限直接 502，不假装成功）；上游超时 **30s**；`Upgrade`（WebSocket / SSE）只桥接不改帧。
- 空白 / 缺条目的排查顺序：

  | 现象 | 原因 | 处置 |
  |---|---|---|
  | 一条记录都没有，且页面也打不开 | 插件没生效 / 端口或地址填错 / 浏览器没走这个代理 | 核对代理端口；浏览器打开 `127.0.0.1:<端口>` 应看到探活页；挂上代理后**刷新页面** |
  | 页面能打开、流量页空白或只有零星几条 | 该 origin 不在名单（子域 / 兄弟域 / http↔https 都算不同 origin），整条透传了 | 把实际 origin 加进「处理名单」（扩展弹窗可一键加当前页） |
  | 名单里有、站点报证书错误 | 根 CA 没装 / 不被信任，HTTPS 解不开 | 证书页安装；Firefox 手动导入 `ca.crt` |
  | 只有个别资源缺失 | 浏览器命中缓存 / ServiceWorker，压根没发请求 | 该条目打开「强制回源」；已缓存的强刷一次 |

## 6. 证书

- 生成：node-forge 纯 JS；根 CA（`edt Interceptor CA`）有效期 10 年，落盘 `data/interceptor/certs/`（`ca.key` 经 `secret-box` 加密并 `0600`）；叶证书按 host 现场签发（SAN 含域名与 IP），**所有叶证书共用一把首次异步生成的 RSA 密钥**，仅内存缓存，进程重启按需重签。
- Windows：`certutil -user -addstore Root ca.crt`（当前用户根库、免 UAC，Chrome 读系统库）；检测 / 删除都走 SHA1 指纹。
- macOS：**登录钥匙串** `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db ca.crt`，经 `osascript do shell script … with prompt "…"` 由系统弹窗授权（无需管理员 / 不用 System.keychain）；检测 `security find-certificate -Z -c 'edt Interceptor CA' <keychain>`，删除按指纹。
- UI：证书页显示状态（未生成 / 已生成 / 未信任）、一键安装 / 卸载 / 导出 `.crt`；信任是**每个浏览器 / profile 各一次**——Chrome 走系统库，Firefox 等自带证书库的浏览器需手动导入导出的证书。
- 重签：会换指纹，系统里的旧证书需重新信任（「遇信任问题就重签 + 重装」是标准处置）。

## 7. 扩展与通信

> 扩展在平台层（`browser-extension/`，WXT），interceptor 是其中一个 feature。完整约定见 [`docs/browser-extension.md`](./browser-extension.md)。

- Origin 校验（只接受 `chrome-extension://<本扩展 id>`，服务只绑回环）+ **每次启动轮换的共享令牌**：edt 把随机令牌写进扩展目录的 `bridge-token.json`（0600），扩展重连时读取并放进 `hello`；没有令牌的握手回 `hello-reject { reason: 'bad-token' }`。扩展仍零配置，不需要用户手填配对码。
- 线协议为 **v1 信封**（`{ v, module, type, payload?, requestId? }`）：`shell` 负责握手/心跳，`interceptor` 承载业务；入站同时接受扁平消息。校验与 64 KB 上限不变。
- 业务语义（信封内 type / payload）：

  | 方向 | 消息 |
  |---|---|
  | 扩展 → edt | `hello`、`ping`、`proxy-state`、`add-target { url }`、`target-toggle { id, enabled }`、`target-remove-id`、`rule-toggle`、`rule-remove`、`site-info`、`target-suggest`、`script-log` |
  | edt → 扩展 | `hello-ok`（含 `modules` + interceptor bootstrap）/ `hello-reject`、`targets-sync`、`rules-sync`、`scripts-sync`、`proxy-port`、`set-proxy`、`heartbeat`，以及 `site-info-result` / `target-suggest-result` |

- **fail-open**：WS 断开自动撤销代理（避免"全浏览器断网"假象），并通知 popup；SW 靠心跳 + alarms 保活 / 自动重连（Chrome 116 起 WS 收发会重置 SW 空闲计时，心跳顺带续命）。
- **弹窗的 site-info 语义**：edt 回 `targets`（origin 命中的条目）+ `rules`（**按域筛出的可用规则**：同域标 `site` 排在前、不绑定域的标 `global` 排在后），**不是**拿当前页 URL 跑流量级匹配——路径 / 方法 / 资源类型属于流量级，弹窗不用它过滤。
- popup：读当前标签 URL → 一键把**当前 origin** 加入名单；列出该 origin 命中的条目与该站可用规则（可禁用 / 移除）；显示代理开关与连接状态。

## 8. 第三方代理接入（不用自带扩展）

代理端口是**标准 HTTP 代理**：不校验 Origin、无鉴权，SwitchyOmega / FoxyProxy / curl 直接指向 `127.0.0.1:<代理端口>` 即可。

- 只支持 HTTP 代理（明文转发 + CONNECT）；不支持 SOCKS5/4、不支持 TLS 直连代理端口、不提供 PAC；协议选错时连接会被直接断开（代理端口没有非 HTTP 的报错页）；
- 名单内才拆包 / 记录，名单外透传——常被误判成"代理没生效"；
- 请求与响应两个方向都剥离逐跳头（`connection` / `keep-alive` / `transfer-encoding` 等）。

## 9. 视图与路由

四个视图：**状态 / 处理名单 / 规则 / 流量**，子视图用贴主表面左缘的竖脊 `WorkspaceSpine` 切换，路由仍可深链：

| 路由 | 视图 |
|---|---|
| `/tools/interceptor` | 重定向到 `/status` |
| `/tools/interceptor/status` \| `/targets` \| `/traffic` | 对应视图 |
| `/tools/interceptor/rules` | 规则列表（全部类型） |
| `/tools/interceptor/rules/<type>` | 按类型过滤（10 种类型各一条） |

实现：`index.ts` 的 `subRoutes` 由 `renderer/router/routes.ts` 拍平为 `/tools/<工具>/<子路径>`；竖脊驱动 `router.push`；映射集中在 `renderer/tabs.ts`。规则编辑器是组件内视图、不进路由。工具页常驻由平台 `ToolPane` 保持挂载。

## 10. 关键文件

| 关注点 | 位置 |
|---|---|
| 代理内核（CONNECT 分流、MITM、透明转发、Upgrade 桥接） | `backend/services/proxy-service.ts` |
| 名单判定（origin 相等） | `backend/services/target-list.ts` |
| 规则匹配与执行 | `backend/services/rule-engine.ts`、`script-compile.ts`、`body-script.ts` |
| 证书（生成 / 信任 / 导出） | `backend/services/cert-service.ts`、`ca-trust.ts` |
| 总调度 / IPC / 存储 | `backend/services/interceptor-service.ts`、`backend/ipc/`、`backend/store/` |
| WS 桥（协议与扩展握手 / 信封编解码 / 消息校验） | `backend/services/ws-bridge.ts`、`ws-envelope.ts`、`ws-message.ts` |
| 管理页视图 | `renderer/pages/InterceptorPage.vue`、`renderer/components/*.vue`、`renderer/stores/interceptorStore.ts` |
| 扩展（平台） | `browser-extension/`（WXT；interceptor feature 在 `lib/features/interceptor/`，见 `docs/browser-extension.md`） |
