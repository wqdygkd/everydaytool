/**
 * 执行清理：先摘服务、再杀进程、再移文件、最后删证书。
 *
 * 分两条路走：
 * - 用户级项：走 Electron 的 shell.trashItem，进系统废纸篓、Finder 可「放回原处」；
 * - 需要 root 的项（/Applications、/Library、/opt、root 所有的临时文件）：
 *   合并成一个 bash 脚本，用一次 `osascript ... with administrator privileges` 执行，
 *   只弹一次系统密码框；移进废纸篓后再把属主交还给当前用户，免得清倒废纸篓要密码。
 */
import type { CleanItemResult, CleanProgress, CleanResult, ResidueScan } from '../../../../shared/yunshu-uninstall.ts'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { app, shell } from 'electron'
import { logger } from '../../../../backend/utils/logger.ts'
import { scanResidue } from './scan.ts'
import { HOME, isProtectedPath } from './targets.ts'

const execFileAsync = promisify(execFile)

type Emit = (progress: CleanProgress) => void

interface AdminOp {
  id: string
  /** bash 片段：必须自己输出 @@OK:<id> 或 @@FAIL:<id>:<原因> */
  script: string
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** 废纸篓里重名时不覆盖，追加 (2)、(3)… */
function uniqueTrashName(trashDir: string, base: string): string {
  let candidate = base
  let index = 2
  while (existsSync(path.join(trashDir, candidate))) {
    candidate = `${base} (${index})`
    index += 1
  }
  return candidate
}

export async function cleanResidue(
  ids: string[],
  scanned: ResidueScan,
  emit: Emit,
): Promise<CleanResult> {
  const selected = scanned.items.filter(item => ids.includes(item.id) && item.removable)
  const results: CleanItemResult[] = []
  const adminOps: AdminOp[] = []
  const adminIds: string[] = []
  const trashDir = path.join(HOME, '.Trash')
  const uid = process.getuid?.() ?? 501

  const record = (id: string, status: CleanItemResult['status'], message: string): void => {
    results.push({ id, status, message })
    emit({ id, status, message })
  }

  for (const item of selected) {
    if (isProtectedPath(item.path) && item.group === 'file') {
      record(item.id, 'failed', '安全检查拒绝该路径')
      continue
    }
    if (item.group === 'file') {
      if (item.needsAdmin) {
        const target = path.join(trashDir, uniqueTrashName(trashDir, path.basename(item.path)))
        adminIds.push(item.id)
        adminOps.push({
          id: item.id,
          script: [
            `if mv -f -- ${quote(item.path)} ${quote(target)} 2>/dev/null; then`,
            `  chown -R ${uid} ${quote(target)} >/dev/null 2>&1`,
            `  mark_ok ${quote(item.id)}`,
            'else',
            `  mark_fail ${quote(item.id)} ${quote('移动到废纸篓失败')}`,
            'fi',
          ].join('\n'),
        })
        continue
      }
      emit({ id: item.id, status: 'running', message: '正在移入废纸篓…' })
      try {
        await shell.trashItem(item.path)
        record(item.id, 'done', '已移入废纸篓')
      } catch (error) {
        record(item.id, 'failed', (error as Error).message || '移入废纸篓失败')
      }
      continue
    }

    if (item.group === 'service') {
      const isSystem = item.needsAdmin
      if (isSystem) {
        adminIds.push(item.id)
        adminOps.push({
          id: item.id,
          script: [
            `launchctl bootout ${quote(`system/${item.label}`)} >/dev/null 2>&1`,
            `if launchctl print ${quote(`system/${item.label}`)} >/dev/null 2>&1; then`,
            `  mark_fail ${quote(item.id)} ${quote('服务仍在运行')}`,
            'else',
            `  mark_ok ${quote(item.id)}`,
            'fi',
          ].join('\n'),
        })
        continue
      }
      emit({ id: item.id, status: 'running', message: '正在卸载服务…' })
      const { ok } = await execFileAsync('launchctl', ['bootout', `gui/${uid}/${item.label}`])
        .then(() => ({ ok: true }))
        .catch(() => ({ ok: false }))
      record(item.id, ok ? 'done' : 'done', ok ? '已卸载' : '本就不在运行')
      continue
    }

    if (item.group === 'process') {
      const pid = Number.parseInt(item.detail.match(/PID\s+(\d+)/)?.[1] ?? '', 10)
      if (!Number.isFinite(pid)) {
        record(item.id, 'failed', '拿不到 PID')
        continue
      }
      if (item.needsAdmin) {
        adminIds.push(item.id)
        adminOps.push({
          id: item.id,
          script: [
            `kill -TERM ${pid} >/dev/null 2>&1`,
            'sleep 1',
            `kill -KILL ${pid} >/dev/null 2>&1`,
            `if ps -p ${pid} >/dev/null 2>&1; then`,
            `  mark_fail ${quote(item.id)} ${quote('进程仍在')}`,
            'else',
            `  mark_ok ${quote(item.id)}`,
            'fi',
          ].join('\n'),
        })
        continue
      }
      emit({ id: item.id, status: 'running', message: '正在结束进程…' })
      try {
        process.kill(pid, 'SIGTERM')
        record(item.id, 'done', '已结束')
      } catch {
        record(item.id, 'done', '进程已不存在')
      }
      continue
    }

    if (item.group === 'certificate') {
      const sha1 = item.detail.match(/sha1=([0-9A-F]{40})/)?.[1] ?? ''
      if (!sha1) {
        record(item.id, 'failed', '缺少证书指纹')
        continue
      }
      if (item.needsAdmin) {
        adminIds.push(item.id)
        adminOps.push({
          id: item.id,
          script: [
            `if security delete-certificate -Z ${quote(sha1)} ${quote(item.path)} >/dev/null 2>&1; then`,
            `  mark_ok ${quote(item.id)}`,
            'else',
            `  mark_fail ${quote(item.id)} ${quote('删除证书失败')}`,
            'fi',
          ].join('\n'),
        })
        continue
      }
      emit({ id: item.id, status: 'running', message: '正在删除证书…' })
      const deleted = await execFileAsync('security', ['delete-certificate', '-Z', sha1, item.path])
        .then(() => true)
        .catch(() => false)
      record(item.id, deleted ? 'done' : 'failed', deleted ? '已删除' : '删除失败（钥匙串可能需要解锁）')
      continue
    }

    record(item.id, 'kept', '仅提示，不做改动')
  }

  let escalated = false
  if (adminOps.length > 0) {
    escalated = true
    for (const id of adminIds) emit({ id, status: 'running', message: '等待管理员授权…' })
    const outcome = await runAdminScript(adminOps)
    const handled = new Set<string>()
    for (const line of outcome.stdout.split('\n')) {
      const okMatch = line.match(/^@@OK:(.+)$/)
      const failMatch = line.match(/^@@FAIL:([^:]+):(.*)$/)
      if (okMatch) {
        record(okMatch[1], 'done', '已处理')
        handled.add(okMatch[1])
      } else if (failMatch) {
        record(failMatch[1], 'failed', failMatch[2] || '处理失败')
        handled.add(failMatch[1])
      }
    }
    for (const id of adminIds) {
      if (handled.has(id)) continue
      record(id, 'failed', outcome.cancelled ? '已取消管理员授权' : (outcome.reason || '未执行'))
    }
  }

  const rescan = await scanResidue()
  logger.info('yunshu-uninstall clean finished', {
    requested: ids.length,
    selected: selected.length,
    escalated,
    failed: results.filter(item => item.status === 'failed').length,
  })

  return { results, escalated, rescan }
}

interface AdminOutcome {
  stdout: string
  cancelled: boolean
  reason: string
}

async function runAdminScript(ops: AdminOp[]): Promise<AdminOutcome> {
  const scriptPath = path.join(app.getPath('temp'), `yunshu-clean-${Date.now()}.sh`)
  const trashDir = path.join(HOME, '.Trash')
  const body = [
    '#!/bin/bash',
    'set -u',
    `T=${quote(trashDir)}`,
    'mark_ok() { printf \'@@OK:%s\\n\' "$1"; }',
    'mark_fail() { printf \'@@FAIL:%s:%s\\n\' "$1" "$2"; }',
    `mkdir -p "$T" 2>/dev/null`,
    ...ops.map(op => op.script),
    'exit 0',
    '',
  ].join('\n')

  try {
    await mkdir(path.dirname(scriptPath), { recursive: true })
    await writeFile(scriptPath, body, 'utf8')
    await chmod(scriptPath, 0o700)

    const appleScript = `do shell script "/bin/bash ${scriptPath.replace(/"/g, '\\"')}" with administrator privileges`
    const { stdout } = await execFileAsync('osascript', ['-e', appleScript], {
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
    })
    return { stdout: String(stdout), cancelled: false, reason: '' }
  } catch (error) {
    const failure = error as { stdout?: string, stderr?: string, message?: string, code?: number }
    const stderr = failure.stderr ?? ''
    const cancelled = /User cancel|用户取消|-128/i.test(stderr) || (failure.code === 1 && /cancel/i.test(stderr))
    logger.warn('yunshu-uninstall admin script failed', { stderr: stderr.slice(0, 400) })
    return {
      stdout: failure.stdout ?? '',
      cancelled,
      reason: cancelled ? '已取消管理员授权' : (stderr || failure.message || '管理员授权执行失败'),
    }
  }
}
