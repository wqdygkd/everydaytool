<script setup lang="ts">
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'
// 滑块内核：Reka UI Slider（单值 / 双值 range 均支持）。
import { computed } from 'vue'

withDefaults(defineProps<{
  min?: number
  max?: number
  step?: number
}>(), {
  min: 0,
  max: 100,
  step: 1,
})

const modelValue = defineModel<number | number[]>({ required: true })

const isRange = computed(() => Array.isArray(modelValue.value))
const values = computed(() => Array.isArray(modelValue.value) ? modelValue.value : [modelValue.value])

function onChange(next: number[] | undefined) {
  if (!next) {
    return
  }
  modelValue.value = isRange.value ? next : next[0]
}
</script>

<template>
  <SliderRoot
    class="ui-slider"
    :model-value="values"
    :min="min"
    :max="max"
    :step="step"
    @update:model-value="onChange"
  >
    <SliderTrack class="ui-slider-track">
      <SliderRange class="ui-slider-fill" />
      <SliderThumb v-for="(_, i) in values" :key="i" class="ui-slider-thumb" />
    </SliderTrack>
  </SliderRoot>
</template>

<style scoped lang="scss">
.ui-slider {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 20px;
  touch-action: none;
  user-select: none;
}

.ui-slider-track {
  position: relative;
  height: 6px;
  width: 100%;
  border-radius: 999px;
  background: var(--color-fill);
}

.ui-slider-fill {
  position: absolute;
  height: 100%;
  border-radius: 999px;
  background: var(--color-primary);
}

.ui-slider-thumb {
  top: 50%;
  display: block;
  width: 16px;
  height: 16px;
  margin-top: -8px;
  border-radius: 50%;
  background: var(--color-on-solid);
  border: 2px solid var(--color-primary);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  cursor: grab;

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--color-primary-soft);
  }
}
</style>
