<script setup lang="ts">
import type { CollectionSummary } from '@shared/media-library'
import { collectionNeeds } from '@shared/media-library'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import MediaCard from '../components/MediaCard.vue'
import MlIcon from '../components/MlIcon.vue'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'

const emit = defineEmits<{
  'edit': [collection: CollectionSummary]
  'open-import': []
}>()
const router = useRouter()
const store = useMediaLibraryStore()
const artistMissing = computed(() => store.inboxCollections.filter(item => collectionNeeds(item).includes('artist')).length)
const tagsMissing = computed(() => store.inboxCollections.filter(item => collectionNeeds(item).includes('tags')).length)
const coverMissing = computed(() => store.inboxCollections.filter(item => collectionNeeds(item).includes('cover')).length)

function openCollection(collection: CollectionSummary): void {
  void router.push({ name: 'tool-media-library-collection', params: { collectionId: collection.id } })
}

function openImport(): void {
  // 公共事件名沿用媒体库页面约定。
  // eslint-disable-next-line vue/custom-event-name-casing
  emit('open-import')
}
</script>

<template>
  <div class="ml-pane">
    <header class="view-head">
      <div>
        <h1>待整理</h1>
        <p>已导入但缺少艺人、标签或封面的合集。补全后更容易被搜到；原文件夹不会被修改。</p>
      </div>
      <div class="view-head-actions">
        <button type="button" class="btn secondary" @click="openImport"><MlIcon name="folderPlus" :size="14" />继续导入</button>
      </div>
    </header>
    <div class="summary-line">
      <span><b>{{ store.inboxCollections.length }}</b> 个合集等待完善</span>
      <span>缺少艺人 <b>{{ artistMissing }}</b></span>
      <span>缺少标签 <b>{{ tagsMissing }}</b></span>
      <span>缺少封面 <b>{{ coverMissing }}</b></span>
    </div>
    <div v-if="store.inboxCollections.length" class="notice">
      <MlIcon name="info" :size="14" />
      <span>给合集补上艺人与标签后，它会出现在资料库的筛选结果里。封面可以稍后再挑，不影响浏览。</span>
    </div>
    <div v-if="store.inboxCollections.length" class="card-grid">
      <MediaCard
        v-for="collection in store.inboxCollections"
        :key="collection.id"
        :collection="collection"
        @open="openCollection"
        @play="openCollection"
        @edit="emit('edit', $event)"
      />
      <button type="button" class="add-tile" @click="openImport">
        <MlIcon name="folderPlus" :size="24" /><b>导入更多</b><small>只读取，不改动原文件</small>
      </button>
    </div>
    <div v-else class="empty">
      <span class="empty-icon"><MlIcon name="check" :size="20" /></span>
      <h3>全部整理完毕</h3>
      <p>所有合集都有艺人和标签了。下一次导入的新内容会出现在这里。</p>
      <button type="button" class="btn secondary" @click="router.push({ name: 'tool-media-library-library' })">回到资料库</button>
    </div>
  </div>
</template>
