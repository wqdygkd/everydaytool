<script setup lang="ts">
import type { TelegramTaskSnapshot } from '../../../../shared/telegram-cache'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { formatBytes, formatClock } from '../utils/format'

const store = useTelegramCacheStore()

const statusMeta: Record<TelegramTaskSnapshot['status'], { label: string, type: 'success' | 'info' | 'warning' | 'danger' }> = {
  queued: { label: '排队', type: 'info' },
  running: { label: '下载中', type: 'warning' },
  completed: { label: '完成', type: 'success' },
  failed: { label: '失败', type: 'danger' },
  cancelled: { label: '已取消', type: 'info' },
}

function progressOf(task: TelegramTaskSnapshot): number {
  if (task.status === 'completed') return 100
  if (!task.totalBytes || task.totalBytes <= 0) return 0
  return Math.min(99, Math.round((task.bytes / task.totalBytes) * 100))
}

function statusInfo(status: string): { label: string, type: 'success' | 'info' | 'warning' | 'danger' } {
  return statusMeta[status as TelegramTaskSnapshot['status']] ?? statusMeta.failed
}

function kindLabel(kind: string): string {
  return kind === 'archive' ? '归档' : '存库'
}

async function cancelTask(task: TelegramTaskSnapshot): Promise<void> {
  try {
    const accepted = await store.cancelTask(task.taskId)
    if (accepted) ElMessage.success('已请求取消任务')
    else ElMessage.warning('任务已结束或不存在')
  } catch (error) {
    ElMessage.error((error as Error).message || '取消失败')
  }
}
</script>

<template>
  <div class="panel-stack">
    <UiPanel title="下载任务">
      <template #actions>
        <UiChip mono>
          进行中 {{ store.activeTasks.length }}
        </UiChip>
      </template>

      <el-table :data="store.tasks" size="small" height="520" empty-text="还没有任务：在资源行点「存库」或「归档」">
        <el-table-column label="状态" width="82">
          <template #default="{ row }">
            <el-tag size="small" :type="statusInfo(row.status).type">
              {{ statusInfo(row.status).label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="资源（已脱敏）" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="task-cell">
              <span class="mono task-url">{{ row.displayUrl }}</span>
              <span class="muted task-meta">
                {{ row.kinds.map(kindLabel).join(' + ') }}
                <template v-if="row.joinedConsumers > 1"> · 合并 {{ row.joinedConsumers }} 个消费者</template>
                <template v-if="row.attempts > 1"> · 第 {{ row.attempts }} 次尝试</template>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="118">
          <template #default="{ row }">
            <el-progress
              v-if="row.status === 'running' || row.status === 'completed'"
              :percentage="progressOf(row)"
              :stroke-width="6"
              :show-text="false"
              :status="row.status === 'completed' ? 'success' : undefined"
            />
            <span v-else class="mono muted">—</span>
            <span class="mono muted progress-text">
              {{ formatBytes(row.bytes) }}<template v-if="row.totalBytes"> / {{ formatBytes(row.totalBytes) }}</template>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="开始" width="82">
          <template #default="{ row }">
            <span class="mono muted">{{ formatClock(row.startedAt ?? row.queuedAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono error-line">{{ row.error || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column width="70" align="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'queued' || row.status === 'running'"
              size="small"
              text
              type="danger"
              @click="cancelTask(row)"
            >
              取消
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <UiHint block>
        同一资源同时只有一个底层下载任务：第二个消费者会<strong>合并</strong>进来（不重复下载），单个消费者取消不影响其他消费者；
        只有全部取消才会中断下载。HTTP 与 MTProto 使用独立并发池 —— 本版本只启用 HTTP 池。
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

.task-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.task-url {
  font-size: var(--font-size-xs);
  word-break: break-all;
}

.task-meta {
  font-size: var(--font-size-xs);
}

.progress-text {
  display: block;
  margin-top: 2px;
  font-size: var(--font-size-xs);
}

.error-line {
  font-size: var(--font-size-xs);
  color: var(--color-error);
  word-break: break-all;
}

:deep(.el-table .cell) {
  padding-top: 4px;
  padding-bottom: 4px;
}
</style>
