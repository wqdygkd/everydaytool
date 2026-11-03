<script setup lang="ts">
// 横向菜单（分段按钮组）：复刻 Telegram Web K 的 `.menu-horizontal-div`
// —— 药丸选中态（滑动指示条）、整条横向滚动、滚动条隐藏、徽章计数、可选品牌图标。
const props = defineProps<{
  modelValue: string
  items: { value: string, label: string, badge?: number | string, icon?: string }[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const scroller = ref<HTMLElement | null>(null)
const indicator = reactive({ left: 0, width: 0, ready: false })
let observer: ResizeObserver | null = null

function showBadge(badge?: number | string): badge is number | string {
  return badge !== undefined && badge !== null && badge !== '' && badge !== 0
}

/** 把选中项的几何位置同步到指示条，并保证它在可视区内 */
function measure(): void {
  const el = scroller.value?.querySelector<HTMLElement>('.ui-menu-horizontal-item.is-active')
  if (!el) {
    indicator.width = 0
    return
  }
  indicator.left = el.offsetLeft
  indicator.width = el.offsetWidth

  const view = scroller.value
  if (!view) return
  const left = el.offsetLeft
  const right = left + el.offsetWidth
  if (left < view.scrollLeft) view.scrollTo({ left: Math.max(left - 8, 0), behavior: 'smooth' })
  else if (right > view.scrollLeft + view.clientWidth) view.scrollTo({ left: right - view.clientWidth + 8, behavior: 'smooth' })
}

async function refresh(): Promise<void> {
  await nextTick()
  measure()
}

watch(() => [props.modelValue, props.items], refresh, { deep: true })

onMounted(async () => {
  await refresh()
  indicator.ready = true
  if (scroller.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => measure())
    observer.observe(scroller.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div ref="scroller" class="ui-menu-horizontal" role="tablist">
    <span
      class="ui-menu-horizontal-indicator"
      :class="{ 'is-ready': indicator.ready }"
      :style="{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }"
      aria-hidden="true"
    />
    <button
      v-for="item in items"
      :key="item.value"
      type="button"
      role="tab"
      class="ui-menu-horizontal-item"
      :class="{ 'is-active': item.value === modelValue }"
      :aria-selected="item.value === modelValue"
      @click="emit('update:modelValue', item.value)"
    >
      <img v-if="item.icon" :src="item.icon" alt="" class="ui-menu-horizontal-icon">
      <span class="ui-menu-horizontal-label">{{ item.label }}</span>
      <span v-if="showBadge(item.badge)" class="ui-menu-horizontal-badge">{{ item.badge }}</span>
    </button>
  </div>
</template>

<style scoped>
.ui-menu-horizontal {
  position: relative;
  display: flex;
  flex: 0 1 auto;
  width: 100%;
  height: 34px;
  padding: 2px;
  border: 1px solid var(--color-border-light);
  overflow-x: auto;
  overflow-y: hidden;
  background: color-mix(in srgb, var(--color-fill) 72%, transparent);
  /* 与卡片 / 面板同一圆角（--radius-lg），避免并排时观感不一致 */
  border-radius: var(--radius-sm);
  scrollbar-width: none;
}

.ui-menu-horizontal::-webkit-scrollbar {
  display: none;
}

.ui-menu-horizontal-indicator {
  position: absolute;
  top: 2px;
  left: 0;
  height: 28px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 17%, transparent);
  border-radius: calc(var(--radius-sm) - 2px);
  /* 选中态用**品牌色**淡底：与页签、列表卡、分段钮共用同一支强调色，
     同一个界面里只有一套「选中 = 浅底 + 中性黑文字」的语言。 */
  background: color-mix(in srgb, var(--color-primary) 9%, transparent);
  opacity: 0;
  pointer-events: none;
}

.ui-menu-horizontal-indicator.is-ready {
  opacity: 1;
  transition: transform var(--transition-base), width var(--transition-base), opacity var(--transition-fast);
}

.ui-menu-horizontal-item {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  height: 28px;
  margin: 0 1px;
  padding: 0 var(--spacing-md);
  border: none;
  border-radius: calc(var(--radius-sm) - 2px);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-control);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.ui-menu-horizontal-item:hover {
  background: var(--color-fill);
}

.ui-menu-horizontal-item.is-active {
  /* 选中项文字取中性主文本：品牌色只做底与指示条，
     文字染成亮档蓝只有 3.31:1，读起来像「被禁用」 */
  color: var(--color-text-primary);
}

.ui-menu-horizontal-item.is-active:hover {
  background: transparent;
}

.ui-menu-horizontal-item:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.ui-menu-horizontal-label {
  position: relative;
  z-index: 2;
  pointer-events: none;
}

.ui-menu-horizontal-icon {
  position: relative;
  z-index: 2;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  pointer-events: none;
}

.ui-menu-horizontal-badge {
  position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--spacing-xs);
  border-radius: 999px;
  /* 计数是「系统的注意信号」：白字压在墨档蓝上 5.05:1（与选中态浅底分档，不抢同一层） */
  background: var(--color-primary-strong);
  color: var(--color-on-solid);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  line-height: 1;
  pointer-events: none;
}
</style>
