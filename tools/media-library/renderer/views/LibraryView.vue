<script setup lang="ts">
import type { CollectionKind, CollectionSummary, LibrarySort } from '@shared/media-library'
import { artistMatchesName, collectionNeeds, findArtistByName } from '@shared/media-library'
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CoverArt from '../components/CoverArt.vue'
import MediaCard from '../components/MediaCard.vue'
import MediaListRow from '../components/MediaListRow.vue'
import MlIcon from '../components/MlIcon.vue'
import { formatTime, heroMetaLine, KIND, mediaCountLine, searchHaystack } from '../format'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'

type TypeFilter = 'all' | CollectionKind

const emit = defineEmits<{
  edit: [collection: CollectionSummary]
  openImport: []
}>()

const route = useRoute()
const router = useRouter()
const store = useMediaLibraryStore()

const TYPE_OPTIONS: Array<{ value: TypeFilter, label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'video', label: '视频' },
  { value: 'image', label: '图集' },
  { value: 'mixed', label: '混合' },
]
const SORT_OPTIONS: Array<{ value: LibrarySort, label: string }> = [
  { value: 'added', label: '最近添加' },
  { value: 'name', label: '名称' },
  { value: 'items', label: '条目数' },
  { value: 'size', label: '文件大小' },
]
const VALID_TYPES = new Set<TypeFilter>(TYPE_OPTIONS.map(item => item.value))
const VALID_SORTS = new Set<LibrarySort>(SORT_OPTIONS.map(item => item.value))

function queryString(key: string): string {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

const query = computed(() => queryString('q'))
const type = computed<TypeFilter>(() => {
  const value = queryString('type') as TypeFilter
  return VALID_TYPES.has(value) ? value : 'all'
})
const tag = computed(() => queryString('tag'))
const artist = computed(() => queryString('artist'))
const sort = computed<LibrarySort>(() => {
  const value = queryString('sort') as LibrarySort
  return VALID_SORTS.has(value) ? value : store.prefs.sort
})
const view = computed(() => store.prefs.view)
const hasFilters = computed(() => Boolean(query.value.trim() || type.value !== 'all' || tag.value || artist.value))

const tags = computed(() => store.tags.map(record => ({
  name: record.name,
  count: store.collections.filter(collection => collection.tags.includes(record.name)).length,
})))
const artists = computed(() => store.artists.map(profile => ({
  name: profile.name,
  count: store.collections.filter(collection =>
    collection.artists.some(name => artistMatchesName(profile, name)),
  ).length,
})).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')))
const unassignedArtistCount = computed(() => store.collections.filter(collection => !collection.artists.length).length)

const filteredCollections = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  const artistFilter = artist.value && artist.value !== '__none'
    ? findArtistByName(store.artists, artist.value) || { name: artist.value, aliases: [] as string[] }
    : null
  const list = store.collections.filter((collection) => {
    if (needle && !searchHaystack(collection).includes(needle)) return false
    if (type.value !== 'all' && collection.kind !== type.value) return false
    if (tag.value && !collection.tags.includes(tag.value)) return false
    if (artist.value === '__none' && collection.artists.length) return false
    if (artistFilter && !collection.artists.some(name => artistMatchesName(artistFilter, name))) return false
    return true
  })
  return list.sort((a, b) => {
    if (sort.value === 'name') return a.title.localeCompare(b.title, 'zh-CN')
    if (sort.value === 'items') return (b.videos + b.images) - (a.videos + a.images)
    if (sort.value === 'size') return b.bytes - a.bytes
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
  })
})

const featured = computed(() => {
  const newest = [...store.collections].sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
  return newest.find(collection =>
    collectionNeeds(collection).length === 0
    && (collection.kind === 'video' || collection.kind === 'mixed'),
  ) ?? newest[0] ?? null
})
const continueItems = computed(() => store.collections
  .filter(collection => store.progressRatio(collection) > 0)
  .sort((a, b) => store.progressRatio(b) - store.progressRatio(a))
  .slice(0, 3))

const sortLabel = computed(() => SORT_OPTIONS.find(item => item.value === sort.value)?.label ?? '最近添加')

function replaceQuery(patch: Record<string, string | undefined>): void {
  const next = { ...route.query }
  for (const [key, value] of Object.entries(patch)) {
    if (value) next[key] = value
    else delete next[key]
  }
  void router.replace({ query: next })
}

function setType(value: TypeFilter): void {
  replaceQuery({ type: value === 'all' ? undefined : value })
}

