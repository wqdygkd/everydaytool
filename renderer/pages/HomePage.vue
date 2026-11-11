<script setup lang="ts">
import type { ToolDropPosition } from '../shared/tool/tool-order'
import type { ToolDefinition } from '../shared/types/tool'
import { useEventListener } from '@vueuse/core'
import { useCommandPalette } from '../shared/composables/useCommandPalette'
import { useToolLauncher } from '../shared/composables/useToolLauncher'
import { moveToolInOrder } from '../shared/tool/tool-order'
import { useToolTabsStore } from '../stores/toolTabs'

interface DragSlot {
  left: number
  top: number
  width: number
  height: number
}

const router = useRouter()
const { openPalette } = useCommandPalette()
const toolsStore = useToolTabsStore()
const {
  orderedTools,
  isFavorite,
  toggleFavorite,
  commitToolOrder,
  syncPreferencesWithConfigLayer,
} = useToolLauncher()

const DRAG_MIME = 'application/x-edt-tool-id'
const DRAG_SETTLE_MS = 220

const isMac = /Macintosh|MacIntel|Mac OS/i.test(navigator.userAgent)
const shortcutLabel = isMac ? '⌘ K' : 'Ctrl K'

const listRef = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)
const dragBaseOrder = ref<string[]>([])
const dragPreviewOrder = ref<string[]>([])
const dragSlots = ref<DragSlot[]>([])
const now = ref(Date.now())
let cancelTimer: number | null = null
let clockTimer: number | null = null
let suppressClickUntil = 0

const canReorder = computed(() => orderedTools.value.length > 1)
const openSet = computed(() => new Set(toolsStore.openIds))
const runningTools = computed(() => toolsStore.runningTools)
const recentTools = computed(() => toolsStore.recentTools)

function isRunning(toolId: string): boolean {
  return openSet.value.has(toolId)
}

function pushTool(toolId: string) {
  const last = toolsStore.lastRoute(toolId)
  const fallback = () => router.push({ name: `tool-${toolId}` })
  return last ? router.push(last).catch(fallback) : fallback()
}

function openTool(tool: ToolDefinition) {
  if (Date.now() < suppressClickUntil) return
  void pushTool(tool.id)
}

function openToolById(toolId: string) {
  void pushTool(toolId)
}

