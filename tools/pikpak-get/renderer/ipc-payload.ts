/**
 * 进 IPC 前把载荷拍平成纯数据。
 *
 * 渲染层里 `ref` / `reactive` / `computed` 取值拿到的是 **Proxy**，Electron 的
 * 结构化克隆不认 Proxy，会直接抛 `An object could not be cloned.`
 * （典型触发：把 `store.selectedFileIds` 这类响应式数组当作参数传给 IPC）。
 *
 * 本工具的入参只有字符串 / 字符串数组 / 普通对象，按 JSON 语义拷贝即可；
 * `undefined` 原样返回（JSON 里没有 undefined，主进程一律按缺省处理）。
 */
export function toIpcPayload(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value)) as unknown
}
