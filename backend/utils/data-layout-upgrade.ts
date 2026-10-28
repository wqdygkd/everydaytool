// v1（平铺 `<data>/<工具>/…`）→ v2（分层 `<data>/{config,session,cache}` + `<assets>`）一次性布局升级。
//
// 时机：必须在 **ready 之前**、`configureSessionDataDirectory()` 之前（Chromium 尚未打开会话文件），
// 与 `loadDataDirectoryOverrideSync()` 同一段启动流程；本文件不依赖 Electron，
// 根目录由调用方传入（便于用脚本对真实/临时目录做 dry-run 验证）。
//
// 语义（docs/data-layers.md §9）：
// - 逐条目搬迁，优先 rename（同卷秒级），跨卷回落 copy + delete；
// - 单条失败不中断整体：记 errors，文件留在旧位置，后续读取方用 resolveLegacyPath 容错回查；
// - 两边同名 → 冲突，跳过且**绝不覆盖**；
// - 整表幂等，可在下次启动重复执行；
// - 只有**白名单里的已知孤儿**（config.db / cdp-injector / .DS_Store）搬进 `config/quarantine/<ts>/`，
//   其余未登记的顶层项一律原地不动（只 warn）——「宁可错杀」会静默吃掉用户自己的东西；
// - `layoutVersion` 高于本版支持值 → 拒绝升级并如实报告（新版数据不能被老版按自己的理解覆盖）；
// - 只有「零错误且零冲突」才写布局版本标记，否则保持 v1 供下次重试。
import type { DataLayer } from '../../shared/data-layers.ts'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  DATA_LAYOUT_V1_TO_V2,
  DATA_LAYOUT_VERSION,
  DATA_LAYOUT_VERSION_FILE,
  DATA_ROOT_KEEP_NAMES,
  QUARANTINE_ORPHAN_NAMES,
  QUARANTINE_RELATIVE_DIR,
} from '../../shared/data-layers.ts'
import { logger } from './logger.ts'

export interface DataLayoutRoots {
  dataDirectory: string
  /** 资产根（独立根，P1 前为默认 `<data>/assets`） */
  assetsRoot: string
}

export type DataLayoutStepAction = 'move' | 'already-done' | 'missing' | 'conflict'

export interface DataLayoutUpgradeStep {
  ruleId: string
  layer: DataLayer
  from: string
  to: string
  kind: 'file' | 'dir'
  action: DataLayoutStepAction
  bytes: number
}

export interface DataLayoutQuarantineItem {
  name: string
  from: string
  to: string
  bytes: number
}

export interface DataLayoutUpgradePlan {
  roots: DataLayoutRoots
  fromVersion: number
  toVersion: number
  /** 需要搬迁的条目（含已就位 / 缺失 / 冲突，便于 UI 与日志如实呈现） */
  steps: DataLayoutUpgradeStep[]
  quarantined: DataLayoutQuarantineItem[]
  /** 未登记但不在孤儿白名单里的顶层项：原地保留，只报告 */
  untouchedUnknown: string[]
  /** 搬空后可回收的旧顶层目录 */
  emptyLegacyDirs: string[]
}

export interface DataLayoutUpgradeResult {
  ok: boolean
  dryRun: boolean
  plan: DataLayoutUpgradePlan
  movedCount: number
  movedBytes: number
  errors: string[]
  /** 是否写入了布局版本标记（只有零错误零冲突才写） */
  versionWritten: boolean
  /**
   * 数据根的 `layoutVersion` 高于本版支持值：**一个字节都没动**，调用方应拒绝继续启动，
   * 否则老版本会按自己对布局的理解往新版数据里写。
   */
  blockedByNewerLayout: boolean
}

/** v1 的顶层目录名（搬家后这些目录应当变空并被回收） */
const LEGACY_TOP_LEVEL_NAMES = Array.from(new Set(
  DATA_LAYOUT_V1_TO_V2.map(rule => rule.from.split('/')[0]),
))

/**
 * 数据根里的合法顶层项：旧顶层目录 + v2 的三个层目录 + 版本标记 +
 * pre-v1 的遗留目录 `sandboxes` / `shared`（早期布局，由 chrome-sandbox 自己的
 * ensureChromeSandboxLayout 在运行期收编，不能在这里当孤儿隔离）+
 * 用户自备、我们不拥有也不理解的 `.env` 一类文件（`DATA_ROOT_KEEP_NAMES`）。
 */
const KNOWN_DATA_ROOT_NAMES = new Set<string>([
  ...LEGACY_TOP_LEVEL_NAMES,
  'config',
  'session',
  'cache',
  'assets',
  'sandboxes',
  'shared',
  DATA_LAYOUT_VERSION_FILE,
  ...DATA_ROOT_KEEP_NAMES,
])

function layerRoot(roots: DataLayoutRoots, layer: DataLayer): string {
  return layer === 'assets'
    ? path.resolve(roots.assetsRoot)
    : path.join(path.resolve(roots.dataDirectory), layer)
}

