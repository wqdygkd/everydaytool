<script setup lang="ts">
// 通用按钮内核：原生 button。几何与状态色统一走设计令牌。
// 主按钮只承担当前工具的主要前进动作：墨蓝实底、白字、无渐变、无彩色光晕。
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  size?: 'small' | 'default' | 'large'
  /** info = 默认玻璃钮;primary / danger = 实底;success / warning 走对应语义实底 */
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'default'
  /** 文字模式：无底无边，hover 铺 fill */
  text?: boolean
  /** 链接模式：同 text 但按 type 上色 */
  link?: boolean
  /** 朴素模式：透明底 + 彩边彩字（type 有值时） */
  plain?: boolean
  /** loading 时按钮禁用并显示转圈 */
  loading?: boolean
  disabled?: boolean
  nativeType?: 'button' | 'submit' | 'reset'
}>(), {
  size: 'default',
  type: 'info',
  text: false,
  link: false,
  plain: false,
  loading: false,
  disabled: false,
  nativeType: 'button',
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const isDisabled = computed(() => props.disabled || props.loading)
</script>

<template>
  <button
    type="button"
    class="ui-button"
    :class="[`is-${type}`, `is-${size}`, { 'is-text': text, 'is-link': link, 'is-plain': plain }]"
    :disabled="isDisabled"
    @click="!isDisabled && emit('click', $event)"
  >
    <span v-if="loading" class="ui-button-spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped lang="scss">
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-button);
  color: var(--color-text-primary);
  font-family: inherit;
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast);

  &.is-small { height: 24px; padding: 0 11px; font-size: var(--font-size-sm); }
  &.is-default { height: var(--control-height); padding: 0 13px; font-size: var(--font-size-sm); }
  &.is-large { height: 38px; padding: 0 16px; font-size: var(--font-size-base); }

  &:hover:not(:disabled) {
    background: var(--color-button);
    border-color: var(--color-border);
  }

  &:active:not(:disabled) {
    background: var(--color-fill);
  }

  &.is-text,
  &.is-link {
    border: 0;
    background: transparent;
    box-shadow: none;

    &:hover:not(:disabled) { background: var(--color-fill); }
    &:active:not(:disabled) { background: color-mix(in oklab, var(--color-fill) 80%, #000); }
  }

  &.is-plain:not(.is-text):not(.is-link) {
    background: transparent;
    box-shadow: none;
    color: var(--color-text-primary);
  }

  &.is-primary.is-plain {
    border-color: var(--color-primary);
    color: var(--color-primary-strong);

    &:hover:not(:disabled) {
      background: var(--color-primary-strong);
      color: var(--color-on-solid);
    }
  }

  &.is-danger.is-plain {
    border-color: var(--color-error);
    color: var(--color-error);

    &:hover:not(:disabled) {
      background: var(--color-error);
      color: var(--color-on-solid);
    }
  }

  &.is-link {
    color: var(--color-text-secondary);

    &.is-primary { color: var(--color-primary-strong); }
    &.is-danger { color: var(--color-error); }
    &.is-success { color: var(--color-success); }
    &.is-warning { color: var(--color-warning); }
  }

  &.is-primary:not(.is-text):not(.is-link) {
    background: var(--color-primary-strong);
    border-color: var(--color-primary-strong);
    color: var(--color-on-solid);

    &:hover:not(:disabled) { background: color-mix(in oklab, var(--color-primary-strong) 86%, #000); }
    &:active:not(:disabled) { background: color-mix(in oklab, var(--color-primary-strong) 74%, #000); }
  }

  &.is-danger:not(.is-text):not(.is-link) {
    background: var(--color-error);
    border-color: var(--color-error);
    color: var(--color-on-solid);

    &:hover:not(:disabled) { background: color-mix(in oklab, var(--color-error) 86%, #000); }
  }

  &.is-success:not(.is-text):not(.is-link),
  &.is-warning:not(.is-text):not(.is-link) {
    color: var(--color-on-solid);
  }

  &.is-success:not(.is-text):not(.is-link) {
    background: var(--color-success);
    border-color: var(--color-success);
  }

  &.is-warning:not(.is-text):not(.is-link) {
    background: var(--color-warning);
    border-color: var(--color-warning);
  }

  &:disabled {
    color: var(--color-text-tertiary);
    cursor: not-allowed;
  }
}

.ui-button-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: ui-button-spin 0.8s linear infinite;
}

@keyframes ui-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
