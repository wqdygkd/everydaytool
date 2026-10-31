// 归档引擎的实现与注册（telegram-cache 侧）。
//
// 存储层（message-store / message-library / trash / media-resolver / site-server）留在本工具内，
// 通过 backend/telegram-archive/engine.ts 的平台契约交给 tweb-cache 复用：
// 每个调用都带 scope（工具 id），存储层据此解析到各自的 `<assets>/<scope>/messages`。
// 作用域用 AsyncLocalStorage 传递（backend/telegram-archive/scope.ts），所以两个工具互不覆盖。
import type { ArchiveEngine, ArchiveSiteOptions } from '../../../../backend/telegram-archive/engine.ts'
import { existsSync } from 'node:fs'
import { shell } from 'electron'
import { registerTelegramArchiveEngine } from '../../../../backend/telegram-archive/engine.ts'
import { runInArchiveScope, runSyncInArchiveScope } from '../../../../backend/telegram-archive/scope.ts'
import { getTelegramMessagesRoot } from '../utils/paths.ts'
import { handleTelegramArchiveApi } from './archive-api.ts'
import { getTelegramMediaStatuses, resolveTelegramMedia } from './media-resolver.ts'
import { listTelegramLibrary } from './message-library.ts'
import {
  listTelegramMessageMedia,
  normalizeTelegramLibrary,
  telegramMessageDir,
} from './message-store.ts'
import { TelegramSiteServer } from './site-server.ts'
import {
  emptyTelegramTrash,
  listTelegramTrash,
  moveTelegramMessageToTrash,
  restoreTelegramTrash,
} from './trash-service.ts'

/** 把一次调用放进指定工具作用域里执行 */
function inScope<T>(scope: string, fn: () => Promise<T> | T): Promise<T> {
  return runInArchiveScope(scope, fn)
}

async function startSite(scope: string, options: ArchiveSiteOptions) {
  const server = new TelegramSiteServer({
    rootDir: options.rootDir,
    extraRootDir: options.extraRootDir,
    port: options.port,
    portRange: options.portRange,
    apiVersion: options.apiVersion,
    // 媒体解析与归档 API 都按「起这个站点的工具」解析存储
    resolveMedia: mediaKey => inScope(scope, () => resolveTelegramMedia(mediaKey)),
    getMediaStatus: keys => inScope(scope, () => getTelegramMediaStatuses(keys)),
    handleApi: context => inScope(scope, () => handleTelegramArchiveApi(context)),
  })
  const info = await server.start()
  return {
    url: info.url,
    port: info.port,
    token: info.token,
    stop: () => server.stop(),
  }
}

const engine: ArchiveEngine = {
  startSite,
  getSiteMediaStatus: (scope, keys) => inScope(scope, () => getTelegramMediaStatuses(keys)),
  listLibrary: scope => inScope(scope, () => listTelegramLibrary()),
  listMessageMedia: (scope, peerId, messageId) => inScope(scope, () => listTelegramMessageMedia(peerId, messageId)),
  normalizeLibrary: scope => inScope(scope, () => normalizeTelegramLibrary()),
  deleteMessage: (scope, peerId, messageId) => inScope(scope, async () => {
    await moveTelegramMessageToTrash(peerId, messageId)
    return { state: 'missing' as const }
  }),
  revealMessageDir: (scope, peerId, messageId) => inScope(scope, () => {
    const dir = telegramMessageDir(peerId, messageId)
    if (!existsSync(dir)) throw new Error('本地没有该消息缓存')
    shell.showItemInFolder(dir)
  }),
  listTrash: scope => inScope(scope, () => listTelegramTrash()),
  restoreTrash: (scope, trashId) => inScope(scope, async () => {
    const restored = await restoreTelegramTrash(trashId)
    return { state: restored.state }
  }),
  emptyTrash: (scope, olderThanDays) => inScope(scope, () => emptyTelegramTrash(olderThanDays)),
  getMessagesRoot: scope => runSyncInArchiveScope(scope, () => getTelegramMessagesRoot()),
}

/** 幂等：后端 initialize 时调用一次，之后其它工具即可通过平台层取用 */
export function registerArchiveEngine(): void {
  registerTelegramArchiveEngine(engine)
}
