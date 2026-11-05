<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  /** 进度百分比，超出 0–100 自动收敛 */
  percentage: number
  /** 条高，默认 6px（收敛原先 4 处手写的 stroke-width） */
  strokeWidth?: number
  /** 语义色：成功 / 警告 / 异常；不传走品牌色 */
  status?: 'success' | 'warning' | 'exception'
  showText?: boolean
}>(), {
  strokeWidth: 6,
  showText: false,
})

const clamped = computed(() => Math.min(100, Math.max(0, Math.round(props.percentage))))
</script>

<template>
  <div
    class="ui-progress"
    :class="status ? `is-${status}` : undefined"
  >
    <div class="ui-progress-track" :style="{ height: `${strokeWidth}px` }">
      <div class="ui-progress-fill" :style="{ width: `${clamped}%` }" />
    </div>
    <span v-if="showText" class="ui-progress-text mono">{{ clamped }}%</span>
  </div>
</template>

<style scoped lang="scss">
/* 进度条只承载进度语义：轨道灰调填充、填充走品牌亮档，语义态切语义色 */
.ui-progress {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}

.ui-progress-track,
.ui-progress-fill {
  border-radius: 999px;
}

.ui-progress-track {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background: var(--color-fill);
}

.ui-progress-fill {
  height: 100%;
  background: var(--color-primary);
  transition: width var(--transition-base);
}

.is-success .ui-progress-fill { background: var(--color-success); }
.is-warning .ui-progress-fill { background: var(--color-warning); }
.is-exception .ui-progress-fill { background: var(--color-error); }

.ui-progress-text {
  flex: none;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}
</style>
