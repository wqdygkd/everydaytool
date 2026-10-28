// 环境浏览器域共享类型（UI ↔ Rust 桌面壳）。

export interface EnvConfig {
  id: string
  name: string
  url: string
  username: string
  password: string
  remark?: string | null
  autoLogin: boolean
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