function setMenuFilter(key: 'tag' | 'artist', value: string, event: Event): void {
  replaceQuery({ [key]: value || undefined })
  ;(event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}

function setSort(value: LibrarySort, event: Event): void {
  replaceQuery({ sort: value })
  ;(event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}

async function setView(value: 'grid' | 'list'): Promise<void> {
  if (store.prefs.view !== value) await store.updatePrefs({ view: value })
}

function clearFilters(): void {
  replaceQuery({ q: undefined, type: undefined, tag: undefined, artist: undefined })
}

function openCollection(collection: CollectionSummary, tab?: 'video' | 'info'): void {
  void router.push({
    name: 'tool-media-library-collection',
    params: { collectionId: collection.id },
    query: tab ? { tab } : undefined,
  })
}

watch([sort, () => store.ready], ([value, ready]) => {
  if (ready && store.prefs.sort !== value) void store.updatePrefs({ sort: value })
}, { immediate: true })

function remainingLabel(collection: CollectionSummary): string {
  if (!collection.progress) return ''
  const remaining = Math.max(0, collection.progress.duration - collection.progress.position)
  return remaining > 0 ? `剩 ${formatTime(remaining)}` : '即将看完'
}
</script>

<template>
  <div class="ml-pane">
    <div id="library-toolbar">
      <div class="toolbar">
        <label class="search-field">
          <MlIcon name="search" :size="14" />
          <input
            id="lib-search"
            data-library-search
            type="search"
            autocomplete="off"
            placeholder="搜索标题、艺人、标签…"
            :value="query"
            @input="replaceQuery({ q: ($event.target as HTMLInputElement).value || undefined })"
          >
          <kbd>/</kbd>
        </label>

        <div class="seg" role="group" aria-label="类型筛选">
          <button
            v-for="option in TYPE_OPTIONS"
            :key="option.value"
            type="button"
            class="seg-btn"
            :class="{ active: type === option.value }"
            @click="setType(option.value)"
          >
            {{ option.label }}
          </button>
        </div>

        <details class="menu">
          <summary>
            <span v-if="tag" class="active-dot" />
            {{ tag ? `标签 · ${tag}` : '标签' }}
            <MlIcon name="chevronDown" :size="11" />
          </summary>
          <div class="menu-panel">
            <div class="menu-head">
              按标签筛选
            </div>
            <button type="button" class="menu-item" :class="{ active: !tag }" @click="setMenuFilter('tag', '', $event)">
              全部标签 <small>{{ tags.length }}</small>
            </button>
            <button
              v-for="item in tags"
              :key="item.name"
              type="button"
              class="menu-item"
              :class="{ active: tag === item.name }"
              @click="setMenuFilter('tag', item.name, $event)"
            >
              {{ item.name }} <small>{{ item.count }}</small>
            </button>
          </div>
        </details>

        <details class="menu">
          <summary>
            <span v-if="artist" class="active-dot" />
            {{ artist ? `艺人 · ${artist === '__none' ? '未指定' : artist}` : '艺人' }}
            <MlIcon name="chevronDown" :size="11" />
          </summary>
          <div class="menu-panel">
            <div class="menu-head">
              按艺人筛选
            </div>
            <button type="button" class="menu-item" :class="{ active: !artist }" @click="setMenuFilter('artist', '', $event)">
              全部艺人 <small>{{ artists.length }}</small>
            </button>
            <button
              v-for="item in artists"
              :key="item.name"
              type="button"
              class="menu-item"
              :class="{ active: artist === item.name }"
              @click="setMenuFilter('artist', item.name, $event)"
            >
              {{ item.name }} <small>{{ item.count }}</small>
            </button>
            <button type="button" class="menu-item" :class="{ active: artist === '__none' }" @click="setMenuFilter('artist', '__none', $event)">
              未指定艺人 <small>{{ unassignedArtistCount }}</small>
            </button>
          </div>
        </details>

        <div class="tb-spacer" />
        <span class="result-count">{{ filteredCollections.length }} 个合集</span>

        <details class="menu">
          <summary>
            <MlIcon name="sliders" :size="12" />
            {{ sortLabel }}
            <MlIcon name="chevronDown" :size="11" />
          </summary>
          <div class="menu-panel right">
            <div class="menu-head">
              排序
            </div>
            <button
              v-for="option in SORT_OPTIONS"
              :key="option.value"
              type="button"
              class="menu-item"
              :class="{ active: sort === option.value }"
              @click="setSort(option.value, $event)"
            >
              {{ option.label }}
            </button>
          </div>
        </details>

        <div class="view-toggle" role="group" aria-label="视图">
          <button type="button" :class="{ active: view === 'grid' }" aria-label="网格视图" @click="setView('grid')">
            <MlIcon name="grid" :size="14" />
          </button>
          <button type="button" :class="{ active: view === 'list' }" aria-label="列表视图" @click="setView('list')">
            <MlIcon name="list" :size="14" />
          </button>
        </div>
      </div>

      <div v-if="hasFilters" class="filter-chips">
        <span v-if="type !== 'all'" class="filter-chip">
          {{ KIND[type].label }}
          <button type="button" aria-label="清除类型" @click="setType('all')"><MlIcon name="close" :size="11" /></button>
        </span>
        <span v-if="tag" class="filter-chip">
          标签 · {{ tag }}
          <button type="button" aria-label="清除标签" @click="replaceQuery({ tag: undefined })"><MlIcon name="close" :size="11" /></button>
        </span>
        <span v-if="artist" class="filter-chip">
          艺人 · {{ artist === '__none' ? '未指定' : artist }}
          <button type="button" aria-label="清除艺人" @click="replaceQuery({ artist: undefined })"><MlIcon name="close" :size="11" /></button>
        </span>
        <span v-if="query" class="filter-chip">
          搜索 · {{ query }}
          <button type="button" aria-label="清除搜索" @click="replaceQuery({ q: undefined })"><MlIcon name="close" :size="11" /></button>
        </span>
        <button type="button" class="clear-filters" @click="clearFilters">
          清除全部
        </button>
      </div>
    </div>

    <div id="results">
      <section v-if="!hasFilters && featured" class="feature-band">
        <article class="billboard">
          <CoverArt :collection="featured" />
          <div class="billboard-shade" />
          <div class="billboard-flags">
            <span class="kind-chip" style="position: static">
              <MlIcon :name="KIND[featured.kind].icon" :size="11" />{{ KIND[featured.kind].label }}
            </span>
            <span class="kind-chip" style="position: static">
              <MlIcon name="clock" :size="11" />最近导入
            </span>
          </div>
          <div class="billboard-body">
            <h2>{{ featured.title }}</h2>
            <p class="meta">
              {{ heroMetaLine(featured) }}
            </p>
            <p v-if="featured.description" class="desc">
              {{ featured.description }}
            </p>
            <div v-if="featured.tags.length" class="tag-row">
              <span v-for="item in featured.tags.slice(0, 3)" :key="item" class="hero-tag">{{ item }}</span>
            </div>
            <template v-if="store.progressRatio(featured) > 0">
              <div class="billboard-progress">
                <i :style="{ width: `${Math.round(store.progressRatio(featured) * 100)}%` }" />
              </div>
              <p class="billboard-progress-label">
                {{ remainingLabel(featured) }}
              </p>
            </template>
            <div class="billboard-actions">
              <button type="button" class="btn primary" @click="openCollection(featured, featured.videos ? 'video' : undefined)">
                <MlIcon :name="featured.videos ? 'play' : 'image'" :size="15" />
                {{ store.progressRatio(featured) > 0 ? '继续播放' : '打开合集' }}
              </button>
              <button type="button" class="btn on-dark" @click="openCollection(featured, 'info')">
                查看信息
              </button>
            </div>
          </div>
        </article>

        <aside class="continue-panel">
          <div class="cp-head">
            <h3>继续观看</h3><span>{{ continueItems.length }} 项</span>
          </div>
          <button
            v-for="collection in continueItems"
            :key="collection.id"
            type="button"
            class="continue-row"
            @click="openCollection(collection, 'video')"
          >
            <span class="continue-thumb"><CoverArt :collection="collection" small /></span>
            <span class="continue-body">
              <b class="continue-title">{{ collection.title }}</b>
              <span class="continue-sub">{{ mediaCountLine(collection.videos, collection.images) }}</span>
              <span class="continue-bar"><i :style="{ width: `${Math.round(store.progressRatio(collection) * 100)}%` }" /></span>
              <span class="continue-time">{{ remainingLabel(collection) }}</span>
            </span>
            <MlIcon name="play" :size="14" />
          </button>
          <div v-if="!continueItems.length" class="continue-empty">
            还没有观看记录。<br>打开一个视频合集开始。
          </div>
        </aside>
      </section>

      <template v-if="filteredCollections.length">
        <div class="section-head">
          <h3>{{ hasFilters ? '筛选结果' : '全部合集' }}<span>{{ filteredCollections.length }}</span></h3>
          <span class="section-meta">{{ hasFilters ? '筛选即时生效' : `按${sortLabel}排序` }}</span>
        </div>
        <div v-if="view === 'grid'" class="card-grid">
          <MediaCard
            v-for="collection in filteredCollections"
            :key="collection.id"
            :collection="collection"
            @open="openCollection"
            @play="openCollection($event, 'video')"
            @edit="emit('edit', $event)"
          />
        </div>
        <div v-else class="media-list">
          <div class="list-head">
            <span>合集</span><span>类型</span><span>条目</span><span>大小</span><span>最近扫描</span><span />
          </div>
          <MediaListRow
            v-for="collection in filteredCollections"
            :key="collection.id"
            :collection="collection"
            @open="openCollection"
          />
        </div>
      </template>

      <div v-else class="empty">
        <span class="empty-icon"><MlIcon :name="hasFilters ? 'search' : 'folderPlus'" :size="20" /></span>
        <h3>{{ hasFilters ? '没有找到匹配的合集' : '资料库还是空的' }}</h3>
        <p>{{ hasFilters ? '试试更短的关键词，或清除类型、标签与艺人筛选。' : '导入一个媒体文件夹，扫描后即可生成合集。' }}</p>
        <button v-if="hasFilters" type="button" class="btn secondary" @click="clearFilters">
          清除筛选
        </button>
        <button v-else type="button" class="btn primary" @click="emit('openImport')">
          导入文件夹
        </button>
      </div>
    </div>
  </div>
</template>
