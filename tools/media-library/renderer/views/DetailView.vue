<script setup lang="ts">
import type { CollectionDetail, MediaItem } from '@shared/media-library'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import CoverArt from '../components/CoverArt.vue'
import MlIcon from '../components/MlIcon.vue'
import MlVideoPlayer from '../components/MlVideoPlayer.vue'
import PhotoLightbox from '../components/PhotoLightbox.vue'
import { formatAgo, formatBytes, formatTime, heroMetaLine, KIND } from '../format'
import { fileUrl, thumbUrl } from '../mediaUrls'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'

type DetailTab = 'video' | 'images' | 'info'

const props = defineProps<{ id: string | null }>()
const emit = defineEmits<{ edit: [id: string] }>()

const route = useRoute()
const router = useRouter()
const store = useMediaLibraryStore()
const detail = ref<CollectionDetail | null>(null)
const loading = ref(false)
let loadVersion = 0
let lastProgressSave = 0
let progressTimer: ReturnType<typeof setTimeout> | null = null
let pendingProgress: { item: MediaItem, position: number, duration: number } | null = null

const summary = computed(() => store.collectionById(props.id) || detail.value?.summary)
const videos = computed(() => detail.value?.items.filter(item => item.kind === 'video' && !item.missing) || [])
const images = computed(() => detail.value?.items.filter(item => item.kind === 'image' && !item.missing) || [])
const allowedTabs = computed<DetailTab[]>(() => [
  ...(videos.value.length ? ['video' as const] : []),
  ...(images.value.length ? ['images' as const] : []),
  'info',
])
const activeTab = computed<DetailTab>(() => {
  const requested = String(route.query.tab || '')
  return allowedTabs.value.includes(requested as DetailTab) ? requested as DetailTab : allowedTabs.value[0]
})
const activeVideo = computed(() => {
  const itemId = String(route.query.item || '')
  return videos.value.find(item => item.id === itemId)
    || videos.value.find(item => item.id === summary.value?.progress?.itemId)
    || videos.value[0]
})
const photoIndex = computed(() => {
  if (route.query.photo === undefined) return null
  const value = Number(route.query.photo)
  return Number.isInteger(value) ? Math.max(0, Math.min(images.value.length - 1, value)) : null
})
const sourceLabel = computed(() => store.sources.find(source => source.id === summary.value?.sourceId)?.label || '未知来源')
const playerSrc = computed(() => activeVideo.value && props.id
  ? fileUrl(store.endpoint, props.id, activeVideo.value.id) || ''
  : '')
const playerPoster = computed(() => {
  if (!summary.value?.coverItemId || !props.id) return null
  return thumbUrl(store.endpoint, props.id, summary.value.coverItemId, summary.value.coverVersion)
})

