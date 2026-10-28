<script setup lang="ts">
import type { UiPreferences } from '../../shared/app'
import type { ToolDefinition } from '../shared/types/tool'
import { STORAGE_KEYS } from '../../shared/storage-keys'
import { getToolRegistry, groupToolsByCategory } from '../config/tools'
import { appIpcChannels, invokeAppIpc } from '../shared/ipc/useAppIpc'

// 收藏是用户数据：**配置层文件**（<data>/config/app/ui-preferences.json）是事实来源，
// LocalStorage 只做镜像（网页预览没有 IPC 时兜底；也保证首屏不必等 IPC 就有内容）。
const FAVORITE_STORAGE_KEY = STORAGE_KEYS.favoriteTools
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

function writeFavoriteMirror() {
  try {
    localStorage.setItem(FAVORITE_STORAGE_KEY, JSON.stringify(favoriteIds.value))
  } catch {
    // 隐私模式 / 配额满：镜像写不进去不影响配置层
  }
}

function persistFavorites() {
  void invokeAppIpc<UiPreferences>(appIpcChannels().UI_PREFERENCES_SET, { favoriteToolIds: favoriteIds.value })
    .catch(() => {
      // 网页预览 / preload 未注入：只有镜像生效，不打扰用户
    })
}

function toggleFavorite(toolId: string) {
  favoriteIds.value = isFavorite(toolId)
    ? favoriteIds.value.filter(id => id !== toolId)
    : [...favoriteIds.value, toolId]
  writeFavoriteMirror()
  persistFavorites()
}

/**
 * 挂载后与配置层对齐：
 * - 配置层有收藏 → 以它为准（并刷新镜像）；
 * - 配置层为空 → 把 LocalStorage 里已有的收藏迁上去（旧版本数据的一次性迁移）。
 */
async function syncFavoritesWithConfigLayer() {
  try {
    const stored = await invokeAppIpc<UiPreferences>(appIpcChannels().UI_PREFERENCES_GET)
    const remote = Array.isArray(stored?.favoriteToolIds) ? stored.favoriteToolIds : []
    if (remote.length > 0) {
      favoriteIds.value = remote
      writeFavoriteMirror()
      return
    }
    if (favoriteIds.value.length > 0) persistFavorites()
  } catch {
    // 没有 IPC（网页预览）：保持镜像即可
  }
}

onMounted(() => {
  void syncFavoritesWithConfigLayer()
})

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
      <UiSearchInput
        v-model="searchText"
        trim
        width="min(520px, 100%)"
        placeholder="搜索工具、能力或关键词"
      />
      <span class="tool-count">{{ visibleToolCount }} 个匹配</span>
    </section>

    <section v-if="favoriteTools.length > 0" class="favorite-section">
      <UiSectionHeader title="我的收藏" :count="favoriteTools.length" />

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
        <UiSectionHeader :title="group.category.name" :count="group.tools.length" />

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

    <UiEmpty v-else variant="bordered" center padding="var(--spacing-3xl)">
      没有匹配的工具
    </UiEmpty>
  </div>
</template>

<style scoped lang="scss">
/* 自然流式高度：滚动发生在 .app-main（滚动条贴窗口右缘），本页不自带滚动。
   width:100% 必须保留：flex 列子项 + 横向 auto margin 会禁用 stretch，缺了它宽度塌缩、网格掉回单列 */
.home-page {
  width: 100%;
  max-width: var(--content-max-width);
  margin: 0 auto;
  padding: var(--spacing-2xl) var(--spacing-3xl) var(--spacing-3xl);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-2xl);

  .tool-count {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3xl);
}

.favorite-section {
  margin-bottom: var(--spacing-3xl);
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: var(--spacing-md);
}

@media (max-width: 640px) {
  .home-page {
    padding: var(--spacing-2xl) var(--spacing-lg) var(--spacing-3xl);
  }

  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
