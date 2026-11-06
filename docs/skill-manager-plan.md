# 技能管理器（Skill Manager）设计方案

> 状态：**已实现（Step 0–11）** · 目标版本：edt 1.2 · 关联文档：[AGENTS.md](../AGENTS.md)、[DESIGN.md](../DESIGN.md)、[docs/data-layers.md](./data-layers.md)
>
> 一句话：给本机 skill 做一个「包管理器 + 收藏夹」——按仓库分组、记住装过什么、更新时对账、识别上游已删除的 skill、支持禁用/启用、收藏分类，并能直接管理项目里的 `.agents/skills` 与 `skills-lock.json`。
>
> 修订：2026-11-05 确认 Q1–Q4/Q6/Q7/Q11/Q12 决策；新增「仓库内只装部分技能」、§9.8 仓库技能面板、§8.6 TFS/无 API 通用 git 与根目录技能布局。2026-11-06 新增墓碑恢复、§6.3 `presets.json`、§8.7 预设应用、§7.5 未托管接管与 §15.9/§15.10 预设/接管视图。
>
> 视觉预览：[skill-manager-preview.html](./skill-manager-preview.html)（静态样张；右上「设计信息」含规格 / 组件映射 / 状态）。
>
> 实施计划：[skill-manager-implementation-plan.md](./skill-manager-implementation-plan.md)（一步一停，Step 0 待确认）。

---

## 实现状态（2026-11-06）

- 已落地：全局/项目扫描、安装与项目锁事务、更新计划/应用/撤销、禁用/启用与回收站、收藏/预设、墓碑/接管/恢复、项目登记与重扫、设置与按 host PAT、通用 git/TFS URL 解析。
- 兼容：global 锁 v3、project 锁 v1；`skills@1.7.6 check` 可读取项目锁（26 up-to-date / 8 updates）。
- 未覆盖：真实 TFS/Azure 内网与 PAT 端到端、Electron 内完整 IPC 手测、常驻自动检查调度器。实现细节与每步验收见 [skill-manager-implementation-plan.md](./skill-manager-implementation-plan.md)。

---

## 0. 结论先行

### 0.1 十条核心决策

| # | 决策 | 理由 |
| --- | --- | --- |
| 1 | 新增工具 `skill-manager`，只做**本机技能的文件与来源管理**，不做技能运行时 | 运行时分发属于各 agent；我们只负责「装、更、删、禁、藏」 |
| 2 | 双作用域：`global`（`~/.agents/skills` + `~/.agents/.skill-lock.json`）与 `project`（`<project>/.agents/skills` + `<project>/skills-lock.json`） | 与 `vercel-labs/skills` CLI 的规范目录一致，且本项目自身就在用 |
| 3 | 安装/更新以**仓库（source + ref）**为分组单元，但以**技能**为操作单元；组内持久化「已选中 / 已安装 / 上次远端可见」三个集合 | 用户要的「按仓库分组」「记住上次装了哪些」落在组上；「一个仓库只装/只更其中一个」落在技能选择上 |
| 4 | 失效判定采用**三方对账**：锁文件 + 应用侧本地基线 + 远端目录；网络失败绝不判失效 | 锁不可靠（见 §1.2）、hash 语义不一致，单靠锁会误删 |
| 5 | 更新是**事务**：staging → 校验 → 旧版本进回收站 → 原子替换 → 写锁 → 写 registry；支持回滚 | skill 是用户资产，不能出现「删了一半」 |
| 6 | 禁用 = 把技能**移出扫描根**到应用数据区；启用 = 移回 | 各 agent 只认目录扫描，marker 文件不算真禁用；symlink 只动链接不动目标 |
| 7 | 收藏是**跨 project/global 的个人书签**，支持多分类标签；未安装也能收藏 | 收藏表达「我想要什么」，不等于「我现在装着什么」 |
| 8 | 与 `npx skills` **双向兼容**：版本、字段、排序、哈希算法都对齐；未知版本只读 | 用户随时可能在终端跑 CLI，两边不能互相破坏 |
| 9 | 锁之外再维护**墓碑 + 预设**：卸载或外部删除后仍能按来源找回；预设可随时重装到指定目录 | 锁只记「当前安装」，不记「曾经装过」；用户要的是可恢复的资产清单 |
| 10 | 项目里手工新增的未托管技能默认**只读**；显式「接管」后才进入选择集；绑定来源后才进入更新计划 | 不猜来源、不静默改锁；本地接管可管理但不假装能远端更新 |

### 0.2 已确认决策（2026-11-05 / 11-06）

| 议题 | 结论 |
| --- | --- |
| 禁用后放哪 | **应用数据区** `<assets>/skill-manager/disabled/<scopeId>/<name>/`（§10） |
| 禁用时锁怎么处理 | **分 scope**：`global` 删锁条目；`project` 保留锁条目，项目级可切换为删（§10.3） |
| 项目 `skills-lock.json` | **直接读写**，严格保持 v1 格式、排序与字段兼容（§2.2、§12.2） |
| 上游已删除的默认处置 | 更新计划里**默认勾选**「移到回收站 + 移除锁」，可撤销（§9.3、§9.5） |
| 首版范围 | 只管理 `.agents/skills`；其它 agent 目录**只读识别**（§3、§12） |
| 仓库内只装部分技能 | 安装/更新都按技能勾选；更新**只作用于已选中技能**，未选中的远端技能只提示、不下载、不安装（§9.8） |
| 仓库技能面板 | 列出仓库全部技能，**自动勾选已安装/已禁用**；改选后一次确认，安装/更新/移除合并成一个事务（§9.8） |
| 面板取消勾选 | **卸载**：移到回收站 + 从锁/`selectedNames` 移除；「跳过本次更新」只在更新对话框里做 |
| 非 GitHub / 无 API | **通用 git + PAT**（TFS / Azure Repos / 自建 GitLab），不依赖 GitHub API（§8.6） |
| 根目录即技能 | 根 `SKILL.md` → 整个仓库一个技能，`skillPath = "SKILL.md"`，不再发现子技能（§8.6） |
| 私有仓库认证 | **PAT**，按 host 保存（env 或应用内加密）；TFS 走 git + token，不要求 API（§8.6、§22 Q7） |
| 技能丢失后的追踪 | registry 保留**墓碑**（origin / removedAt / trashRef / 最后基线），不随卸载删除；可从回收站或远端重装（§7.2、§9.5） |
| 技能预设 | `presets.json` 保存技能来源清单；可应用到 global / 项目 / 指定目录，默认增量安装，显式才精确同步（§6.3、§8.7、§11.5） |
| 预设指定目录 | **默认项目根**，装到 `<path>/.agents/skills`；直接把目录当技能根只作为高级选项（§8.7） |
| 预设应用模式 | **默认 additive**：装缺失、更新已有、保留目标多余项；exact 需显式确认（§8.7） |
| 项目里手工新增 skills | 扫描为 `orphan`，默认**只读不可维护**；可预览/收藏/删除；显式「接管」后才进入选择集；绑定来源后才参与远端更新（§7.5、§15.10） |
| 未托管接管方式 | **两种都允许**：绑定来源（写锁、可更新）/ 仅本地（不写锁、只本地维护、可后补来源）（§7.5、Q15） |

其余问题（Q5 收藏多分类、Q8 默认策略、Q9 工具形态、Q10 明细保留）按 §22 的推荐值执行，除非另有指示。

### 0.3 需求对照

| 用户要求 | 落点 |
| --- | --- |
| 安装 / 管理 / 更新 skills | §8 安装、§9 更新、§6 数据模型 |
| 识别失效 skill（上游移除） | §9.2–§9.4，状态 `removed-upstream` |
| 按仓库分组 | §4.3 `RepoGroup`、§15.2 分组表 |
| 记住上次安装 / 上次拉取并对比 | §6.2 `selectedNames` / `installedNames` / `lastFetchedNames`、§9.1 |
| 删除已失效 | §9.5（默认进回收站，不硬删） |
| 禁用 / 启用 | §10 |
| 收藏 + 按功能分类 | §11 |
| 安装到项目文件夹 / 更新项目技能 | §12、§8.3 |
| 识别并解析 `skills-lock.json` | §2.2、§12.2 |
| 解析安装源后更新、移除失效 | §9.1、§12.3 |
| 仓库多技能只装/只更新其中一个 | §9.8 仓库技能面板、§8.2 |
| 面板列出全部技能、自动勾选已安装、可改选 | §9.8、§15.4 |
| 锁和目录都丢失后仍能追踪、重装 | §7.2 墓碑、§9.5、§11.5 |
| 维护技能预设、随时安装到指定目录 | §6.3 `presets.json`、§8.7、§11.5、§15.9 |
| 项目里手工新增 skills 默认只读、可接管 | §7.3 `orphan`、§7.5 接管、§15.10 |

### 0.4 不做什么（非目标）

- 不做技能市场/搜索（`skills.sh` 的浏览与排行不在首版；首版支持「知道来源后安装」）。
- 不执行 skill 里的脚本，不替 agent 注入上下文。
- 不改各 agent 的配置文件（`.claude/settings.json`、`~/.codex/config.toml` 等），只管理规范技能目录。
- 不管理 `node_modules` 来源的同步（`experimental_sync` 的职责）；首版只读展示。
- 不做跨机器同步；收藏与 registry 是本机数据。

---

## 1. 现状与事实基线（本机实测）

这些数字不是假设，是设计必须绕开的坑。

### 1.1 两套锁、两种语义

| | 项目级 | 全局级 |
| --- | --- | --- |
| 路径 | `<project>/skills-lock.json` | `~/.agents/.skill-lock.json`（若设 `XDG_STATE_HOME` 则为 `$XDG_STATE_HOME/skills/.skill-lock.json`） |
| 当前版本 | `version: 1` | `version: 3` |
| 键 | 技能名 | 技能名 |
| 来源字段 | `source` / `sourceType` / `skillPath`（可选 `sourceUrl`/`ref`/`version`/`via`） | `source` / `sourceType` / `sourceUrl` / `ref?` / `skillPath` |
| 哈希 | `computedHash` = **本地技能目录内容哈希**（相对路径 + 文件内容，排序后 SHA-256） | `skillFolderHash` = **GitHub Tree SHA**（整个技能目录，远端） |
| 时间戳 | 无（刻意如此，减少 merge 冲突） | `installedAt` / `updatedAt` |
| 排序 | 技能名字典序 | 技能名字典序 |
| 损坏时 | CLI 抛 `SKILLS_INVALID_LOCAL_LOCK`，不会覆盖 | CLI 在 `version < 3` 时**清空重建** |

> 这两个差异是硬约束：
> - 我们不能把「本地内容 hash」写进全局锁（CLI 期望 tree SHA）；也不能把 tree SHA 当成本地修改判据。
> - 全局锁**绝不能写成 v1/v2**——CLI 读到旧版本会直接清空，等于删用户数据。

### 1.2 本仓库体检结果（2026-11-05）

**项目 `skills-lock.json`**

- `version: 1`，**34 条**，来自 5 个仓库：`mattpocock/skills` 24、`greensock/gsap-skills` 7、`Leonxlnx/taste-skill` 1、`pbakaus/impeccable` 1、`vueuse/vueuse` 1。
- 磁盘上 `.agents/skills` 有 **38 个目录**。
- **4 个未入锁的目录**：`gsap-react`、`shadcn-vue`、`supabase`、`supabase-postgres-best-practices`（来源未知，属于「未托管」）。
- 锁中记录但目录缺失：**0 个**。
- 按 CLI 的 `computeSkillFolderHash` 逻辑复算：**只有 7/34 与 `computedHash` 一致，27 条不一致**。

**全局 `~/.agents/.skill-lock.json`**

- `version: 3`，**只有 3 条**：`find-skills`、`archify`、`coding-standards`。
- `~/.agents/skills` 实际有 **32 项**（31 个技能目录 + `.DS_Store`），其中 **29 个是 symlink（含 1 个断链）**，指向 `~/work/skills-pack/skills/*`。
- `coding-standards` 在锁里有记录，但目录**不存在**。
- 有 **1 个断链**：`trace-debug-dongguantaixin11`。

### 1.3 四条设计结论

1. **锁不是清单**：全局 3 条锁 vs 31 个实际技能。必须以目录扫描为主、锁为来源线索。
2. **锁哈希不是本地内容指纹**：项目 27/34 对不上。首次接管必须**重建基线**，不能把「对不上」直接报成「被用户改过」。
3. **symlink 是一等公民**：全局 29/31 是链接。删除/禁用必须 `lstat` + 只处理链接本身，绝不能递归删目标目录（否则会删掉外部技能包）。
4. **项目锁是团队资产**：它会被提交、被 review、被 CI 的 `--frozen-lockfile` 校验。我们写它必须逐字节保持 CLI 的格式与排序。

---

## 2. 与 `npx skills` 的兼容契约

### 2.1 读：宽松但可解释

- 能读 v1 / v3；未知版本、JSON 损坏、含 merge 冲突标记 → **只读模式**，卡片上给出具体原因与文件路径，不提供写入按钮。
- 单条记录缺 `skillPath`（早期安装）→ 状态 `legacy`，可更新但只能按「唯一同名」匹配，或引导重新安装。
- 记录缺 `sourceUrl` 的 generic git 源 → 不可更新（与 CLI 一致），标 `needs-reinstall`。
- `sourceType` 不在支持列表 → 只读展示，不参与更新。

### 2.2 写：只写当前版本，保留未知字段

| 规则 | 项目锁 v1 | 全局锁 v3 |
| --- | --- | --- |
| 版本 | 只写 `1` | 只写 `3` |
| 排序 | 技能名字典序 | 技能名字典序 |
| 格式 | `JSON.stringify(lock, null, 2) + '\n'` | `JSON.stringify(lock, null, 2)`（CLI 无尾换行） |
| 未知字段 | 条目级 spread 保留 | 条目级 spread 保留；顶层 `dismissed` / `lastSelectedAgents` 原样保留 |
| 哈希 | 安装完成后按 CLI 算法复算本地目录 | 写入远端 tree SHA（拿不到时不要编造，保留旧值并标 `unknown`） |
| 时间戳 | 不写 | 保留 `installedAt`，更新 `updatedAt` |
| 原子性 | 临时文件 + rename | 同左 |

**CLI 哈希算法（必须逐条对齐）**：

```text
递归遍历技能目录，跳过 .git / node_modules，只取 regular file；
relativePath 统一把 '\' 换成 '/'；
按 relativePath.localeCompare 排序；
hash.update(relativePath); hash.update(fileContent);  // 不加分隔符
最终 SHA-256 hex。
```

> 注意：CLI 用 `localeCompare` 排序。我们在 Node 侧实现时也要用 `localeCompare`，不要用 `Buffer.compare`，否则含非 ASCII 文件名的技能会出现「CLI 认为没变、我们认为变了」的抖动。

### 2.3 并发写保护

CLI 和应用可能同时写同一个锁。做不到跨进程文件锁，但可以**检测并放弃**：

