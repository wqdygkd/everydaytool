// UiTable ↔ UiTableColumn 的列注册表共享类型与注入 key
export interface UiTableColumnProps {
  prop?: string
  label?: string
  width?: number | string
  minWidth?: number | string
  align?: 'left' | 'center' | 'right'
  sortable?: boolean | 'custom'
  showOverflowTooltip?: boolean
}

export interface UiTableColumnReg {
  props: UiTableColumnProps
  slots: Record<string, ((scope?: any) => any) | undefined>
}

export const UI_TABLE_COLUMNS_KEY = 'uiTableColumns'
