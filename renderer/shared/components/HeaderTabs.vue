<script setup lang="ts">
interface HeaderTab {
  id: string
  name: string
}

interface TabSlot {
  id: string
  left: number
  width: number
}

const props = defineProps<{
  tabs: HeaderTab[]
  activeId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  close: [id: string]
  reorder: [ids: string[]]
}>()

// 浏览器标签页式拖拽：指针拖动 + 实时 DOM 重排 + WAAPI FLIP。
// 不用原生 HTML5 drag：拖拽中重排 DOM 会让原生拖拽源失效，也无法做自定义浮层。
const DRAG_THRESHOLD = 5
const SETTLE_MS = 200
const CLICK_GUARD_MS = 400
// 拖拽浮层与页签条可视区之间留的边距（与 .header-tabs 的 padding 对齐）
const DRAG_AREA_INSET = 4

const barRef = ref<HTMLElement | null>(null)
const previewIds = ref<string[]>([])
const draggingId = ref<string | null>(null)
const settlingId = ref<string | null>(null)
const slots = ref<TabSlot[]>([])

const ghost = reactive({
  visible: false,
  tab: null as HeaderTab | null,
  active: false,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  dx: 0,
  dy: 0,
  settling: false,
})

/** 拖拽预览顺序：空数组表示跟随父级（store）顺序 */
const displayedTabs = computed<HeaderTab[]>(() => {
  if (previewIds.value.length === 0) return props.tabs
  const byId = new Map(props.tabs.map(tab => [tab.id, tab]))
  return previewIds.value
    .map(id => byId.get(id))
    .filter((tab): tab is HeaderTab => tab !== undefined)
})

const isDragging = computed(() => draggingId.value !== null)
const isSettling = computed(() => settlingId.value !== null)

const ghostStyle = computed(() => ({
  left: `${ghost.left}px`,
  top: `${ghost.top}px`,
  width: `${ghost.width}px`,
  height: `${ghost.height}px`,
  transform: `translate3d(${ghost.dx}px, ${ghost.dy}px, 0) scale(${ghost.settling ? 1 : 1.03})`,
}))

let pending: {
  id: string
  pointerId: number
  startX: number
  startY: number
  element: HTMLElement
} | null = null
let dragStartX = 0
let dragStartRect: DOMRect | null = null
let dragBaseIds: string[] = []
let settleTimer: number | null = null
let previousUserSelect = ''
let suppressClickUntil = 0
const tabAnimations = new Set<Animation>()

function getTabElements(): HTMLElement[] {
  return Array.from(barRef.value?.querySelectorAll<HTMLElement>('.tool-tab') ?? [])
}

/** 可拖拽区域 = 页签条内容与可视滚动区的交集；浮层 / 指针都不允许离开它 */
function getDragAreaBounds(): { left: number, right: number } | null {
  const bar = barRef.value
  if (!bar) return null

  const barRect = bar.getBoundingClientRect()
  const wrapperRect = bar.parentElement?.getBoundingClientRect()
  return {
    left: wrapperRect ? Math.max(barRect.left, wrapperRect.left) : barRect.left,
    right: wrapperRect ? Math.min(barRect.right, wrapperRect.right) : barRect.right,
  }
}

function clampGhostLeft(left: number): number {
  const startRect = dragStartRect
  const bounds = getDragAreaBounds()
  if (!startRect || !bounds) return left

  const minLeft = bounds.left + DRAG_AREA_INSET
  const maxLeft = bounds.right - DRAG_AREA_INSET - startRect.width
  return Math.max(minLeft, Math.min(left, maxLeft))
}

function clampGhostDx(clientX: number): number {
  const startRect = dragStartRect
  if (!startRect) return 0
  return clampGhostLeft(startRect.left + (clientX - dragStartX)) - startRect.left
}

/** 指针也钳进可视区：浮层贴边时仍按首 / 尾槽落位 */
function clampPointerX(clientX: number): number {
  const bounds = getDragAreaBounds()
  if (!bounds) return clientX
  return Math.max(bounds.left + DRAG_AREA_INSET, Math.min(clientX, bounds.right - DRAG_AREA_INSET))
}

