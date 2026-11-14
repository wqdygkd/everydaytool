<script setup lang="ts">
import { computed } from 'vue'
import { stillArtOf } from '../art'

const props = defineProps<{
  id: string
  seed: number
}>()

const art = computed(() => stillArtOf(props.id, props.seed))
</script>

<template>
  <div class="still" :data-m="art.motif" :data-v="art.variant" :style="art.style" aria-hidden="true">
    <i />
    <b />
  </div>
</template>
