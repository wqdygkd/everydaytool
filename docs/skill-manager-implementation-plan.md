# 技能管理器实施计划

> 状态：**Step 0–11 已实现，待最终验收**
> 设计依据：[skill-manager-plan.md](./skill-manager-plan.md)
> 视觉依据：[DESIGN.md](../DESIGN.md)、[skill-manager-preview.html](./skill-manager-preview.html)
> 执行方式：**一步一停**。每步完成后提交改动摘要、验证结果、待确认项；未确认不进入下一步。

---

## 0. 执行原则

1. **不猜**：来源、路径、锁格式、目标 scope、依赖策略有疑问时停下来问，不靠猜实现。
2. **先读后写**：先做只读扫描与锁解析，再做安装/更新；先 global，再 project；先单技能，再多技能。
3. **写操作必须可恢复**：staging → 校验 → 旧目录进回收站 → 原子替换 → 写锁 → 写 registry；失败可回滚。
4. **锁是团队资产**：项目锁严格 v1 格式、排序、缩进、尾换行；只改本次条目，保留未知字段；写前校验指纹。
5. **不引入第二套设计系统**：只用 `DESIGN.md` 的令牌和 `renderer/shared/components/ui` 组件；不新增颜色。
6. **每步可停**：每步只做该步范围；完成即停，等确认；不顺手做下一步。

---

## 1. 当前基线

- 设计方案与交互预览已完成，**没有任何实现代码**。
- 现有工具模式（以 offline-pack 为例）：
  - `tools/<id>/index.ts` 定义工具与路由；
  - `tools/<id>/backend/index.ts` 导出 backend，手动登记到 `electron/tool-registry.ts`；
  - `tools/<id>/backend/ipc/{channels,handlers}.ts`；
  - `tools/<id>/renderer/ipc.ts` 唯一 `createIpcHelpers` 实例；
  - `tools/<id>/renderer/pages/*.vue` 使用 `ToolSurface` / `WorkspaceHeader`。
- preload 命名空间手动登记在 `electron/ipc-namespaces.ts`，Window 类型在 `renderer/shared/ipc/types.ts`。
- 数据落盘必须走 `resolveLayerPath`；新增条目在 `shared/data-layers.ts` 的 `DATA_LAYER_ENTRIES`。
- 当前仓库自身就是一个真实 fixture：
  - 项目锁 34 条、`.agents/skills` 38 个目录、4 个未入锁；
  - 全局锁 3 条、`~/.agents/skills` 31 个技能（29 个 symlink、1 个断链）。
- 现有测试基建：无 Vitest / Jest；只有 `typecheck`、`lint`、`data-layers:check`。

---

## 2. 开工前必须确认

这些会改变实现方式；未确认前不写对应代码。

| # | 问题 | 推荐 | 影响 |
| --- | --- | --- | --- |
| Q1 | 工具元数据 | `id: skill-manager`、`name: 技能管理`、`icon: layers`、`category: dev`、`supportedTargets: ['win','mac','linux']`（桌面专用，web 预览降级） | 路由、左轨、首页卡片、标题栏 |
| Q2 | tarball 解压依赖 | 先不引新依赖：用 `node:zlib` + 受控 tar reader；若实现 PAX/GNU 长路径成本过高，再经你同意引入 `tar` | 安装/更新核心 |
| Q3 | 测试方案 | 首版用 `node:test` + 临时 fixture；如果 Node 版本不支持 TS 直跑，再加 Vitest（需你同意） | 每步验收强度 |
| Q4 | Step 1 范围 | 先做“脚手架 + 静态壳 + 假数据表格”，验证路由/视觉；Step 2 再接真实扫描 | 第一步可停点 |
| Q5 | 首版扫描范围 | 全局 + 当前仓库（若 cwd 有 `.agents/skills` 或 `skills-lock.json`）；项目手动登记放 Step 3 | P0 首屏能看到真实数据 |
| Q6 | TFS/generic git | 依赖本机 `git` 命令；不内置 git；无 git 时提示安装 | TFS 支持 |
| Q7 | 数据路径 | `config/skill-manager/*`、`assets/skill-manager/{trash,disabled}`、`cache/skill-manager/{repos,staging,tmp}` | 分层检查 |

---

## 3. 分步总览

| Step | 范围 | 产物 | 停点 |
| --- | --- | --- | --- |
| 0 | 预检与决策冻结 | 检查单、确认 Q1–Q7 | ✅ 等你确认 |
| 1 | 脚手架 + 静态壳 | 可打开的工具页、假数据表格、路由/标题栏/左轨正常 | ✅ |
| 2 | 数据层 + 锁解析（只读） | `shared/skill-manager.ts`、锁适配器、fixture 校验 | ✅ |
| 3 | 扫描 + IPC + 真实只读库存 | 全局/当前项目真实分组表，零写入 | ✅ |
| 4 | 来源解析 + 目录（只读） | GitHub / 本地 / TFS URL 解析，仓库目录列表 | ✅ |
| 5 | 安装事务（global） | staging、校验、回收站、写全局锁、history | ⬜ 待开始 |
| 6 | 项目锁写入 + 项目安装 | 项目锁 v1 严格写回、备份、指纹、CLI 兼容 | ⬜ 待开始 |
| 7 | 更新检查 + 计划 + 失效清理 | 差异引擎、计划对话框、移除上游项、撤销 | ⬜ 待开始 |
| 8 | 禁用/启用 + 回收站 | 禁用区、状态机、恢复、历史 | ⬜ 待开始 |
| 9 | 收藏 + 预设 | 收藏分类、预设 CRUD、应用计划、additive/exact | ⬜ 待开始 |
| 10 | 墓碑 + 接管 + 恢复 | 未托管只读、两种接管、墓碑重装 | ⬜ 待开始 |
| 11 | 项目/设置/TFS 认证 + 收口 | 项目登记、PAT、TFS、文档、全量验证 | ⬜ 待开始 |

