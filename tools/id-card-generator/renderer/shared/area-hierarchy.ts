import { AREA_CODES } from './area-codes'

/** 省 / 自治区 / 直辖市名称（按区划代码前两位） */
const PROVINCE_NAMES: Record<string, string> = {
  11: '北京市',
  12: '天津市',
  13: '河北省',
  14: '山西省',
  15: '内蒙古自治区',
  21: '辽宁省',
  22: '吉林省',
  23: '黑龙江省',
  31: '上海市',
  32: '江苏省',
  33: '浙江省',
  34: '安徽省',
  35: '福建省',
  36: '江西省',
  37: '山东省',
  41: '河南省',
  42: '湖北省',
  43: '湖南省',
  44: '广东省',
  45: '广西壮族自治区',
  46: '海南省',
  50: '重庆市',
  51: '四川省',
  52: '贵州省',
  53: '云南省',
  54: '西藏自治区',
  61: '陕西省',
  62: '甘肃省',
  63: '青海省',
  64: '宁夏回族自治区',
  65: '新疆维吾尔自治区',
}

/** 直辖市：省与市同名 */
const MUNICIPALITY_CODES = new Set(['11', '12', '31', '50'])

export interface AreaNode {
  value: string
  label: string
  children?: AreaNode[]
}

function cityNameOf(name: string): string {
  const idx = name.indexOf('市')
  return idx > 0 ? name.slice(0, idx + 1) : name
}

/**
 * 由扁平区划表构建 省 → 市 → 区县 级联数据。
 * 节点 value 依层级为 省(2位) / 市(4位) / 区县(6位) 代码，label 为可读名称。
 */
function buildAreaHierarchy(): AreaNode[] {
  const provinceMap = new Map<string, Map<string, Array<{ code: string, name: string }>>>()

  for (const { code, name } of AREA_CODES) {
    const provCode = code.slice(0, 2)
    const cityCode = code.slice(0, 4)
    if (!provinceMap.has(provCode)) provinceMap.set(provCode, new Map())
    const cityMap = provinceMap.get(provCode)!
    if (!cityMap.has(cityCode)) cityMap.set(cityCode, [])
    cityMap.get(cityCode)!.push({ code, name })
  }

  const tree: AreaNode[] = []
  for (const [provCode, cityMap] of provinceMap) {
    const isMuni = MUNICIPALITY_CODES.has(provCode)
    const provName = PROVINCE_NAMES[provCode] ?? provCode

    const cityNodes: AreaNode[] = []
    for (const [cityCode, districts] of cityMap) {
      const districtNodes: AreaNode[] = districts
        .map(({ code, name }) => {
          const districtName = isMuni ? name.replace(provName, '') : name.replace(cityNameOf(name), '')
          return { value: code, label: districtName || name }
        })
        .sort((a, b) => a.label.localeCompare(b.label))

      const firstDistrictName = districts[0].name
      const cityLabel = isMuni ? provName : cityNameOf(firstDistrictName)

      cityNodes.push({
        value: cityCode,
        label: cityLabel,
        children: districtNodes,
      })
    }
    cityNodes.sort((a, b) => a.label.localeCompare(b.label))

    tree.push({
      value: provCode,
      label: provName,
      children: cityNodes,
    })
  }

  tree.sort((a, b) => a.label.localeCompare(b.label))
  return tree
}

export const AREA_TREE = buildAreaHierarchy()

/** 由级联选中路径（省 2位 / 市 4位 / 区县 6位 代码数组）返回用于生成的最具体代码前缀 */
export function areaPrefixFromPath(path: Array<string | number> | undefined | null): string | null {
  if (!path || path.length === 0) return null
  const innermost = String(path[path.length - 1])
  if (!/^\d+$/.test(innermost)) return null
  return innermost
}
