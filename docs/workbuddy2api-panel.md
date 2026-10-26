# workbuddy2api-panel 模块记忆

> 主进程托管上游 [workbuddy2api-panel](https://github.com/misakano7545/workbuddy2api-panel) 二进制；左栏 webview 嵌 `/panel/`，右栏运维。
> 取证 tag：`v2026.10.26.1001`（安装实际拉 GitHub `latest`，此 tag 仅对照）

## 1. 硬约束（不要违反）

| 约束 | 说明 |
| --- | --- |
| 资产名勿臆造 | `wb2api-panel-${VERSION}-{darwin\|linux\|windows}-{amd64\|arm64}.zip`，tag=`v${VERSION}` |
| 不打包二进制 | 安装包不含 wb2api；运行时下到 `<data>/workbuddy2api-panel/` |
| 默认不启动 | 打开工具页 / 安装完成都不自动 `START` |
| 关页签停服务 | `useTabCloseGuard`：在跑 → 确认 → `STOP` → close；`before-quit` 亦 `STOP` |
| 左 webview 右运维 | 无日志面板；失败 stderr → `lastError`（主动 STOP 清 stderr，不当错误） |
| GitHub + 本地 zip | 远端必须有 asset `digest`（`sha256:…`）；本地无远端 digest 时自算，`source: local-file` |
| 更新单轨 + 回滚 | 先 stop → 装新 → 探活命中身份；失败换回 `previous` |
| 取消下载 | 仅**下载阶段**可取消（按钮在 `phase === download` 且 `updating` 时出现）：`abort` 下载流 → 删 `<asset>.zip.part`；取消不算错误（不写 `lastError`，不弹失败提示）；「应用更新」中途取消会把已停掉的原版本重新拉起 |
| START 强制本机 | 每次 START 写 `listen=127.0.0.1:<port>` |
| 关自更新 | `update.auto_enabled=false` |
| 首启 api_key | 从 example 初始化 / 下次 START 时替换占位 `test_key` / 空为随机密钥 |
| 探活看 service | `GET /healthz` 且 `service=="workbuddy2api"`；**503 ≠ 挂**（→ `running_empty`）；探活不展示在 UI |
| IPC | 仅经 `tools/workbuddy2api-panel/renderer/ipc.ts` + 主进程 `safeHandle` |

## 2. 目录

```text
<data>/workbuddy2api-panel/
  manifest.json
  app-settings.json
  downloads/
  runtime/{current,previous,staging}/
  run/{config.json,auths/,data/}   # cwd；换版本不碰
```

## 3. 右栏 UI（自上而下）

1. **启停**：启动 / 停止 / 重启；残留端口可「结束占用」（不接管）
2. **状态**：运行态文案、版本、可复制的协议地址（OpenAI `/v1`、Anthropic 根、面板 `/panel/`）、API Key（默认隐藏 + 复制）、手动刷新
3. **安装 / 更新**：顶部显示「已安装 + 版本号」（读 manifest，不必先点检查；未安装时整行不出现，避免「已安装 / 未安装」自相矛盾）；GitHub / 本地 ZIP、检查与应用更新、取消下载（仅下载阶段）、打开数据目录
4. **说明**：上游仓库外链 + 非显而易见约定
5. **最近错误**（若有）

### 3.1 按钮状态矩阵（不要相互冲突）

`busy = loading（本地动作在飞）|| state.updating（后端安装 / 更新中）`；**唯一豁免是「取消下载」**。

| 按钮 | 可用条件 | 说明 |
| --- | --- | --- |
| 启动 | 已安装 && 未运行 && 无残留端口 && !busy | 端口被外部进程占用时禁用（先「结束占用」） |
| 停止 | 运行中 && !busy | |
| 重启 | 已安装 && !busy | |
| 结束占用 | 残留端口 && !busy | |
| GitHub 安装 / 本地 ZIP | 未运行 && 无残留端口 && !busy | 运行中换不掉 exe（Windows），后端 `installFrom*` 同样拒绝 |
| 检查更新 | 已安装 && 未运行 && !busy | 未安装无比较基准（后端 `checkUpdate` 也拒） |
| 应用更新 | 已安装 && 有可用更新 && 无残留端口 && !busy | 自行先停服；失败回滚并恢复运行 |
| 取消下载 | `progress.phase === 'download'` | 不看 loading（下载期 INSTALL 调用未返回） |

状态只用**禁用态**表达：运行中禁用安装与「检查更新」，未安装时更新相关按钮保持禁用。
不再加「请先停止 / 尚未安装」这类随状态出现的提示文案，避免文案与进度互相打架。

首次安装进行中（`updating && !installed`）文案进入「安装中」口径：状态标签显示「安装中」、
左栏空态改说「正在安装上游二进制」，避免与进度打架。


> **检查更新结果缓存在主进程**（`Wb2apiPanelState.update`）：只缓存上游 release 快照
> （`Wb2apiReleaseSnapshot`：latest tag / 资产 / digest / 检查时间），已安装版本每次按 manifest 现算
> ——本地 ZIP 换版本后 `hasUpdate` 立即跟着变，不会拿旧结论误报。缓存只在进程内，
> 重启后点一次「检查更新」即可；`CHECK_UPDATE` 会顺带 `publishStateNow()`，重开页签 / 其它窗口同源。

## 4. 文件地图

```
shared/workbuddy2api-panel.ts          类型 / 资产名 / 下载白名单 / listen / 各协议 base URL
shared/webview.ts                      WB2API_WEBVIEW_PARTITION
renderer/shared/composables/useTabCloseGuard.ts   关页签守卫（本工具注册 STOP）

tools/workbuddy2api-panel/
  index.ts                             supportedTargets: win/mac/linux
  backend/
    index.ts                           initialize（含状态轮询）/ dispose→STOP
    ipc/channels.ts                    GET_STATE / INSTALL / INSTALL_FROM_ZIP / CANCEL_DOWNLOAD /
                                       CHECK_UPDATE / APPLY_UPDATE / START|STOP|RESTART /
                                       KILL_ORPHAN / OPEN_DATA_DIR / EVENT_STATE / EVENT_PROGRESS
    ipc/handlers.ts                    safeHandle
    store/manifest-store.ts
    store/settings-store.ts
    services/config-service.ts         强制 listen + 关自更新 + 占位 api_key→随机
    services/health-service.ts         service 字段探活（主进程；不推 raw 到 UI）
    services/process-service.ts        spawn / STOP / orphan / quarantine
    services/install-service.ts        GitHub / 本地 zip / 更新回滚
    services/state-service.ts          状态聚合 + EVENT_STATE（运行中约 3s 轮询）+ 检查更新快照缓存
    services/guest-guards.ts           分区 webview：本机放行，外链 openExternal
    services/busy-flag.ts
    utils/{paths,platform,zip,digest,http}.ts
  renderer/
    ipc.ts                             唯一 createIpcHelpers 实例
    pages/Workbuddy2apiPanelPage.vue   左 webview / 右运维 + 关页签守卫
```

## 5. 状态机

`not_installed | stopped | running | running_empty | unhealthy | updating | error`

- `running`：healthz 身份正确且通常 200
- `running_empty`：身份正确且 503（无可用账号）
- `unhealthy`：进程在但身份不匹配 / 探活失败
- 残留进程：只「结束占用」，不接管
- 运行中每 3s 探活推送 `EVENT_STATE`；右栏也可手动「刷新」
- 状态载荷不含 `health` / `pid`（分类只用探活结果，不落 UI）

## 6. 平台

`ToolClientTarget` 含 `'linux'`；preload `edtRuntime.target` 映射 `linux`；本工具不含 `web`。
