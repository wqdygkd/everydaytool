<script setup lang="ts">
import type { Component } from 'vue'
import type { OfflinePackTabKey } from '../tabs'
import ChromeDownloader from '../components/ChromeDownloader.vue'
import DockerDownloader from '../components/DockerDownloader.vue'
import EdgeDownloader from '../components/EdgeDownloader.vue'
import HistorySection from '../components/HistorySection.vue'
import MSStoreDownloader from '../components/MSStoreDownloader.vue'
import VSCodeDownloader from '../components/VSCodeDownloader.vue'
import { OFFLINE_PACK_TABS, tabKeyFromPath } from '../tabs'

const route = useRoute()
const router = useRouter()

// 页签状态由路由驱动（/tools/offline-pack/:tab）：URL 可深链，前进后退可用
const activeTab = computed(() => tabKeyFromPath(route.path))

const TAB_COMPONENTS: Record<OfflinePackTabKey, Component> = {
  vscode: VSCodeDownloader,
  chrome: ChromeDownloader,
  edge: EdgeDownloader,
  docker: DockerDownloader,
  msstore: MSStoreDownloader,
}

const activeComponent = computed(() => TAB_COMPONENTS[activeTab.value])

// 页签栏统一用 UiMenuHorizontal（带品牌图标），与 interceptor / telegram-cache 观感一致
const menuItems = computed(() => OFFLINE_PACK_TABS.map(tab => ({
  value: tab.key as string,
  label: tab.label,
  icon: tab.icon,
})))

function switchTab(key: string): void {
  if (key === activeTab.value) return
  const tab = OFFLINE_PACK_TABS.find(item => item.key === key)
  if (tab) router.push({ name: tab.routeName })
}
</script>

<template>
  <div class="tool-page offline-pack-page">
    <div class="offline-pack-shell">
      <UiMenuHorizontal
        :model-value="activeTab"
        :items="menuItems"
        @update:model-value="switchTab"
      />

      <!-- 工作区：与 interceptor / telegram-cache 同构——页签条在外、面板承载当前下载器 -->
      <UiPanel padding="var(--spacing-2xl)">
        <KeepAlive>
          <component :is="activeComponent" />
        </KeepAlive>
      </UiPanel>

      <HistorySection />
    </div>
  </div>
</template>

<style scoped>
/* 单列内容栏：页签条 / 工作区 / 下载历史同宽。
   栏宽取 --column-document（与设置页、WXP 同一条文档栏），内边距与首页同一档；
   区块之间用 2xl，与「面板内部 16 / 行 8」拉开层级。 */
.offline-pack-page {
  padding: var(--spacing-2xl) var(--spacing-3xl) var(--spacing-3xl);
}

.offline-pack-shell {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2xl);
  max-width: var(--column-document);
  margin: 0 auto;
}

/* 窄窗口（与设置页同档）：内边距收到 16，栏宽交给 100% */
@media (max-width: 760px) {
  .offline-pack-page {
    padding: var(--spacing-lg);
  }

  .offline-pack-shell {
    gap: var(--spacing-lg);
  }
}
</style>
