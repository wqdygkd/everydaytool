<script setup lang="ts">
import type { TelegramResourceKind, TelegramResourceSummary } from '../../../../shared/telegram-cache'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { formatBytes, formatDateTime } from '../utils/format'

const store = useTelegramCacheStore()
const filter = ref('')
const filterKind = ref<'all' | 'downloadable' | 'stored'>('all')
const config = computed(() => store.config)

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
  if (item.stored?.archived) return { label: '已归档', tone: 'success' }
  if (activeByKey.value.has(item.resourceKey)) return { label: '任务中', tone: 'warning' }
  if (item.stored) return { label: '资源库', tone: 'primary' }
  return { label: '仅观测', tone: 'neutral' }
}

/** M2 缓存语义：只有「HTTP 允许 + 对应模式开启 + 新鲜」才显示可本地命中 */
function cacheLabel(row: unknown): string {
  const item = toResource(row)
  const stored = item.stored
  if (!stored) return ''
  if (!stored.cacheable || stored.serveClass === 'none') return '不本地复用'
  if (stored.serveClass === 'image' && config.value?.localResponseEnabled !== true) return '图片复用未开'
  if (stored.serveClass === 'media' && config.value?.localMediaRangeEnabled !== true) return '媒体 Range 未开'
  if (stored.freshUntil && stored.freshUntil > Date.now()) return '可本地命中'
  return '已过期 · 条件验证'
}

function cacheTone(row: unknown): 'neutral' | 'success' | 'warning' {
  const label = cacheLabel(row)
  if (label === '可本地命中') return 'success'
  if (label === '已过期 · 条件验证') return 'warning'
  return 'neutral'
}

function canArchive(row: unknown): boolean {
  const item = toResource(row)
  if (item.stored?.archived) return false
  if (activeByKey.value.has(item.resourceKey)) return false
  return item.downloadable || Boolean(item.stored)
}

function canStore(row: unknown): boolean {
  const item = toResource(row)
  if (item.stored) return false
  if (activeByKey.value.has(item.resourceKey)) return false
  return item.downloadable
}

async function run(row: unknown, kind: TelegramResourceKind): Promise<void> {
  const item = toResource(row)
  try {
    const result = await store.acquire(item.resourceKey, kind)
    const action = kind === 'archive' ? '归档' : '存入资源库'
    if (result.reused) ElMessage.success(`${action}完成：直接复用资源库内容，未重新下载`)
    else if (result.joined) ElMessage.success(`${action}完成：已合并进正在进行的下载任务（single-flight）`)
    else ElMessage.success(`${action}完成`)
    if (kind === 'archive') await store.loadArchives()
  } catch (error) {
    ElMessage.error((error as Error).message || `${kind === 'archive' ? '归档' : '存入资源库'}失败`)
  }
}

async function openArchiveDir(): Promise<void> {
  try {
    await store.openArchiveDir()
  } catch (error) {
    ElMessage.error((error as Error).message || '打开归档目录失败')
  }
}

async function refreshArchives(): Promise<void> {
  try {
    await store.loadArchives()
  } catch (error) {
    ElMessage.error((error as Error).message || '读取归档失败')
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
        <el-table-column label="操作" width="118" align="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button
                v-if="canStore(row)"
                size="small"
                text
                type="primary"
                :disabled="!canStore(row)"
                @click="run(row, 'cache')"
              >
                存库
              </el-button>
              <el-button
                size="small"
                text
                type="primary"
                :disabled="!canArchive(row)"
                @click="run(row, 'archive')"
              >
                归档
              </el-button>
            </div>
          </template>
        </el-table-column>
      </UiTable>

      <UiHint block>
        资源地址来自<strong>本次会话</strong>的 webRequest 观测，完整 URL（含签名参数）只留在主进程内存，表格里查询参数值统一为
        <span class="mono">***</span>。重启后资源库条目仍可再次归档（复制本地对象，不产生网络请求），但不能再按地址重新下载。
      </UiHint>
    </UiPanel>

    <UiPanel title="归档">
      <template #actions>
        <el-button size="small" :loading="store.busy.archives" @click="refreshArchives">
          刷新
        </el-button>
        <el-button size="small" @click="openArchiveDir">
          打开目录
        </el-button>
      </template>

      <UiTable :data="store.archives.slice(0, 30)" height="240" empty-text="还没有归档：在资源行点「归档」">
        <el-table-column label="归档时间" width="132">
          <template #default="{ row }">
            <span class="mono muted">{{ formatDateTime(row.savedAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="资源" min-width="190" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono archive-url">{{ row.displayUrl }}</span>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="82" align="right">
          <template #default="{ row }">
            <span class="mono muted">{{ formatBytes(row.size) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="校验" width="70" align="center">
          <template #default="{ row }">
            <UiChip v-if="row.sha256" tone="success">
              SHA
            </UiChip>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
      </UiTable>

      <UiHint block>
        归档按内容哈希（SHA-256）去重，副本独立于资源库；缓存清理不会删除归档。同一内容只保留一份。
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
