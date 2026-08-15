<template>
  <div class="home-page">
    <section class="hero-section">
      <h1>everydaytool</h1>
      <p class="hero-desc">edt · 选择一个工具开始工作</p>
    </section>

    <section class="toolbar">
      <input
        v-model.trim="searchText"
        class="search-input"
        type="search"
        placeholder="搜索工具、能力或关键词"
      >
      <span class="tool-count">共 {{ visibleToolCount }} 个工具</span>
    </section>

    <section v-if="filteredGroups.length > 0" class="category-list">
      <div v-for="group in filteredGroups" :key="group.category.key" class="category-section">
        <div class="category-header">
          <h2>{{ group.category.name }}</h2>
          <span>{{ group.tools.length }}</span>
        </div>

        <div class="tools-grid">
          <ToolCard
            v-for="tool in group.tools"
            :key="tool.id"
            :tool="tool"
            @click="goToTool(tool.id)"
          />
        </div>
      </div>
    </section>

    <section v-else class="empty-state">
      没有匹配的工具
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import ToolCard from '../shared/components/ToolCard.vue';
import { groupToolsByCategory, toolsByCategory } from '../config/tools.js';
import type { ToolDefinition } from '../shared/types/tool.js';

const router = useRouter();
const searchText = ref('');

const filteredTools = computed<ToolDefinition[]>(() => {
  const keyword = searchText.value.toLowerCase();
  const tools = toolsByCategory.flatMap((group) => group.tools);
  if (!keyword) return tools;

  return tools.filter((tool) => {
    const searchableText = [
      tool.name,
      tool.description,
      tool.category.name,
      tool.category.key,
      ...tool.keywords,
    ].join(' ').toLowerCase();

    return searchableText.includes(keyword);
  });
});

const filteredGroups = computed(() => groupToolsByCategory(filteredTools.value));
const visibleToolCount = computed(() => filteredTools.value.length);

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

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-xl);
}

.search-input {
  width: min(420px, 100%);
  height: 38px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font: inherit;
  padding: 0 var(--spacing-md);
  outline: none;
  transition: var(--transition-fast);
}

.search-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.tool-count {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2xl);
}

.category-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.category-header h2 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.category-header span {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--spacing-lg);
}

.empty-state {
  padding: var(--spacing-2xl);
  text-align: center;
  color: var(--color-text-secondary);
}

@media (max-width: 640px) {
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