1. 写入前记录 `(mtimeMs, size, sha256(raw))` 指纹。
2. 读锁 → 计算计划 → 写之前再读一次；指纹变了就抛 `LOCK_CHANGED_EXTERNALLY`，提示「锁文件已被其他工具修改，请刷新后重试」。
3. 应用内所有写操作串行化（单 operation 队列）；另加 `<data>/config/skill-manager/.write.lock`（`O_EXCL` + 10s 过期）防止应用双开。
4. 绝不「读旧内容 → 覆盖写」；每次写都重新读一遍再合并。

---

## 3. 目标与非目标

### 3.1 目标

- 一处看清本机所有技能：全局 + 已登记项目，按来源仓库分组。
- 安装/更新/卸载可预览、可回滚、失败可解释。
- 上游删除的技能能被**稳定识别**，且删除走回收站。
- 禁用/启用不丢内容、不改来源记录。
- 收藏可跨作用域、可多分类、可对未安装技能使用。
- 项目里手工新增的技能能被识别为未托管；默认只读，显式接管后才参与更新与锁维护。
- 技能目录和锁都丢失后，仍能按来源**追踪并重装**；可维护一份技能预设，随时装到指定目录。
- 项目侧直接读写 `skills-lock.json`，与 CLI / CI 兼容。

### 3.2 成功判据

- 对一个 38 技能的项目，首次扫描 1s 内完成，且 4 个 orphan、1 个断链、0 个误报「本地修改」。
- 对一个删除了 2 个技能的仓库，检查更新后准确列出 2 个 `removed-upstream`，应用后进入回收站、锁同步、可一键撤销。
- 禁用后新开 agent 会话，技能不再出现在可用列表；启用后恢复，内容 hash 不变。
- 手动删掉 `skills-lock.json` 条目和技能目录后，仍能从 registry 墓碑看到来源并一键重装；预设可一键装到另一个项目。
- 手工往项目 `.agents/skills` 放一个技能：首屏标未托管且不可更新；接管并绑定来源后才写锁、出现在更新计划里。
- 我们的写操作之后，`npx skills check` 不产生「意外变化」；CLI 写完之后，我们能正确重读。

---

## 4. 术语与身份模型

### 4.1 术语

| 术语 | 含义 |
| --- | --- |
| Scope（作用域） | `global` 或某个已登记的项目目录 |
| InstalledSkill | 某个 scope 下、某个目录里的一个技能实例 |
| Selection（选择集） | 用户为该仓库/scope 选中的技能集合 = 已安装 ∪ 已禁用；**更新只作用于它** |
| Origin（来源） | `sourceType + source + ref + skillPath`，描述「它从哪来」 |
| RepoGroup（仓库组） | 同一 scope 下、同一 `source + ref` 的技能组，包含「已选中 / 已安装 / 上次远端可见」三个集合 |
| Baseline（基线） | 我们上次确认过的本地内容哈希 + 捕获时间，用于判断「用户是否改过」 |
| Snapshot（快照） | 某次检查时远端仓库里可用的技能集合（名称 + 路径 + tree SHA） |
| Plan（更新计划） | 一次检查产出的逐技能动作清单（update/add/remove/move/conflict…） |
| SelectionPlan（选择计划） | 仓库技能面板「改选后确定」产出的安装/更新/移除合并计划 |
| Preset（预设） | 一份**期望技能清单**（只存来源，不存文件），可随时应用到 global / 项目 / 指定目录 |
| Tombstone（墓碑） | registry 里保留的已移除技能记录：来源、移除时间、回收站引用、最后基线 |
| Adopt（接管） | 把未托管目录显式纳入 registry；绑定来源时写锁，仅本地接管不写锁 |
| Drift（漂移） | 本地实际状态与锁/registry/远端任一方不一致 |

### 4.2 唯一键

```text
InstalledKey = `${scopeId}:${name}`                 // 例：global:grilling / project:ab12cd:tdd
OriginKey    = `${sourceType}:${source}${ref ? '@' + ref : ''}#${skillPath ?? name}`
GroupKey     = `${scopeId}|${sourceType}:${source}${ref ? '@' + ref : ''}`
FavoriteKey  = OriginKey                             // 收藏不绑 scope，也不绑本地目录名
```

规则：

- 技能在仓库里**改名但路径不变** → 仍视为同一技能（按 `skillPath` 对齐），收藏不丢。
- 技能**换目录**（repo 重组）→ 状态 `moved`，迁移而不是「删一个 + 加一个」，`OriginKey` 更新但收藏通过「旧 key → 新 key」的映射表跟随。
- 两个仓库有同名技能 → 安装到同一 scope 会产生目录名冲突，**默认阻止**，不做静默覆盖。
- 项目与全局同名 → 允许共存，项目优先；UI 标 `shadowed`（被项目覆盖），只做提示。

### 4.3 作用域

```ts
type ScopeKind = 'global' | 'project'

interface Scope {
  id: string                 // 'global' | `project:${hash}`
  kind: ScopeKind
  label: string              // '全局' | 项目目录名
  skillsDir: string          // <root>/.agents/skills
  lockPath: string           // 全局锁或项目锁
  projectPath?: string       // project 专用
  lockState: 'ok' | 'missing' | 'invalid' | 'unsupported'
  lockVersion?: number
}
```

---

## 5. 总体架构

### 5.1 数据流

```text
┌──────────────────────────── renderer ────────────────────────────┐
│ SkillManagerPage                                                │
│  ├─ InstalledView   仓库分组表 + 状态 + 行操作                    │
│  ├─ UpdatesView     仓库级检查结果 + 更新计划                     │
│  ├─ FavoritesView   分类侧栏 + 收藏卡片/表                        │
│  ├─ PresetsView     预设清单 + 应用到目标 + 差异预览               │
│  ├─ ProjectsView    项目卡 + 锁状态 + 批量更新                    │
│  └─ SettingsView    策略 / 令牌 / 回收站                          │
│         │ invoke / on(EVENT_PROGRESS)                            │
└─────────┼─────────────────────────────────────────────────────────┘
          ▼
┌──────────────────────────── preload ──────────────────────────────┐
│ window.skillManager（ipc-namespaces 注册，safeHandle 校验来源）    │
└─────────┬─────────────────────────────────────────────────────────┘
          ▼
┌────────────────────────── backend ────────────────────────────────┐
│ ipc/handlers.ts                                                   │
│  ├─ scanner.ts       目录扫描 + 锁解析 + 状态判定                  │
│  ├─ planner.ts       远端快照 × 已安装 → Plan                     │
│  ├─ executor.ts      staging / 备份 / 原子替换 / 回滚              │
│  ├─ installer.ts     源解析 / 目录选择 / 安装                      │
│  ├─ projects.ts      项目登记 / 锁监听 / 重扫                      │
│  ├─ favorites.ts     收藏 / 分类                                  │
│  ├─ presets.ts       预设 CRUD / 应用计划 / 导入导出                │
│  ├─ history.ts       操作历史 / 撤销                              │
│  └─ trash.ts         回收站                                       │
│  sources/{github,git,local,catalog}.ts                            │
│  locks/{global-lock,project-lock,hash}.ts                         │
│  store/{registry,projects,favorites,presets,settings}.ts          │
└─────────┬─────────────────────────────────────────────────────────┘
          ▼
  GitHub API / codeload tarball / git CLI（可选）/ 本地文件系统
```

### 5.2 拟新增文件

```text
tools/skill-manager/
  index.ts
  backend/
    index.ts                      # skillManagerBackend.initialize()
    ipc/{channels,handlers}.ts
    services/{scanner,planner,executor,installer,projects,favorites,presets,history,trash}.ts
    sources/{github,git,local,catalog}.ts
    locks/{global-lock,project-lock,hash}.ts
    store/{registry,projects-store,favorites-store,presets-store,settings-store}.ts
    utils/{paths,atomic,tar,lock-guard,frontmatter}.ts
  renderer/
    ipc.ts                        # 唯一 createIpcHelpers 实例
    pages/SkillManagerPage.vue
    views/{InstalledView,UpdatesView,FavoritesView,PresetsView,ProjectsView,SettingsInspector}.vue
    components/{RepoGroupTable,SkillRow,PlanDialog,PresetApplyDialog,FavoriteStar,CategoryPicker,ProjectCard}.vue
    stores/…                      # 只放视图状态，业务状态从 IPC 来
shared/skill-manager.ts           # 纯类型 / 常量 / 纯函数（状态矩阵、格式化）
```

### 5.3 边界

- `renderer` 不碰 `fs`，不拼数据目录；所有写操作走 IPC。
- `backend` 只写两个 scope 的 `skillsDir` 与锁文件，不写 agent 配置。
- `shared/skill-manager.ts` 不依赖 Node/Electron，状态判定纯函数可单测。

---

## 6. 数据模型与落盘

### 6.1 数据分层

按 [docs/data-layers.md](./data-layers.md) 的判据：

| 层 | 路径 | 内容 | 备份 | 清理 |
| --- | --- | --- | --- | --- |
| config | `skill-manager/registry.json` | 安装记录、基线、仓库快照 | include | never |
| config | `skill-manager/projects.json` | 项目登记表 | include | never |
| config | `skill-manager/favorites.json` | 收藏与分类 | include | never |
| config | `skill-manager/presets.json` | 技能预设（仅来源清单） | include | never |
| config | `skill-manager/settings.json` | 策略、超时、令牌引用 | include | never |
| config | `skill-manager/history.json` | 操作历史（最近 100 条） | optional | never |
| config | `skill-manager/lock-backups/` | 写锁前的快照（回滚用） | include | never |
| assets | `skill-manager/trash/` | 被移除/被覆盖的技能目录 + manifest | manifest-only | never |
| assets | `skill-manager/disabled/` | 被禁用的技能目录/链接记录 | include | never |
| cache | `skill-manager/repos/` | tree / tarball / ETag 缓存 | never | always |
| cache | `skill-manager/staging/` | 安装暂存区 | never | always |
| cache | `skill-manager/tmp/` | 临时文件 | never | always |

> 回收站与禁用区放 **assets** 而不是 cache：它们是用户可恢复的内容，清缓存不能销毁不可再生数据（见 data-layers 的判定链）。
> 所有路径必须经 `resolveLayerPath`；新增条目先写进 `shared/data-layers.ts` 的 `DATA_LAYER_ENTRIES`。

### 6.2 registry.json

```jsonc
{
  "version": 1,
  "scopes": {
    "global": {
      "lastScanAt": "2026-11-05T09:31:00.000Z",
      "lockFingerprint": "sha256:...",
      "records": {
        "grilling": {
          "name": "grilling",
          "dirName": "grilling",
          "origin": {
            "sourceType": "github",
            "source": "mattpocock/skills",
            "sourceUrl": "https://github.com/mattpocock/skills",
            "ref": null,
            "skillPath": "skills/productivity/grilling/SKILL.md"
          },
          "installMode": "copy",
          "baseline": {
            "contentHash": "a1b2...",
            "capturedAt": "2026-11-05T09:31:00.000Z",
            "source": "adopt"          // install | adopt | repair
          },
          "remote": {
            "folderSha": "ef1641...",
            "resolvedRef": "main",
            "commitSha": "…",
            "fetchedAt": "2026-11-05T09:31:00.000Z"
          },
          "tracked": true,
          "forked": false,
          "state": "installed",        // installed | removed（墓碑）
          "removedAt": null,
          "removedReason": null,       // uninstall | removed-upstream | external
          "trashRef": null             // 有回收站副本时指向 manifest
        }
      }
    }
  },
  "groups": {
    "global|github:mattpocock/skills": {
      "lastCheckedAt": "2026-11-05T09:31:00.000Z",
      "lastFetchedAt": "2026-11-05T09:31:00.000Z",
      "resolvedRef": "main",
      "commitSha": "…",
      "selectedNames": ["grilling", "tdd"],
      "installedNames": ["grilling", "tdd"],
      "lastFetchedNames": ["grilling", "tdd", "diagnosing-bugs"],
      "lastPlanId": "plan_01",
      "lastPlanSummary": { "update": 2, "remove": 1, "add": 0, "conflict": 1 }
    }
  }
}
```

**三个集合就是用户要的「记住」**：

- `selectedNames`：用户选中的集合（**成员关系的唯一事实**），包含已安装与已禁用；更新只作用于它。
- `installedNames`：上次**实际安装并落盘且处于启用**的集合（写锁成功后的集合）。
- `lastFetchedNames`：上次**检查时远端可见**的技能集合（用于回答「这个仓库现在提供哪些 / 比上次少了哪些」；不等于实际下载，实际落盘看 `installedNames`）。
- 差异关系：
  - `selected - installed - disabled` → `missing`（选中但没落盘，应重装）。
  - `installed - selected` → 不应存在；扫描时发现则标 `orphan` 或提示修复。
  - `lastFetched - selected` → 上游有、但我没选（面板里显示「未安装」，永不自动安装）。
  - `selected - lastFetched` → 上游已移除（进入失效候选，但要先确认仓库可访问）。
- 对比差异可回答：「这个仓库上次有 12 个，这次只剩 10 个 → 哪些没了」。
- 即使不应用更新，也保留 `lastFetchedNames`，用于「上次检查时发现减少」的审计。
- 旧数据没有 `selectedNames` 时，按 `installedNames ∪ disabledNames ∪ 锁条目` 重建。

**墓碑（tombstone）**：`records[name]` **不因卸载或目录删除而删除**。

- `state: 'removed'` 的记录保留 `origin`、`removedAt`、`removedReason`、`trashRef`、`lastKnownBaseline`；它不参与 `selectedNames` / `installedNames`，只用于「已移除」视图、重新安装与审计。
- 卸载：写墓碑（`reason: 'uninstall'`），回收站有副本则记 `trashRef`。
- 上游移除：写墓碑（`reason: 'removed-upstream'`），保留 origin；远端仓库恢复后可重装。
- 外部删除：扫描发现「上次锁有、当前锁没有、目录也没有」，但 registry 有旧记录 → 标 `removed-external` 墓碑，保留来源，不静默丢。
- 默认**永久保留**（每条只是元数据，<1 KB）；只有用户点「遗忘」才删除，不自动清理。
- 从未被本机扫描/安装/收藏过的技能，仍无法追踪；这是信息不存在，不是墓碑能补的。

### 6.3 presets.json

```jsonc
{
  "version": 1,
  "presets": {
    "frontend-standards": {
      "id": "preset_frontend",
      "name": "前端规范",
      "description": "公司前端项目常用的一组技能",
      "createdAt": "2026-11-06T09:00:00.000Z",
      "updatedAt": "2026-11-06T09:00:00.000Z",
      "createdFrom": "project:everydaytool",
      "defaultTarget": { "kind": "project", "scopeId": "project:ab12cd" },
      "applyMode": "additive",          // additive | exact
      "installMode": "copy",            // copy | symlink
      "items": [
        {
          "key": "github:mattpocock/skills#skills/productivity/grilling/SKILL.md",
          "name": "grilling",
          "origin": {
            "sourceType": "github",
            "source": "mattpocock/skills",
            "ref": null,
            "skillPath": "skills/productivity/grilling/SKILL.md"
          },
          "installName": "grilling",
          "enabled": true
        },
        {
          "key": "git:http://tfs.example.internal:8080/tfs/Collection/Project/_git/example-skill#SKILL.md",
          "name": "trace-analyze-html",
          "origin": {
            "sourceType": "git",
            "source": "http://tfs.example.internal:8080/tfs/Collection/Project/_git/example-skill",
            "sourceUrl": "http://tfs.example.internal:8080/tfs/Collection/Project/_git/example-skill",
            "ref": null,
            "skillPath": "SKILL.md"
          },
          "installName": "trace-analyze-html",
          "enabled": true
        }
      ],
      "lastAppliedAt": "2026-11-06T09:05:00.000Z",
      "lastApplyTarget": "project:ab12cd"
    }
  }
}
```

- 预设是**期望清单**，不是锁：只存来源（OriginKey + 解析所需字段），不存技能文件、不存安装状态。
- `defaultTarget.kind`：`global` | `project` | `custom`；`custom.path` 是目标项目根，技能装到 `<path>/.agents/skills`。若用户直接选了一个 skills 根目录，UI 高级选项可切「作为技能根目录」。
- `applyMode: additive`（默认）= 装缺失、更新已有、保留目标里多出来的技能；`exact` = 目标最终必须等于预设，需显式确认后移除多余项。
- 预设可来自：当前 scope 的已选技能、某个仓库组、收藏分类、`skills-lock.json`、手工添加来源。
- 预设可导出/导入 JSON；导入只新增/覆盖预设，不自动安装。
- 预设项的来源失效时标 `source-gone`，不阻塞其它项；应用计划里单独列「不可用」。

### 6.4 favorites.json

```jsonc
{
  "version": 1,
  "categories": [
    { "id": "dev-standards", "name": "开发规范", "icon": "rulers", "order": 0, "builtin": true },
    { "id": "ui", "name": "UI / 设计", "icon": "palette", "order": 1, "builtin": true },
    { "id": "writing", "name": "文档与写作", "icon": "pen-line", "order": 2, "builtin": true }
  ],
  "items": {
    "github:mattpocock/skills#skills/productivity/grilling/SKILL.md": {
      "id": "fav_01",
      "name": "grilling",
      "displayName": "需求拷问",
      "origin": { "sourceType": "github", "source": "mattpocock/skills", "skillPath": "skills/productivity/grilling/SKILL.md" },
      "categories": ["dev-standards"],
      "note": "方案评审前先跑一轮",
      "createdAt": "2026-10-30T08:00:00.000Z",
      "lastSeenAt": "2026-11-05T09:31:00.000Z",
      "snapshot": { "description": "Grill the user relentlessly…" }
    }
  }
}
```

### 6.5 核心类型（`shared/skill-manager.ts` 草案）

```ts
export type SkillSourceType = 'github' | 'git' | 'local' | 'node_modules' | 'well-known' | 'unknown'

