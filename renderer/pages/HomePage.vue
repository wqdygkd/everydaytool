<script setup lang="ts">
import type { UiPreferences } from '../../shared/app'
import type { ToolDropPosition } from '../shared/tool/tool-order'
import type { ToolDefinition } from '../shared/types/tool'
import { STORAGE_KEYS } from '../../shared/storage-keys'
import { getToolRegistry } from '../config/tools'
import { appIpcChannels, invokeAppIpc } from '../shared/ipc/useAppIpc'
import { mergeVisibleToolOrder, moveToolInOrder, resolveToolOrder } from '../shared/tool/tool-order'

interface DragSlot {
  left: number
  top: number
  width: number
  height: number
}

// 拖拽数据的自定义 MIME：不写 text/plain，避免松手到搜索框等输入框时把工具 id 当文本插入
const DRAG_MIME = 'application/x-edt-tool-id'
// 略大于 --transition-base（250ms）：等卡片滑回原位后再摘掉拖拽态
const DRAG_SETTLE_MS = 260

// 收藏与首页排序都是用户数据：**配置层文件**（<data>/config/app/ui-preferences.json）是事实来源，
// LocalStorage 只做镜像（网页预览没有 IPC 时兜底；也保证首屏不必等 IPC 就有内容）。
const FAVORITE_STORAGE_KEY = STORAGE_KEYS.favoriteTools
const TOOL_ORDER_STORAGE_KEY = STORAGE_KEYS.homeToolOrder
const router = useRouter()
const searchText = ref('')
const allTools = computed(() => getToolRegistry())
const favoriteIds = ref(readIdList(FAVORITE_STORAGE_KEY))
const savedToolOrder = ref(readIdList(TOOL_ORDER_STORAGE_KEY))
const gridRef = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)
// 拖拽预览：DOM 顺序保持不动，只按槽位给卡片加 transform，松手时再一次性提交顺序
const dragBaseOrder = ref<string[]>([])
const dragPreviewOrder = ref<string[]>([])
const dragSlots = ref<DragSlot[]>([])
let cancelTimer: number | null = null
// 拖拽松手后个别环境仍会补一个 click：挡掉「拖完顺手打开工具」
let suppressClickUntil = 0

/** 默认按创建时间倒序（最新在前）；拖拽过则按保存的顺序，未记录位置的新工具排最前 */
const orderedTools = computed(() => resolveToolOrder(allTools.value, savedToolOrder.value))

const keyword = computed(() => searchText.value.trim().toLowerCase())

const filteredTools = computed<ToolDefinition[]>(() => {
  if (!keyword.value) return orderedTools.value

  return orderedTools.value.filter((tool) => {
    const searchableText = [
      tool.name,
      tool.description,
      tool.category.name,
      tool.category.key,
      ...tool.keywords,
    ].join(' ').toLowerCase()

    return searchableText.includes(keyword.value)
  })
})

const visibleToolCount = computed(() => filteredTools.value.length)
// 搜索结果是全量列表的子集，重排子集会打乱看不见的项：过滤时禁用拖拽
const canReorder = computed(() => !keyword.value && filteredTools.value.length > 1)
const hasCustomOrder = computed(() => savedToolOrder.value.length > 0)
// 收藏区与「所有工具」共用同一份顺序（默认创建时间 / 拖拽结果）
const favoriteTools = computed(() => orderedTools.value.filter(tool => favoriteIds.value.includes(tool.id)))

function goToTool(toolId: string) {
  if (Date.now() < suppressClickUntil) return
  router.push({ name: `tool-${toolId}` })
}

function isFavorite(toolId: string): boolean {
  return favoriteIds.value.includes(toolId)
}

function readIdList(storageKey: string): string[] {
  try {
    return sanitizeIds(JSON.parse(localStorage.getItem(storageKey) ?? '[]'))
  } catch {
    return []
  }
}

/** LocalStorage / IPC 里的数组都不可信：只收非空字符串，去重 */
function sanitizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function writeMirror(storageKey: string, ids: string[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(ids))
  } catch {
    // 隐私模式 / 配额满：镜像写不进去不影响配置层
  }
}

async function persistPreferences(patch: Partial<UiPreferences>) {
  try {
    await invokeAppIpc<UiPreferences>(appIpcChannels().UI_PREFERENCES_SET, patch)
  } catch {
    // 网页预览 / preload 未注入（getApi 同步抛错）：只有镜像生效，不打扰用户
  }
}

function toggleFavorite(toolId: string) {
  favoriteIds.value = isFavorite(toolId)
    ? favoriteIds.value.filter(id => id !== toolId)
    : [...favoriteIds.value, toolId]
  writeMirror(FAVORITE_STORAGE_KEY, favoriteIds.value)
  void persistPreferences({ favoriteToolIds: favoriteIds.value })
}

