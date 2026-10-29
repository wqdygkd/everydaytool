<script setup lang="ts">
import type { TelegramResourceSummary } from '../../../../shared/telegram-cache'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { formatBytes } from '../utils/format'

const store = useTelegramCacheStore()
const filter = ref('')
const filterKind = ref<'all' | 'downloadable' | 'stored'>('all')

const activeByKey = computed(() => new Map(store.activeTasks.map(task => [task.resourceKey, task])))

const filteredResources = computed(() => {
  const keyword = filter.value.trim().toLowerCase()
  return store.resources.filter((item) => {
    if (filterKind.value === 'downloadable' && !item.downloadable) return false
    if (filterKind.value === 'stored' && !item.stored) return false
    if (!keyword) return true
    return `${item.displayUrl} ${item.host} ${item.mimeType ?? ''}`.toLowerCase().includes(keyword)
  })
})

/**
 * el-table 的插槽行是 EP 的 DefaultRow（`Record<PropertyKey, any>`），不保证具体字段真的存在；
 * 行处理函数统一按 unknown 收参、进来先收敛到业务类型。运行期就是表格里的同一份对象，不做任何转换。
 */
function toResource(row: unknown): TelegramResourceSummary {
  return row as TelegramResourceSummary
}

function statusOf(row: unknown): { label: string, tone: 'neutral' | 'primary' | 'success' | 'warning' } {
  const item = toResource(row)
  if (activeByKey.value.has(item.resourceKey)) return { label: '任务中', tone: 'warning' }
  if (item.stored) return { label: '资源库', tone: 'primary' }
  return { label: '仅观测', tone: 'neutral' }
}

/** 缓存语义：内容是否已校验可复用 */
function cacheLabel(row: unknown): string {
  const item = toResource(row)
  const stored = item.stored
  if (!stored) return ''
  if (!stored.cacheable || stored.serveClass === 'none') return '不可本地复用'
  if (stored.freshUntil && stored.freshUntil > Date.now()) return '内容已校验'
  return '内容已校验 · 已过期'
}

function cacheTone(row: unknown): 'neutral' | 'success' | 'warning' {
  const label = cacheLabel(row)
  if (label === '内容已校验') return 'success'
  if (label === '内容已校验 · 已过期') return 'warning'
  return 'neutral'
}

function canStore(row: unknown): boolean {
  const item = toResource(row)
  if (item.stored) return false
  if (activeByKey.value.has(item.resourceKey)) return false
  return item.downloadable
}

async function run(row: unknown): Promise<void> {
  const item = toResource(row)
  try {
    const result = await store.acquire(item.resourceKey, 'cache')
    if (result.reused) ElMessage.success('存入资源库完成：直接复用资源库内容，未重新下载')
    else if (result.joined) ElMessage.success('存入资源库完成：已合并进正在进行的下载任务（single-flight）')
    else ElMessage.success('存入资源库完成')
  } catch (error) {
    ElMessage.error((error as Error).message || '存入资源库失败')
  }
}
</script>

<template>
  <div class="panel-stack">
    <UiPanel title="可复用资源">
      <template #actions>
        <UiChip mono>
          {{ filteredResources.length }}
        </UiChip>
      </template>

      <UiToolbar wrap gap="sm">
        <UiSearchInput v-model="filter" variant="box" width="100%" placeholder="按地址 / 主机 / MIME 过滤" clearable trim />
        <el-radio-group v-model="filterKind" size="small">
          <el-radio-button value="all">
            全部
          </el-radio-button>
          <el-radio-button value="downloadable">
            可取回
          </el-radio-button>
          <el-radio-button value="stored">
            已入库
          </el-radio-button>
        </el-radio-group>
      </UiToolbar>

      <UiTable :data="filteredResources" height="420" empty-text="还没有观测到资源：先让页面加载聊天里的图片 / 视频缩略图">
        <el-table-column label="资源（已脱敏）" min-width="230" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="resource-cell">
              <span class="mono resource-url">{{ row.host }}{{ row.path }}</span>
              <span class="muted resource-meta">
                {{ row.mimeType || row.resourceType }}
                <template v-if="row.requests > 1"> · {{ row.requests }} 次请求</template>
                <template v-if="row.fromCache"> · 来自磁盘缓存</template>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="82" align="right">
          <template #default="{ row }">
            <span class="mono muted">{{ row.sizeKnown ? formatBytes(row.size) : '未知' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="118">
          <template #default="{ row }">
            <div class="status-cell">
              <UiChip :tone="statusOf(row).tone">
                {{ statusOf(row).label }}
              </UiChip>
              <UiChip v-if="cacheLabel(row)" :tone="cacheTone(row)">
                {{ cacheLabel(row) }}
              </UiChip>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="96" align="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button
                v-if="canStore(row)"
                size="small"
                text
                type="primary"
                :disabled="!canStore(row)"
                @click="run(row)"
              >
                存库
              </el-button>
            </div>
          </template>
        </el-table-column>
      </UiTable>

      <UiHint block>
        资源地址来自<strong>本次会话</strong>的 webRequest 观测，完整 URL（含签名参数）只留在主进程内存，表格里查询参数值统一为
        <span class="mono">***</span>。重启后资源库条目仍可查看内容对象（不产生网络请求），但不能再按地址重新下载。
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

.resource-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.resource-url {
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.resource-meta {
  font-size: var(--font-size-xs);
}

.archive-url {
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-xs);
}

.status-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
</style>
