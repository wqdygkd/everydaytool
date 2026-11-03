<script setup lang="ts">
import type { ToolDropPosition } from '../shared/tool/tool-order'
import type { ToolDefinition } from '../shared/types/tool'
import LauncherRow from '../shared/components/LauncherRow.vue'
import { useCommandPalette } from '../shared/composables/useCommandPalette'
import { useToolLauncher } from '../shared/composables/useToolLauncher'
import { moveToolInOrder } from '../shared/tool/tool-order'

interface DragSlot {
  left: number
  top: number
  width: number
  height: number
}

const router = useRouter()
const { openPalette } = useCommandPalette()
const {
  orderedTools,
  savedToolOrder,
  isFavorite,
  toggleFavorite,
  commitToolOrder,
  resetToolOrder,
  syncPreferencesWithConfigLayer,
} = useToolLauncher()

const DRAG_MIME = 'application/x-edt-tool-id'
const DRAG_SETTLE_MS = 220

const gridRef = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)
const dragBaseOrder = ref<string[]>([])
const dragPreviewOrder = ref<string[]>([])
const dragSlots = ref<DragSlot[]>([])
let cancelTimer: number | null = null
let suppressClickUntil = 0

const hasCustomOrder = computed(() => savedToolOrder.value.length > 0)
const canReorder = computed(() => orderedTools.value.length > 1)

function openTool(tool: ToolDefinition) {
  if (Date.now() < suppressClickUntil) return
  router.push({ name: `tool-${tool.id}` })
}

function captureDragSlots(): DragSlot[] {
  const wrapper = gridRef.value
  if (!wrapper) return []
  return Array.from(wrapper.querySelectorAll<HTMLElement>('.tool-cell'), cell => ({
    left: cell.offsetLeft,
    top: cell.offsetTop,
    width: cell.offsetWidth,
    height: cell.offsetHeight,
  }))
}

function resolveSlotIndex(x: number, y: number): number | null {
  const slots = dragSlots.value
  if (slots.length === 0) return null

  let index = -1
  let minDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const dx = Math.max(slot.left - x, 0, x - (slot.left + slot.width))
    const dy = Math.max(slot.top - y, 0, y - (slot.top + slot.height))
    const distance = Math.hypot(dx, dy)
    if (distance < minDistance) {
      minDistance = distance
      index = i
    }
  }
  return index >= 0 ? index : null
}

function dragTransform(toolId: string): { transform: string } | undefined {
  if (!draggingId.value || dragPreviewOrder.value.length === 0) return undefined

  const from = dragBaseOrder.value.indexOf(toolId)
  const to = dragPreviewOrder.value.indexOf(toolId)
  if (from < 0 || to < 0 || from === to) return undefined

  const fromSlot = dragSlots.value[from]
  const toSlot = dragSlots.value[to]
  if (!fromSlot || !toSlot) return undefined

  const x = toSlot.left - fromSlot.left
  const y = toSlot.top - fromSlot.top
  if (x === 0 && y === 0) return undefined
  return { transform: `translate3d(${x}px, ${y}px, 0)` }
}

function onDragStart(event: DragEvent, tool: ToolDefinition) {
  if (!canReorder.value) {
    event.preventDefault()
    return
  }

  if (cancelTimer !== null) {
    window.clearTimeout(cancelTimer)
    cancelTimer = null
  }

  const baseOrder = orderedTools.value.map(item => item.id)
  draggingId.value = tool.id
  dragBaseOrder.value = baseOrder
  dragPreviewOrder.value = [...baseOrder]
  const slots = captureDragSlots()
  dragSlots.value = slots.length === baseOrder.length ? slots : []

  const transfer = event.dataTransfer
  if (transfer) {
    transfer.effectAllowed = 'move'
    transfer.setData(DRAG_MIME, tool.id)
  }
}

function onGridDragEnter(event: DragEvent) {
  if (draggingId.value) event.preventDefault()
}