/** 拖拽落位：把可见顺序套回全量顺序后立即生效并落盘 */
function commitToolOrder(visibleOrder: string[]) {
  const next = mergeVisibleToolOrder(savedToolOrder.value, visibleOrder)
  savedToolOrder.value = next
  writeMirror(TOOL_ORDER_STORAGE_KEY, next)
  void persistPreferences({ toolOrder: next })
}

function resetToolOrder() {
  savedToolOrder.value = []
  writeMirror(TOOL_ORDER_STORAGE_KEY, [])
  void persistPreferences({ toolOrder: [] })
}

/**
 * 挂载后与配置层对齐：
 * - 配置层有值 → 以它为准（并刷新镜像）；
 * - 配置层为空 → 把 LocalStorage 里已有的值迁上去（旧版本 / 网页预览数据的一次性迁移）。
 */
async function syncPreferencesWithConfigLayer() {
  try {
    const stored = await invokeAppIpc<UiPreferences>(appIpcChannels().UI_PREFERENCES_GET)
    const remoteFavorites = sanitizeIds(stored?.favoriteToolIds)
    if (remoteFavorites.length > 0) {
      favoriteIds.value = remoteFavorites
      writeMirror(FAVORITE_STORAGE_KEY, remoteFavorites)
    } else if (favoriteIds.value.length > 0) {
      void persistPreferences({ favoriteToolIds: favoriteIds.value })
    }

    const remoteOrder = sanitizeIds(stored?.toolOrder)
    if (remoteOrder.length > 0) {
      // 拖拽中列表顺序被锁定：等松手提交后再以本地预览为准
      if (!draggingId.value) {
        savedToolOrder.value = remoteOrder
        writeMirror(TOOL_ORDER_STORAGE_KEY, remoteOrder)
      }
    } else if (savedToolOrder.value.length > 0 && !draggingId.value) {
      void persistPreferences({ toolOrder: savedToolOrder.value })
    }
  } catch {
    // 没有 IPC（网页预览）：保持镜像即可
  }
}

function captureDragSlots(): DragSlot[] {
  const wrapper = gridRef.value
  if (!wrapper) return []

  // 用 offset* 而不是 getBoundingClientRect：不受滚动 / 入场动画 / 卡片自身 transform 影响
  return Array.from(wrapper.querySelectorAll<HTMLElement>('.tool-cell'), cell => ({
    left: cell.offsetLeft,
    top: cell.offsetTop,
    width: cell.offsetWidth,
    height: cell.offsetHeight,
  }))
}

/** 指针落在哪个槽位：取最近的卡片矩形，间隙 / 行末空白也能命中 */
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

/** 卡片的预览位移：DOM 顺序不动，用 transform 把它滑到目标槽位（CSS transition 负责过渡） */
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

  const baseOrder = filteredTools.value.map(item => item.id)
  draggingId.value = tool.id
  dragBaseOrder.value = baseOrder
  dragPreviewOrder.value = [...baseOrder]
  const slots = captureDragSlots()
  dragSlots.value = slots.length === baseOrder.length ? slots : []

  const transfer = event.dataTransfer
  if (transfer) {
    transfer.effectAllowed = 'move'
    // Firefox 必须写入数据才会真正开始拖拽
    transfer.setData(DRAG_MIME, tool.id)
  }
}

function onGridDragEnter(event: DragEvent) {
  if (!draggingId.value) return
  // 允许 drop：部分浏览器要求 dragenter 也 preventDefault
  event.preventDefault()
}

/** 拖拽过程中只更新预览顺序：卡片靠 transform 滑入目标槽位，不重排 DOM */
function onGridDragOver(event: DragEvent) {
  const sourceId = draggingId.value
  if (!sourceId) return

  // 必须 preventDefault 才允许 drop
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

/** 松手落定：同一帧清掉预览位移并提交顺序，视觉上卡片已在目标槽位，不会回弹 */
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

/** 取消拖拽（Esc / 松手在网格外）：先清预览让卡片滑回原位，动画结束后再摘掉拖拽态 */
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
  if (!draggingId.value) return
  cancelDragOrder()
}

onBeforeUnmount(() => {
  if (cancelTimer !== null) window.clearTimeout(cancelTimer)
})

onMounted(() => {
  void syncPreferencesWithConfigLayer()
})
</script>

