<script setup lang="ts">
withDefaults(defineProps<{
  icon?: string
  label?: string
  size?: number
}>(), {
  icon: 'gear',
  size: 48,
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<template>
  <button
    type="button"
    class="ui-fab"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :aria-label="label"
    :title="label"
    @click="emit('click', $event)"
  >
    <UiIcon :name="(icon as any)" :size="Math.round(size * 0.46)" />
  </button>
</template>

<style scoped lang="scss">
/* 右下角悬浮按钮（fixed：随窗口底缘，不随内容滚动） */
.ui-fab {
  position: fixed;
  right: var(--spacing-2xl);
  bottom: var(--spacing-2xl);
  z-index: 40;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 999px;
  background: var(--color-primary);
  color: #ffffff;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  transition: var(--transition-fast);

  &:hover {
    background: var(--color-primary-hover);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  &:active {
    transform: translateY(0);
  }
}
</style>
