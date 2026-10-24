import type {
  Fingerprint,
  Sandbox,
  SandboxCreatePayload,
  SandboxUpdatePayload,
} from '../../../shared/sandbox'
import { commands, invokeCommand } from '../api'

export const useSandboxStore = defineStore('chrome-sandbox/sandbox', () => {
  const sandboxes = ref<Sandbox[]>([])
  const selectedId = ref<string | null>(null)
  const fingerprint = ref<Fingerprint | null>(null)

  const selectedSandbox = computed(() => findSandbox(selectedId.value))

  function findSandbox(id: string | null): Sandbox | null {
    if (!id) return null
    return sandboxes.value.find(s => s.id === id) || null
  }

  async function loadAll(): Promise<void> {
    sandboxes.value = await invokeCommand<Sandbox[]>(commands().SANDBOX_GET_ALL)
    if (!selectedId.value && sandboxes.value.length > 0) {
      selectedId.value = sandboxes.value[0]?.id ?? null
    }
  }

  function select(id: string): void {
    selectedId.value = id
  }

  async function create(data: SandboxCreatePayload): Promise<Sandbox | null> {
    const sandbox = await invokeCommand<Sandbox | null>(commands().SANDBOX_CREATE, data)
    await loadAll()
    selectedId.value = sandbox?.id ?? null
    return sandbox
  }

  async function activate(id: string | null): Promise<void> {
    if (!id) return
    await invokeCommand(commands().SANDBOX_ACTIVATE, id)
    await loadAll()
  }

  async function close(id: string | null): Promise<void> {
    if (!id) return
    await invokeCommand(commands().SANDBOX_CLOSE, id)
    await loadAll()
  }

  async function remove(id: string): Promise<void> {
    await invokeCommand(commands().SANDBOX_DELETE, id)
    if (selectedId.value === id) selectedId.value = null
    await loadAll()
  }

  async function update(id: string, data: SandboxUpdatePayload): Promise<void> {
    await invokeCommand(commands().SANDBOX_UPDATE, id, data)
    await loadAll()
  }

  async function loadFingerprint(sandboxId: string | null): Promise<void> {
    const sandbox = findSandbox(sandboxId)
    if (!sandbox?.fingerprintId) {
      fingerprint.value = null
      return
    }
    fingerprint.value = await invokeCommand<Fingerprint | null>(
      commands().FINGERPRINT_GET_BY_ID,
      sandbox.fingerprintId,
    )
  }

  return {
    sandboxes,
    selectedId,
    selectedSandbox,
    fingerprint,
    loadAll,
    select,
    create,
    activate,
    close,
    remove,
    update,
    loadFingerprint,
  }
})
