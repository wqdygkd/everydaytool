export type OutlookRegisterTabKey = 'register' | 'mailbox'

export interface OutlookRegisterTabDef {
  key: OutlookRegisterTabKey
  label: string
  routeName: string
}

export const OUTLOOK_REGISTER_TOOL_ROOT = '/tools/outlook-register'

export const OUTLOOK_REGISTER_TABS: readonly OutlookRegisterTabDef[] = [
  { key: 'register', label: '注册', routeName: 'tool-outlook-register-register' },
  { key: 'mailbox', label: '邮箱', routeName: 'tool-outlook-register-mailbox' },
]

export function outlookTabKeyFromPath(path: string): OutlookRegisterTabKey {
  const prefix = `${OUTLOOK_REGISTER_TOOL_ROOT}/`
  const segment = path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : ''
  return OUTLOOK_REGISTER_TABS.find(tab => tab.key === segment)?.key ?? 'register'
}
