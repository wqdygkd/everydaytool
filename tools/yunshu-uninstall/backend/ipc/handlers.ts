/**
 * 云枢卸载 IPC handler。
 *
 * 安全约定：渲染层只能提交「扫描产物里的 id」，主进程用自己缓存的那份扫描结果
 * 反查真实路径——渲染层永远无法让主进程删除一个没被扫描出来的路径。
 */
import type { CleanRequest, ResidueScan } from '../../../../shared/yunshu-uninstall.ts'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { ipcMain, shell } from 'electron'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { YUNSHU_UNINSTALL_CHANNELS } from '../../../../shared/yunshu-uninstall.ts'
import { cleanResidue } from '../services/cleanup.ts'
import { scanResidue } from '../services/scan.ts'
import { HOME } from '../services/targets.ts'
import { YUNSHU_UNINSTALL_IPC_CHANNELS } from './channels.ts'

const execFileAsync = promisify(execFile)

/** 钥匙串访问在 /System/Applications（Ventura+）与 /Applications 两种落点，按新版优先 */
const KEYCHAIN_APP_PATHS = [
  '/System/Applications/Utilities/Keychain Access.app',
  '/Applications/Utilities/Keychain Access.app',
]

let handlersRegistered = false
/** 最近一次扫描结果：清理只认这份里的 id */
let lastScan: ResidueScan | null = null

function parseCleanRequest(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) throw new Error('清理参数非法')
  const ids = (value as CleanRequest).ids
  if (!Array.isArray(ids)) throw new Error('清理参数非法：ids 必须是数组')
  if (ids.length === 0) throw new Error('没有选中任何条目')
  if (ids.length > 200) throw new Error('一次最多清理 200 项')
  const result: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !/^[a-z]+-\d+$/.test(id)) throw new Error('清理参数非法：条目 id 格式不合法')
    result.push(id)
  }
  return result
}

export function registerYunshuUninstallHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  safeHandle(ipcMain, YUNSHU_UNINSTALL_IPC_CHANNELS.SCAN, async () => {
    lastScan = await scanResidue()
    return lastScan
  })

  safeHandle(ipcMain, YUNSHU_UNINSTALL_IPC_CHANNELS.CLEAN, async (_event, value: unknown) => {
    const ids = parseCleanRequest(value)
    if (!lastScan) lastScan = await scanResidue()
    const result = await cleanResidue(ids, lastScan, (progress) => {
      broadcastToWindows(YUNSHU_UNINSTALL_CHANNELS.EVENT_PROGRESS, progress)
    })
    lastScan = result.rescan
    logger.info('yunshu-uninstall clean done', { requested: ids.length })
    return result
  })

  safeHandle(ipcMain, YUNSHU_UNINSTALL_IPC_CHANNELS.OPEN_TRASH, async () => {
    const error = await shell.openPath(path.join(HOME, '.Trash'))
    if (error) throw new Error(error)
  })

  safeHandle(ipcMain, YUNSHU_UNINSTALL_IPC_CHANNELS.OPEN_KEYCHAIN, async () => {
    for (const appPath of KEYCHAIN_APP_PATHS) {
      const error = await shell.openPath(appPath)
      if (!error) return
    }
    // 两条路径都打不开时退回 `open -a`（按应用名解析）
    await execFileAsync('open', ['-a', 'Keychain Access'])
  })
}
