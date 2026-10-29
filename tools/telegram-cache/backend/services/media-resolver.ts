import { getTelegramMediaStatuses, resolveTelegramMediaRecord } from './message-store.ts'

export interface TelegramResolvedMedia {
  absolutePath: string
  size: number
  mimeType?: string
}

/** /media/<mediaKey> 的解析：只认媒体索引，不接受任意路径 */
export function resolveTelegramMedia(mediaKey: string): TelegramResolvedMedia | undefined {
  const record = resolveTelegramMediaRecord(mediaKey)
  if (!record) return undefined
  return { absolutePath: record.absolutePath, size: record.size, mimeType: record.mimeType }
}

export { getTelegramMediaStatuses }
