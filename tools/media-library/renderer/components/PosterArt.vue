<script setup lang="ts">
import { computed } from 'vue'
import { paletteIndexOf, paletteVars, posterMotifOf } from '../art'

const props = withDefaults(defineProps<{
  id: string
  title: string
  year: string
  artists: string[]
  motif?: string
  showTitle?: boolean
  showFoot?: boolean
}>(), {
  motif: undefined,
  showTitle: true,
  showFoot: true,
})

const style = computed(() => paletteVars(paletteIndexOf(props.id)))
const resolvedMotif = computed(() => props.motif || posterMotifOf(props.id))
const foot = computed(() => [props.artists.join('、'), props.year].filter(Boolean).join(' · '))
</script>

<template>
  <div class="poster" :data-m="resolvedMotif" :style="style" aria-hidden="true">
    <i class="f1" />
    <i class="f2" />
    <i class="f3" />
    <span v-if="showFoot && foot" class="poster-foot">{{ foot }}</span>
    <strong v-if="showTitle" class="poster-title">{{ title }}</strong>
  </div>
</template>
