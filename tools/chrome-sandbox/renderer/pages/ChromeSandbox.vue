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

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useNavigation } from '@renderer/shared/composables/useNavigation.js';
import Sidebar from '../components/Sidebar.vue';
import StatusPanel from '../components/StatusPanel.vue';
import CreateDialog from '../components/CreateDialog.vue';
import SettingsDialog from '../components/SettingsDialog.vue';
import FingerprintEditor from '../components/FingerprintEditor.vue';
import DataDirectorySetupDialog from '../components/DataDirectorySetupDialog.vue';
import { useSandboxStore } from '../stores/sandboxStore.js';
import { invokeIpc, ipcChannels, onIpc } from '@renderer/shared/ipc/useIpc.js';

const { goToHome } = useNavigation();
const store = useSandboxStore();
const ready = ref(false);
const showCreate = ref(false);
const showSettings = ref(false);
const showFingerprint = ref(false);
const showSetup = ref(false);
const channels = ipcChannels();

function openFingerprintEditor() {
  showFingerprint.value = true;
}

async function deleteSandbox() {
  if (!store.selectedId) return;
  try {
    await store.remove(store.selectedId);
  } catch (error) {
    ElMessage.error(error.message || '删除失败');
  }
}

watch(() => store.selectedId, (id) => {
  if (id) store.loadFingerprint(id);
});

const unsubscribers = [];

async function initPage() {
  await store.loadAll();
  unsubscribers.push(
    onIpc(channels.EVENT_STATUS_CHANGED, () => store.loadAll()),
    onIpc(channels.EVENT_PROCESS_EXITED, () => store.loadAll()),
  );
  ready.value = true;
}

async function onSetupCompleted() {
  await initPage();
}

async function onSettingsSaved(result) {
  if (result.dataDirectoryChanged) {
    await store.loadAll();
  }
}

onMounted(async () => {
  const config = await invokeIpc(channels.CONFIG_GET);
  if (!config.dataDirectoryConfigured) {
    showSetup.value = true;
    return;
  }
  await initPage();
});

onUnmounted(() => {
  unsubscribers.forEach((off) => off());
});
</script>

<style scoped>
.chrome-sandbox-page {
  display: grid;
  grid-template-columns: 220px 1fr;
  flex: 1;
  min-height: 0;
}

.chrome-sandbox-page :deep(.sidebar) {
  background: var(--color-surface);
  border-right: 1px solid var(--color-border-light);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: var(--spacing-lg) var(--spacing-md);
}

.chrome-sandbox-page :deep(.sidebar-title) {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-md);
}

.chrome-sandbox-page :deep(.sandbox-list) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.chrome-sandbox-page :deep(.sandbox-list .empty-tip) {
  text-align: center;
  padding: var(--spacing-lg);
}

.chrome-sandbox-page :deep(.sidebar-actions) {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}

.chrome-sandbox-page :deep(.sidebar-actions .el-button),
.chrome-sandbox-page :deep(.action-bar .el-button) {
  margin-left: 0;
}

.chrome-sandbox-page :deep(.full-width) {
  width: 100%;
}

.chrome-sandbox-page :deep(.sandbox-card) {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md);
  cursor: pointer;
  background: #fafafa;
  transition: var(--transition-base);
}

.chrome-sandbox-page :deep(.sandbox-card:hover),
.chrome-sandbox-page :deep(.sandbox-card.active) {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.chrome-sandbox-page :deep(.card-header) {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: 6px;
}

.chrome-sandbox-page :deep(.color-dot) {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.chrome-sandbox-page :deep(.name) {
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-base);
}

.chrome-sandbox-page :deep(.card-meta) {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.chrome-sandbox-page :deep(.status.running) {
  color: var(--color-success);
}

.chrome-sandbox-page :deep(.status-panel) {
  flex: 1;
  min-height: 0;
  padding: var(--spacing-xl);
  overflow: auto;
}

.chrome-sandbox-page :deep(.panel-header) {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-xl);
}

.chrome-sandbox-page :deep(.panel-header h2) {
  margin: 0;
}

.chrome-sandbox-page :deep(.detail-grid) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-xl);
}

.chrome-sandbox-page :deep(.detail-item) {
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--font-size-sm);
}

.chrome-sandbox-page :deep(.detail-item span) {
  color: var(--color-text-secondary);
}

.chrome-sandbox-page :deep(.detail-item .path) {
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.chrome-sandbox-page :deep(.section-block) {
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  margin-bottom: var(--spacing-lg);
}

.chrome-sandbox-page :deep(.section-block h3) {
  margin: 0 0 10px;
  font-size: var(--font-size-base);
}

.chrome-sandbox-page :deep(.fingerprint-summary p) {
  margin: 4px 0;
  font-size: var(--font-size-sm);
  color: #374151;
}

.chrome-sandbox-page :deep(.action-bar) {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  padding-bottom: var(--spacing-lg);
  border-bottom: 1px solid var(--color-border-light);
}

.chrome-sandbox-page :deep(.empty-tip),
.chrome-sandbox-page :deep(.empty-panel),
.chrome-sandbox-page :deep(.muted) {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}
</style>
