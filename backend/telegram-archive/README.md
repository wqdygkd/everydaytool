# telegram-archive（跨工具归档契约，平台层）

`telegram-cache` 与 `tweb-cache` 共用同一份归档**实现**，但数据按工具 scope 隔离：

- 契约 / 注册表：`engine.ts`（`ArchiveEngine`，每个方法带 `scope`）。
- 作用域 / 串行队列：`scope.ts`（`AsyncLocalStorage`）。
- 实现：`tools/telegram-cache/backend/services/archive-engine.ts` 在 telegram-cache 初始化时注册。
- 数据：`<assets>/<tool-id>/messages/...`、`<assets>/<tool-id>/trash/`、`<cache>/<tool-id>/objects/...`。

本目录不包含具体存储逻辑，也不 import 任何工具域代码。工具之间不互相 import 对方的 backend；
其它工具只能通过 `getTelegramArchiveEngine()` 调用注册好的实现。