> 每一步都可以停；如果某一步范围仍然太大，可再拆成 11a/11b。

---

## 4. 每步详细说明

### Step 0 — 预检与决策冻结（不写代码）

**做**

- 确认 Q1–Q7。
- 跑一遍基线：
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm data-layers:check`
  - `git status --short`
- 记录当前失败项（如果有），避免把既有问题算到本工具头上。

**验收**

- 基线命令结果贴出；Q1–Q7 有明确答案。
- **停**：等你确认后进入 Step 1。

#### Step 0 实测结果（2026-11-06）

- 工具链：`node v26.12.0` + `pnpm 10.6.3`（v22 的 corepack 在沙箱内无法写 `~/.cache`，改用已安装的 v26；满足项目 `>=22.18`）。
- `pnpm lint`：通过。
- `pnpm data-layers:check`：通过（38 个条目 / 25 条搬迁规则 / 146 个后端文件 / 1 处显式豁免）。
- `pnpm typecheck`：**基线失败**，共 18 个既有错误：
  - `tools/interceptor/renderer/components/TargetsPanel.vue`：2
  - `tools/telegram-cache/renderer/components/DiagnosticsPanel.vue`：16
  - 全部是 `Store<...>` 上访问 `.value` 的类型错误，与 skill-manager 无关。
- `git status`：仅有本次设计文档/预览/实施计划的改动，无其它未提交代码。

**待你决定**：是否先单独修这 18 个既有错误（Step 0.5），还是后续以“skill-manager 不新增错误”为验收标准、最后再单独处理。建议后者，避免把无关修复混进本工具。

---

### Step 1 — 脚手架 + 静态壳

**做**

- 用 `pnpm create:tool skill-manager` 生成骨架；逐项 review 生成内容，不直接接受无关模板。
- `tools/skill-manager/index.ts`：
  - id/name/description/icon/category/keywords；
  - `subRoutes`：`installed` / `updates` / `favorites` / `presets` / `projects`；
  - `meta.toolId`。
- `renderer/pages/SkillManagerPage.vue`：
  - `WorkspaceHeader` + 子导航 + 单个 `ToolSurface`；
  - 表格先用静态 mock 数据，布局对齐 `skill-manager-preview.html`；
  - 不接 IPC、不写任何文件。
- 手动登记：
  - `electron/tool-registry.ts` 加 backend（如果 Step 1 还没有 backend，可留到 Step 3）；
  - `electron/ipc-namespaces.ts` 加 `skillManager` 通道表（可先空表）；
  - `renderer/shared/ipc/types.ts` 加 `skillManager?: IpcInvokeApi`。
- `tools/skill-manager/renderer/ipc.ts` 建唯一 helper 实例。

**不做**

- 不接真实扫描、不写数据层、不做安装。

**验收**

- `pnpm dev` 能打开 `/tools/skill-manager`；左轨、标题栏、子导航、表格正常。
- `pnpm lint` 通过；`pnpm typecheck` 不新增 skill-manager 相关错误（全量仍有 Step 0 的 18 个既有错误）。
- 桌面 1280/1440 无横向溢出；390 宽表格可横向滚动。
- **停**：附截图/说明，等确认。

#### Step 1 实测（2026-11-06）

- 新增：`tools/skill-manager/{index.ts,renderer/tabs.ts,renderer/ipc.ts,renderer/pages/SkillManagerPage.vue,backend/ipc/channels.ts}`。
- 登记：`renderer/config/tools.ts`、`electron/ipc-namespaces.ts`、`renderer/shared/ipc/types.ts`；`icons.ts` 新增 `star` 图标。
- 页面：`WorkspaceHeader` + `UiMenuHorizontal` 子路由 + 单个 `ToolSurface`；静态 mock 数据；五视图路由；筛选/折叠/星标交互；非技能库视图为占位。
- `pnpm lint`：通过。
- `pnpm typecheck`：仍为 Step 0 的 18 个既有错误，无新增。
- `pnpm build:electron`、`pnpm vite build`：通过；`SkillManagerPage` 产物正常生成。
- 浏览器实测（注入 `edtRuntime.target='mac'`）：1440/1280/390 无页面级横向溢出；390 下 scope 侧栏隐藏、表格内横向滚动；子路由切换正常。
- **环境限制**：本沙箱内 Electron 启动被 Chromium sandbox/`SingletonLock` 拦截，无法打开窗口；改用 Vite 页面验证 UI。代码层没有报错。
- **停**：Step 1 完成，等你确认后进入 Step 2（锁解析只读）。

---

### Step 2 — 数据层 + 锁解析（只读）

**做**

- `shared/data-layers.ts` 增条目：
  - `skill-manager.registry` / `projects` / `favorites` / `presets` / `settings` / `history` / `lock-backups`；
  - `skill-manager.trash` / `disabled`（assets）；
  - `skill-manager.repos` / `staging` / `tmp`（cache）。
- `shared/skill-manager.ts`：
  - `SkillOrigin` / `SkillState` / `InstalledSkill` / `RepoGroupView` / `PlanItem` / `SkillPreset` / `Tombstone` / `AdoptRequest` 等纯类型；
  - 状态矩阵、OriginKey/GroupKey 纯函数。
- backend 锁适配器：
  - `locks/project-lock.ts`：v1 读取，保留未知字段；格式化写回只做 fixture 验证，不接 UI；
  - `locks/global-lock.ts`：v3 读取；拒绝 <3；**只读**。
- fixture：
  - 本仓库 `skills-lock.json`；
  - 手工构造 v1/v3 小 fixture（含 `skillPath` 缺失、未知字段、中文名）。
- 单测/临时脚本：
  - 读 → 写 → 字节级 diff（排序、缩进、尾换行）；
  - v3 不降级；
  - 未知字段保留。

**验收**

- 锁读取对真实文件不报错；34 条项目锁、3 条全局锁解析正确。
- 不在任何路径写文件。
- **停**：贴 fixture 结果，等确认。

---

### Step 3 — 扫描 + IPC + 真实只读库存

**做**

- backend：
  - `services/scanner.ts`：global + 当前项目；`lstat`/symlink/断链；`SKILL.md` frontmatter；
  - 状态矩阵：`ok` / `update-available` / `modified` / `missing` / `orphan` / `invalid` / `disabled` / `linked` / `legacy` / `unknown`；
  - 首次接管 baseline 重建（不把锁 hash 当本地指纹）。
- IPC：
  - `get-overview` / `scan` / `list-skills` / `read-skill`；
  - `safeHandle` + 通道白名单。
- renderer：
  - 用真实数据替换 mock；仓库组树表、状态筛选、scope 切换；
  - 空态/加载/错误；只读。
- 项目 scope：
  - 当前 cwd 若有 `.agents/skills`/`skills-lock.json`，显示为“当前目录（未登记）”；不写 registry。

**验收**

- 真实数据：项目 34 锁 / 38 目录 / 4 未托管；全局 3 锁 / 31 技能 / 29 symlink / 1 断链。
- 0 个误报“本地修改”；不写任何文件。
- `pnpm data-layers:check` 通过。
- **停**：截图 + 计数，等确认。

---

### Step 4 — 来源解析 + 目录（只读）

**做**

- `sources/github.ts`：owner/repo、URL、`@skill`、`#ref`、tree API（公开）→ catalog；
- `sources/git.ts`：TFS/Azure `/_git/`、generic git URL、`?path=&version=`、`git ls-remote`；
- `sources/local.ts`：本地目录扫描；
- `sources/catalog.ts`：统一 `SourceCatalog` / `RepoCatalog`；
- 根目录 `SKILL.md` → 单技能；否则按 `skills/`/递归发现；
- IPC：`resolve-source` / `repo-catalog`；只读，不下载安装。

