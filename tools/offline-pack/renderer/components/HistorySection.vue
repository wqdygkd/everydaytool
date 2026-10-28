<script setup lang="ts">
import type { OfflinePackDownloadProgress, OfflinePackHistoryItem } from '@shared/offline-pack'
import type { OfflinePackTabKey } from '../tabs'
import { formatBytes, formatDateTime } from '@shared/offline-pack'
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, onUnmounted, ref } from 'vue'
import { getOfflinePackApi } from '../ipc'

const api = getOfflinePackApi()

const items = ref<OfflinePackHistoryItem[]>([])
const loading = ref(false)

/** 来源列短标签：以页签 key 为键建表，新增页签时类型检查会强制补齐 */
const KIND_LABELS: Record<OfflinePackTabKey, string> = {
  vscode: 'VSCode',
  chrome: 'Chrome',
  edge: 'Edge',
  docker: 'Docker',
  msstore: 'MS 商店',
}

async function load(): Promise<void> {
  if (!api) return
  loading.value = true
  try {
    items.value = await api.invoke(api.channels.HISTORY_LIST) as OfflinePackHistoryItem[]
  } catch (error) {
    ElMessage.error((error as Error).message || '加载历史失败')
  } finally {
    loading.value = false
  }
}

async function remove(item: OfflinePackHistoryItem): Promise<void> {
  if (!api) return
  try {
    await ElMessageBox.confirm(`删除「${item.filename}」及其磁盘文件？`, '删除记录', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    items.value = await api.invoke(api.channels.HISTORY_DELETE, item.id, true) as OfflinePackHistoryItem[]
    ElMessage.success('已删除')
  } catch (error) {
    ElMessage.error((error as Error).message || '删除失败')
  }
}

async function clear(): Promise<void> {
  if (!api) return
  try {
    await ElMessageBox.confirm('清空全部下载历史及其磁盘文件？', '清空历史', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await api.invoke(api.channels.HISTORY_CLEAR, true)
    items.value = []
    ElMessage.success('已清空')
  } catch (error) {
    ElMessage.error((error as Error).message || '清空失败')
  }
}

async function openDir(): Promise<void> {
  if (!api) return
  try {
    await api.invoke(api.channels.OPEN_DIR)
  } catch (error) {
    ElMessage.error((error as Error).message || '打开目录失败')
  }
}

let offProgress: (() => void) | null = null

onMounted(() => {
  void load()
  // 下载完成后自动刷新历史
  if (api) {
    offProgress = api.on(api.channels.EVENT_PROGRESS, (payload) => {
      const p = payload as OfflinePackDownloadProgress
      if (p.status === 'completed') void load()
    })
  }
})

onUnmounted(() => {
  offProgress?.()
  offProgress = null
})
</script>

<template>
  <section v-if="api">
    <UiSectionHeader title="下载历史" :count="items.length">
      <template #actions>
        <el-button size="small" @click="openDir">
          打开目录
        </el-button>
        <el-button size="small" type="danger" plain :disabled="!items.length" @click="clear">
          清空
        </el-button>
      </template>
    </UiSectionHeader>

    <!-- padding="" ：表格自带 radius-lg 与描边，直接贴住面板边缘，避免「卡片里再套一层圆角」 -->
    <UiPanel padding="">
      <UiTable
        :data="items"
        :loading="loading"
        row-key="id"
        empty-text="暂无下载记录"
      >
        <el-table-column prop="filename" label="文件名" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.filename }}</span>
            <!-- 下载产物在缓存层：清缓存后文件没了，记录还在，必须显式标出来 -->
            <UiChip v-if="row.exists === false" tone="warning" variant="outline" class="missing-chip">
              文件已缺失
            </UiChip>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="90">
          <template #default="{ row }">
            {{ KIND_LABELS[row.kind as OfflinePackTabKey] ?? row.kind }}
          </template>
        </el-table-column>
        <el-table-column label="大小" width="100">
          <template #default="{ row }">
            <span class="mono">{{ formatBytes(row.size) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">
            <span class="muted">{{ formatDateTime(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="right">
          <template #default="{ row }">
            <el-button size="small" type="danger" link @click="remove(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </UiTable>
    </UiPanel>
  </section>
</template>

<style scoped lang="scss">
.missing-chip {
  margin-left: var(--spacing-sm);
}
</style>
