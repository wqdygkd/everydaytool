# workbuddy2api-panel 模块记忆

> 桌面壳（Rust）托管上游 [workbuddy2api-panel](https://github.com/misakano7545/workbuddy2api-panel) 二进制；
> 左栏子 Webview 嵌 `/panel/`，右栏运维。
> 取证 tag：`v2026.10.26.1001`（安装实际拉 GitHub `latest`，此 tag 仅对照）

## 1. 硬约束（不要违反）

| 约束 | 说明 |
| --- | --- |
| 资产名勿臆造 | `wb2api-panel-${VERSION}-{darwin\|linux\|windows}-{amd64\|arm64}.zip`，tag=`v${VERSION}` |
| 不打包二进制 | 安装包不含 wb2api；运行时下到 `<data>/workbuddy2api-panel/` |
| 默认不启动 | 打开工具页 / 安装完成都不自动 `START` |
| 关页签停服务 | `useTabCloseGuard`：在跑 → 确认 → `STOP` → close；应用退出（`RunEvent::ExitRequested`）亦 `workbuddy::dispose()` |
| 左 webview 右运维 | 无日志面板；失败 stderr 尾巴 → `lastError`（主动 STOP 清 stderr，不当错误） |
| GitHub + 本地 zip | 远端必须有 asset `digest`（`sha256:…`）；本地无远端 digest 时自算，`source: local-file` |
| 更新单轨 + 回滚 | 先 stop → 装新 → 探活命中身份；失败换回 `previous` |
| 取消下载 | 仅**下载阶段**可取消（按钮在 `phase === download` 且 `updating` 时出现）：置取消标记 → 下载循环下一块退出 → 删 `<asset>.zip.part`；取消不算错误（不写 `lastError`、不弹失败提示）；「应用更新」中途取消会把已停掉的原版本重新拉起 |
| START 强制本机 | 每次 START 写 `listen=127.0.0.1:<port>` |
| 关自更新 | `update.auto_enabled=false` |
| 首启 api_key | 从 example 初始化 / 下次 START 时替换占位 `test_key` / 空为随机密钥 |
| 探活看 service | `GET /healthz` 且 `service=="workbuddy2api"`；**503 ≠ 挂**（→ `running_empty`）；探活不展示在 UI |
| 命令入口 | 渲染层只经 `tools/workbuddy2api-panel/api.ts`（`createCommandHelpers`），Rust 侧统一 `workbuddy::handle` |

## 2. 目录

```text
<data>/workbuddy2api-panel/
  manifest.json
  app-settings.json
  downloads/
  runtime/{current,previous,staging}/
  run/{config.json,auths/,data/}   # 子进程 cwd；换版本不碰
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
| GitHub 安装 / 本地 ZIP | 未运行 && 无残留端口 && !busy | 运行中换不掉 exe（Windows），后端 `install_from_*` 同样拒绝 |
| 检查更新 | 已安装 && 未运行 && !busy | 未安装无比较基准（后端 `check_update` 也拒） |
| 应用更新 | 已安装 && 有可用更新 && 无残留端口 && !busy | 自行先停服；失败回滚并恢复运行 |
| 取消下载 | `progress.phase === 'download'` | 不看 loading（下载期 INSTALL 调用未返回） |

状态只用**禁用态**表达：运行中禁用安装与「检查更新」，未安装时更新相关按钮保持禁用。
不再加「请先停止 / 尚未安装」这类随状态出现的提示文案，避免文案与进度互相打架。

首次安装进行中（`updating && !installed`）文案进入「安装中」口径：状态标签显示「安装中」、
左栏空态改说「正在安装上游二进制」，避免与进度打架。

> **检查更新结果缓存在桌面壳进程**（`Wb2apiPanelState.update`）：只缓存上游 release 快照
> （`Wb2apiReleaseSnapshot`：latest tag / 资产 / digest / 检查时间），已安装版本每次按 manifest 现算
> ——本地 ZIP 换版本后 `hasUpdate` 立即跟着变，不会拿旧结论误报。缓存只在进程内，
> 重启后点一次「检查更新」即可；`CHECK_UPDATE` 会顺带推一次状态，重开页签同源。

## 4. 文件地图

```
shared/workbuddy2api-panel.ts        类型 / 资产名 / 下载白名单 / listen / 各协议 base URL（纯类型与纯函数）
shared/command-groups/workbuddy.ts   命令表（前后端共用，单一事实来源）
src/shared/composables/useTabCloseGuard.ts   关页签守卫（本工具注册 STOP）
src/config/tools.ts                  工具注册表
src/App.vue                          handleTabRemove 先跑关闭守卫

tools/workbuddy2api-panel/
  index.ts                           supportedTargets: win / mac（不含 web）
  api.ts                             唯一 createCommandHelpers 实例 + 外链出口
  composables/usePanelWebview.ts     左栏子 Webview（Tauri 子 Webview 桥，按宿主几何摆放）
  pages/Workbuddy2apiPanelPage.vue   左 webview / 右运维 + 关页签守卫

src-tauri/src/workbuddy/
  mod.rs          命令分发 / 面板状态聚合 / 3s 探活推送 / 退出收尾
  paths.rs        <data>/workbuddy2api-panel 目录布局
  store.rs        manifest.json / app-settings.json
  config.rs       run/config.json：强制 listen + 关自更新 + 占位 api_key→随机
  health.rs       service 字段探活（503 分类为 running_empty）
  process.rs      spawn / STOP（先礼后兵）/ 残留进程查找与结束 / quarantine
  install.rs      GitHub / 本地 zip / 更新回滚 / 检查更新
  http.rs         白名单下载（先 .part 后 rename）+ GitHub JSON
  zip.rs          跨平台解压（系统 unzip / PowerShell → 内置中央目录解析）
  digest.rs       sha256 文件摘要
```

子 Webview 的导航闸在 `src-tauri/src/webviews.rs` 的 `preset: 'workbuddy'`：只允许
`127.0.0.1` / `localhost` 内导航，其余地址按 `new-window` 事件交渲染层开系统浏览器。

## 5. 状态机

`not_installed | stopped | running | running_empty | unhealthy | updating | error`

- `running`：healthz 身份正确且通常 200
- `running_empty`：身份正确且 503（无可用账号）
- `unhealthy`：进程在但身份不匹配 / 探活失败
- 残留进程：只「结束占用」，不接管
- 运行中每 3s 探活推送 `EVENT_STATE`；右栏也可手动「刷新」
- 状态载荷不含 `health` / `pid`（分类只用探活结果，不落 UI）

## 6. 平台

仅桌面端注册（`supportedTargets: ['win', 'mac']`，不含 `web`）。Linux 上游有资产，
但本项目尚未把 `linux` 纳入 `ToolClientTarget`，等桌面端正式支持 Linux 时再加。
