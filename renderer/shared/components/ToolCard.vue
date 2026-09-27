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
    <div class="tool-head">
      <div class="tool-icon" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <h3 class="tool-name">
        {{ tool.name }}
      </h3>
    </div>
    <p class="tool-desc">
      {{ tool.description }}
    </p>
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
  gap: 10px;
  min-height: 0;
  padding: 12px 14px;
  overflow: hidden;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
  cursor: pointer;
  transition: transform var(--transition-base), border-color var(--transition-base), box-shadow var(--transition-base);

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, color-mix(in srgb, var(--tool-color) 14%, transparent), transparent 38%);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition-base);
  }

  &::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--tool-color) 55%, transparent), color-mix(in srgb, var(--tool-color) 90%, transparent));
    opacity: 0.9;
    pointer-events: none;
  }

  &:hover {
    border-color: color-mix(in srgb, var(--tool-color) 42%, var(--color-border-light));
    box-shadow: var(--shadow-md);
    transform: translateY(-3px);

    &::before {
      opacity: 1;
    }
  }

  &:active {
    transform: translateY(-1px) scale(0.99);
  }

  .favorite-btn {
    position: absolute;
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
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

    &:active {
      transform: scale(0.82);
    }

    span {
      font-size: 13px;
      line-height: 1;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    &.active span {
      transform: scale(1.15);
    }
  }

  .tool-icon {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 3px;
    width: 30px;
    height: 30px;
    padding: 6px;
    border: 1px solid color-mix(in srgb, var(--tool-color) 28%, var(--color-border-light));
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--tool-color) 16%, var(--color-surface-raised));

    span {
      border-radius: 3px;
      background: var(--tool-color);
      opacity: 0.9;
    }
  }

  .tool-head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .tool-name {
    flex: 1;
    min-width: 0;
    margin: 0 28px 0 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-desc {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    overflow: hidden;
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.4;
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