/** 与首页排序同构的纯计算：把 source 插到 target 前 / 后，无变化返回 null */
function moveIdInOrder(
  order: readonly string[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after',
): string[] | null {
  const sourceIndex = order.indexOf(sourceId)
  const targetIndex = order.indexOf(targetId)
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return null

  let insertIndex = position === 'after' ? targetIndex + 1 : targetIndex
  if (sourceIndex < insertIndex) insertIndex -= 1
  if (insertIndex === sourceIndex) return null

  const next = [...order]
  next.splice(sourceIndex, 1)
  next.splice(insertIndex, 0, sourceId)
  return next
}

/** 槽位坐标用 offset*：相对页签条自身，父级横向滚动 / 动画 transform 都不会污染 */
function captureSlots(ids: string[]): TabSlot[] {
  return getTabElements()
    .map((element, index) => ({
      id: ids[index] ?? '',
      left: element.offsetLeft,
      width: element.offsetWidth,
    }))
    .filter(slot => slot.id !== '')
}

function captureViewportRects(ids: string[]): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  getTabElements().forEach((element, index) => {
    const id = ids[index]
    if (id) rects.set(id, element.getBoundingClientRect())
  })
  return rects
}

function cancelTabAnimations() {
  for (const animation of tabAnimations) animation.cancel()
  tabAnimations.clear()
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function playTabMove(before: Map<string, DOMRect>, ids: string[]) {
  if (prefersReducedMotion()) return

  getTabElements().forEach((element, index) => {
    const id = ids[index]
    if (!id) return
    const previous = before.get(id)
    if (!previous) return

    const next = element.getBoundingClientRect()
    const dx = previous.left - next.left
    const dy = previous.top - next.top
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return

    const animation = element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    )
    tabAnimations.add(animation)
    animation.finished
      .catch(() => {})
      .finally(() => tabAnimations.delete(animation))
  })
}

/** 换预览顺序：先量旧位置，再让 DOM 按新顺序排，最后用 FLIP 从旧位置滑过去 */
async function applyPreview(nextIds: string[]) {
  const before = captureViewportRects(displayedTabs.value.map(tab => tab.id))
  previewIds.value = nextIds
  await nextTick()
  slots.value = captureSlots(nextIds)
  cancelTabAnimations()
  playTabMove(before, nextIds)
}

function updatePreviewAt(clientX: number) {
  const sourceId = draggingId.value
  const bar = barRef.value
  if (!sourceId || !bar || slots.value.length === 0) return

  // 槽位是页签条内容坐标；指针也换算到同一坐标系，父级横向滚动也正确
  const x = clientX - bar.getBoundingClientRect().left
  let targetIndex = -1
  let minDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < slots.value.length; i++) {
    const slot = slots.value[i]
    const distance = x < slot.left
      ? slot.left - x
      : x > slot.left + slot.width
        ? x - (slot.left + slot.width)
        : 0
    if (distance < minDistance) {
      minDistance = distance
      targetIndex = i
    }
  }

  const slot = slots.value[targetIndex]
  if (!slot || slot.id === sourceId) return

  const position: 'before' | 'after' = x > slot.left + slot.width / 2 ? 'after' : 'before'
  const next = moveIdInOrder(previewIds.value, sourceId, slot.id, position)
  if (next) void applyPreview(next)
}

