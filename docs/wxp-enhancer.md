# wxp-enhancer 模块记忆

> wxp-enhancer 工具的开发记忆：目标应用 WxP Client 的逆向结论、注入脚本架构、功能演进与验证手法。
> 来源：2026-10-05 ~ 10-07 的开发会话沉淀；改动相关文件前先读本文对应小节。

## 目标应用：WxP Client

- **不是微信**。exe：`C:\Users\c\AppData\Local\Programs\Wxp Client\WxP Client.exe`（名字带空格），Electron 31.7.7（Chromium 126），userData 在 `%APPDATA%\winning-wxp-desktop`。
- 单实例应用：杀不死/重复拉起会 relay 到旧实例；外部启动前先 `tasklist` 确认。`autoHideMenuBar` 存在但无 DevTools 快捷键绑定；**原生 DevTools 唯一生产触发点 = 托盘菜单项**（调 `webContents.openDevTools()`）。外部经 CDP 无法触发原生 DevTools（`Target.createTarget` 加载 `devtools://` 返回 "Not supported"，已实测）。
- 应用支持**多 CDP 客户端并存**（注入连接与应用自身调试共存）。Chromium 111+ 对带 Origin 的 WebSocket 握手一律 403 → 启动参数自动附加 `--remote-allow-origins=http://127.0.0.1:<port>`（精确同源）。
- 主进程自带清缓存 IPC 通道 `event:app:clear-cache`（clearCache + clearStorageData），渲染层可经 `$electron.sending('event:app:clear-cache')` 触发——做"清应用自身缓存"用这条官方路径，勿自造。
- preload 桥 `$electron`：`sending` / `sendingTwoWay` / `listening` / `listeningTwoWay` / `setZoomLevel`。

## WxP 内部机制（app.asar 逆向结论）

app.asar 仅 4.9MB，可用 Node 手写解包器提取（JSON 头定位 `{"files"`，dataBase = 8 + u32@4）。核心代码都在 `js/index.b222e5fb.js`（renderer）与 `background.js`（main），Webpack 打包、ES5 helper 风格。

**存储布局**：

| 数据 | 键 | 位置 | 说明 |
|---|---|---|---|
| 访问/刷新令牌 | `wxp_access_token` / `wxp_refresh_token` / `wxp_access_expires_at` / `wxp_refresh_expires_at` | localStorage（持久） | 应用自带 30min 静默刷新 + axios 401 拦截器重试 |
| 登录账号密码 | `login-info-cache` | localStorage（持久） | XOR("WXpLocalCache2024Secret")+base64 的 `{username,password}`；WxpLogin SSO 与 StartNameServer 都用它 |
| 用户信息 | `user-info-cache` / `userInfo` | sessionStorage（重启即失） | 前者经 XOR+b64+o4 编码；路由守卫 `beforeEach` 从它恢复 Vuex user store |
| 应用设置/常用租户 | `user-settings-cache` / `user-frequen-use-tenant-cache` | localStorage | — |
| 租户收藏 | collection/save\|query\|delete API | 服务端（按 tenantId） | **只有租户级，无链接级** |

**Vue 架构**：Vue 2 + Vuex，挂载点 `<div id="app">`（根实例 `appEl.__vue__`，`$store` 直达）。全局 getters：`user` / `tenants` / `baseURL` / `tenantStatusQueryServers` / `systemNameNodeAddrs`。路由 `/link`（LinkView.vue 包装）承载链接中心（原生组件 `LinkCenter`）；研发/交付/运维三中心是 `IframeLink`（内嵌网页 + autoLogin SSO 配置）。

**登录流程（Vuex `vt()`，缓存登录必须补跑的初始化链）**：
1. `blacklist/LoadBlacklists` → `tenant/GetAllTenants`（GET `getUserTenants?accessToken`）——**链接中心医院列表的唯一填充链**；
2. `app/StartNameServer`（参数 `XapDataRelaySystemNameNodeAddr`）——主进程 TCP 连 NameNode，`userName/passWord 都=登录用户名`，15s 心跳；不跑 = 「代理异常/无可用的NameNode服务」；
3. `DataRelaySystemTenantStatusQueryServers` → `tenantStatusQueryServers`（租户在线状态源）；
4. `WxpLogin` / `CopLogin` / `DelivLogin` —— 三中心 iframe SSO；
5. `tenant/UpdateTenantsState`：每 3min 对每台状态源做 2401 `/name/sysdate`（无鉴权 200）+ 2901 `/proxy/select/listCacheTenants`（裸 GET，源码确认不带凭据），"sysdate − 心跳 < 40s" 判定租户 [在线]/[离线]。

**已知服务端问题**：2901 listCacheTenants 裸 curl 也 401 `{"error":"unauthorized"}`（sysdate 正常）——服务端鉴权策略，与登录态无关；拦截器仅 toast「系统接口401异常」后吞掉，不跳登录不影响其他功能。**用户决定保持现状（忽略），别主动再提**。

**链接中心表格**：w-table（列：序号/环境/状态/转发名称/接入点/原地址/快捷操作）。显示数据是 `hospitalLinks$0`（保序过滤 computed，元素与 `hospitalLinks` 同引用）；行 DOM 在 `.link-view-container .w-table__body tr`；转发名称单元格在 `td[class*="column_4"]`——**不能依赖 `.tenant-link__*` type class**（type 不在 0/1/2 的行 class 为空）。列带 sortable：element-ui 排序只重排内部副本不动源数组，**任何 DOM 行下标 ↔ 数据下标映射都不可靠**。

