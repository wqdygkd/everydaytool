#!/usr/bin/env node
// 数据分层的**静态断言**（CI 门禁，不需要 Electron）：
//
//   node scripts/data-layers-check.mjs        （需要 Node ≥ 22.18：直接 import `.ts` 走类型剥离）
//
// 断言内容：
// 1. 层清单 `DATA_LAYER_ENTRIES` 无重复 id，层内路径合法（无绝对路径 / 无 '..'）；
// 2. v1→v2 搬迁表 `DATA_LAYOUT_V1_TO_V2` 无重复 id，且每条搬迁目标都能被清单覆盖
//    （否则「搬过去了但没人知道它属于哪层」）；
// 3. 业务代码不得绕过 resolveLayerPath 直接拼数据根：禁止 `path.join(getDataDirectory(), '<工具目录>'…)`，
//    也禁止先 `const root = getDataDirectory()` 再拼（别名会被解析）；
//    豁免只能写 `data-layers:allow <原因>`，根目录定义者本身（data-root / data-layers / assets-root）除外。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  DATA_LAYER_ENTRIES,
  DATA_LAYERS,
  DATA_LAYOUT_V1_TO_V2,
  joinLayerPath,
} from '../shared/data-layers.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const problems = []

function fail(message) {
  problems.push(message)
}

// ── 1. 清单自身 ──
const seenEntryIds = new Set()
for (const entry of DATA_LAYER_ENTRIES) {
  if (seenEntryIds.has(entry.id)) fail(`重复的条目 id：${entry.id}`)
  seenEntryIds.add(entry.id)
  if (!DATA_LAYERS.includes(entry.layer)) fail(`条目 ${entry.id} 的层非法：${entry.layer}`)
  if (entry.relativePath !== '.') {
    try {
      joinLayerPath(entry.relativePath)
    } catch (error) {
      fail(`条目 ${entry.id} 路径非法：${error.message}`)
    }
  }
  if (entry.layer === 'assets' && entry.backup !== 'manifest-only' && entry.backup !== 'include') {
    fail(`资产层条目 ${entry.id} 的备份策略应为 manifest-only / include，实际 ${entry.backup}`)
  }
  if (entry.layer === 'cache' && entry.backup !== 'never') {
    fail(`缓存层条目 ${entry.id} 不应进入备份（backup=${entry.backup}）`)
  }
  if ((entry.layer === 'config' || entry.layer === 'assets') && entry.clean !== 'never') {
    fail(`不可再生条目 ${entry.id} 不允许被清理（clean=${entry.clean}）`)
  }
}

// ── 2. 搬迁表 ──
const seenRuleIds = new Set()
const entryPathsByLayer = new Map(DATA_LAYERS.map(layer => [layer, DATA_LAYER_ENTRIES
  .filter(entry => entry.layer === layer && entry.relativePath !== '.')
  .map(entry => entry.relativePath)]))

for (const rule of DATA_LAYOUT_V1_TO_V2) {
  if (seenRuleIds.has(rule.id)) fail(`重复的搬迁规则 id：${rule.id}`)
  seenRuleIds.add(rule.id)
  const candidates = entryPathsByLayer.get(rule.layer) ?? []
  const covered = candidates.some(entryPath =>
    rule.to === entryPath
    || rule.to.startsWith(`${entryPath}/`)
    || entryPath.startsWith(`${rule.to}/`))
  if (!covered) fail(`搬迁规则 ${rule.id} 的目标 ${rule.to} 没有对应的层清单条目（层 ${rule.layer}）`)
}

// ── 3. 禁止绕过 resolveLayerPath 直拼数据根 ──
const SUFFIXES = ['.ts']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'data', 'release', '.git'])
// 根目录定义者本身允许拼数据根（它们就是「层根从哪来」的唯一来源）
const ALLOW_FILES = new Set([
  'backend/utils/data-root.ts',
  'backend/utils/data-layers.ts',
  'backend/utils/assets-root.ts',
])

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    const info = statSync(full)
    if (info.isDirectory()) walk(full, out)
    else if (SUFFIXES.some(suffix => name.endsWith(suffix))) out.push(full)
  }
  return out
}

/** 只扫后端（前端本来就不该碰文件系统） */
const backendFiles = [
  ...walk(path.join(rootDir, 'backend'), []),
  ...walk(path.join(rootDir, 'electron'), []),
  ...walk(path.join(rootDir, 'tools'), []).filter(file => file.includes(`${path.sep}backend${path.sep}`)),
]

// 豁免只有一种写法：`data-layers:allow <原因>`（原因必填）。曾经的「行内含 legacy 就放过」
// 让断言形同虚设——任何一次拼接都能靠一个词拿到通行证。
const ALLOW_MARKER = /data-layers:allow\s+\S/

/** 数据根一次赋给变量后的别名（`const root = getDataDirectory()` 这种绕法也要拦住） */
function collectRootAliases(source) {
  const aliases = new Set()
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*getDataDirectory\(\)/g)) {
    aliases.add(match[1])
  }
  return aliases
}

let allowMarkedLines = 0
for (const file of backendFiles) {
  const relative = path.relative(rootDir, file)
  if (ALLOW_FILES.has(relative)) continue
  const source = readFileSync(file, 'utf8')
  const aliases = collectRootAliases(source)
  const roots = ['getDataDirectory\\(\\)', ...[...aliases].map(alias => `${alias}\\b`)]
  const directJoin = new RegExp(`path\\.(?:join|resolve)\\(\\s*(?:${roots.join('|')})`, 'g')

  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
    directJoin.lastIndex = 0
    if (!directJoin.test(line)) continue
    if (ALLOW_MARKER.test(line)) {
      allowMarkedLines++
      continue
    }
    fail(`${relative} 绕过分层直接拼数据根：${line.trim()}`)
  }
}

if (problems.length > 0) {
  console.error(`✗ 数据分层断言失败（${problems.length} 项）：`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`✓ 数据分层断言通过：${DATA_LAYER_ENTRIES.length} 个条目 / ${DATA_LAYOUT_V1_TO_V2.length} 条搬迁规则 / `
  + `${backendFiles.length} 个后端文件 / ${allowMarkedLines} 处显式豁免（data-layers:allow）`)
