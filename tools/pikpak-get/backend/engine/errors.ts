// 引擎错误分类：与 Python 版 errors.py 语义一致（transient / replaySafe 决定重试策略）。
export interface PikpakErrorOptions {
  status?: number
  code?: number
  action?: string
  throttled?: boolean
  network?: boolean
  retryAfter?: number | null
}

export class PikpakError extends Error {
  readonly status: number | undefined
  readonly code: number | undefined
  readonly action: string | undefined
  readonly throttled: boolean
  readonly network: boolean
  retryAfter: number | null
  retryExhausted = false
  readonly replaySafe: boolean = true

  constructor(message: string, options: PikpakErrorOptions = {}) {
    super(message)
    this.name = 'PikpakError'
    this.status = options.status
    this.code = options.code
    this.action = options.action
    this.throttled = options.throttled ?? false
    this.network = options.network ?? false
    this.retryAfter = options.retryAfter ?? null
  }

  get transient(): boolean {
    return this.network
      || this.throttled
      || this.retryAfter !== null
      || this.status === 429
      || (this.status !== undefined && this.status >= 500)
  }
}

export class TrafficCapped extends PikpakError {
  override readonly replaySafe = true

  constructor(message: string, options: PikpakErrorOptions = {}) {
    super(message, options)
    this.name = 'TrafficCapped'
  }

  override get transient(): boolean {
    return false
  }
}

export class MutationOutcomeUnknown extends PikpakError {
  override readonly replaySafe = false

  constructor(message: string, options: PikpakErrorOptions = {}) {
    super(message, options)
    this.name = 'MutationOutcomeUnknown'
  }
}

export class RestoreOutcomeUnknown extends MutationOutcomeUnknown {
  constructor(message: string, options: PikpakErrorOptions = {}) {
    super(message, options)
    this.name = 'RestoreOutcomeUnknown'
  }
}
