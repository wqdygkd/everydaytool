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
  <el-progress
    class="ui-progress"
    :percentage="clamped"
    :stroke-width="strokeWidth"
    :show-text="showText"
    :status="status"
  />
</template>

<style scoped>
/* 进度条只承载进度语义：轨道与填充色由全局 EP 绑定（--el-border-color-lighter / --el-color-primary），
   这里仅把两端钉成胶囊圆角，避免各处用法各自覆写。 */
.ui-progress :deep(.el-progress-bar__outer),
.ui-progress :deep(.el-progress-bar__inner) {
  border-radius: 999px;
}
</style>
