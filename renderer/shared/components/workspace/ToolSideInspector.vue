<script setup lang="ts">
withDefaults(defineProps<{
  open: boolean
  title: string
  width?: 268 | 320 | 360
  side?: 'left' | 'right'
  closable?: boolean
  bodyPadding?: string
}>(), {
  width: 320,
  side: 'right',
  closable: true,
  bodyPadding: '14px',
})

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <aside
    v-if="open"
    class="tool-inspector"
    :class="`is-${side}`"
    :style="{ '--inspector-width': `${width}px` }"
    aria-label="工具详情"
  >
    <header class="inspector-head">
      <span>{{ title }}</span>
      <div class="inspector-actions">
        <slot name="actions" />
        <UiIconButton
          v-if="closable"
          icon="close"
          :size="28"
          label="收起详情"
          @click="emit('close')"
        />
      </div>
    </header>
    <div class="inspector-body" :style="{ padding: bodyPadding }">
      <slot />
    </div>
  </aside>
</template>

<style scoped lang="scss">
.tool-inspector {
  display: flex;
  flex: 0 0 var(--inspector-width);
  flex-direction: column;
  width: var(--inspector-width);
  min-height: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-on-solid) 58%, var(--color-border-light));
  border-radius: var(--radius-lg);
  background: var(--color-raised);
  backdrop-filter: var(--glass-raised);
  box-shadow: inset 0 1px 0 var(--color-highlight);
}

.tool-inspector.is-left {
  order: -1;
}

.inspector-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  flex: 0 0 47px;
  height: 47px;
  padding: 0 9px 0 14px;
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.inspector-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.inspector-body {
  flex: 1;
  min-height: 0;
  padding: 14px;
  overflow: auto;
}
</style>
