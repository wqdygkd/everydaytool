import type { ArchiveMessageStatusHint } from '../../../../shared/media-archive.ts'

const MAX_STATUS_IDS = 500
const MAX_STATUS_MEDIA_KEYS = 32

export const TRASH_ID_PATTERN = /^[\w-]{1,120}$/

export function readPeerIdValue(value: unknown): string {
  if (typeof value !== 'string' || !/^-?\d{1,20}$/.test(value)) throw new Error('peer 非法')
  return value
}

export function readMessageIdValue(value: unknown, label = 'messageId'): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} 非法`)
  return id
}

export function readTrashId(value: unknown): string {
  if (typeof value !== 'string' || !TRASH_ID_PATTERN.test(value)) throw new Error('回收站条目非法')
  return value
}

export function readOptionalDays(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 非法`)
  return value
}

export function readStatusHints(raw: unknown): ArchiveMessageStatusHint[] {
  if (!Array.isArray(raw)) return []
  const hints: ArchiveMessageStatusHint[] = []
  for (const item of raw.slice(0, MAX_STATUS_IDS)) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const messageId = record.messageId
    if (typeof messageId !== 'number' || !Number.isSafeInteger(messageId) || messageId <= 0) continue
    const hint: ArchiveMessageStatusHint = { messageId }

    const source = record.forwardSource
    if (typeof source === 'object' && source !== null) {
      const sourceRecord = source as Record<string, unknown>
      const sourcePeerId = sourceRecord.id
      const sourceMessageId = sourceRecord.messageId
      if (typeof sourcePeerId === 'string' && /^-?\d{1,20}$/.test(sourcePeerId)
        && typeof sourceMessageId === 'number' && Number.isSafeInteger(sourceMessageId) && sourceMessageId > 0) {
        hint.forwardSource = { id: sourcePeerId, messageId: sourceMessageId }
      }
    }

    const mediaKeys = record.mediaKeys
    if (Array.isArray(mediaKeys)) {
      hint.mediaKeys = mediaKeys
        .filter((key): key is string => typeof key === 'string' && /^[\w.-]{1,200}$/.test(key))
        .slice(0, MAX_STATUS_MEDIA_KEYS)
    }

    const textChars = record.textChars
    if (typeof textChars === 'number' && Number.isSafeInteger(textChars) && textChars >= 0) {
      hint.textChars = textChars
    }
    hints.push(hint)
  }
  return hints
}
