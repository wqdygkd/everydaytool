// MTProto 下载器的运行要求与说明（M3-B）。
// 这里只放文案常量与报告段构造：不连接、不读凭据值。
import type { TelegramFeasibilityReport } from '../../../../shared/telegram-cache.ts'

export const TELEGRAM_MTPROTO_REQUIREMENTS: string[] = [
  '在 .env 配置 TELEGRAM_API_ID / TELEGRAM_API_HASH（来自 my.telegram.org）',
  '运行 pnpm telegram:session 生成 TELEGRAM_SESSION，并粘回 .env',
  '私密链接要求频道/群已在当前账号的对话列表中（access hash 来自会话缓存）',
  '只下载当前账号本来就有权访问的消息媒体，不绕过 Telegram 访问控制',
]

export const TELEGRAM_MTPROTO_NOTES: string[] = [
  '下载使用 teleproto iterDownload 的 offset / limit 续传，完成后校验总大小并计算 SHA-256。',
  '文件引用过期（FILE_REFERENCE_EXPIRED）会自动重新拉取消息并重试一次。',
  '媒体写入归档目录，消息正文（截断 20k 字符）写入同目录 message.json。',
  '会话字符串等价于登录态：只从主进程读取，绝不写入日志或发往渲染层。',
]

/** 供可行性报告直接使用的 MTProto 段；available 由凭据 / 会话是否存在决定 */
export function getTelegramMtprotoReportSection(available: boolean): TelegramFeasibilityReport['mtproto'] {
  return {
    available,
    prerequisites: [...TELEGRAM_MTPROTO_REQUIREMENTS],
    notes: [...TELEGRAM_MTPROTO_NOTES],
  }
}
