<script setup lang="ts">
import { useToolPaneActive } from '@renderer/shared/components/ui/overlay-target'
import { useToolPath } from '@renderer/shared/composables/useToolPath'
import { toast } from 'vue-sonner'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceSpine from '../../../../renderer/shared/components/workspace/WorkspaceSpine.vue'
import InterceptorStatusPanel from '../components/InterceptorStatusPanel.vue'
import RulesPanel from '../components/RulesPanel.vue'
import TargetsPanel from '../components/TargetsPanel.vue'
import TrafficPanel from '../components/TrafficPanel.vue'
import { useInterceptorStore } from '../stores/interceptorStore'
import { INTERCEPTOR_TABS, tabKeyFromPath } from '../tabs'

const router = useRouter()
const store = useInterceptorStore()
const toolPath = useToolPath()
const paneActive = useToolPaneActive()

const activeTab = computed(() => tabKeyFromPath(toolPath.value))

const PANELS = {
  status: InterceptorStatusPanel,
  targets: TargetsPanel,
  rules: RulesPanel,
  traffic: TrafficPanel,
} as const

const activePanel = computed(() => PANELS[activeTab.value])

const spineItems = computed(() => INTERCEPTOR_TABS.map(tab => ({
  key: tab.key as string,
  label: tab.label,
  count: tab.key === 'targets'
    ? store.targets.length
    : tab.key === 'rules'
      ? store.rules.length
      : tab.key === 'traffic'
        ? store.traffic.length
        : undefined,
})))

const connections = computed(() => store.status?.connections ?? [])
const proxyEnabled = computed(() => connections.value.some(connection => connection.proxyEnabled))

const statusLabel = computed(() => {
  if (store.status?.proxyRunning) return '代理运行中'
  return store.status?.connections.length ? '等待挂载' : '未连接浏览器'
})

const statusTone = computed<'neutral' | 'success' | 'warning'>(() => {
  if (store.status?.proxyRunning) return 'success'
  return store.status?.connections.length ? 'warning' : 'neutral'
})

function switchTab(key: string): void {
  if (key === activeTab.value) return
  const tab = INTERCEPTOR_TABS.find(item => item.key === key)
  if (tab) router.push({ name: tab.routeName })
}

async function applyProxy(enabled: boolean): Promise<void> {
  try {
    const applied = await store.setProxyDesired(enabled)
    if (!applied) toast.warning('没有已连接的浏览器（先在 Chrome 中打开扩展）')
    else toast.success(enabled ? '已通知浏览器挂载代理' : '已通知浏览器恢复直连')
  } catch (error) {
    toast.error((error as Error).message || '切换代理失败')
  }
}

async function refresh(): Promise<void> {
  try {
    await store.refresh()
  } catch (error) {
    toast.error((error as Error).message || '刷新失败')
  }
}

onMounted(async () => {
  try {
    await store.activateRuntime()
    await store.init()
  } catch {
    // 网页预览（非 Electron）无 IPC：保持空态即可
  }
})

onUnmounted(() => {
  store.dispose()
  void store.deactivateRuntime().catch(() => undefined)
})
</script>

<template>
  <div class="interceptor-page tool-page">
    <Teleport v-if="paneActive" defer to="#app-topbar-state">
      <span class="tb-state" :class="`is-${statusTone}`">
        <i class="tb-dot" />
        {{ statusLabel }}
      </span>
    </Teleport>

    <Teleport v-if="paneActive" defer to="#app-topbar-actions">
      <UiButton size="small" :disabled="!connections.length || !proxyEnabled" @click="applyProxy(false)">
        恢复直连
      </UiButton>
      <UiButton size="small" type="primary" :disabled="!connections.length" @click="applyProxy(true)">
        挂载代理
      </UiButton>
    </Teleport>

    <ToolSurface class="interceptor-surface">
      <template #spine>
        <WorkspaceSpine
          :model-value="activeTab"
          :items="spineItems"
          @update:model-value="switchTab"
        />
      </template>

      <template #toolbar>
        <div id="interceptor-toolbar" class="interceptor-toolbar">
          <template v-if="activeTab === 'status'">
            <span class="bar-state" :class="`is-${statusTone}`">
              <i class="bar-dot" />
              {{ store.status?.proxyRunning ? '代理运行中' : '代理未运行' }}
            </span>
            <span class="toolbar-summary mono">
              {{ store.targets.length }} origins · {{ store.rules.length }} rules
            </span>
            <span class="toolbar-spacer" />
            <UiIconButton icon="refresh" label="刷新状态" @click="refresh" />
          </template>
        </div>
      </template>

      <div class="panel-host" :class="{ 'is-scroll': activeTab === 'rules' }">
        <component :is="activePanel" @create-rule="switchTab('rules')" />
      </div>
    </ToolSurface>
  </div>
</template>

<style scoped lang="scss">
.interceptor-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.interceptor-surface {
  min-height: 0;
}

.interceptor-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 1;
  min-width: 0;
  height: 100%;
}

.toolbar-spacer {
  flex: 1;
}

.toolbar-summary {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.tb-state,
.bar-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.tb-dot,
.bar-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
}

.tb-state.is-success,
.bar-state.is-success {
  color: var(--color-success);

  .tb-dot,
  .bar-dot {
    background: var(--color-success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 14%, transparent);
  }
}

.tb-state.is-warning,
.bar-state.is-warning {
  color: var(--color-warning);

  .tb-dot,
  .bar-dot {
    background: var(--color-warning);
  }
}

.panel-host {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;

  > :deep(*) {
    flex: 1;
    min-height: 0;
  }

  &.is-scroll {
    overflow-y: auto;

    > :deep(*) {
      flex: 0 0 auto;
      min-height: min-content;
      padding: 14px;
    }
  }
}
</style>