**验收**

- public GitHub、TFS 示例 URL、本地目录都能解析出名称/路径；
- 根目录技能 `skillPath='SKILL.md'`；
- 私有库无 token 时明确“需要凭据”，不误判仓库不存在。
- **停**：贴三种来源的 catalog，等确认。

**完成记录（2026-11-06）**

- 新增 `tools/skill-manager/backend/sources/{parse,github,git,local,catalog,errors}.ts`；
- IPC 已加 `resolve-source` / `repo-catalog`，`shared/skill-manager.ts` 增加 `SourceCatalog` / `RepoCatalog` 等类型；
- 公开 GitHub `mattpocock/skills`：`main`，39 个技能；`greensock/gsap-skills`：8 个，其中 7 个匹配已安装、`gsap-react` 未安装；
- 本地 `~/work/his-skills-pack`：47 个技能；根目录 `SKILL.md` fixture：单技能、`skillPath=SKILL.md`；
- 通用 git 本地 fixture：`file:///…/repo.git` 可解析 ref、commit、folder SHA；
- TFS 示例 URL 的 `/_git/`、`?path=`、`?version=GBmain` 解析已单测；真实 TFS 拉取需要可达内网与凭据，留 Step 11 验证；
- 私有/不存在仓库且无 token → `auth-required`，不误报“仓库不存在”；
- 验证：`test:skill-manager` 17 pass、lint 通过、typecheck 仍 18 个既有错误、`build:electron` / `vite build` 通过、data-layers 50 条目/25 规则/159 后端文件/1 豁免。

---

### Step 5 — 安装事务（global） ✅

**做**

- `services/installer.ts` + `executor.ts`：
  - 下载/解压到 `cache/staging/<opId>`；
  - tar 路径穿越/大小/条目数防护；
  - 校验 `SKILL.md`、frontmatter、name；
  - 旧目录进 `assets/trash/<opId>`；
  - 原子 rename；计算 hash；写全局锁 v3；写 registry baseline；写 history。