export type SkillState =
  | 'ok' | 'update-available' | 'modified' | 'missing' | 'orphan' | 'invalid'
  | 'removed-upstream' | 'removed-external' | 'moved' | 'disabled' | 'linked' | 'legacy' | 'shadowed' | 'unknown'

export interface SkillOrigin {
  sourceType: SkillSourceType
  source: string
  sourceUrl?: string
  ref?: string | null
  skillPath?: string
}

export type PresetTarget =
  | { kind: 'global' }
  | { kind: 'project', scopeId: string }
  | { kind: 'custom', path: string, asSkillsRoot?: boolean }

export type PresetApplyMode = 'additive' | 'exact'

export interface PresetItem {
  key: string                   // OriginKey
  name: string
  origin: SkillOrigin
  installName?: string
  enabled?: boolean
}

export interface SkillPreset {
  id: string
  name: string
  description?: string
  items: PresetItem[]
  defaultTarget?: PresetTarget
  applyMode: PresetApplyMode    // 默认 additive
  installMode: 'copy' | 'symlink'
  createdAt: string
  updatedAt: string
  lastAppliedAt?: string
  lastApplyTarget?: string
}

export interface PresetApplyRequest {
  presetId: string
  target: PresetTarget
  /** 覆盖预设默认；exact 必须显式传，UI 二次确认 */
  mode?: PresetApplyMode
  /** 只应用这些 OriginKey；缺省全部 */
  selections?: string[]
  /** custom target 成功后是否登记为项目；默认 true */
  registerProject?: boolean
}

export interface Tombstone {
  scopeId: string
  name: string
  origin: SkillOrigin
  removedAt: string
  removedReason: 'uninstall' | 'removed-upstream' | 'external'
  trashRef?: string
  lastKnownBaseline?: string
}

export interface AdoptRequest {
  scopeId: string
  name: string
  mode: 'source' | 'local'
  /** mode=source 时必填；本地接管不需要 */
  origin?: SkillOrigin
}

export interface InstalledSkill {
  key: string
  name: string
  dirName: string
  scopeId: string
  origin: SkillOrigin
  state: SkillState
  stateReasons: string[]
  installMode: 'copy' | 'symlink'
  linkTarget?: string
  contentHash?: string
  baselineHash?: string
  localModified: boolean
  disabled: boolean
  tracked: boolean
  forked: boolean
  /** 本地接管时为 false：不写锁，只做本地 hash 校验 */
  lockManaged?: boolean
  installedAt?: string
  updatedAt?: string
  sizeBytes?: number
}

export interface RepoGroupView {
  key: string
  scopeId: string
  origin: Pick<SkillOrigin, 'sourceType' | 'source' | 'ref'>
  displayName: string
  /** 已选中（含已禁用）的技能；未选中的远端技能不铺进技能库表 */
  skills: InstalledSkill[]
  counts: {
    remoteTotal: number
    selected: number
    installed: number
    ok: number
    update: number
    modified: number
    removed: number
    missing: number
    orphan: number
  }
  lastCheckedAt?: string
  lastFetchedCount?: number
  resolvedRef?: string
}

/**
 * add   = 远端有、但本次未选中：只提示，不执行（update plan）
 * install = 面板新勾选、需要落盘（selection plan）
 */
export type PlanAction = 'update' | 'add' | 'install' | 'remove' | 'move' | 'reinstall' | 'conflict' | 'skip'

export interface PlanItem {
  name: string
  action: PlanAction
  fromPath?: string
  toPath?: string
  fromFolderSha?: string
  toFolderSha?: string
  localModified: boolean
  selectedByDefault: boolean
  reasons: string[]
}

export interface RepoCatalogEntry {
  name: string
  skillPath: string
  description?: string
  folderSha?: string
  localState: 'installed' | 'disabled' | 'missing' | 'not-installed' | 'removed-upstream'
  selected: boolean
  updateAvailable: boolean
}

export interface RepoCatalog {
  groupKey: string
  source: string
  ref?: string
  resolvedRef: string
  commitSha?: string
  total: number
  entries: RepoCatalogEntry[]
  fetchedAt: string
  stale?: boolean
}

export interface UpdatePlan {
  id: string
  /** update = 只更已选中；selection = 仓库面板改选；preset = 应用预设 */
  kind: 'update' | 'selection' | 'preset'
  scopeId: string
  groupKey: string
  createdAt: string
  resolvedRef: string
  commitSha?: string
  items: PlanItem[]
  summary: Record<PlanAction, number>
}

/** 仓库技能面板的一次「改选」：只传技能名，路径与内容由后端按来源解析 */
export interface SelectionPlanRequest {
  scopeId: string
  groupKey: string
  selectedNames: string[]
  /** 取消勾选已安装技能时，是否保留回收站副本（默认 true） */
  keepBackup?: boolean
}
```

### 6.6 项目与设置

```ts
interface ProjectRecord {
  id: string            // sha256(realpath).slice(0, 12)
  name: string
  path: string          // realpath，统一分隔符
  addedAt: string
  lastScanAt?: string
  enabled: boolean
}

interface SkillManagerSettings {
  defaultUpdatePolicy: 'safe' | 'sync'      // safe = 只更新已选中；sync = 同时拉新增（默认关）
  autoCheckIntervalHours: number            // 默认 24；0 = 只在手动触发
  removePolicy: 'trash' | 'keep'            // 默认 trash
  trashRetentionDays: number                // 默认 30
  networkTimeoutMs: number                  // 默认 15_000
  githubTokenSource: 'env' | 'stored' | 'none'
  disabledStore: 'app-data' | 'scope'       // 见 §10.1
  respectGitignore: boolean                 // 项目禁用目录提示
}
```

---

## 7. 扫描与状态判定

### 7.1 扫描

对每个 scope：

1. `readdir(skillsDir, { withFileTypes: true })`，跳过 `.DS_Store`、`.` 开头、`node_modules`。
2. 对每个条目 `lstat`：
   - 普通目录 → `installMode: 'copy'`，检查 `SKILL.md`。
   - symlink 目录 → `installMode: 'symlink'`，`readlink` 记录目标；目标不存在 → `invalid`（断链）。
   - 文件 → 忽略（并记录一条诊断，避免 `.DS_Store` 噪音）。
3. 解析 `SKILL.md` 的 frontmatter：`name`、`description`、`metadata.version`，只读前 8KB；失败 → `invalid`，但保留目录。
4. 与锁记录、registry 记录对账（见 7.2）。
5. 只在需要时计算完整目录 hash（更新/校验/收藏快照），扫描阶段用 `mtime + size` 缓存跳过。

### 7.2 对账

```text
磁盘目录集合 D
锁条目集合 L
registry 记录集合 R
选择集 S（selectedNames；旧数据按 R ∪ L 补齐，排除 state=removed 墓碑）
禁用区记录集合 X

D ∩ (S ∪ L) → 正常实例（再比对 baseline / 远端）
D - S - L   → orphan（未托管）或 adopted（R 有记录但锁/选择集没有）
(S ∪ L) - D - X → missing（可能是用户删了，也可能是被禁用但索引丢了）
X - D       → disabled（正常）
D ∩ X       → disabled-drift（被外部恢复）
```

**选择集修复**：扫描时若 `L` 有、`S` 没有，说明锁被外部工具改了，按锁把该技能补进 `S`（并记一条诊断）；若 `S` 有、`L` 没有：
- global 且记录标 `disabled` → 正常（禁用时删了锁条目）。
- 其它情况 → 提示「选择集与锁不一致」，提供「修复锁 / 修复选择集」，不静默删除。

**墓碑对账**：`R` 包含 `state: 'removed'` 的墓碑，但墓碑不进入 `S`。

- 若上次记录为 `installed`，当前 `L` 无、`D` 无、`X` 无 → 标 `removed-external`，保留 origin 与 `lastKnownBaseline`。
- 墓碑只出现在「已移除」视图；可「重新安装」「查看来源」「遗忘」，不参与更新计划。
- 若 `R` 无记录、但 preset/favorite 有同 OriginKey → 显示「可重装」，不声称「曾经装过」。
- 只有从未被扫描/安装/收藏过的技能，才没有任何本地痕迹；这种情况只能靠项目锁的 git 历史或用户提供来源。

**首次接管的基线重建**：

- 若 `R` 无记录，且 `L` 有记录：
  - 用**当前磁盘内容**计算 `baseline.contentHash`，`source: 'adopt'`。
  - 锁里的 `computedHash` 只作为 `lockHash` 留存展示；**不**因为不一致就报 `modified`。
  - UI 提示：「锁中的哈希与当前内容不一致，已按当前内容建立基线。可一键修复锁哈希。」
- 这条规则直接消化本仓库 27/34 的哈希不一致，避免首屏 27 条红色误报。

### 7.3 状态矩阵

| 状态 | 判定 | 默认动作 | 危险度 |
| --- | --- | --- | --- |
| `ok` | 目录存在 + selected/锁/registry 有记录 + 内容匹配基线 + 远端存在 | 无 | — |
| `update-available` | 远端 folder SHA ≠ 记录值 | 更新 | 低 |
| `modified` | 本地 hash ≠ baseline | 预览差异；覆盖需确认 | 中 |
| `missing` | selected 有记录，目录不存在，且不在禁用区 | 重新安装 / 从选择集移除 | 中 |
| `orphan` | 目录有 `SKILL.md`，selected/锁/registry 都没有 | 只读；接管 / 收藏 / 删除 | 低 |
| `invalid` | 断链 / 无 `SKILL.md` / frontmatter 解析失败 | 修复 / 删除（仅链接） | 中 |
| `removed-upstream` | selected 记录存在，远端快照无此路径，且仓库可访问 | 移到回收站 + 移除锁 | 高 |
| `removed-external` | 锁/目录都没了，但 registry 有旧记录（墓碑） | 显示在「已移除」；重新安装 / 遗忘 | — |
| `moved` | 远端同名技能唯一，但 `skillPath` 变了 | 迁移 + 更新锁 | 中 |
| `disabled` | 在禁用区，且目录不在扫描根 | 启用 / 卸载 | — |
| `linked` | 目录是 symlink 且无锁记录（本地技能包） | 只读展示；可禁用（删链接） | 中 |
| `legacy` | 锁记录缺 `skillPath` | 重新安装以补全 | 低 |
| `shadowed` | 同 scope 内与另一来源同名；或项目覆盖全局 | 提示，不自动处理 | — |
| `unknown` | 仓库 404/403/超时/tree 截断 | 不判失效，稍后重试 | — |

**硬规则**：

- 网络错误、GitHub 403/429、tree `truncated` → **绝不**进入 `removed-upstream`。
- 同名多路径（monorepo 常见）→ 若无法用 `skillPath` 唯一确定，标 `ambiguous`，不删不移。
- 仓库整体 404 → 组级状态 `source-gone`，逐技能保留，提供「重新绑定来源 / 移除」。
- 断链的删除只 `unlink` 链接，不碰目标。

### 7.4 首次运行的降噪

本机现状是「锁只记得 3 个、磁盘有 31 个」，首屏必然出现大量 `orphan`。这不是用户做错了，不能红屏警告：

- 全局首次扫描只出**摘要条**：「2 个已托管 · 29 个未托管（多为链接）· 1 个断链 · 1 条锁记录目录缺失」。
- 项目首次扫描：「34 条锁 · 38 个目录 · 4 个未入锁 · 0 个缺失」。
- `orphan` 默认折叠进「未托管」筛选，用 neutral 色；只有 `invalid`（断链/无 SKILL.md）用 warning。
- 提供批量动作：「批量收藏」「批量忽略」「查看链接目标」。
- 对 symlink 的 orphan，明确显示「链接到 `~/work/skills-pack/skills/…`，由外部管理」，避免用户以为要重装。
- 引导只做一次：解释「未托管 = 来源未知，默认只读；可预览/收藏/删除/接管，接管并绑定来源后才能更新」。

### 7.5 未托管技能与接管（Adopt）

用户在项目里手工复制/新建了 `SKILL.md` 目录，但 `skills-lock.json` 没有对应条目——扫描时是 `orphan`。默认**只读、不可维护**，避免我们猜错来源后自动写锁或自动更新。

| 动作 | `orphan` 默认 | 接管后 |
| --- | --- | --- |
| 预览 `SKILL.md` / 文件树 | ✅ | ✅ |
| 收藏 / 分类 | ✅ | ✅ |
| 删除到回收站 | ✅ | ✅ |
| 禁用 / 启用 | ❌ | ✅ |
| 更新检查 / 应用 | ❌ | ✅（绑定来源后） |
| 写 `skills-lock.json` | ❌ | ✅（仅绑定来源） |
| 加入 `selectedNames` | ❌ | ✅ |
| 加入预设 | ❌（来源未确认） | ✅（绑定来源后） |

#### 两种接管方式

1. **绑定来源接管（推荐）**
   - 用户填 `owner/repo`、GitHub/TFS URL 或选本地来源，并确认 `skillPath`；
   - 校验远端确实存在该技能；不按名字自动猜仓库；
   - 写项目锁（`sourceType/source/sourceUrl/ref/skillPath/computedHash`）、registry baseline、`selectedNames`；
   - 状态转为 `ok`，之后可正常更新、禁用、卸载、进预设。

2. **本地接管（无远端）**
   - 只把目录纳入 registry（`sourceType: 'local'`，`lockManaged: false`），记录当前 hash；
   - **不写项目锁**（避免写入一个指向自身的 local source，CLI 会循环）；
   - 加入 `selectedNames`，但更新计划会因 `lockManaged: false` 跳过远端对比；
   - 可禁用/删除/收藏，但「更新」只做本地 hash 校验，不拉远端；
   - UI 明确写「本地接管：不参与远端更新；以后可再绑定来源」。

#### 交互与边界

- 未托管组默认折叠，用 neutral 色；不逐条红色报警（见 §7.4）。
- 行操作只给「接管 / 收藏 / 删除」；接管打开 `AdoptDialog`，不是一键静默写锁。
- 接管失败（来源不存在、`skillPath` 不符、项目锁 invalid）→ 不写任何文件，保留 `orphan`。
- 接管成功写 history `kind: 'adopt'`；批量接管 P2 再做，首版逐个确认。
- 如果目录是 symlink：接管记录 `installMode: 'symlink'` + `linkTarget`；删除只 `unlink`。
- 手工新增的技能若已有 frontmatter `metadata.source`，可作为来源**预填**，但仍需用户确认。

---

## 8. 安装

### 8.1 支持的来源（首版）

| 形式 | 示例 | 备注 |
| --- | --- | --- |
| GitHub 简写 | `mattpocock/skills` | 默认分支；支持 `@skill` 过滤、`#ref` 指定分支/tag |
| GitHub URL | `https://github.com/owner/repo` | 归一化为 `owner/repo` |
| 本地目录 | `~/work/skills-pack` | 复制或软链；`sourceType: 'local'` |
| 通用 git | `https://gitlab.com/…/repo.git` | 需要 git 可用；无 API 也能装/更 |
| Azure / TFS Git | `http://tfs.example.internal:8080/tfs/Collection/Project/_git/example-skill` | 识别 `/_git/`；走通用 git；根目录可直接是技能（§8.6） |
| `node_modules` | 由依赖提供 | 只读展示，不安装 |

