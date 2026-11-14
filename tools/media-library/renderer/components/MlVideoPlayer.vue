<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import MlIcon from './MlIcon.vue'
import '@videojs/html/video/player'
import '@videojs/html/video/skin'

const props = defineProps<{
  src: string
  poster?: string | null
  title: string
  startAt?: number
}>()

const emit = defineEmits<{
  timeupdate: [payload: { position: number, duration: number }]
  metadata: [payload: { duration?: number, width?: number, height?: number }]
  external: []
}>()

const media = ref<HTMLVideoElement | null>(null)

function emitProgress(): void {
  const video = media.value
  if (!video || !Number.isFinite(video.currentTime)) return
  emit('timeupdate', {
    position: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
  })
}

function emitMetadata(): void {
  const video = media.value
  if (!video) return
  if (props.startAt && props.startAt > 0 && video.currentTime < 1) {
    video.currentTime = Math.min(props.startAt, Math.max(0, video.duration - 1))
  }
  emit('metadata', {
    duration: Number.isFinite(video.duration) ? video.duration : undefined,
    width: video.videoWidth || undefined,
    height: video.videoHeight || undefined,
  })
}

watch(() => props.src, () => {
  media.value?.pause()
  media.value?.load()
})

onBeforeUnmount(() => {
  const video = media.value
  if (!video) return
  emitProgress()
  video.pause()
  video.removeAttribute('src')
  video.load()
})
</script>

<template>
  <div class="video-player-shell">
    <video-player>
      <video-skin>
        <video
          ref="media"
          :src="src"
          :poster="poster || undefined"
          :aria-label="title"
          preload="metadata"
          playsinline
          @timeupdate="emitProgress"
          @loadedmetadata="emitMetadata"
          @durationchange="emitMetadata"
        >
          当前环境无法播放此视频。
        </video>
      </video-skin>
    </video-player>
    <button class="external-play" type="button" @click="emit('external')">
      <MlIcon name="external" :size="14" />
      外部播放
    </button>
  </div>
</template>

<style scoped lang="scss">
.video-player-shell,
video-player,
video-skin {
  display: block;
  width: 100%;
  height: 100%;
}

video-skin {
  --media-primary-color: var(--color-primary);
  --media-background-color: #070d13;
}

video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.external-play {
  position: absolute;
  z-index: 5;
  top: 10px;
  right: 10px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background: rgba(6, 12, 19, 0.68);
  color: rgba(244, 248, 252, 0.9);
  font-size: var(--font-size-xs);
  backdrop-filter: blur(8px);
}

.external-play:hover {
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
}
</style>
