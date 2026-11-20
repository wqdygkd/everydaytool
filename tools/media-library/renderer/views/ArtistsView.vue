<script setup lang="ts">
import type { ArtistProfile, CollectionKind, CollectionSummary, LibrarySort } from '@shared/media-library'
import {
  ARTIST_NONE_ID,
  artistMatchesName,
  parseAliasList,
  planArtistMerge,
} from '@shared/media-library'
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { paletteIndexOf, paletteVars } from '../art'
import MediaCard from '../components/MediaCard.vue'
import MlIcon from '../components/MlIcon.vue'
import { artistInitials, formatBytes, searchHaystack } from '../format'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'

type ArtistType = 'all' | CollectionKind

const props = defineProps<{ id?: string | null }>()
const emit = defineEmits<{ edit: [collection: CollectionSummary] }>()
const router = useRouter()
const store = useMediaLibraryStore()
const editing = ref(false)
const artistQuery = ref('')
const artistType = ref<ArtistType>('all')
const artistTag = ref('')
const artistSort = ref<LibrarySort>('added')
const form = reactive({ name: '', aliases: '', bio: '' })

const unsignedCollections = computed(() => store.collections.filter(item => !item.artists.length))
const profile = computed<ArtistProfile | null>(() => {
  if (props.id === ARTIST_NONE_ID) {
    return {
      id: ARTIST_NONE_ID,
      name: '未指定艺人',
      aliases: [],
      bio: '这些合集尚未补全艺人信息。',
      color: paletteIndexOf(ARTIST_NONE_ID),
      createdAt: '',
      updatedAt: '',
    }
  }
  return props.id ? store.artists.find(item => item.id === props.id) ?? null : null
})
const artistCards = computed(() => store.artists.map(item => ({ profile: item, rows: collectionsFor(item) })))
const profileCollections = computed(() => profile.value ? collectionsFor(profile.value) : [])
const profileTags = computed(() => {
  const counts = new Map<string, number>()
  for (const collection of profileCollections.value) {
    for (const tag of collection.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
})
const works = computed(() => {
  const query = artistQuery.value.trim().toLocaleLowerCase()
  const rows = profileCollections.value.filter((item) => {
    if (artistType.value !== 'all' && item.kind !== artistType.value) return false
    if (artistTag.value && !item.tags.includes(artistTag.value)) return false
    return !query || searchHaystack(item).includes(query)
  })
  return [...rows].sort((a, b) => {
    if (artistSort.value === 'name') return a.title.localeCompare(b.title, 'zh-CN')
    if (artistSort.value === 'items') return (b.videos + b.images) - (a.videos + a.images)
    if (artistSort.value === 'size') return b.bytes - a.bytes
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
  })
})
const hasFilters = computed(() => Boolean(artistQuery.value || artistTag.value || artistType.value !== 'all'))
const profileStats = computed(() => ({
  videos: profileCollections.value.reduce((sum, item) => sum + item.videos, 0),
  images: profileCollections.value.reduce((sum, item) => sum + item.images, 0),
  bytes: profileCollections.value.reduce((sum, item) => sum + item.bytes, 0),
}))

watch(() => props.id, () => {
  editing.value = false
  clearFilters()
  if (profile.value) {
    Object.assign(form, {
      name: profile.value.name,
      aliases: profile.value.aliases.join(', '),
      bio: profile.value.bio,
    })
  }
}, { immediate: true })

function collectionsFor(artist: Pick<ArtistProfile, 'id' | 'name' | 'aliases'>): CollectionSummary[] {
  if (artist.id === ARTIST_NONE_ID) return unsignedCollections.value
  return store.collections.filter(collection => collection.artists.some(name => artistMatchesName(artist, name)))
}

function artistStyle(artist: ArtistProfile): Record<string, string> {
  return paletteVars(Number.isInteger(artist.color) ? artist.color : paletteIndexOf(artist.id))
}

function openArtist(id: string): void {
  void router.push({ name: 'tool-media-library-artist', params: { artistId: id } })
}

function openCollection(collection: CollectionSummary): void {
  void router.push({ name: 'tool-media-library-collection', params: { collectionId: collection.id } })
}

function beginEdit(): void {
  if (!profile.value || profile.value.id === ARTIST_NONE_ID) return
  Object.assign(form, { name: profile.value.name, aliases: profile.value.aliases.join(', '), bio: profile.value.bio })
  editing.value = true
}

async function saveArtist(): Promise<void> {
  if (!profile.value || profile.value.id === ARTIST_NONE_ID) return
  const name = form.name.trim()
  if (!name) {
    toast.warning('请输入显示名称')
    return
  }
  const aliases = parseAliasList(form.aliases)
  const plan = planArtistMerge(store.artists, profile.value.id, name, aliases)
  try {
    const result = await store.updateArtist({ id: profile.value.id, name: plan.name, aliases: plan.aliases, bio: form.bio.trim() })
    editing.value = false
    toast.success(result.mergedNames.length ? `资料已保存，并合并：${result.mergedNames.join('、')}` : '艺人资料已保存')
  } catch (error) {
    toast.error((error as Error).message || '保存艺人资料失败')
  }
}

function clearFilters(): void {
  artistQuery.value = ''
  artistType.value = 'all'
  artistTag.value = ''
  artistSort.value = 'added'
}
</script>

<template>
  <div class="ml-pane">
    <template v-if="!id">
      <header class="view-head">
        <div>
          <h1>艺人</h1>
          <p>点击艺人进入独立主页：上方维护艺人资料，下方直接筛选作品，不跳回资料库。支持多艺人与别名合并。</p>
        </div>
      </header>
      <div class="summary-line">
        <span><b>{{ store.artists.length }}</b> 位艺人</span>
        <span><b>{{ store.collections.length - unsignedCollections.length }}</b> 个合集已署名</span>
        <span><b>{{ unsignedCollections.length }}</b> 个待补全</span>
      </div>
      <div class="artist-grid">
        <button v-for="item in artistCards" :key="item.profile.id" type="button" class="artist-card" @click="openArtist(item.profile.id)">
          <span class="avatar" :style="artistStyle(item.profile)">{{ artistInitials(item.profile.name) }}</span>
          <span class="artist-copy">
            <b>{{ item.profile.name }}</b>
            <small>{{ item.rows.length }} 个合集 · {{ item.rows.reduce((n, c) => n + c.videos, 0) }} 视频 · {{ item.rows.reduce((n, c) => n + c.images, 0) }} 图片<span v-if="item.profile.aliases.length"> · {{ item.profile.aliases.length }} 个别名</span></small>
          </span>
          <MlIcon name="chevronRight" :size="14" />
        </button>
        <button v-if="unsignedCollections.length" type="button" class="artist-card" @click="openArtist(ARTIST_NONE_ID)">
          <span class="avatar" style="background:var(--color-fill);color:var(--color-text-tertiary)">?</span>
          <span class="artist-copy"><b>未指定艺人</b><small>{{ unsignedCollections.length }} 个合集待补全</small></span>
          <MlIcon name="chevronRight" :size="14" />
        </button>
      </div>
    </template>

    <template v-else-if="profile">
      <button type="button" class="back-link" @click="router.push({ name: 'tool-media-library-artists' })">
        <MlIcon name="chevronLeft" :size="14" />全部艺人
      </button>
      <section class="artist-hero">
        <div class="artist-hero-main">
          <span class="avatar xl" :style="profile.id === ARTIST_NONE_ID ? { background: 'var(--color-fill)', color: 'var(--color-text-tertiary)' } : artistStyle(profile)">
            {{ profile.id === ARTIST_NONE_ID ? '?' : artistInitials(profile.name) }}
          </span>
          <div class="artist-hero-copy">
            <div class="artist-title-row"><h1>{{ profile.name }}</h1><span v-if="profile.id === ARTIST_NONE_ID" class="tag warn">待补全</span></div>
            <p v-if="profile.aliases.length" class="artist-aliases">别名 · <span v-for="alias in profile.aliases" :key="alias">{{ alias }}</span></p>
            <p v-else class="artist-aliases is-empty">尚未添加别名</p>
            <p class="artist-bio">{{ profile.bio || '还没有简介。' }}</p>
            <div class="artist-stats">
              <span><b>{{ profileCollections.length }}</b> 个合集</span>
              <span><b>{{ profileStats.videos }}</b> 视频</span>
              <span><b>{{ profileStats.images }}</b> 图片</span>
              <span><b>{{ formatBytes(profileStats.bytes) }}</b></span>
            </div>
          </div>
          <div class="artist-hero-actions">
            <button v-if="profile.id === ARTIST_NONE_ID" type="button" class="btn secondary" @click="router.push({ name: 'tool-media-library-inbox' })"><MlIcon name="warning" :size="14" />去补全</button>
            <button v-else-if="!editing" type="button" class="btn secondary" @click="beginEdit"><MlIcon name="edit" :size="14" />编辑资料</button>
          </div>
        </div>
        <form v-if="editing && profile.id !== ARTIST_NONE_ID" class="artist-edit-panel" @submit.prevent="saveArtist">
          <div class="field"><label for="artist-name-input">显示名称</label><input id="artist-name-input" v-model="form.name" class="input"></div>
          <div class="field"><label for="artist-aliases-input">别名 <small>用逗号分隔</small></label><input id="artist-aliases-input" v-model="form.aliases" class="input" placeholder="Lin Jia, 林佳"></div>
          <div class="field is-wide">
            <label for="artist-bio-input">简介</label><textarea id="artist-bio-input" v-model="form.bio" class="textarea" placeholder="写一段艺人或创作方向的说明…" />
            <p class="field-hint">别名与现有艺人同名时会自动合并；合集引用与原文件都会保留。</p>
          </div>
          <div class="artist-edit-actions"><button type="button" class="btn ghost" @click="editing = false">取消</button><button type="submit" class="btn primary">保存资料</button></div>
        </form>
      </section>

      <div class="section-head"><h3>作品 <span>{{ works.length }}</span></h3><span class="section-meta">筛选与资料都留在艺人页内</span></div>
      <div class="artist-toolbar">
        <label class="search-field artist-search"><MlIcon name="search" :size="14" /><input v-model="artistQuery" :placeholder="`在 ${profile.name} 的作品中搜索`"></label>
        <div class="seg">
          <button v-for="type in ([['all', '全部'], ['video', '视频'], ['image', '图片'], ['mixed', '混合']] as const)" :key="type[0]" type="button" class="seg-btn" :class="{ active: artistType === type[0] }" @click="artistType = type[0]">{{ type[1] }}</button>
        </div>
        <details class="menu">
          <summary><span v-if="artistTag" class="active-dot" />{{ artistTag ? `标签 · ${artistTag}` : '标签' }}<MlIcon name="chevronDown" :size="11" /></summary>
          <div class="menu-panel">
            <div class="menu-head">按标签筛选</div>
            <button type="button" class="menu-item" :class="{ active: !artistTag }" @click="artistTag = ''">全部标签 <small>{{ profileTags.length }}</small></button>
            <button v-for="tag in profileTags" :key="tag.name" type="button" class="menu-item" :class="{ active: artistTag === tag.name }" @click="artistTag = tag.name">{{ tag.name }} <small>{{ tag.count }}</small></button>
          </div>
        </details>
        <div class="tb-spacer" />
        <span class="result-count">{{ works.length }} 个合集</span>
        <details class="menu">
          <summary><MlIcon name="sliders" :size="12" />{{ ({ added: '最近添加', name: '名称', items: '条目', size: '大小' } as const)[artistSort] }}<MlIcon name="chevronDown" :size="11" /></summary>
          <div class="menu-panel right">
            <div class="menu-head">排序</div>
            <button v-for="sort in ([['added', '最近添加'], ['name', '名称'], ['items', '条目数'], ['size', '大小']] as const)" :key="sort[0]" type="button" class="menu-item" :class="{ active: artistSort === sort[0] }" @click="artistSort = sort[0]">{{ sort[1] }}</button>
          </div>
        </details>
        <button v-if="hasFilters" type="button" class="btn ghost artist-clear" @click="clearFilters">清除筛选</button>
      </div>
      <div v-if="works.length" class="card-grid">
        <MediaCard v-for="collection in works" :key="collection.id" :collection="collection" @open="openCollection" @play="openCollection" @edit="emit('edit', $event)" />
      </div>
      <div v-else class="empty artist-empty">
        <span class="empty-icon"><MlIcon name="search" :size="20" /></span><h3>没有匹配的作品</h3>
        <p>试试更短的关键词，或清除类型与标签筛选。</p>
        <button type="button" class="btn secondary" @click="clearFilters">清除筛选</button>
      </div>
    </template>

    <div v-else class="empty">
      <span class="empty-icon"><MlIcon name="warning" :size="20" /></span><h3>艺人不存在</h3>
      <button type="button" class="btn secondary" @click="router.push({ name: 'tool-media-library-artists' })">返回全部艺人</button>
    </div>
  </div>
</template>
