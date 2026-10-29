// 归档 API（v4）：页面通过同源 /api/archive/* 驱动消息级缓存。
//
// 边界：
// - 只接受 peer/mid/index/offset/字节；路径由 message-store 解析；
// - body 上限由 site-server 统一限制；这里只做参数校验与错误映射；
// - 不因远端错误删除本地内容（R5 的约束在 message-store 内同样适用）。
import type {
  TelegramArchiveCommitRequest,
  TelegramArchivePrepareRequest,
  TelegramMessageStatusEntry,
} from '../../../../shared/telegram-cache.ts'
import type { SiteApiContext } from './site-server.ts'
import { existsSync } from 'node:fs'
import { shell } from 'electron'
import {
  appendTelegramAttachment,
  commitTelegramMessage,
  getTelegramMessageStatuses,
  prepareTelegramMessage,
  telegramMessageDir,
} from './message-store.ts'
import { broadcastTelegramSiteEvent } from './site-server.ts'
import {
  emptyTelegramTrash,
  listTelegramTrash,
  moveTelegramMessageToTrash,
  restoreTelegramTrash,
} from './trash-service.ts'

const MAX_STATUS_IDS = 500

function readIntParam(url: URL, name: string, min: number, max: number): number {
  const raw = url.searchParams.get(name)
  const value = raw === null ? Number.NaN : Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`参数 ${name} 非法`)
  return value
}

function readPeerId(url: URL): string {
  const peer = url.searchParams.get('peer') ?? ''
  if (!/^-?\d{1,20}$/.test(peer)) throw new Error('peer 非法')
  return peer
}

function headerValue(context: SiteApiContext, name: string): string | undefined {
  const raw = context.req.headers[name]
  return typeof raw === 'string' && raw ? raw : undefined
}

export async function handleTelegramArchiveApi(context: SiteApiContext): Promise<boolean> {
  const { req, url, sendJson, readJson, readBuffer } = context
  const method = req.method ?? 'GET'

  try {
    if (method === 'POST' && url.pathname === '/api/archive/prepare') {
      const body = await readJson<TelegramArchivePrepareRequest>()
      if (!body || typeof body !== 'object' || !Array.isArray(body.attachments)) {
        throw new Error('prepare 参数非法')
      }
      const result = await prepareTelegramMessage(body)
      broadcastTelegramSiteEvent('msg-status', {
        peerId: body.peer.id,
        messageId: body.messageId,
        state: result.state,
      })
      sendJson(200, result)
      return true
    }

    if (method === 'POST' && url.pathname === '/api/archive/append') {
      const peerId = readPeerId(url)
      const messageId = readIntParam(url, 'mid', 1, Number.MAX_SAFE_INTEGER)
      const index = readIntParam(url, 'index', 1, 999)
      const offset = readIntParam(url, 'offset', 0, Number.MAX_SAFE_INTEGER)
      const data = await readBuffer()
      const result = await appendTelegramAttachment({
        peerId,
        messageId,
        index,
        offset,
        data,
        complete: headerValue(context, 'x-edt-complete') === '1',
      })
      broadcastTelegramSiteEvent('msg-status', {
        peerId,
        messageId,
        state: result.complete ? 'partial' : 'downloading',
        received: result.received,
        expected: result.expected,
      })
      sendJson(200, result)
      return true
    }

    if (method === 'POST' && url.pathname === '/api/archive/commit') {
      const body = await readJson<TelegramArchiveCommitRequest>()
      if (!body || typeof body !== 'object' || !body.peer || typeof body.messageId !== 'number') {
        throw new Error('commit 参数非法')
      }
      const result = await commitTelegramMessage({
        peerId: body.peer.id,
        messageId: body.messageId,
        text: body.text,
        textTruncated: body.textTruncated,
      })
      broadcastTelegramSiteEvent('msg-status', {
        peerId: body.peer.id,
        messageId: body.messageId,
        state: result.state,
      })
      sendJson(200, result)
      return true
    }

    if (method === 'GET' && url.pathname === '/api/archive/status') {
      const peerId = readPeerId(url)
      const ids = (url.searchParams.get('mids') ?? '')
        .split(',')
        .map(value => Number(value.trim()))
        .filter(value => Number.isSafeInteger(value) && value > 0)
        .slice(0, MAX_STATUS_IDS)
      const statuses: Record<string, TelegramMessageStatusEntry> = await getTelegramMessageStatuses(peerId, ids)
      sendJson(200, { statuses })
      return true
    }

    if (method === 'POST' && url.pathname === '/api/archive/delete') {
      const body = await readJson<{ peer?: { id?: string }, messageId?: number, retentionDays?: number }>()
      if (!body?.peer?.id || typeof body.messageId !== 'number') throw new Error('delete 参数非法')
      const entry = await moveTelegramMessageToTrash(body.peer.id, body.messageId, body.retentionDays)
      broadcastTelegramSiteEvent('msg-status', {
        peerId: body.peer.id,
        messageId: body.messageId,
        state: 'missing',
      })
      sendJson(200, { state: 'missing', entry })
      return true
    }

    if (method === 'POST' && url.pathname === '/api/archive/reveal') {
      const body = await readJson<{ peer?: { id?: string }, messageId?: number }>()
      if (!body?.peer?.id || typeof body.messageId !== 'number') throw new Error('reveal 参数非法')
      const dir = telegramMessageDir(body.peer.id, body.messageId)
      if (!existsSync(dir)) throw new Error('本地没有该消息缓存')
      shell.showItemInFolder(dir)
      sendJson(200, { ok: true })
      return true
    }

    if (method === 'GET' && url.pathname === '/api/trash/list') {
      sendJson(200, { entries: await listTelegramTrash() })
      return true
    }

    if (method === 'POST' && url.pathname === '/api/trash/restore') {
      const body = await readJson<{ trashId?: string }>()
      if (!body?.trashId) throw new Error('restore 参数非法')
      const restored = await restoreTelegramTrash(body.trashId)
      broadcastTelegramSiteEvent('msg-status', {
        peerId: restored.peerId,
        messageId: restored.messageId,
        state: restored.state,
      })
      sendJson(200, { state: restored.state })
      return true
    }

    if (method === 'POST' && url.pathname === '/api/trash/empty') {
      const body = await readJson<{ olderThanDays?: number }>()
      const removed = await emptyTelegramTrash(body?.olderThanDays)
      sendJson(200, { removed })
      return true
    }

    // 归档已存在媒体的来源绑定（播放命中后补 peer/mid，不重新下载）；阶段 3 接入
    if (method === 'POST' && url.pathname === '/api/archive/bind') {
      sendJson(501, { error: 'bind is not wired yet' })
      return true
    }
  } catch (error) {
    sendJson(400, { error: (error as Error).message })
    return true
  }

  return false
}
