<script setup lang="ts">
import { useToolPaneActive } from '@renderer/shared/components/ui/overlay-target'
import { toast } from 'vue-sonner'
import ToolFormPane from '../../../../renderer/shared/components/workspace/ToolFormPane.vue'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import ConnectionAccountsPane from '../components/ConnectionAccountsPane.vue'
import LinksPane from '../components/LinksPane.vue'
import ParsePane from '../components/ParsePane.vue'
import TasksDrawer from '../components/TasksDrawer.vue'
import { usePikpakGetStore } from '../stores/pikpakGetStore'

const store = usePikpakGetStore()
const paneActive = useToolPaneActive()

const tasksOpen = ref(false)

const connected = computed(() => Boolean(store.connection))
const connectionName = computed(() => store.connection?.name ?? '未连接引擎')
const selectedCount = computed(() => store.selectedCount)
const activeTaskCount = computed(() => store.activeTasks.length)

async function testConnection(): Promise<void> {
  try {
    await store.testConnection()
    toast.success('引擎连接正常')
  } catch (error) {
    toast.error((error as Error).message || '引擎连接失败')
  }
}

async function downloadSelected(): Promise<void> {
  if (!store.parse || !store.selectedFileIds.length) {
    toast.warning('请先在左侧选择分享链接，并勾选要下载的文件')
    return
  }
  try {
    await store.startDownload({ linkId: store.parse.linkId, fileIds: store.selectedFileIds })
    tasksOpen.value = true
    toast.success('下载任务已提交到引擎')
  } catch (error) {
    toast.error((error as Error).message || '提交任务失败')
  }
}

onMounted(async () => {
  try {
    await store.init()
  } catch {
    // 网页预览（无 IPC）或未配置引擎：保持空态，由左栏引导配置
  }
})

onUnmounted(() => {
  store.dispose()
})
</script>

<template>
  <div class="pikpak-get-page tool-page">
    <Teleport v-if="paneActive" defer to="#app-topbar-state">
      <span class="tb-state" :class="connected ? 'is-ok' : 'is-off'">
        <i class="tb-dot" />
        {{ connectionName }}
      </span>
    </Teleport>

    <Teleport v-if="paneActive" defer to="#app-topbar-actions">
      <UiButton size="small" :disabled="!activeTaskCount" @click="tasksOpen = !tasksOpen">
        下载任务{{ activeTaskCount ? `（${activeTaskCount}）` : '' }}
      </UiButton>
      <UiButton type="primary" size="small" :disabled="!selectedCount" @click="downloadSelected">
        下载选中{{ selectedCount ? `（${selectedCount}）` : '' }}
      </UiButton>
      <UiIconButton v-if="connected" icon="refresh" label="测试引擎连接" @click="testConnection" />
    </Teleport>

    <ToolSurface class="pikpak-get-surface">
      <div class="workspace">
        <ToolFormPane title="PikPak 下载">
          <ConnectionAccountsPane />
          <LinksPane />
        </ToolFormPane>
        <ParsePane @download-started="tasksOpen = true" />
      </div>
      <TasksDrawer v-model="tasksOpen" />
    </ToolSurface>
  </div>
</template>

<style scoped lang="scss">
.pikpak-get-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.pikpak-get-surface {
  min-height: 0;
}

.workspace {
  display: flex;
  flex: 1;
  flex-direction: row;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.tb-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.tb-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
}

.tb-state.is-ok {
  color: var(--color-success);

  .tb-dot {
    background: var(--color-success);
  }
}

.tb-state.is-off {
  color: var(--color-warning);

  .tb-dot {
    background: var(--color-warning);
  }
}
</style>