/** 同步测量体积（升级在启动期同步执行，不能 await） */
function measureSync(targetPath: string): number {
  try {
    const info = statSync(targetPath)
    if (info.isFile()) return info.size
    if (!info.isDirectory()) return 0
  } catch {
    return 0
  }

  let total = 0
  const stack = [targetPath]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let names: import('node:fs').Dirent[]
    try {
      names = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of names) {
      const child = path.join(dir, dirent.name)
      if (dirent.isSymbolicLink()) continue
      if (dirent.isDirectory()) {
        stack.push(child)
      } else if (dirent.isFile()) {
        try {
          total += statSync(child).size
        } catch {
          // 文件刚被删 / 无权限：当作 0，不影响搬迁
        }
      }
    }
  }
  return total
}

/** 读取布局版本：标记缺失视为 v1 */
export function readDataLayoutVersion(dataDirectory: string): number {
  const file = path.join(dataDirectory, DATA_LAYOUT_VERSION_FILE)
  try {
    if (!existsSync(file)) return 1
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { layoutVersion?: unknown }
    return typeof raw.layoutVersion === 'number' ? raw.layoutVersion : 1
  } catch {
    return 1
  }
}

function writeDataLayoutVersion(dataDirectory: string, extra: Record<string, unknown>): void {
  const file = path.join(dataDirectory, DATA_LAYOUT_VERSION_FILE)
  writeFileSync(file, `${JSON.stringify({ layoutVersion: DATA_LAYOUT_VERSION, ...extra }, null, 2)}\n`, 'utf8')
}

/**
 * 计算升级计划（只读，不写盘）：供 dry-run 预览、日志与验证脚本使用。
 * 资产根不在数据根内时，资产条目照样按 assetsRoot 计算。
 */
export function planDataLayoutUpgrade(roots: DataLayoutRoots): DataLayoutUpgradePlan {
  const dataDirectory = path.resolve(roots.dataDirectory)
  const fromVersion = readDataLayoutVersion(dataDirectory)
  const steps: DataLayoutUpgradeStep[] = []

  for (const rule of DATA_LAYOUT_V1_TO_V2) {
    const from = path.join(dataDirectory, ...rule.from.split('/'))
    const to = path.join(layerRoot(roots, rule.layer), ...rule.to.split('/'))
    const sourceExists = existsSync(from)
    const targetExists = existsSync(to)
    const action: DataLayoutStepAction = targetExists
      ? (sourceExists ? 'conflict' : 'already-done')
      : (sourceExists ? 'move' : 'missing')
    steps.push({
      ruleId: rule.id,
      layer: rule.layer,
      from,
      to,
      kind: rule.kind,
      action,
      bytes: action === 'move' && sourceExists ? measureSync(from) : 0,
    })
  }

  const quarantined: DataLayoutQuarantineItem[] = []
  const untouchedUnknown: string[] = []
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let topLevel: import('node:fs').Dirent[] = []
  try {
    topLevel = readdirSync(dataDirectory, { withFileTypes: true })
  } catch {
    topLevel = []
  }
  for (const dirent of topLevel) {
    if (KNOWN_DATA_ROOT_NAMES.has(dirent.name)) continue
    // 只隔离白名单里的已知孤儿；不认识的东西原地不动（隔离它们等于替用户决定去留）
    if (!QUARANTINE_ORPHAN_NAMES.includes(dirent.name)) {
      untouchedUnknown.push(dirent.name)
      continue
    }
    const from = path.join(dataDirectory, dirent.name)
    const to = path.join(dataDirectory, ...QUARANTINE_RELATIVE_DIR.split('/'), stamp, dirent.name)
    quarantined.push({ name: dirent.name, from, to, bytes: measureSync(from) })
  }

  const emptyLegacyDirs = LEGACY_TOP_LEVEL_NAMES
    .map(name => path.join(dataDirectory, name))
    .filter(dir => existsSync(dir))

  return {
    roots: { dataDirectory, assetsRoot: path.resolve(roots.assetsRoot) },
    fromVersion,
    toVersion: DATA_LAYOUT_VERSION,
    steps,
    quarantined,
    untouchedUnknown,
    emptyLegacyDirs,
  }
}

/** 跨卷回落：复制成功后才删除源，避免留下半截 */
function moveEntry(from: string, to: string, kind: 'file' | 'dir'): void {
  mkdirSync(path.dirname(to), { recursive: true })
  try {
    renameSync(from, to)
    return
  } catch {
    // EXDEV（跨卷）/ EPERM（占用）：退化为复制 + 删除
  }
  if (kind === 'dir') {
    cpSync(from, to, { recursive: true, force: false, errorOnExist: true })
    rmSync(from, { recursive: true, force: true })
  } else {
    copyFileSync(from, to)
    unlinkSync(from)
  }
}