function beginDrag(event: PointerEvent) {
  if (!pending) return
  const tab = displayedTabs.value.find(item => item.id === pending!.id)
  if (!tab) return

  const rect = pending.element.getBoundingClientRect()
  dragStartX = pending.startX
  dragStartRect = rect
  dragBaseIds = displayedTabs.value.map(item => item.id)
  previewIds.value = [...dragBaseIds]
  slots.value = captureSlots(dragBaseIds)
  draggingId.value = tab.id
  suppressClickUntil = Date.now() + CLICK_GUARD_MS

  previousUserSelect = document.body.style.userSelect
  document.body.style.userSelect = 'none'

  ghost.tab = tab
  ghost.active = props.activeId === tab.id
  ghost.left = rect.left
  ghost.top = rect.top
  ghost.width = rect.width
  ghost.height = rect.height
  ghost.dx = clampGhostDx(event.clientX)
  ghost.dy = 0
  ghost.settling = false
  ghost.visible = true

  const bar = barRef.value
  if (bar) {
    try {
      bar.setPointerCapture(pending.pointerId)
    } catch {
      // 指针已失效（例如合成事件）时忽略：window 上的监听仍能兜底
    }
  }
  window.addEventListener('keydown', onKeyDown)
}

function onPointerDown(event: PointerEvent) {
  if (pending || event.button !== 0 || event.pointerType === 'touch') return
  if (draggingId.value || settlingId.value) return

  const target = event.target as HTMLElement | null
  if (!target || target.closest('.tool-tab-close')) return
  const tabElement = target.closest<HTMLElement>('.tool-tab')
  if (!tabElement || !barRef.value?.contains(tabElement)) return

  const index = getTabElements().indexOf(tabElement)
  const tab = displayedTabs.value[index]
  if (!tab) return

  pending = {
    id: tab.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    element: tabElement,
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('blur', onWindowBlur)
}

function onPointerMove(event: PointerEvent) {
  if (!pending || event.pointerId !== pending.pointerId) return

  if (!draggingId.value) {
    if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) < DRAG_THRESHOLD) return
    beginDrag(event)
    if (!draggingId.value) return
  }

  event.preventDefault()
  ghost.dx = clampGhostDx(event.clientX)
  ghost.dy = 0
  // 位置被钳在页签条内：用钳制后的指针坐标决定插入位，拖出边缘时停在首/尾槽
  updatePreviewAt(clampPointerX(event.clientX))
}

function onPointerUp(event: PointerEvent) {
  if (pending && event.pointerId !== pending.pointerId) return
  cleanupPointerListeners()
  if (!pending) return

  const sourceId = draggingId.value
  const startRect = dragStartRect
  const wasDragging = sourceId !== null && startRect !== null
  pending = null
  if (!wasDragging || !sourceId || !startRect) return

  const preview = previewIds.value
  const changed = preview.some((id, index) => id !== dragBaseIds[index])

  if (changed) {
    // 浮层全程被约束在页签条内：松开即按预览位置落定（Esc / 失焦才是取消）
    const bar = barRef.value
    const barRect = bar?.getBoundingClientRect()
    const targetSlot = slots.value.find(slot => slot.id === sourceId)
    const targetLeft = clampGhostLeft(
      barRect && targetSlot ? barRect.left + targetSlot.left : startRect.left,
    )
    const targetX = targetLeft - startRect.left
    emit('reorder', preview)
    draggingId.value = null
    settlingId.value = sourceId
    suppressClickUntil = Date.now() + CLICK_GUARD_MS
    settleGhost(targetX)
    return
  }

  void revertPreview(sourceId)
  settleGhost(0)
}

/** 取消 / 落在页签条外：DOM 顺序退回父级顺序，FLIP 滑回原位 */
async function revertPreview(sourceId: string) {
  suppressClickUntil = Date.now() + CLICK_GUARD_MS
  const before = captureViewportRects(displayedTabs.value.map(tab => tab.id))
  draggingId.value = null
  settlingId.value = sourceId
  previewIds.value = []
  await nextTick()
  cancelTabAnimations()
  playTabMove(before, props.tabs.map(tab => tab.id))
}

function settleGhost(targetDx: number) {
  if (settleTimer !== null) window.clearTimeout(settleTimer)

  // 先让 is-settling（transition）生效，下一帧再改 transform，保证浮层是滑过去而不是瞬移
  ghost.settling = true
  void nextTick(() => {
    ghost.dx = targetDx
    ghost.dy = 0
  })
  settleTimer = window.setTimeout(() => {
    ghost.visible = false
    ghost.tab = null
    ghost.settling = false
    settlingId.value = null
    previewIds.value = []
    restoreUserSelect()
    settleTimer = null
  }, prefersReducedMotion() ? 16 : SETTLE_MS)
}

