<script setup lang="ts">
import { useNavigation } from '@renderer/shared/composables/useNavigation'
import { invokeIpc, ipcChannels, onIpc } from '@renderer/shared/ipc/useIpc'
import { useSandboxStore } from '../stores/sandboxStore'

const { goToHome } = useNavigation()
const store = useSandboxStore()
const ready = ref(false)
const showCreate = ref(false)
const showSettings = ref(false)
const showFingerprint = ref(false)
const showSetup = ref(false)
const channels = ipcChannels()

function openFingerprintEditor() {
  showFingerprint.value = true
}

async function deleteSandbox() {
  if (!store.selectedId) return
  try {
    await store.remove(store.selectedId)
  } catch (error) {
    ElMessage.error(error.message || '删除失败')
  }
}

watch(() => store.selectedId, (id) => {
  if (id) store.loadFingerprint(id)
})

const unsubscribers = []

async function initPage() {
  await store.loadAll()
  unsubscribers.push(
    onIpc(channels.EVENT_STATUS_CHANGED, () => store.loadAll()),
    onIpc(channels.EVENT_PROCESS_EXITED, () => store.loadAll()),
  )
  ready.value = true
}

async function onSetupCompleted() {
  await initPage()
}

async function onSettingsSaved(result) {
  if (result.dataDirectoryChanged) {
    await store.loadAll()
  }
}

onMounted(async () => {
  const config = await invokeIpc(channels.CONFIG_GET)
  if (!config.dataDirectoryConfigured) {
    showSetup.value = true
    return
  }
  await initPage()
})

onUnmounted(() => {
  unsubscribers.forEach(off => off())
})
</script>

<template>
  <div class="chrome-sandbox-page">
    <template v-if="ready">
      <Sidebar
        :sandboxes="store.sandboxes"
        :selected-id="store.selectedId"
        @select="store.select"
        @create="showCreate = true"
        @settings="showSettings = true"
      />

      <StatusPanel
        :sandbox="store.selectedSandbox"
        :fingerprint="store.fingerprint"
        @activate="store.activate(store.selectedId)"
        @close="store.close(store.selectedId)"
        @delete="deleteSandbox"
        @edit-fingerprint="openFingerprintEditor"
      />

      <CreateDialog v-model="showCreate" />
      <SettingsDialog v-model="showSettings" @saved="onSettingsSaved" />
      <FingerprintEditor
        v-model="showFingerprint"
        :fingerprint="store.fingerprint"
        :sandbox-id="store.selectedId"
        @saved="store.loadFingerprint(store.selectedId)"
      />
    </template>

    <DataDirectorySetupDialog
      v-model="showSetup"
      @completed="onSetupCompleted"
      @cancel="goToHome"
    />
  </div>
</template>

<style scoped lang="scss">
.chrome-sandbox-page {
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  background: var(--color-app-bg);

  :deep(.sidebar) {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    padding: 18px 14px;
    border-right: 1px solid var(--color-border-light);
    background: var(--color-surface-raised);
  }

  :deep(.sidebar-title) {
    margin-bottom: 14px;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }

  :deep(.sandbox-list) {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow-y: auto;
  }

  :deep(.sandbox-list .empty-tip) {
    padding: var(--spacing-lg);
    text-align: center;
  }

  :deep(.sidebar-actions) {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 14px;
  }

  :deep(.sidebar-actions .el-button),
  :deep(.action-bar .el-button) {
    margin-left: 0;
  }

  :deep(.full-width) {
    width: 100%;
  }

  :deep(.sandbox-card) {
    padding: 14px;
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-base);
  }

  :deep(.sandbox-card:hover),
  :deep(.sandbox-card.active) {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
    box-shadow: var(--shadow-sm);
  }

  :deep(.card-header) {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: 6px;
  }

  :deep(.color-dot) {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  :deep(.name) {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
  }

  :deep(.card-meta) {
    display: flex;
    justify-content: space-between;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }

  :deep(.status.running) {
    color: var(--color-success);
  }

  :deep(.status-panel) {
    flex: 1;
    min-height: 0;
    padding: 24px;
    overflow: auto;
  }

  :deep(.panel-header) {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-xl);
  }

  :deep(.panel-header h2) {
    margin: 0;
  }

  :deep(.detail-grid) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 24px;
  }

  :deep(.detail-item) {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--spacing-md);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-lg);
    background: var(--color-surface-raised);
    font-size: var(--font-size-sm);
  }

  :deep(.detail-item span) {
    color: var(--color-text-secondary);
  }

  :deep(.detail-item .path) {
    font-size: var(--font-size-xs);
    word-break: break-all;
  }

  :deep(.section-block) {
    margin-bottom: var(--spacing-lg);
    padding: var(--spacing-lg);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-lg);
    background: var(--color-surface-raised);
  }

  :deep(.section-block h3) {
    margin: 0 0 10px;
    font-size: var(--font-size-base);
  }

  :deep(.fingerprint-summary p) {
    margin: 4px 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }

  :deep(.action-bar) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-sm);
    padding-bottom: var(--spacing-lg);
    border-bottom: 1px solid var(--color-border-light);
  }

  :deep(.empty-tip),
  :deep(.empty-panel),
  :deep(.muted) {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }
}

@media (max-width: 760px) {
  .chrome-sandbox-page {
    grid-template-columns: 1fr;

    :deep(.sidebar) {
      max-height: 280px;
      border-right: 0;
      border-bottom: 1px solid var(--color-border-light);
    }

    :deep(.detail-grid) {
      grid-template-columns: 1fr;
    }
  }
}
</style>
