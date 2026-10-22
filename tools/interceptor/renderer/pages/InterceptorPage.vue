<script setup lang="ts">
import InterceptorStatusPanel from '../components/InterceptorStatusPanel.vue'
import RulesPanel from '../components/RulesPanel.vue'
import TargetsPanel from '../components/TargetsPanel.vue'
import TrafficPanel from '../components/TrafficPanel.vue'
import { useInterceptorStore } from '../stores/interceptorStore'
import { INTERCEPTOR_TABS, tabKeyFromPath } from '../tabs'

const route = useRoute()
const router = useRouter()
const store = useInterceptorStore()

// 视图状态仍由路由驱动（/tools/interceptor/:tab）：URL 可深链，前进后退可用
const activeTab = computed(() => tabKeyFromPath(route.path))

const PANELS = {
  status: InterceptorStatusPanel,
  targets: TargetsPanel,
  rules: RulesPanel,
  traffic: TrafficPanel,
} as const

const activePanel = computed(() => PANELS[activeTab.value])

// 视图切换走 UiMenuHorizontal（复刻 Telegram Web K 的横向菜单）：流量条数用徽章显示
const menuItems = computed(() => INTERCEPTOR_TABS.map(tab => ({
  value: tab.key as string,
  label: tab.label,
  badge: tab.key === 'traffic' ? store.traffic.length : undefined,
})))

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
    await store.init()
  } catch {
    // 网页预览（非 Electron）无 IPC：保持空态即可
  }
})

onUnmounted(() => {
  store.dispose()
})
</script>

<template>
  <div class="tool-page interceptor-page">
    <div class="view-switcher">
      <UiMenuHorizontal :model-value="activeTab" :items="menuItems" @update:model-value="switchTab" />
    </div>

    <!-- 切换保留各视图状态（规则草稿 / 流量筛选不因切走而丢） -->
    <KeepAlive>
      <component :is="activePanel" @create-rule="goToRules" />
    </KeepAlive>
  </div>
</template>

<style scoped>
.interceptor-page {
  padding: var(--spacing-lg);
}

.view-switcher {
  margin-bottom: var(--spacing-md);
}
</style>