function formatAge(timestamp: number | undefined): string {
  if (!timestamp) return '刚刚'
  const minutes = Math.floor(Math.max(0, now.value - timestamp) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时`
  const days = Math.floor(hours / 24)
  return days === 1 ? '昨天' : `${days} 天`
}

function captureDragSlots(): DragSlot[] {
  const wrapper = listRef.value
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

function onListDragEnter(event: DragEvent) {
  if (draggingId.value) event.preventDefault()
}

function onListDragOver(event: DragEvent) {
  const sourceId = draggingId.value
  if (!sourceId) return

  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

  const wrapper = listRef.value
  if (!wrapper || dragSlots.value.length === 0) return

  const rect = wrapper.getBoundingClientRect()
  const x = event.clientX - rect.left
  const slotIndex = resolveSlotIndex(x, event.clientY - rect.top)
  if (slotIndex === null) return

  const slot = dragSlots.value[slotIndex]
  const preview = dragPreviewOrder.value
  const targetId = preview[slotIndex]
  if (!slot || !targetId) return

  const position: ToolDropPosition = event.clientY > slot.top + slot.height / 2 ? 'after' : 'before'
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

function onListDrop(event: DragEvent) {
  if (!draggingId.value) return
  event.preventDefault()
  commitDragOrder()
}

function onDragEnd() {
  if (draggingId.value) cancelDragOrder()
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function onHomeKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat) return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (isTypingTarget(event.target)) return
  if (event.key.length !== 1 || !/^[1-9]$/.test(event.key)) return

  const tool = orderedTools.value[Number(event.key) - 1]
  if (!tool) return
  event.preventDefault()
  openTool(tool)
}

useEventListener(window, 'keydown', onHomeKeydown)

onMounted(() => {
  void syncPreferencesWithConfigLayer()
  clockTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})

onBeforeUnmount(() => {
  if (cancelTimer !== null) window.clearTimeout(cancelTimer)
  if (clockTimer !== null) window.clearInterval(clockTimer)
})
</script>

<template>
  <div class="home-page" :class="{ 'is-dragging': draggingId !== null }">
    <div class="home-inner">
      <div class="home-main">
        <header class="masthead">
          <h1>工具台</h1>
          <p>{{ orderedTools.length }} 个本地工具；打开时运行，关闭即释放。</p>
          <span class="grow" aria-hidden="true" />
          <button
            type="button"
            class="search-btn"
            aria-label="搜索工具"
            aria-haspopup="dialog"
            @click="openPalette()"
          >
            <UiIcon name="search" :size="14" />
            <span>搜索</span>
            <kbd>{{ shortcutLabel }}</kbd>
          </button>
        </header>

        <section
          v-if="orderedTools.length > 0"
          ref="listRef"
          class="idx"
          aria-label="工具索引"
          @dragenter="onListDragEnter"
          @dragover="onListDragOver"
          @drop="onListDrop"
        >
          <div
            v-for="(tool, index) in orderedTools"
            :key="tool.id"
            class="tool-cell idx-row"
            :class="{ 'is-dragging': draggingId === tool.id }"
            :style="dragTransform(tool.id)"
            :draggable="canReorder"
            @dragstart="onDragStart($event, tool)"
            @dragend="onDragEnd"
          >
            <button
              type="button"
              class="idx-open"
              :aria-label="`打开 ${tool.name}`"
              @click="openTool(tool)"
            >
              <span class="idx-num-wrap" title="拖动调整顺序">
                <span class="idx-num">{{ index + 1 }}</span>
                <span class="idx-grip" aria-hidden="true" />
              </span>
              <span class="idx-tile">
                <UiIcon :name="tool.icon" :size="16" />
              </span>
              <span class="idx-main">
                <span class="idx-name">{{ tool.name }}</span>
                <span class="idx-desc">{{ tool.description }}</span>
              </span>
              <span class="idx-state" :class="{ 'is-live': isRunning(tool.id) }">
                <i class="dot" aria-hidden="true" />
                {{ isRunning(tool.id) ? '运行中' : '未运行' }}
              </span>
            </button>
            <button
              type="button"
              class="idx-pin"
              :class="{ 'is-on': isFavorite(tool.id) }"
              :aria-pressed="isFavorite(tool.id)"
              :aria-label="isFavorite(tool.id) ? `取消置顶 ${tool.name}` : `置顶 ${tool.name}`"
              :title="isFavorite(tool.id) ? `取消置顶 ${tool.name}` : `置顶 ${tool.name}`"
              @click="toggleFavorite(tool.id)"
            >
              <UiIcon name="star" :size="14" />
            </button>
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

      <aside class="home-side">
        <section class="side-sec">
          <div class="side-lbl">
            正在运行
          </div>
          <div class="side-card">
            <button
              v-for="tool in runningTools"
              :key="tool.id"
              type="button"
              class="run-item"
              @click="openToolById(tool.id)"
            >
              <span class="run-tile">
                <UiIcon :name="tool.icon" :size="13" />
              </span>
              <span class="run-name">{{ tool.name }}</span>
              <span class="run-when">{{ formatAge(toolsStore.openedAtById[tool.id]) }}</span>
            </button>
            <p v-if="runningTools.length === 0" class="side-note">
              没有正在运行的工具
            </p>
          </div>
        </section>

        <section class="side-sec">
          <div class="side-lbl">
            最近打开
          </div>
          <div class="side-card">
            <button
              v-for="tool in recentTools"
              :key="tool.id"
              type="button"
              class="run-item"
              @click="openToolById(tool.id)"
            >
              <span class="run-tile">
                <UiIcon :name="tool.icon" :size="13" />
              </span>
              <span class="run-name">{{ tool.name }}</span>
              <span class="run-when">{{ formatAge(toolsStore.openedAtById[tool.id]) }}</span>
            </button>
            <p v-if="recentTools.length === 0" class="side-note">
              还没有打开记录
            </p>
          </div>
        </section>

        <section class="side-sec">
          <div class="side-lbl">
            键盘
          </div>
          <div class="side-card">
            <div class="key-row">
              <span>直接启动</span>
              <kbd>1 – {{ orderedTools.length }}</kbd>
            </div>
            <div class="key-row">
              <span>搜索工具</span>
              <kbd>{{ shortcutLabel }}</kbd>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped lang="scss">
.home-page {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 36px 40px 32px;
  overflow-x: hidden;
  overflow-y: auto;

  &.is-dragging {
    cursor: grabbing;

    .idx-open {
      cursor: grabbing;
      pointer-events: none;
    }
  }
}

.home-inner {
  display: flex;
  align-items: flex-start;
  gap: 34px;
  width: min(100%, var(--content-max-width));
  margin: 0 auto;
}

.home-main {
  flex: 1;
  min-width: 0;
}

.home-side {
  display: grid;
  flex: 0 0 286px;
  gap: 20px;
}

.masthead {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-bottom: 20px;

  h1 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-display);
    font-weight: var(--font-weight-medium);
    line-height: 1.18;
    letter-spacing: -0.03em;
  }

  p {
    margin: 0 0 3px;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }

  .grow {
    flex: 1;
  }
}

.search-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  margin-bottom: 2px;
  padding: 0 12px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-raised) 46%, transparent);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    color var(--transition-fast);

  &:hover {
    border-color: var(--color-border);
    color: var(--color-text-secondary);
  }

  &:focus-visible {
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
    outline: none;
  }

  kbd {
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--color-app-bg);
    color: var(--color-text-secondary);
    font-family: var(--font-ui);
    font-size: 10.5px;
  }
}

.idx {
  display: grid;
  gap: 2px;
}

.idx-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);

  &:hover {
    border-color: transparent;
    background: color-mix(in srgb, var(--color-primary) 7%, transparent);
  }
}

.idx-open {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  height: 52px;
  padding: 0 4px 0 6px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.idx-num-wrap {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 16px;
  height: 18px;
  cursor: grab;
}

.idx-num {
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  transition: opacity var(--transition-fast);
}

.idx-grip {
  position: absolute;
  inset: 50% auto auto 50%;
  width: 8px;
  height: 12px;
  background-image: radial-gradient(circle, currentColor 1px, transparent 1.2px);
  background-position: 0 0;
  background-size: 4px 4px;
  color: var(--color-text-tertiary);
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity var(--transition-fast);
}

.idx-row:hover .idx-num {
  opacity: 0;
}

.idx-row:hover .idx-grip {
  opacity: 1;
}

.idx-tile {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.idx-main {
  display: grid;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.idx-name {
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  line-height: 1.2;
  white-space: nowrap;
}

.idx-desc {
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.idx-state {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #9fb0c0;
  }

  &.is-live {
    color: var(--color-success);

    .dot {
      background: var(--color-success);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 14%, transparent);
    }
  }
}

.idx-pin {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-tertiary);
  opacity: 0;
  cursor: pointer;
  transition:
    opacity var(--transition-fast),
    background var(--transition-fast),
    color var(--transition-fast);

  &:hover {
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
    color: var(--color-primary-strong);
  }

  &.is-on {
    color: var(--color-primary-strong);
    opacity: 1;

    :deep(svg) {
      fill: currentColor;
    }
  }
}

.idx-row:hover .idx-pin,
.idx-pin:focus-visible {
  opacity: 1;
}

.tool-cell.is-dragging {
  z-index: 1;

  .idx-open {
    border-radius: var(--radius-md);
    opacity: 0.42;
  }
}

.home-page.is-dragging .tool-cell {
  transition: transform var(--duration-base) var(--ease-out);
  will-change: transform;
}

.side-sec {
  min-width: 0;
}

.side-lbl {
  margin-bottom: 7px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.04em;
}

.side-card {
  display: grid;
  gap: 9px;
  padding: 11px 12px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-raised) 46%, transparent);
}

.run-item {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.run-tile {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-xs);
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.run-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.run-when {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);

  kbd {
    padding: 1px 7px;
    border: 1px solid var(--color-border-light);
    border-radius: 5px;
    background: var(--color-app-bg);
    color: var(--color-text-secondary);
    font-family: var(--font-ui);
    font-size: 10.5px;
  }
}

.side-note {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.home-empty {
  min-height: 240px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-raised);
}

@media (max-width: 1100px) {
  .home-page {
    padding-right: 28px;
    padding-left: 28px;
  }

  .home-inner {
    gap: 24px;
  }

  .home-side {
    flex-basis: 250px;
  }
}

@media (max-width: 900px) {
  .home-inner {
    flex-direction: column;
  }

  .home-side {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
    flex-basis: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .search-btn,
  .idx-row,
  .idx-pin,
  .idx-num,
  .idx-grip,
  .tool-cell {
    transition-duration: 0.01ms;
  }
}
</style>
