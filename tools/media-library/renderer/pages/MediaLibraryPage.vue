<script setup lang="ts">
import type { CollectionSummary } from '@shared/media-library'
import { useToolPaneActive } from '@renderer/shared/components/ui/overlay-target'
import { useToolPath } from '@renderer/shared/composables/useToolPath'
import { artistMatchesName } from '@shared/media-library'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceSpine from '../../../../renderer/shared/components/workspace/WorkspaceSpine.vue'
import EditCollectionDrawer from '../components/EditCollectionDrawer.vue'
import MlIcon from '../components/MlIcon.vue'
import { formatBytes } from '../format'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'
import {
  MEDIA_LIBRARY_SUB_ROUTES,
  MEDIA_LIBRARY_TABS,
  parseMediaLibraryPath,
  spineKeyOf,
} from '../tabs'
import ArtistsView from '../views/ArtistsView.vue'
import DetailView from '../views/DetailView.vue'
import ImportFlow from '../views/ImportFlow.vue'
import InboxView from '../views/InboxView.vue'
import LibraryView from '../views/LibraryView.vue'
import SeriesView from '../views/SeriesView.vue'
import SourcesView from '../views/SourcesView.vue'
import TagsView from '../views/TagsView.vue'

const router = useRouter()
const store = useMediaLibraryStore()
const toolPath = useToolPath()
const paneActive = useToolPaneActive()
const page = ref<HTMLElement | null>(null)
const importOpen = ref(false)
const editCollectionId = ref<string | null>(null)

const parsed = computed(() => parseMediaLibraryPath(toolPath.value))
const activeSpineKey = computed(() => spineKeyOf(parsed.value.view))
const activeCollection = computed(() => store.collectionById(parsed.value.view === 'collection' ? parsed.value.id : null))

const VIEWS = {
  library: LibraryView,
  collection: DetailView,
  series: SeriesView,
  inbox: InboxView,
  tags: TagsView,
  artists: ArtistsView,
  sources: SourcesView,
} as const

const activeView = computed(() => VIEWS[parsed.value.view])
const totalItems = computed(() => store.collections.reduce((total, item) => total + item.videos + item.images, 0))
const sourceChanged = computed(() => store.sources.some(source => source.status === 'changed'))

const spineItems = computed(() => MEDIA_LIBRARY_TABS.map(tab => ({
  key: tab.key,
  label: tab.label,
  count: tab.key === 'library'
    ? store.collections.length
    : tab.key === 'series'
      ? store.series.length
      : tab.key === 'inbox'
        ? store.inboxCollections.length
        : tab.key === 'tags'
          ? store.tags.length
          : tab.key === 'artists'
            ? store.artists.length
            : store.sources.length,
})))

const status = computed(() => {
  if (store.busy.busy) return { text: store.busy.label || '正在扫描…', tone: 'busy' }
  if (parsed.value.view === 'collection' && activeCollection.value) {
    const collection = activeCollection.value
    return {
      text: `${collection.videos} 视频 · ${collection.images} 图片 · ${formatBytes(collection.bytes)}`,
      tone: 'ok',
    }
  }
  if (parsed.value.view === 'tags') return { text: `${store.tags.length} 个标签`, tone: 'ok' }
  if (parsed.value.view === 'artists') {
    if (parsed.value.id === '__none') {
      const count = store.collections.filter(collection => !collection.artists.length).length
      return { text: `未指定艺人 · ${count} 个合集`, tone: 'ok' }
    }
    const artist = store.artists.find(item => item.id === parsed.value.id)
    if (artist) {
      const count = store.collections.filter(collection =>
        collection.artists.some(name => artistMatchesName(artist, name)),
      ).length
      return { text: `${artist.name} · ${count} 个合集`, tone: 'ok' }
    }
    return { text: `${store.artists.length} 位艺人`, tone: 'ok' }
  }
  if (parsed.value.view === 'series') {
    const series = store.series.find(item => item.id === parsed.value.id)
    if (series) return { text: `${series.name} · ${series.collectionIds.length} 个合集`, tone: 'ok' }
    return { text: `${store.series.length} 个系列`, tone: 'ok' }
  }
  if (parsed.value.view === 'sources') {
    return {
      text: `${store.sources.length} 个来源 · ${totalItems.value.toLocaleString('zh-CN')} 项`,
      tone: sourceChanged.value ? 'warn' : 'ok',
    }
  }
  return {
    text: `${store.collections.length} 个合集 · ${totalItems.value.toLocaleString('zh-CN')} 项`,
    tone: sourceChanged.value ? 'warn' : 'ok',
  }
})

