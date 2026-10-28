<script setup lang="ts">
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { formatBytes, formatClock, formatDuration, formatPercent } from '../utils/format'

const store = useTelegramCacheStore()

const stats = computed(() => store.stats)
const cache = computed(() => store.cache)
const recentTraffic = computed(() => [...store.traffic].reverse().slice(0, 120))

const capabilityRows = computed(() => {
  const caps = store.capabilities
  if (!caps) return []
  const localEnabled = store.config?.localResponseEnabled === true
  const mediaEnabled = store.config?.localMediaRangeEnabled === true
  return [
    { label: 'HTTP 被动观测', tone: caps.httpObservation ? 'success' : 'neutral', text: caps.httpObservation ? '已挂载' : '未挂载', detail: '只读，非阻塞回调' },
    { label: '响应头大小', tone: caps.httpHeaderBytes ? 'success' : 'neutral', text: caps.httpHeaderBytes ? '可用' : '不可用', detail: 'content-length，非真实计量' },
    { label: '页面媒体捕获', tone: 'neutral', text: '未实现', detail: 'blob / 播放中数据不捕获' },
    {
      label: 'MTProto 下载器',
      tone: caps.telegramDownloader
        ? (store.mtproto?.connected ? 'success' : 'primary')
        : 'neutral',
      text: caps.telegramDownloader
        ? (store.mtproto?.connected
            ? '已连接'
            : (store.mtproto?.configured && store.mtproto?.hasSession ? '已配置' : '需 .env'))
        : '未实现',
      detail: '按消息链接下载媒体（可选）',
    },
    { label: '页面只读探测', tone: caps.guestProbe ? 'success' : 'neutral', text: caps.guestProbe ? '可用' : '不可用', detail: '诊断页可执行' },
    {
      label: '页面数据捕获',
      tone: caps.pageMediaCapture ? (store.config?.enablePageCapture ? 'success' : 'primary') : 'neutral',
      text: caps.pageMediaCapture ? (store.config?.enablePageCapture ? '已开启' : '默认关闭') : '未实现',
      detail: 'CDP：仅已完成下载的图片',
    },
    {
      label: '本地响应复用',
      tone: localEnabled || mediaEnabled ? 'success' : (caps.localResponseReplacement ? 'primary' : 'neutral'),
      text: localEnabled && mediaEnabled
        ? '图片 + 媒体'
        : localEnabled
          ? '仅图片'
          : mediaEnabled
            ? '仅媒体 Range'
            : (caps.localResponseReplacement ? '默认关闭' : '不可用'),
      detail: '图片整份 / 媒体单区间 206',
    },
  ] as const
})

const mergedConsumers = computed(() => store.tasks.reduce((total, task) => total + Math.max(0, task.joinedConsumers - 1), 0))
const storedCount = computed(() => store.resources.filter(item => item.stored).length)
const cacheUsagePercent = computed(() => {
  const usage = cache.value
  if (!usage || usage.maxBytes <= 0) return 0
  return Math.min(100, Math.round((usage.sizeBytes / usage.maxBytes) * 100))
})

async function clearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('清空本次会话的观测统计与最近请求？资源库与归档不受影响。', '清空观测', { type: 'warning' })
  } catch {
    return
  }
  try {
    await store.clearObservation()
    ElMessage.success('已清空观测')
  } catch (error) {
    ElMessage.error((error as Error).message || '清空失败')
  }
}

async function clearCache(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '清理缓存会删除资源库中的缓存对象（归档副本、no-store 保存内容与进行中的任务不会被删）。确定继续？',
      '清理缓存',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    const result = await store.clearCache()
    ElMessage.success(`已清理 ${formatBytes(result.evictedBytes)}（${result.evictions} 项）`)
  } catch (error) {
    ElMessage.error((error as Error).message || '清理失败')
  }
}

function statusTagType(code?: number): 'success' | 'info' | 'warning' | 'danger' {
  if (!code) return 'danger'
  if (code < 300) return 'success'
  if (code < 400) return 'info'
  if (code < 500) return 'warning'
  return 'danger'
}
</script>

