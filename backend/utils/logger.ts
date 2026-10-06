// 平台级后端基建：所有工具的后端共用。只放与具体工具域无关的能力（日志 / 文件操作 / 数据目录），
// 工具专属逻辑留在各自 tools/<id>/backend/ 内。Node ESM：相对 TS 导入写 .js 运行时后缀。
import process from 'node:process'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogMeta = Record<string, unknown>

function formatMessage(level: LogLevel, message: string, meta?: LogMeta): string {
  const timestamp = new Date().toISOString()
  const suffix = meta ? ` ${JSON.stringify(meta)}` : ''
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${suffix}`
}

export const logger = {
  debug(message: string, meta?: LogMeta): void {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug(formatMessage('debug', message, meta))
    }
  },
  info(message: string, meta?: LogMeta): void {
    // eslint-disable-next-line no-console
    console.info(formatMessage('info', message, meta))
  },
  warn(message: string, meta?: LogMeta): void {
    console.warn(formatMessage('warn', message, meta))
  },
  error(message: string, meta?: LogMeta): void {
    console.error(formatMessage('error', message, meta))
  },
}
