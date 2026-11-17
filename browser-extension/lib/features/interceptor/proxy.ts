import {
  EDT_EXTENSION_WS_PORT_BASE,
  EDT_EXTENSION_WS_PORT_RANGE,
} from '../../../../shared/extension.ts'

const PROXY_SCOPE = 'regular'

export function setBadge(enabled: boolean): void {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' }).catch(() => {})
  chrome.action.setBadgeBackgroundColor({ color: enabled ? '#10b981' : '#707579' }).catch(() => {})
}

export function buildBypassList(): string[] {
  const list = ['<-loopback>']
  for (let i = 0; i < EDT_EXTENSION_WS_PORT_RANGE; i++) {
    list.push(`127.0.0.1:${EDT_EXTENSION_WS_PORT_BASE + i}`)
    list.push(`localhost:${EDT_EXTENSION_WS_PORT_BASE + i}`)
  }
  return list
}

export async function applyProxy(proxyPort: number): Promise<void> {
  await chrome.proxy.settings.set({
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: 'http', host: '127.0.0.1', port: proxyPort },
        bypassList: buildBypassList(),
      },
    },
    scope: PROXY_SCOPE,
  })
  setBadge(true)
}

/** 仅撤掉本扩展挂的代理，不碰企业策略 / 用户手动 */
export async function removeProxy(): Promise<void> {
  try {
    const current = await chrome.proxy.settings.get({ incognito: false })
    if (current.levelOfControl === 'controlled_by_this_extension') {
      await chrome.proxy.settings.clear({ scope: PROXY_SCOPE })
    }
  }
  catch {
    // clear 失败也不阻塞；下次启用会覆盖
  }
  setBadge(false)
}
