<script setup lang="ts">
import type { ToolDefinition } from '../types/tool'

defineProps<{
  tool: ToolDefinition
  isFavorite?: boolean
}>()

defineEmits<{
  click: []
  toggleFavorite: []
}>()
</script>

<template>
  <div class="tool-card" :style="{ '--tool-color': tool.color }" @click="$emit('click')">
    <button
      class="favorite-btn"
      type="button"
      :class="{ active: isFavorite }"
      :aria-label="isFavorite ? '取消收藏' : '收藏工具'"
      :title="isFavorite ? '取消收藏' : '收藏工具'"
      @click.stop="$emit('toggleFavorite')"
    >
      <span aria-hidden="true">★</span>
    </button>
    <div class="tool-icon" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
    <div class="tool-info">
      <h3 class="tool-name">
        {{ tool.name }}
      </h3>
      <p class="tool-desc">
        {{ tool.description }}
      </p>
    </div>
    <div class="tool-meta">
      <span class="tool-category">{{ tool.category.name }}</span>
      <span v-if="tool.isNew" class="tool-new">新</span>
      <span class="tool-version">v{{ tool.version }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tool-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 184px;
  padding: 18px;
  overflow: hidden;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
  cursor: pointer;
  transition: var(--transition-base);

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-top: 3px solid var(--tool-color);
    opacity: 0.85;
    pointer-events: none;
  }

  &:hover {
    border-color: color-mix(in srgb, var(--tool-color) 48%, var(--color-border-light));
    box-shadow: var(--shadow-md);
    transform: translateY(-3px);
  }

  &:active {
    transform: scale(0.98);
  }

  .favorite-btn {
    position: absolute;
    top: 14px;
    right: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-surface-raised) 92%, transparent);
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: var(--transition-fast);

    &:hover,
    &.active {
      border-color: var(--color-warning);
      background: color-mix(in srgb, var(--color-warning) 10%, var(--color-surface-raised));
      color: var(--color-warning);
    }

    span {
      font-size: 15px;
      line-height: 1;
    }
  }

  .tool-icon {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    width: 42px;
    height: 42px;
    padding: 8px;
    border: 1px solid color-mix(in srgb, var(--tool-color) 28%, var(--color-border-light));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--tool-color) 16%, var(--color-surface-raised));

    span {
      border-radius: 3px;
      background: var(--tool-color);
      opacity: 0.9;
    }
  }

  .tool-info {
    flex: 1;
  }

  .tool-name {
    margin: 0 38px 6px 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
  }

  .tool-desc {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.45;
  }

  .tool-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-start;
    gap: var(--spacing-xs);
  }

  .tool-category,
  .tool-new,
  .tool-version {
    font-size: var(--font-size-xs);
  }

  .tool-category {
    color: var(--color-text-secondary);
  }

  .tool-new {
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--color-primary-soft);
    color: var(--color-primary);
    font-weight: var(--font-weight-semibold);
  }

  .tool-version {
    margin-left: auto;
    color: var(--color-text-tertiary);
  }
}
</style>