function onGridDragOver(event: DragEvent) {
  const sourceId = draggingId.value
  if (!sourceId) return

  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

  const wrapper = gridRef.value
  if (!wrapper || dragSlots.value.length === 0) return

  const rect = wrapper.getBoundingClientRect()
  const x = event.clientX - rect.left
  const slotIndex = resolveSlotIndex(x, event.clientY - rect.top)
  if (slotIndex === null) return

  const slot = dragSlots.value[slotIndex]
  const preview = dragPreviewOrder.value
  const targetId = preview[slotIndex]
  if (!slot || !targetId) return

  const position: ToolDropPosition = x > slot.left + slot.width / 2 ? 'after' : 'before'
  const next = moveToolInOrder(preview, sourceId, targetId, position)
  if (next) dragPreviewOrder.value = next
}

function commitDragOrder() {
  const preview = dragPreviewOrder.value
  const base = dragBaseOrder.value
  const changed = preview.length > 0 && preview.some((id, index) => id !== base[index])

  if (cancelTimer !== null) {
    window.clearTimeout(cancelTimer)
    cancelTimer = null
  }
  draggingId.value = null
  dragPreviewOrder.value = []
  dragBaseOrder.value = []
  dragSlots.value = []
  suppressClickUntil = Date.now() + DRAG_SETTLE_MS
  if (changed) commitToolOrder([...preview])
}

function cancelDragOrder() {
  if (!draggingId.value) return
  if (cancelTimer !== null) window.clearTimeout(cancelTimer)

  suppressClickUntil = Date.now() + DRAG_SETTLE_MS
  dragPreviewOrder.value = []
  cancelTimer = window.setTimeout(() => {
    draggingId.value = null
    dragBaseOrder.value = []
    dragSlots.value = []
    cancelTimer = null
  }, DRAG_SETTLE_MS)
}

function onGridDrop(event: DragEvent) {
  if (!draggingId.value) return
  event.preventDefault()
  commitDragOrder()
}

function onDragEnd() {
  if (draggingId.value) cancelDragOrder()
}

onMounted(() => {
  void syncPreferencesWithConfigLayer()
})

onBeforeUnmount(() => {
  if (cancelTimer !== null) window.clearTimeout(cancelTimer)
})
</script>

<template>
  <div class="home-page" :class="{ 'is-dragging': draggingId !== null }">
    <div class="home-head">
      <div>
        <h1>工具台</h1>
        <p>{{ orderedTools.length }} 个本地工具；打开时运行，关闭即释放。</p>
      </div>
    </div>

    <button
      type="button"
      class="search-dock"
      aria-label="搜索工具（Ctrl K）"
      aria-haspopup="dialog"
      @click="openPalette()"
    >
      <UiIcon name="search" :size="18" />
      <span class="search-placeholder">搜索工具、能力或关键词</span>
      <span class="search-shortcut">
        <span>快速打开</span>
        <kbd>Ctrl K</kbd>
      </span>
    </button>

    <section v-if="orderedTools.length > 0" class="launcher">
      <header class="launcher-head">
        <span>所有工具</span>
        <div class="launcher-actions">
          <span v-if="canReorder" class="drag-hint">拖动调整顺序</span>
          <UiIconButton
            v-if="hasCustomOrder"
            icon="refresh"
            :size="28"
            label="恢复默认排序"
            @click="resetToolOrder"
          />
        </div>
      </header>

      <div
        ref="gridRef"
        class="launcher-grid"
        @dragenter="onGridDragEnter"
        @dragover="onGridDragOver"
        @drop="onGridDrop"
      >
        <div
          v-for="tool in orderedTools"
          :key="tool.id"
          class="tool-cell"
          :class="{ 'is-dragging': draggingId === tool.id }"
          :style="dragTransform(tool.id)"
          :draggable="canReorder"
          @dragstart="onDragStart($event, tool)"
          @dragend="onDragEnd"
        >
          <LauncherRow
            :tool="tool"
            :pinned="isFavorite(tool.id)"
            @open="openTool(tool)"
            @toggle-pin="toggleFavorite(tool.id)"
          />
        </div>
      </div>
    </section>

    <UiEmpty
      v-else
      class="home-empty"
      title="还没有可用工具"
      text="检查当前平台支持范围，或到设置中确认安装与数据目录。"
      center
    />
  </div>
