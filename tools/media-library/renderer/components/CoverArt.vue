<script setup lang="ts">
import type { CollectionSummary } from '@shared/media-library'
import { computed, ref, watch } from 'vue'
import { countLabel } from '../format'
import { thumbUrl } from '../mediaUrls'
import { useMediaLibraryStore } from '../stores/mediaLibraryStore'
import PosterArt from './PosterArt.vue'
import StillArt from './StillArt.vue'

const props = withDefaults(defineProps<{
  collection: CollectionSummary
  small?: boolean
}>(), {
  small: false,
})

const store = useMediaLibraryStore()
const loaded = ref(false)
const src = computed(() => props.collection.coverItemId
  ? thumbUrl(store.endpoint, props.collection.id, props.collection.coverItemId, props.collection.coverVersion)
  : null)

watch(src, () => {
  loaded.value = false
})
</script>

<template>
  <div class="cover-art" :class="{ 'is-small': small }">
    <PosterArt
      v-if="collection.kind === 'video'"
      :id="collection.id"
      :title="collection.title"
      :year="collection.year"
      :artists="collection.artists"
      :show-title="!small"
      :show-foot="!small"
    />

    <div v-else-if="collection.kind === 'image'" class="mosaic m4">
      <StillArt v-for="seed in 4" :id="collection.id" :key="seed" :seed="seed - 1" />
      <div v-if="!small" class="cover-caption-strip">
        <span>{{ collection.title }}</span>
        <small>{{ countLabel(collection) }}</small>
      </div>
    </div>

    <div v-else class="split">
      <div class="split-main">
        <PosterArt
          :id="collection.id"
          :title="collection.title"
          :year="collection.year"
          :artists="collection.artists"
          :show-title="!small"
          :show-foot="false"
        />
      </div>
      <div class="split-quad">
        <StillArt v-for="seed in 4" :id="collection.id" :key="seed" :seed="seed + 3" />
      </div>
    </div>

    <img
      v-if="src"
      v-show="loaded"
      class="cover-image"
      :src="src"
      alt=""
      @load="loaded = true"
      @error="loaded = false"
    >
  </div>
</template>

<style scoped lang="scss">
.cover-image {
  position: absolute;
  z-index: 4;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
