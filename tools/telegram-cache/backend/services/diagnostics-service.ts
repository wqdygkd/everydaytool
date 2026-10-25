// 脱敏诊断包：把观测结果、能力矩阵、资源索引、任务与归档写成单个 JSON。
// 硬约束（方案文档 §12.2）：
// - 不含 Cookie / Authorization / 请求头原文 / 响应体 / 消息正文；
// - 展示地址已脱敏（查询参数值全部 ***），完整 fetchUrl 只存在于主进程内存；
// - 只写数据根目录下的 telegram-cache/diagnostics，文件名由应用生成。
import type { TelegramDiagnosticsExport } from '../../../../shared/telegram-cache.ts'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { shell } from 'electron'
import { getTelegramCacheRoot, getTelegramDiagnosticsDir, toTelegramRelativePath } from '../utils/paths.ts'
import { listTelegramArchives } from './archive-service.ts'
import { listBenchmarkRecords } from './benchmark-service.ts'
import { buildTelegramFeasibilityReport } from './feasibility-service.ts'
import { getTelegramTraffic } from './observation-service.ts'
import { buildTelegramSnapshot } from './snapshot-service.ts'

function timestampForFileName(date: Date): string {
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`
}

export async function exportTelegramDiagnostics(): Promise<TelegramDiagnosticsExport> {
  const snapshot = buildTelegramSnapshot()
  const traffic = getTelegramTraffic()
  const archives = listTelegramArchives()
  const exportedAt = Date.now()
  const dir = getTelegramDiagnosticsDir()
  await mkdir(dir, { recursive: true })
  const fileName = `diagnostics-${timestampForFileName(new Date(exportedAt))}.json`
  const absolutePath = path.join(dir, fileName)

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date(exportedAt).toISOString(),
    stage: 'M0+M1+M2+M3-A+M3-B（观测 / 索引去重 / HTTP 缓存与本地响应 / 页面图片捕获 / MTProto 消息下载[需 .env 凭据]）',
    privacy: '已脱敏：不含 Cookie / Authorization / 请求头原文 / 响应体 / 消息正文；URL 查询参数值统一替换为 ***',
    runtime: {
      electron: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null,
      node: process.versions.node ?? null,
      platform: process.platform,
    },
    dataDirectory: snapshot.dataDirectory,
    webSession: snapshot.webSession,
    config: snapshot.config,
    capabilities: snapshot.capabilities,
    cache: snapshot.cache,
    m3: buildTelegramFeasibilityReport(),
    benchmarks: listBenchmarkRecords(),
    observation: {
      stats: snapshot.stats,
      traffic,
    },
    resources: snapshot.resources,
    tasks: snapshot.tasks,
    archives,
    limits: {
      trafficEntries: traffic.length,
      resourceEntries: snapshot.resources.length,
      taskEntries: snapshot.tasks.length,
      archiveEntries: archives.length,
    },
  }

  const body = `${JSON.stringify(payload, null, 2)}\n`
  await writeFile(absolutePath, body, 'utf8')
  const info = await stat(absolutePath)

  return {
    relativePath: toTelegramRelativePath(absolutePath),
    bytes: info.size,
    exportedAt,
    counts: {
      resources: snapshot.resources.length,
      traffic: traffic.length,
      tasks: snapshot.tasks.length,
      archives: archives.length,
    },
  }
}

/** 打开本工具的数据目录（用户主动导出 / 排查用） */
export async function openTelegramDataDir(): Promise<boolean> {
  const root = getTelegramCacheRoot()
  await mkdir(root, { recursive: true })
  const errorMessage = await shell.openPath(root)
  if (errorMessage) throw new Error(errorMessage)
  return true
}
