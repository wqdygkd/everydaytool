<script setup lang="ts">
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

const tabComponents: Record<OfflinePackTabKey, unknown> = {
  vscode: VSCodeDownloader,
  chrome: ChromeDownloader,
  edge: EdgeDownloader,
  docker: DockerDownloader,
  msstore: MSStoreDownloader,
}

function switchTab(key: string): void {
  if (key === activeTab.value) return
  const tab = OFFLINE_PACK_TABS.find(item => item.key === key)
  if (tab) router.push({ name: tab.routeName })
}
</script>

<template>
  <div class="tool-page offline-pack-page">
    <header class="offline-pack-hero">
      <h1 class="offline-pack-title">
        离线包下载
      </h1>
      <p class="offline-pack-desc">
        在线搞定 VSCode 插件、Chrome/Edge 扩展、Docker 镜像与 Microsoft Store 应用的离线安装包
      </p>
    </header>

    <div class="offline-pack-card">
      <el-tabs :model-value="activeTab" class="offline-pack-tabs" @update:model-value="switchTab">
        <el-tab-pane v-for="tab in OFFLINE_PACK_TABS" :key="tab.key" :name="tab.key">
          <template #label>
            <span class="tab-label">
              <img :src="tab.icon" alt="" class="tab-icon">
              <span>{{ tab.label }}</span>
            </span>
          </template>
          <component :is="tabComponents[tab.key]" />
        </el-tab-pane>
      </el-tabs>
    </div>

    <HistorySection />
  </div>
</template>

<style scoped>
/* 布局/尺寸颜色与令牌走 tool-hub 设计系统 */
.offline-pack-page {
  padding: 32px 16px;
}

.offline-pack-hero {
  margin-bottom: 24px;
  text-align: center;
}

.offline-pack-title {
  margin: 0;
  font-size: 28px;
  font-weight: var(--font-weight-bold);
  letter-spacing: -0.025em;
  color: var(--color-text-primary);
}

.offline-pack-desc {
  margin: 8px 0 0;
  font-size: var(--font-size-lg);
  line-height: 1.6;
  color: var(--color-text-secondary);
}

/* 玻璃浮岛卡片：rounded 20px + backdrop-blur。
   不投影：本页画布已透明（与主页一致），卡片靠自身浅底 + 圆角分层，
   再加一层大阴影会在透明画布上显得浮夸、与工具页整体扁平基调不一致。 */
.offline-pack-card {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px;
  background: var(--color-raised);
  /* 玻璃：卡片直接浮在透明画布上，背后就是壁纸 / 桌面，按 raised 角色取模糊 */
  backdrop-filter: var(--glass-raised);
  border-radius: 20px;
}

/* 圆角分段页签：border + 灰底容器 + 激活白底阴影 */
.offline-pack-tabs :deep(.el-tabs__header) {
  margin: 0 0 24px;
}

.offline-pack-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.offline-pack-tabs :deep(.el-tabs__active-bar) {
  display: none;
}

.offline-pack-tabs :deep(.el-tabs__nav) {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px;
  background: var(--color-raised);
  border: 1px solid var(--color-border-light);
  border-radius: 12px;
}

.offline-pack-tabs :deep(.el-tabs__item) {
  height: auto;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  transition: var(--transition-fast);
}

.offline-pack-tabs :deep(.el-tabs__item:hover) {
  color: var(--color-text-primary);
}

.offline-pack-tabs :deep(.el-tabs__item.is-active) {
  background: var(--color-raised);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-sm);
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.tab-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
</style>
