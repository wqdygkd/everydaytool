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
</style>
