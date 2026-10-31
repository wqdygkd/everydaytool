<script setup lang="ts">
import { useCopy } from '../../composables/useClipboard'

const props = withDefaults(defineProps<{
  /** 待复制的文本 */
  text: string
  /** 复制成功提示中的内容名，如「路径」 */
  label?: string
  size?: 'small' | 'default' | 'large'
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  /** 文字按钮模式（默认图标按钮） */
  textButton?: boolean
}>(), {
  size: 'small',
  type: 'info',
  textButton: false,
})

const emit = defineEmits<{
  copied: []
}>()

async function onClick() {
  const ok = await useCopy(props.text, props.label)
  if (ok) emit('copied')
}
</script>

<template>
  <button
    v-if="textButton"
    type="button"
    class="ui-copy-btn is-text"
    :class="[`is-${type}`, `is-${size}`]"
    @click="onClick"
  >
    <UiIcon name="copy" :size="13" />
    <span>复制</span>
  </button>
  <button
    v-else
    type="button"
    class="ui-copy-btn"
    :class="[`is-${type}`, `is-${size}`]"
    :aria-label="`复制${label}`"
    @click="onClick"
  >
    <UiIcon name="copy" :size="13" />
  </button>
</template>

<style scoped lang="scss">
/* 按钮内核：EP → 原生 button。几何与状态色复刻 element-plus.scss 的全站绑定 */
.ui-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-xs);
  border: 1px solid color-mix(in oklab, var(--color-border) 65%, transparent);
  border-radius: var(--radius-control);
  background: color-mix(in oklab, var(--color-button) 80%, transparent);
  color: var(--color-text-primary);
  font-family: inherit;
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);

  &.is-small { height: 24px; padding: 0 11px; font-size: var(--font-size-sm); }
  &.is-default { height: var(--control-height); padding: 0 15px; font-size: var(--font-size-base); }
  &.is-large { height: 40px; padding: 0 19px; font-size: var(--font-size-base); }

  &:hover {
    background: var(--color-button);
    border-color: var(--color-border);
  }

  &:active {
    background: var(--color-fill);
  }

  &.is-text {
    border: 0;
    background: transparent;

    &:hover { background: var(--color-fill); }
    &:active { background: color-mix(in oklab, var(--color-fill) 80%, #000); }
  }

  &.is-primary:not(.is-text) {
    background: var(--color-primary-strong);
    background-image: linear-gradient(135deg, color-mix(in oklab, var(--color-primary-strong) 78%, #4d8dff) 0%, var(--color-primary-strong) 100%);
    border-color: var(--color-primary-strong);
    color: var(--color-on-solid);
    box-shadow: 0 4px 14px rgba(88, 145, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.28);

    &:hover { background: color-mix(in oklab, var(--color-primary-strong) 86%, #000); }
    &:active { background: color-mix(in oklab, var(--color-primary-strong) 74%, #000); }
  }

  &.is-danger:not(.is-text) {
    background: var(--color-error);
    border-color: var(--color-error);
    color: var(--color-on-solid);

    &:hover { background: color-mix(in oklab, var(--color-error) 86%, #000); }
  }

  &.is-primary.is-text {
    color: var(--color-primary-strong);
  }

  &:disabled {
    color: var(--color-text-tertiary);
    cursor: not-allowed;
  }
}
</style>
