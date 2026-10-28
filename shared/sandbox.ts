// Chrome 沙箱域共享类型（UI ↔ Rust 桌面壳）：沙箱 / 指纹 / 应用配置。
// 仅类型，无运行时逻辑。前端 tsconfig.json 与后端 tsconfig.node.json 均引用。

export type SandboxStatus = 'running' | 'stopped'

export interface LaunchOptions {
  disableSafetyChecks?: boolean
  disableCors?: boolean
  customArgs?: string
}

export interface SandboxMetadata {
  inheritExtensions?: boolean
  launchOptions?: LaunchOptions
  developerModeEnabled?: boolean
}

export interface Sandbox {
  id: string
  name: string
  category: string | null
  color: string | null
  userDataPath: string
  chromePid: number | null
  status: SandboxStatus
  fingerprintId: string | null
  createdAt: string | null
  lastUsedAt: string | null
  lastActiveAt: string | null
  metadata: SandboxMetadata | null
}

export interface SandboxCreatePayload {
  name: string
  fingerprintData?: Fingerprint | null
  inheritExtensions?: boolean
  launchOptions?: LaunchOptions
}

export interface SandboxUpdatePayload {
  name?: string
  category?: string
  color?: string
  chromePid?: number | null
  status?: SandboxStatus
  fingerprintId?: string | null
  lastUsedAt?: string | null
  lastActiveAt?: string | null
  metadata?: SandboxMetadata | null
}

export interface FingerprintNavigator {
  userAgent: string
  platform: string
  language: string
  hardwareConcurrency: number
  deviceMemory: number
}

export interface FingerprintCanvas {
  noiseLevel: 'low' | 'medium' | 'high'
  noiseSeed: number
}

export interface FingerprintWebgl {
  vendor: string
  renderer: string
}

export interface FingerprintScreen {
  width: number
  height: number
  colorDepth: number
  devicePixelRatio: number
}

export interface FingerprintAudio {
  noiseEnabled: boolean
  noiseLevel: number
}

export interface FingerprintTimezone {
  offset: number
  name: string
}

export interface Fingerprint {
  id: string
  navigator: FingerprintNavigator
  canvas: FingerprintCanvas
  webgl: FingerprintWebgl
  screen: FingerprintScreen
  audio: FingerprintAudio
  timezone: FingerprintTimezone
  createdAt?: string | null
  updatedAt?: string | null
}

export type FingerprintCreatePayload = Omit<Fingerprint, 'createdAt' | 'updatedAt'>
export type FingerprintUpdatePayload = Partial<Omit<Fingerprint, 'id'>>

export interface AppConfig {
  chromePath: string
  defaultProfile: string
  dataDirectory: string
  autoRestoreOnStartup: boolean
  preserveDataOnClose: boolean
}

export interface AppConfigUpdate {
  chromePath?: string
  defaultProfile?: string
  dataDirectory?: string
  autoRestoreOnStartup?: boolean
  preserveDataOnClose?: boolean
}

export interface SetupState extends AppConfig {
  dataDirectoryConfigured: boolean
  dataDirectoryChanged?: boolean
}
