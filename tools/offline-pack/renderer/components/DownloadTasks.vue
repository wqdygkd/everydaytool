<script setup lang="ts">
import type { OfflinePackTask } from '../stores/downloads'
import { storeToRefs } from 'pinia'
import { taskPercentage, useOfflinePackDownloadsStore } from '../stores/downloads'

const store = useOfflinePackDownloadsStore()
const { tasks, activeCount, finishedCount } = storeToRefs(store)

function detail(task: OfflinePackTask): string {
  if (task.status === 'running') {
    const progress = task.progress
    const layer = progress?.layerIndex && progress.totalLayers
      ? `（层 ${progress.layerIndex}/${progress.totalLayers}）`
      : ''
    return `${progress?.message ?? '准备中…'}${layer}`
  }
  if (task.status === 'error') return task.error || '下载失败'
  if (task.status === 'cancelled') return '已取消'
  return task.result?.filename ? `已保存：${task.result.filename}` : '已保存到本地下载目录'
}
</script>

<template>
  <section v-if="tasks.length" class="download-tasks" aria-label="下载任务">
    <UiSectionHeader title="下载任务" :count="tasks.length">
      <template #actions>
        <UiButton v-if="finishedCount" size="small" text @click="store.clearFinished()">
          清除已结束
        </UiButton>
      </template>
    </UiSectionHeader>

    <ul class="task-list">
      <li v-for="task in tasks" :key="task.taskId" class="task-row">
        <div class="task-copy">
          <div class="task-title-line">
            <span class="task-title mono text-truncate" :title="task.title">{{ task.title }}</span>
            <UiChip v-if="task.status === 'running'" tone="primary" variant="soft" mono>
              {{ taskPercentage(task) }}%
            </UiChip>
            <UiChip v-else-if="task.status === 'completed'" tone="success" variant="soft">
              已完成
            </UiChip>
            <UiChip v-else-if="task.status === 'cancelled'" variant="outline">
              已取消
            </UiChip>
            <UiChip v-else tone="danger" variant="soft">
              失败
            </UiChip>
          </div>

          <UiProgress v-if="task.status === 'running'" :percentage="taskPercentage(task)" />
          <UiHint size="xs" class="task-detail" :title="detail(task)">
            {{ detail(task) }}
          </UiHint>
        </div>

        <div class="task-actions">
          <UiButton v-if="task.status === 'running'" size="small" @click="store.cancel(task.taskId)">
            取消
          </UiButton>
          <UiButton
            v-else-if="task.status === 'completed'"
            size="small"
            type="primary"
            plain
            @click="store.openDir()"
          >
            打开目录
          </UiButton>
          <UiIconButton
            v-if="task.status !== 'running'"
            icon="close"
            label="移除任务"
            @click="store.dismiss(task.taskId)"
          />
        </div>
      </li>
    </ul>

    <UiHint v-if="activeCount" size="xs" class="tasks-hint">
      可同时下载多个文件，进度会保留在这里
    </UiHint>
  </section>
</template>

<style scoped lang="scss">
.download-tasks {
  flex: none;
  min-width: 0;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 160px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}

.task-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: 9px 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-well);
}

.task-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.task-title-line {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}

.task-title {
  flex: 1;
  min-width: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
}

.task-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.tasks-hint {
  margin-top: var(--spacing-sm);
}
</style>
