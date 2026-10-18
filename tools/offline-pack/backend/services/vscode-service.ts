// VSCode Marketplace 代理：版本查询 + .vsix 直链生成。
import type { OfflinePackVsCodeLinkResult, OfflinePackVsCodeQueryResult } from '../../../../shared/offline-pack.ts'
import { postJson } from '../utils/http.ts'

const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery'

export interface VsCodeInfo {
  publisher: string
  extension: string
}

/** 从 Marketplace 插件 URL 提取 publisher.extension（用最后一个 . 分割，兼容带点 publisher） */
export function extractVsCodeInfo(url: string): VsCodeInfo {
  const urlObj = new URL(url)
  const itemName = urlObj.searchParams.get('itemName')
  if (!itemName) {
    throw new Error('无效的插件 URL，示例：https://marketplace.visualstudio.com/items?itemName=ms-python.python')
  }
  const dotIndex = itemName.lastIndexOf('.')
  if (dotIndex === -1) {
    throw new Error('无效的插件 ID 格式，应为 publisher.extension')
  }
  return {
    publisher: itemName.substring(0, dotIndex),
    extension: itemName.substring(dotIndex + 1),
  }
}

export async function queryVsCodeVersions(url: string, maxVersions = 20): Promise<OfflinePackVsCodeQueryResult> {
  const info = extractVsCodeInfo(url)
  // flags: 0x1 只请求版本字符串，不带重资产/文件元数据
  const payload = {
    filters: [
      {
        criteria: [{ filterType: 7, value: `${info.publisher}.${info.extension}` }],
        pageNumber: 1,
        pageSize: 1,
        sortBy: 0,
        sortOrder: 0,
      },
    ],
    flags: 0x1,
  }
  const data = await postJson<{ results?: Array<{ extensions?: Array<{ versions?: Array<{ version?: string }> }> }> }>(
    MARKETPLACE_URL,
    payload,
    { headers: { Accept: 'application/json;api-version=3.0-preview.1' } },
  )
  const versions = data.results?.[0]?.extensions?.[0]?.versions ?? []
  const unique = [...new Set(versions.map(v => v.version).filter((v): v is string => Boolean(v)))]
  if (unique.length === 0) {
    throw new Error('未找到该插件，请检查 URL 是否正确')
  }
  return { versions: unique.slice(0, maxVersions) }
}

export function buildVsCodeLink(url: string, version: string): OfflinePackVsCodeLinkResult {
  const info = extractVsCodeInfo(url)
  return {
    downloadUrl: `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${info.publisher}/vsextensions/${info.extension}/${version}/vspackage`,
  }
}
