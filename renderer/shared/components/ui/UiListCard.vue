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
/* 列表卡片：白底细边浮岛，hover / 选中时用**当前工具的身份色**高亮
   （合并 chrome-sandbox 沙箱卡与环境卡两处重复）。hover 只提描边、选中才铺浅底：
   两种状态本来就不等价，颜色上分开之后「鼠标路过」不会再像「已经选中」。 */
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

  &:hover {
    border-color: color-mix(in srgb, var(--tool-accent) 45%, var(--color-border-light));
    box-shadow: inset 0 1px 0 var(--color-highlight), var(--shadow-sm);
  }

  &.is-active {
    border-color: color-mix(in srgb, var(--tool-accent) 70%, var(--color-border));
    background: color-mix(in srgb, var(--tool-accent) 8%, var(--color-raised));
    box-shadow: inset 0 1px 0 var(--color-highlight), var(--shadow-sm);
  }
}
</style>
