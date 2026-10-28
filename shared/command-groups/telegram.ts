// telegram-cache 工具域 命令通道（前后端共享）。全部为窄接口：键 / 枚举 / 数字，
// 不接受任意 URL、文件路径或 shell 命令；EVENT_* 为桌面壳 → 渲染层的推送通道。
export const TELEGRAM_COMMANDS = {
  // 状态 / 配置
  SNAPSHOT_GET: 'telegram-cache:snapshot:get',
  CONFIG_SET: 'telegram-cache:config:set',
  OBSERVATION_SET_ENABLED: 'telegram-cache:observation:set-enabled',
  OBSERVATION_CLEAR: 'telegram-cache:observation:clear',
  OBSERVATION_SCRIPT: 'telegram-cache:observation:script',
  OBSERVATION_REPORT: 'telegram-cache:observation:report',
  TRAFFIC_GET: 'telegram-cache:traffic:get',
  // 页面
  PAGE_ATTACH: 'telegram-cache:page:attach',
  PAGE_PROBE: 'telegram-cache:page:probe',
  // 资源 / 任务
  ACQUIRE: 'telegram-cache:resource:acquire',
  TASK_CANCEL: 'telegram-cache:task:cancel',
  ARCHIVE_LIST: 'telegram-cache:archive:list',
  ARCHIVE_OPEN_DIR: 'telegram-cache:archive:open-dir',
  CACHE_CLEAR: 'telegram-cache:cache:clear',
  // 自检 / 诊断 / 目录
  SELF_TEST: 'telegram-cache:self-test',
  M3_REPORT: 'telegram-cache:m3:report',
  DIAGNOSTICS_EXPORT: 'telegram-cache:diagnostics:export',
  OPEN_DATA_DIR: 'telegram-cache:open-data-dir',
  // MTProto（凭据只在桌面壳读取）
  MT_STATUS: 'telegram-cache:mtproto:status',
  MT_DOWNLOAD: 'telegram-cache:mtproto:download',
  MT_CANCEL: 'telegram-cache:mtproto:cancel',
  MT_SESSION_MIGRATE: 'telegram-cache:mtproto:session:migrate',
  MT_SESSION_CLEAR: 'telegram-cache:mtproto:session:clear',
  // 基准测试
  BENCHMARK_STATUS: 'telegram-cache:benchmark:status',
  BENCHMARK_START: 'telegram-cache:benchmark:start',
  BENCHMARK_STOP: 'telegram-cache:benchmark:stop',
  BENCHMARK_CLEAR: 'telegram-cache:benchmark:clear',
  // 事件（桌面壳 → 渲染层推送）
  EVENT_SNAPSHOT: 'telegram-cache:event:snapshot',
  EVENT_TRAFFIC: 'telegram-cache:event:traffic',
  EVENT_TASK: 'telegram-cache:event:task',
  EVENT_MTPROTO: 'telegram-cache:event:mtproto',
  EVENT_BENCHMARK: 'telegram-cache:event:benchmark',
} as const

export type TelegramCommand = (typeof TELEGRAM_COMMANDS)[keyof typeof TELEGRAM_COMMANDS]
