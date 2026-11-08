<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  width?: number
  side?: 'left' | 'right'
  closable?: boolean
  bodyPadding?: string
  resizable?: boolean
  minWidth?: number
  maxWidth?: number
  minMainWidth?: number
}>(), {
  width: 320,
  side: 'right',
  closable: true,
  bodyPadding: '14px',
  resizable: false,
  minWidth: 260,
  maxWidth: 720,
  minMainWidth: 280,
})

const emit = defineEmits<{
  'close': []
  'update:width': [width: number]
  'resizeEnd': [width: number]
}>()

const inspector = ref<HTMLElement | null>(null)
const currentWidth = ref(props.width)
const parentWidth = ref(0)
const resizing = ref(false)
let dragState: { pointerId: number, startX: number, startWidth: number, handle: HTMLElement } | null = null
let previousUserSelect = ''
let previousCursor = ''

const maxAllowedWidth = computed(() => {
  const room = parentWidth.value > 0
    ? parentWidth.value - props.minMainWidth
    : props.maxWidth
  return Math.max(props.minWidth, Math.min(props.maxWidth, room))
})

const displayWidth = computed(() => Math.round(Math.min(currentWidth.value, maxAllowedWidth.value)))

watch(() => props.width, (width) => {
  if (!resizing.value) currentWidth.value = width
})

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  measureParent()
}, { immediate: true })

useResizeObserver(() => inspector.value?.parentElement ?? null, (entries) => {
  parentWidth.value = entries[0]?.contentRect.width ?? 0
})

function measureParent(): void {
  parentWidth.value = inspector.value?.parentElement?.clientWidth ?? 0
}

function clampWidth(value: number): number {
  return Math.round(Math.min(maxAllowedWidth.value, Math.max(props.minWidth, value)))
}

function applyWidth(value: number): void {
  const next = clampWidth(value)
  if (next !== currentWidth.value) {
    currentWidth.value = next
    emit('update:width', next)
  }
}

function startResize(event: PointerEvent): void {
  if (!props.resizable || event.button !== 0) return
  const handle = event.currentTarget as HTMLElement | null
  if (!handle) return
  measureParent()
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: displayWidth.value,
    handle,
  }
  resizing.value = true
  try {
    handle.setPointerCapture(event.pointerId)
  } catch {}
  handle.focus({ preventScroll: true })
  previousUserSelect = document.body.style.userSelect
  previousCursor = document.body.style.cursor
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  event.preventDefault()
}

function moveResize(event: PointerEvent): void {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  const delta = props.side === 'right'
    ? dragState.startX - event.clientX
    : event.clientX - dragState.startX
  applyWidth(dragState.startWidth + delta)
}

function finishResize(event?: PointerEvent): void {
  if (!dragState) return
  if (event && event.pointerId !== dragState.pointerId) return
  const { handle, pointerId } = dragState
  dragState = null
  resizing.value = false
  try {
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
  } catch {}
  document.body.style.userSelect = previousUserSelect
  document.body.style.cursor = previousCursor
  emit('resizeEnd', currentWidth.value)
}

function resizeByKeyboard(event: KeyboardEvent): void {
  if (!props.resizable) return
  measureParent()
  const step = event.shiftKey ? 48 : 16
  let next: number | null = null
  if (event.key === 'ArrowLeft') next = displayWidth.value - step
  else if (event.key === 'ArrowRight') next = displayWidth.value + step
  else if (event.key === 'Home') next = props.minWidth
  else if (event.key === 'End') next = maxAllowedWidth.value
  if (next === null) return
  event.preventDefault()
  applyWidth(next)
  emit('resizeEnd', currentWidth.value)
}

onBeforeUnmount(() => {
  if (!dragState) return
  dragState = null
  document.body.style.userSelect = previousUserSelect
  document.body.style.cursor = previousCursor
})
</script>

<template>
  <aside
    v-if="open"
    ref="inspector"
    class="tool-inspector"
    :class="[`is-${side}`, { 'is-resizable': resizable, 'is-resizing': resizing }]"
    :style="{ '--inspector-width': `${displayWidth}px` }"
    aria-label="工具详情"
  >
    <div
      v-if="resizable"
      class="inspector-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整工具详情面板宽度"
      :aria-valuemin="minWidth"
      :aria-valuemax="maxAllowedWidth"
      :aria-valuenow="displayWidth"
      tabindex="0"
      @pointerdown="startResize"
      @pointermove="moveResize"
      @pointerup="finishResize"
      @pointercancel="finishResize"
      @lostpointercapture="finishResize"
      @keydown="resizeByKeyboard"
    />
    <Teleport to="body">
      <div
        v-if="resizing"
        class="inspector-resize-shield"
        @pointermove="moveResize"
        @pointerup="finishResize"
        @pointercancel="finishResize"
      />
    </Teleport>
    <header class="inspector-head">
      <span>{{ title }}</span>
      <div class="inspector-actions">
        <slot name="actions" />
        <UiIconButton
          v-if="closable"
          icon="close"
          :size="28"
          label="收起详情"
          @click="emit('close')"
        />
      </div>
    </header>
    <div class="inspector-body" :style="{ padding: bodyPadding }">
      <slot />
    </div>
  </aside>
</template>

<style scoped lang="scss">
.tool-inspector {
  position: relative;
  display: flex;
  flex: 0 0 var(--inspector-width);
  flex-direction: column;
  width: var(--inspector-width);
  min-height: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-on-solid) 58%, var(--color-border-light));
  border-radius: var(--radius-lg);
  background: var(--color-raised);
  backdrop-filter: var(--glass-raised);
  box-shadow: inset 0 1px 0 var(--color-highlight);
}

.tool-inspector.is-left {
  order: -1;
}

.inspector-resize-handle {
  position: absolute;
  top: 8px;
  bottom: 8px;
  z-index: 2;
  width: 8px;
  border-radius: 999px;
  cursor: col-resize;
  outline: none;
  touch-action: none;
}

.tool-inspector.is-right .inspector-resize-handle {
  left: 0;
}

.tool-inspector.is-left .inspector-resize-handle {
  right: 0;
}

.inspector-resize-handle::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 2px;
  border-radius: inherit;
  background: transparent;
  content: '';
  transition: background-color 140ms ease;
}

.inspector-resize-handle:hover::after,
.inspector-resize-handle:focus-visible::after,
.tool-inspector.is-resizing .inspector-resize-handle::after {
  background: var(--color-primary);
}

.inspector-resize-handle:focus-visible::after {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 22%, transparent);
}

.inspector-resize-shield {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}

.inspector-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  flex: 0 0 47px;
  height: 47px;
  padding: 0 9px 0 14px;
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.inspector-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.inspector-body {
  flex: 1;
  min-height: 0;
  padding: 14px;
  overflow: auto;
}
</style>
