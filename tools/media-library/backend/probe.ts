// 媒体信息探测：只读文件头，纯 JS 解析，不引入原生依赖 / ffprobe。
//
// 目标是「够用」：图片取宽高，视频取宽高与时长。解析不了就返回空对象——
// 播放器在 loadedmetadata 时会把真实值回填（ITEM_META），所以这里失败只是晚一步知道。
import type { FileHandle } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import { fileExtension } from '../../../shared/media-library.ts'

export interface MediaProbe {
  width?: number
  height?: number
  duration?: number
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, position)
  return bytesRead === length ? buffer : buffer.subarray(0, bytesRead)
}

function sized(width: number, height: number): MediaProbe {
  return width > 0 && height > 0 && width < 100000 && height < 100000 ? { width, height } : {}
}

// ── 图片 ──

async function probeJpeg(handle: FileHandle, fileSize: number): Promise<MediaProbe> {
  let offset = 2
  // EXIF / ICC 段可能很大，但段数有限：逐段跳，不整段读
  for (let guard = 0; guard < 400 && offset + 9 < fileSize; guard++) {
    const head = await readAt(handle, offset, 9)
    if (head.length < 9 || head[0] !== 0xFF) return {}
    const marker = head[1]
    if (marker === 0xFF) {
      offset += 1
      continue
    }
    // SOF0–SOF15，去掉 DHT(C4) / JPG(C8) / DAC(CC)
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return sized(head.readUInt16BE(7), head.readUInt16BE(5))
    }
    if (marker === 0xD9 || marker === 0xDA) return {}
    offset += 2 + head.readUInt16BE(2)
  }
  return {}
}

function probeWebp(head: Buffer): MediaProbe {
  if (head.length < 30) return {}
  const chunk = head.toString('latin1', 12, 16)
  if (chunk === 'VP8X') {
    return sized(1 + head.readUIntLE(24, 3), 1 + head.readUIntLE(27, 3))
  }
  if (chunk === 'VP8L') {
    const bits = head.readUInt32LE(21)
    return sized(1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF))
  }
  if (chunk === 'VP8 ') {
    return sized(head.readUInt16LE(26) & 0x3FFF, head.readUInt16LE(28) & 0x3FFF)
  }
  return {}
}

async function probeImage(handle: FileHandle, fileSize: number, ext: string): Promise<MediaProbe> {
  const head = await readAt(handle, 0, 32)
  if (head.length < 12) return {}
  if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG' && head.length >= 24) {
    return sized(head.readUInt32BE(16), head.readUInt32BE(20))
  }
  if (head.toString('latin1', 0, 3) === 'GIF') {
    return sized(head.readUInt16LE(6), head.readUInt16LE(8))
  }
  if (head[0] === 0x42 && head[1] === 0x4D && head.length >= 26) {
    return sized(head.readInt32LE(18), Math.abs(head.readInt32LE(22)))
  }
  if (head[0] === 0xFF && head[1] === 0xD8) return probeJpeg(handle, fileSize)
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return probeWebp(head)
  if (ext === 'avif' || head.toString('latin1', 4, 8) === 'ftyp') {
    // AVIF 的尺寸在 meta/iprp/ipco/ispe 里；meta 盒通常就在文件开头几十 KB 内，直接找标记
    const chunk = await readAt(handle, 0, Math.min(fileSize, 256 * 1024))
    const at = chunk.indexOf('ispe', 0, 'latin1')
    if (at > 0 && at + 16 <= chunk.length) return sized(chunk.readUInt32BE(at + 8), chunk.readUInt32BE(at + 12))
  }
  return {}
}

// ── MP4 / MOV ──

const MOOV_LIMIT = 24 * 1024 * 1024

function parseMoov(moov: Buffer): MediaProbe {
  const result: MediaProbe = {}

  function walk(start: number, end: number, depth: number): void {
    let offset = start
    while (offset + 8 <= end) {
      let size = moov.readUInt32BE(offset)
      const type = moov.toString('latin1', offset + 4, offset + 8)
      let header = 8
      if (size === 1 && offset + 16 <= end) {
        size = Number(moov.readBigUInt64BE(offset + 8))
        header = 16
      } else if (size === 0) {
        size = end - offset
      }
      if (size < header || offset + size > end) return
      const body = offset + header

      if (type === 'mvhd') {
        const version = moov[body]
        if (version === 1 && body + 32 <= end) {
          const timescale = moov.readUInt32BE(body + 20)
          const duration = Number(moov.readBigUInt64BE(body + 24))
          if (timescale > 0 && duration > 0) result.duration = duration / timescale
        } else if (body + 20 <= end) {
          const timescale = moov.readUInt32BE(body + 12)
          const duration = moov.readUInt32BE(body + 16)
          if (timescale > 0 && duration > 0 && duration !== 0xFFFFFFFF) result.duration = duration / timescale
        }
      } else if (type === 'tkhd' && !result.width) {
        // 宽高是 tkhd 末尾的两个 16.16 定点数；音轨为 0
        const tail = offset + size
        const width = moov.readUInt32BE(tail - 8) / 65536
        const height = moov.readUInt32BE(tail - 4) / 65536
        if (width >= 16 && height >= 16) {
          result.width = Math.round(width)
          result.height = Math.round(height)
        }
      } else if ((type === 'trak' || type === 'moov') && depth < 4) {
        walk(body, offset + size, depth + 1)
      }
      offset += size
    }
  }

  walk(0, moov.length, 0)
  return result
}

