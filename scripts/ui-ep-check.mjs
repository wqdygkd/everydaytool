#!/usr/bin/env node
/**
 * EP 接触面度量 / 验收断言（docs/ui-ep-convergence-plan.md 附录 D 的可执行版）
 *
 *   node scripts/ui-ep-check.mjs          # 打印基线 + 当前值
 *   node scripts/ui-ep-check.mjs --strict # 断言失败时退出码 1（用于批次验收）
 *
 * 纯扫描，不启动 vite / 不 spawn 子进程（沙箱内可执行）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', '.git', 'out'])
const SCAN_ROOTS = ['src', 'tools', 'shared']
const STYLE_FILES = [
  'src/shared/styles/base.scss',
  'src/shared/styles/utilities.scss',
  'src/shared/styles/element-plus.scss',
]

const strict = process.argv.includes('--strict')

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) walk(full, out)
    else if (entry.endsWith('.vue')) out.push(full)
  }
  return out
}

const files = SCAN_ROOTS.flatMap(root => walk(join(ROOT, root)))
const rel = file => relative(ROOT, file).replace(/\\/g, '/')

const TAG_RE = /<el-([a-z0-9-]+)/g
const tags = new Map()
const deep = []
const perFile = new Map()

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const name = rel(file)

  for (const match of source.matchAll(TAG_RE)) {
    const tag = `el-${match[1]}`
    tags.set(tag, (tags.get(tag) ?? 0) + 1)
    perFile.set(name, (perFile.get(name) ?? 0) + 1)
  }

  source.split('\n').forEach((line, index) => {
    if (line.includes(':deep(.el-')) deep.push(`${name}:${index + 1}  ${line.trim()}`)
  })
}

/** 全局样式文件里的 `.el-*` 选择器（含注释提及，仅作趋势参考） */
let globalSelectors = 0
for (const file of STYLE_FILES) {
  try {
    const source = readFileSync(join(ROOT, file), 'utf8')
    globalSelectors += (source.match(/\.el-[\w-]+/g) ?? []).length
  } catch {}
}

const sortedTags = [...tags.entries()].sort((a, b) => b[1] - a[1])
const totalTags = sortedTags.reduce((sum, [, count]) => sum + count, 0)
const businessDeep = deep.filter(entry => !entry.startsWith('src/shared/components/ui/') && !entry.startsWith('src/App.vue'))

console.log('== el-* 组件接触面 ==')
for (const [tag, count] of sortedTags) console.log(`  ${tag.padEnd(20)} ${String(count).padStart(4)} 处`)
console.log(`  合计 ${sortedTags.length} 种 / ${totalTags} 处 / ${perFile.size} 个 vue 文件`)

console.log(`\n== :deep(.el-*) ==\n  总计 ${deep.length} 处；业务侧（不含 Ui* 封装与 App 外壳）${businessDeep.length} 处`)
for (const entry of deep) console.log(`  ${businessDeep.includes(entry) ? '·' : '-'} ${entry}`)

console.log(`\n== 全局 .el-* 选择器（含注释）==\n  ${globalSelectors} 个\n`)

/** 断言：业务文件 0，封装内部 1 */
const countTag = tag => sortedTags.find(([name]) => name === tag)?.[1] ?? 0
const findings = [
  { label: 'el-tag（期望 0）', actual: countTag('el-tag'), limit: 0 },
  { label: 'el-empty（期望 0）', actual: countTag('el-empty'), limit: 0 },
  { label: 'el-progress（期望 ≤1：仅 UiProgress 内部）', actual: countTag('el-progress'), limit: 1 },
  { label: 'el-table（期望 ≤1：仅 UiTable 内部）', actual: countTag('el-table'), limit: 1 },
  { label: '业务侧 :deep(.el-*)（期望 ≤8）', actual: businessDeep.length, limit: 8 },
]

let failed = false
console.log('== 验收断言 ==')
for (const item of findings) {
  const ok = item.actual <= item.limit
  if (!ok) failed = true
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${item.label} → 实际 ${item.actual}`)
}

if (strict && failed) {
  console.error('\n断言未通过（--strict）')
  process.exit(1)
}
console.log('\n（未加 --strict 时仅打印，不作为门禁）')
