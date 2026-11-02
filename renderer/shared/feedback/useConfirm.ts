// 命令式 confirm / alert / prompt：基于 UiMessageBox 的 Promise 胶水。
// 保持既有调用语义：
// confirm/alert 取消时 reject 'cancel',prompt resolve { value }。
import { reactive } from 'vue'

export interface ConfirmOptions {
  title?: string
  message: string
  type?: 'success' | 'warning' | 'error' | 'info'
  confirmButtonText?: string
  cancelButtonText?: string
  /** 保持旧 API 兼容：遮罩点击与取消按钮的拒绝原因相同('cancel') */
  distinguishCancelAndClose?: boolean
  /** prompt 专用 */
  inputType?: 'text' | 'password'
  inputPlaceholder?: string
  showInput?: boolean
}

interface ConfirmState {
  visible: boolean
  options: ConfirmOptions
  inputValue: string
  resolve: (value: { value?: string }) => void
  reject: (reason: 'cancel') => void
}

const state = reactive<ConfirmState>({
  visible: false,
  options: { message: '' },
  inputValue: '',
  resolve: () => {},
  reject: () => {},
})

function open(options: ConfirmOptions): Promise<{ value?: string }> {
  return new Promise((resolve, reject) => {
    state.options = options
    state.inputValue = ''
    state.visible = true
    state.resolve = resolve
    state.reject = reject
  })
}

export function useConfirmState() {
  return state
}

export function settleConfirm() {
  state.visible = false
  state.resolve({ value: state.options.showInput ? state.inputValue : undefined })
}

export function settleCancel() {
  state.visible = false
  state.reject('cancel')
}

/** 确认框；保持既有位置参数形式。 */
export function confirm(message: string, title?: string, options?: Omit<ConfirmOptions, 'message' | 'title' | 'showInput' | 'inputType' | 'inputPlaceholder'>) {
  return open({ message, title, ...options }).then(() => undefined)
}

/** 提示框；确认即 resolve，取消 reject 'cancel'。 */
export function alert(message: string, title?: string, options?: Omit<ConfirmOptions, 'message' | 'title' | 'showInput' | 'inputType' | 'inputPlaceholder'>) {
  return confirm(message, title, options)
}
export function prompt(message: string, title?: string, options?: Omit<ConfirmOptions, 'message' | 'title' | 'showInput'>) {
  return open({ message, title, showInput: true, ...options })
}
