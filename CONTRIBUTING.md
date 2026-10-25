# Contributing

开发约定见 [AGENTS.md](./AGENTS.md)（编码规范 / 目录边界 / 命令分组）与 [DESIGN.md](./DESIGN.md)（设计令牌 / UI 组件库）。本文件只讲「从 clone 到提交」的路径。

## 环境与首次运行

1. 按 [README](./README.md) 装好平台工具链（Windows 只需 Build Tools + rustup + Node 22 + pnpm，不需要 VS IDE）
2. `pnpm install`
3. `pnpm doctor` —— 只读环境自检，输出里有 MISSING 先解决它
4. `pnpm dev`（桌面端）或 `pnpm web`（纯浏览器预览，无桌面桥接）

## 改动验证

```bash
pnpm typecheck   # TS 类型检查
pnpm lint        # ESLint（含 tools）
pnpm test        # 前端纯函数冒烟（vitest）
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

以上检查没有本地钩子兜底，提交前自行执行；typecheck 与 clippy 全量太慢，由 CI 把关。

## 约定速记（详见 AGENTS.md）

- 业务组件不直接 import `@tauri-apps/api`，统一走 `createCommandHelpers` / `src/desktop/*`
- 命令分组改动必须同步 `shared/command-groups/` 与 Rust 侧注册（单一事实来源）
- `shared/**` 只放纯类型 / 常量 / 纯函数，不依赖任何运行时
- UI 一律引用设计令牌（`var(--token)`），禁止硬编码颜色 / 阴影
- 新增工具用 `pnpm create:tool <id>` 脚手架，新增应用级页面往 `src/config/app-tabs.ts` 加一条记录
