<template>
  <div class="tool-card" :style="{ borderColor: tool.color }" @click="$emit('click')">
    <button
      class="favorite-btn"
      type="button"
      :class="{ active: isFavorite }"
      :aria-label="isFavorite ? '取消收藏' : '收藏工具'"
      :title="isFavorite ? '取消收藏' : '收藏工具'"
      @click.stop="$emit('toggleFavorite')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.4l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.3l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3.4z" />
      </svg>
    </button>
    <div class="tool-icon" :style="{ background: tool.color }">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </svg>
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
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  cursor: pointer;
  transition: var(--transition-base);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.favorite-btn {
  position: absolute;
  top: var(--spacing-md);
  right: var(--spacing-md);
  width: 28px;
  height: 28px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
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
}

.favorite-btn svg {
  width: 17px;
  height: 17px;
  fill: currentColor;
}

.tool-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.tool-card:active {
  transform: scale(0.98);
}

.tool-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tool-info {
  flex: 1;
}

.tool-name {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: 4px;
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
  background: var(--color-primary-light);
  color: var(--color-primary);
  padding: 1px 6px;
  font-weight: var(--font-weight-semibold);
}

.tool-version {
  color: var(--color-text-tertiary);
  margin-left: auto;
}
</style>
