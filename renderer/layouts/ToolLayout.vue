<template>
  <div class="tool-layout">
    <div class="tool-header">
      <button class="back-btn" @click="goBack">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        <span>返回</span>
      </button>
      <h2 class="tool-title">{{ toolTitle }}</h2>
    </div>
    <div class="tool-content">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { toolRegistry } from '../config/tools.js';

const route = useRoute();
const router = useRouter();

const toolTitle = computed(() => {
  const toolId = typeof route.meta?.toolId === 'string' ? route.meta.toolId : null;
  const tool = toolRegistry.find((t) => t.id === toolId);
  return tool?.name || '工具';
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
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border-light);
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: var(--transition-fast);
}

.back-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.back-btn svg {
  width: 18px;
  height: 18px;
}

.tool-title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
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
