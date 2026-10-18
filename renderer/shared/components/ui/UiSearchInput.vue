<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  placeholder?: string
  /** pill = 胶囊搜索框（HomePage 同款）；box = 方形输入框（规则面板同款） */
  variant?: 'pill' | 'box'
  width?: string
  clearable?: boolean
  size?: number
  /** 像 v-model.trim 一样自动去除首尾空白 */
  trim?: boolean
}>(), {
  variant: 'pill',
  clearable: false,
  trim: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'enter': [value: string]
}>()

const value = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', props.trim ? v.trim() : v),
})

/** pill 图标 18px 重笔画；box 图标 14px 默认笔画 */
const iconSize = computed(() => props.size ?? (props.variant === 'pill' ? 18 : 14))

function onEnter() {
  emit('enter', props.modelValue)
}

function onEsc() {
  if (props.clearable && props.modelValue) {
    emit('update:modelValue', '')
  }
}
</script>

<template>
  <el-input
    v-model="value"
    :class="variant === 'pill' ? 'ui-search-pill' : 'ui-search-box'"
    :style="width ? { width } : undefined"
    :placeholder="placeholder"
    :clearable="clearable"
    @keydown.enter="onEnter"
    @keydown.esc="onEsc"
  >
    <template #prefix>
      <UiIcon name="search" :size="iconSize" :stroke-width="variant === 'pill' ? 2 : undefined" />
    </template>
  </el-input>
</template>

<style scoped lang="scss">
/* 圆角搜索框：白底浮岛，聚焦橙框 */
.ui-search-pill {
  :deep(.el-input__wrapper) {
    height: 42px;
    padding: 0 var(--spacing-lg);
    border-radius: 14px;
    background: var(--color-surface-raised);
    box-shadow: 0 0 0 2px var(--color-border-light) inset;

    &:hover {
      box-shadow: 0 0 0 2px var(--color-border) inset;
    }

    &.is-focus {
      box-shadow: 0 0 0 2px var(--color-primary) inset;
    }
  }

  /* 边框/聚焦/占位符色由 main.scss 全局绑定，此处只补图标色 */
  :deep(.el-input__prefix),
  :deep(.el-input__suffix) {
    color: var(--color-text-secondary);
  }
}

.ui-search-box {
  :deep(.el-input__wrapper) {
    height: var(--control-height);
    padding: 0 var(--spacing-md);
    border-radius: var(--radius-xs);
  }

  :deep(.el-input__inner) {
    font-size: var(--font-size-sm);
  }

  :deep(.el-input__prefix) {
    color: var(--color-text-secondary);
  }
}
</style>
