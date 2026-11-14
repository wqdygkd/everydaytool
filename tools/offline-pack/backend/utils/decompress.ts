// Docker 镜像层解压 + 哈希（Node 版，替代浏览器 DecompressionStream + crypto.subtle）。
// Node 原生支持 gzip；zstd 当前仍显式报错（后续可引入 zstd 库补齐）。
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, gunzipSync } from 'node:zlib'

// 魔数：gzip 1f 8b / zstd 28 b5 2f fd
export function isGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1F && buf[1] === 0x8B
}

export function isZstd(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x28 && buf[1] === 0xB5 && buf[2] === 0x2F && buf[3] === 0xFD
}

export function sha256(buf: Buffer): string {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`
}

/** 按魔数解压 layer，返回解压后内容 + 未压缩内容的 SHA256（diff_id） */
export function decompressLayer(raw: Buffer, mediaType?: string): { data: Buffer, diffId: string } {
  let result: Buffer
  if (isGzip(raw)) {
    result = gunzipSync(raw)
  } else if (isZstd(raw)) {
    throw new Error(`该镜像层使用 zstd 压缩 (${mediaType ?? 'unknown'})，当前版本暂不支持。请尝试其他架构或标签。`)
  } else {
    result = raw
  }
  return { data: result, diffId: sha256(result) }
}

async function readMagic(filePath: string, length: number): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * 文件版解压：流式读取 →（按需 gunzip）→ 落盘，同时增量计算解压后内容的 SHA256（diff_id）。
 * 调用方负责在打包完成后删除输出文件。
 */
export async function decompressLayerFile(
  sourcePath: string,
  destPath: string,
  mediaType?: string,
): Promise<{ diffId: string, size: number }> {
  const magic = await readMagic(sourcePath, 4)
  if (isZstd(magic)) {
    throw new Error(`该镜像层使用 zstd 压缩 (${mediaType ?? 'unknown'})，当前版本暂不支持。请尝试其他架构或标签。`)
  }

  const hash = createHash('sha256')
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  const source = createReadStream(sourcePath)
  const sink = createWriteStream(destPath)
  if (isGzip(magic)) {
    await pipeline(source, createGunzip(), tap, sink)
  } else {
    await pipeline(source, tap, sink)
  }
  const info = await stat(destPath)
  return { diffId: `sha256:${hash.digest('hex')}`, size: info.size }
}