私有仓库认证：GitHub 用 API token（`GITHUB_TOKEN` / `GH_TOKEN` 或应用内加密）；TFS/Azure 用 **PAT**，按 host 保存。token 只经请求头 / `GIT_ASKPASS` 注入，不拼 URL、不写日志。`http://` 下的 PAT 是明文传输，按 §8.6 警告。

### 8.2 流程

```text
输入源 → 归一化 (owner/repo, ref, subpath)
      → 拉取仓库元信息（默认分支 / 私有 / archived）
      → 拉取 tree 或 tarball → 发现技能（SKILL.md 路径 + name/description）
      → 仓库技能面板：搜索 / 多选（默认不勾选；已安装的自动勾上）
      → 选择目标（global / 某个项目）+ 安装方式（copy / symlink）
      → 冲突检查（目标同名目录、同名不同源、项目锁 invalid）
      → staging 安装（只下载勾选的）→ 校验 → 写锁 → 写 registry → 记 history
```

- 仓库有 24 个技能、只勾 1 个，就只下载/安装 1 个；其余不进入 staging。
- 同一仓库再次安装时复用 §9.8 的面板：已安装自动勾选，新增勾选 = 安装，取消勾选 = 卸载（移到回收站），一次确认合并执行。
- `owner/repo@skill` 可预勾选指定技能，跳过手动找；`#ref` 固定分支/tag。
- 通用 git 没有 API：默认分支用 `git ls-remote --symref <url> HEAD` 解析；`archived` 等 GitHub 专属字段留空，不阻塞安装。

### 8.3 目标与路径

- global：`~/.agents/skills/<name>`（Windows 为 `%USERPROFILE%\.agents\skills`）。
- project：`<project>/.agents/skills/<name>`。
- 安装方式默认 **copy**（跨平台稳定、可回滚）；symlink 作为高级选项，Windows 无权限时自动回退 copy 并提示。
- 目录名 = 技能安装名（frontmatter `name`，缺省用目录名），并做 sanitize（去 `..`、路径分隔符、保留字）。
- 项目锁不存在时：安装会创建 `skills-lock.json`（v1），并在 UI 明确「将新建锁文件」。
- **本地来源写锁**：`sourceType: 'local'` 的 `source` 按 CLI 规则写成相对项目的可移植路径（`./skills-pack`、`../shared-skills`）；跨盘无法表示时才写绝对路径。读取时相对路径按项目根解析，避免换机器后失效。
- **根目录技能**：源目录 = 仓库根，复制时排除 `.git/`、`node_modules/`、`.skill-manager-*`；`assets/`、`references/`、`scripts/` 等一并复制，不能只复制 `SKILL.md`。

### 8.4 冲突处理

| 冲突 | 处理 |
| --- | --- |
| 目标已有同名目录，来源相同 | 视为更新，走 §9 |
| 目标已有同名目录，来源不同 | 阻止；提供「先卸载/改名」；不自动覆盖 |
| 同一批次内两个技能同名 | 阻止，要求只选一个 |
| 目标路径被 symlink 指向外部 | 不写入；提示「由外部管理」 |
| 锁文件损坏 | 只读；阻止写入，给出修复指引 |

### 8.5 事务顺序

1. 下载/解压到 `cache/staging/<opId>/`，校验每个技能有 `SKILL.md`。
2. 计算 staging 内容 hash。
3. 目标已存在 → 旧目录移到 `assets/trash/<opId>/`。
4. 复制 staging → 目标根下的临时目录 `.skill-manager-tmp-<id>`。
5. `rename` 到最终目录（同盘原子）。
6. 重新计算最终目录 hash（CLI 算法）→ 写锁。
7. 写 registry（baseline = 最终 hash）。
8. 写 history；清理 staging。

任何一步失败：按 §9.6 的回滚矩阵处理。

### 8.6 通用 Git 源（TFS / Azure Repos / 自建 GitLab）

不是所有仓库都有 GitHub API。公司内网 TFS 2018 这类源只能走 git 传输；判定依据是 URL 里的 `/_git/<repo>`，不是 host 名。

#### URL 归一化

```text
输入：http://tfs.example.internal:8080/tfs/Collection/Project/_git/example-skill
识别：/_git/ 标记；repo = example-skill
clone URL：http://tfs.example.internal:8080/tfs/Collection/Project/_git/example-skill
可选：?path=<subpath> 指到子目录；?version=GBmain / GTv1 指分支或 tag；#ref 也可
落库：sourceType='git'；source 与 sourceUrl 都写 clone URL；ref 可选
skillPath：仓库相对路径，根目录技能写 'SKILL.md'
```

#### 布局识别（关键）

1. **根目录有 `SKILL.md`** → 整个仓库就是一个技能：`skillPath = "SKILL.md"`，子目录全部视为 `assets/`、`references/`、`scripts/`，**不再发现子技能**。
2. 根目录没有 → 先找 `skills/`、`.agents/skills` 等常见容器（深度 ≤3），再全树递归（深度 ≤5，跳过 `.git`、`node_modules`、`dist`、`build`）。
3. 路径统一 `\` → `/`，每个技能路径以 `SKILL.md` 结尾；同名多路径标 `ambiguous`，不自动选。

这与 `npx skills` 的发现规则一致：根 `SKILL.md` 命中后直接按单技能返回，不再向下扫；`skillPath` 也正好是 `"SKILL.md"`。

#### 无 API 怎么更新

- `git ls-remote` 解析 ref / commit；浅克隆到 `cache/git/<hash>`（`--depth 1`，必要时 `--branch`）。
- folder SHA 不靠 API：对技能**目录**执行 `git rev-parse HEAD:<skillDir>`（根技能用 `HEAD^{tree}`）。注意不是 `HEAD:<skillPath>`——那得到的是 `SKILL.md` 的 blob SHA。git tree SHA 与 GitHub Trees API 的 folder SHA 同源，所以 §9.2 的 diff 逻辑不用分叉。
- 扫描克隆目录得到全部 `SKILL.md`，做与 §9.2 相同的对比；仓库里没了的技能照样判 `removed-upstream`。
- 大仓库可选 sparse-checkout（P3）；首版浅克隆整仓，但只复制选中的技能目录到目标。

#### 认证

- 首选 **PAT**：按 host 保存到 `secret-box`，通过 `GIT_ASKPASS` 或一次性 credential helper 注入；**不拼进 URL、不写日志、不进 argv**。
- 也兼容本机已有 git 凭据（SSH key / credential helper），但首版 TFS 先按 token 做；复用 git 凭据作为 P3 增强。
- `GIT_TERMINAL_PROMPT=0`，避免后台检查卡在交互；认证失败明确提示「需要 token / 无权访问」，**不判仓库删除**。
- **HTTP 警告**：`http://` 下 PAT 明文传输；UI 标「内网 HTTP，token 可能被嗅探」，优先建议 HTTPS。只能 HTTP 时，token 用只读、最小权限。
- 关闭 LFS 自动下载（`GIT_LFS_SKIP_SMUDGE=1`），避免未装 git-lfs 时 checkout 失败。

#### 项目锁写法（与 CLI 兼容）

```jsonc
{
  "example-skill": {
    "source": "http://tfs.example.internal:8080/tfs/Collection/Project/_git/example-skill",
    "sourceUrl": "http://tfs.example.internal:8080/tfs/Collection/Project/_git/example-skill",
    "sourceType": "git",
    "skillPath": "SKILL.md",
    "computedHash": "…"
  }
}
```

`sourceType: 'git'` 与 `sourceUrl` 是 CLI 认的字段（`getProjectLockSourceUrl` 对 git/gitlab 写 `sourceUrl`）；根技能 `skillPath: 'SKILL.md'` 也与 CLI 的 `getSkillRepoPaths` 一致。

### 8.7 预设安装与恢复

预设是一份**期望清单**；应用预设 = 逐项解析来源 → 生成计划（安装 / 更新 / 移除 / 不可用）→ 复用 §9.4 的事务执行器。它不依赖目标现有的 `skills-lock.json`，所以锁和目录都丢了也能重装。

#### 目标

| `target.kind` | 落点 | 锁 |
| --- | --- | --- |
| `global` | `~/.agents/skills` | 全局锁 v3 |
| `project` | `<project>/.agents/skills` | 项目锁 v1（已登记项目） |
| `custom` | `<path>/.agents/skills`（默认） | 成功后登记为项目才写项目锁（无锁则创建 v1）；`asSkillsRoot: true` 时直接把 `<path>` 当技能根，不写锁 |

- `custom.path` 必须 `realpath` 后校验：存在、是目录、不是 `/`、home 根、应用数据根或系统目录；不允许 `..`。
- `custom` 首次应用会创建 `<path>/.agents/skills`，UI 明确「将新建目录」。
- 如果用户选中的目录本身就叫 `.agents/skills`，或包含 `SKILL.md`，提示「这看起来是技能根目录」，提供「作为技能根目录（不写锁）」高级选项。
- 目标已有同名不同源技能 → 阻止该项，不静默覆盖。

#### 应用流程

```text
1. 读取 preset，按 OriginKey 去重；enabled=false 的项跳过。
2. 按 (source, ref) 分组，每组只拉一次远端快照（GitHub tree / 通用 git 浅克隆）。
3. 逐项解析：来源可用？skillPath 存在？根技能？目标已有？
   → install / update / skip / conflict / unavailable
4. 扫描目标，exact 模式计算 extras = 目标已选 - 预设项。
5. 预览：将安装 / 更新 / 移除 / 不可用；默认勾选可用项，exact 移除需二次确认。
6. 应用：§9.4 事务；成功项写锁（若目标有锁）+ registry baseline + selectedNames。
7. custom 且 registerProject=true：成功后登记项目；失败不登记。
8. 写 history（kind: 'preset-apply'），preset.lastAppliedAt/lastApplyTarget。
```

#### 两种模式

- **additive（默认）**：装缺失、更新已有、保留目标里多出来的技能；适合「往项目里补一套基线」。
- **exact（显式）**：目标最终必须等于预设；多出来的技能移到回收站并从锁移除。必须二次确认，文案写清「将移除 N 个不在预设里的技能」。
- 两种模式都不删除预设之外、但被用户标记为 `forked`/本地托管的技能；exact 也要跳过并提示。

#### 不可用项

- 来源 404/403/auth 失败 → `unavailable`，不判整个预设失败；其它项继续。
- `skillPath` 在远端不存在 → `source-gone`，列出「上游已删除」。
- 本地来源路径不存在 → `unavailable`，提示「本地来源已移动」。
- 同名不同源 → `conflict`，不自动选。
- 部分成功：成功项保留，history 标 `partial`，可重试失败项。

#### 与墓碑、锁、收藏的边界

- **墓碑是单个技能的“曾经装过”记录**；预设是用户主动维护的“我想要哪些”。墓碑可以一键「加入预设」。
- 应用预设写目标锁，保证 `npx skills` 能看到；预设本身不写锁。
- 收藏与预设互不依赖：收藏可来自未安装技能，预设也可包含未收藏技能。
- 恢复单个丢失技能：直接用墓碑的 origin 跑 §9.5，不必先建预设。

---

## 9. 更新与失效清理（核心）

### 9.1 检查更新

输入：scope + 仓库组（或全部）。

```text
1. 解析 ref：记录里的 ref，否则仓库默认分支；记录 resolvedRef + commitSha。
2. 拉远端快照：
   a. GitHub：GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1
      → 所有 blob path + 目录 tree SHA；truncated 则改用 tarball。
   b. 通用 git（TFS/Azure/自建，无 API）：git ls-remote + 浅克隆到 cache，
      扫描 SKILL.md；folder SHA 用 git rev-parse HEAD:<skillDir>（根技能 HEAD^{tree}，见 §8.6）。
   c. GitHub tree 失败 → 回退 codeload tarball；仍失败 → 组状态 unreachable，不产出删除项。
3. 建立远端目录：Map<skillPath, {name, folderSha}>，同时保留按 name 的唯一索引。
4. 取 tracked 集合 = `selectedNames` ∪ 锁条目 ∪ registry 记录（去掉 forked / 明确不跟踪的 / `state: removed` 墓碑 / `lockManaged: false` 的本地接管）。
5. 逐技能判定（见 9.2）。
6. 计算新增集合 = 远端 - tracked（只展示，不下载、不默认安装）。
7. 写 plan（不落盘到项目；registry 只存 `lastPlanId` + 摘要，完整计划在内存/历史里，重开页面可重新检查）。
```

