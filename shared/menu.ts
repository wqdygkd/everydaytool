// 应用菜单动作清单的单一事实来源（electron/main.ts 系统菜单使用），避免清单漂移。
// 仅常量，无运行时逻辑。
import type { ShellMenuAction } from './types.js'

export interface ShellMenuItem {
  label: string
  action: ShellMenuAction
  /** 页内菜单右侧展示的快捷键文本；系统菜单的快捷键由 Electron role 自带，忽略此字段 */
  accel?: string
  /** 该项上方显示分隔线 */
  divided?: boolean
}

export interface ShellMenuGroup {
  label: string
  items: ShellMenuItem[]
}

export const SHELL_MENUS: ShellMenuGroup[] = [
  {
    label: '文件',
    items: [
      { label: '退出', action: 'quit' },
    ],
  },
  {
    label: '编辑',
    items: [
      { label: '撤销', action: 'undo', accel: 'Ctrl+Z' },
      { label: '重做', action: 'redo', accel: 'Ctrl+Y' },
      { label: '剪切', action: 'cut', accel: 'Ctrl+X', divided: true },
      { label: '复制', action: 'copy', accel: 'Ctrl+C' },
      { label: '粘贴', action: 'paste', accel: 'Ctrl+V' },
      { label: '全选', action: 'selectAll', accel: 'Ctrl+A' },
    ],
  },
  {
    label: '视图',
    items: [
      { label: '重新加载', action: 'reload', accel: 'Ctrl+R' },
      { label: '强制重新加载', action: 'reloadIgnoringCache', accel: 'Ctrl+Shift+R' },
      { label: '开发者工具', action: 'toggleDevTools', accel: 'F12', divided: true },
      { label: '放大', action: 'zoomIn', accel: 'Ctrl+=' },
      { label: '缩小', action: 'zoomOut', accel: 'Ctrl+-' },
      { label: '重置缩放', action: 'zoomReset', accel: 'Ctrl+0' },
    ],
  },
  {
    label: '窗口',
    items: [
      { label: '最小化', action: 'minimize' },
      { label: '关闭窗口', action: 'close', divided: true },
    ],
  },
]
