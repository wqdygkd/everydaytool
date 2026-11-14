<script setup lang="ts">
import type { MediaEndpoint, MediaItem } from '@shared/media-library'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatBytes } from '../format'
import { fileUrl, thumbUrl } from '../mediaUrls'
import MlIcon from './MlIcon.vue'

const props = defineProps<{
  collectionId: string
  title: string
  items: MediaItem[]
  index: number
  endpoint: MediaEndpoint | null
}>()

const emit = defineEmits<{
  close: []
  change: [index: number]
}>()

const failed = ref(false)
const safeIndex = computed(() => Math.max(0, Math.min(props.items.length - 1, props.index)))
const current = computed(() => props.items[safeIndex.value])
const src = computed(() => {
  if (!current.value) return ''
  return (failed.value ? thumbUrl(props.endpoint, props.collectionId, current.value.id) : fileUrl(props.endpoint, props.collectionId, current.value.id)) || ''
})
const nearby = computed(() => {
  const start = Math.max(0, safeIndex.value - 3)
  const end = Math.min(props.items.length, safeIndex.value + 4)
  return props.items.slice(start, end).map((item, offset) => ({ item, index: start + offset }))
})

watch(current, () => {
  failed.value = false
})

function move(delta: number): void {
  const next = safeIndex.value + delta
  if (next >= 0 && next < props.items.length) emit('change', next)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
  else if (event.key === 'ArrowLeft') move(-1)
  else if (event.key === 'ArrowRight') move(1)
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="lightbox" role="dialog" aria-modal="true" aria-label="图片查看器">
    <div class="lb-head">
      <div class="lb-title">
        <b>{{ title }}</b>
        <span>{{ safeIndex + 1 }} / {{ items.length }}</span>
      </div>
      <button class="icon-btn" type="button" aria-label="关闭图片查看器" @click="emit('close')">
        <MlIcon name="close" :size="16" />
      </button>
    </div>

    <div v-if="current" class="lb-stage">
      <button class="lb-nav prev" type="button" :disabled="safeIndex === 0" aria-label="上一张" @click="move(-1)">
        <MlIcon name="arrowLeft" :size="18" />
      </button>
      <div
        class="lb-frame"
        :style="{ aspectRatio: `${current.width || 16} / ${current.height || 10}`, width: `min(100%, ${(current.width || 1600) / 2}px)` }"
      >
        <img :src="src" :alt="current.name" @error="failed = true">
      </div>
      <button class="lb-nav next" type="button" :disabled="safeIndex === items.length - 1" aria-label="下一张" @click="move(1)">
        <MlIcon name="arrowRight" :size="18" />
      </button>
    </div>

    <div v-if="current" class="lb-foot">
      <div class="lb-caption">
        <span>{{ current.name }}</span>
        <span v-if="current.width && current.height">{{ current.width }} × {{ current.height }}</span>
        <span>{{ formatBytes(current.size) }}</span>
      </div>
      <div class="lb-strip">
        <button
          v-for="entry in nearby"
          :key="entry.item.id"
          class="lb-thumb"
          :class="{ active: entry.index === safeIndex }"
          type="button"
          :aria-label="`查看第 ${entry.index + 1} 张`"
          @click="emit('change', entry.index)"
        >
          <img
            :src="thumbUrl(endpoint, collectionId, entry.item.id) || ''"
            :alt="entry.item.name"
          >
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
:global(.ml .lightbox) { z-index: 80; }

.lb-frame img,
.lb-thumb img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

.lb-thumb img { object-fit: cover; }

.lb-nav:disabled {
  visibility: hidden;
}
</style>
