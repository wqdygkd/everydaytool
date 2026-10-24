// 通道常量的唯一事实来源已上移到 shared/command-groups（前端适配层与 Rust 白名单共用）。
// 这里保留同名导出，避免所有后端 handler 的 import 路径变动。
export { APP_COMMANDS } from '../../shared/command-groups/app.ts'
export type { AppCommand } from '../../shared/command-groups/app.ts'
