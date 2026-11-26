/**
 * 扫描云枢 / eagleyun SASE 的残留：文件、launchd 服务、运行进程、根证书。
 * 全部只读；任何路径先过 isProtectedPath，命中即记录到 blocked 并跳过。
 */
import type { ResidueItem, ResidueScan } from '../../../../shared/yunshu-uninstall.ts'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { logger } from '../../../../backend/utils/logger.ts'
import {
  CERT_TARGET,
  expandHome,
  FILE_TARGETS,
  isProtectedPath,
  NOTE_TARGETS,
  PROCESS_TARGETS,
  requiredAdmin,
  SERVICE_TARGETS,
  shortenForDisplay,
} from './targets.ts'

const execFileAsync = promisify(execFile)

interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** 不会 reject 的命令执行：缺失 / 非零退出都当作「没有结果」 */
async function run(command: string, args: string[], timeout = 15000): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { timeout, maxBuffer: 8 * 1024 * 1024 })
    return { ok: true, stdout: String(stdout), stderr: String(stderr) }
  } catch (error) {
    const failure = error as { stdout?: string, stderr?: string, message?: string }
    return { ok: false, stdout: failure.stdout ?? '', stderr: failure.stderr ?? (failure.message ?? '') }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 展开一条目标：字面量原样返回，末段含 `*` 时读父目录做匹配 */
async function expandPattern(pattern: string): Promise<string[]> {
  const resolved = expandHome(pattern)
  if (!resolved.includes('*')) return [resolved]
  const dir = path.dirname(resolved)
  const base = path.basename(resolved)
  const matcher = new RegExp(`^${base.split('*').map(escapeRegExp).join('.*')}$`)
  try {
    const names = await readdir(dir)
    return names.filter(name => matcher.test(name)).map(name => path.join(dir, name)).sort()
  } catch {
    return []
  }
}

/** 目录体积：优先 du（含资源分支，快），失败退回不估算 */
async function sizeOf(absPath: string, isDirectory: boolean): Promise<number> {
  if (!isDirectory) {
    try {
      const info = await lstat(absPath)
      return info.size
    } catch {
      return 0
    }
  }
  const { ok, stdout } = await run('du', ['-sk', absPath])
  if (!ok) return 0
  const kb = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? '', 10)
  return Number.isFinite(kb) ? kb * 1024 : 0
}

async function scanServices(items: ResidueItem[]): Promise<void> {
  for (const [index, target] of SERVICE_TARGETS.entries()) {
    const domainQuery = target.domain === 'system'
      ? `system/${target.label}`
      : `gui/${process.getuid?.() ?? 501}/${target.label}`
    const printed = await run('launchctl', ['print', domainQuery])
    const plistExists = (await run('test', ['-e', target.plist])).ok
    const exists = printed.ok || plistExists
    items.push({
      id: `service-${index}`,
      group: 'service',
      label: target.label,
      path: target.plist,
      kindLabel: target.domain === 'system' ? '系统守护进程' : '登录代理',
      sizeBytes: 0,
      needsAdmin: target.domain === 'system',
      removable: exists,
      exists,
      detail: exists
        ? (printed.ok ? '运行中，清理时先卸载' : '未加载，仅残留 plist')
        : '未安装',
    })
  }
}

/** 找出仍在运行的云枢进程（含已删二进制但进程还活着的情形） */
async function scanProcesses(items: ResidueItem[], blocked: string[]): Promise<void> {
  const seenPids = new Set<string>()
  const self = String(process.pid)

  for (const [patternIndex, target] of PROCESS_TARGETS.entries()) {
    const { ok, stdout } = await run('pgrep', ['-f', target.pattern])
    const pids = ok
      ? stdout.split('\n').map(line => line.trim()).filter(pid => /^\d+$/.test(pid) && pid !== self && !seenPids.has(pid))
      : []

    if (pids.length === 0) {
      items.push({
        id: `process-${patternIndex}`,
        group: 'process',
        label: target.label,
        path: '',
        kindLabel: '进程',
        sizeBytes: 0,
        needsAdmin: false,
        removable: false,
        exists: false,
        detail: '未运行',
      })
      continue
    }

    for (const [pidIndex, pid] of pids.slice(0, 12).entries()) {
      seenPids.add(pid)
      const info = await run('ps', ['-o', 'uid=,comm=', '-p', pid])
      const [uidText, ...rest] = info.stdout.trim().split(/\s+/)
      const command = rest.join(' ')
      const uid = Number.parseInt(uidText ?? '', 10)
      const display = command || `PID ${pid}`
      if (display.startsWith('/') && isProtectedPath(display) && !display.includes('Yunshu') && !display.includes('eagleyun')) {
        blocked.push(display)
        continue
      }
      items.push({
        id: `process-${patternIndex}-${pidIndex}`,
        group: 'process',
        label: path.basename(command) || `PID ${pid}`,
        path: command,
        kindLabel: '进程',
        sizeBytes: 0,
        needsAdmin: Number.isFinite(uid) && uid === 0,
        removable: true,
        exists: true,
        detail: `PID ${pid}${Number.isFinite(uid) && uid === 0 ? ' · root' : ''}`,
      })
    }
  }
}