- 单技能/多技能；冲突检查（同名不同源阻止）。
- UI：安装对话框（来源、目标 global、技能面板、确认）。
- 失败回滚矩阵；staging/tmp 启动清理。

**验收**

- 安装 1 个公开技能到全局；锁、目录、registry、history 一致；
- 重装同名同源 = 更新；同名不同源 = 阻止；
- 中途失败不删旧目录；回收站可恢复。
- **停**：贴安装前后 diff，等确认。

**完成记录（2026-11-06）**

- 新增 `tools/skill-manager/backend/services/{hash,archive,executor,installer-core,installer,registry,history}.ts`；`installer-core` 为纯 Node 事务核心，`installer` 只负责解析数据层默认路径，避免测试导入 `electron`。
- global 安装路径：`~/.agents/skills/<name>` + `~/.agents/.skill-lock.json` v3；staging / 回收站 / registry / history 均走 `InstallPaths` 注入。旧目录先入回收站，成功后才写锁；失败回滚新目录并恢复旧目录。
- 全局锁保留旧条目未知字段；`installedAt` 沿用、`updatedAt` 更新；锁写临时文件后 rename，校验 `version === 3`，无尾换行。
- tar 解压修复：目录条目尾 `/` 不再误判越界；GitHub tarball 中的 symlink 条目跳过、不落盘；新增 `archive.test.ts`（目录 + symlink、`../` 穿越）。
- 安装对话框：来源/ref、解析、catalog 复选、冲突/错误、安装中状态；仓库组「管理技能」仅 global scope 显示（Step 6 再接项目安装）。
- 验收实测：`ask-matt`（`mattpocock/skills`）真实安装到全局；安装前锁 3 条、目录无 `ask-matt`，安装后锁 4 条、目录存在、registry baseline 与 history 写入成功；同源重装返回 `updated: ['ask-matt']` 且旧目录进入回收站；本地同名不同源返回 `conflict/different-source`；隔离测试中回收站可恢复旧版本。
- 验证：`test:skill-manager` 22 pass；`lint` 通过；`typecheck` 仍只有 18 个既有错误（skill-manager 0 新增）；`build:electron` + `vite build` 通过；data-layers 50 条目 / 25 规则 / 166 后端文件 / 1 豁免。

---

### Step 6 — 项目锁写入 + 项目安装 ✅

**做**

- `services/projects.ts`：项目登记、锁探测、写锁；
- 项目锁 v1 写回：只改本次条目、保留未知字段、排序、JSON 2 空格 + 尾换行；
- 写前 `lockFingerprint`；写前备份 `lock-backups/<opId>.json`；
- 安装到 `<project>/.agents/skills`；项目锁不存在时创建 v1；
- CLI 兼容：安装后 `npx skills check` 无意外 diff（CI/本地可跑）。

**验收**

- 项目锁写入与 CLI 读取一致；未知字段和排序不丢；
- 备份可恢复；指纹变化时拒绝写入并提示刷新；
- **停**：贴锁 diff + `npx skills check` 结果，等确认。

**完成记录（2026-11-06）**

- 新增 `tools/skill-manager/backend/services/projects.ts`：`registerProject` / `unregisterProject` / `readProjectRegistry` / `inspectProjectLock`；项目路径先 `realpath`，项目 id 与 scanner 一致为 `project:<sha256(realpath).slice(0,12)>`。
- 新增 `tools/skill-manager/backend/services/project-installer.ts`：项目安装独立事务；`InstallPaths` 增加 `projectPath`、`backupRoot`；preflight 检查同名不同源、目标未入锁、symlink、重复/歧义；旧目录进回收站、原子提交、失败回滚；只写项目锁 v1，绝不写全局锁。
- `project-lock.ts` 的 `writeProjectLock`：写前按 `expectedRaw`/`expectedFingerprint` 拒绝并发变化；旧锁备份到 `lock-backups/<opId>.json`；`formatProjectLock` 只排序 `skills`，保留顶层和条目未知字段；2 空格 + 尾换行。
- `installer-core.ts` 导出 staging/校验/origin 辅助函数，global 与 project 共用同一套 frontmatter、hash 与来源判定；`installer.ts` 按 `projectPath` 分流。
- UI：安装对话框新增「全局 / 当前项目」目标切换，项目目标显示项目名并提示写入 `.agents/skills` 与 `skills-lock.json`；仓库组「管理技能」在项目 scope 下也可用；项目安装完成后刷新真实库存。
- 验收实测：隔离项目副本（`skills-lock.json` 34 条 + `.agents/skills` 38 目录）安装 `mattpocock/skills` 的 `pr`，锁仅新增 `pr` 一条、键按名称排序、文件尾换行、备份与安装前逐字节一致；`pnpm dlx skills check`（CLI 1.7.6）识别为 35 个项目技能，`pr` 未出现在待更新列表，说明 `computedHash` 与 CLI 读取一致（其余 8 条待更新来自上游变更，不是锁格式问题）。
- 验证：`test:skill-manager` 27 pass（新增 5 个项目锁/项目安装测试）；`lint` 通过；`typecheck` 仍只有 18 个既有错误（skill-manager 0 新增）；`build:electron` + `vite build` 通过；data-layers 50 条目 / 25 规则 / 168 后端文件 / 1 豁免。
- 边界：本机没有 `npx`，用 `pnpm dlx skills` 等价运行；测试项目为隔离副本，未改动仓库自身的 `skills-lock.json` / `.agents/skills`；Electron 内完整 IPC 仍未跑（沙箱限制）。

