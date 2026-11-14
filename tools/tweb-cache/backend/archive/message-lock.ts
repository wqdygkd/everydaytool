import path from 'node:path'

const messageLocks = new Map<string, Promise<void>>()

/**
 * 同一消息目录的元数据读改写串行化。
 * prepare / append / commit / 缩略图 / 回收站会在不同 IPC 与下载回调里并发进入；
 * 没有队列时后写入的旧快照会覆盖先写入的进度。
 */
export async function withArchiveMessageLock<T>(dir: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(dir)
  const previous = messageLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  messageLocks.set(key, tail)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (messageLocks.get(key) === tail) messageLocks.delete(key)
  }
}
