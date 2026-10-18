// 环境浏览器域共享类型（renderer ↔ 主进程 backend）。

export interface EnvConfig {
  id: string
  name: string
  url: string
  username: string
  password: string
  remark?: string | null
  autoLogin: number
  createdAt: string | null
  updatedAt: string | null
}

export interface EnvCreatePayload {
  name: string
  url: string
  username: string
  password: string
  remark?: string
  autoLogin?: boolean
}

export interface EnvUpdatePayload {
  name?: string
  url?: string
  username?: string
  password?: string
  remark?: string
  autoLogin?: boolean
}
