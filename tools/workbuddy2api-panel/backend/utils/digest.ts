import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** 计算文件 sha256，返回 `sha256:<hex>`（与 GitHub asset digest 同形） */
export async function sha256FileDigest(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })
  return `sha256:${hash.digest('hex')}`
}

export function normalizeDigest(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  if (trimmed.startsWith('sha256:')) return trimmed
  if (/^[a-f0-9]{64}$/.test(trimmed)) return `sha256:${trimmed}`
  return trimmed
}

export async function assertFileDigest(filePath: string, expected: string): Promise<void> {
  const want = normalizeDigest(expected)
  if (!want) throw new Error('缺少 digest，无法校验安装包')
  const got = await sha256FileDigest(filePath)
  if (got !== want) {
    throw new Error(`安装包校验失败：期望 ${want}，实际 ${got}`)
  }
}
