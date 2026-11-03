<script setup lang="ts">
import type { ToolDefinition } from '../types/tool'
import { getToolRegistry } from '../../config/tools'

const props = withDefaults(defineProps<{
  open: boolean
  initialQuery?: string
}>(), {
  initialQuery: '',
})

const emit = defineEmits<{
  close: []
  select: [toolId: string]
}>()

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const resultsRef = ref<HTMLElement | null>(null)

const tools = computed(() => getToolRegistry())
const MAX_RESULTS = 8

function scoreTool(tool: ToolDefinition, keyword: string): number {
  const name = tool.name.toLowerCase()
  if (name.startsWith(keyword)) return 4
  if (name.includes(keyword)) return 3
  if (tool.keywords.some(item => item.toLowerCase().includes(keyword))) return 2
  if (tool.category.name.toLowerCase().includes(keyword) || tool.category.key.includes(keyword)) return 1
  if (tool.description.toLowerCase().includes(keyword)) return 1
  return 0
}

const results = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return tools.value.slice(0, MAX_RESULTS)

  return tools.value
    .map((tool, index) => ({ tool, index, score: scoreTool(tool, keyword) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map(item => item.tool)
})

watch(results, async () => {
  activeIndex.value = 0
  await nextTick()
  resultsRef.value?.scrollTo({ top: 0 })
})

watch(activeIndex, async (index) => {
  await nextTick()
  const option = resultsRef.value?.children[index] as HTMLElement | undefined
  option?.scrollIntoView({ block: 'nearest' })
})

watch(() => props.open, async (open) => {
  if (!open) return
  query.value = props.initialQuery
  activeIndex.value = 0
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
})

function close() {
  emit('close')
}

function select(tool: ToolDefinition) {
  emit('select', tool.id)
}

function move(delta: number) {
  const count = results.value.length
  if (count === 0) return
  activeIndex.value = (activeIndex.value + delta + count) % count
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const tool = results.value[activeIndex.value]
    if (tool) select(tool)
  }
}

function onOverlayClick(event: MouseEvent) {
  if (event.target === event.currentTarget) close()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div
        v-if="open"
        class="command-overlay"
        role="presentation"
        @click="onOverlayClick"
      >
        <section
          class="command-palette"
          role="dialog"
          aria-modal="true"
          aria-label="搜索工具"
          @keydown="onKeydown"
        >
          <label class="command-search">
            <UiIcon name="search" :size="19" />
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              placeholder="搜索工具、能力或关键词"
              aria-label="搜索工具"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="command-results"
              :aria-activedescendant="results[activeIndex] ? `command-option-${results[activeIndex].id}` : undefined"
            >
            <kbd>Esc</kbd>
          </label>

          <div
            id="command-results"
            ref="resultsRef"
            class="command-results"
            role="listbox"
            aria-label="工具"
          >
            <button
              v-for="(tool, index) in results"
              :id="`command-option-${tool.id}`"
              :key="tool.id"
              type="button"
              role="option"
              class="command-result"
              :class="{ 'is-active': index === activeIndex }"
              :aria-selected="index === activeIndex"
              @mouseenter="activeIndex = index"
              @click="select(tool)"
            >
              <UiIconTile :name="tool.icon" size="sm" :icon-size="17" />
              <span class="command-result-copy">
                <strong class="text-truncate">{{ tool.name }}</strong>
                <span class="text-clamp-2">{{ tool.description }}</span>
              </span>
              <UiIcon name="arrowRight" :size="15" class="command-result-arrow" />
            </button>
          </div>

          <UiEmpty
            v-if="results.length === 0"
            class="command-empty"
            title="没有匹配的工具"
            text="试试工具名、能力或关键词。"
            center
          />

          <footer class="command-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> 移动</span>
            <span><kbd>Enter</kbd> 打开</span>
            <span class="command-footer-count">共 {{ tools.length }} 个工具</span>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.command-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 13vh 24px 24px;
  background: rgba(23, 42, 61, 0.16);
  backdrop-filter: blur(8px);
}

.command-palette {
  width: min(650px, calc(100vw - 48px));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-on-solid) 58%, transparent);
  border-radius: var(--radius-xl);
  background: var(--color-overlay);
  backdrop-filter: var(--glass-overlay);
  box-shadow: var(--shadow-lg);
}

.command-search {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  height: 59px;
  padding: 0 18px;
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-tertiary);

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    font-size: 15px;

    &::placeholder {
      color: var(--color-text-tertiary);
    }
  }
}

kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 21px;
  padding: 0 5px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-fill) 78%, transparent);
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
}

.command-results {
  display: grid;
  gap: 3px;
  max-height: min(440px, calc(100dvh - 240px));
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 7px;
}

.command-result {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  min-height: 58px;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  outline: none;

  &.is-active {
    border-color: color-mix(in srgb, var(--color-primary) 17%, transparent);
    background: var(--color-primary-soft);
  }
}

.command-result-copy {
  display: grid;
  min-width: 0;
  gap: 1px;

  strong {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  span {
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    line-height: 1.45;
  }
}

.command-result-arrow {
  flex: none;
  margin-left: auto;
  color: var(--color-text-tertiary);
}

.command-empty {
  min-height: 162px;
  padding: var(--spacing-3xl);
}

.command-footer {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  min-height: 37px;
  padding: 0 14px;
  border-top: 1px solid var(--color-border-light);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);

  > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
}

.command-footer-count {
  margin-left: auto;
}

.palette-enter-active,
.palette-leave-active {
  transition: opacity var(--duration-overlay) var(--ease-out);

  .command-palette {
    transition:
      opacity var(--duration-overlay) var(--ease-out),
      transform var(--duration-overlay) var(--ease-out);
  }
}

.palette-enter-from,
.palette-leave-to {
  opacity: 0;

  .command-palette {
    opacity: 0;
    transform: translateY(8px) scale(0.985);
  }
}

@media (prefers-reduced-motion: reduce) {
  .palette-enter-active,
  .palette-leave-active,
  .command-palette {
    transition-duration: 0.01ms;
  }
}
</style>
