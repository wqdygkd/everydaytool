import { registerCacheIntegrityHandler } from '../../../backend/utils/data-root-scan.ts'
import { registerMediaLibraryHandlers } from './ipc/handlers.ts'
import { stopMediaServer } from './media-server.ts'
import { resetThumbState } from './thumbs.ts'

export const mediaLibraryBackend = {
  initialize(): void {
    registerMediaLibraryHandlers()
    // 设置页「清理缓存」会删掉 thumbs/：内存里的「生成失败」名单一并作废，
    // 缩略图在下次被请求时按需重新生成（索引本身在配置层，不受影响）。
    registerCacheIntegrityHandler(() => {
      resetThumbState()
    })
  },

  dispose(): void {
    stopMediaServer()
  },
}
