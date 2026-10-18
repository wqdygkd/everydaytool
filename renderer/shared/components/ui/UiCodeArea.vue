<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  rows?: number
  placeholder?: string
  disabled?: boolean
  /** 右下角元信息（如「128 字符」） */
  meta?: string
}>(), {
  rows: 8,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const value = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
})
</script>

<template>
  <div class="ui-code-area">
    <el-input
      v-model="value"
      class="ui-code-input"
      type="textarea"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
    />
    <div v-if="meta || $slots.meta" class="ui-code-meta">
      <slot name="meta">
        <span class="muted mono">{{ meta }}</span>
      </slot>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ui-code-area {
  min-width: 0;
}

.ui-code-input {
  :deep(textarea) {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }
}

.ui-code-meta {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-xs);
}
</style>
