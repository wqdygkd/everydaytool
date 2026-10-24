<script setup lang="ts">
import type { OfflinePackDownloadProgress, OfflinePackHistoryItem } from '@shared/offline-pack'
import { ElMessage, ElMessageBox } from 'element-plus'
import { onMounted, onUnmounted, ref } from 'vue'
import { getOfflinePackApi } from '../api'

const api = getOfflinePackApi()

const items = ref<OfflinePackHistoryItem[]>([])
const loading = ref(false)

const KIND_LABELS: Record<string, string> = {
  vscode: 'VSCode',
  chrome: 'Chrome',
  edge: 'Edge',
  docker: 'Docker',
  msstore: 'MS商店',
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

async function load(): Promise<void> {
  if (!api) return
  loading.value = true
  try {
    items.value = await api.invoke(api.commands.HISTORY_LIST) as OfflinePackHistoryItem[]
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
    items.value = await api.invoke(api.commands.HISTORY_DELETE, item.id, true) as OfflinePackHistoryItem[]
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
    await api.invoke(api.commands.HISTORY_CLEAR, true)
    items.value = []
    ElMessage.success('已清空')
  } catch (error) {
    ElMessage.error((error as Error).message || '清空失败')
  }
}

async function openDir(): Promise<void> {
  if (!api) return
  try {
    await api.invoke(api.commands.OPEN_DIR)
  } catch (error) {
    ElMessage.error((error as Error).message || '打开目录失败')
  }
}

let offProgress: (() => void) | null = null

onMounted(() => {
  void load()
  // 下载完成后自动刷新历史
  if (api) {
    offProgress = api.on(api.commands.EVENT_PROGRESS, (payload) => {
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
  <div v-if="api" class="history-section">
    <div class="history-header">
      <span class="history-title">
        下载历史（{{ items.length }}）
      </span>
      <div class="history-actions">
        <el-button size="small" @click="openDir">
          打开目录
        </el-button>
        <el-button size="small" type="danger" plain :disabled="!items.length" @click="clear">
          清空
        </el-button>
      </div>
    </div>

    <el-table v-if="items.length" v-loading="loading" :data="items" size="small">
      <el-table-column prop="filename" label="文件名" min-width="220" show-overflow-tooltip />
      <el-table-column label="来源" width="90">
        <template #default="{ row }">
          {{ KIND_LABELS[row.kind] ?? row.kind }}
        </template>
      </el-table-column>
      <el-table-column label="大小" width="100">
        <template #default="{ row }">
          <span class="mono">{{ formatSize(row.size) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">
          <span class="muted">{{ formatDate(row.createdAt) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80" align="right">
        <template #default="{ row }">
          <el-button size="small" type="danger" link @click="remove(row)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-else class="history-empty muted">
      暂无下载记录
    </div>
  </div>
</template>

<style scoped>
.history-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  max-width: 760px;
  margin: var(--spacing-xl) auto 0;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.history-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.history-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.history-empty {
  padding: var(--spacing-xl);
  text-align: center;
  font-size: var(--font-size-sm);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
}
</style>
