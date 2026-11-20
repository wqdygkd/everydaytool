<script setup lang="ts">
import type { OpenTool } from '../../stores/toolTabs'
import type { RailMode } from '../composables/useRailMode'
import type { IconName } from './ui/icons'

const props = withDefaults(defineProps<{
  activeId?: string | null
  /** 已打开的工具（toolTabs store），按打开顺序 */
  openTools?: OpenTool[]
  showSettings?: boolean
  /** 图标栏 / 宽栏 / 收起；由标题栏的侧栏按钮切换 */
  mode?: RailMode
}>(), {
  activeId: null,
  openTools: () => [],
  showSettings: true,
  mode: 'compact',
})

const emit = defineEmits<{
  home: []
  search: []
  settings: []
  selectTool: [toolId: string]
  close: [toolId: string]
  /** 拖拽后的 openIds 顺序 */
  reorderOpen: [ids: string[]]
}>()

const isWide = computed(() => props.mode === 'wide')
const isCollapsed = computed(() => props.mode === 'collapsed')

const DRAG_SETTLE_MS = 220
const DRAG_THRESHOLD = 4

interface RailTool {
  id: string
  name: string
  icon: IconName
  /** 此刻是否「打开中」（决定运行圆点与关闭钮） */
  open: boolean
}

/** 左轨 = 已打开的工具，顺序即 openIds；拖拽只重排这一份列表。 */
const railTools = computed<RailTool[]>(() =>
  props.openTools.map(tool => ({
    id: tool.id,
    name: tool.name,
    icon: tool.icon,
    open: true,
  })),
)

const scrollRef = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)
const dragBaseOrder = ref<string[]>([])
const dragPreviewOrder = ref<string[]>([])
const dragSlots = ref<{ id: string, top: number, height: number }[]>([])
const dragOffset = ref(0)
const dragMinOffset = ref(0)
const dragMaxOffset = ref(0)
let dragStartY = 0
let suppressClickUntil = 0
let pendingDragId: string | null = null

function railIds(): string[] {
  return railTools.value.map(tool => tool.id)
}

function resetDragState() {
  pendingDragId = null
  draggingId.value = null
  dragBaseOrder.value = []
  dragPreviewOrder.value = []
  dragSlots.value = []
  dragOffset.value = 0
  dragMinOffset.value = 0
  dragMaxOffset.value = 0
}

/**
 * mousedown + window 级 mousemove / mouseup（捕获阶段）：
 * 超过 4px 后图标纵向跟手、其余项让位，松手才落盘。
 */
function onMouseDown(event: MouseEvent, tool: RailTool) {
  if (event.button !== 0) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.rail-close')) return

  pendingDragId = tool.id
  dragStartY = event.clientY
  window.addEventListener('mousemove', onWindowMouseMove, true)
  window.addEventListener('mouseup', onWindowMouseUp, true)
  window.addEventListener('keydown', onWindowKeydown, true)
  window.addEventListener('blur', onWindowBlur)
}

function captureDragSlots(): { id: string, top: number, height: number }[] {
  const root = scrollRef.value
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('.rail-item'))
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return { id: element.dataset.toolId ?? '', top: rect.top, height: rect.height }
    })
    .filter(slot => slot.id !== '')
}

function startMouseDrag(): boolean {
  const id = pendingDragId
  if (!id) return false

  const ids = railIds()
  const slots = captureDragSlots()
  const sourceSlot = slots[ids.indexOf(id)]
  if (ids.length < 2 || !sourceSlot || slots.length !== ids.length) {
    stopMouseListeners()
    pendingDragId = null
    return false
  }

  draggingId.value = id
  dragBaseOrder.value = ids
  dragPreviewOrder.value = [...ids]
  dragSlots.value = slots
  dragOffset.value = 0
  // 首 / 末槽各放 2px 余量：夹到边界时中心仍能越过相邻槽中线
  dragMinOffset.value = slots[0]!.top - sourceSlot.top - 2
  dragMaxOffset.value = slots[slots.length - 1]!.top - sourceSlot.top + 2
  return true
}

function onWindowMouseMove(event: MouseEvent) {
  if (!pendingDragId) return
  if (!draggingId.value) {
    if (Math.abs(event.clientY - dragStartY) < DRAG_THRESHOLD) return
    if (!startMouseDrag()) return
  }
  event.preventDefault()
  dragOffset.value = Math.min(dragMaxOffset.value, Math.max(dragMinOffset.value, event.clientY - dragStartY))

  const sourceIndex = dragBaseOrder.value.indexOf(draggingId.value ?? '')
  const sourceSlot = dragSlots.value[sourceIndex]
  if (!sourceSlot) return

  const centerY = sourceSlot.top + dragOffset.value + sourceSlot.height / 2
  let insertIndex = dragSlots.value.length
  for (let index = 0; index < dragSlots.value.length; index++) {
    const slot = dragSlots.value[index]!
    if (centerY < slot.top + slot.height / 2) {
      insertIndex = index
      break
    }
  }
  const targetIndex = insertIndex > sourceIndex ? insertIndex - 1 : insertIndex
  if (targetIndex === sourceIndex) {
    // 拖回原位：其他项要跟着复位，否则它们停在上一次让位的位置，和拖拽项叠在一起
    if (dragPreviewOrder.value.some((id, index) => id !== dragBaseOrder.value[index])) {
      dragPreviewOrder.value = [...dragBaseOrder.value]
    }
    return
  }

  const next = [...dragBaseOrder.value]
  next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, draggingId.value!)
  dragPreviewOrder.value = next
}