> **只更新选中的**：`tracked` 来自 `selectedNames`，不是「远端全部技能」。仓库里另外 9 个没选的技能既不会出现在 update 计划里，也不会被下载；它们只出现在「可安装」提示中，要装必须走 §9.8 的仓库技能面板。

**缓存**：GitHub tree 响应按 `(source, ref)` 缓存 5 分钟，ETag 复用；通用 git 按 `(source, ref, commit)` 缓存浅克隆，复用前先 `git ls-remote` 校验 commit；离线时用上次快照并标 `stale`。

**触发时机**：进入技能库/更新页、窗口重新聚焦、手动点「检查」时触发；距 `lastCheckedAt` 超过 `autoCheckIntervalHours`（默认 24h）才真正发请求，后台静默执行，失败只更新组状态、不弹窗。这样「上游删了技能」不需要用户先想到去点检查。

### 9.2 差异判定规则

```text
for each tracked skill S:
  localExists = 目录存在（或禁用区存在）
  remote = byPath(S.skillPath) ?? uniqueByName(S.name)

  if remote == null:
      if treeTruncated or unreachable: 'unknown'
      else if repoMissing: 'source-gone'
      else: 'removed-upstream'
  else:
      if remote.path != S.skillPath: 'moved'
      else if remote.folderSha != S.remote.folderSha: 'update-available'
      else: 'ok'

  if localExists && contentHash != baseline: mark 'modified'（不覆盖动作，需显式确认）
  if !localExists && !disabled: 'missing'（可选重装）
  if localExists && baseline 不存在: 'adopt'（重建基线）
```

**同名多路径**：如果 `byPath` 找不到，且 `uniqueByName` 命中 0 个 → `removed`；命中 1 个 → `moved`；命中 ≥2 个 → `ambiguous`，不删不移，提示用户手动指定。

**根目录技能**：`skillPath = "SKILL.md"` 时只按根路径匹配；根 `SKILL.md` 不存在 → `removed-upstream`，不会因为子目录里有同名技能就误判为 `moved`。子目录里的 `SKILL.md` 在「根即技能」布局下是 assets，不参与发现。

**为什么不能只看 `lastFetchedNames`**：

- 上游可能「删了 A、加了 B」，只比集合会同时得到 `A removed` 与 `B added`，但 B 可能只是改名。
- 路径 + tree SHA 能区分「改名/移动」与「真的删除」。
- `lastFetchedNames` 用于**审计与提示**（「上次 12 个，这次 10 个」），不直接驱动删除。

### 9.3 更新计划（Plan）

```jsonc
{
  "id": "plan_01",
  "kind": "update",
  "scopeId": "project:ab12cd",
  "groupKey": "project:ab12cd|github:mattpocock/skills",
  "resolvedRef": "main",
  "commitSha": "…",
  "items": [
    { "name": "grilling", "action": "update", "fromFolderSha": "ef16…", "toFolderSha": "9a21…", "selectedByDefault": true, "reasons": ["upstream-changed"] },
    { "name": "wizard", "action": "remove", "selectedByDefault": true, "reasons": ["not-in-remote-tree"] },
    { "name": "tdd", "action": "conflict", "localModified": true, "selectedByDefault": false, "reasons": ["local-edited"] }
  ],
  "summary": { "update": 1, "install": 0, "remove": 1, "conflict": 1, "add": 0, "move": 0, "reinstall": 0, "skip": 0 }
}
```

默认勾选策略（`safe`，默认）：

- `update`：勾选（未本地修改）。
- `move`：勾选（保留收藏）。
- `remove`：勾选，但动作是「移到回收站」；UI 明确写「可恢复」。
- `add`：**不勾选，也不在 update 计划里执行**；只作为「该仓库还有 N 个未安装」的提示，点击跳转仓库技能面板（§9.8）。
- `install`：仅出现在 selection plan（面板改选），勾选的新技能执行安装。
- `conflict`（本地修改）：不勾选，三选一：覆盖（先备份）/ 保留本地并停止跟踪 / 查看差异。
- `reinstall`（missing）：勾选。
- `ambiguous` / `unknown`：不勾选，不提供批量动作。

策略 `sync`（显式开启，默认关）：`add` 也默认勾选，并在组设置里可切换；即使开启，也只影响当前仓库组，不会波及其它组。策略 `pin`：只允许手动更新，检查仍可用。

### 9.4 应用更新（事务）

```text
0. 校验 plan 仍然有效（锁指纹 + 远端 commit 未变；变了就重算）。
1. 下载 tarball → staging；解压时做路径穿越 / 大小 / 条目数防护。
2. 逐项校验：SKILL.md 存在、frontmatter 可解析、name 与计划一致。
3. 对每个选中项：
   - remove：目录/链接 → trash；锁删除；registry 标 deleted。
   - update/move：旧目录 → trash；临时目录 → rename 到目标；重算 hash。
   - 本地修改且用户选了「覆盖」：旧目录先完整备份，再替换。
4. 统一写锁（项目/全局），写 registry，写 history。
5. 失败项保留原状，成功项不回滚（除非用户点「撤销本次」）。
```

**崩溃恢复**：

- 启动时扫描 `staging/` 与目标根下的 `.skill-manager-tmp-*`，超 24h 的清理。
- 对每个 scope 做一次轻量对账：目录存在但锁缺失 → `orphan`；锁存在但目录缺失 → `missing`。
- trash manifest 里记录「替换前状态」，可据此恢复。

### 9.5 失效清理与恢复的安全网

1. **永远进回收站**，不直接 `rm -rf`；manifest 记录来源、hash、删除原因。
2. 回收站默认保留 30 天 / 200MB，可在设置调整；清空需二次确认。
3. 删除前检查目录是否为 symlink：只 `unlink`，目标目录不动。
4. 若目录里有未跟踪文件（相对 baseline 新增），标 `modified`，不默认删。
5. 删除项目技能会改 `skills-lock.json`：UI 明确「将修改项目锁文件」，并在历史里保留旧锁快照。
6. 支持「保留本地，停止跟踪」（fork）：移出 `selectedNames`、保留目录与收藏，标为本地/已修改；以后不再报「上游已删除」，也不会被自动更新。
7. **删除必留墓碑**：registry 写 `state: 'removed'` + origin + removedAt + trashRef；回收站被清空也不删墓碑的 origin，仍可重新下载。
8. **重新安装**：墓碑行提供「重新安装」；优先从 trash 恢复（本地修改也保留），否则按 origin 走 §8 / §9.4 重新拉取。来源不可用则提示「重新绑定来源」。
9. **批量恢复**：可把多个墓碑「加入预设」，再对目标一键应用；不需要逐条点。

> 墓碑是元数据，不是第二份技能文件；它只解决「知道从哪来」，不保证「来源还活着」。来源 404 时只能改绑，不能凭空恢复。

### 9.6 失败与回滚矩阵

| 失败点 | 结果 | 恢复 |
| --- | --- | --- |
| 下载/解压 | 无改动 | 清理 staging，报错 |
| 校验 | 无改动 | 清理 staging，列出不合格技能 |
| 备份旧目录 | 中止该项 | 不进入替换 |
| 复制临时目录 | 清理 tmp，旧目录仍在 | 可重试 |
| rename | 从 trash 恢复旧目录 | 该项失败，其余继续 |
| 写锁 | 内容已替换、锁未更新 | 历史标 `partial`；下次扫描可「修复锁」；提供「回滚本次」 |
| 写 registry | 内容与锁已更新、registry 旧 | 下次扫描按锁重建记录（锁优先） |
| 进程崩溃 | 可能留下 tmp/trash | 启动对账 + 修复入口 |

**回滚**：`history` 条目保存 `trashDir` 与写锁前快照；「撤销本次更新」= 恢复旧目录 + 恢复旧锁 + 删 registry 新记录。若目标目录在更新后又被改过，拒绝回滚并提示。

### 9.7 一次完整场景（对应用户诉求）

```text
T0 安装 mattpocock/skills 的 12 个技能
   registry.selectedNames    = 12
   registry.installedNames   = 12
   registry.lastFetchedNames = 12
   lock 12 条

T1 上游删掉 2 个、改了 1 个技能
   （本地什么都没动）

T2 检查更新
   远端快照 = 10 个
   diff: update 1 / remove 2 / unchanged 9
   registry.lastFetchedNames = 10        ← 只更新「远端可见」
   registry.installedNames   = 12        ← 仍代表「装过什么」，不提前改
   registry.selectedNames    = 12        ← 成员关系不变

T3 预览
   ☑ 1 个更新
   ☑ 2 个失效 → 移到回收站 + 从锁移除
   （如果某个失效技能本地被改过 → 默认不勾选，先让用户决定）

T4 应用
   旧目录 → trash/<opId>/；新内容原子替换；锁 10 条；
   registry.selectedNames = 10；registry.installedNames = 10
   history 记录 op，toast 提供「撤销本次」

T5 用户只检查、没应用
   技能库继续显示 12 个，其中 2 个标 removed-upstream；
   组头显示「上次拉取 12 → 本次 10」，并保留「更新此仓库」入口

T6 撤销
   从 trash 恢复 2 个目录 + 恢复旧锁 12 条，registry 回到 T0 状态
```

这个场景里几个集合各司其职：

- `selectedNames`：我**选中**的技能（决定更新范围与成员关系）。
- `installedNames`：我**实际拥有**的技能（决定磁盘与锁）。
- `lastFetchedNames`：上游**提供过**的技能（决定「减少了什么」）。
- 本地基线：用户**改没改**（决定能不能直接覆盖）。

如果 T0 只装了 `grilling` 一个：

```text
selectedNames   = ["grilling"]
installedNames  = ["grilling"]
lastFetchedNames = 24 个（远端全部可见）

T2 检查更新时只遍历 grilling：
   其它 23 个只出现在「可安装」列表，不下载、不安装、不产生 plan item
T3 若上游改了 tdd、删了 wizard：
   对 grilling 无影响，也不报 tdd/wizard——因为它们从未被选中
```

这就是「只装一个就只更一个」在数据模型上的保证：**更新遍历 `selectedNames`，不是远端全集**。

### 9.8 仓库技能面板（选择性安装 / 更新）

用户场景：`mattpocock/skills` 有 24 个技能，我只装了 `grilling`。更新时不能把另外 23 个下载下来，也不能因为它们「新」就自动安装；反过来，我想加装 `tdd` 时，必须能在一个面板里看到全部技能、看到哪些已装、改完勾选一次确认。

#### 入口

- **安装流程第二步**：选完仓库后列出全部技能，默认不勾选；`owner/repo@skill` 语法可预勾选。
- **已安装仓库组的「管理技能」**：列表 = **远端技能 ∪ 该组已选中但远端已消失的技能**（后者标 `removed-upstream`），保证失效项也能在同一面板里取消勾选/移除；默认勾选 `selectedNames`。
- **更新对话框**（§9.3）只管「已选中集合的本次更新」，不改变成员关系；要增/减成员必须走本面板。

#### 勾选语义

| 面板勾选变化 | 当前本地状态 | 确定后的动作 |
| --- | --- | --- |
| 未勾 → 勾 | 无 | 安装（按最新远端内容） |
| 勾 → 勾 | 已安装 | 有远端更新则更新，否则跳过 |
| 勾 → 勾 | 已禁用 | 保持禁用，不下载内容；只检查上游是否还在 |
| 勾 → 未勾 | 已安装 | 移到回收站 + 从锁与 `selectedNames` 移除 |
| 勾 → 未勾 | 已禁用 | 从禁用区移除 + 从 `selectedNames` 移除（默认保留回收站副本） |
| 未勾 → 未勾 | 无 | **永不动作**，即使上游有新版本 |
| 勾 → 勾 | `missing`（选中但没落盘） | 重装 |
| 勾 → 勾 | `removed-upstream` | 不能更新；提示「上游已删除」，只能移除或保留本地 |

> 一句话：**面板勾选 = 成员关系**；「更新」对话框勾选 = 本次执行范围。两者不要混成一个复选框，否则「取消勾选」到底是不更新还是卸载会永远解释不清。

#### 交互细节

- 工具栏：搜索、全选/全不选、仅看未安装、仅看已安装。
- 底部确认条实时汇总：`将安装 2 · 更新 1 · 移除 1 · 保持不变 22`；主按钮「应用更改」。
- 取消勾选「本地已修改」的技能时，额外确认：「本地修改会随目录进入回收站，可在回收站恢复」。
- 应用成功后写 `selectedNames`（只更新成功项），生成一条 history，支持「撤销本次」。
- 顶部显示来源 `owner/repo @ ref`、默认分支、上次检查时间、远端技能总数。
- 加载失败时保留面板骨架与上次快照，标 `stale`，禁用「应用更改」。

#### 与「更新此仓库」的分工

| 动作 | 作用集合 | 是否改成员 | 是否下载未选技能 |
| --- | --- | --- | --- |
| 更新此仓库 | `selectedNames` | 否 | 否 |
| 管理技能（面板） | 面板勾选结果 | 是 | 只下载新勾选的 |
| 安装新仓库 | 安装时勾选结果 | 是（新建组） | 只下载勾选的 |

两者共用 §9.4 的事务执行器，差别只在 plan 的 `kind`（`update` / `selection`）与动作集合。这样「只装一个就只更一个」是默认行为，不依赖用户每次记得取消勾选。

---

## 10. 禁用 / 启用

### 10.1 方案对比

| 方案 | 真禁用 | 跨 agent | 是否改锁 | 风险 |
| --- | --- | --- | --- | --- |
| A. 移到应用数据区（推荐） | ✅ | ✅ | 分 scope：global 删条目 / project 保留 | 项目 scope 会产生 git 删除 diff；project 侧 CLI update 可能复活 |
| B. 移到同 scope 的 `.agents/skills-disabled/` | ✅（不在扫描根） | ✅ | 否 | 可能被递归扫描器命中；需改 `.gitignore` |
| C. 改名为 `SKILL.md.disabled` | ⚠️ 多数扫描器不认 | ⚠️ | 否 | 改内容 hash；CLI 视为缺失并重装；目录仍占位 |
| D. marker 文件 | ❌ | ❌ | 否 | 只有我们认，agent 照读 |

**选 A**：只有「移出所有扫描根」是确定有效的。目录放 `<assets>/skill-manager/disabled/<scopeId>/<name>/`，旁边 `index.json` 记录来源、hash、禁用时间、链接目标。

### 10.2 状态机

```text
enabled --禁用--> disabled        （目录/链接移入禁用区；selectedNames 保留；global 删锁条目 / project 保留）
disabled --启用--> enabled        （检查冲突 → 移回 → global 重建锁条目 → 校验 hash）
enabled --卸载--> removed         （目录 → 回收站；锁条目删除；移出 selectedNames；registry 写墓碑）
disabled --卸载--> removed        （禁用区目录 → 回收站；锁条目删除；移出 selectedNames；registry 写墓碑）
```

