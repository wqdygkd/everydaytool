<script setup lang="ts">
import { confirm } from '@renderer/shared/feedback'
import { toast } from 'vue-sonner'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { formatBytes, formatPercent } from '../utils/format'

const store = useTelegramCacheStore()

const site = computed(() => store.site)
const cache = computed(() => store.cache)

const completeEntries = computed(() => store.library.filter(entry => entry.state === 'complete'))
const partialEntries = computed(() => store.library.filter(entry => entry.state === 'partial' || entry.state === 'downloading'))

const archivedBytes = computed(() => completeEntries.value.reduce((total, entry) => total + (entry.size || 0), 0))
const archivedPercent = computed(() => {
  const total = store.library.length
  if (total <= 0) return 0
  return Math.round((completeEntries.value.length / total) * 100)
})

const cacheUsagePercent = computed(() => {
  const usage = cache.value
  if (!usage || usage.maxBytes <= 0) return 0
  return Math.min(100, Math.round((usage.sizeBytes / usage.maxBytes) * 100))
})

async function clearCache(): Promise<void> {
  try {
    await confirm(
      '清理缓存会删除媒体对象库里的去重对象（归档消息本身与进行中的任务不会被删）。确定继续？',
      '清理缓存',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    const result = await store.clearCache()
    toast.success(`已清理 ${formatBytes(result.evictedBytes)}（${result.evictions} 项）`)
  } catch (error) {
    toast.error((error as Error).message || '清理失败')
  }
}

async function openDataDir(): Promise<void> {
  try {
    await store.openDataDir()
  } catch (error) {
    toast.error((error as Error).message || '打开数据目录失败')
  }
}
</script>

<template>
  <div class="panel-stack">
    <UiPanel title="本地站点">
      <template #actions>
        <UiChip :tone="site?.ready ? 'success' : 'neutral'" mono>
          {{ site?.ready ? '已就绪' : '未就绪' }}
        </UiChip>
      </template>

      <UiDetailGrid :columns="2">
        <UiDetailItem label="页面地址" size="xs" mono>
          {{ site?.url || '—' }}
        </UiDetailItem>
        <UiDetailItem label="端口" size="xs" mono>
          {{ site?.port ?? '—' }}
        </UiDetailItem>
        <UiDetailItem label="origin 稳定性" size="xs">
          {{ site?.originChanged ? '本次已变化' : '已固定' }}
        </UiDetailItem>
        <UiDetailItem label="影库条目" size="xs" mono>
          {{ store.library.length }}
        </UiDetailItem>
      </UiDetailGrid>

      <UiHint v-if="site?.error" block class="danger-hint">
        {{ site.error }}
      </UiHint>
      <UiHint v-else block>
        主进程把 Telegram Web 托管在同源 <span class="mono">/api</span> 与 <span class="mono">/media</span> 上，端口固定后登录态与本地缓存才能跨重启复用。
      </UiHint>
    </UiPanel>

    <UiPanel title="归档概况">
      <template #actions>
        <UiButton size="small" @click="openDataDir">
          打开数据目录
        </UiButton>
      </template>

      <UiDetailGrid :columns="2">
        <UiDetailItem label="已缓存消息" size="xs" mono>
          {{ completeEntries.length }} 条
        </UiDetailItem>
        <UiDetailItem label="缓存中 / 部分" size="xs" mono>
          {{ partialEntries.length }} 条
        </UiDetailItem>
        <UiDetailItem label="归档体积" size="xs" mono>
          {{ formatBytes(archivedBytes) }}
        </UiDetailItem>
        <UiDetailItem label="完成率" size="xs" mono>
          {{ formatPercent(archivedPercent / 100) }}
        </UiDetailItem>
      </UiDetailGrid>

      <UiProgress
        class="archive-bar"
        :percentage="archivedPercent"
      />

      <UiHint block>
        每条消息落在 <span class="mono">messages/&lt;群 id&gt;/&lt;消息 id&gt;/</span>：<span class="mono">message.md</span> 是正文与元信息，<span class="mono">media/</span> 下按媒体键命名。在 Telegram 消息上右键「缓存此消息」就会写入这里。
      </UiHint>
    </UiPanel>

    <UiPanel title="媒体对象库">
      <template #actions>
        <UiButton size="small" :loading="store.busy.cache" @click="clearCache">
          清理缓存
        </UiButton>
      </template>

      <UiDetailGrid :columns="2">
        <UiDetailItem label="占用 / 配额" size="xs" mono>
          {{ formatBytes(cache?.sizeBytes) }} / {{ formatBytes(cache?.maxBytes) }}
        </UiDetailItem>
        <UiDetailItem label="索引条目" size="xs" mono>
          {{ cache?.entryCount ?? 0 }}
        </UiDetailItem>
        <UiDetailItem label="累计淘汰" size="xs" mono>
          {{ formatBytes(cache?.evictedBytes) }}（{{ cache?.evictions ?? 0 }} 项）
        </UiDetailItem>
      </UiDetailGrid>

      <UiProgress
        class="cache-bar"
        :percentage="cacheUsagePercent"
        :status="cacheUsagePercent >= 95 ? 'warning' : undefined"
      />

      <UiHint block>
        对象按 SHA-256 去重，归档目录用硬链接指向它们，所以同一份媒体只占一块磁盘；淘汰只影响去重对象，不影响 <span class="mono">messages/</span> 里的归档。
      </UiHint>
    </UiPanel>
  </div>
</template>

<style scoped lang="scss">
.panel-stack {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.archive-bar {
  margin-top: var(--spacing-md);
}

.cache-bar {
  margin-top: var(--spacing-md);
}

.danger-hint {
  color: var(--color-danger);
}
</style>
