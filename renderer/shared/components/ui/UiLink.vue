<script setup lang="ts">
// 文字链接内核：原生 <a>。underline 仅保持 API 兼容（本站链接恒无下划线）。
withDefaults(defineProps<{
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  underline?: boolean
  href?: string
}>(), {
  type: 'info',
  underline: true,
  href: undefined,
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<template>
  <a
    class="ui-link"
    :class="`is-${type}`"
    :href="href"
    @click="emit('click', $event)"
  >
    <slot />
  </a>
</template>

<style scoped lang="scss">
.ui-link {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  text-decoration: none;
  transition: color var(--transition-fast);

  &:hover { text-decoration: underline; }

  &.is-primary { color: var(--color-primary-strong); }
  &.is-danger { color: var(--color-error); }
  &.is-success { color: var(--color-success); }
  &.is-warning { color: var(--color-warning); }
}
</style>