<template>
  <div class="panel-stack">
    <UiPanel title="观测总览">
      <template #actions>
        <el-button size="small" :disabled="!stats?.requests" @click="clearAll">
          清空
        </el-button>
      </template>

      <UiDetailGrid :columns="2">
        <UiDetailItem label="网络接收（按响应头）" size="xs" mono>
          {{ formatBytes(stats?.networkBytes) }}
        </UiDetailItem>
        <UiDetailItem label="磁盘缓存命中率" size="xs" mono>
          {{ formatPercent(stats?.cacheHitRate) }}
          <span class="muted"> ({{ stats?.fromCache ?? 0 }}/{{ stats?.completed ?? 0 }})</span>
        </UiDetailItem>
        <UiDetailItem label="请求 / 完成 / 失败" size="xs" mono>
          {{ stats?.requests ?? 0 }} / {{ stats?.completed ?? 0 }} / {{ stats?.failed ?? 0 }}
        </UiDetailItem>
        <UiDetailItem label="大小未知的完成数" size="xs" mono>
          {{ stats?.unknownSizeCount ?? 0 }}
        </UiDetailItem>
        <UiDetailItem label="合并消费者（去重）" size="xs" mono>
          {{ mergedConsumers }}
        </UiDetailItem>
        <UiDetailItem label="资源库 / 归档" size="xs" mono>
          {{ storedCount }} / {{ store.archiveCount }}
        </UiDetailItem>
      </UiDetailGrid>

      <UiHint block>
        <strong>网络接收</strong>只累加「非缓存命中 + 带 content-length」的响应，是<strong>按响应头推算</strong>的观测值，不等于真实网卡流量；
        命中率来自 Chromium 的 <span class="mono">fromCache</span> 标记，同样不能直接证明省流量。
      </UiHint>
    </UiPanel>

    <UiPanel title="能力矩阵">
      <div class="kv-stack">
        <UiKeyValue v-for="row in capabilityRows" :key="row.label" :label="row.label" label-width="118px">
          <UiGroup gap="xs" justify="end">
            <UiChip :tone="row.tone">
              {{ row.text }}
            </UiChip>
            <span class="muted kv-detail">{{ row.detail }}</span>
          </UiGroup>
        </UiKeyValue>
      </div>
      <UiHint block>
        观测模式不改变原页面行为：不注入脚本、不改请求头。本地响应复用默认关闭，开启后只对已校验的图片在有新鲜期时生效。
      </UiHint>
    </UiPanel>

    <UiPanel title="缓存（M2）">
      <template #actions>
        <UiChip :tone="cache?.localResponseEnabled || cache?.localMediaRangeEnabled ? 'success' : 'neutral'">
          {{ cache?.handlerInstalled
            ? `本地复用：${cache?.localResponseEnabled ? '图片' : ''}${cache?.localResponseEnabled && cache?.localMediaRangeEnabled ? ' + ' : ''}${cache?.localMediaRangeEnabled ? '媒体 Range' : ''}`
            : '本地复用：关' }}
        </UiChip>
        <el-button size="small" :loading="store.busy.cache" @click="clearCache">
          清理缓存
        </el-button>
      </template>

      <UiDetailGrid :columns="2">
        <UiDetailItem label="缓存占用 / 配额" size="xs" mono>
          {{ formatBytes(cache?.sizeBytes) }} / {{ formatBytes(cache?.maxBytes) }}
        </UiDetailItem>
        <UiDetailItem label="索引条目" size="xs" mono>
          {{ cache?.entryCount ?? 0 }}
        </UiDetailItem>
        <UiDetailItem label="本地复用字节" size="xs" mono>
          {{ formatBytes(cache?.servedBytes) }}
        </UiDetailItem>
        <UiDetailItem label="本地命中 / 回源" size="xs" mono>
          {{ cache?.localHits ?? 0 }} / {{ cache?.localMisses ?? 0 }}
        </UiDetailItem>
        <UiDetailItem label="条件验证 / 304" size="xs" mono>
          {{ cache?.revalidations ?? 0 }} / {{ cache?.revalidationHits ?? 0 }}
        </UiDetailItem>
        <UiDetailItem label="页面捕获字节 / 命中" size="xs" mono>
          {{ formatBytes(cache?.pageCapturedBytes) }} / {{ cache?.pageCaptureHits ?? 0 }}
        </UiDetailItem>
        <UiDetailItem label="页面捕获失败" size="xs" mono>
          {{ cache?.pageCaptureMisses ?? 0 }}
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
        缓存对象按 SHA-256 去重，配额淘汰从最久未访问的条目开始；归档副本是独立文件，不受淘汰影响。
        过期条目在开启本地复用时做条件验证（304 则续期，200 则失效旧条目并回源）。
        「本地复用字节」是本地返回的响应体大小，<strong>不等于</strong>节省的网络字节（还需基准对比）。
      </UiHint>
    </UiPanel>

    <UiPanel title="资源类型分布">
      <UiTable :data="stats?.byType ?? []" height="180" empty-text="还没有可观测请求">
        <el-table-column label="类型" min-width="110">
          <template #default="{ row }">
            <span class="mono">{{ row.resourceType }}</span>
          </template>
        </el-table-column>
        <el-table-column label="请求" width="76" align="right">
          <template #default="{ row }">
            <span class="mono">{{ row.requests }}</span>
          </template>
        </el-table-column>
        <el-table-column label="网络字节" width="104" align="right">
          <template #default="{ row }">
            <span class="mono muted">{{ formatBytes(row.bytes) }}</span>
          </template>
        </el-table-column>
      </UiTable>
    </UiPanel>

    <UiPanel title="主机分布">
      <UiTable :data="stats?.byHost ?? []" height="180" empty-text="还没有可观测请求">
        <el-table-column label="主机" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono">{{ row.host }}</span>
          </template>
        </el-table-column>
        <el-table-column label="请求" width="76" align="right">
          <template #default="{ row }">
            <span class="mono">{{ row.requests }}</span>
          </template>
        </el-table-column>
        <el-table-column label="网络字节" width="104" align="right">
          <template #default="{ row }">
            <span class="mono muted">{{ formatBytes(row.bytes) }}</span>
          </template>
        </el-table-column>
      </UiTable>
    </UiPanel>

    <UiPanel title="最近请求">
      <template #actions>
        <UiChip mono>
          {{ store.traffic.length }}
        </UiChip>
      </template>
      <UiTable :data="recentTraffic" height="260" empty-text="还没有请求：先让 Telegram 页面加载聊天内容">
        <el-table-column label="时间" width="82">
          <template #default="{ row }">
            <span class="mono muted">{{ formatClock(row.at) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="方法" width="58">
          <template #default="{ row }">
            <span class="mono">{{ row.method }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="76">
          <template #default="{ row }">
            <span class="mono muted">{{ row.resourceType }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="66">
          <template #default="{ row }">
            <UiChip v-if="row.error" tone="danger" variant="soft">
              ERR
            </UiChip>
            <UiChip v-else :tone="statusTagType(row.statusCode)" variant="soft">
              {{ row.statusCode ?? '—' }}
            </UiChip>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="82" align="right">
          <template #default="{ row }">
            <span class="mono muted">{{ formatBytes(row.bytes) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="70" align="right">
          <template #default="{ row }">
            <span class="mono muted">{{ formatDuration(row.durationMs) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="地址（已脱敏）" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono path-cell">{{ row.host }}{{ row.path }}</span>
          </template>
        </el-table-column>
      </UiTable>
    </UiPanel>
  </div>
</template>

<style scoped lang="scss">
.panel-stack {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.kv-stack {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.kv-detail {
  font-size: var(--font-size-xs);
}

.cache-bar {
  margin-top: var(--spacing-md);
}

.path-cell {
  font-size: var(--font-size-xs);
}
</style>
