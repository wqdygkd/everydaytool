<script setup lang="ts">
import type { CollectionSummary } from '@shared/media-library'
import { collectionNeeds } from '@shared/media-library'
import { computed } from 'vue'
import { captionLine, countLabel, KIND } from '../format'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'
import CoverArt from './CoverArt.vue'
import MlIcon from './MlIcon.vue'

const props = defineProps<{
  collection: CollectionSummary
  seriesId?: string
}>()

const emit = defineEmits<{
  'open': [collection: CollectionSummary]
  'play': [collection: CollectionSummary]
  'edit': [collection: CollectionSummary]
  'remove-from-series': [seriesId: string, collection: CollectionSummary]
}>()

const store = useMediaLibraryStore()
const needsReview = computed(() => collectionNeeds(props.collection).length > 0)
const progress = computed(() => store.progressRatio(props.collection))
const visibleTags = computed(() => props.collection.tags.slice(0, 2))
const hiddenTagCount = computed(() => Math.max(0, props.collection.tags.length - visibleTags.value.length))

function open(): void {
  emit('open', props.collection)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  open()
}

function removeFromSeries(): void {
  // 公共事件名沿用预览与系列视图约定。
  // eslint-disable-next-line vue/custom-event-name-casing
  if (props.seriesId) emit('remove-from-series', props.seriesId, props.collection)
}
</script>

<template>
  <article
    class="media-card"
    tabindex="0"
    role="link"
    :aria-label="`打开合集 ${collection.title}`"
    @click="open"
    @keydown="onKeydown"
  >
    <div class="card-cover">
      <CoverArt :collection="collection" />
      <span class="kind-chip">
        <MlIcon :name="KIND[collection.kind].icon" :size="11" />
        {{ KIND[collection.kind].label }}
      </span>
      <span class="count-chip">{{ countLabel(collection) }}</span>
      <span v-if="needsReview" class="review-chip">
        <MlIcon name="warning" :size="11" />
        待完善
      </span>
      <div class="card-quick">
        <button
          type="button"
          class="quick-btn"
          :aria-label="`播放 ${collection.title}`"
          @click.stop="emit('play', collection)"
        >
          <MlIcon name="play" :size="13" />
        </button>
        <button
          type="button"
          class="quick-btn"
          :aria-label="`编辑 ${collection.title}`"
          @click.stop="emit('edit', collection)"
        >
          <MlIcon name="edit" :size="13" />
        </button>
        <button
          v-if="seriesId"
          type="button"
          class="quick-btn"
          :aria-label="`从系列移除 ${collection.title}`"
          title="从系列移除"
          @click.stop="removeFromSeries"
        >
          <MlIcon name="close" :size="13" />
        </button>
      </div>
      <div v-if="progress > 0" class="card-progress">
        <i :style="{ width: `${Math.round(progress * 100)}%` }" />
      </div>
    </div>
    <div class="card-caption">
      <h4>{{ collection.title }}</h4>
      <p>{{ captionLine(collection) }}</p>
      <div class="tag-row">
        <span v-for="tag in visibleTags" :key="tag" class="tag">{{ tag }}</span>
        <span v-if="hiddenTagCount" class="tag more">+{{ hiddenTagCount }}</span>
        <span v-if="!collection.tags.length" class="tag tag-empty">未加标签</span>
      </div>
    </div>
  </article>
</template>
