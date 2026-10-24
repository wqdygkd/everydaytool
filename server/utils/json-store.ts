// 同步 JSON 文件存储：懒加载 + 原子写（临时文件 + rename）。
// 数据文件为 KB 级、sidecar 单线程串行处理命令，同步 IO 足够且保持调用方签名不变；
// 数据根目录切换后调用 reset() 丢弃内存缓存，下次访问按新目录重读。
import fs from 'node:fs'
import path from 'node:path'
import { logger } from './logger.ts'

const CORRUPT_SUFFIX = '.corrupt'

export class JsonFileStore<T> {
  private data: T | undefined

  constructor(
    private readonly resolvePath: () => string,
    private readonly fallback: T,
    /** 读取后的归一化/迁移：损坏字段修复、旧版结构升级都在这里做 */
    private readonly parse?: (raw: unknown) => T,
  ) {}

  get(): T {
    if (this.data !== undefined) return this.data
    const file = this.resolvePath()
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      this.data = this.parse ? this.parse(raw) : (raw as T)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('JSON 存储读取失败，使用默认值', {
          file: path.basename(file),
          error: (error as Error).message,
        })
        this.backupCorrupt(file)
      }
      this.data = this.fallback
    }
    return this.data
  }

  /** 整体替换并落盘 */
  set(data: T): void {
    this.data = data
    this.flush()
  }

  /** 修改内存数据并落盘；mutate 内不要做异步操作 */
  update(mutate: (data: T) => void): void {
    mutate(this.get())
    this.flush()
  }

  flush(): void {
    // 未加载就 flush 会把 undefined 写成损坏文件，直接忽略
    if (this.data === undefined) return
    const file = this.resolvePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, file)
  }

  /** 返回已加载的内存数据；未加载时不读盘（对应“快照”语义） */
  peek(): T | undefined {
    return this.data
  }

  /** 数据根目录变更后调用：丢弃缓存，下次访问重读新目录 */
  reset(): void {
    this.data = undefined
  }

  private backupCorrupt(file: string): void {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      fs.writeFileSync(`${file}${CORRUPT_SUFFIX}`, raw, 'utf8')
    } catch {
      // 备份失败不影响主流程
    }
  }
}

/** 按 id 组织的集合存储：数组文件 + 常用增删改查 */
export class JsonCollection<T extends { id: string }> {
  private readonly store: JsonFileStore<T[]>

  constructor(resolvePath: () => string) {
    this.store = new JsonFileStore<T[]>(resolvePath, [])
  }

  all(): T[] {
    return this.store.get()
  }

  find(id: string): T | null {
    return this.store.get().find(item => item.id === id) ?? null
  }

  insert(item: T): T {
    this.store.update((items) => {
      items.push(item)
    })
    return item
  }

  /** 返回更新后的对象；不存在返回 null */
  update(id: string, mutate: (item: T) => void): T | null {
    const item = this.find(id)
    if (!item) return null
    mutate(item)
    this.store.flush()
    return item
  }

  remove(id: string): boolean {
    const items = this.store.get()
    const index = items.findIndex(item => item.id === id)
    if (index < 0) return false
    items.splice(index, 1)
    this.store.flush()
    return true
  }

  reset(): void {
    this.store.reset()
  }
}
