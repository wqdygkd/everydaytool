<script setup lang="ts">
import type { UiTableColumnReg } from './uiTableColumns'
// 表格基座内核：原生 <table>（支持
// width / min-width / align / sortable="custom" / show-overflow-tooltip /
// #default / #header / row-click / sort-change / row-class-name / 树形全展开 /
// max-height / loading / 空态)。列由 UiTableColumn 注册,行展开与单元格渲染都在这里。
import { computed, h, provide, reactive, useAttrs } from 'vue'
import { UI_TABLE_COLUMNS_KEY } from './uiTableColumns'

const props = withDefaults(defineProps<{
  /** 行对象数组;树形数据直接传带 children 的行(配合 tree-props / default-expand-all) */
  data: Record<PropertyKey, any>[]
  loading?: boolean
  /** 空态文案(内部渲染 UiEmpty) */
  emptyText?: string
  /** 固定高度(内部滚动) */
  height?: string | number
  /** 最大高度(内容不足时自适应) */
  maxHeight?: string | number
  rowKey?: string
  /** 整表等宽:ID / 摘要 / 字节类表格 */
  mono?: boolean
  /** 行可点击:整行手型指针 */
  rowClickable?: boolean
}>(), {
  loading: false,
  emptyText: '暂无数据',
  mono: false,
  rowClickable: false,
})

const emit = defineEmits<{
  rowClick: [row: any, index: number]
  sortChange: [event: { prop: string, order: 'ascending' | 'descending' | null }]
}>()

const attrs = useAttrs() as Record<string, any>
const columns = reactive<UiTableColumnReg[]>([])
provide(UI_TABLE_COLUMNS_KEY, columns)

/* ── 树形:tree-props.children 指定子级字段,default-expand-all 全展开(wxp 收藏表唯一使用) ── */
const childrenKey = computed(() => (attrs['tree-props']?.children ?? attrs.treeProps?.children ?? 'children') as string)
const expandAll = computed(() => attrs['default-expand-all'] !== undefined)

const flatRows = computed(() => {
  const out: Array<{ row: Record<PropertyKey, any>, depth: number }> = []
  const walk = (rows: Record<PropertyKey, any>[], depth: number) => {
    for (const row of rows) {
      out.push({ row, depth })
      const kids = expandAll.value ? row[childrenKey.value] : undefined
      if (Array.isArray(kids) && kids.length > 0) {
        walk(kids, depth + 1)
      }
    }
  }
  walk(props.data, 0)
  return out
})

function colStyle(col: UiTableColumnReg) {
  const w = col.props.width ?? col.props.minWidth
  return w != null ? { width: `${w}px` } : undefined
}

function rowClass(item: { row: Record<PropertyKey, any> }, index: number) {
  const f = attrs['row-class-name'] ?? attrs.rowClassName
  if (typeof f === 'function') {
    return f({ row: item.row, rowIndex: index })
  }
  return typeof f === 'string' ? f : ''
}

function cellText(col: UiTableColumnReg, row: Record<PropertyKey, any>) {
  return col.props.prop ? String(row[col.props.prop] ?? '') : ''
}

/* 单元格:默认取 row[prop],有 #default 插槽则以插槽为准(作用域 { row, $index }) */
function cellComp(col: UiTableColumnReg, item: { row: Record<PropertyKey, any>, depth: number }, index: number) {
  return () => {
    const scoped = col.slots.default?.({ row: item.row, $index: index })
    const hasSlot = Array.isArray(scoped) ? scoped.length > 0 : scoped != null
    const text = cellText(col, item.row)
    const content = hasSlot ? scoped : text
    return h('td', { style: { textAlign: col.props.align } }, [
      h('div', {
        class: ['ui-cell', { 'is-clip': !!col.props.showOverflowTooltip }],
        title: col.props.showOverflowTooltip ? text : undefined,
        style: item.depth > 0 ? { marginLeft: `${item.depth * 20}px` } : undefined,
      }, content),
    ])
  }
}