async function scanFiles(items: ResidueItem[], blocked: string[]): Promise<void> {
  const seen = new Set<string>()
  const found: Array<{ absPath: string, isDir: boolean, kind: string, patternIndex: number, hitIndex: number }> = []
  const misses: Array<{ patternIndex: number, kind: string }> = []

  for (const [patternIndex, target] of FILE_TARGETS.entries()) {
    const hits = await expandPattern(target.pattern)
    let matched = 0
    for (const absPath of hits) {
      if (seen.has(absPath)) continue
      seen.add(absPath)
      if (isProtectedPath(absPath)) {
        blocked.push(absPath)
        continue
      }
      try {
        const info = await lstat(absPath)
        found.push({ absPath, isDir: info.isDirectory(), kind: target.kind, patternIndex, hitIndex: matched })
        matched += 1
      } catch {
        // 读不到按不存在处理
      }
    }
    if (matched === 0) misses.push({ patternIndex, kind: target.kind })
  }

  // 体积统计并发跑，避免 800MB 的 .app 把整轮扫描拖到十几秒
  const sizes = await Promise.all(found.map(entry => sizeOf(entry.absPath, entry.isDir)))
  const uid = process.getuid?.() ?? 501

  for (const miss of misses) {
    const target = FILE_TARGETS[miss.patternIndex]
    items.push({
      id: `file-miss-${miss.patternIndex}`,
      group: 'file',
      label: shortenForDisplay(expandHome(target.pattern)),
      path: '',
      kindLabel: miss.kind,
      sizeBytes: 0,
      needsAdmin: false,
      removable: false,
      exists: false,
      detail: '不在本机',
    })
  }

  for (const [index, entry] of found.entries()) {
    let ownerUid = uid
    try {
      ownerUid = (await lstat(entry.absPath)).uid
    } catch {
      // 保持默认
    }
    items.push({
      id: `file-${entry.patternIndex}-${entry.hitIndex}-${index}`,
      group: 'file',
      label: shortenForDisplay(entry.absPath),
      path: entry.absPath,
      kindLabel: entry.kind,
      sizeBytes: sizes[index] ?? 0,
      needsAdmin: requiredAdmin(entry.absPath) || ownerUid === 0,
      removable: true,
      exists: true,
      detail: ownerUid === 0 ? 'root 所有' : '',
    })
  }
}

function pemDer(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64')
}

function colonize(value: string): string {
  return value.replace(/(..)(?=.)/g, '$1:')
}

interface CertFinding {
  keychainName: string
  keychainPath: string
  needsAdmin: boolean
  sha256: string
  matches: boolean
}

async function scanCertificate(items: ResidueItem[], findings: CertFinding[]): Promise<void> {
  for (const [index, keychain] of CERT_TARGET.keychains.entries()) {
    const byName = await run('security', ['find-certificate', '-a', '-c', CERT_TARGET.commonName, '-p', keychain.path])
    const byEmail = await run('security', ['find-certificate', '-a', '-e', CERT_TARGET.email, '-p', keychain.path])
    const pem = [byName.stdout, byEmail.stdout].find(text => text.includes('BEGIN CERTIFICATE'))
    if (!pem) {
      items.push({
        id: `certificate-${index}`,
        group: 'certificate',
        label: CERT_TARGET.commonName,
        path: keychain.path,
        kindLabel: '根证书',
        sizeBytes: 0,
        needsAdmin: keychain.needsAdmin,
        removable: false,
        exists: false,
        detail: `${keychain.name} · 不在该钥匙串`,
      })
      continue
    }
    const der = pemDer(pem)
    if (der.length === 0) continue
    const sha256 = createHash('sha256').update(der).digest('hex').toUpperCase()
    const sha1 = createHash('sha1').update(der).digest('hex').toUpperCase()
    const matches = sha256 === CERT_TARGET.sha256
    findings.push({ keychainName: keychain.name, keychainPath: keychain.path, needsAdmin: keychain.needsAdmin, sha256, matches })
    items.push({
      id: `certificate-${index}`,
      group: 'certificate',
      label: CERT_TARGET.commonName,
      path: keychain.path,
      kindLabel: '根证书',
      sizeBytes: 0,
      needsAdmin: keychain.needsAdmin,
      removable: matches,
      exists: true,
      detail: `${keychain.name} · SHA-256 ${sha256.slice(0, 8)}…${matches ? '（指纹一致）' : '（指纹不符，需人工核对）'} · sha1=${sha1}`,
    })
  }
}

