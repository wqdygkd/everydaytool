# Shared module

跨进程共享模块（渲染进程 ↔ 主进程 backend）。

**定位**：放置跨工具、跨进程共享的**纯类型 / 常量 / 纯函数**：

- `types.ts` — Sandbox / Fingerprint / CDP / AppConfig 等前后端共享数据类型
- `sleep.ts` — 通用延时纯函数

**约束（见 AGENTS.md）**：

- 只允许纯类型 / 常量 / 纯函数，不依赖 Electron、Node、数据库、Vue。
- 渲染进程通过 `@shared` Vite 别名引用（无后缀）；主进程 backend 走相对路径 + `.js` 运行时后缀。

与 `renderer/shared/` 的区别：`renderer/shared/` 仅限渲染进程内复用；本目录跨越进程边界，被前后端同时引用。
