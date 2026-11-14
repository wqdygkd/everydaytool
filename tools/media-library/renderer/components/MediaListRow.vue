<script setup lang="ts">
import type { CollectionSummary } from '@shared/media-library'
import { countLabel, displayArtist, formatAgo, formatBytes, KIND } from '../format'
import CoverArt from './CoverArt.vue'
import MlIcon from './MlIcon.vue'

const props = defineProps<{
  collection: CollectionSummary
}>()

const emit = defineEmits<{
  open: [collection: CollectionSummary]
}>()

function open(): void {
  emit('open', props.collection)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  open()
}
</script>

<template>
  <article
    class="list-row"
    tabindex="0"
    role="link"
    :aria-label="`打开合集 ${collection.title}`"
    @click="open"
    @keydown="onKeydown"
  >
    <div class="list-main">
      <div class="list-thumb">
        <CoverArt :collection="collection" small />
      </div>
      <div style="min-width: 0">
        <h4>{{ collection.title }}</h4>
        <p>{{ displayArtist(collection) }} · {{ collection.rootPath }}</p>
      </div>
    </div>
    <span class="list-cell">{{ KIND[collection.kind].label }}</span>
    <span class="list-cell">{{ countLabel(collection) }}</span>
    <span class="list-cell">{{ formatBytes(collection.bytes) }}</span>
    <span class="list-cell">{{ formatAgo(collection.lastScanAt) }}</span>
    <MlIcon name="chevronRight" :size="14" />
  </article>
</template>