---

### Step 7 — 更新检查 + 计划 + 失效清理 ✅

**做**

- `services/planner.ts`：远端快照 × `selectedNames`；`update/remove/move/conflict/ambiguous/unreachable`；
- 计划对话框：默认勾选 update/remove/reinstall；conflict 不勾；
- 应用计划：只动已选中；失效项进回收站 + 移除锁 + 写墓碑；
- 撤销最近一次；history。
- 网络失败绝不判 `removed-upstream`。

**验收**

- 上游删 1 改 1 → 计划准确；应用后锁/目录/回收站/历史一致；
- 撤销恢复；
- 403/超时只标 `unknown`，不产出删除项。
- **停**：贴计划 JSON + 应用结果，等确认。

**完成记录（2026-11-06）**

- 新增 `tools/skill-manager/backend/services/planner-core.ts`：`createUpdatePlanCore` 按 `skillPath` 精确匹配、否则唯一名称匹配；0 命中 `remove`、路径变化 `move`、`folderSha` 变化 `update`、本地缺失 `reinstall`、多同名 `ambiguous`；`add` 只提示不执行；来源不可达直接抛错，绝不生成删除项。
- 计划项带 `localModified`（registry baseline 与当前目录 hash 比对，默认不勾选）、`selectedByDefault`、`from/toPath`、`from/toFolderSha`、`reasons`；`UpdatePlan` 不落盘，只在内存缓存 15 分钟。
- 新增 `tools/skill-manager/backend/services/planner.ts`：按 scope 选择 global/project 默认路径；global 锁 v3、project 锁 v1，锁备份独立。
- 应用事务：重新解析来源并校验 commit/folderSha、锁 raw 指纹；staging/校验 → 旧目录进回收站 → 原子提交 → 写锁 → registry（移除写 tombstone，更新写新 baseline）→ history（旧锁 raw + trash 快照）。任一步失败回滚本轮已改目录。
- 撤销：按 history 的 `beforeLockRaw` 字节级恢复锁；更新/移动目标若已存在先移除，再恢复回收站；`remove` 恢复原路径；`undoneAt` 标记防重复撤销。
- UI：新增 `tools/skill-manager/renderer/components/UpdatePlanPanel.vue`；仓库行「检查更新」打开计划对话框，默认勾选可执行项，add/conflict/ambiguous/unknown 静态展示；更新页展示计划与应用/撤销结果。
- 验收实测：隔离项目与全局 fixture 均得到 `update 1 / remove 1 / skip 1`；apply 后目标内容更新、被删条目移出锁、旧目录进回收站；undo 后目录恢复、锁文件逐字节一致（`RESTORED_LOCK true` / `EXACT_RESTORE true`）。
- 验证：`test:skill-manager` 30 pass（22 旧 + 3 planner + 5 project）；`lint` 通过；`typecheck` 仍只有 18 个既有错误（skill-manager 0 新增）；`build:electron` + `vite build` 通过；data-layers 50 条目 / 25 规则 / 170 后端文件 / 1 豁免。
- UI 验证：1440 计划对话框宽 720，页面无横向溢出；390 下对话框宽 358、页面 `scrollWidth=390`，无横向溢出；计划文本、应用/撤销提示均正确。
- 边界：计划/应用/撤销用隔离 fixture 验证，未对真实仓库执行批量更新；Electron 内完整 IPC 仍未跑（沙箱限制）；计划不入库，服务重启后需重新检查更新。

---

### Step 8 — 禁用/启用 + 回收站 ✅

**做**

- 禁用：目录/链接移到 `assets/skill-manager/disabled/<scopeId>/<name>`；
- global 删锁条目、project 保留（按已确认决策）；
- 启用：冲突检查 → 移回 → global 重建锁 → hash 校验；
- `disabled-drift` 检测；`autoReDisable` 设置；
- 回收站列表/恢复/永久删除/清空；history 撤销。

**验收**

- 禁用后目录不在扫描根，agent 不再加载；
- 启用后内容 hash 不变；
- symlink 只 unlink，不删目标；
- 回收站 30 天/200MB 保留策略。
- **停**：贴状态机前后，等确认。

**完成记录（2026-11-06）**

