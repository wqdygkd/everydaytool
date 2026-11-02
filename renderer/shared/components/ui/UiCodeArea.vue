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
    <!-- 文本域内核：原生 textarea。底 / 边 / 聚焦与全站输入框同一套令牌 -->
    <textarea
      v-model="value"
      class="ui-code-input"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      spellcheck="false"
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
  display: block;
  width: 100%;
  padding: var(--spacing-sm) 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-field);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  line-height: 1.6;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);

  &::placeholder { color: var(--color-text-tertiary); }

  &:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary) inset;
  }

  &:disabled {
    background: var(--color-fill);
    color: var(--color-text-tertiary);
    cursor: not-allowed;
  }
}

.ui-code-meta {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-xs);
}
</style>
