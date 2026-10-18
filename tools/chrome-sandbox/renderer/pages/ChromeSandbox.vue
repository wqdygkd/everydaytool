<script setup lang="ts">
import type { MotionScope } from '@renderer/shared/composables/useGsap'
import { createMotionScope, gsap } from '@renderer/shared/composables/useGsap'
import { invokeIpc, ipcChannels, onIpc } from '../ipc'
import { useSandboxStore } from '../stores/sandboxStore'

const router = useRouter()
function goToHome(): void {
  router.push({ name: 'home' })
}

const store = useSandboxStore()
const ready = ref(false)
const showCreate = ref(false)
const showSettings = ref(false)
const showFingerprint = ref(false)
const showSetup = ref(false)
const channels = ipcChannels()
const rootEl = ref<HTMLElement | null>(null)
let motion: MotionScope | undefined

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

// 页面就绪后：侧栏左滑入 + 状态面板右淡入（尊重 prefers-reduced-motion）
watch(ready, async (r) => {
  if (!r)
    return
  await nextTick()
  motion?.revert()
  const el = rootEl.value
  if (!el)
    return
  motion = createMotionScope(() => {
    gsap.from('.ui-sidebar', { x: -24, autoAlpha: 0, duration: 0.45, ease: 'power3.out', clearProps: 'transform,opacity,visibility' })
    gsap.from('.status-panel', { x: 24, autoAlpha: 0, duration: 0.45, ease: 'power3.out', delay: 0.08, clearProps: 'transform,opacity,visibility' })
  }, el)
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
  motion?.revert()
})
</script>

<template>
  <div ref="rootEl" class="chrome-sandbox-page">
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
        @edit-fingerprint="showFingerprint = true"
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
      @completed="initPage"
      @cancel="goToHome"
    />
  </div>
</template>

<style scoped lang="scss">
/* 侧栏与状态面板的样式已回收至 Sidebar.vue / StatusPanel.vue 及各 UI 组件，
   本页只保留网格布局；GSAP 入场动画选择器同步为 .ui-sidebar */
.chrome-sandbox-page {
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  background: var(--color-app-bg);
}

@media (max-width: 760px) {
  .chrome-sandbox-page {
    grid-template-columns: 1fr;

    :deep(.ui-sidebar) {
      max-height: 280px;
      border-right: 0;
      border-bottom: 1px solid var(--color-border-light);
    }
  }
}
</style>