- 新增 `tools/skill-manager/backend/services/disabled.ts`：`setEnabledCore` 事务内完成目录/链接移动、锁更新、禁用索引、registry、history；global 删锁、project 保留；启用时用禁用前 `contentHash` 回填 `skillFolderHash`/`computedHash`，并校验恢复后 hash。
- 新增 `disabled-index.ts`：`assets/skill-manager/disabled/<scopeId>/index.json`；`disabled-service.ts` 把禁用条目与 `disabled-drift` 合并进 `scanInventoryWithDisabled`，drift 表示禁用区有副本但活动目录又出现。
- 新增 `settings.ts`：`autoReDisable`（默认关，开启后下次扫描自动把重新出现的活动目录移回禁用区）、回收站 30 天/200MB、`disabledLockPolicy`；新增 `trash.ts`：列表、恢复、永久删除、清空、过期清理；恢复目标存在时 `restorable:false`，按钮禁用。
- drift 再次禁用：保留禁用区副本，把重新出现的活动目录移入回收站（`reason:'disabled-drift'`），global 不重复保留锁条目。
- UI：技能行增加禁用/启用按钮（drift 走禁用并提示冲突）；回收站对话框显示来源、原因、时间、大小、保留策略、可恢复状态，并提供「下次扫描时自动重新禁用冲突技能」开关；新增 `pause/play` 图标。
- 验收实测（隔离项目 fixture）：禁用后活动目录消失、project 锁仍保留条目、index 一条；启用后目录与 hash 恢复、index 清空；再次禁用 + 重建活动目录后，drift 解决把活动目录移入回收站且禁用副本保留；回收站列出 `review`（`disabled-drift`，可恢复）。隔离 global fixture：禁用后锁无 `review`，启用后锁条目与 `skillFolderHash` 完全恢复。
- 验证：`test:skill-manager` 36 pass（22 旧 + 5 project + 3 planner + 6 disabled）；`lint` 通过；`tsc -p tsconfig.node.json --noEmit` 通过；全量 `typecheck` 仍只有 18 个既有错误（skill-manager 0 新增）；`build:electron` + `vite build` 通过；data-layers 50 条目 / 25 规则 / 175 后端文件 / 1 豁免。
- UI 验证：1440 技能库显示正常/已禁用/drift 三态；回收站对话框宽 720、页面无横向溢出；390 下 `innerWidth=390`、`document.scrollWidth=390`、对话框 358、无子元素越界。
- 边界：Electron 内完整 IPC 未跑；禁用/启用用隔离 fixture 验证，未改仓库自身技能目录；`autoReDisable` 的扫描自动处理尚未单独做集成测试。

---

### Step 9 — 收藏 + 预设 ✅

**做**

- 收藏：`favorites.json`、多分类、未安装可收藏、来源键 OriginKey；
- 预设：`presets.json`、CRUD、从已装/锁/收藏/手工创建；
- 应用预设：global / 项目 / custom path（默认项目根 `<path>/.agents/skills`）；
- `additive` 默认；`exact` 显式确认；不可用项单独列；
- 预设导入/导出；应用成功才写锁；custom 登记项目可选。

**验收**

- 从项目锁创建预设 → 应用到空项目 → 锁/目录/registry 齐全；
- 同预设应用到第二个项目，不依赖第一个项目；
- additive 保留多余项；exact 移除并二次确认；
- custom path 非法时拒绝。
- **停**：贴预设 JSON + 应用结果，等确认。

**完成记录（2026-11-06）**

- 新增 `tools/skill-manager/backend/services/favorites.ts`：`favorites.json` v1、内置分类、按 `skillOriginKey(origin)` 保存（含 `skillPath`，同仓库多技能不合并）、多分类、未安装可收藏；内置分类不可删。
- 新增 `presets.ts`：`presets.json` v1、CRUD、导入校验、导出；`PresetItem` 只保存 `origin`/`installName`/`enabled`，不保存文件或安装状态；`savePreset` 重算 `key`。
- 新增 `preset-apply-core.ts`：按 `(sourceType,source,ref)` 分组安装；global 复用 `installSkillsCore`，project/custom 复用 `installSkillsToProject`；additive 保留目标多余项，exact 把 extras 移入回收站、删锁并清 registry；`asSkillsRoot` 暂未开放。
- 新增 `favorites-service.ts` / `presets-service.ts`：收藏视图用 `scanInventoryWithDisabled` 补 `installed/scopeIds/state`；应用预设写目标锁/registry/history，更新 `lastAppliedAt`，可登记 custom/project 目标。
- IPC 增加 10 个通道：favorites get/toggle/update/category-save/category-delete、presets get/save/delete/apply/import/export；renderer helpers 已接。
- UI：收藏视图（分类侧栏、收藏卡片、未安装标记）、预设视图（列表、应用/删除、从当前范围新建、导入/导出）、新建预设/应用预设/导入 JSON 对话框；`toggleFavorite` 改为持久化。
- 验收实测（隔离 local fixture）：项目 A 应用 `alpha` → 锁/目录只有 `alpha`；项目 A 应用 `alpha + beta`（additive）→ 安装 `beta`、保留 `alpha`；项目 B 独立应用同一预设 → 两个技能均安装，不依赖 A；项目 A 再次 exact `alpha` → 移除 `beta`，锁/目录只剩 `alpha`，beta 进回收站。
- 预设 JSON 实测包含 `version:1`、`defaultTarget:{kind:'project'}`、`applyMode:'additive'`、每项 `key:'local:<source>#<name>/SKILL.md'`、`origin`、`installName`、`enabled`；应用结果 `installed/updated/removed` 与锁/目录一致。
- UI 验证：1440 收藏视图 `2 项`、分类过滤、已安装/未安装标记；预设视图显示 `交付基线 · 2 个技能 · 增量`；从当前范围新建对话框列出 2 个锁内技能；应用结果 `安装 1、更新 1、移除 0、不可用 0`；390 下 `innerWidth=390`、`document.scrollWidth=390`、对话框 358，无横向溢出。
- 验证：`test:skill-manager` 40 pass（36 旧 + 4 presets）；`lint` 通过；`tsc -p tsconfig.node.json --noEmit` 通过；全量 `vue-tsc` 仍只有 18 个既有错误（skill-manager 0 新增）；`build:electron` / `vite build` 通过；data-layers 50 条目 / 25 规则 / 180 后端文件 / 1 豁免。
- 边界：Electron 内完整 IPC 未跑；`asSkillsRoot` 暂未开放；custom 目标复用项目布局（`<path>/.agents/skills` + `skills-lock.json`）。

