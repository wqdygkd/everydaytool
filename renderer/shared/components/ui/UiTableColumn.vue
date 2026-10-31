<script lang="ts">
import type { PropType } from 'vue'
// UiTable 的列声明件:渲染空,只把「props + 插槽」注册进 UiTable 的列注册表
// (provide/inject)。消费方模板与 el-table-column 同形:
// label / prop / width / min-width / align / sortable="custom" / show-overflow-tooltip
// + #default({ row, $index }) / #header。
import type { UiTableColumnReg } from './uiTableColumns'
import { defineComponent, inject, onBeforeUnmount, reactive, useSlots } from 'vue'
import { UI_TABLE_COLUMNS_KEY } from './uiTableColumns'

export default defineComponent({
  name: 'UiTableColumn',
  props: {
    prop: { type: String, default: undefined },
    label: { type: String, default: undefined },
    width: { type: [Number, String], default: undefined },
    minWidth: { type: [Number, String], default: undefined },
    align: { type: String as PropType<'left' | 'center' | 'right'>, default: 'left' },
    sortable: { type: [Boolean, String] as PropType<boolean | 'custom'>, default: false },
    showOverflowTooltip: { type: Boolean, default: false },
  },
  setup(props) {
    const columns = inject<UiTableColumnReg[]>(UI_TABLE_COLUMNS_KEY)
    if (!columns) {
      console.warn('[UiTableColumn] 必须作为 UiTable 的子元素使用')
      return () => null
    }
    const reg = reactive({ props, slots: useSlots() as UiTableColumnReg['slots'] })
    columns.push(reg)
    onBeforeUnmount(() => {
      const i = columns.indexOf(reg)
      if (i >= 0) {
        columns.splice(i, 1)
      }
    })
    return () => null
  },
})
</script>
