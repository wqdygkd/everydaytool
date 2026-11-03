<script setup lang="ts">
import type { ToolDefinition } from '../types/tool'

withDefaults(defineProps<{
  tool: ToolDefinition
  pinned?: boolean
}>(), {
  pinned: false,
})

const emit = defineEmits<{
  open: []
  togglePin: []
}>()
</script>

<template>
  <div class="launcher-row">
    <button
      type="button"
      class="launcher-open"
      :aria-label="`打开 ${tool.name}`"
      @click="emit('open')"
    >
      <UiIconTile :name="tool.icon" size="md" :icon-size="18" />

      <span class="launcher-copy">
        <strong class="text-truncate">{{ tool.name }}</strong>
        <span class="text-clamp-2">{{ tool.description }}</span>
      </span>

      <UiIcon name="arrowRight" :size="15" class="launcher-arrow" />
    </button>

    <button
      type="button"
      class="launcher-pin"
      :class="{ 'is-pinned': pinned }"
      :aria-label="pinned ? `取消置顶 ${tool.name}` : `置顶 ${tool.name}`"
      :aria-pressed="pinned"
      :title="pinned ? '取消置顶' : '置顶到左侧导航'"
      @click="emit('togglePin')"
    >
      <UiIcon name="pin" :size="15" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.launcher-row {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-height: var(--launcher-row-height);
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);

  &:hover {
    border-color: color-mix(in srgb, var(--color-border-light) 72%, transparent);
    background: color-mix(in srgb, var(--color-on-solid) 46%, transparent);
    transform: translateY(-1px);
  }

  &:focus-visible {
    box-shadow: var(--shadow-focus);
  }
}

.launcher-open {
  display: flex;
  align-items: center;
  gap: 11px;
  flex: 1;
  min-width: 0;
  min-height: calc(var(--launcher-row-height) - 10px);
  padding: 3px 4px;
  border: 0;
  border-radius: calc(var(--radius-md) - 2px);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  outline: none;

  &:focus-visible {
    box-shadow: var(--shadow-focus);
  }
}

.launcher-copy {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 1px;

  strong {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-medium);
    line-height: 1.4;
  }

  > span {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.45;
  }
}

.launcher-pin {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  opacity: 0.58;
  transition:
    opacity var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);

  &:hover {
    background: color-mix(in srgb, var(--color-on-solid) 50%, transparent);
    color: var(--color-text-primary);
    opacity: 1;
  }

  &.is-pinned {
    background: color-mix(in srgb, var(--color-warning) 10%, transparent);
    color: var(--color-warning);
    opacity: 1;
  }

  &:focus-visible {
    box-shadow: var(--shadow-focus);
  }
}

.launcher-row:hover .launcher-pin {
  opacity: 1;
}

.launcher-arrow {
  flex: none;
  color: var(--color-text-tertiary);
  transition: transform var(--duration-fast) var(--ease-out);
}

.launcher-row:hover .launcher-arrow {
  transform: translateX(2px);
}

@media (prefers-reduced-motion: reduce) {
  .launcher-row,
  .launcher-arrow {
    transition-duration: 0.01ms;
  }
}
</style>
