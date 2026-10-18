import type { WriteStream } from 'node:fs'
import { Buffer } from 'node:buffer'
// 流式 TAR 构建器：直接写入 Node WriteStream，避免把整个归档常驻内存。
// header 512 字节 + checksum 计算。
import { createWriteStream } from 'node:fs'

function createHeader(
  name: string,
  size: number,
  mode = '0000644',
  uid = '0000000',
  gid = '0000000',
  type = '0',
): Buffer {
  const header = Buffer.alloc(512)
  const nameBuf = Buffer.from(name, 'utf8')
  nameBuf.copy(header, 0, 0, Math.min(100, nameBuf.length))
  header.write(`${mode.padStart(7, '0')}\0`, 100, 'ascii')
  header.write(`${uid.padStart(7, '0')}\0`, 108, 'ascii')
  header.write(`${gid.padStart(7, '0')}\0`, 116, 'ascii')
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii')
  header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 'ascii')
  // checksum 字段先填 8 个空格，计算时视为空格
  header.write('        ', 148, 'ascii')
  // typeflag 必须在计算 checksum 之前设置
  header.write(type, 156, 'ascii')
  let checksum = 0
  for (let i = 0; i < 512; i++) checksum += header[i]
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  return header
}

export class TarWriter {
  private readonly stream: WriteStream
  private ended = false

  constructor(destPath: string) {
    this.stream = createWriteStream(destPath)
  }

  private writeChunk(chunk: Buffer): Promise<void> {
    if (!this.stream.write(chunk)) {
      return new Promise(resolve => this.stream.once('drain', () => resolve()))
    }
    return Promise.resolve()
  }

  async addFile(name: string, content: Buffer | string): Promise<void> {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    await this.writeChunk(createHeader(name, data.length))
    await this.writeChunk(data)
    const padding = (512 - (data.length % 512)) % 512
    if (padding > 0) await this.writeChunk(Buffer.alloc(padding))
  }

  async addDirectory(name: string): Promise<void> {
    const dirName = name.endsWith('/') ? name : `${name}/`
    await this.writeChunk(createHeader(dirName, 0, '0000755', '0000000', '0000000', '5'))
  }

  async end(): Promise<void> {
    if (this.ended) return
    this.ended = true
    // TAR 以两个空 512 字节块结束
    await this.writeChunk(Buffer.alloc(1024))
    await new Promise<void>(resolve => this.stream.end(() => resolve()))
  }
}