/** 证书存在时always 给一份可照做的指引——自动删不掉时不用猜 */
function buildCertGuide(findings: CertFinding[]): ResidueItem | null {
  if (findings.length === 0) return null
  const first = findings[0]
  const mismatch = findings.some(finding => !finding.matches)
  const needsAdmin = findings.some(finding => finding.needsAdmin)
  const keychainText = findings.map(finding => finding.keychainName).join(' 与 ')
  const reason = mismatch
    ? '指纹与工具记录的那张不一致，工具不会自动删——先人工确认是不是这张，再决定删不删。'
    : needsAdmin
      ? '系统钥匙串里的这张需要管理员授权；取消授权后可以按下面步骤手动完成。'
      : '工具会先尝试自动删除；若钥匙串处于锁定状态导致失败，可以按下面步骤手动完成。'
  const steps = [
    '打开「钥匙串访问」，左侧选「登录」；若系统钥匙串里也有，再切「系统」',
    '类别选「证书」，搜索 EagleCloud 或 sase@eagleyun',
    '右键该证书 →「显示简介」，核对 SHA-256 与下面一致（逐段比对，别只看开头）',
    '右键「删除“EagleCloud Root CA”」，输入登录密码确认',
  ]
  return {
    id: 'manual-cert',
    group: 'manual',
    label: CERT_TARGET.commonName,
    path: first.keychainPath,
    kindLabel: '根证书',
    sizeBytes: 0,
    needsAdmin: false,
    removable: false,
    exists: true,
    detail: `${keychainText} · ${mismatch ? '指纹不符' : '指纹一致'}`,
    guide: {
      reason,
      steps,
      fingerprint: colonize(first.sha256),
      keychain: keychainText,
      copyValue: colonize(first.sha256),
    },
  }
}

async function buildNotes(items: ResidueItem[]): Promise<void> {
  for (const note of NOTE_TARGETS) {
    const exists = (await run('test', ['-e', note.path])).ok
    items.push({
      id: note.id,
      group: 'note',
      label: note.path,
      path: note.path,
      kindLabel: '系统文件',
      sizeBytes: 0,
      needsAdmin: false,
      removable: false,
      exists,
      detail: exists ? note.detail : '不在本机',
    })
  }
}

export async function scanResidue(): Promise<ResidueScan> {
  const items: ResidueItem[] = []
  const blocked: string[] = []

  const certFindings: CertFinding[] = []
  await scanServices(items)
  await scanProcesses(items, blocked)
  await scanFiles(items, blocked)
  await scanCertificate(items, certFindings)
  const certGuide = buildCertGuide(certFindings)
  if (certGuide) items.push(certGuide)
  await buildNotes(items)

  // 无体积信息的组排前面（先停服务、再删文件），同类按体积从大到小
  const order: Record<ResidueItem['group'], number> = { service: 0, process: 1, file: 2, certificate: 3, manual: 4, note: 5 }
  items.sort((a, b) => {
    if (order[a.group] !== order[b.group]) return order[a.group] - order[b.group]
    if (a.exists !== b.exists) return a.exists ? -1 : 1
    return b.sizeBytes - a.sizeBytes
  })
  // 排序后再统一编号，保证 id 与展示顺序一致
  for (const [index, item] of items.entries()) {
    item.id = `${item.group}-${index}`
  }

  const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0)
  logger.info('yunshu-uninstall scan finished', {
    items: items.length,
    blocked: blocked.length,
    totalBytes,
  })

  return {
    items,
    totalBytes,
    scannedAt: new Date().toISOString(),
    blocked,
  }
}
