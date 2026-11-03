<script setup lang="ts">
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceHeader from '../../../../renderer/shared/components/workspace/WorkspaceHeader.vue'
import InterceptorStatusPanel from '../components/InterceptorStatusPanel.vue'
import RulesPanel from '../components/RulesPanel.vue'
import TargetsPanel from '../components/TargetsPanel.vue'
import TrafficPanel from '../components/TrafficPanel.vue'
import { useInterceptorStore } from '../stores/interceptorStore'
import { INTERCEPTOR_TABS, tabKeyFromPath } from '../tabs'

const route = useRoute()
const router = useRouter()
const store = useInterceptorStore()

const activeTab = computed(() => tabKeyFromPath(route.path))

const PANELS = {
  status: InterceptorStatusPanel,
  targets: TargetsPanel,
  rules: RulesPanel,
  traffic: TrafficPanel,
} as const

const activePanel = computed(() => PANELS[activeTab.value])

const menuItems = computed(() => INTERCEPTOR_TABS.map(tab => ({
  value: tab.key as string,
  label: tab.label,
  badge: tab.key === 'traffic' ? store.traffic.length : undefined,
})))

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

function goToRules(): void {
  router.push({ name: 'tool-interceptor-rules' })
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
    <WorkspaceHeader
      icon="intercept"
      title="拦截器"
      description="本地 MITM 代理：改包、Mock、注入与流量日志"
      :status-label="statusLabel"
      :status-tone="statusTone"
    />

    <ToolSurface class="interceptor-surface">
      <template #toolbar>
        <UiMenuHorizontal
          class="interceptor-tabs"
          :model-value="activeTab"
          :items="menuItems"
          @update:model-value="switchTab"
        />
        <span class="toolbar-spacer" />
        <span class="toolbar-summary mono">
          {{ store.targets.length }} origins · {{ store.rules.length }} rules
        </span>
      </template>

      <div class="panel-host" :class="{ 'is-scroll': activeTab === 'rules' }">
        <KeepAlive>
          <component :is="activePanel" @create-rule="goToRules" />
        </KeepAlive>
      </div>
    </ToolSurface>
  </div>
</template>

<style scoped lang="scss">
.interceptor-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 18px 18px;
  overflow: hidden;
}

.interceptor-surface {
  min-height: 0;
}

.interceptor-tabs {
  flex: 0 0 auto;
  width: auto;
  max-width: 520px;
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
