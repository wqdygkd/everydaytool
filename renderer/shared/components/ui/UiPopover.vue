<script setup lang="ts">
// 气泡卡内核：Reka UI Popover。
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

withDefaults(defineProps<{
  visible: boolean
  width?: string | number
  /** 透传到 teleport 后的内容层，供调用方做局部布局。 */
  contentClass?: string
}>(), {
  width: 320,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()
</script>

<template>
  <PopoverRoot :open="visible" @update:open="emit('update:visible', $event)">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="ui-popover-content"
        :class="contentClass"
        :side-offset="4"
        align="end"
        :style="{ width: typeof width === 'number' ? `${width}px` : width }"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped lang="scss">
.ui-popover-content {
  z-index: 2000;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-pop);
  box-shadow: var(--shadow-md);
}
</style>
