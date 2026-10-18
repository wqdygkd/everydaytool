<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  disabled?: boolean
  mono?: boolean
}>(), {})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const value = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
})
</script>

<template>
  <div class="ui-path-field">
    <el-input
      v-model="value"
      class="ui-path-input"
      :class="{ 'is-mono': mono }"
      :placeholder="placeholder"
      :disabled="disabled"
    >
      <template v-if="$slots.prepend" #prepend>
        <slot name="prepend" />
      </template>
    </el-input>
    <span v-if="$slots.actions" class="ui-path-actions">
      <slot name="actions" />
    </span>
  </div>
</template>

<style scoped lang="scss">
.ui-path-field {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  min-width: 0;

  .ui-path-input {
    flex: 1;
    min-width: 0;

    &.is-mono :deep(.el-input__inner) {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: var(--font-size-sm);
    }
  }
}

.ui-path-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}
</style>
