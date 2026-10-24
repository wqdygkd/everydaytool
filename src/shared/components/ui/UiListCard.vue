<script setup lang="ts">
defineProps<{
  active?: boolean
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<template>
  <div
    class="ui-list-card"
    :class="{ 'is-active': active }"
    role="button"
    tabindex="0"
    @click="emit('click', $event)"
    @keydown.enter="emit('click', $event as unknown as MouseEvent)"
    @keydown.space.prevent="emit('click', $event as unknown as MouseEvent)"
  >
    <slot />
  </div>
</template>

<style scoped lang="scss">
/* 列表卡片：白底细边浮岛，hover / 选中时品牌色高亮（合并 chrome-sandbox 沙箱卡与环境卡两处重复） */
.ui-list-card {
  padding: var(--spacing-md) var(--spacing-lg);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-raised);
  /* 玻璃：列表卡片是 raised 表面（不透明窗口下为 none）；顶部高光同卡片（不透明模式为透明） */
  backdrop-filter: var(--glass-raised);
  box-shadow: inset 0 1px 0 var(--color-highlight);
  cursor: pointer;
  transition:
    border-color var(--transition-base),
    background var(--transition-base),
    box-shadow var(--transition-base);

  &:hover,
  &.is-active {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
    box-shadow: inset 0 1px 0 var(--color-highlight), var(--shadow-sm);
  }
}
</style>
