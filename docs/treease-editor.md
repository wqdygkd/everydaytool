# treease-editor 模块记忆

## 会话 / 缓存位置（sessionData 物理落盘）

- webview 分区：`persist:treease-editor`（`shared/webview.ts` 的 `TREEASE_WEBVIEW_PARTITION`）。
- Electron 在 `ready` 之前由 `backend/utils/session-data.ts` 设置
  `app.setPath('sessionData', <data-root>/session)`；Chromium 的所有会话数据
  （Cookies / LocalStorage / IndexedDB / HTTP Cache / `Partitions`）物理写在该目录下。
  treease 分区实际路径：`<data-root>/session/Partitions/treease-editor`。
- **不使用 junction / 软件链接**。首次采用 sessionData 时不迁移 userData 中的旧 Chromium 缓存，
  新目录由 Chromium 重新生成；用户主动切换数据目录时则走下面的整体迁移。
- **初始化顺序**：`electron/main.ts` 在 `ready` 之前完成
  `loadDataDirectoryOverrideSync()` → `configureSessionDataDirectory()`；
  工具 `initialize` 只 `registerTreeaseHandlers()` → `installCacheHandlers()`。
  不要在 main 之前或 ready 之后再设置 `sessionData`（不生效）。
- 切换数据目录：设置页只写 `data-root.pending.json` 并提示重启；下次启动在 ready 之前
  把旧目录整体复制到新目录（含 `session`），成功后才切换。失败保留旧目录并继续使用，
  因此登录态与缓存不会失效。**应用自身的 localStorage（收藏 / 页签）在同一 sessionData 下，也一并迁移。**

## 规则与配置的落点（分层现状）

- 拦截规则与总开关的事实来源是**配置层文件** `<data>/config/treease-editor/rules.json`
  （`backend/store/rules-store.ts`，字段白名单校验），走 IPC `RULES_GET` / `RULES_SET`。
- 渲染层仍在 LocalStorage 写一份**镜像**（`edt:treease-intercept-rules` /
  `edt:treease-intercept-enabled`）：网页预览没有 IPC、以及首屏不等异步加载，都靠它。
- 首次挂载时：配置层有规则 → 以它为准覆盖 UI 并刷新镜像；配置层为空 → 把镜像迁上去（旧数据一次性迁移）。
- 清缓存不会动规则（配置层 `clean: 'never'`）；换数据目录 / 恢复备份都会带上规则文件。

## 拦截与缓存

- `installCacheHandlers()` 在 initialize 预装协议层 handler，页面缓存不依赖 `interceptService.start()`；
  停止拦截只下规则，不移除 handler。
- 缓存落盘位置由 `sessionData` 决定，因此 HTTP 缓存自然写入数据目录；不要在业务代码里另建缓存目录。
