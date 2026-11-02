<script setup lang="ts">
import { ChevronDownIcon } from '@lucide/vue'
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'
// 下拉内核：Reka UI Select 原语 + 平台令牌样式。
// - 选项经 :options 传入,value 统一以字符串匹配,发射字符串
// - 数值型消费方(缓存配额 / 状态码)在自身 handler 里 Number() 转换
import { computed, useAttrs } from 'vue'

export interface UiSelectOption {
  label: string | number
  value: string | number
}

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue?: string | number
  options?: UiSelectOption[]
  placeholder?: string
  disabled?: boolean
  /** small = 24px 档 */
  size?: 'small' | 'default'
}>(), {
  modelValue: '',
  options: () => [],
  placeholder: undefined,
  disabled: false,
  size: 'default',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const attrs = useAttrs()

const selectedKey = computed(() =>
  props.modelValue === undefined || props.modelValue === null || props.modelValue === ''
    ? undefined
    : String(props.modelValue),
)

function onUpdate(value: string) {
  emit('update:modelValue', value)
}
</script>

<template>
  <SelectRoot
    :model-value="selectedKey"
    :disabled="disabled"
    @update:model-value="onUpdate"
  >
    <SelectTrigger
      v-bind="attrs"
      class="ui-select-trigger"
      :class="{ 'is-small': size === 'small' }"
    >
      <SelectValue :placeholder="placeholder" class="ui-select-value" />
      <SelectIcon as-child>
        <ChevronDownIcon :size="16" class="ui-select-caret" />
      </SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent :side-offset="4" position="popper" class="ui-select-content">
        <SelectViewport class="ui-select-viewport">
          <SelectItem
            v-for="option in options"
            :key="String(option.value)"
            :value="String(option.value)"
            class="ui-select-item"
          >
            <SelectItemText>{{ option.label }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style scoped lang="scss">
/* 触发器:与 UiInput 同一套令牌(边线 / 底 / 焦点环),高度分 default / small 两档 */
.ui-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  width: 100%;
  height: var(--control-height);
  min-width: 0;
  padding: 0 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-field);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-base);
  cursor: pointer;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);

  &:focus-visible {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary) inset;
  }

  &[data-disabled],
  &:disabled {
    background: var(--color-fill);
    color: var(--color-text-tertiary);
    cursor: not-allowed;
  }

  &.is-small {
    height: 24px;
    font-size: var(--font-size-sm);
  }
}

.ui-select-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-placeholder] {
    color: var(--color-text-tertiary);
  }
}

.ui-select-caret {
  flex: none;
  color: var(--color-text-tertiary);
}

/* 浮层:pop 角色(bg-pop)+ 阴影,popper 定位由 reka 处理 */
.ui-select-content {
  z-index: 2000;
  min-width: var(--reka-select-trigger-width);
  max-height: 320px;
  overflow: hidden;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-pop);
  box-shadow: var(--shadow-md);
}

.ui-select-viewport {
  max-height: 304px;
  padding: var(--spacing-xs);
  overflow-y: auto;
}

.ui-select-item {
  display: flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: var(--radius-xs);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-control);
  cursor: pointer;
  outline: none;
  user-select: none;

  &[data-highlighted] {
    background: var(--color-fill);
  }

  &[data-state='checked'] {
    color: var(--color-primary-strong);
    font-weight: var(--font-weight-medium);
  }

  &[data-disabled] {
    color: var(--color-text-tertiary);
    cursor: not-allowed;
  }
}
</style>
