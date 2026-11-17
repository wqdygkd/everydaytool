import type { InjectedScript } from '../../../../shared/interceptor.ts'
import { setLastError } from './state.ts'

const USER_SCRIPT_ID_PREFIX = 'edt-'

export function scriptSupported(): boolean {
  return Boolean(chrome.userScripts?.register)
}

let scriptsSyncChain: Promise<void> = Promise.resolve()

/** 串行化同步：内部先全量注销再注册，并发会互相踩 */
export function syncUserScripts(scripts: InjectedScript[]): Promise<void> {
  if (!scriptSupported()) return scriptsSyncChain
  scriptsSyncChain = scriptsSyncChain
    .then(() => syncUserScriptsNow(scripts))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(`脚本同步失败：${message}`)
    })
  return scriptsSyncChain
}

async function syncUserScriptsNow(scripts: InjectedScript[]): Promise<void> {
  const existing = await chrome.userScripts.getScripts()
  const ourIds = existing
    .filter(script => script.id?.startsWith(USER_SCRIPT_ID_PREFIX))
    .map(script => script.id!)
  if (ourIds.length) {
    await chrome.userScripts.unregister({ ids: ourIds })
  }
  const registrations = scripts
    .filter(script => script.enabled && Array.isArray(script.matches) && script.matches.length && script.code)
    .map(script => ({
      id: `${USER_SCRIPT_ID_PREFIX}${script.id}`,
      matches: script.matches,
      runAt: script.runAt || 'document_start',
      world: (script.world === 'MAIN' ? 'MAIN' : 'USER_SCRIPT') as chrome.userScripts.ExecutionWorld,
      js: [{ code: wrapUserScript(script) }],
    }))
  if (registrations.length) {
    try {
      await chrome.userScripts.register(registrations)
    }
    catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(`脚本注册失败：${message}`)
    }
  }
}

function wrapUserScript(script: InjectedScript): string {
  if (script.world === 'MAIN') return script.code
  const payload = JSON.stringify({ scriptId: script.id })
  return `try {\n${script.code}\n} catch (e) {\n  try { chrome.runtime.sendMessage({ type: 'script-log', meta: ${payload}, level: 'error', message: String((e && e.stack) || e) }); } catch (_) {}\n}\n`
}
