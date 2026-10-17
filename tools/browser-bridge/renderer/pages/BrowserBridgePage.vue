<script setup lang="ts">
import BridgeStatusPanel from '../components/BridgeStatusPanel.vue'
import RulesPanel from '../components/RulesPanel.vue'
import TargetsPanel from '../components/TargetsPanel.vue'
import TrafficPanel from '../components/TrafficPanel.vue'
import { useBrowserBridgeStore } from '../stores/browserBridgeStore'
import { BRIDGE_TABS, tabKeyFromPath } from '../tabs'

const route = useRoute()
const router = useRouter()
const store = useBrowserBridgeStore()

// 页签状态由路由驱动（/tools/browser-bridge/:tab）：URL 可深链，前进后退可用
const activeTab = computed(() => tabKeyFromPath(route.path))

const trafficTabLabel = computed(() => (store.traffic.length ? `流量 (${store.traffic.length})` : '流量'))

function switchTab(key: string): void {
  if (key === activeTab.value) return
  const tab = BRIDGE_TABS.find(item => item.key === key)
  if (tab) router.push({ name: tab.routeName })
}

function goToRules(): void {
  router.push({ name: 'tool-browser-bridge-rules' })
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
  <div class="tool-page bridge-page">
    <el-tabs :model-value="activeTab" class="bridge-tabs" @update:model-value="switchTab">
      <el-tab-pane label="状态" name="status">
        <BridgeStatusPanel />
      </el-tab-pane>
      <el-tab-pane label="处理名单" name="targets">
        <TargetsPanel />
      </el-tab-pane>
      <el-tab-pane label="规则" name="rules">
        <RulesPanel />
      </el-tab-pane>
      <el-tab-pane :label="trafficTabLabel" name="traffic">
        <TrafficPanel @create-rule="goToRules" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.bridge-page {
  padding: var(--spacing-lg);
}

.bridge-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--spacing-md);
}
</style>