async function probeMp4(handle: FileHandle, fileSize: number): Promise<MediaProbe> {
  let offset = 0
  // moov 可能在文件末尾（未做 faststart）：逐个顶层盒跳过去，只读盒头
  for (let guard = 0; guard < 4000 && offset + 8 <= fileSize; guard++) {
    const head = await readAt(handle, offset, 16)
    if (head.length < 8) return {}
    let size = head.readUInt32BE(0)
    const type = head.toString('latin1', 4, 8)
    let header = 8
    if (size === 1) {
      if (head.length < 16) return {}
      size = Number(head.readBigUInt64BE(8))
      header = 16
    } else if (size === 0) {
      size = fileSize - offset
    }
    if (size < header) return {}
    if (type === 'moov') {
      const bodySize = Math.min(size - header, MOOV_LIMIT, fileSize - offset - header)
      if (bodySize <= 0) return {}
      return parseMoov(await readAt(handle, offset + header, bodySize))
    }
    offset += size
  }
  return {}
}

// ── Matroska / WebM（EBML）──

const EBML_ID_SEGMENT = 0x18538067
const EBML_ID_INFO = 0x1549A966
const EBML_ID_TRACKS = 0x1654AE6B
const EBML_ID_CLUSTER = 0x1F43B675
const EBML_ID_TRACK_ENTRY = 0xAE
const EBML_ID_VIDEO = 0xE0
const EBML_ID_PIXEL_WIDTH = 0xB0
const EBML_ID_PIXEL_HEIGHT = 0xBA
const EBML_ID_TIMECODE_SCALE = 0x2AD7B1
const EBML_ID_DURATION = 0x4489

interface Vint {
  value: number
  length: number
  /** 「未知长度」标记（流式写入的 Segment / Cluster） */
  unknown: boolean
}

function readVint(buffer: Buffer, offset: number, keepMarker: boolean): Vint | null {
  if (offset >= buffer.length) return null
  const first = buffer[offset]
  if (first === 0) return null
  let length = 1
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++
  if (length > 8 || offset + length > buffer.length) return null
  let value = keepMarker ? first : first & (0xFF >> length)
  let allOnes = (first & (0xFF >> length)) === (0xFF >> length)
  for (let i = 1; i < length; i++) {
    const byte = buffer[offset + i]
    if (byte !== 0xFF) allOnes = false
    value = value * 256 + byte
  }
  return { value, length, unknown: !keepMarker && allOnes }
}

function readUint(buffer: Buffer, offset: number, size: number): number {
  let value = 0
  for (let i = 0; i < size && i < 8; i++) value = value * 256 + buffer[offset + i]
  return value
}

function parseMatroska(buffer: Buffer): MediaProbe {
  const result: MediaProbe = {}
  let timecodeScale = 1_000_000
  let rawDuration = 0

  function walk(start: number, end: number, depth: number): void {
    let offset = start
    while (offset < end) {
      const id = readVint(buffer, offset, true)
      if (!id) return
      const size = readVint(buffer, offset + id.length, false)
      if (!size) return
      const body = offset + id.length + size.length
      const bodyEnd = size.unknown ? end : Math.min(end, body + size.value)

      if (id.value === EBML_ID_CLUSTER) return
      if (id.value === EBML_ID_SEGMENT || id.value === EBML_ID_INFO || id.value === EBML_ID_TRACKS
        || id.value === EBML_ID_TRACK_ENTRY || id.value === EBML_ID_VIDEO) {
        if (depth < 6) walk(body, bodyEnd, depth + 1)
      } else if (body + size.value <= buffer.length) {
        if (id.value === EBML_ID_TIMECODE_SCALE) timecodeScale = readUint(buffer, body, size.value) || timecodeScale
        else if (id.value === EBML_ID_DURATION) rawDuration = size.value === 4 ? buffer.readFloatBE(body) : size.value === 8 ? buffer.readDoubleBE(body) : 0
        else if (id.value === EBML_ID_PIXEL_WIDTH && !result.width) result.width = readUint(buffer, body, size.value)
        else if (id.value === EBML_ID_PIXEL_HEIGHT && !result.height) result.height = readUint(buffer, body, size.value)
      }
      if (size.unknown) return
      offset = body + size.value
    }
  }

  walk(0, buffer.length, 0)
  if (rawDuration > 0) result.duration = (rawDuration * timecodeScale) / 1_000_000_000
  if (!result.width || !result.height) {
    delete result.width
    delete result.height
  }
  return result
}

async function probeMatroska(handle: FileHandle, fileSize: number): Promise<MediaProbe> {
  // Info 与 Tracks 都在第一个 Cluster 之前，头部 1MB 足够覆盖绝大多数封装
  return parseMatroska(await readAt(handle, 0, Math.min(fileSize, 1024 * 1024)))
}

/** 探测单个媒体文件；任何异常都吞掉并返回空结果（探测失败不应中断导入） */
export async function probeMedia(filePath: string, kind: 'video' | 'image', fileSize: number): Promise<MediaProbe> {
  let handle: FileHandle | null = null
  try {
    handle = await open(filePath, 'r')
    const ext = fileExtension(filePath)
    if (kind === 'image') return await probeImage(handle, fileSize, ext)
    if (ext === 'mkv' || ext === 'webm') return await probeMatroska(handle, fileSize)
    return await probeMp4(handle, fileSize)
  } catch {
    return {}
  } finally {
    await handle?.close().catch(() => {})
  }
}
