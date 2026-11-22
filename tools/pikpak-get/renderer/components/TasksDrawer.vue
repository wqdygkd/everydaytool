<script setup lang="ts">
import type { PikpakGetTask } from '../../../../shared/pikpak-get'
import { toast } from 'vue-sonner'
import { humanPikpakBytes } from '../../../../shared/pikpak-get'
import { usePikpakGetStore } from '../stores/pikpakGetStore'

const store = usePikpakGetStore()

const open = defineModel<boolean>({ default: false })

const tasks = computed(() => store.tasks)
const activeTasks = computed(() => store.activeTasks)

const STATUS_LABELS: Record<PikpakGetTask['status'], string> = {
  queued: '排队中',
  running: '下载中',
  cancelling: '取消中',
  done: '完成',
  partial: '部分完成',
  error: '失败',
  cancelled: '已取消',
}

function currentFile(task: PikpakGetTask): PikpakGetTask['files'][string] | null {
  if (!task.currentFile) return null
  return task.files[task.currentFile] ?? null
}

function displayFile(task: PikpakGetTask): PikpakGetTask['files'][string] {
  return currentFile(task) ?? { nodeId: '', name: '', size: 0, downloaded: 0, speed: 0, eta: 0 }
}

function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}时${m}分`
  if (m > 0) return `${m}分${s}秒`
  return `${s}秒`
}

function percent(task: PikpakGetTask): number {
  const file = currentFile(task)
  if (!file || !file.size) return 0
  return Math.min(100, Math.round((file.downloaded / file.size) * 100))
}

async function cancel(taskId: string): Promise<void> {
  try {
    await store.cancelTask(taskId)
  } catch (error) {
    toast.error((error as Error).message || '取消失败')
  }
}
</script>

<template>
  <Transition name="tasks-drawer">
    <aside v-if="open" class="tasks-drawer">
      <header class="drawer-head">
        <span class="drawer-title">下载任务</span>
        <span class="drawer-meta">{{ activeTasks.length }} 个进行中</span>
        <span class="drawer-actions">
          <UiIconButton icon="refresh" label="刷新任务" @click="store.refreshTasks()" />
          <UiIconButton icon="close" label="收起" @click="open = false" />
        </span>
      </header>

      <div class="drawer-body">
        <div v-if="!tasks.length" class="empty-block">
          <UiEmpty text="暂无下载任务；在分享链接里解析并勾选后开始" />
        </div>

        <div v-else class="task-list">
          <div v-for="task in tasks" :key="task.id" class="task-row">
            <div class="task-head">
              <span class="task-status" :class="`is-${task.status}`">{{ STATUS_LABELS[task.status] }}</span>
              <span class="task-id mono">{{ task.id }}</span>
              <UiButton
                v-if="task.status === 'running' || task.status === 'queued' || task.status === 'cancelling'"
                size="small"
                @click="cancel(task.id)"
              >
                取消
              </UiButton>
            </div>

            <div v-if="currentFile(task)" class="task-current">
              <div class="task-file mono">
                {{ displayFile(task).name }}
              </div>
              <div class="task-bytes mono">
                {{ humanPikpakBytes(displayFile(task).downloaded) }} / {{ humanPikpakBytes(displayFile(task).size) }}
                <template v-if="displayFile(task).speed > 0">
                  · {{ humanPikpakBytes(displayFile(task).speed) }}/s<template v-if="displayFile(task).eta > 0">
                    · 剩余 {{ formatEta(displayFile(task).eta) }}
                  </template>
                </template>
              </div>
              <UiProgress :percentage="percent(task)" :show-text="true" />
            </div>

            <div v-if="task.error" class="task-error">
              {{ task.error }}
            </div>

            <div v-if="task.logs.length" class="task-logs">
              <div v-for="(log, index) in task.logs.slice(-4)" :key="index" class="task-log mono">
                {{ log.ts }} {{ log.level.toUpperCase().padEnd(4, ' ') }} {{ log.message }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<style scoped lang="scss">
.tasks-drawer {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-height: 0;
  max-height: 44%;
  border-top: 1px solid var(--color-border-light);
  background: var(--color-sheet);
}

.drawer-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex: 0 0 40px;
  height: 40px;
  padding: 0 14px;
  border-bottom: 1px solid var(--color-border-light);
}

.drawer-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.drawer-meta {
  flex: 1;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.drawer-actions {
  display: flex;
  gap: var(--spacing-xs);
}

.drawer-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-md);
}

.empty-block {
  width: 100%;
  padding: var(--spacing-md) 0;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  width: 100%;
}

.task-row {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-table);
}

.task-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.task-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);

  &::before {
    content: '';
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--color-text-tertiary);
  }

  &.is-done {
    color: var(--color-success);

    &::before { background: var(--color-success); }
  }

  &.is-partial,
  &.is-cancelling {
    color: var(--color-warning);

    &::before { background: var(--color-warning); }
  }

  &.is-error {
    color: var(--color-error);

    &::before { background: var(--color-error); }
  }

  &.is-running {
    color: var(--color-primary);

    &::before { background: var(--color-primary); }
  }
}

.task-id {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.task-current {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--spacing-xs) var(--spacing-md);
  align-items: center;
}

.task-file {
  grid-column: 1 / -1;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-bytes {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.task-current :deep(.ui-progress) {
  grid-column: 1 / -1;
}

.task-error {
  color: var(--color-error);
  font-size: var(--font-size-xs);
}

.task-logs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--spacing-sm);
  background: var(--color-fill);
  border-radius: var(--radius-sm);
}

.task-log {
  color: var(--color-text-tertiary);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
}

.tasks-drawer-enter-active,
.tasks-drawer-leave-active {
  transition: max-height 190ms var(--ease-out), opacity 190ms var(--ease-out);
}

.tasks-drawer-enter-from,
.tasks-drawer-leave-to {
  max-height: 0;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .tasks-drawer-enter-active,
  .tasks-drawer-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
