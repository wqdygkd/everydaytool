import type { Buffer } from 'node:buffer'
// CRX → ZIP 转换（Node Buffer 版）：
// 支持 CRX2 / CRX3 头解析，失败回退为「前 1024 字节内查找 ZIP 魔数」。
export function convertCrxToZip(crxBuffer: Buffer): Buffer {
  if (crxBuffer.length < 16) return crxBuffer

  if (crxBuffer.subarray(0, 2).toString('latin1') === 'PK') {
    return crxBuffer
  }

  const magic = crxBuffer.subarray(0, 4).toString('latin1')
  let zipOffset = 0

  if (magic === 'Cr24') {
    const version = crxBuffer.readUInt32LE(4)
    if (version === 3) {
      const headerSize = crxBuffer.readUInt32LE(8)
      zipOffset = 12 + headerSize
    } else if (version === 2) {
      const pubKeyLength = crxBuffer.readUInt32LE(8)
      const sigLength = crxBuffer.readUInt32LE(12)
      zipOffset = 16 + pubKeyLength + sigLength
    } else {
      throw new Error(`不支持的 CRX 版本: ${version}`)
    }
  } else {
    for (let i = 0; i < Math.min(crxBuffer.length - 2, 1024); i++) {
      if (crxBuffer.subarray(i, i + 2).toString('latin1') === 'PK') {
        zipOffset = i
        break
      }
    }
    if (zipOffset === 0) return crxBuffer
  }

  if (zipOffset >= crxBuffer.length) {
    throw new Error('ZIP 数据偏移量超出文件范围')
  }

  const zipData = crxBuffer.subarray(zipOffset)
  if (zipData.length < 4 || zipData.subarray(0, 2).toString('latin1') !== 'PK') {
    throw new Error('提取的数据不是有效的 ZIP 格式')
  }

  return zipData
}
