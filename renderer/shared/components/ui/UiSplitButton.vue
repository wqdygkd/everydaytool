<script setup lang="ts">
import type { IconName } from './icons'

// 分裂按钮：左半执行主操作（下载 / 打开），右半是同一对象的次要动作（复制链接）。
// 只做组合与交互编排：视觉内核沿用 --color-button / --color-border / --radius-control，
// 不复制 UiButton 的实底与语义色。用于「一行一个动作 + 一个伴随操作」的密集列表。
withDefaults(defineProps<{
  /** 左半按钮文案 */
  label: string
  /** 左半 tooltip / aria-label */
  title?: string
  /** 右半图标按钮的 tooltip / aria-label */
  copyTitle?: string
  /** 左半图标 */
  icon?: IconName
  /** 右半图标 */
  actionIcon?: IconName
  disabled?: boolean
  /** 标记推荐项（只做视觉区分，不改变行为） */
  recommended?: boolean
  size?: 'small' | 'default'
}>(), {
  title: undefined,
  copyTitle: '复制链接',
  icon: 'download',
  actionIcon: 'copy',
  disabled: false,
  recommended: false,
  size: 'small',
})

const emit = defineEmits<{
  click: []
  copy: []
}>()
</script>

<template>
  <div
    class="ui-split-button"
    :class="[`is-${size}`, { 'is-recommended': recommended, 'is-disabled': disabled }]"
  >
    <button
      type="button"
      class="split-main"
      :title="title || label"
      :aria-label="title || label"
      :disabled="disabled"
      @click="emit('click')"
    >
      <UiIcon :name="icon" :size="size === 'small' ? 12 : 14" />
      <span class="split-label">{{ label }}</span>
      <span v-if="recommended" class="split-badge">推荐</span>
    </button>
    <button
      type="button"
      class="split-copy"
      :title="copyTitle"
      :aria-label="copyTitle"
      @click="emit('copy')"
    >
      <UiIcon :name="actionIcon" :size="size === 'small' ? 12 : 14" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.ui-split-button {
  display: inline-flex;
  align-items: stretch;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-button);
  transition: border-color var(--transition-fast);

  &:hover {
    border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
  }

  &.is-recommended {
    border-color: color-mix(in srgb, var(--color-primary) 26%, var(--color-border));
  }
}

.split-main,
.split-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: var(--font-size-xs);
  line-height: 1;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);

  &:hover:not(:disabled) {
    background: var(--color-fill);
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
}

.is-small .split-main,
.is-small .split-copy {
  height: 24px;
}

.is-default .split-main,
.is-default .split-copy {
  height: var(--control-height);
  font-size: var(--font-size-sm);
}

.split-main {
  gap: 4px;
  padding: 0 var(--spacing-sm);
}

.is-default .split-main {
  padding: 0 var(--spacing-md);
}

.split-label {
  white-space: nowrap;
}

.split-badge {
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  line-height: 16px;
}

.split-copy {
  width: 24px;
  border-left: 1px solid var(--color-border);
}

.is-default .split-copy {
  width: var(--control-height);
}

/* 禁用只降对比，不给容器写 opacity（DESIGN §4.3） */
.split-main:disabled {
  color: var(--color-text-tertiary);
  cursor: not-allowed;
}
</style>