</template>

<style scoped lang="scss">
.home-page {
  width: 100%;
  height: 100%;
  padding: 34px 42px 32px;
  overflow-x: hidden;
  overflow-y: auto;

  &.is-dragging {
    cursor: grabbing;

    .launcher-row {
      cursor: grabbing;
      pointer-events: none;
    }
  }
}

.home-head,
.search-dock,
.launcher {
  width: min(100%, var(--content-max-width));
  margin-right: auto;
  margin-left: auto;
}

.home-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-xl);
  margin-bottom: 22px;

  h1 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-display);
    font-weight: var(--font-weight-medium);
    line-height: 1.18;
    letter-spacing: -0.03em;
  }

  p {
    margin: 5px 0 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }
}

.search-dock {
  display: flex;
  align-items: center;
  gap: 11px;
  height: 54px;
  padding: 0 17px;
  border: 1px solid color-mix(in srgb, var(--color-border) 76%, transparent);
  border-radius: var(--radius-lg);
  background: var(--color-input);
  backdrop-filter: var(--glass-input);
  box-shadow: inset 0 1px 0 var(--color-highlight);
  color: var(--color-text-tertiary);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);

  &:hover {
    border-color: var(--color-border);
  }

  &:focus-visible {
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 12%, transparent);
  }
}

.search-placeholder {
  flex: 1;
  min-width: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-base);
}

.search-shortcut {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);

  kbd {
    padding: 3px 6px;
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-xs);
    background: color-mix(in srgb, var(--color-fill) 82%, transparent);
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1.2;
  }
}

.launcher {
  margin-top: 22px;
  padding: 7px;
  border: 1px solid color-mix(in srgb, var(--color-on-solid) 58%, var(--color-border-light));
  border-radius: var(--radius-lg);
  background: var(--color-raised);
  backdrop-filter: var(--glass-raised);
  box-shadow: inset 0 1px 0 var(--color-highlight), var(--shadow-sm);
}

.launcher-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  height: 44px;
  padding: 0 10px;
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.launcher-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.drag-hint {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-regular);
}

.launcher-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 8px;
  padding-top: 3px;
}

.tool-cell {
  position: relative;
  display: flex;
  min-width: 0;
  border-radius: var(--radius-md);

  > .launcher-row {
    flex: 1;
    min-width: 0;
  }

  &.is-dragging {
    z-index: 1;

    > .launcher-row {
      border-color: color-mix(in srgb, var(--color-primary) 48%, transparent);
      border-style: dashed;
      opacity: 0.42;
      transform: scale(0.985);
    }
  }
}

.home-page.is-dragging .tool-cell {
  transition: transform var(--duration-base) var(--ease-out);
  will-change: transform;
}

.home-empty {
  width: min(100%, var(--content-max-width));
  min-height: 240px;
  margin: 22px auto 0;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-raised);
}

@media (max-width: 1040px) {
  .home-page {
    padding-right: 28px;
    padding-left: 28px;
  }

  .launcher-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .home-page {
    padding: 24px 18px 28px;
  }

  .home-head {
    margin-bottom: 18px;
  }

  .search-dock {
    height: 48px;
  }

  .search-shortcut > span {
    display: none;
  }

  .launcher {
    margin-top: 18px;
  }
}

@media (hover: none) {
  .drag-hint {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .search-dock,
  .tool-cell {
    transition-duration: 0.01ms;
  }
}
</style>
