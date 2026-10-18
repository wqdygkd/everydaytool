<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  disabled?: boolean
  align?: 'center' | 'start'
}>(), {
  align: 'center',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const value = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})
</script>

<template>
  <div class="ui-switch-field" :class="`is-align-${align}`">
    <el-switch v-model="value" :disabled="disabled" />
    <span v-if="$slots.default" class="ui-switch-hint">
      <slot />
    </span>
  </div>
</template>

<style scoped lang="scss">
.ui-switch-field {
  display: flex;
  gap: var(--spacing-sm);

  &.is-align-center {
    align-items: center;
  }

  &.is-align-start {
    align-items: flex-start;
  }
}

.ui-switch-hint {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}
</style>
