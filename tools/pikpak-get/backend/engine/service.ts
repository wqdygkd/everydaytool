import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { PikpakEngine } from './engine.ts'
// NAS 部署的薄 HTTP 控制面（node:http 零依赖），把 PikpakEngine 包成 JSON 端点。
// 与 Python 引擎的 app.py 端点对齐，token 用 Authorization: Bearer 校验。
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

export interface EngineServiceOptions {
  engine: PikpakEngine
  token: string
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function createEngineService(options: EngineServiceOptions): Server {
  const { engine, token } = options

  return createServer(async (req, res) => {
    try {
      const header = req.headers.authorization ?? ''
      const provided = header.replace(/^Bearer\s+/i, '').trim()
      if (!token || provided !== token) {
        sendJson(res, 401, { detail: 'invalid token' })
        return
      }

      const url = new URL(req.url ?? '/', 'http://localhost')
      const method = req.method ?? 'GET'
      const pathname = url.pathname.replace(/\/+$/, '') || '/'
      const parts = pathname.split('/').filter(Boolean)

      const route = (segments: string[]): Record<string, string> | null => {
        if (segments.length !== parts.length) return null
        const params: Record<string, string> = {}
        for (let i = 0; i < segments.length; i += 1) {
          if (segments[i]!.startsWith(':')) params[segments[i]!.slice(1)] = parts[i]!
          else if (segments[i] !== parts[i]) return null
        }
        return params
      }

      try {
        // auth
        if (method === 'GET' && route(['auth', 'check'])) {
          return sendJson(res, 200, {
            name: 'pikpak-get-engine',
            version: '0.2.0',
            dest: engine.destRoot,
            accounts: (await engine.accounts.list()).length,
            links: (await engine.links.list()).length,
          })
        }

        // accounts
        if (method === 'GET' && route(['accounts'])) return sendJson(res, 200, await engine.accounts.list())
        if (method === 'POST' && route(['accounts', 'login'])) {
          const body = await readJsonBody(req)
          return sendJson(res, 200, await engine.accounts.login(str(body.label), str(body.password)))
        }
        const accountParam = route(['accounts', ':id', 'refresh'])
        if (method === 'POST' && accountParam) return sendJson(res, 200, await engine.accounts.refresh(accountParam.id!))
        const revealParam = route(['accounts', ':id', 'reveal-password'])
        if (method === 'POST' && revealParam) return sendJson(res, 200, { password: await engine.accounts.revealPassword(revealParam.id!) })
        const whoamiParam = route(['accounts', ':id', 'whoami'])
        if (method === 'GET' && whoamiParam) return sendJson(res, 200, await engine.accounts.whoami(whoamiParam.id!))
        const deleteAccountParam = route(['accounts', ':id'])
        if (method === 'DELETE' && deleteAccountParam) return sendJson(res, 200, { deleted: await engine.accounts.logout(deleteAccountParam.id!) })

        // links
        if (method === 'GET' && route(['links'])) return sendJson(res, 200, await engine.links.list())
        if (method === 'POST' && route(['links'])) {
          const body = await readJsonBody(req)
          return sendJson(res, 200, await engine.links.add(str(body.url), typeof body.folder === 'string' ? body.folder : undefined, typeof body.passCode === 'string' ? body.passCode : undefined))
        }
        const linkParam = route(['links', ':id'])
        if (method === 'PATCH' && linkParam) {
          const body = await readJsonBody(req)
          const updated = await engine.links.update(linkParam.id!, { title: typeof body.title === 'string' ? body.title : undefined, folder: typeof body.folder === 'string' ? body.folder : undefined, passCode: typeof body.passCode === 'string' ? body.passCode : undefined, url: typeof body.url === 'string' ? body.url : undefined })
          return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { detail: 'link not found' })
        }
        if (method === 'DELETE' && linkParam) return sendJson(res, 200, { deleted: await engine.links.remove(linkParam.id!) })
        const parseParam = route(['links', ':id', 'parse'])
        if (method === 'POST' && parseParam) {
          const body = await readJsonBody(req)
          return sendJson(res, 200, await engine.parseLink(parseParam.id!, body.force === true))
        }
        const resetParam = route(['links', ':id', 'reset-records'])
        if (method === 'POST' && resetParam) {
          const body = await readJsonBody(req)
          const ids = Array.isArray(body.file_ids) ? body.file_ids.map(String) : []
          return sendJson(res, 200, { reset: await engine.resetRecords(resetParam.id!, ids) })
        }

        // data export / import
        if (method === 'GET' && route(['export'])) return sendJson(res, 200, await engine.exportData())
        if (method === 'POST' && route(['import'])) {
          const body = await readJsonBody(req)
          const files = (body.files ?? {}) as Record<string, string>
          const masterKey = typeof body.masterKey === 'string' ? body.masterKey : undefined
          const count = await engine.importData(files, masterKey)
          return sendJson(res, 200, { imported: count })
        }

        // tasks
        if (method === 'GET' && route(['tasks'])) return sendJson(res, 200, engine.listTasks())
        const taskParam = route(['tasks', ':id'])
        if (method === 'GET' && taskParam) {
          const task = engine.getTask(taskParam.id!)
          return task ? sendJson(res, 200, task) : sendJson(res, 404, { detail: 'task not found' })
        }
        if (method === 'POST' && route(['tasks'])) {
          const body = await readJsonBody(req)
          const task = await engine.createTask(
            str(body.link_id),
            Array.isArray(body.file_ids) ? body.file_ids.map(String) : null,
            typeof body.dest === 'string' ? body.dest : null,
            typeof body.account_id === 'string' ? body.account_id : null,
          )
          engine.enqueue(task.id)
          return sendJson(res, 200, task)
        }
        const cancelParam = route(['tasks', ':id', 'cancel'])
        if (method === 'POST' && cancelParam) return sendJson(res, 200, { cancelled: engine.cancelTask(cancelParam.id!) })

        sendJson(res, 404, { detail: 'not found' })
      } catch (error) {
        sendJson(res, 400, { detail: (error as Error).message })
      }
    } catch (error) {
      sendJson(res, 500, { detail: (error as Error).message })
    }
  })
}
