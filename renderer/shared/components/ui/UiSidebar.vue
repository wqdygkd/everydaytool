<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  /** subdued = 次级小标题（列表类侧栏）；emphasis = 强调标题 */
  titleTone?: 'subdued' | 'emphasis'
  width?: string
  padding?: string
}>(), {
  titleTone: 'subdued',
  width: '252px',
  padding: 'var(--spacing-xl) var(--spacing-md)',
})
</script>

<template>
  <aside class="ui-sidebar" :class="`is-title-${titleTone}`" :style="{ width, padding }">
    <header v-if="title || $slots.title || $slots.actions" class="ui-sidebar-header">
      <div class="ui-sidebar-title">
        <slot name="title">
          {{ title }}
        </slot>
      </div>
      <div v-if="$slots.actions" class="ui-sidebar-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="ui-sidebar-body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="ui-sidebar-footer btn-flush">
      <slot name="footer" />
    </footer>
  </aside>
</template>

<style scoped lang="scss">
.ui-sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  border-right: 1px solid var(--color-border-light);
  background: color-mix(in srgb, var(--color-surface-raised) 92%, transparent);
  backdrop-filter: blur(12px);
}

.ui-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
  flex-shrink: 0;
}

.ui-sidebar-title {
  min-width: 0;

  .is-title-subdued & {
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }

  .is-title-emphasis & {
    color: var(--color-text-primary);
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
  }
}

.ui-sidebar-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}

/*  Body 自身不滚动：由slot 内容里的列表容器自行管理 flex/overflow（各工具侧栏结构不同） */
.ui-sidebar-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.ui-sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
  flex-shrink: 0;
}
</style>
