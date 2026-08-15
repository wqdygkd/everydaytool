<template>
  <div class="home-page">
    <section class="hero-section">
      <h1>everydaytool</h1>
      <p class="hero-desc">edt · 选择一个工具开始工作</p>
    </section>

    <section class="tools-grid">
      <ToolCard
        v-for="tool in toolRegistry"
        :key="tool.id"
        :tool="tool"
        @click="goToTool(tool.id)"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import ToolCard from '../shared/components/ToolCard.vue';
import { toolRegistry } from '../config/tools.js';

const router = useRouter();

function goToTool(toolId: string) {
  router.push({ name: `tool-${toolId}` });
}
</script>

<style scoped>
.home-page {
  padding: var(--spacing-2xl);
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  box-sizing: border-box;
  overflow-y: auto;
}

.hero-section {
  text-align: center;
  margin-bottom: var(--spacing-2xl);
}

.hero-section h1 {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-sm);
}

.hero-desc {
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--spacing-lg);
}
</style>
