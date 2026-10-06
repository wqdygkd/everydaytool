<script setup lang="ts">
import type { ToolDefinition } from '../shared/types/tool'
import { getToolRegistry, groupToolsByCategory } from '../config/tools'

const FAVORITE_STORAGE_KEY = 'edt:favorite-tools'
const router = useRouter()
const searchText = ref('')
const allTools = computed(() => getToolRegistry())
const favoriteIds = ref(readFavoriteIds())

const filteredTools = computed<ToolDefinition[]>(() => {
  const keyword = searchText.value.toLowerCase()
  if (!keyword) return allTools.value

  return allTools.value.filter((tool) => {
    const searchableText = [
      tool.name,
      tool.description,
      tool.category.name,
      tool.category.key,
      ...tool.keywords,
    ].join(' ').toLowerCase()

    return searchableText.includes(keyword)
  })
})

const filteredGroups = computed(() => groupToolsByCategory(filteredTools.value))
const visibleToolCount = computed(() => filteredTools.value.length)
const favoriteTools = computed(() => favoriteIds.value
  .map(id => allTools.value.find(tool => tool.id === id))
  .filter((tool): tool is ToolDefinition => Boolean(tool)))

function goToTool(toolId: string) {
  router.push({ name: `tool-${toolId}` })
}

function isFavorite(toolId: string): boolean {
  return favoriteIds.value.includes(toolId)
}

function toggleFavorite(toolId: string) {
  favoriteIds.value = isFavorite(toolId)
    ? favoriteIds.value.filter(id => id !== toolId)
    : [...favoriteIds.value, toolId]
  localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(favoriteIds.value))
}

function readFavoriteIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITE_STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}
</script>

<template>
  <div class="home-page">
    <section class="toolbar">
      <div class="search-field">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          v-model.trim="searchText"
          class="search-input"
          type="search"
          placeholder="搜索工具、能力或关键词"
        >
      </div>
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

<style scoped lang="scss">
/* 自然流式高度：滚动发生在 .app-main（滚动条贴窗口右缘），本页不自带滚动。
   width:100% 必须保留：flex 列子项 + 横向 auto margin 会禁用 stretch，缺了它宽度塌缩、网格掉回单列 */
.home-page {
  width: 100%;
  max-width: 1360px;
  margin: 0 auto;
  padding: 24px 32px 32px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: 28px;

  /* 搜索框：白底浮岛胶囊（画布是灰 #f4f4f5，Telegram 的灰底胶囊在灰画布上不可见），聚焦蓝框 */
  .search-field {
    position: relative;
    width: min(520px, 100%);
  }

  .search-icon {
    position: absolute;
    top: 50%;
    left: 15px;
    width: 18px;
    height: 18px;
    transform: translateY(-50%);
    fill: none;
    stroke: var(--color-text-secondary);
    stroke-width: 2;
    stroke-linecap: round;
    pointer-events: none;
    transition: stroke var(--transition-fast);
  }

  .search-input {
    width: 100%;
    height: 42px;
    border: 2px solid var(--color-border-light);
    border-radius: 999px;
    background: var(--color-surface);
    color: var(--color-text-primary);
    font: inherit;
    padding: 0 16px 0 42px;
    outline: none;
    appearance: none;
    transition: var(--transition-fast);

    /* type=search 原生装饰（内衬/清除按钮）在胶囊内错位，去掉，Esc 仍可清空 */
    &::-webkit-search-cancel-button,
    &::-webkit-search-decoration,
    &::-webkit-search-results-button,
    &::-webkit-search-results-decoration {
      -webkit-appearance: none;
      appearance: none;
    }

    &::placeholder {
      color: color-mix(in srgb, var(--color-text-secondary) 55%, transparent);
    }

    &:hover {
      border-color: var(--color-border);
    }

    &:focus {
      border-color: var(--color-primary);
      caret-color: var(--color-primary);
    }
  }

  .search-field:focus-within .search-icon {
    stroke: var(--color-primary);
  }

  .tool-count {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }
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

  h2 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-medium);
  }

  span {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-sm);
  }
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}

.empty-state {
  padding: 42px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  text-align: center;
  color: var(--color-text-secondary);
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
