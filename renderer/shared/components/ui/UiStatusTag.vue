<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  /** 呼吸光环动画 */
  pulsing?: boolean
}>(), {
  tone: 'neutral',
})
</script>

<template>
  <span
    class="ui-status-dot"
    :class="[`is-${tone}`, { 'is-pulsing': pulsing }]"
    aria-hidden="true"
  />
</template>

<style scoped lang="scss">
.ui-status-dot {
  /* 状态点读的是「有盏灯在亮」：实心点取语义色的可读档（≥4.5:1），
     外圈 3px 同色淡晕负责在浅底上把点的边界托起来——只有点、没有晕时，
     小尺寸圆点会像一粒写错的像素。 */
  --dot-tone: var(--color-text-tertiary);

  display: inline-block;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--dot-tone);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dot-tone) 14%, transparent);

  &.is-success {
    --dot-tone: var(--color-success);
  }

  &.is-warning {
    --dot-tone: var(--color-warning);
  }

  &.is-danger {
    --dot-tone: var(--color-error);
  }

  &.is-pulsing {
    animation: ui-status-pulse 2s ease-in-out infinite;
  }
}

@keyframes ui-status-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--dot-tone) 45%, transparent);
  }

  50% {
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--dot-tone) 0%, transparent);
  }
}

/* 用户要求减少动态效果时，呼吸灯退化为静态色点（DESIGN §8） */
@media (prefers-reduced-motion: reduce) {
  .ui-status-dot.is-pulsing {
    animation: none;
  }
}
</style>