function restoreUserSelect() {
  if (!previousUserSelect && !document.body.style.userSelect) return
  document.body.style.userSelect = previousUserSelect
  previousUserSelect = ''
}

function cleanupPointerListeners() {
  const bar = barRef.value
  if (bar && pending) {
    try {
      if (bar.hasPointerCapture(pending.pointerId)) bar.releasePointerCapture(pending.pointerId)
    } catch {
      // 指针已释放时忽略
    }
  }
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('keydown', onKeyDown)
}

function cancelActiveDrag() {
  const sourceId = draggingId.value
  if (!sourceId) return
  void revertPreview(sourceId)
  settleGhost(0)
}

function onPointerCancel() {
  cleanupPointerListeners()
  pending = null
  cancelActiveDrag()
}

function onWindowBlur() {
  cleanupPointerListeners()
  pending = null
  cancelActiveDrag()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !draggingId.value) return
  event.preventDefault()
  cleanupPointerListeners()
  pending = null
  cancelActiveDrag()
}

function selectTab(id: string) {
  if (draggingId.value || settlingId.value || Date.now() < suppressClickUntil) return
  emit('select', id)
}

function closeTab(id: string) {
  if (draggingId.value || settlingId.value || Date.now() < suppressClickUntil) return
  emit('close', id)
}

function onTabKeydown(event: KeyboardEvent, index: number) {
  // 关闭按钮的 Enter / 方向键交给原生按钮，不触发页签切换
  if (event.target !== event.currentTarget) return

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    selectTab(displayedTabs.value[index].id)
    return
  }

  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault()
    const count = displayedTabs.value.length
    if (count < 2) return
    const delta = event.key === 'ArrowRight' ? 1 : -1
    getTabElements()[(index + delta + count) % count]?.focus()
  }
}

// 父级顺序更新到与预览一致时清掉预览，避免闪回旧顺序
watch(
  () => props.tabs,
  (tabs) => {
    if (draggingId.value || previewIds.value.length === 0) return
    const ids = tabs.map(tab => tab.id)
    if (ids.length === previewIds.value.length && ids.every((id, index) => id === previewIds.value[index]))
      previewIds.value = []
  },
)

// 激活页签切换后横向滚入视野：页签多时不会把当前工具藏到滚动区外
watch(
  () => props.activeId,
  async (activeId) => {
    if (!activeId || draggingId.value || settlingId.value) return
    await nextTick()
    const index = displayedTabs.value.findIndex(tab => tab.id === activeId)
    const element = getTabElements()[index]
    const scroller = barRef.value?.parentElement
    if (!element || !scroller) return

    const elementRect = element.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
    if (elementRect.left < scrollerRect.left) {
      scroller.scrollTo({
        left: scroller.scrollLeft - (scrollerRect.left - elementRect.left),
        behavior,
      })
    } else if (elementRect.right > scrollerRect.right) {
      scroller.scrollTo({
        left: scroller.scrollLeft + (elementRect.right - scrollerRect.right),
        behavior,
      })
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  cleanupPointerListeners()
  cancelTabAnimations()
  if (settleTimer !== null) window.clearTimeout(settleTimer)
  restoreUserSelect()
})
</script>

<template>
  <div
    ref="barRef"
    class="tool-tabs"
    :class="{ 'is-dragging': isDragging, 'is-settling': isSettling }"
    role="tablist"
    aria-label="工具页签"
    @pointerdown="onPointerDown"
  >
    <div
      v-for="(tab, index) in displayedTabs"
      :key="tab.id"
      class="tool-tab"
      :class="{
        'is-active': tab.id === activeId,
        'is-drag-source': tab.id === draggingId || tab.id === settlingId,
      }"
      :style="tab.color ? { '--tab-accent': tab.color } : undefined"
      role="tab"
      :aria-selected="tab.id === activeId"
      tabindex="0"
      @click="selectTab(tab.id)"
      @keydown="onTabKeydown($event, index)"
    >
      <span class="tool-tab-dot" aria-hidden="true" />
      <span class="tool-tab-label">{{ tab.name }}</span>
      <button
        type="button"
        class="tool-tab-close"
        :aria-label="`关闭 ${tab.name}`"
        :title="`关闭 ${tab.name}`"
        @click.stop="closeTab(tab.id)"
      >
        <UiIcon name="close" :size="12" />
      </button>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="ghost.visible && ghost.tab"
      class="tab-drag-ghost"
      :class="{ 'is-active': ghost.active, 'is-settling': ghost.settling }"
      :style="[ghostStyle, ghost.tab.color ? { '--tab-accent': ghost.tab.color } : undefined]"
      aria-hidden="true"
    >
      <span class="tool-tab-dot" aria-hidden="true" />
      <span class="tool-tab-label">{{ ghost.tab.name }}</span>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.tool-tabs {
  position: relative; /* 页签 offsetLeft 的定位基准（拖拽槽位计算） */
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--spacing-xs);
  width: max-content;
  height: 34px;
  -webkit-app-region: no-drag;
  user-select: none;

  &.is-dragging,
  &.is-settling {
    cursor: grabbing;
  }

  /* 拖拽中页签本身不再接收 hover / 点击，事件统一走 window 监听 */
  &.is-dragging .tool-tab,
  &.is-settling .tool-tab {
    pointer-events: none;
  }
}