<template>
  <div class="home-page" :class="{ 'is-dragging': draggingId !== null }">
    <section class="toolbar">
      <UiSearchInput
        v-model="searchText"
        trim
        width="min(520px, 100%)"
        placeholder="搜索工具、能力或关键词"
      />
      <span class="tool-count">{{ visibleToolCount }} {{ keyword ? '个匹配' : '个工具' }}</span>
    </section>

    <section v-if="favoriteTools.length > 0" class="favorite-section">
      <UiSectionHeader title="我的收藏" :count="favoriteTools.length">
        <template #title>
          <!-- 收藏是全站唯一的琥珀色：星标在卡片上是同一支色，读一眼就知道这一区是「我挑过的」 -->
          <span class="favorite-mark" aria-hidden="true">★</span>我的收藏
        </template>
      </UiSectionHeader>

      <div class="tools-grid">
        <ToolCard
          v-for="tool in favoriteTools"
          :key="tool.id"
          :tool="tool"
          :is-favorite="true"
          @click="goToTool(tool.id)"
          @toggle-favorite="toggleFavorite(tool.id)"
        />
      </div>
    </section>

    <section v-if="filteredTools.length > 0" class="all-tools-section">
      <UiSectionHeader title="所有工具">
        <template #actions>
          <span v-if="canReorder" class="drag-hint">拖动卡片调整顺序</span>
          <span v-else-if="keyword && filteredTools.length > 1" class="drag-hint">清空搜索后可调整顺序</span>
          <UiIconButton
            v-if="hasCustomOrder"
            icon="refresh"
            :size="28"
            label="恢复默认排序（按创建时间）"
            @click="resetToolOrder"
          />
        </template>
      </UiSectionHeader>

      <!-- 拖拽预览不重排 DOM：卡片只用 transform 滑向目标槽位，松手后才一次性提交顺序 -->
      <div
        ref="gridRef"
        class="tools-grid-wrap"
        @dragenter="onGridDragEnter"
        @dragover="onGridDragOver"
        @drop="onGridDrop"
      >
        <div class="tools-grid">
          <div
            v-for="tool in filteredTools"
            :key="tool.id"
            class="tool-cell"
            :class="{ 'is-dragging': draggingId === tool.id }"
            :style="dragTransform(tool.id)"
            :draggable="canReorder"
            @dragstart="onDragStart($event, tool)"
            @dragend="onDragEnd"
          >
            <ToolCard
              :tool="tool"
              :is-favorite="isFavorite(tool.id)"
              @click="goToTool(tool.id)"
              @toggle-favorite="toggleFavorite(tool.id)"
            />
          </div>
        </div>
      </div>
    </section>

    <UiEmpty v-else variant="bordered" center padding="var(--spacing-3xl)">
      没有匹配的工具
    </UiEmpty>
  </div>
</template>

<style scoped lang="scss">
/* 自然流式高度：滚动发生在 .app-main（滚动条贴窗口右缘），本页不自带滚动。
   width:100% 必须保留：flex 列子项 + 横向 auto margin 会禁用 stretch，缺了它宽度塌缩、网格掉回单列 */
.home-page {
  width: 100%;
  max-width: var(--content-max-width);
  margin: 0 auto;
  padding: var(--spacing-2xl) var(--spacing-3xl) var(--spacing-3xl);

  /* 拖拽中整页保持抓取手型（卡片自带的 pointer 要压过去）；卡片不再接收 hover / 点击 */
  &.is-dragging {
    cursor: grabbing;

    .tool-card {
      cursor: grabbing;
      pointer-events: none;
    }
  }
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-2xl);

  .tool-count {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }
}

.favorite-section {
  margin-bottom: var(--spacing-3xl);
}

/* 收藏记号：与卡片上的星标同一支琥珀（--color-warning 已是可读档，11–16px 都够亮） */
.favorite-mark {
  color: var(--color-warning);
  font-size: var(--font-size-base);
  line-height: 1;
}

/* 网格定位上下文：卡片用 offset* 取槽位坐标，滚动 / 动画都不会影响相对位置 */
.tools-grid-wrap {
  position: relative;
  min-width: 0;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: var(--spacing-md);
}

.drag-hint {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

/* 工具卡槽位：DOM 顺序固定不动，拖拽时只用 transform 做预览位移 */
.tool-cell {
  position: relative;
  display: flex;
  min-width: 0;
  border-radius: var(--radius-lg);

  > .tool-card {
    flex: 1;
    min-width: 0;
  }

  /* 拖拽源变成占位卡：虚线 + 缩小 + 降透明，落点始终可见 */
  &.is-dragging {
    z-index: 1;

    > .tool-card {
      border-color: color-mix(in srgb, var(--tool-accent) 55%, transparent);
      border-style: dashed;
      opacity: 0.5;
      transform: scale(0.97);
    }
  }
}

/* 拖拽期间卡片槽位平滑滑向预览位置（落定 / 取消时由各分支控制过渡） */
.home-page.is-dragging .tool-cell {
  transition: transform var(--transition-base);
  will-change: transform;
}

/* 触屏没有 HTML5 拖拽：不展示会误导的提示 */
@media (hover: none) {
  .drag-hint {
    display: none;
  }
}

@media (max-width: 640px) {
  .home-page {
    padding: var(--spacing-2xl) var(--spacing-lg) var(--spacing-3xl);
  }

  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .drag-hint {
    display: none;
  }
}
</style>
