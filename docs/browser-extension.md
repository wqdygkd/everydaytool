# everydaytool 浏览器插件（平台层）

> 状态：已切换。运行时 = WXT 产物（dev：`browser-extension/.output/chrome-mv3`；安装版：`cache/app/extension`）。旧 `tools/interceptor/extension` 源码已删除。  
> 框架：[WXT](https://github.com/wxt-dev/wxt)（MV3 + Vue + TS）。  
> 一句话：**一个解包扩展 = edt 在浏览器里的宿主**；各工具以 feature 模块挂载，interceptor 是首个模块。

## 已拍板决策

| 项 | 选择 |
| --- | --- |
| 目录名 | 仓库根 `browser-extension/`（与 `electron/` / `backend/` / `renderer/` 并列） |
| 迁移兼容 | **是**：保留现有 `manifest.key` → 扩展 ID `hlinfcmdeamelkpdemppomgncenalong` 不变，用户无需重装 |
| Popup | **单页多模块 Tab**（平台壳 + 各 feature 贡献面板） |
| 协议 | **信封**（`v` + `module` + `type` + `payload`）；interceptor 为首个 module |

## 角色

| 层 | 职责 |
| --- | --- |
| 扩展 shell | 连接 / token / 重连 / popup 壳 / 原语 facade；**不**实现工具业务 |
| 扩展 feature | 某工具在浏览器侧的原语编排（如 interceptor：proxy / userScripts / 名单动作） |
| EDT 侧（当前仍在 interceptor 工具域） | `paths` / 目录准备 / token / WS 桥；按 module 编解码信封 |
| `tools/*/backend` | 向桥注册业务 handler；不下沉第二条扩展 WS |

> 平台级 `backend/utils/extension/`（host 上提）尚未落地；现行实现见 `tools/interceptor/backend/utils/paths.ts` 与 `ws-bridge.ts` / `ws-envelope.ts`。

## 目录

```text
browser-extension/           # WXT 工程根（产物 .output/chrome-mv3）
  package.json               # workspace 包（pnpm --filter everydaytool-extension）
  entrypoints/               # background + popup
  lib/shell/                 # WS 客户端、连接态
  lib/features/              # 业务模块（勿用顶层 modules/，以免与 WXT modules 冲突）
    interceptor/
shared/extension.ts          # 扩展 ID、端口段、信封协议、shell 消息
shared/interceptor.ts        # interceptor 业务类型（解码后的内部形状）
```

构建仍从仓库根走既有入口：`pnpm extension:prepare` / `pnpm extension:dev` / `pnpm extension:build`，
它们现在是 `pnpm --filter everydaytool-extension <script>` 的包装；只做类型检查用
`pnpm --filter everydaytool-extension typecheck`。

## 硬约束

- 扩展 ID / `key` 不变（兼容已加载的解包扩展）。
- `bridge-token.json` 仍由 EDT 写到 **Chrome 实际 load 的目录** 根，0600 + `cache: 'no-store'`。
- 控制通道端口段、fail-open、userScripts 动态注册等 interceptor 行为在 feature 内保持对等。
- 数据层：`cache/app/extension`；`extraResources` → `extension-edt`（来自 WXT 产物）。
- **零更新原则（平台版）**：工具配置 / 规则仍不动扩展；只有新原语或新权限才升扩展 version 并要求用户 Reload。

## 后续

- 设置页「浏览器插件」入口；后续工具只加 `lib/features/<id>`
- （可选）把路径准备 / WS host 从 interceptor 工具域上提到 `backend/utils/extension/`

## 相关

- 拦截器业务：[`docs/interceptor.md`](./interceptor.md)（§7 为 feature 语义）
- 工程约定入口：[`AGENTS.md`](../AGENTS.md)
