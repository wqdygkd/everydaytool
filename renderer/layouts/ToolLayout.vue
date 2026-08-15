<template>
  <div class="tool-layout">
    <div class="tool-header">
      <button class="back-btn" @click="goBack">
        <span aria-hidden="true">←</span>
        <span>返回</span>
      </button>
      <div class="tool-heading">
        <span class="tool-category">{{ currentTool?.category.name || '工具' }}</span>
        <h2 class="tool-title">{{ toolTitle }}</h2>
        <p v-if="currentTool" class="tool-description">{{ currentTool.description }}</p>
      </div>
    </div>
    <div class="tool-content">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { toolRegistry } from '../config/tools.js';

const route = useRoute();
const router = useRouter();

const currentTool = computed(() => {
  const toolId = typeof route.meta?.toolId === 'string' ? route.meta.toolId : null;
  return toolRegistry.find((t) => t.id === toolId);
});
const toolTitle = computed(() => {
  return currentTool.value?.name || '工具';
});

function goBack() {
  router.push({ name: 'home' });
}
</script>

<style scoped>
.tool-layout {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  background: var(--color-app-bg);
}

.tool-header {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  padding: 18px 24px;
  background: var(--color-surface-raised);
  border-bottom: 1px solid var(--color-border-light);
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-muted);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: var(--transition-fast);
}

.back-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.tool-heading {
  min-width: 0;
}

.tool-category {
  display: block;
  margin-bottom: 2px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

.tool-title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.tool-description {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.tool-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tool-content > :deep(*) {
  flex: 1;
  min-height: 0;
}
</style>
