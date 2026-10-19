<script setup lang="ts">
withDefaults(defineProps<{
  /** 面板标题（也可用 #title 插槽传入自定义内容） */
  title?: string
  /** raised = 浮岛卡片；outlined = 描边分区块 */
  variant?: 'raised' | 'outlined'
  /** 内边距，传空字符串为无内边距 */
  padding?: string
  titleSize?: 'sm' | 'lg'
  shadow?: 'sm' | 'md'
}>(), {
  variant: 'raised',
  padding: 'var(--spacing-lg)',
  titleSize: 'sm',
  shadow: 'sm',
})
</script>

<template>
  <section
    class="ui-panel"
    :class="[
      `is-${variant}`,
      `is-title-${titleSize}`,
      `is-shadow-${shadow}`,
    ]"
    :style="padding ? { padding } : undefined"
  >
    <header v-if="title || $slots.title || $slots.actions" class="ui-panel-header">
      <div class="ui-panel-title">
        <slot name="title">
          {{ title }}
        </slot>
      </div>
      <div v-if="$slots.actions" class="ui-panel-actions">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>

<style scoped lang="scss">
.ui-panel {
  min-width: 0;

  &.is-raised {
    background: var(--color-raised);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-lg);
  }

  &.is-raised.is-shadow-sm {
    box-shadow: var(--shadow-sm);
  }

  &.is-raised.is-shadow-md {
    box-shadow: var(--shadow-md);
  }

  &.is-outlined {
    background: var(--color-raised);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-lg);
  }
}

.ui-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--color-border-light);
}

.ui-panel-title {
  min-width: 0;
  font-weight: var(--font-weight-semibold);

  .is-title-sm & {
    font-size: var(--font-size-base);
  }

  .is-title-lg & {
    font-size: var(--font-size-lg);
  }
}

.ui-panel-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}
</style>