---

### Step 10 — 墓碑 + 接管 + 恢复 ✅

**做**

- registry 墓碑：`state: removed` + origin + removedAt + reason + trashRef + lastBaseline；
- 扫描：锁/目录都没了但 R 有记录 → `removed-external`；
- 「已移除」视图：重新安装 / 遗忘；
- 未托管：默认只读，不写锁/不更新/不禁用；
- 接管对话框两种：
  - 绑定来源：校验 → 写项目锁 + baseline + selectedNames；
  - 仅本地：`lockManaged:false`，不写锁，更新跳过，后续可补来源；
- 删除 orphan 进回收站。

**验收**

- 手工复制技能目录 → 未托管只读；不能更新/禁用；
- 绑定来源接管 → 写锁，更新可用；
- 仅本地接管 → 不写锁，更新跳过；
- 删掉锁+目录 → 墓碑可见，重装成功；遗忘后消失。
- **停**：贴接管前后，等确认。

**完成记录（2026-11-06）**

- 新增 `tools/skill-manager/backend/services/adopt-core.ts`：`adoptSkillCore` 两种接管；绑定来源校验 `skillPath` 后写项目锁/全局锁、baseline、`selectedNames`；仅本地写 `lockManaged:false` 且不写锁；symlink 记录 `installMode:'symlink'`；registry/history 失败时恢复旧锁 raw。
- 新增 `delete-skill-core.ts` / `delete-skill.ts`：只有 orphan/linked 或 `lockManaged:false` 可删；目录进回收站，registry 留 `state:'removed'` + `removedReason:'uninstall'` + `trashRef`；托管技能拒绝删除。
- 新增 `removed-views.ts`：`buildRemovedViews` 从 registry 生成墓碑；`state:'removed'` 保留原因，`state:'installed'` 但锁/目录都没了标 `external`；`removedAt` 倒序。
- 新增 `removed-core.ts` / `removed-service.ts`：`listRemovedSkills`、`forgetRemovedCore`、`reinstallRemovedCore`；重装按 `origin.skillPath` 或唯一 name 选来源条目，项目相对来源按项目根解析；遗忘删除 record 并从 group 数组移除。
- 扫描：`scanInventoryWithDisabled` 合并本地接管记录、禁用索引和墓碑；本地接管显示 `tracked:true`、`lockManaged:false`，不写锁、不参与更新计划；计划对 `lockManaged:false` 返回 `skip`。
- UI：orphan/linked 行提供「接管」「删除」；接管对话框支持「绑定来源 / 仅本地」，失败保留错误；「已移除」侧栏和对话框支持重新安装/遗忘；本地接管显示「本地」chip 且隐藏禁用按钮。
- 验收实测（隔离项目 fixture）：
  - 接管前：`state:'orphan'`、`tracked:false`、`lockManaged:false`、锁 `{version:1,skills:{}}`、registry 无记录；
  - 绑定来源接管后：锁写入 `foo`（`source:'../sources/foo'`、`skillPath:'SKILL.md'`、`computedHash:'6ec7…'`），record `lockManaged:true`、baseline `source:'adopt'`；
  - 上游改内容 → 计划 `action:'update'`（`fromFolderSha`/`toFolderSha` 不同），应用后锁 hash 与目录内容更新为 v2；
  - 删锁+目录 → 生成 `external` 墓碑（`lastKnownBaseline` 为当前 hash）；`reinstallRemovedCore` 返回 `installed:['foo']` 并恢复锁；`forgetRemovedCore` 后 record 为 `null`。
- 测试：`adopt.test.ts` 6 项覆盖 source 接管、local 接管、orphan 删除、墓碑排序、墓碑重装+遗忘、adopted 技能参与更新计划；`test:skill-manager` **46 pass / 0 fail**。
- 验证：`lint` 通过；`tsc -p tsconfig.node.json --noEmit` 通过；`vue-tsc` 仍只有 18 个既有错误（skill-manager 0 新增）；`build:electron` / `vite build` 通过；data-layers 50 条目 / 25 规则 / 187 后端文件 / 1 豁免。
- UI 验证：1440 技能库显示 orphan、local-only；接管/已移除对话框无横向溢出；390 `innerWidth=390`、`document.scrollWidth=390`、对话框 358；截图 `/tmp/skill-manager-step10/{library-1440,adopt-1440,removed-1440,removed-390}.png`。
- 边界：Electron 内完整 IPC 未跑；接管/墓碑用隔离 fixture 验证，未改仓库自身 `.agents/skills`；重新安装复用安装事务，锁冲突会按安装结果返回 conflict。

