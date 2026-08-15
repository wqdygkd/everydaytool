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
      <h3 class="tool-name">{{ tool.name }}</h3>
      <p class="tool-desc">{{ tool.description }}</p>
    </div>
    <div class="tool-meta">
      <span class="tool-category">{{ tool.category.name }}</span>
      <span v-if="tool.isNew" class="tool-new">新</span>
      <span class="tool-version">v{{ tool.version }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolDefinition } from '../types/tool.js';

defineProps<{
  tool: ToolDefinition;
  isFavorite?: boolean;
}>();

defineEmits<{
  click: [];
  toggleFavorite: [];
}>();
</script>

<style scoped>
.tool-card {
  position: relative;
  min-height: 184px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: 18px;
  cursor: pointer;
  transition: var(--transition-base);
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
}

.tool-card::before {
  content: "";
  position: absolute;
  inset: 0;
  border-top: 3px solid var(--tool-color);
  opacity: 0.85;
  pointer-events: none;
}

.favorite-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 30px;
  height: 30px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-surface-raised) 92%, transparent);
  color: var(--color-text-tertiary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: var(--transition-fast);
}

.favorite-btn:hover,
.favorite-btn.active {
  border-color: var(--color-warning);
  color: var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 10%, var(--color-surface-raised));
}

.favorite-btn span {
  line-height: 1;
  font-size: 15px;
}

.tool-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--tool-color) 48%, var(--color-border-light));
}

.tool-card:active {
  transform: scale(0.98);
}

.tool-icon {
  width: 42px;
  height: 42px;
  border-radius: var(--radius-md);
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  padding: 8px;
  background: color-mix(in srgb, var(--tool-color) 16%, var(--color-surface-raised));
  border: 1px solid color-mix(in srgb, var(--tool-color) 28%, var(--color-border-light));
}

.tool-icon span {
  border-radius: 3px;
  background: var(--tool-color);
  opacity: 0.9;
}

.tool-info {
  flex: 1;
}

.tool-name {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0 38px 6px 0;
}

.tool-desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.tool-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  justify-content: flex-start;
  align-items: center;
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
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  padding: 1px 6px;
  font-weight: var(--font-weight-semibold);
}

.tool-version {
  color: var(--color-text-tertiary);
  margin-left: auto;
}
</style>
