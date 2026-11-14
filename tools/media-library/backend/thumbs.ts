// 缩略图：按需生成、落在缓存层、带并发上限的后台队列。
//
// 生成手段是系统自带的缩略图提供者（Windows Shell / macOS QuickLook，经
// `nativeImage.createThumbnailFromPath`），图片与视频首帧都走它——不引入 ffmpeg。
// 拿不到时：图片退回直接解码缩放，仍失败就由媒体服务回退到原图；视频返回 null，
// 渲染层显示生成式海报占位。缓存键含 size + mtime，源文件变化后自然换新图。
import type { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { nativeImage } from 'electron'
import { logger } from '../../../backend/utils/logger.ts'
import { thumbsRoot } from './store.ts'

const THUMB_WIDTH = 480
const CONCURRENCY = 3
const JPEG_QUALITY = 82
/** 直接解码兜底只给体积可控的图片用：超大图整张解码会吃掉几百 MB 内存 */
const DIRECT_DECODE_LIMIT = 40 * 1024 * 1024

interface ThumbRequest {
  absPath: string
  kind: 'video' | 'image'
  size: number
  mtimeMs: number
}

const inflight = new Map<string, Promise<string | null>>()
const failed = new Set<string>()
const waiting: Array<() => void> = []
let running = 0

export function thumbKey(absPath: string, size: number, mtimeMs: number): string {
  const normalized = process.platform === 'win32' ? absPath.toLowerCase() : absPath
  return createHash('sha1').update(`${normalized}|${size}|${mtimeMs}|w${THUMB_WIDTH}`).digest('hex').slice(0, 32)
}

function thumbFile(key: string): string {
  return path.join(thumbsRoot(), key.slice(0, 2), `${key}.jpg`)
}

async function acquireSlot(): Promise<void> {
  if (running < CONCURRENCY) {
    running++
    return
  }
  await new Promise<void>(resolve => waiting.push(resolve))
}

function releaseSlot(): void {
  const next = waiting.shift()
  if (next) next()
  else running--
}

async function render(request: ThumbRequest): Promise<Buffer | null> {
  try {
    const image = await nativeImage.createThumbnailFromPath(request.absPath, { width: THUMB_WIDTH, height: THUMB_WIDTH })
    if (!image.isEmpty()) return image.toJPEG(JPEG_QUALITY)
  } catch {
    // 平台不支持（Linux）或系统没有对应格式的缩略图提供者：走下面的兜底
  }
  if (request.kind === 'image' && request.size <= DIRECT_DECODE_LIMIT) {
    try {
      const image = nativeImage.createFromPath(request.absPath)
      if (!image.isEmpty()) {
        const { width } = image.getSize()
        const scaled = width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image
        return scaled.toJPEG(JPEG_QUALITY)
      }
    } catch {
      // nativeImage 只认 PNG / JPEG；其余格式交给调用方回退原图
    }
  }
  return null
}

/** 返回缩略图文件路径；生成不了返回 null（同一文件在本次运行内不再重试） */
export function ensureThumb(request: ThumbRequest): Promise<string | null> {
  const key = thumbKey(request.absPath, request.size, request.mtimeMs)
  const file = thumbFile(key)
  if (existsSync(file)) return Promise.resolve(file)
  if (failed.has(key)) return Promise.resolve(null)
  const pending = inflight.get(key)
  if (pending) return pending

  const job = (async (): Promise<string | null> => {
    await acquireSlot()
    try {
      const data = await render(request)
      if (!data) {
        failed.add(key)
        return null
      }
      await mkdir(path.dirname(file), { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      await writeFile(temp, data)
      await rename(temp, file)
      return file
    } catch (error) {
      failed.add(key)
      logger.warn('media-library thumbnail failed', { error: (error as Error).message })
      return null
    } finally {
      releaseSlot()
      inflight.delete(key)
    }
  })()
  inflight.set(key, job)
  return job
}

export async function removeThumbs(keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    failed.delete(key)
    await rm(thumbFile(key), { force: true }).catch(() => {})
  }
}

/** 清空全部缩略图（设置页清缓存后也会走这里重置内存态） */
export function resetThumbState(): void {
  failed.clear()
}

export async function clearThumbs(): Promise<void> {
  resetThumbState()
  await rm(thumbsRoot(), { recursive: true, force: true }).catch(() => {})
}