/* ── 排序：仅 custom 模式（表头点击翻转 → emit，数据排序由消费方完成） ── */
const orders = reactive<Record<string, 'ascending' | 'descending' | null>>({})

function toggleSort(col: UiTableColumnReg) {
  const prop = col.props.prop
  if (!prop) {
    return
  }
  const cur = orders[prop] ?? null
  const next = cur === null ? 'ascending' : (cur === 'ascending' ? 'descending' : null)
  orders[prop] = next
  emit('sortChange', { prop, order: next })
}

const containerStyle = computed(() => {
  const style: Record<string, string | number> = {}
  if (props.height != null) {
    style.height = typeof props.height === 'number' ? `${props.height}px` : props.height
  }
  if (props.maxHeight != null) {
    style.maxHeight = typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : props.maxHeight
  }
  return style
})
</script>

<template>
  <div class="ui-table-wrap" :style="containerStyle">
    <!-- 列收集器:UiTableColumn 在此挂载并注册,自身不渲染任何内容 -->
    <div aria-hidden="true" style="display: none">
      <slot />
    </div>
    <table class="ui-table" :class="{ 'is-mono': mono, 'is-row-clickable': rowClickable }">
      <colgroup>
        <col v-for="(col, i) in columns" :key="i" :style="colStyle(col)">
      </colgroup>
      <thead>
        <tr>
          <th v-for="(col, i) in columns" :key="i" :style="{ textAlign: col.props.align }">
            <span
              v-if="col.props.sortable"
              class="ui-th-sort"
              role="button"
              @click="toggleSort(col)"
            >
              <component :is="() => col.slots.header?.() ?? col.props.label" />
              <span class="ui-th-caret" :class="orders[col.props.prop ?? ''] ? `is-${orders[col.props.prop ?? '']}` : undefined">▲</span>
            </span>
            <template v-else>
              <component :is="() => col.slots.header?.() ?? col.props.label" />
            </template>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(item, i) in flatRows"
          :key="rowKey ? String(item.row[rowKey]) : i"
          :class="rowClass(item, i)"
          @click="emit('rowClick', item.row, i)"
        >
          <template v-for="(col, j) in columns" :key="j">
            <component :is="cellComp(col, item, i)" />
          </template>
        </tr>
      </tbody>
    </table>
    <div v-if="!flatRows.length" class="ui-table-empty">
      <slot name="empty">
        <UiEmpty center :text="emptyText" padding="var(--spacing-xl)" />
      </slot>
    </div>
    <div v-if="loading" class="ui-table-loading">
      <span class="ui-table-spinner" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.ui-table-wrap {
  position: relative;
  overflow: auto;
  border-radius: var(--radius-lg);
}

.ui-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--font-size-sm);

  &.is-mono :is(td, th) .ui-cell {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  &.is-row-clickable tbody tr {
    cursor: pointer;
  }
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--spacing-xs) 12px;
  background: var(--color-fill);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-align: left;
  line-height: var(--line-height-control);
}

td {
  padding: var(--spacing-xs) 12px;
  background: var(--color-table);
  color: var(--color-text-primary);
  line-height: var(--line-height-control);
  border-top: 1px solid var(--color-border-light);
}

tbody tr:hover td {
  background: var(--color-fill);
}

.ui-cell.is-clip {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-th-sort {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  cursor: pointer;
  user-select: none;
}

.ui-th-caret {
  display: inline-block;
  color: var(--color-text-tertiary);
  font-size: 9px;
  transition: transform var(--transition-fast);

  &.is-ascending {
    color: var(--color-primary-strong);
  }

  &.is-descending {
    color: var(--color-primary-strong);
    transform: rotate(180deg);
  }
}

.ui-table-empty {
  display: grid;
  place-items: center;
  min-height: 120px;
}

.ui-table-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--color-app-bg) 55%, transparent);
}

.ui-table-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--color-border-light);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: ui-table-spin 0.8s linear infinite;
}

@keyframes ui-table-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