## 注入脚本架构（2026-10-07 定稿）

```
enhancement-script.ts      薄壳：键名单一来源（7 个缓存键常量）+ 选项接口 + env 组装 + buildClearLoginCacheSnippet
injection-main.ts          脚本本体 injectionMain()：真实 TS 函数，ES5 风格，自包含
injection-script.ts        装配：window.__wxpEnv = <JSON>; (injectionMain.toString())();
data-collector.ts          数据采集：buildCollectExpression() + collectWxpData(port)
cdp-client.ts              CDP 基础：连接/求值/注入；evaluateInPageTargets（全页面，无返回值）、evaluateOnMainPage（主页面，有返回值）
```

**硬约束（违反即产残缺脚本）**：
- `injectionMain` 必须自包含：只引用浏览器全局与 `window.__wxpEnv`，**禁止引用模块导入/外部闭包**（toString 序列化后外部引用悬空）；保持 ES5 风格（var/function），防降级 helper 混入；
- 文件头有 eslint-disable 组与最小 `declare const`；`@ts-nocheck` 被 `ts/ban-ts-comment` 禁用，改用显式 `any` 注解；
- 模板字符串承载脚本时正则反斜杠会被吞（`\s`→`s`）——现脚本用 toString 序列化已无此问题，但 `data-collector.ts` 的采集表达式仍是模板字符串，**禁止反斜杠转义**。

**功能分节**（都在 injection-main.ts 内，节前有注释）：
1. **登录态缓存**：3s 镜像循环把整个 sessionStorage 快照到 localStorage `__wxpEnhancerSessionSnapshot`；文档最早时刻整体还原（JWT exp 校验，过期不还原）；登出守护 = token 消失清快照；配额超限退化单键；还原后停在登录页宽限 0.8s（用户嫌慢从 1.5s 收紧）才 `#/home`+reload。
2. **登录引导补跑**：轮询至 user+baseURL 就绪（`readRootVm()` → `#app.__vue__.$store`），按登录顺序补跑 StartNameServer（用户名从 login-info-cache 解出）/ 状态源 / 黑名单→租户列表→在线状态 / WxpLogin，幂等（store 已有则跳过）。
3. **链接收藏**：星标注入 `td[column_4]`（按列位置）；收藏键 = 内容键 `sceneformal|simpleName|accessPoint|targetPoint`（DOM 行文本与接口对象两层算出的键同构一致，规避下标映射错乱——**历史教训：行下标映射方案两度翻车**）；数据层包装 `getCurrentHospitalLinks` 落库后标记 `isFav` + 稳定排序置顶；`tableRowClassName` 补丁加 `wxp-fav-row` 高亮；MutationObserver 补星标（**写 DOM 必须先比对值**，否则自触发死循环）。
4. **医院域名打开**：星标后 🌐 按钮，`openChannel`（通道保障）→ `link.url` 首处 `127.0.0.1` 换 `医院名.localhost`（名称净化：空格转连字符/剔非法字符/小写/中文 punycode，空则回退 code）→ `AppShellOpen`（主进程 shell.openExternal）。
5. **增强中角标 / 用户 CSS/JS 规则**：签名去重；CSS 按 id 建 style，JS `new Function` 执行。

**验证手法（改脚本必做）**：注入脚本是运行时序列化产物，ESLint 管不到——必须产物级验证。两档：
- 编译档：esbuild bundle + `new Function(src)` 逐选项组合编译（键值断言可加）；
- 行为档：mock DOM 世界（存储/定时器/监听器/ops 轨迹快照）跑旧 vs 新，4 组合 × 2 场景全一致才放行。

## 数据与 IPC

- 工具配置：`data/wxp-enhancer/config.json`（settings / enhancements / clearLoginCachePending）。读取时滤除旧版 cdp-injector 遗留死字段（autoLogin/homeUrl）。
- 数据缓存：`data/wxp-enhancer/data-cache.json`（WxpDataCache：登录令牌/账号密码/用户对象/NameNode 参数/收藏列表）。工具页「数据缓存（来自 WXP）」区块查看（令牌掩码+复制、密码显隐、收藏表格、用户 JSON 折叠）。
- 清除登录缓存：运行中经 `evaluateInPageTargets` 删工具写入的四键（不动应用 token）+ reload；未运行登记 `clearLoginCachePending`，下次启动首轮注入的脚本带清除块（**必须随后换回常规脚本 scanAndInject(true)**，否则会清掉用户重登后的快照）。
- 采集/求值脚本与注入脚本一样受"模板字符串禁反斜杠"约束；验证用文本抽取 + `new Function`（esbuild 打包 data-collector 会拖进 electron 依赖，纯 Node 不能 require）。

## 运行时坑位备忘

- **pnpm dev 运行中锁 dist-electron（EBUSY）**——重编译前先关 dev。
- fnm 环境：Bash `cd` 进项目先 `eval "$(fnm env)"`。
- WXP 是用户桌面上的活应用：CDP 测试窗口期不稳定，测试要快、一次会话闭环；Node fetch 连 9553 会间歇 ECONNREFUSED（curl 同时正常），加重试。
- 附加模式（WXP 已在运行）无子进程，用 4s 间隔存活看门狗（连续 2 次检测不到 exe 判定退出）；拉起模式走 onExit 回调。
- 用户并行编辑文件/暂存区：Edit 前重读文件，汇报区分非自己做的改动。
