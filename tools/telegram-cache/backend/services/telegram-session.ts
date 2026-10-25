// telegram-cache 的 session 分区：webview、webRequest 观测与 session.fetch 下载共用同一份
// cookie / 代理 / 缓存上下文。单独成文件，避免 observation / download / probe 互相循环引用。
import { session as electronSession } from 'electron'
import { TELEGRAM_WEBVIEW_PARTITION } from '../../../../shared/webview.ts'

export function getTelegramSession(): Electron.Session {
  return electronSession.fromPartition(TELEGRAM_WEBVIEW_PARTITION)
}
