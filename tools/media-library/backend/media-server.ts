// 本地媒体服务：把**已索引**的原文件与缩略图以 http://127.0.0.1:<随机端口> 提供给渲染层。
//
// 为什么不是自定义协议：<video> 需要可靠的 Range 请求才能拖动进度，Node 的 http + fs 流
// 直接满足；逻辑也能完整留在工具后端里，不必改主进程的协议注册。
//
// 边界：
// - 只监听回环地址，随机端口 + 每次启动随机 token（查询参数 `t`）；
// - 只认「合集 id + 条目 id」，不接受任何路径参数——索引之外的文件拿不到；
// - 校验 Host 头，挡掉 DNS rebinding；
// - 只读（GET / HEAD）。
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { MediaEndpoint, MediaItem } from '../../../shared/media-library.ts'
import type { CollectionDocument } from './store.ts'
import { Buffer } from 'node:buffer'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { logger } from '../../../backend/utils/logger.ts'
import { fileExtension } from '../../../shared/media-library.ts'
import { itemAbsolutePath } from './library.ts'
import { isCollectionId, readCollection } from './store.ts'
import { ensureThumb } from './thumbs.ts'

const MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

let server: Server | null = null
let endpoint: MediaEndpoint | null = null
let starting: Promise<MediaEndpoint> | null = null
let holders = 0

/** 条目查找表按 items 数组缓存：重新扫描会换一个新数组，旧表随之被回收 */
const itemLookup = new WeakMap<MediaItem[], Map<string, MediaItem>>()

function findItem(doc: CollectionDocument, itemId: string): MediaItem | undefined {
  let lookup = itemLookup.get(doc.items)
  if (!lookup) {
    lookup = new Map(doc.items.map(item => [item.id, item]))
    itemLookup.set(doc.items, lookup)
  }
  return lookup.get(itemId)
}

function tokenMatches(candidate: string | null, token: string): boolean {
  if (!candidate) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function reject(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'Content-Length': 0, 'Cache-Control': 'no-store' })
  res.end()
}

async function sendFile(req: IncomingMessage, res: ServerResponse, filePath: string, contentType: string, cacheControl: string): Promise<void> {
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) return reject(res, 404)

  const headers: Record<string, string | number> = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  }
  let start = 0
  let end = info.size - 1
  let status = 200

  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  if (range && info.size > 0) {
    if (range[1] === '' && range[2] !== '') {
      start = Math.max(0, info.size - Number(range[2]))
    } else {
      start = Number(range[1])
      if (range[2] !== '') end = Math.min(end, Number(range[2]))
    }
    if (!Number.isFinite(start) || start > end || start >= info.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` })
      res.end()
      return
    }
    status = 206
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
  }
  headers['Content-Length'] = info.size === 0 ? 0 : end - start + 1
  res.writeHead(status, headers)
  if (req.method === 'HEAD' || info.size === 0) {
    res.end()
    return
  }
  const stream = createReadStream(filePath, { start, end })
  stream.on('error', () => res.destroy())
  // 拖动进度条会频繁中断请求：连接一断就停读，别把整个文件读完
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

async function handle(req: IncomingMessage, res: ServerResponse, current: MediaEndpoint): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reject(res, 405)
  const url = new URL(req.url ?? '/', current.origin)
  if (req.headers.host !== url.host) return reject(res, 403)
  if (!tokenMatches(url.searchParams.get('t'), current.token)) return reject(res, 403)

  const [route, collectionId, itemId] = url.pathname.split('/').filter(Boolean)
  if ((route !== 'thumb' && route !== 'file') || !isCollectionId(collectionId) || !itemId) return reject(res, 404)
  const doc = readCollection(collectionId)
  const item = doc ? findItem(doc, itemId) : undefined
  const filePath = doc && item ? itemAbsolutePath(doc, item) : null
  if (!item || !filePath) return reject(res, 404)

  const originalType = MIME_TYPES[fileExtension(item.name)] ?? 'application/octet-stream'
  // 视频不缓存（体积大、靠 Range 流式读）；图片 URL 带版本戳，可短时缓存
  if (route === 'file') return sendFile(req, res, filePath, originalType, item.kind === 'image' ? 'private, max-age=3600' : 'no-store')

  const thumb = await ensureThumb({ absPath: filePath, kind: item.kind, size: item.size, mtimeMs: item.mtimeMs })
  // URL 带版本戳（mtime），缩略图可以放心长缓存
  if (thumb) return sendFile(req, res, thumb, 'image/jpeg', 'private, max-age=31536000, immutable')
  // 图片生成不了缩略图时退回原图（浏览器自己解码）；视频交给渲染层显示海报占位
  if (item.kind === 'image') return sendFile(req, res, filePath, originalType, 'private, max-age=3600')
  return reject(res, 404)
}

function start(): Promise<MediaEndpoint> {
  if (endpoint) return Promise.resolve(endpoint)
  if (starting) return starting
  starting = new Promise<MediaEndpoint>((resolve, reject_) => {
    const token = randomBytes(24).toString('hex')
    const instance = createServer((req, res) => {
      const current = endpoint
      if (!current) return reject(res, 503)
      handle(req, res, current).catch((error) => {
        logger.warn('media-library media request failed', { error: (error as Error).message })
        if (!res.headersSent) reject(res, 500)
        else res.destroy()
      })
    })
    instance.once('error', (error) => {
      starting = null
      reject_(error)
    })
    instance.listen(0, '127.0.0.1', () => {
      const address = instance.address()
      if (!address || typeof address === 'string') {
        starting = null
        instance.close()
        reject_(new Error('媒体服务启动失败'))
        return
      }
      server = instance
      endpoint = { origin: `http://127.0.0.1:${address.port}`, token }
      starting = null
      resolve(endpoint)
    })
  })
  return starting
}

/** 工具页挂载时获取访问入口（首次调用才真正起服务） */
export async function acquireMediaEndpoint(): Promise<MediaEndpoint> {
  holders++
  try {
    return await start()
  } catch (error) {
    holders = Math.max(0, holders - 1)
    throw error
  }
}

/** 工具页卸载（从左轨关闭）时释放；没有持有者就停服务，正在播放的流随之中断 */
export function releaseMediaEndpoint(): void {
  holders = Math.max(0, holders - 1)
  if (holders === 0) stopMediaServer()
}

export function stopMediaServer(): void {
  holders = 0
  const instance = server
  server = null
  endpoint = null
  if (!instance) return
  instance.close()
  instance.closeAllConnections?.()
}
