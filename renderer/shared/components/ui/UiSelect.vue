<script setup lang="ts">
import { CheckIcon, ChevronDownIcon } from '@lucide/vue'
import { useVModel } from '@vueuse/core'
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
import { useToolOverlayTarget, useToolPaneActive } from './overlay-target'

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

const modelValue = useVModel(props, 'modelValue', emit)

const attrs = useAttrs()

const open = ref(false)
const portalTarget = useToolOverlayTarget()
const paneActive = useToolPaneActive()

watch(paneActive, (active) => {
  if (!active) open.value = false
})

// Reka 用空字符串表示「未选择」，不能作为 SelectItem.value。
// 消费方确实需要空值选项时（如身份证的「随机全国」）在组件内核换成内部哨兵，
// 对外仍只发射原始空字符串，占位符语义保持不变。
const EMPTY_OPTION_VALUE = '__edt_select_empty__'

const normalizedOptions = computed(() => props.options.map((option) => {
  const value = String(option.value)
  return {
    ...option,
    key: value === '' ? EMPTY_OPTION_VALUE : value,
  }
}))

const hasEmptyOption = computed(() => props.options.some(option => String(option.value) === ''))

const selectedKey = computed(() => {
  if (modelValue.value === undefined || modelValue.value === null) return undefined
  const value = String(modelValue.value)
  if (value === '') return hasEmptyOption.value ? EMPTY_OPTION_VALUE : undefined
  return value
})

function onUpdate(value: string) {
  modelValue.value = value === EMPTY_OPTION_VALUE ? '' : value
}
</script>

<template>
  <SelectRoot
    v-model:open="open"
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
    <SelectPortal :to="portalTarget">
      <SelectContent :side-offset="4" position="popper" class="ui-select-content">
        <SelectViewport class="ui-select-viewport">
          <SelectItem
            v-for="option in normalizedOptions"
            :key="option.key"
            :value="option.key"
            class="ui-select-item"
          >
            <span class="ui-select-check" aria-hidden="true">
              <CheckIcon :size="13" />
            </span>
            <SelectItemText class="ui-select-option-label">
              {{ option.label }}
            </SelectItemText>
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
  border-radius: var(--radius-control);
  background: var(--color-field);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);

  &:focus-visible {
    outline: none;
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 12%, transparent);
  }

  &:hover:not(:disabled, [data-disabled]) {
    border-color: var(--color-border);
    background: color-mix(in srgb, var(--color-field) 82%, var(--color-on-solid));
  }

  &[data-state='open'] {
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 12%, transparent);
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

  &[data-state='open'] .ui-select-caret {
    transform: rotate(180deg);
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
  transition: transform var(--transition-fast);
}

/* SelectContent 由 Reka Portal 到 body，拿不到 SFC scopeId；
   pop 表面必须用 global 选择器，否则会退化成透明无边框的裸列表。 */
:global(.ui-select-content) {
  z-index: 2100;
  width: max(var(--reka-select-trigger-width), 220px);
  max-width: min(360px, var(--reka-select-content-available-width));
  max-height: min(320px, var(--reka-select-content-available-height));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-border) 72%, transparent);
  border-radius: var(--radius-lg);
  background: var(--color-pop);
  backdrop-filter: var(--glass-pop);
  box-shadow: var(--shadow-md);
  overscroll-behavior: contain;
}

:global(.ui-select-viewport) {
  padding: 5px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ui-select-item {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  padding: 7px 10px 7px 8px;
  border-radius: 7px;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-control);
  cursor: pointer;
  outline: none;
  user-select: none;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);

  /* Listbox 的可键盘焦点由 data-highlighted 底色表达；
     全局 [role=option]:focus-visible 的按钮式外环会让下拉项像第二个输入框。 */
  &:focus-visible {
    box-shadow: none;
  }

  &[data-highlighted] {
    background: var(--color-fill);
  }

  &[data-state='checked'] {
    background: var(--color-primary-soft);
    color: var(--color-text-primary);
    font-weight: var(--font-weight-medium);
  }

  &[data-state='checked'][data-highlighted] {
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  }

  &[data-disabled] {
    color: var(--color-text-tertiary);
    cursor: not-allowed;
  }
}

.ui-select-check {
  display: grid;
  place-items: center;
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--color-primary-strong);
  opacity: 0;
  transform: scale(0.82);
  transition:
    opacity var(--transition-fast),
    transform var(--transition-fast);
}

.ui-select-item[data-state='checked'] .ui-select-check {
  opacity: 1;
  transform: scale(1);
}

.ui-select-option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
