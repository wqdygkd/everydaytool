# CLAUDE.md

> 项目规范与约定已统一收敛到 **[AGENTS.md](./AGENTS.md)**（单一权威来源）。
> 本文件仅作入口指引，请以 AGENTS.md 为准，避免两处重复漂移。

everydaytool（简称 `edt`，包名 `everydaytool`）多功能工具平台（Electron + Vue 3 + Pinia + Element Plus + Vite + SCSS）。

请阅读本项目根目录的 `AGENTS.md`：

- 设计系统（CSS 变量令牌、双主题）
- 编码规范（前端 / 后端导入边界、IPC 限制、shared 约束）
- 布局 / 交互要点
- 常用命令（`pnpm dev` / `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm dist`）
- 文件定位速查

如需新增/修改约定，请直接维护 `AGENTS.md` 并在必要时同步本文件中指向它的说明。