function switchView(key: string): void {
  const route = MEDIA_LIBRARY_SUB_ROUTES.find(item => item.path === key)
  if (route) void router.push({ name: route.name })
}

async function rescanAll(): Promise<void> {
  try {
    await store.rescanAll()
    toast.success('重新扫描完成')
  } catch (error) {
    toast.error((error as Error).message || '重新扫描失败')
  }
}

function openEdit(value: string | CollectionSummary): void {
  editCollectionId.value = typeof value === 'string' ? value : value.id
}

function closeEdit(): void {
  editCollectionId.value = null
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (!paneActive.value || parsed.value.view !== 'library' || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  const input = page.value?.querySelector<HTMLInputElement>('[data-library-search], #lib-search, input[type="search"]')
  if (!input) return
  event.preventDefault()
  input.focus()
}

onMounted(async () => {
  document.addEventListener('keydown', onDocumentKeydown)
  try {
    await store.init()
  } catch (error) {
    toast.error((error as Error).message || '媒体库加载失败')
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
  void store.dispose()
})
</script>

<template>
  <div ref="page" class="ml media-library-page tool-page" :class="{ 'is-scanning': store.busy.busy }">
    <Teleport v-if="paneActive" defer to="#app-topbar-state">
      <span class="ml-topbar-state" :class="`is-${status.tone}`">
        <i />
        {{ status.text }}
      </span>
    </Teleport>

    <Teleport v-if="paneActive" defer to="#app-topbar-actions">
      <UiButton size="small" :disabled="store.busy.busy" @click="rescanAll">
        <MlIcon name="refresh" :size="14" />
        {{ store.busy.busy ? '扫描中…' : '重新扫描' }}
      </UiButton>
      <UiButton size="small" type="primary" @click="importOpen = true">
        <MlIcon name="folderPlus" :size="14" />
        导入文件夹
      </UiButton>
    </Teleport>

    <ToolSurface class="media-library-surface">
      <template #spine>
        <WorkspaceSpine
          label="浏览"
          :model-value="activeSpineKey"
          :items="spineItems"
          @update:model-value="switchView"
        />
      </template>

      <component
        :is="activeView"
        :id="parsed.id"
        @open-import="importOpen = true"
        @edit="openEdit"
      />

      <div v-if="importOpen" class="local-pane-overlay">
        <ImportFlow @close="importOpen = false" />
      </div>

      <EditCollectionDrawer
        v-if="editCollectionId"
        :id="editCollectionId"
        @close="closeEdit"
        @saved="closeEdit"
      />
    </ToolSurface>
  </div>
</template>

<style lang="scss">
@use '../styles/media-library';
</style>

<style scoped lang="scss">
.media-library-page {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.media-library-surface {
  min-height: 0;

  :deep(.tool-surface-body) {
    position: relative;
  }
}

.ml-topbar-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;

  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  &.is-ok { color: var(--color-success); }
  &.is-warn { color: var(--color-warning); }
  &.is-busy i { animation: ml-status-pulse 1s ease-in-out infinite; }
}

.local-pane-overlay {
  position: absolute;
  z-index: 50;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--color-raised);
}

@keyframes ml-status-pulse {
  50% { opacity: 0.45; transform: scale(0.82); }
}
</style>
