<script setup lang="ts">
import { computed, inject } from 'vue'

const props = defineProps<{
  name: string | number
  title?: string
}>()

const group = inject<{ isOpen: (name: string | number) => boolean, toggle: (name: string | number) => void } | null>('uiCollapse', null)

const open = computed(() => group?.isOpen(props.name) ?? false)

function onHeaderKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    group?.toggle(props.name)
  }
}
</script>

<template>
  <div class="ui-collapse-item" :class="{ 'is-open': open }">
    <!-- header 用 div 而非 button:标题插槽里可能包含开关等交互控件 -->
    <div
      class="ui-collapse-header"
      role="button"
      tabindex="0"
      @click="group?.toggle(name)"
      @keydown="onHeaderKeydown"
    >
      <span class="ui-collapse-title">
        <slot name="title">{{ title }}</slot>
      </span>
      <span class="ui-collapse-caret" aria-hidden="true">▾</span>
    </div>
    <div v-show="open" class="ui-collapse-content">
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.ui-collapse-item {
  border-bottom: 1px solid var(--color-border-light);
}

.ui-collapse-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-xs);
  cursor: pointer;
  user-select: none;

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--color-primary-soft);
    border-radius: var(--radius-xs);
  }
}

.ui-collapse-title {
  flex: 1;
  min-width: 0;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
}

.ui-collapse-caret {
  color: var(--color-text-tertiary);
  font-size: 11px;
  transition: transform var(--transition-fast);
}

.is-open .ui-collapse-caret {
  transform: rotate(180deg);
}

.ui-collapse-content {
  padding: var(--spacing-sm) var(--spacing-xs) var(--spacing-lg);
}
</style>
