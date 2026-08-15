<template>
  <div class="tool-card" :style="{ borderColor: tool.color }" @click="$emit('click')">
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
      <span class="tool-version">v{{ tool.version }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolDefinition } from '../types/tool.js';

defineProps<{ tool: ToolDefinition }>();

defineEmits<{ click: [] }>();
</script>

<style scoped>
.tool-card {
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
  justify-content: space-between;
  align-items: center;
}

.tool-version {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
</style>