> 禁用只改「是否加载」，不改「是否选中」；只有卸载才退出 `selectedNames`。所以重新启用不需要重新解析来源，收藏也不会丢。

### 10.3 锁文件怎么处理（按 scope 区分）

**推荐的不对称策略**：

| scope | 禁用时 | 理由 |
| --- | --- | --- |
| global | **删除锁条目** | 全局锁是本机状态、不提交；删掉后 `npx skills update` 不会复活。来源保留在 registry，启用时重建条目 |
| project | **保留锁条目** | 项目锁是团队资产；删条目会随 git 同步删掉别人的技能。只在 registry 标 disabled，并接受「CLI update 可能复活」 |

- 好处：global 不怕 CLI 复活；project 保持可移植（其它机器 `experimental_install` 仍能装回）；启用时来源信息都在。
- project 的代价：`npx skills update` 会把「锁里有、目录没有」视为需要重装（CLI 源码里 `onDisk.has(name)` 为 false 就重装），可能把禁用项**复活**。
- 我们的应对：
  - 扫描时若发现「registry 标 disabled，但目录又出现了」→ 状态 `disabled-drift`，提示「已被外部工具恢复」，提供「重新禁用 / 接受启用」。
  - 设置项 `autoReDisable: boolean`（默认关）：开启后下次扫描自动移回禁用区。
- 若用户希望 project 也「绝不复活」，可在该项目的设置里切换为「禁用时删条目」（会写项目锁，UI 明确警告）。见 §22 Q2。

### 10.4 symlink 技能

- 禁用：`unlink` 链接（不移动目标），记录 `linkTarget`；不复制内容。
- 启用：重建 symlink；Windows 无权限时回退为 copy，并提示「已改为副本，原链接目标仍保留」。
- 断链：`unlink` 即可，视为清理，不进回收站（没有内容可恢复）。

### 10.5 项目 scope 的 git 影响

- 项目技能通常在 git 里。禁用后 `git status` 会显示删除（这是事实，不掩饰）。
- UI 在确认框里写明：「该项目目录受 git 管理，禁用会显示为删除；禁用状态只在本机生效。」
- 提供「在 `.gitignore` 忽略禁用区」的选项（仅当选择方案 B）；方案 A 不碰项目文件，但删除 diff 仍在。
- 不自动 commit、不自动 stash。

---

## 11. 收藏、预设与恢复

### 11.1 模型

- 收藏项以 `OriginKey` 为身份，跨 scope；不存「当前装在哪个 scope」的冗余状态（实时 join 扫描结果）。
- 未安装也能收藏：从仓库浏览列表点星标即可；安装后状态自动变为「已安装」。
- 技能被上游删除后，收藏保留，状态 `source-gone`；可「重新绑定来源」或删除收藏。
- 收藏是应用级数据，不随项目走；项目里看到的是同一份收藏。

### 11.2 分类

- 多分类标签（many-to-many），一个收藏可属于「开发规范」和「UI」。
- 内置示例分类（首次启动写入，可删可改）：开发规范、UI / 设计、文档与写作、测试与质量、运维与工具。
- 分类字段：`id`（slug，不可变）、`name`、`icon`（lucide）、`order`、`builtin`。
- 删除分类不删收藏，只从 `categories` 移除；收藏进入「未分类」。
- 分类排序：首版按 `order`，拖拽排序放 P2。

### 11.3 交互

- 每一行技能右侧星标：点一下收藏/取消；已收藏时 hover 出现「分类」。
- 分类选择用 Popover + 复选框 + 「新建分类」输入；确认后 toast「已收藏到 开发规范」+ 撤销。
- 收藏视图：左侧分类列表（全部 / 未分类 / 自定义），右侧卡片或表格；支持按安装状态筛选。
- 「安装到…」：split button，左侧默认上次目标，右侧菜单选 global / 项目。
- 收藏与技能库共用搜索；搜索匹配名称、描述、来源、备注。

### 11.4 持久化

- `favorites.json` 单独文件，避免 registry 写放大。
- 写入走 json-store（原子写）；分类与条目同文件，保证一致性。
- 不做云同步；导出/导入放 P3。

### 11.5 预设（Preset）

**定位**：收藏回答「我想要什么」，预设回答「我要把哪一组装到哪个目标」。预设不记录安装状态，也不替代锁。

- 创建来源：
  - 当前 scope 的已选技能；
  - 某个仓库组的已选技能；
  - 收藏的某个分类；
  - `skills-lock.json`（把现有项目变成可复用方案）；
  - 手工添加来源 / 粘贴 `owner/repo@skill` 列表。
- 预设项只存 `OriginKey + origin + installName`；不改技能内容，不存文件。
- 应用：
  - 目标 `global` / 已登记项目 / 自定义项目根；
  - `custom` 默认装到 `<path>/.agents/skills`，成功后登记项目（可取消）；
  - 默认 `additive`；`exact` 需二次确认并列出将移除项；
  - 先预览，再执行；不可用项单独列出，不阻塞其它项；
  - 成功后写目标锁、registry、history，更新 `lastAppliedAt`。
- 预设可以包含未安装、已禁用、已失效的技能；应用时按当前来源重新解析，而不是复用旧目录。
- 导入/导出 JSON；导入不自动应用。
- 导出的 JSON 可以提交到项目仓库或内部技能包，作为团队共享的“环境配方”；队友导入后自行选择目标应用，不隐式改锁。
- 预设是应用级数据，不随项目走；项目里看到的是同一份预设。

### 11.6 恢复路径（按优先级）

技能丢失时，按这个顺序找回来，避免“有备份却重新下载”：

1. **回收站**：`trashRef` 存在 → 直接恢复目录 + 锁 + registry（保留本地修改）。
2. **墓碑 + 远端**：无回收站副本，但 registry 有 origin → 按来源重装；TFS/私有库走对应 token。
3. **预设**：墓碑没有、但预设/收藏有 OriginKey → 按预设项安装；UI 标「可安装」，不声称「曾安装」。
4. **项目锁 git 历史**：项目锁被删但提交过 → `git log -p skills-lock.json` 找回条目，再按来源重装。
5. **都没有**：只能由用户重新提供来源；系统不假装能追踪。

- 墓碑默认永久保留，只有「遗忘」才删除；回收站清空不影响墓碑的 origin。
- 「遗忘」需二次确认，文案说明「只删除本地追踪记录，不删除远端仓库」。

---

## 12. 项目管理

### 12.1 登记

- 添加项目：选择目录 → `realpath` → 校验（存在、是目录、不是 home 根、不在应用数据目录内）→ 生成 id → 探测锁/技能目录。
- 项目去重按 realpath；同一项目经 symlink 添加两次会合并。
- 允许添加「还没有技能」的空项目（用于首次安装）。
- 「忘记项目」只删登记，不动磁盘文件；二次确认。

### 12.2 识别 `skills-lock.json`

- 位置：项目根目录。首版不做递归搜索（monorepo 由用户添加子包目录）；P2 可在添加时向下探测 ≤2 层、跳过 `node_modules`。
- 解析：
  - `version !== 1` → `unsupported`，只读，展示「CLI 版本不匹配」。
  - JSON 解析失败 / 含冲突标记 → `invalid`，只读，展示错误位置。
  - 缺 `skills` → `invalid`。
- 字段映射（解析安装源的关键）：

| 锁字段 | 内部字段 | 用途 |
| --- | --- | --- |
| `source` + `sourceType` | `origin.source` / `origin.sourceType` | 仓库分组键；`owner/repo`、git clone URL、本地相对路径、npm 包名 |
| `sourceUrl` | `origin.sourceUrl` | 实际拉取地址；`git`/`gitlab` 必填，否则不可更新 |
| `ref` | `origin.ref` | 固定分支/tag；缺省用默认分支。Azure `?version=GBmain` 归一化为 `main` |
| `skillPath` | `origin.skillPath` | **更新定位的主键**；根目录技能为 `SKILL.md`；缺它 → `legacy` |
| `computedHash` | `lockHash`（仅参考） | 不直接当 baseline；用于「修复锁哈希」对比 |
| `version` / `via` | `meta`（只读） | `node_modules` 来源的版本与请求方，不参与更新 |
| `installMode` / `subagents` | `installMode` / `targets` | 决定重装方式与安装到哪些 agent 目录 |

- **TFS / Azure Repos**：`source` 与 `sourceUrl` 都等于 clone URL（`…/_git/<repo>`），`sourceType: 'git'`，根目录技能 `skillPath: 'SKILL.md'`；写回格式见 §8.6。
- 无锁但有 `.agents/skills` → 允许扫描，状态为 `orphan`；安装时新建锁。
- 展示：锁版本、条目数、最后修改时间、与磁盘的差异数、是否被 git 跟踪（`git ls-files` 可选）。
- 写回时**只改动本次涉及的条目**；其它条目原样保留（包括未知字段），整体按技能名排序。

### 12.3 项目更新

- 按仓库组复用 §9 的检查/应用流程；遍历项目锁里的条目（即 `selectedNames`），**不碰**同仓库中未安装到该项目的技能。
- 项目更新只写项目锁，不碰全局锁。
- 批量更新：跨项目、跨仓库，串行执行，逐项报告；失败不阻塞其它组。
- 项目锁变更后提示「锁文件已更新，请 review 后提交」，不自动 commit。

### 12.4 外部变更

- 页面进入、窗口聚焦、手动刷新时重扫。
- 可选 `fs.watch(lockPath)`（debounce 500ms）→ 推 `EVENT_INVENTORY_CHANGED`，渲染层刷新。
- 检测到 CLI 写入：只重读，不覆盖；若正在编辑计划，标「计划已过期」。

---

## 13. 历史、回滚与回收站

### 13.1 历史

每次操作写一条：

```jsonc
{
  "id": "op_01",
  "kind": "update" | "selection" | "preset-apply" | "install" | "uninstall" | "adopt" | "bind-source" | "reinstall" | "disable" | "enable" | "restore" | "forget" | "repair-lock",
  "scopeId": "project:ab12cd",
  "groupKey": "…",
  "startedAt": "…",
  "finishedAt": "…",
  "status": "success" | "partial" | "failed",
  "counts": { "updated": 3, "removed": 1, "failed": 0 },
  "items": [{ "name": "wizard", "action": "remove", "ok": true }],
  "trashDir": "…",
  "lockBackup": "…",
  "error": null
}
```

- 保留最近 100 条（可配置）；超出裁剪最旧。
- 历史视图：按时间倒序，支持按项目/操作类型筛选；失败项可展开错误。

### 13.2 撤销

- 仅支持「最近一次」按组撤销（避免跨操作依赖）。
- 条件：目标目录自更新后未被再次修改（hash 对比）、锁指纹未变。
- 动作：恢复旧目录（从 trash）→ 恢复旧锁快照 → 回写 registry。
- 结果写一条 `kind: 'rollback'` 历史。

### 13.3 回收站

- 结构：`<assets>/skill-manager/trash/<opId>/<scopeId>/<name>/` + `manifest.json`。
- 列表显示：技能名、来源、删除原因、时间、大小、可恢复目标。
- 操作：恢复 / 永久删除 / 清空；恢复时目标已存在则阻止。
- 自动清理：默认 30 天，启动时执行；被自动清理的条目在历史里标记 `purged`。
- 自动清理只删回收站目录，**不删 registry 墓碑**；墓碑的 origin 仍可用于重新下载。

---

## 14. IPC 契约

命名空间：`window.skillManager`；通道前缀 `skill-manager:`；全部走 `safeHandle` / `safeOn`。

| 通道 | 入参 | 返回 | 说明 |
| --- | --- | --- | --- |
| `get-overview` | — | `Overview` | scope 列表、计数、问题数、最近检查时间 |
| `scan` | `{ scopeId? }` | `Inventory` | 重新扫描并返回分组 |
| `list-skills` | `{ scopeId?, groupKey?, state? }` | `RepoGroupView[]` | 技能库 |
| `read-skill` | `{ scopeId, name }` | `{ markdown, files }` | 预览 SKILL.md 与文件树 |
| `resolve-source` | `{ input, ref? }` | `SourceCatalog` | 安装前浏览（全部技能） |
| `repo-catalog` | `{ scopeId, groupKey }` | `RepoCatalog` | 已安装仓库的「管理技能」面板：全部远端技能 + 本地状态 + 已选标记 |
| `preview-selection` | `{ scopeId, groupKey, selectedNames }` | `UpdatePlan` | 改选后先看 diff（安装/更新/移除计数） |
| `apply-selection` | `{ planId, selectedNames, keepBackup? }` | `OperationResult` | 应用改选（事务） |
| `install` | `{ source, ref?, skills, target, mode }` | `OperationResult` | 安装 |
| `uninstall` | `{ scopeId, names, keepBackup }` | `OperationResult` | 卸载 |
| `check-updates` | `{ scopeId?, groupKey? }` | `UpdatePlan[]` | 检查 |
| `apply-update` | `{ planId, selections }` | `OperationResult` | 应用 |
| `set-enabled` | `{ scopeId, names, enabled }` | `OperationResult` | 禁用/启用 |
| `adopt-skill` | `AdoptRequest` | `OperationResult` | 接管 orphan；`source` 模式写锁，`local` 只登记 |
| `repair-lock` | `{ scopeId, names? }` | `OperationResult` | 修复锁哈希 |
| `projects-list` | — | `ProjectRecord[]` | 项目 |
| `projects-add` | `{ path }` | `ProjectRecord` | 添加 |
| `projects-remove` | `{ id }` | `void` | 仅「忘记」登记，不动磁盘 |
| `favorites-list` | — | `FavoritesState` | 收藏 + 分类 |
| `favorites-toggle` | `{ originKey, favorite }` | `FavoritesState` | 收藏 |
| `favorites-update` | `{ originKey, categories?, note? }` | `FavoritesState` | 分类/备注 |
| `categories-create` | `{ name, icon? }` | `Category` | 新建 |
| `categories-update` | `{ id, name?, icon?, order? }` | `Category` | 编辑 |
| `categories-delete` | `{ id }` | `FavoritesState` | 删除 |
| `presets-list` | — | `SkillPreset[]` | 预设列表 |
| `presets-save` | `{ preset }` | `SkillPreset` | 新建/更新预设 |
| `presets-delete` | `{ id }` | `void` | 删除预设（不卸载已装技能） |
| `presets-preview-apply` | `PresetApplyRequest` | `UpdatePlan` | 目标差异预览；不写盘 |
| `presets-apply` | `{ planId, selections? }` | `OperationResult` | 应用预设（事务） |
| `presets-export` | `{ id }` | `string` | 导出 JSON |
| `presets-import` | `{ json, overwrite? }` | `SkillPreset` | 导入（不自动应用） |
| `tombstones-list` | `{ scopeId? }` | `Tombstone[]` | 已移除记录 |
| `tombstones-reinstall` | `{ scopeId, name, target? }` | `OperationResult` | 按墓碑来源重装 |
| `tombstones-forget` | `{ scopeId, name }` | `void` | 只删本地追踪记录 |
| `history-list` | `{ limit? }` | `HistoryEntry[]` | 历史 |
| `history-rollback` | `{ id }` | `OperationResult` | 撤销 |
| `trash-list` | — | `TrashEntry[]` | 回收站 |
| `trash-restore` | `{ id }` | `OperationResult` | 恢复 |
| `trash-purge` | `{ ids? }` | `void` | 永久删除 |
| `open-path` | `{ scopeId, name? }` | `void` | 在文件管理器打开 |
| `event-progress` | — | `ProgressEvent` | 下载/安装/更新进度 |
| `event-inventory-changed` | — | `{ scopeId }` | 外部变更 |

