import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invokeIpc, ipcChannels } from '@renderer/shared/ipc/useIpc.js';
import type {
  Fingerprint,
  Sandbox,
  SandboxCreatePayload,
  SandboxUpdatePayload,
} from '../../../../shared/types.js';

export const useSandboxStore = defineStore('chrome-sandbox/sandbox', () => {
  const sandboxes = ref<Sandbox[]>([]);
  const selectedId = ref<string | null>(null);
  const fingerprint = ref<Fingerprint | null>(null);

  const selectedSandbox = computed(() => findSandbox(selectedId.value));

  function findSandbox(id: string | null): Sandbox | null {
    if (!id) return null;
    return sandboxes.value.find((s) => s.id === id) || null;
  }

  async function loadAll(): Promise<void> {
    sandboxes.value = await invokeIpc<Sandbox[]>(ipcChannels().SANDBOX_GET_ALL);
    if (!selectedId.value && sandboxes.value.length > 0) {
      selectedId.value = sandboxes.value[0]?.id ?? null;
    }
  }

  function select(id: string): void {
    selectedId.value = id;
  }

  async function create(data: SandboxCreatePayload): Promise<Sandbox | null> {
    const sandbox = await invokeIpc<Sandbox | null>(ipcChannels().SANDBOX_CREATE, data);
    await loadAll();
    selectedId.value = sandbox?.id ?? null;
    return sandbox;
  }

  async function activate(id: string | null): Promise<void> {
    if (!id) return;
    await invokeIpc(ipcChannels().SANDBOX_ACTIVATE, id);
    await loadAll();
  }

  async function close(id: string | null): Promise<void> {
    if (!id) return;
    await invokeIpc(ipcChannels().SANDBOX_CLOSE, id);
    await loadAll();
  }

  async function remove(id: string): Promise<void> {
    await invokeIpc(ipcChannels().SANDBOX_DELETE, id);
    if (selectedId.value === id) selectedId.value = null;
    await loadAll();
  }

  async function update(id: string, data: SandboxUpdatePayload): Promise<void> {
    await invokeIpc(ipcChannels().SANDBOX_UPDATE, id, data);
    await loadAll();
  }

  async function loadFingerprint(sandboxId: string | null): Promise<void> {
    const sandbox = findSandbox(sandboxId);
    if (!sandbox?.fingerprintId) {
      fingerprint.value = null;
      return;
    }
    fingerprint.value = await invokeIpc<Fingerprint | null>(
      ipcChannels().FINGERPRINT_GET_BY_ID,
      sandbox.fingerprintId,
    );
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
  };
});