function dragTransform(tool: RailTool): { transform: string } | undefined {
  if (tool.id === draggingId.value) {
    return { transform: `translate3d(0, ${dragOffset.value}px, 0)` }
  }

  const from = dragBaseOrder.value.indexOf(tool.id)
  const to = dragPreviewOrder.value.indexOf(tool.id)
  if (from < 0 || to < 0 || from === to) return undefined

  const fromSlot = dragSlots.value[from]
  const toSlot = dragSlots.value[to]
  if (!fromSlot || !toSlot) return undefined
  return { transform: `translate3d(0, ${toSlot.top - fromSlot.top}px, 0)` }
}

function stopMouseListeners() {
  window.removeEventListener('mousemove', onWindowMouseMove, true)
  window.removeEventListener('mouseup', onWindowMouseUp, true)
  window.removeEventListener('keydown', onWindowKeydown, true)
  window.removeEventListener('blur', onWindowBlur)
}

function onWindowMouseUp() {
  if (!pendingDragId) return
  const preview = [...dragPreviewOrder.value]
  const base = dragBaseOrder.value
  const changed = preview.length > 0 && preview.some((id, index) => id !== base[index])
  const wasDragging = draggingId.value !== null
  stopMouseListeners()
  resetDragState()
  if (!wasDragging) return
  suppressClickUntil = Date.now() + DRAG_SETTLE_MS
  if (!changed) return
  emit('reorderOpen', preview)
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  stopMouseListeners()
  resetDragState()
}

function onWindowBlur() {
  if (!pendingDragId) return
  stopMouseListeners()
  resetDragState()
}

function onSelect(tool: RailTool) {
  // 拖拽落点会补发一次 click：排序刚结束时不要顺手切走当前工具
  if (Date.now() < suppressClickUntil) return
  emit('selectTool', tool.id)
}

function closeLabel(tool: RailTool): string {
  return `关闭 ${tool.name}`
}
</script>

<template>
  <aside
    id="app-rail"
    class="app-rail"
    :class="[`is-${props.mode}`, { 'is-reordering': draggingId !== null }]"
    :inert="isCollapsed"
    aria-label="工具导航"
  >
    <div ref="scrollRef" class="rail-scroll">
      <UiTooltip text="首页">
        <button
          type="button"
          class="rail-button"
          :class="{ 'is-active': !props.activeId }"
          aria-label="首页"
          :aria-current="!props.activeId ? 'page' : undefined"
          @click="emit('home')"
        >
          <UiIcon name="home" :size="16" />
          <span v-if="isWide" class="rail-label">首页</span>
        </button>
      </UiTooltip>

      <span class="rail-divider" aria-hidden="true" />

      <div
        v-for="tool in railTools"
        :key="tool.id"
        class="rail-item"
        :class="{ 'is-dragging': draggingId === tool.id }"
        :style="dragTransform(tool)"
        :data-tool-id="tool.id"
        @mousedown.capture="onMouseDown($event, tool)"
      >
        <UiTooltip :text="tool.name">
          <button
            type="button"
            class="rail-button"
            :class="{ 'is-active': props.activeId === tool.id }"
            :aria-label="tool.name"
            :aria-current="props.activeId === tool.id ? 'page' : undefined"
            @click="onSelect(tool)"
          >
            <UiIcon :name="tool.icon" :size="16" />
            <span v-if="isWide" class="rail-label">{{ tool.name }}</span>
            <span v-if="tool.open && props.activeId !== tool.id" class="rail-run-dot" aria-hidden="true" />
          </button>
        </UiTooltip>

        <UiTooltip v-if="tool.open" :text="closeLabel(tool)">
          <button
            type="button"
            class="rail-close"
            :aria-label="closeLabel(tool)"
            @click.stop="emit('close', tool.id)"
          >
            <UiIcon name="close" :size="9" />
          </button>
        </UiTooltip>
      </div>
    </div>

    <div class="rail-stack rail-bottom">
      <UiTooltip text="搜索工具  Ctrl K">
        <button
          type="button"
          class="rail-button"
          aria-label="搜索工具（Ctrl K）"
          @click="emit('search')"
        >
          <UiIcon name="search" :size="16" />
          <span v-if="isWide" class="rail-label">搜索工具</span>
        </button>
      </UiTooltip>

      <UiTooltip v-if="props.showSettings" text="设置">
        <button
          type="button"
          class="rail-button"
          :class="{ 'is-active': props.activeId === 'settings' }"
          aria-label="设置"
          :aria-current="props.activeId === 'settings' ? 'page' : undefined"
          @click="emit('settings')"
        >
          <UiIcon name="gear" :size="16" />
          <span v-if="isWide" class="rail-label">设置</span>
        </button>
      </UiTooltip>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.app-rail {
  position: relative;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 var(--rail-width);
  width: var(--rail-width);
  min-width: 0;
  min-height: 0;
  padding: 10px 0 12px;
  overflow: hidden;
  background: transparent;
  transition:
    flex-basis var(--transition-base),
    width var(--transition-base),
    padding var(--transition-base),
    opacity var(--transition-fast);
}

