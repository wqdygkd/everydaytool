// Telegram 消息链接解析（纯函数）：支持公开频道与私密 `t.me/c/<channelId>/<msg>`。
// 不接受邀请链接（`/+hash`）——那需要先加入，无法定位消息。
export interface ParsedMessageLink {
  source: 'public' | 'private'
  username?: string
  channelId?: string
  messageId: number
  topicId?: number
}

const ALLOWED_HOSTS = new Set(['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'])

function toPositiveInt(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,12}$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export function parseMessageLink(raw: string): ParsedMessageLink | null {
  const input = typeof raw === 'string' ? raw.trim() : ''
  if (!input) return null

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }

  // tg://resolve?domain=name&post=123
  if (url.protocol === 'tg:') {
    const domain = url.searchParams.get('domain')
    const post = toPositiveInt(url.searchParams.get('post') ?? undefined)
    if (!domain || !post) return null
    if (!/^\w{3,32}$/.test(domain)) return null
    return { source: 'public', username: domain.toLowerCase(), messageId: post }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null

  if (segments[0].toLowerCase() === 'c') {
    const channelId = segments[1]
    const messageId = toPositiveInt(segments[2])
    if (!channelId || !/^\d{5,20}$/.test(channelId) || !messageId) return null
    const topicId = toPositiveInt(segments[3])
    return { source: 'private', channelId, messageId, ...(topicId ? { topicId } : {}) }
  }

  const username = segments[0]
  if (!/^\w{3,32}$/.test(username)) return null
  const messageId = toPositiveInt(segments[1])
  if (!messageId) return null
  const topicId = toPositiveInt(segments[2])
  return { source: 'public', username: username.toLowerCase(), messageId, ...(topicId ? { topicId } : {}) }
}
