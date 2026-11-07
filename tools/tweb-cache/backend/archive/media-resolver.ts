import { getArchiveMediaStatuses, resolveArchiveMediaRecord } from './message-store.ts'

export interface ArchiveResolvedMedia {
  absolutePath: string
  size: number
  mimeType?: string
}

/** /media/<mediaKey> 的解析：只认媒体索引，不接受任意路径 */
export function resolveArchiveMedia(mediaKey: string): ArchiveResolvedMedia | undefined {
  const record = resolveArchiveMediaRecord(mediaKey)
  if (!record) return undefined
  return { absolutePath: record.absolutePath, size: record.size, mimeType: record.mimeType }
}

export { getArchiveMediaStatuses }
