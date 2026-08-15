<template>
  <div class="home-page">
    <section class="workspace-header">
      <div class="workspace-copy">
        <span class="workspace-kicker">edt workspace</span>
        <h1>选择工具，继续工作</h1>
        <p>桌面端和网页端工具统一入口，收藏常用项，按能力快速过滤。</p>
      </div>
      <div class="workspace-stats">
        <div>
          <strong>{{ allTools.length }}</strong>
          <span>可用工具</span>
        </div>
        <div>
          <strong>{{ favoriteTools.length }}</strong>
          <span>收藏</span>
        </div>
        <div>
          <strong>{{ toolsByCategory.length }}</strong>
          <span>分类</span>
        </div>
      </div>
    </section>

    <section class="toolbar">
      <input
        v-model.trim="searchText"
        class="search-input"
        type="search"
        placeholder="搜索工具、能力或关键词"
      >
      <span class="tool-count">{{ visibleToolCount }} 个匹配</span>
    </section>

    <section v-if="favoriteTools.length > 0" class="favorite-section">
      <div class="category-header">
        <h2>我的收藏</h2>
        <span>{{ favoriteTools.length }}</span>
      </div>

      <div class="tools-grid">
        <ToolCard
          v-for="tool in favoriteTools"
          :key="tool.id"
          :tool="tool"
          :is-favorite="true"
          @click="goToTool(tool.id)"
          @toggle-favorite="toggleFavorite(tool.id)"
        />
      </div>
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
            :is-favorite="isFavorite(tool.id)"
            @click="goToTool(tool.id)"
            @toggle-favorite="toggleFavorite(tool.id)"
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

const FAVORITE_STORAGE_KEY = 'edt:favorite-tools';
const router = useRouter();
const searchText = ref('');
const allTools = toolsByCategory.flatMap((group) => group.tools);
const favoriteIds = ref(readFavoriteIds());

const filteredTools = computed<ToolDefinition[]>(() => {
  const keyword = searchText.value.toLowerCase();
  if (!keyword) return allTools;

  return allTools.filter((tool) => {
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
const favoriteTools = computed(() => favoriteIds.value
  .map((id) => allTools.find((tool) => tool.id === id))
  .filter((tool): tool is ToolDefinition => Boolean(tool)));

function goToTool(toolId: string) {
  router.push({ name: `tool-${toolId}` });
}

function isFavorite(toolId: string): boolean {
  return favoriteIds.value.includes(toolId);
}

function toggleFavorite(toolId: string) {
  favoriteIds.value = isFavorite(toolId)
    ? favoriteIds.value.filter((id) => id !== toolId)
    : [...favoriteIds.value, toolId];
  localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(favoriteIds.value));
}

function readFavoriteIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITE_STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
</script>

<style scoped>
.home-page {
  padding: 34px 32px 48px;
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  box-sizing: border-box;
  overflow-y: auto;
}

.workspace-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 32px;
  align-items: end;
  margin-bottom: 26px;
}

.workspace-kicker {
  display: block;
  margin-bottom: 10px;
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.workspace-copy h1 {
  margin: 0;
  max-width: 680px;
  font-size: clamp(34px, 5vw, 64px);
  line-height: 0.98;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--color-text-primary);
}

.workspace-copy p {
  margin: 14px 0 0;
  max-width: 560px;
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
}

.workspace-stats {
  display: grid;
  grid-template-columns: repeat(3, 92px);
  gap: 1px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-border-light);
  overflow: hidden;
}

.workspace-stats div {
  background: var(--color-surface-raised);
  padding: 14px;
}

.workspace-stats strong,
.workspace-stats span {
  display: block;
}

.workspace-stats strong {
  font-size: var(--font-size-xl);
  line-height: 1;
  color: var(--color-text-primary);
}

.workspace-stats span {
  margin-top: 6px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: 28px;
}

.search-input {
  width: min(520px, 100%);
  height: 42px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  font: inherit;
  padding: 0 14px;
  outline: none;
  transition: var(--transition-fast);
}

.search-input:focus {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-focus);
}

.tool-count {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 34px;
}

.favorite-section {
  margin-bottom: 36px;
}

.category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border-light);
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
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}

.empty-state {
  padding: 42px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  text-align: center;
  color: var(--color-text-secondary);
}

@media (max-width: 900px) {
  .workspace-header {
    grid-template-columns: 1fr;
  }

  .workspace-stats {
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .home-page {
    padding: 24px 16px 36px;
  }

  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