约束：

- 渲染层只能传 `scopeId` / `name` / `originKey`，**不能传任意绝对路径**用于写操作；路径由 backend 从 registry 解析。
- 唯一例外：`presets-preview-apply` / `presets-apply` 可传 `custom.path`（用户明确指定目标目录）。backend 必须 `realpath` + 校验（存在、是目录、非 `/`/home 根/应用数据根/系统目录），且只能用于预设应用，不能绕过到单技能安装。
- 所有写通道返回统一的 `OperationResult { ok, changed, warnings, errors, historyId }`。
- 进度事件节流（≥100ms），避免刷爆渲染层。

---

## 15. UI 设计

### 15.1 信息架构

工具路由（`subRoutes`，路由驱动，不用本地 tab）：

```text
/tools/skill-manager/installed   技能库（默认）
/tools/skill-manager/updates     更新中心
/tools/skill-manager/favorites   收藏
/tools/skill-manager/presets     预设与恢复
/tools/skill-manager/projects    项目
/tools/skill-manager/settings    设置（右侧 inspector 或独立子路由）
```

静态预览：[skill-manager-preview.html](./skill-manager-preview.html)。只读样张，交互为演示；实现时按 §15.7 组件映射落到 `tools/skill-manager/renderer/`。

工具页 header：

- 左：图标 + 「技能管理」+ 一句「38 个技能 · 6 个仓库 · 4 项待处理」。
- 右：主按钮随视图变化（技能库 →「安装技能」；更新 →「检查全部更新」；收藏 →「新建分类」；预设 →「新建预设」；项目 →「添加项目」）+ 一个「更多」。
- 不把版本、路径、长说明放进 header。

### 15.2 骨架

采用 **处理控制台**（左 268px 作用域/仓库导航 + 右侧主表）：

```text
┌──────────────────────────────────────────────────────────────┐
│ header: 技能管理   38 个技能 · 4 项待处理      [安装技能] [更多] │
├──────────────┬───────────────────────────────────────────────┤
│ 全局  31     │ toolbar: [搜索] [状态筛选] [分组: 仓库]  [刷新] │
│  6 个仓库    │                                               │
│ 项目  38     │ ▾ mattpocock/skills     3/24 已选 · 2 待处理  │
│  everydaytool│   grilling       开发规范   ok      [☆] [⋯]    │
│ 其他项目…    │   tdd            测试       update  [☆] [⋯]    │
│              │   wizard         工具       removed [☆] [⋯]    │
│ 状态         │ ▾ greensock/gsap-skills       7 个 · 0 待处理  │
│  待更新 2    │   …                                           │
│  失效 1      │                                               │
│  未托管 4    │                                               │
├──────────────┴───────────────────────────────────────────────┤
│ statusline: 38 个技能 · 6 个仓库 · 上次检查 3 分钟前           │
└──────────────────────────────────────────────────────────────┘
```

- 主表用 `UiTable` 的树形行：父行 = 仓库组（可折叠），子行 = 技能；子行只显示**已选中**的技能，未安装的 21 个不铺在表里（避免把技能库变成仓库目录浏览器）。
- 父行右侧：`3/24 已选` chip、待处理 chip、`更新此仓库` split button（左更新 / 右菜单：检查、管理技能、打开仓库）。
- 子行：名称 + 描述（截断 + tooltip）、来源路径（mono）、状态 chip、收藏星标、更多菜单。
- 左栏：作用域切换、仓库过滤、状态过滤；窄窗口折叠为顶部下拉。

### 15.3 更新中心

```text
toolbar: [检查全部更新]  [策略: 安全 ▾]        上次检查 12:31
┌───────────────────────────────────────────────────────────────┐
│ 仓库                    已选/可用  可更新  已移除  状态       │
│ mattpocock/skills        3/24       1       1     [更新…]     │
│ greensock/gsap-skills    7/7        0       0     最新         │
│ Leonxlnx/taste-skill     1/1        1       0     [更新…]     │
└───────────────────────────────────────────────────────────────┘
```

点「更新…」打开计划对话框（只列已选中的技能）：

```text
┌─ 更新 mattpocock/skills ──────────────────────────────── × ─┐
│ 当前 main @ 9a21c3e · 已选 3 / 可用 24 · 1 更新 · 1 失效     │
│                                                             │
│ ☑ grilling          更新   ef16… → 9a21…                    │
│ ☑ wizard            失效   上游已无此技能，将移到回收站      │
│ ☐ tdd               冲突   本地已修改，未选中               │
│                                                             │
│ 其余 21 个未选中：不下载、不安装、不参与本次更新             │
│ ⚠ 失效项会从 skills-lock.json 移除，可在回收站恢复           │
│                              [取消]  [应用 2 项]             │
└─────────────────────────────────────────────────────────────┘
```

- 「更新此仓库」永远只处理 `selectedNames`；想加装其余 21 个，点父行的「管理技能」。
- 计划对话框不提供「全选」；勾选只代表「本次执行哪些已选中项」，取消勾选不会卸载。

- 冲突行展开可看「本地修改摘要」（文件数、增删行数）与三个选项。
- 失效区用 warning 文案，不用红色实底；只有「永久删除」用危险按钮。
- 应用后 toast + 「撤销本次」入口。

### 15.4 仓库技能面板

父行「管理技能」或安装流程第二步打开；核心是「列出全部、自动勾选已选、改选后一次确认」。

```text
┌─ 管理 mattpocock/skills 的技能 ───────────────────────────── × ─┐
│ 24 个可用 · 已选 3 · github · main · 上次检查 12:31            │
│ [搜索技能]  [全部] [已选 3] [未安装 21]           [全选] [全不选]│
│                                                                │
│ ☑ grilling      已安装        skills/productivity/grilling/…    │
│ ☑ tdd           已安装·可更新 skills/engineering/tdd/…          │
│ ☑ triage        已选中·上游已删 （只能移除或保留本地）          │
│ ☐ wizard        未安装        skills/engineering/wizard/…       │
│ ☐ …             …                                              │
│                                                                │
│ 将安装 1 · 更新 1 · 移除 1 · 不变 21                            │
│ ⚠ 取消勾选会把本地目录移到回收站（可恢复）                       │
│                                        [取消]  [应用更改]        │
└────────────────────────────────────────────────────────────────┘
```

- 默认勾选 `selectedNames`；**未安装的一律不勾**，即使它是新加的技能。
- 取消勾选已安装技能 = 卸载到回收站（不是「跳过更新」）；「跳过本次更新」在更新对话框里做。
- 已禁用的技能显示「已禁用」，保持勾选；取消勾选 = 从禁用区移除并退出选择集。
- 底部实时汇总；「应用更改」走 §9.8 的事务，失败项不影响成功项，结果可撤销。
- 加载失败时保留骨架与上次快照，标 `stale`，禁用主按钮。
- 非 GitHub 来源只显示 host + ref + 路径，不渲染 star / PR / GitHub 专属徽标；TFS 显示 `tfs.example.internal… · main`。

### 15.5 收藏

```text
┌ 收藏 ───────────────────────────────────────────────────────┐
│ [全部 12] [开发规范 5] [UI 3] [未分类 2] [+ 新建分类]        │
│                                                             │
│ ┌ grilling            ★ 开发规范 · 已安装(全局)  [安装到 ▾] │
│ │ 反复追问，压测方案…                                        │
│ ├ impeccable          ★ UI · 未安装               [安装到 ▾] │
│ │ 前端设计质量与反 slop…                                    │
│ └ supabase            ★ 开发规范 · 来源不可用      [重新绑定] │
└─────────────────────────────────────────────────────────────┘
```

- 卡片/表格二选一（首版表格，P2 卡片）；分类用 `UiChip` 过滤。
- 星标在技能库与收藏页共用组件；收藏状态即时反馈。
- 空态：`UiEmpty` + 「去技能库点星标收藏」。

### 15.6 项目

```text
┌ 项目 ───────────────────────────────────────────────────────┐
│ [添加项目]                                                  │
│ ┌ everydaytool                          [重新扫描] [更多]   │
│ │ ~/other/everydaytool                                      │
│ │ 锁 v1 · 34 条 · 38 个目录 · 4 个未托管                    │
│ │ ⚠ 4 个目录未入锁  ⚠ 27 条锁哈希与当前内容不一致           │
│ └ 其它项目…                                                 │
└─────────────────────────────────────────────────────────────┘
```

- 锁 invalid 时整卡只读，显示错误原因与「打开锁文件」。
- 项目卡上直接给「更新全部」与「修复锁哈希」。

### 15.7 组件映射

| 需求 | 组件 |
| --- | --- |
| 页面骨架 | `WorkspaceHeader` + `ToolSurface`（唯一主表面） |
| 左栏 | `ToolSideInspector` 或普通 aside（宽度 268） |
| 仓库分组表 | `UiTable` 树形行 + `UiTableColumn` |
| 状态 | `UiStatusTag`（点 + 文案）+ `UiChip`（计数） |
| 搜索/筛选 | `UiSearchInput`、`UiSelect`、`UiMenuHorizontal` |
| 计划对话框 | `UiDialog`（`destroyOnClose`） |
| 收藏分类 | `Popover` + `UiCheckbox` + `UiInput` |
| 空态/提示 | `UiEmpty`、`UiHint`、`UiAlert` |
| 危险操作 | `UiButton` tone=danger（仅永久删除/清空回收站） |
| 进度 | `UiProgress` + statusline |
| 复制/打开 | `UiCopyButton`、`openExternal` |

### 15.8 状态与文案

- 加载：表格 `loading`，不闪空态；首次扫描显示「正在扫描…」。
- 网络失败：`UiAlert` + 「重试」；不把 403 说成「没有更新」。
- 批量操作：按钮显示数量「应用 3 项」「更新 2 个仓库」。
- 危险确认文案必须包含对象与后果：
  - 「将 2 个技能移到回收站，并从 skills-lock.json 移除。可在回收站恢复。」
- 禁用确认：「禁用后新开的 agent 会话不再加载它；当前会话不受影响。」

### 15.9 预设与恢复

预设视图分两段：**预设清单**（主动维护）和**已移除**（墓碑恢复）。两者都不进入技能库主表，避免把“历史/期望”混进“当前安装”。

```text
┌ 预设 ────────────────────────────────────────────────────────┐
│ [预设 4] [已移除 3]                            [新建预设]     │
│                                                              │
│ 前端规范            8 项 · 上次应用 2 天前      [应用到 ▾]    │
│ 公司通用基线        12 项 · 未应用               [应用到 ▾]    │
│ TFS 诊断            2 项 · 来源需 token          [编辑]       │
│                                                              │
│ ── 已移除 ──────────────────────────────────────────────     │
│ wizard      上游已删 · 2026-10-30    [重新安装] [遗忘]        │
│ supabase    外部删除 · 2026-10-28    [重新安装] [遗忘]        │
└──────────────────────────────────────────────────────────────┘
```

- 预设行右侧 `UiSplitButton`：左「应用上次目标」，右菜单选「全局 / 项目 / 指定目录…」。
- 应用对话框：目标选择、`additive / exact` 分段、逐项勾选、不可用项、移除项警告；主按钮「应用 N 项」。
- 指定目录用系统目录选择器；选中后显示「将安装到 `<path>/.agents/skills`」与「登记为项目」开关。
- 已移除行展示 origin、移除原因、时间；「重新安装」优先恢复回收站副本。
- 预设详情右侧用 `ToolSideInspector`（320px）：来源列表、默认目标、上次应用、导出/导入。
- 空态：`UiEmpty`「还没有预设」+「从当前已装技能创建」/「从 skills-lock.json 导入」。

### 15.10 未托管与接管

未托管行在技能库里是**只读**的：没有勾选、没有「更新」、没有「禁用」；只保留「预览 / 接管 / 收藏 / 删除」。组头写「来源未知 · 只读」。

```text
┌─ 接管 shadcn-vue ───────────────────────────────────── × ─┐
│ 这个技能在 .agents/skills 里，但 skills-lock.json 没有它。 │
│ 默认不改锁、不参与更新。                                   │
│                                                            │
│ ○ 绑定来源接管（推荐）                                     │
│   来源 [https://github.com/owner/repo          ]           │
│   路径 [skills/shadcn-vue/SKILL.md             ]           │
│   ref  [main                                  ]           │
│   接管后写项目锁，可正常更新 / 禁用。                       │
│                                                            │
│ ○ 仅本地接管                                               │
│   只登记目录与当前 hash；不写项目锁，不参与远端更新。       │
│   之后仍可「绑定来源」。                                   │
│                                                            │
│                              [取消]  [接管]                │
└────────────────────────────────────────────────────────────┘
```

- `UiDialog`，默认选中「绑定来源接管」；不按技能名自动搜索仓库，必须用户确认来源。
- 接管前展示「将写入 `skills-lock.json` 的条目」预览；项目锁 invalid 时禁用绑定来源，只允许本地接管。
- 本地接管后行状态标「本地」，仍不参与远端更新；提供「绑定来源」入口。
- 接管成功 toast + 「撤销」（写锁 + registry 都在 history 里）。
- 删除 orphan 仍走回收站；删除前提示「它不在锁里，删除后只能靠回收站或重新提供来源」。

---

## 16. 安全与隐私

| 风险 | 对策 |
| --- | --- |
| 技能内容是给 AI 的指令（供应链/提示注入） | 安装前展示 SKILL.md 预览与来源；标「未验证来源」；不自动执行脚本；不自动安装新增技能（`safe` 默认） |
| 路径穿越（tar/zip） | 拒绝绝对路径、`..`、设备文件；限制条目数 10k、解压后 100MB；只保留 0644/0755 |
| 符号链接攻击 | 写/删前 `lstat` + `realpath` 校验目标在 scope 根内；删除只处理链接本身；不跟随链接递归 |
| 任意路径写入 | IPC 只接受 scopeId/name；项目路径来自 registry，不让渲染层传原始路径做写操作；唯一例外是预设 `custom.path`，backend 必须 realpath + 校验 |
| 预设批量安装 | 应用前逐项展示来源与差异；不自动执行脚本；`exact` 移除需二次确认；不可用项不阻塞其它项 |
| 令牌泄露 | 只从 env 或 `secret-box` 读取；GitHub 走请求头、TFS 走 `GIT_ASKPASS`；不拼 URL、不进 argv、日志脱敏、不写 registry；`http://` 明确警告明文风险 |
| 锁文件被破坏 | 版本/结构守卫；未知版本只读；写前指纹校验；原子写 |
| 并发写 | 单操作队列 + `.write.lock` + 写前指纹复检 |
| 项目路径危险 | 拒绝 `/`、home 根、应用数据根、系统目录；项目必须已存在且是目录 |
| 回收站被清缓存误删 | 放 assets 层，`clean: never`；清缓存自愈钩子不触碰 |

