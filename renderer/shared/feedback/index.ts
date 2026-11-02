// 反馈基座:命令式 confirm / alert / prompt(基于 UiMessageBox 的 Promise 胶水)。
// toast 直接用 vue-sonner 的 toast(业务侧显式 import),不再经过本模块。
export { alert, confirm, prompt } from './useConfirm'