---

### Step 11 — 项目/设置/TFS 认证 + 收口 ✅

**做**

- 项目登记/移除/重扫；`projects.json`；
- 设置：更新策略、回收站保留、自动检查间隔、PAT（按 host，`secret-box`）、TFS HTTP 警告；
- TFS/Azure/generic git 完整走通：`git ls-remote`、浅克隆、folder SHA、token；
- UI 收口：空态/错误/键盘/窄窗口；
- 文档：更新 `docs/skill-manager-plan.md` 实现状态、补充 `docs/data-layers.md`；`DESIGN.md` 如需同步；
- 全量验证：`pnpm typecheck`、`pnpm lint`、`pnpm data-layers:check`、`pnpm build`、手工验收。

**验收**

- 本仓库自身作为项目：34/38/4，0 误报；
- 全局 3/31/29 symlink/1 断链；
- TFS 根目录技能安装 + 更新；
- CLI 双向兼容；
- 所有写操作可撤销。
- **停**：最终验收，等确认。

**完成记录（2026-11-06）**

- 项目：`projects.ts` 新增 `rescanProject`；`scanner.ts` 通过 `configureProjectRegistryProvider` 扫描 global + 已登记项目 + cwd，realpath 去重，失效项目跳过；页面新增项目 tab（登记/重扫/移除）与「设置」dialog。
- 设置：`defaultUpdatePolicy`（safe/sync）、`autoCheckIntervalHours`（0 关闭）、`removePolicy`（trash/keep）、`networkTimeoutMs` 已接入 settings 文件与 UI；plan 移除、preset exact 移除遵循 `removePolicy:'keep'`（目录保留、仅删锁）。
- 认证：`credentials-core.ts` 按 host 存密文，`credentials.ts` 接 `secret-box`，`shared/data-layers.ts` 登记 `skill-manager.credentials`（sensitive）；PAT 经临时 `GIT_ASKPASS` 注入，不拼 URL、不进 argv、不写日志；GitHub 支持保存令牌 + 超时；HTTP 来源追加明文警告。
- git/TFS：`git.ts` 支持 token/timeout，保留 `ls-remote`、浅克隆、`HEAD:<dir>` folder SHA；`git.test.ts` 用 `file://` 仓库验证根 `SKILL.md` 解析、folder SHA、项目安装与锁 v1。
- 实测：项目 38 目录 / 34 锁 / 4 未托管 / 0 modified；全局 33 total / 32 onDisk / 29 untracked / 28 symlink / 1 missing（`coding-standards`）；0 误报。`skills@1.7.6 check` 读到项目锁：26 up-to-date / 8 updates。
- 测试：`pnpm test:skill-manager` **51 pass / 0 fail**；`pnpm lint` 通过；`tsc -p tsconfig.node.json --noEmit` 通过；`vue-tsc` 仍只有 18 个既有错误（skill-manager 0 新增）；`build:electron` / `vite build` 通过；data-layers 51 条目 / 25 规则 / 189 后端文件 / 1 豁免。
- UI：设置 dialog 1440 宽 760、390 宽 358；项目 tab 显示登记项目；`doc=innerWidth=1440`，390 `doc=390`；无横向溢出。
- 边界：真实 TFS/Azure 内网与 PAT 端到端未验证（只有 URL 解析、`file://` git、隔离安装）；自动检查在页面打开时按间隔触发，不是常驻调度器；Electron 内完整 IPC 未跑，UI 为 mock + 构建验证。

---

## 5. 每步的报告格式

每步结束只报这些，不写长篇：

```text
Step N 完成
改动：<文件列表 + 一句话>
验证：<命令 + 结果> / <截图>
已知限制：<没有就写无>
需要你确认：<0–2 个问题>
下一步：Step N+1 范围（等你确认）
```

---

## 6. 风险与回滚

| 风险 | 处理 |
| --- | --- |
| 锁写坏 | 写前备份 + 指纹；失败不写；CLI fixture 对比 |
| 误删 symlink 目标 | 只 `lstat`/`unlink`；realpath 边界；测试覆盖 |
| 安装半途崩溃 | staging/tmp 启动清理；旧目录先入回收站；history partial |
| 来源不可用 | 不判删除；标 `unknown`/`source-gone`；明确提示 |
| 自定义目录越界 | realpath + 拒绝 `/`、home 根、应用数据根、系统目录 |
| 预设被误当锁 | UI 明确“期望清单”；应用成功才写锁 |
| 接管误写锁 | 未托管默认只读；绑定来源才写锁；写前展示锁条目 |

---

## 7. 建议的第一步

建议先做 **Step 0 + Step 1**：

- Step 0 只跑基线、确认 Q1–Q7；
- Step 1 只做脚手架 + 静态壳，不接真实数据。

这样能先验证路由、标题栏、左轨、`ToolSurface` 和表格视觉，再进入只读扫描；一旦方向不对，回滚成本最低。

**等你确认 Q1–Q7 和“先做 Step 1”后，我才开始写代码。**