/* 页签前的身份圆点：6px，未选中降到 .65——名字是主线索，颜色只负责
   「这个页签和首页那张卡是同一个工具」的呼应（同一支色在卡片、页签、页内分段菜单上复用）。 */
.tool-tab-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--tab-accent, var(--color-primary));
  opacity: 0.65;
  transition: opacity var(--transition-fast);
}

.tool-tab {
  /* 每个页签自己的身份色：工具页签取工具色，应用自带页面（设置）退化为品牌蓝。
     注意默认值不能写 var(--tool-accent)——那是**当前**工具色，会让设置页签跟着变脸。 */
  --tab-accent: var(--color-primary);

  position: relative;
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 6px;
  height: 34px;
  padding: 0 13px;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  -webkit-app-region: no-drag;
  outline: none;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);

  /* 选中 = 工具色淡底 + 中性黑标签：亮档蓝当 12px 文字只有 3.31:1，
     所以身份色只负责「哪一格」，可读性交给中性文本 */
  &.is-active {
    background: color-mix(in srgb, var(--tab-accent) 14%, transparent);
    color: var(--color-text-primary);
  }

  &:not(.is-active):hover {
    background: var(--color-fill);
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }

  /* 选中态把圆点点亮：身份色在静息时安静，在「我正在这里」时明确 */
  &.is-active .tool-tab-dot {
    opacity: 1;
  }

  // 拖拽源由页面上的浮层（ghost）代替，原位置只留占位
  &.is-drag-source {
    visibility: hidden;
  }

  .tool-tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    opacity: 0;
    cursor: pointer;
    transition:
      opacity var(--transition-fast),
      background-color var(--transition-fast);

    &:hover {
      background: var(--color-border-light);
    }

    &:focus-visible {
      outline: none;
      opacity: 1;
      box-shadow: var(--shadow-focus);
    }
  }

  &:hover .tool-tab-close,
  &.is-active .tool-tab-close {
    opacity: 1;
  }
}

/* 拖拽浮层：Teleport 到 body，样式自包含（不依赖页签条祖先） */
.tab-drag-ghost {
  --tab-accent: var(--color-primary);

  position: fixed;
  z-index: 2000;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 13px;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--color-raised);
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-md);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  transform-origin: center;
  will-change: transform;

  &.is-active {
    background: color-mix(in srgb, var(--tab-accent) 14%, transparent);
    color: var(--color-text-primary);
  }

  &.is-settling {
    transition:
      transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
}
</style>