---

## 17. 性能

- **扫描**：一次 `readdir` + 每条目 `lstat`；frontmatter 只读前 8KB。500 个技能目标 < 150ms。
- **hash**：只在检查/应用/接管时算；用 `(mtimeMs,size)` 缓存，未变则复用。
- **网络**：
  - tree API 按 `(source, ref)` 缓存 5 分钟；ETag/If-None-Match。
  - 更新检查并发 3；安装/应用串行。
  - tarball 只在应用时下载；大小上限（默认 100MB）可配。
  - GitHub 速率：未认证 60/h；提示配置 token；403/429 指数退避，不降级为「删除」。
  - 通用 git：无 API 限流，但浅克隆有成本；按 `(source, ref, commit)` 缓存，`ls-remote` 先探 commit，未变直接复用。
  - 预设应用按 `(source, ref)` 去重，同一仓库只拉一次快照；多项共享同一棵树。
- **UI**：分组折叠默认只展开有问题的组；技能数 > 500 时分页/虚拟滚动（P2）。

---

## 18. 边界与失败

| 场景 | 行为 |
| --- | --- |
| 离线 | 用上次快照标 `stale`；禁止应用更新；安装不可用 |
| 仓库改名/转移 | GitHub 301 跟随；记录新 `source`，提示「来源已迁移」 |
| 仓库 404 | 组级 `source-gone`，逐技能保留；不判 removed |
| 私有仓库无权限 | GitHub 401/403、git `Authentication failed` / `could not read Username` → 「需要 token / 无权访问」；不重试到封禁，不判 removed |
| 本机没有 git | 通用 git 源（TFS/Azure/自建）不可用；提示安装 git，或改用 GitHub API / 本地目录 |
| 预设目标无效 | 拒绝应用，不创建目录；提示原因（不存在/是文件/系统目录/无权限） |
| 预设来源不可用 | 该项 `unavailable`；其它项继续，计划里单独列出 |
| 预设 exact 遇到 forked | 跳过该技能并提示，不删除用户保留的本地版本 |
| tree truncated | 回退 tarball/clone；再失败 → `unknown` |
| 锁含 merge 冲突 | 只读，展示冲突行号；不写 |
| 锁版本未知 | 只读，提示 CLI 版本不匹配 |
| 磁盘满 | 预检可用空间（技能大小 × 2）；失败回滚 |
| 权限不足 | 逐项报错，不整体失败 |
| Windows 路径过长/占用 | 启用长路径前缀；被占用时提示关闭 agent 后重试 |
| 同名冲突 | 阻止，不覆盖 |
| 技能目录被用户改过 | `modified`，默认不覆盖；可选备份后覆盖 |
| CLI 同时更新 | 写前指纹变化 → 放弃并提示刷新 |
| 应用双开 | `.write.lock` 阻止第二个写者 |

---

## 19. 测试策略

### 19.1 单元

- 锁适配器：v1/v3 fixture 读写往返；未知字段保留；排序/缩进/尾换行逐字节断言；v3 不降级。
- 哈希：与 CLI 算法固定 fixture 对比（含子目录、非 ASCII 文件名、`.git`/`node_modules` 跳过）。
- 差异引擎：ok/update/remove/move/ambiguous/truncated/404 的矩阵测试。
- 状态矩阵：orphan/missing/disabled-drift/linked/legacy 的判定。
- 路径安全：`../../etc`、绝对路径、symlink 逃逸、tar 条目穿越。

### 19.2 集成

- 临时目录 + 本地 fixture 仓库（mock GitHub 客户端或本地 HTTP）。
- 安装 3 个 → 更新（删 1 改 1）→ 断言回收站、锁、registry、历史。
- **TFS / 无 API**：本地 file:// git fixture 模拟 `/_git/` 布局；断言不走 GitHub API、`git ls-remote`/浅克隆可用、锁写 `sourceType:'git'` + `sourceUrl`。
- **根目录技能**：fixture 根目录只有 `SKILL.md` + `assets/`；断言只发现 1 个技能、`skillPath='SKILL.md'`、复制包含 assets、子目录里的 `SKILL.md` 不被当成第二个技能。
- **选择性安装**：仓库 3 个技能只装 1 个 → 上游改另外 2 个 → 检查更新只遍历已选中的 1 个，不下载未选中的 2 个。
- **面板改选**：勾选 1 个未安装 + 取消 1 个已安装 → 一次事务里完成安装与卸载；`selectedNames` 与锁同步。
- **语义隔离**：更新对话框取消勾选已安装技能 = 跳过本次更新，技能仍在磁盘、锁仍在（与面板取消勾选区分）。
- **墓碑恢复**：安装 3 个 → 手动删掉其中 1 个的锁条目和目录 → 扫描后 registry 出现 `removed-external` 墓碑 → 点重新安装能按 origin 恢复；「遗忘」后墓碑消失。
- **预设应用**：从项目锁创建预设 → 应用到一个空项目 → 断言锁、目录、registry 全齐；再应用同一预设到第二个项目，不依赖第一个项目。
- **预设模式**：目标多 1 个技能时，`additive` 保留它、`exact` 移除它并二次确认；exact 跳过 `forked` 技能。
- **自定义目标**：`custom.path` 校验通过后装到 `<path>/.agents/skills`；路径是 `/`、home 根、应用数据根时拒绝。
- **未托管**：手工把技能目录放进项目 `.agents/skills` → 扫描为 `orphan`；断言不写锁、不进 `selectedNames`、不出现在更新计划、不能禁用。
- **接管-绑定来源**：接管时填 source + skillPath → 写项目锁、baseline、selectedNames；之后更新/禁用可用。
- **接管-仅本地**：接管选 local → registry 标记但项目锁不变；更新只做本地 hash 校验，不拉远端。
- 中途杀进程 → 重启对账 → 无孤儿 tmp、锁/目录一致。
- CLI 互操作：我们写完后用 CLI 逻辑读取（或 CI 跑 `npx skills check`）无意外 diff；CLI 写完后我们重读正确。

### 19.3 UI

- 计划对话框的默认勾选、冲突交互、批量计数。
- 仓库技能面板：自动勾选 `selectedNames`、未安装默认不勾、汇总计数、取消勾选确认。
- 预设 / 已移除：应用目标与模式、不可用项、移除警告、墓碑重新安装。
- 未托管 / 接管：只读操作、绑定来源、仅本地接管、锁写入预览。
- 空态/加载/错误/只读锁。
- 禁用 → 启用 → 内容 hash 不变。

### 19.4 手工验收

- 用本仓库自身作为项目：应显示 34 条锁 / 38 个目录 / 4 个未托管 / 0 个误报本地修改。
- 全局：29 个 symlink 显示为 `linked`，断链显示 `invalid`，`coding-standards` 显示 `missing`。
- 仓库含 24 个技能、只装 1 个：组头显示 `1/24 已选`；「更新此仓库」只列这 1 个；面板自动勾选这 1 个，其余 23 个不勾且不下载。
- 删掉一个技能目录 + 锁条目：技能库出现「已移除」，来源仍可见，重新安装成功；重置应用数据后该记录才消失。
- 手工复制一个技能目录到项目 `.agents/skills`：显示未托管、只读、无更新/禁用；接管并绑定来源后写锁，更新可用；仅本地接管不写锁。

---

## 20. 分期落地

| 阶段 | 范围 | 交付 | 预估 |
| --- | --- | --- | --- |
| **P0 只读盘点** | 工具骨架、扫描、锁解析（只读）、状态矩阵、仓库分组表、项目登记 | 能看清现状与问题，不改任何文件 | 2–3 天 |
| **P1 安装/更新/失效** | 源解析、GitHub tree/tarball、**通用 git/TFS + token**、staging、事务、写锁、回收站、计划对话框、**仓库技能面板/选择计划**、历史 | 核心闭环（含「只装一个就只更一个」与内网 TFS） | 6–8 天 |
| **P2 禁用/收藏/项目** | 禁用区、启用、收藏、分类、项目管理、更新中心、批量、**墓碑与预设** | 用户要的全部功能面（含“丢了也能装回来”） | 5–6 天 |
| **P3 打磨** | 回滚、git 凭据复用、本地源、watcher、锁修复、导出 | 生产可用 | 2–3 天 |

**P0 必须先做**：它能在不写文件的前提下验证「锁不可靠」「哈希不可信」这两个前提，避免 P1 写错数据。

---

## 21. 风险与取舍

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| CLI 锁格式升级（v4） | 我们写坏/读不懂 | 版本守卫；未知版本只读；保留未知字段；跟进适配 |
| 禁用被 CLI 复活 | 用户困惑 | 检测 `disabled-drift`；可配自动重新禁用；文档说明 |
| 项目锁 diff 噪音 | 团队 review 负担 | 严格排序与格式；批量变更合并为一次写；提示 review |
| hash 语义差异 | 误报修改 | 自建 baseline；锁 hash 只作线索；首屏不误报 |
| symlink 误删 | 删掉外部技能包 | 只 unlink；realpath 边界；测试覆盖 |
| 网络/限流 | 检查失败 | 缓存、退避、明确错误、绝不据此删除 |
| 供应链 | 安装恶意技能 | 预览、来源提示、不自动执行、默认不自动加新增 |
| 预设被误当锁 | 用户以为预设等于已安装 | UI 明确「期望清单」；应用成功后才写锁；状态行区分 |
| 墓碑来源失效 | 知道从哪来但装不回来 | 显示 `source-gone`；支持重新绑定来源；保留 origin |
| 大仓库 tarball | 慢/占空间 | 大小上限、tree 优先、缓存、取消 |

---

## 22. 决策记录与剩余问题

### 22.1 已确认（2026-11-05 / 11-06）

| # | 决策 | 结论 |
| --- | --- | --- |
| Q1 | 禁用后的技能放哪？ | **应用数据区** `<assets>/skill-manager/disabled/...`（唯一能保证所有 agent 都不加载） |
| Q2 | 禁用时锁条目怎么处理？ | **分 scope**：global 删条目、project 保留；project 可单独切换为「删条目」 |
| Q3 | 是否直接维护项目 `skills-lock.json`？ | **读写**，严格保持 v1 格式、排序与字段兼容 |
| Q4 | 上游已删除的技能默认怎么处理？ | **默认勾选**「移到回收站 + 移除锁」，可撤销 |
| Q6 | 首版是否管理 `.claude/skills` 等非 `.agents` 目录？ | **否**，只读识别；canonical 目录才可写 |
| Q7 | 私有仓库 / 无 API 的 git 源怎么认证？ | **PAT**：GitHub 用 `GITHUB_TOKEN`/`GH_TOKEN`，TFS 用 PAT；按 host 保存（env 或应用内加密）；不要求 API |
| Q11 | 一个仓库有多个技能、只装其中一个时，更新怎么办？ | **只遍历 `selectedNames`**；未选中的远端技能不下载、不安装、不产生 plan item |
| Q12 | 仓库面板取消勾选已安装技能是什么语义？ | **卸载**：移到回收站 + 从锁/`selectedNames` 移除；「跳过本次更新」只在更新对话框里做 |
| Q13 | 预设应用到目标时默认怎么处理“多出来的技能”？ | **`additive` 保留**；`exact` 作为显式选项，需二次确认 |
| Q14 | “指定目录”默认指项目根还是技能根？ | **项目根**（装到 `<path>/.agents/skills`）；技能根只作为高级选项，不写锁 |
| Q15 | 未托管技能接管方式？ | **两种都允许**：绑定来源（写锁、可更新）/ 仅本地（不写锁、只本地维护、可后补来源） |

### 22.2 剩余问题（按推荐默认）

| # | 问题 | 选项 | 推荐 |
| --- | --- | --- | --- |
| Q5 | 收藏分类是单选还是多选？ | A 多分类标签；B 单分类 | **A**：一个技能同时属于「开发规范」和「UI」很常见 |
| Q8 | 默认更新策略？ | A 只更新已选中（新增只提示）；B 同步新增 | **A**：避免上游新增技能被动进入上下文 |
| Q9 | 这个功能放工具还是设置页？ | A 独立工具；B 设置页子页 | **A**：它是完整工作区，不是配置项 |
| Q10 | 是否保留每次拉取明细？ | A 只保留最近一次；B 保留最近 10 次 | **A**：足够回答「上次拉到什么」；B 增加写放大 |

---

## 23. 附录

### A. 目录结构（运行期）

```text
<data>/
  config/skill-manager/
    registry.json
    projects.json
    favorites.json
    presets.json
    settings.json
    history.json
    lock-backups/<opId>.json
  cache/skill-manager/
    repos/<hash>/{tree.json,tarball.tar.gz,meta.json}
    staging/<opId>/
    tmp/
<assets>/
  skill-manager/
    trash/<opId>/{manifest.json,<scope>/<name>/…}
    disabled/<scopeId>/{index.json,<name>/…}
```

### B. 状态与动作

| 状态 | 可更新 | 可禁用 | 可卸载 | 可收藏 |
| --- | --- | --- | --- | --- |
| `ok` | ✅ | ✅ | ✅ | ✅ |
| `update-available` | ✅ | ✅ | ✅ | ✅ |
| `modified` | ⚠️ 确认后 | ✅ | ⚠️ 确认后 | ✅ |
| `missing` | 重装 | — | ✅（清锁） | ✅ |
| `orphan` | — | 接管后 | ✅ | ✅ |
| `invalid` | — | — | ✅（链接） | ⚠️ |
| `removed-upstream` | — | ✅ | ✅ | ✅（保留） |
| `moved` | ✅ | ✅ | ✅ | ✅ |
| `removed-external` | 重装 | — | 遗忘 | ✅ |
| `disabled` | 跳过内容 | — | ✅ | ✅ |
| `linked` | — | ✅ | ✅（仅链接） | ✅ |
| `legacy` | ⚠️ 重装 | ✅ | ✅ | ✅ |
| `shadowed` | ✅ | ✅ | ✅ | ✅ |

### C. 与 CLI 的对照

| 行为 | `npx skills` | 本工具 |
| --- | --- | --- |
| 安装 | `add`，交互选择 agent | 图形化选择 scope + 技能 |
| 更新 | `update`，逐技能重装 | 仓库组计划 + 事务 + 回滚 |
| 检测上游删除 | `update` 时 clone 对比，交互询问；非交互不删 | 始终产出计划，默认勾选进回收站 |
| 禁用 | 无 | 有 |
| 收藏/分类 | 无 | 有 |
| 预设/组合 | 无 | 有；可应用到 global / 项目 / 指定目录 |
| 丢失后恢复 | 无 | 墓碑 + 回收站 + 预设 |
| 项目锁 | 读写 v1 | 读写 v1（严格兼容） |
| 全局锁 | 读写 v3，旧版清空 | 读写 v3（绝不降级） |
| 多 agent 目录 | 支持 80+ | 首版只 canonical + 只读识别 |
