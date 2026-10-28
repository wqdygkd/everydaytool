<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  /** 单行文案（旧的用法；需要「标题 + 说明 + 按钮」时用 #title / 默认插槽 / #actions） */
  text?: string
  /** 一级文案：这块区域是什么（空态里最该先读到的一句） */
  title?: string
  /** bordered = 虚线框；plain = 无边框纯文本 */
  variant?: 'plain' | 'bordered'
  /** 居中排布（图标在上文字在下） */
  center?: boolean
  icon?: string
  padding?: string
}>(), {
  variant: 'plain',
})

// bordered 未显式传 padding 时用默认内边距；plain 默认无内边距
const pad = computed(() => props.padding ?? (props.variant === 'bordered' ? 'var(--spacing-xl) var(--spacing-lg)' : '0'))
</script>

<template>
  <div
    class="ui-empty"
    :class="[`is-${variant}`, { 'is-center': center, 'has-title': !!title || !!$slots.title }]"
    :style="{ padding: pad }"
  >
    <UiIcon v-if="icon" :name="(icon as any)" :size="20" class="ui-empty-icon" />
    <div class="ui-empty-body">
      <p v-if="title || $slots.title" class="ui-empty-title">
        <slot name="title">
          {{ title }}
        </slot>
      </p>
      <div class="ui-empty-text">
        <slot>
          {{ text }}
        </slot>
      </div>
      <div v-if="$slots.actions" class="ui-empty-actions">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ui-empty {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);

  &.is-bordered {
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-raised);
  }

  &.is-center {
    flex-direction: column;
    justify-content: center;
    text-align: center;
  }

  /* 有图标时图标与文字间保留间距（无图标不引入 gap，避免干扰 slot 自定义排版） */
  &.is-center:has(.ui-empty-icon) {
    gap: var(--spacing-sm);
  }
}

.ui-empty-icon {
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.ui-empty-body {
  min-width: 0;
}

/* 空态三件套：这块是什么（标题）→ 为什么值得建（说明）→ 现在就能做的一步（按钮）。
   说明按阅读宽度收口，长解释不会在宽面板里拉成一整行。 */
.ui-empty-title {
  margin: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  line-height: 1.5;
}

.ui-empty-text {
  min-width: 0;
  line-height: 1.5;

  /* 只有文案、没有标题时（表格空态等），保持原来的紧凑单行观感 */
  .ui-empty:not(.has-title) & {
    display: inline;
  }
}

.ui-empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);

  .is-center & {
    justify-content: center;
  }
}

.ui-empty-body > .ui-empty-text:not(:first-child) {
  margin-top: var(--spacing-xs);
  max-width: var(--measure-prose);
}

.is-center .ui-empty-body {
  max-width: var(--measure-prose);
}
</style>
