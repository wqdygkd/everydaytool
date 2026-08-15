<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <span class="brand-dot" />
        <span>everydaytool</span>
      </div>
      <span class="subtitle">edt · 多功能工具平台</span>
    </header>

    <main class="app-main">
      <router-view />
    </main>

    <footer class="app-footer">
      <template v-if="currentTool">
        {{ currentToolName }}
      </template>
      <template v-else>
        共 {{ toolCount }} 个工具
      </template>
      | v1.0.0
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { toolRegistry } from './config/tools.js';

const route = useRoute();

const currentTool = computed(() => (typeof route.meta?.toolId === 'string' ? route.meta.toolId : null));
const currentToolName = computed(() => {
  const tool = toolRegistry.find((t) => t.id === currentTool.value);
  return tool?.name || '';
});
const toolCount = computed(() => toolRegistry.length);
</script>

<style scoped>
.app-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-header {
  height: 52px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #111827;
  color: #fff;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-primary);
}

.subtitle {
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.app-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-footer {
  height: 34px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border-top: 1px solid var(--color-border-light);
}
</style>
