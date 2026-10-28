<script setup lang="ts">
// 表格基座：把「密度 / 空态 / loading / 等宽 / 可点行」收敛成一次声明。
// 列定义仍写在默认插槽（el-table-column）；其余属性与事件（@row-click / @sort-change /
// row-class-name / :tree-props / default-expand-all / class …）由单根组件自动透传给 el-table，
// 因此树形表格、自定义排序、双击开编辑器都不用在这里逐个转发。
withDefaults(defineProps<{
  data: unknown[]
  loading?: boolean
  /** 空态文案（内部渲染 UiEmpty） */
  emptyText?: string
  /** 固定高度（内部滚动） */
  height?: string | number
  /** 最大高度（内容不足时自适应） */
  maxHeight?: string | number
  rowKey?: string
  /** 整表等宽：ID / 摘要 / 字节类表格 */
  mono?: boolean
  /** 行可点击：整行手型指针 */
  rowClickable?: boolean
}>(), {
  loading: false,
  emptyText: '暂无数据',
  mono: false,
  rowClickable: false,
})
</script>

<template>
  <el-table
    v-loading="loading"
    :data="data"
    :height="height"
    :max-height="maxHeight"
    :row-key="rowKey"
    size="small"
    class="ui-table"
    :class="{ 'is-mono': mono, 'is-row-clickable': rowClickable }"
  >
    <slot />

    <template #empty>
      <slot name="empty">
        <UiEmpty center :text="emptyText" padding="var(--spacing-xl)" />
      </slot>
    </template>
  </el-table>
</template>

<style scoped>
/* 整表等宽：ID / 摘要 / 字节列用 --font-mono 对齐数字 */
.ui-table.is-mono :deep(.el-table__cell) {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

/* 行可点击：整行手型指针 */
.ui-table.is-row-clickable :deep(.el-table__row) {
  cursor: pointer;
}
</style>
