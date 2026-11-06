/** 来源解析失败；code 供 UI 区分“需要凭据 / 不存在 / 限流”等原因。 */
export class SourceResolutionError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SourceResolutionError'
    this.code = code
  }
}