/* 宽栏：名称与图标同排，行宽吃满轨道；宽度与标题栏切换按钮一一对应 */
.app-rail.is-wide {
  flex-basis: var(--rail-width-wide);
  width: var(--rail-width-wide);
  padding-right: 8px;
  padding-left: 8px;
  align-items: stretch;

  .rail-scroll,
  .rail-stack {
    align-items: stretch;
  }

  .rail-button {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border-radius: 9px;
  }

  .rail-item .rail-button {
    padding-right: 26px;
  }

  .rail-close {
    top: 9px;
    right: 8px;
  }

  .rail-run-dot {
    position: static;
    flex: none;
    margin-right: 4px;
    margin-left: auto;
  }

  .rail-divider {
    width: auto;
    margin: 6px 8px;
  }
}

/* 收起：轨道宽度归零，内容不可聚焦、不可点击；标题栏的切换按钮仍在 */
.app-rail.is-collapsed {
  flex-basis: 0;
  width: 0;
  padding-right: 0;
  padding-left: 0;
  opacity: 0;
  pointer-events: none;
}

/* 运行列表区：工具多到一列放不下时只滚这里，首页与底部搜索 / 设置始终可见。
   注意 overflow 会裁掉旧的 ::after tooltip，因此提示层换成了 portal 到 body 的 UiTooltip。 */
.rail-scroll {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 0;
  padding-bottom: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.rail-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.rail-bottom {
  flex: none;
}

.rail-item {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 100%;
  user-select: none;
  -webkit-app-region: no-drag;

  &.is-dragging {
    z-index: 3;
    opacity: 0.92;
    cursor: grabbing;
  }
}

/* 排序中：被拖项实时跟手，其余项 160ms 让位 */
.app-rail.is-reordering .rail-item {
  transition: transform 160ms var(--ease-out);
}

.app-rail.is-reordering .rail-item.is-dragging {
  transition: none;
}

.rail-button {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: var(--rail-control-size);
  height: var(--rail-control-size);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  outline: none;
  -webkit-app-region: no-drag;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);

  &:hover {
    border-color: transparent;
    background: color-mix(in srgb, var(--color-primary) 7%, transparent);
    color: var(--color-text-primary);
  }

  &.is-active {
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);

    &::before {
      position: absolute;
      left: -6px;
      width: 3px;
      height: 18px;
      border-radius: 0 2px 2px 0;
      background: var(--color-primary);
      content: '';
      animation: rail-indicator-in var(--duration-fast) var(--ease-out);
    }
  }

  &:focus-visible {
    box-shadow: var(--shadow-focus);
  }

  &:active {
    transform: scale(0.97);
  }
}

/* 运行中圆点：只在「已打开但未激活」时出现；激活态已有浅底 + 左侧指示条，不再重复标记 */
.rail-run-dot {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-primary);
  pointer-events: none;
}

/* 关闭钮：悬停 / 键盘聚焦才显现，避免 40px 图标长期被小叉遮住 */
.rail-close {
  position: absolute;
  top: 0;
  right: 3px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  padding: 0;
  border: 1px solid var(--color-border-light);
  border-radius: 999px;
  background: var(--color-raised);
  box-shadow: var(--shadow-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  opacity: 0;
  outline: none;
  transform: scale(0.9);
  -webkit-app-region: no-drag;
  transition:
    opacity var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);

  &:hover {
    background: var(--color-fill);
    color: var(--color-text-primary);
  }

  &:focus-visible {
    opacity: 1;
    box-shadow: var(--shadow-focus);
  }
}

.rail-item:hover .rail-close,
.rail-item:focus-within .rail-close {
  opacity: 1;
  transform: none;
}

.rail-label {
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-size-sm);
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-divider {
  width: 24px;
  height: 1px;
  margin: 1px 0 2px;
  background: var(--color-border-light);
}

@keyframes rail-indicator-in {
  from {
    opacity: 0;
    transform: scaleY(0.35);
  }

  to {
    opacity: 1;
    transform: scaleY(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-rail {
    transition: none;
  }

  .rail-button.is-active::before {
    animation: none;
  }
}
</style>