/**
 * 搬完 profile 后改写沙箱记录里的绝对 userDataPath。
 * 不做这一步，沙箱列表里的路径会指向已不存在的旧目录（Chrome 会当新 profile 起）。
 */
function rewriteSandboxUserDataPaths(roots: DataLayoutRoots, legacyRoot: string, nextRoot: string): void {
  const storePath = path.join(layerRoot(roots, 'config'), 'chrome-sandbox', 'sandboxes.json')
  if (!existsSync(storePath)) return
  try {
    const list = JSON.parse(readFileSync(storePath, 'utf8')) as unknown
    if (!Array.isArray(list)) return
    let changed = 0
    for (const item of list as Array<Record<string, unknown>>) {
      const current = item.userDataPath
      if (typeof current !== 'string') continue
      const relative = path.relative(legacyRoot, current)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue
      item.userDataPath = path.join(nextRoot, relative)
      changed++
    }
    if (changed > 0) {
      writeFileSync(storePath, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
      logger.info('Sandbox profile paths rewritten after layout upgrade', { changed })
    }
  } catch (error) {
    logger.warn('Failed to rewrite sandbox profile paths', { error: (error as Error).message })
  }
}

/**
 * 执行升级。`dryRun: true` 时只返回计划（不改盘），用于验证脚本与排障。
 */
export function upgradeDataLayout(roots: DataLayoutRoots, options: { dryRun?: boolean } = {}): DataLayoutUpgradeResult {
  const dryRun = options.dryRun === true
  const plan = planDataLayoutUpgrade(roots)
  const result: DataLayoutUpgradeResult = {
    ok: true,
    dryRun,
    plan,
    movedCount: 0,
    movedBytes: 0,
    errors: [],
    versionWritten: false,
    blockedByNewerLayout: plan.fromVersion > plan.toVersion,
  }

  // 数据根来自更新版的应用：本版不认识它的布局，**一个字节都不动**，由调用方决定是否继续启动。
  if (result.blockedByNewerLayout) {
    const message = `数据布局版本 v${plan.fromVersion} 高于本版支持的 v${plan.toVersion}，已拒绝搬迁与写入`
    result.ok = false
    result.errors.push(message)
    logger.error('Data layout is newer than this app version; refusing to touch it', {
      dataDirectory: plan.roots.dataDirectory,
      layoutVersion: plan.fromVersion,
      supportedVersion: plan.toVersion,
    })
    return result
  }

  if (plan.fromVersion === plan.toVersion) {
    return result
  }

  for (const step of plan.steps) {
    if (step.action === 'conflict') {
      result.ok = false
      result.errors.push(`目标已存在同名条目，已跳过（不覆盖）：${step.ruleId}`)
      continue
    }
    if (step.action !== 'move') continue
    if (dryRun) {
      result.movedCount++
      result.movedBytes += step.bytes
      continue
    }
    try {
      moveEntry(step.from, step.to, step.kind)
      result.movedCount++
      result.movedBytes += step.bytes
      const rule = DATA_LAYOUT_V1_TO_V2.find(item => item.id === step.ruleId)
      if (rule?.rewriteAbsolutePaths === 'sandbox-user-data-path') {
        rewriteSandboxUserDataPaths(roots, step.from, step.to)
      }
    } catch (error) {
      result.ok = false
      result.errors.push(`${step.ruleId}: ${(error as Error).message}`)
      logger.warn('Failed to move data layout entry; keeping legacy location', {
        rule: step.ruleId,
        from: step.from,
        to: step.to,
        error: (error as Error).message,
      })
    }
  }

  for (const item of plan.quarantined) {
    if (dryRun) continue
    try {
      moveEntry(item.from, item.to, 'dir')
      logger.info('Legacy item quarantined', { name: item.name, to: item.to, bytes: item.bytes })
    } catch (error) {
      result.ok = false
      result.errors.push(`quarantine:${item.name}: ${(error as Error).message}`)
    }
  }

  // 未登记又不在孤儿白名单里的顶层项：原地不动，只让人知道它们还在
  if (plan.untouchedUnknown.length > 0) {
    logger.warn('Unregistered items left untouched at data root', { items: plan.untouchedUnknown })
  }

  // 旧顶层目录搬空后回收；非空说明里面有未归类的东西，留着不动（不删用户数据）
  for (const dir of plan.emptyLegacyDirs) {
    if (dryRun) continue
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir)
    } catch {
      // 目录被占用 / 已不存在：忽略
    }
  }

  if (!dryRun && result.ok) {
    writeDataLayoutVersion(plan.roots.dataDirectory, {
      upgradedAt: new Date().toISOString(),
      platform: process.platform,
      movedCount: result.movedCount,
      movedBytes: result.movedBytes,
    })
    result.versionWritten = true
  } else if (!dryRun && !result.ok) {
    logger.warn('Data layout upgrade finished with errors; layout version not written', {
      errors: result.errors.length,
    })
  }

  return result
}
