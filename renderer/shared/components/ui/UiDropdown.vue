<script setup lang="ts">
import type { IconName } from './icons'
// 下拉菜单内核：Reka UI DropdownMenu。
// 菜单项由 items 声明,选择后 emit command;触发器用 #trigger 插槽。
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'

withDefaults(defineProps<{
  items: Array<{ command: string, label: string, icon?: IconName, danger?: boolean }>
}>(), {})

const emit = defineEmits<{
  command: [command: string]
}>()
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        class="ui-dropdown-content"
        :side-offset="4"
        align="end"
      >
        <DropdownMenuItem
          v-for="item in items"
          :key="item.command"
          class="ui-dropdown-item"
          :class="{ 'is-danger': item.danger }"
          @select="emit('command', item.command)"
        >
          <UiIcon v-if="item.icon" :name="item.icon" :size="14" class="ui-dropdown-icon" />
          <span>{{ item.label }}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style scoped lang="scss">
.ui-dropdown-content {
  z-index: 2000;
  min-width: 140px;
  padding: var(--spacing-xs);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-pop);
  box-shadow: var(--shadow-md);
}

.ui-dropdown-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 7px 10px;
  border-radius: var(--radius-xs);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  outline: none;

  &:hover,
  &[data-highlighted] {
    background: var(--color-fill);
  }

  &.is-danger {
    color: var(--color-error);
  }
}

.ui-dropdown-icon {
  color: var(--color-text-secondary);
}
</style>
