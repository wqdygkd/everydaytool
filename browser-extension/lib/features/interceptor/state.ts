import type {
  InjectedScript,
  InterceptorRuleSummary,
  InterceptorTarget,
} from '../../../../shared/interceptor.ts'

export type InterceptorBootstrap = {
  proxyPort?: number | null
  targets?: InterceptorTarget[]
  scripts?: InjectedScript[]
  rules?: InterceptorRuleSummary[]
  proxyDesired?: boolean | null
}

export type InterceptorModuleState = {
  proxyPort: number | null
  targets: InterceptorTarget[]
  scripts: InjectedScript[]
  rules: InterceptorRuleSummary[]
  lastError: string | null
}

export const interceptorState: InterceptorModuleState = {
  proxyPort: null,
  targets: [],
  scripts: [],
  rules: [],
  lastError: null,
}

export function setLastError(message: string | null): void {
  interceptorState.lastError = message
}

export function applyBootstrap(bootstrap: unknown): InterceptorBootstrap {
  const data = (bootstrap && typeof bootstrap === 'object' ? bootstrap : {}) as InterceptorBootstrap
  if (data.proxyPort !== undefined) {
    interceptorState.proxyPort = typeof data.proxyPort === 'number' ? data.proxyPort : null
  }
  if (Array.isArray(data.targets)) interceptorState.targets = data.targets
  if (Array.isArray(data.scripts)) interceptorState.scripts = data.scripts
  if (Array.isArray(data.rules)) interceptorState.rules = data.rules
  interceptorState.lastError = null
  return data
}

export async function getProxyEnabled(): Promise<boolean> {
  const data = await chrome.storage.local.get({ proxyEnabled: false })
  return Boolean(data.proxyEnabled)
}

export async function setProxyEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ proxyEnabled: enabled })
}
