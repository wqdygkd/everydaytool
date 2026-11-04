<script setup lang="ts">
import type { Component } from 'vue'
import type { OfflinePackTabKey } from '../tabs'
import { storeToRefs } from 'pinia'
import ToolSideInspector from '../../../../renderer/shared/components/workspace/ToolSideInspector.vue'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import ChromeDownloader from '../components/ChromeDownloader.vue'
import DockerDownloader from '../components/DockerDownloader.vue'
import DownloadTasks from '../components/DownloadTasks.vue'
import EdgeDownloader from '../components/EdgeDownloader.vue'
import HistorySection from '../components/HistorySection.vue'
import MSStoreDownloader from '../components/MSStoreDownloader.vue'
import VSCodeDownloader from '../components/VSCodeDownloader.vue'
import { useOfflinePackDownloadsStore } from '../stores/downloads'
import { OFFLINE_PACK_TABS, tabKeyFromPath } from '../tabs'

const route = useRoute()
const router = useRouter()

// 页签状态由路由驱动（/tools/offline-pack/:tab）：URL 可深链，前进后退可用
const activeTab = computed(() => tabKeyFromPath(route.path))
const historyOpen = ref(false)
const downloads = useOfflinePackDownloadsStore()
const { activeCount, activePercent } = storeToRefs(downloads)

// 关闭工具即结束本次会话：取消未完成任务并从任务区移除（与旧的单任务行为一致）
onUnmounted(() => {
  void downloads.reset()
})

const TAB_COMPONENTS: Record<OfflinePackTabKey, Component> = {
  vscode: VSCodeDownloader,
  chrome: ChromeDownloader,
  edge: EdgeDownloader,
  docker: DockerDownloader,
  msstore: MSStoreDownloader,
}

const activeComponent = computed(() => TAB_COMPONENTS[activeTab.value])

function switchTab(key: string): void {
  if (key === activeTab.value) return
  const tab = OFFLINE_PACK_TABS.find(item => item.key === key)
  if (tab) router.push({ name: tab.routeName })
}
</script>

<template>
  <div class="tool-page offline-pack-page">
    <ToolSurface class="offline-surface">
      <div class="offline-studio">
        <ToolSideInspector
          :open="true"
          title="下载来源"
          :width="268"
          side="left"
          :closable="false"
          body-padding="8px"
        >
          <div class="source-panel">
            <nav class="source-list" aria-label="下载来源">
              <button
                v-for="tab in OFFLINE_PACK_TABS"
                :key="tab.key"
                type="button"
                class="source-row"
                :class="{ 'is-active': tab.key === activeTab }"
                :aria-current="tab.key === activeTab ? 'page' : undefined"
                @click="switchTab(tab.key)"
              >
                <span class="source-icon">
                  <img :src="tab.icon" alt="">
                </span>
                <span class="source-name">{{ tab.label }}</span>
                <UiIcon name="arrowRight" :size="14" class="source-arrow" />
              </button>
            </nav>

            <div class="source-footer">
              <button
                type="button"
                class="history-entry"
                :class="{ 'is-active': historyOpen }"
                :aria-expanded="historyOpen"
                :aria-controls="historyOpen ? 'offline-pack-history' : undefined"
                @click="historyOpen = !historyOpen"
              >
                <UiIcon name="history" :size="16" class="history-icon" />
                <span class="history-label">下载历史</span>
                <span v-if="activeCount" class="history-live" :aria-label="`${activeCount} 个任务下载中`">
                  <span class="history-live-dot" aria-hidden="true" />
                  {{ activePercent }}%
                </span>
                <UiIcon
                  name="chevronDown"
                  :size="14"
                  class="history-chevron"
                  :class="{ 'is-open': historyOpen }"
                />
              </button>
            </div>
          </div>
        </ToolSideInspector>

        <section class="offline-main">
          <div class="downloader-stage">
            <KeepAlive>
              <component :is="activeComponent" />
            </KeepAlive>
          </div>

          <Transition name="history-drawer">
            <section
              v-if="historyOpen"
              id="offline-pack-history"
              class="history-drawer"
              aria-label="下载历史"
            >
              <header class="history-head">
                <div>
                  <strong>下载历史</strong>
                  <span>文件与缓存层同步，可在这里删除或打开目录</span>
                </div>
                <UiIconButton icon="close" label="收起下载历史" @click="historyOpen = false" />
              </header>
              <div class="history-body">
                <DownloadTasks />
                <HistorySection />
              </div>
            </section>
          </Transition>
        </section>
      </div>
    </ToolSurface>
  </div>
</template>

<style scoped lang="scss">
.offline-pack-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 18px;
  overflow: hidden;
}

.offline-surface {
  min-height: 0;
}

.offline-studio {
  display: flex;
  flex: 1;
  gap: 12px;
  min-height: 0;
  padding: 12px;
}

.source-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}

.source-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.source-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 38px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);

  &:hover {
    background: var(--color-fill);
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }

  &.is-active {
    border-color: color-mix(in srgb, var(--color-primary) 17%, transparent);
    background: var(--color-primary-soft);
    color: var(--color-text-primary);
  }
}

.source-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-on-solid) 52%, transparent);

  img {
    width: 16px;
    height: 16px;
  }
}

.source-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-arrow {
  flex: none;
  color: var(--color-text-tertiary);
  opacity: 0;
}

.source-row.is-active .source-arrow {
  opacity: 1;
}

.source-footer {
  flex: none;
  padding-top: 8px;
  border-top: 1px solid var(--color-border-light);
}

.history-entry {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 38px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);

  &:hover {
    background: var(--color-fill);
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }

  &.is-active {
    border-color: color-mix(in srgb, var(--color-primary) 17%, transparent);
    background: var(--color-primary-soft);
    color: var(--color-text-primary);
  }
}

.history-icon {
  flex: none;
  color: var(--color-text-tertiary);
}

.history-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-chevron {
  flex: none;
  color: var(--color-text-tertiary);
  transition: transform var(--duration-fast) var(--ease-out);

  &.is-open {
    transform: rotate(180deg);
  }
}

.history-live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
}

.history-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: history-live-pulse 1.4s var(--ease-out) infinite;
}

@keyframes history-live-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}

.offline-main {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-fill) 28%, transparent);
}

.downloader-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 20px;
  overflow: auto;
}

.history-drawer {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  max-height: min(360px, 52%);
  min-height: 240px;
  border-top: 1px solid var(--color-border);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: var(--color-overlay);
  backdrop-filter: var(--glass-overlay);
  box-shadow: 0 -12px 30px color-mix(in srgb, var(--color-on-solid) 12%, transparent);
}

.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  flex: none;
  min-height: 48px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--color-border-light);

  > div {
    display: grid;
    min-width: 0;
    gap: 1px;
  }

  strong {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  span {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-xs);
  }
}

.history-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--spacing-md);
  min-height: 0;
  padding: 0 12px 12px;
  overflow: hidden;
}

.history-drawer-enter-active,
.history-drawer-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.history-drawer-enter-from,
.history-drawer-leave-to {
  opacity: 0;
  transform: translateY(16px);
}

@media (prefers-reduced-motion: reduce) {
  .source-row,
  .history-entry,
  .history-chevron,
  .history-live-dot,
  .history-drawer-enter-active,
  .history-drawer-leave-active {
    transition-duration: 0.01ms;
    animation: none;
  }
}
</style>
