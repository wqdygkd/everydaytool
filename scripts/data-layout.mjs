#!/usr/bin/env node
// 数据布局 v1 → v2 的预览 / 执行工具（不需要启动 Electron）：
//
//   node scripts/data-layout.mjs plan  [--data <dir>] [--assets <dir>]   只读预览（默认）
//   node scripts/data-layout.mjs apply [--data <dir>] --yes              真正搬迁
//
// 默认 --data 为仓库 data/（开发态数据根）。执行前请**关闭应用**：
// 搬迁在启动期运行才安全（Chromium 尚未打开会话文件），手工执行时进程必须在跑之外。
//
// 直接 import `.ts`（未加 flag 的类型剥离），因此需要 Node ≥ 22.18——见 package.json 的 engines。
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { planDataLayoutUpgrade, upgradeDataLayout } from '../backend/utils/data-layout-upgrade.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const argv = process.argv.slice(2)
const command = argv.find(item => !item.startsWith('-')) ?? 'plan'
const dataIndex = argv.indexOf('--data')
const assetsIndex = argv.indexOf('--assets')
const dataDirectory = path.resolve(dataIndex >= 0 ? argv[dataIndex + 1] : path.join(rootDir, 'data'))
const assetsRoot = assetsIndex >= 0
  ? path.resolve(argv[assetsIndex + 1])
  : path.join(dataDirectory, 'assets')
const roots = { dataDirectory, assetsRoot }

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function printPlan(plan) {
  console.log(`数据根：${plan.roots.dataDirectory}`)
  console.log(`资产根：${plan.roots.assetsRoot}`)
  console.log(`布局版本：v${plan.fromVersion} → v${plan.toVersion}\n`)

  const groups = new Map()
  for (const step of plan.steps) {
    if (!groups.has(step.layer)) groups.set(step.layer, [])
    groups.get(step.layer).push(step)
  }
  for (const [layer, steps] of groups) {
    const move = steps.filter(step => step.action === 'move')
    const bytes = move.reduce((sum, step) => sum + step.bytes, 0)
    console.log(`[${layer}] 待搬迁 ${move.length} 项 / ${formatBytes(bytes)}`)
    for (const step of steps) {
      const mark = { 'move': '→', 'already-done': '✓', 'missing': '·', 'conflict': '!' }[step.action]
      const detail = step.action === 'move' ? formatBytes(step.bytes) : step.action
      console.log(`  ${mark} ${step.ruleId}  ${path.relative(rootDir, step.from)}  ⇒  ${path.relative(rootDir, step.to)}  (${detail})`)
    }
    console.log('')
  }

  if (plan.quarantined.length > 0) {
    console.log(`[隔离] ${plan.quarantined.length} 项已知孤儿 → config/quarantine/`)
    for (const item of plan.quarantined) {
      console.log(`  ? ${item.name}  ${formatBytes(item.bytes)}`)
    }
    console.log('')
  }

  if (plan.untouchedUnknown.length > 0) {
    console.log(`[保留] ${plan.untouchedUnknown.length} 项未登记且不在孤儿白名单，原地不动：${plan.untouchedUnknown.join(', ')}`)
    console.log('')
  }

  if (plan.emptyLegacyDirs.length > 0) {
    console.log(`[回收] 搬空后删除旧顶层目录：${plan.emptyLegacyDirs.map(dir => path.basename(dir)).join(', ')}`)
  }
}

const planned = planDataLayoutUpgrade(roots)
printPlan(planned)

if (command !== 'apply') {
  console.log('\n（只读预览；真正搬迁请执行：node scripts/data-layout.mjs apply --yes）')
  process.exit(0)
}

if (planned.fromVersion > planned.toVersion) {
  console.error(`\n拒绝执行：数据根布局版本 v${planned.fromVersion} 高于本版支持的 v${planned.toVersion}，`
    + '请使用更新版应用处理这棵数据树。')
  process.exit(1)
}
if (planned.fromVersion === planned.toVersion) {
  console.log('\n已经是 v2 布局，无需搬迁。')
  process.exit(0)
}

if (!argv.includes('--yes')) {
  console.error('\n拒绝执行：apply 需要显式 --yes，且必须先关闭应用。')
  process.exit(1)
}

const result = upgradeDataLayout(roots)
console.log(`\n搬迁完成：${result.movedCount} 项 / ${formatBytes(result.movedBytes)}`)
if (result.errors.length > 0) {
  console.error('失败条目（原位置保留，读取方会容错回查）：')
  for (const error of result.errors) console.error(`  - ${error}`)
}
console.log(result.versionWritten ? '布局版本已写入 v2。' : '布局版本未写入（存在错误或冲突，下次启动会重试）。')
process.exit(result.ok ? 0 : 1)