async function load(): Promise<void> {
  if (!props.id) {
    detail.value = null
    return
  }
  const version = ++loadVersion
  loading.value = true
  try {
    const next = await store.getCollection(props.id)
    if (version === loadVersion) detail.value = next
  } catch (error) {
    if (version === loadVersion) {
      detail.value = null
      toast.error((error as Error).message || '合集详情加载失败')
    }
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

function queryFor(patch: Record<string, string | undefined>): Record<string, string> {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) {
    if (typeof value === 'string' && value) query[key] = value
  }
  return query
}

function setTab(tab: DetailTab): void {
  void router.replace({
    name: 'tool-media-library-collection',
    params: { collectionId: props.id },
    query: queryFor({ tab, photo: undefined, item: tab === 'video' ? String(route.query.item || '') || undefined : undefined }),
  })
}

function selectVideo(item: MediaItem): void {
  flushProgress()
  void router.replace({
    name: 'tool-media-library-collection',
    params: { collectionId: props.id },
    query: queryFor({ tab: 'video', item: item.id, photo: undefined }),
  })
}

function openPhoto(index: number): void {
  void router.replace({
    name: 'tool-media-library-collection',
    params: { collectionId: props.id },
    query: queryFor({ tab: 'images', photo: String(index), item: undefined }),
  })
}

function closePhoto(): void {
  void router.replace({
    name: 'tool-media-library-collection',
    params: { collectionId: props.id },
    query: queryFor({ tab: 'images', photo: undefined }),
  })
}

async function reveal(itemId?: string): Promise<void> {
  if (!props.id) return
  try {
    await store.revealInFolder({ collectionId: props.id, itemId })
  } catch (error) {
    toast.error((error as Error).message || '无法在文件夹中显示')
  }
}

async function rescan(): Promise<void> {
  if (!props.id) return
  try {
    await store.rescanCollection(props.id)
    await load()
    toast.success('重新扫描完成')
  } catch (error) {
    toast.error((error as Error).message || '重新扫描失败')
  }
}

async function externalPlay(): Promise<void> {
  if (!props.id || !activeVideo.value) return
  try {
    await store.openExternally(props.id, activeVideo.value.id)
  } catch (error) {
    toast.error((error as Error).message || '外部播放器打开失败')
  }
}

function persistProgress(): void {
  const payload = pendingProgress
  if (!payload || !props.id) return
  pendingProgress = null
  lastProgressSave = Date.now()
  void store.saveProgress(props.id, payload.item.id, payload.position, payload.duration).catch(() => undefined)
}

function onProgress(payload: { position: number, duration: number }): void {
  if (!activeVideo.value) return
  pendingProgress = { item: activeVideo.value, ...payload }
  const remaining = 2000 - (Date.now() - lastProgressSave)
  if (remaining <= 0) {
    persistProgress()
    return
  }
  if (!progressTimer) {
    progressTimer = setTimeout(() => {
      progressTimer = null
      persistProgress()
    }, remaining)
  }
}

function flushProgress(): void {
  if (progressTimer) clearTimeout(progressTimer)
  progressTimer = null
  persistProgress()
}

async function onMetadata(meta: { duration?: number, width?: number, height?: number }): Promise<void> {
  const item = activeVideo.value
  if (!props.id || !item) return
  const missing = {
    duration: item.duration ? undefined : meta.duration,
    width: item.width ? undefined : meta.width,
    height: item.height ? undefined : meta.height,
  }
  if (!missing.duration && !missing.width && !missing.height) return
  await store.fillItemMeta(props.id, item.id, missing).catch(() => undefined)
}

async function copyPath(): Promise<void> {
  if (!summary.value) return
  try {
    await navigator.clipboard.writeText(summary.value.rootPath)
    toast.success('路径已复制')
  } catch {
    toast.error('复制路径失败')
  }
}

function goLibrary(filter?: { tag?: string, artist?: string }): void {
  void router.push({ name: 'tool-media-library-library', query: filter })
}

watch(() => props.id, load, { immediate: true })
watch([allowedTabs, () => route.query.tab], () => {
  if (!detail.value || route.name !== 'tool-media-library-collection') return
  if (String(route.query.tab || '') !== activeTab.value) setTab(activeTab.value)
}, { flush: 'post' })

onBeforeUnmount(flushProgress)
</script>

<template>
  <div class="ml-pane">
    <div v-if="summary" class="toolbar detail-toolbar">
      <button class="back-btn" type="button" @click="goLibrary()">
        <MlIcon name="arrowLeft" :size="14" />
        资料库
      </button>
      <span class="crumb-sep">/</span>
      <span class="crumb-title">{{ summary.title }}</span>
      <div class="tb-spacer" />
      <button class="btn ghost" type="button" @click="reveal()">
        <MlIcon name="folder" :size="14" />
        在文件夹中显示
      </button>
      <button class="btn ghost" type="button" :disabled="store.busy.busy" @click="rescan">
        <MlIcon name="refresh" :size="14" />
        重新扫描
      </button>
      <button class="btn secondary" type="button" @click="emit('edit', summary.id)">
        <MlIcon name="edit" :size="14" />
        编辑信息
      </button>
    </div>

    <div v-if="loading && !summary" class="detail-state">正在加载合集…</div>
    <div v-else-if="!summary || !detail" class="detail-state">
      <p>找不到这个合集。</p>
      <button class="btn secondary" type="button" @click="goLibrary()">返回资料库</button>
    </div>

    <template v-else>
      <section class="detail-hero">
        <CoverArt :collection="summary" />
        <div class="detail-shade" />
        <div class="detail-flags">
          <span class="kind-chip detail-chip">
            <MlIcon :name="KIND[summary.kind].icon" :size="11" />
            {{ KIND[summary.kind].label }}
          </span>
          <span v-if="summary.resolution" class="kind-chip detail-chip">{{ summary.resolution }}</span>
        </div>
        <div class="detail-body">
          <h1>{{ summary.title }}</h1>
          <p class="meta">{{ heroMetaLine(summary) }}</p>
          <p v-if="summary.description" class="desc">{{ summary.description }}</p>
          <div class="tag-row">
            <span v-for="tag in summary.tags" :key="tag" class="tag">{{ tag }}</span>
            <span v-if="!summary.tags.length" class="tag tag-empty">未添加标签</span>
          </div>
          <div class="detail-actions">
            <button v-if="videos.length" class="btn primary" type="button" @click="setTab('video')">
              <MlIcon name="play" :size="15" />
              {{ store.progressRatio(summary) > 0 ? '继续播放' : '播放' }}
            </button>
            <button v-if="images.length" class="btn on-dark" type="button" @click="setTab('images')">
              <MlIcon name="image" :size="15" />
              浏览图片
            </button>
            <button class="btn on-dark" type="button" @click="emit('edit', summary.id)">
              <MlIcon name="edit" :size="14" />
              编辑信息
            </button>
          </div>
        </div>
      </section>

      <nav class="detail-tabs" role="tablist" aria-label="合集内容">
        <button
          v-if="videos.length"
          class="detail-tab"
          :class="{ active: activeTab === 'video' }"
          role="tab"
          :aria-selected="activeTab === 'video'"
          type="button"
          @click="setTab('video')"
        >
          视频 <b>{{ videos.length }}</b>
        </button>
        <button
          v-if="images.length"
          class="detail-tab"
          :class="{ active: activeTab === 'images' }"
          role="tab"
          :aria-selected="activeTab === 'images'"
          type="button"
          @click="setTab('images')"
        >
          图片 <b>{{ images.length }}</b>
        </button>
        <button
          class="detail-tab"
          :class="{ active: activeTab === 'info' }"
          role="tab"
          :aria-selected="activeTab === 'info'"
          type="button"
          @click="setTab('info')"
        >
          信息
        </button>
      </nav>

      <div class="detail-content">
        <div v-if="activeTab === 'video' && activeVideo" class="video-layout">
          <div>
            <div class="player">
              <MlVideoPlayer
                :key="activeVideo.id"
                :src="playerSrc"
                :poster="playerPoster"
                :title="activeVideo.name"
                :start-at="summary.progress?.itemId === activeVideo.id ? summary.progress.position : activeVideo.position"
                @timeupdate="onProgress"
                @metadata="onMetadata"
                @external="externalPlay"
              />
            </div>
            <div class="player-caption">
              <div>
                <h3>{{ activeVideo.name }}</h3>
                <p>
                  {{ formatTime(activeVideo.duration) }} · {{ formatBytes(activeVideo.size) }}
                  <template v-if="activeVideo.width && activeVideo.height"> · {{ activeVideo.width }} × {{ activeVideo.height }}</template>
                </p>
              </div>
              <div class="tag-row">
                <span v-for="tag in summary.tags.slice(0, 2)" :key="tag" class="tag">{{ tag }}</span>
              </div>
            </div>
          </div>

          <aside v-if="videos.length > 1" class="episode-panel">
            <div class="episode-head"><h3>视频列表</h3><span>{{ videos.length }} 项</span></div>
            <div class="episode-list">
              <button
                v-for="(item, index) in videos"
                :key="item.id"
                class="episode-row"
                :class="{ active: item.id === activeVideo.id }"
                type="button"
                @click="selectVideo(item)"
              >
                <span class="episode-index">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="episode-thumb">
                  <img :src="thumbUrl(store.endpoint, summary.id, item.id) || ''" :alt="item.name">
                </span>
                <span class="episode-copy">
                  <span class="episode-title">
                    {{ item.name }}
                    <span v-if="item.watched" class="watched"><MlIcon name="check" :size="11" /></span>
                  </span>
                  <span class="episode-meta">{{ formatTime(item.duration) }} · {{ formatBytes(item.size) }}</span>
                </span>
              </button>
            </div>
          </aside>

          <aside v-else class="episode-panel single-panel">
            <div class="episode-head"><h3>文件</h3><span>1 个视频</span></div>
            <dl class="single-info">
              <div class="kv"><dt>文件名</dt><dd class="mono">{{ activeVideo.name }}</dd></div>
              <div class="kv"><dt>时长</dt><dd>{{ formatTime(activeVideo.duration) }}</dd></div>
              <div class="kv"><dt>大小</dt><dd>{{ formatBytes(activeVideo.size) }}</dd></div>
              <div class="kv"><dt>分辨率</dt><dd>{{ activeVideo.width && activeVideo.height ? `${activeVideo.width} × ${activeVideo.height}` : summary.resolution || '—' }}</dd></div>
              <div class="kv"><dt>相对路径</dt><dd class="mono">{{ activeVideo.relPath }}</dd></div>
            </dl>
            <div class="single-actions">
              <button class="btn ghost" type="button" @click="reveal(activeVideo.id)">
                <MlIcon name="folder" :size="13" />
                定位文件
              </button>
              <button class="btn ghost" type="button" @click="rescan">
                <MlIcon name="refresh" :size="13" />
                重扫
              </button>
            </div>
          </aside>
        </div>

        <template v-else-if="activeTab === 'images'">
          <div class="gallery-head">
            <h3>图片<span>{{ images.length }} 张</span></h3>
            <div class="gh-meta"><span>按扫描顺序</span><span>·</span><span>原文件预览</span></div>
          </div>
          <div class="masonry">
            <button
              v-for="(item, index) in images"
              :key="item.id"
              class="thumb"
              :style="{ aspectRatio: `${item.width || 4} / ${item.height || 3}` }"
              type="button"
              :aria-label="`查看 ${item.name}`"
              @click="openPhoto(index)"
            >
              <img :src="thumbUrl(store.endpoint, summary.id, item.id) || ''" :alt="item.name">
              <span class="thumb-label">{{ item.name }}</span>
            </button>
          </div>
        </template>

        <div v-else class="info-layout">
          <div>
            <div class="info-block">
              <h3>简介</h3>
              <p class="info-desc">{{ summary.description || '尚未添加简介。' }}</p>
            </div>
            <div class="info-block">
              <h3>标签</h3>
              <div class="tag-row">
                <button v-for="tag in summary.tags" :key="tag" class="tag info-link" type="button" @click="goLibrary({ tag })">{{ tag }}</button>
                <span v-if="!summary.tags.length" class="tag tag-empty">未添加标签</span>
              </div>
            </div>
            <div class="info-block">
              <h3>艺人</h3>
              <div class="tag-row">
                <button v-for="artist in summary.artists" :key="artist" class="tag info-link" type="button" @click="goLibrary({ artist })">{{ artist }}</button>
                <span v-if="!summary.artists.length" class="tag tag-empty">未指定艺人</span>
              </div>
            </div>
            <div class="trust-note">
              <MlIcon name="shield" :size="15" />
              <span>原文件保持原位。edt 只写入自己的 JSON 元信息；缩略图位于缓存层，可随时清理并重建。</span>
            </div>
          </div>
          <div>
            <div class="info-block">
              <h3>文件信息</h3>
              <dl>
                <div class="kv"><dt>合集路径</dt><dd class="mono">{{ summary.rootPath }}</dd></div>
                <div class="kv"><dt>来源</dt><dd>{{ sourceLabel }}</dd></div>
                <div class="kv"><dt>条目</dt><dd>{{ summary.videos }} 视频 · {{ summary.images }} 图片</dd></div>
                <div class="kv"><dt>总大小</dt><dd>{{ formatBytes(summary.bytes) }}</dd></div>
                <div class="kv"><dt>总时长</dt><dd>{{ formatTime(summary.duration) }}</dd></div>
                <div class="kv"><dt>分辨率</dt><dd>{{ summary.resolution || '—' }}</dd></div>
                <div class="kv"><dt>导入时间</dt><dd>{{ formatAgo(summary.addedAt) }}</dd></div>
                <div class="kv"><dt>最近扫描</dt><dd>{{ formatAgo(summary.lastScanAt) }}</dd></div>
              </dl>
            </div>
            <div class="info-block">
              <h3>历史记录</h3>
              <div class="scan-log">
                <div v-for="entry in detail.history" :key="`${entry.at}-${entry.text}`" class="scan-log-row">
                  <MlIcon name="check" :size="12" />
                  <span>{{ formatAgo(entry.at) }}</span>
                  <span>{{ entry.text }}</span>
                </div>
                <div v-if="!detail.history.length" class="scan-log-row">暂无历史记录</div>
              </div>
            </div>
            <div class="info-actions">
              <button class="btn secondary" type="button" @click="reveal()">
                <MlIcon name="folder" :size="14" />
                在文件夹中显示
              </button>
              <button class="btn ghost" type="button" @click="copyPath">
                <MlIcon name="copy" :size="14" />
                复制路径
              </button>
            </div>
          </div>
        </div>
      </div>

      <PhotoLightbox
        v-if="photoIndex !== null && images.length"
        :collection-id="summary.id"
        :title="summary.title"
        :items="images"
        :index="photoIndex"
        :endpoint="store.endpoint"
        @change="openPhoto"
        @close="closePhoto"
      />
    </template>
  </div>
</template>

<style scoped lang="scss">
.detail-state {
  min-height: 220px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.tb-spacer { flex: 1; }
.detail-chip { position: static; }

.episode-thumb img,
.thumb img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.episode-row {
  width: 100%;
  text-align: left;
}

.thumb img { min-height: 120px; }
.info-link { height: 22px; padding: 0 8px; max-width: 160px; }

.info-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
</style>
