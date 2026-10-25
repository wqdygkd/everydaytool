// 窗口外观（半透明 / 系统材质）域共享类型与纯逻辑：
// 平台能力判定放在这里（shared 只依赖纯 TS），主进程据此决定是否落盘无效选择，
// 渲染层据此决定设置面板里哪些选项可点。经 preload 命名空间 edtApp 暴露。

/** 系统背景材质（Windows 11 22H2+ 的 mica / acrylic，macOS 的 vibrancy 归到 translucency 上） */
export type WindowMaterial = 'none' | 'mica' | 'acrylic' | 'tabbed'

/** macOS vibrancy：与 backgroundMaterial 语义等价但视觉更「原生」 */
export type MacVibrancy = 'none' | 'sidebar' | 'hud' | 'under-window' | 'fullscreen-ui'

export interface WindowAppearance {
  /** 半透明总开关：关闭时窗口完全不透明，其他字段仅作为记忆值保留 */
  enabled: boolean
  /** Windows 系统材质（仅 win32 生效） */
  material: WindowMaterial
  /** macOS vibrancy（仅 darwin 生效） */
  vibrancy: MacVibrancy
  /**
   * 测试壁纸：在页面底层铺一张高对比色块「假壁纸」，用于在应用内直接预览
   * 各表面（卡片 / 浮层 / 标题栏）的磨砂效果——真实桌面壁纸是随机的，
   * 系统材质也可能把窗口背后统一成一片柔和背景，看不出模糊档位是否合适。
   * 纯 CSS、与平台能力无关，任何平台 / 浏览器调试下都能开；关闭后回到「透出真实桌面」。
   */
  testWallpaper: boolean
}

/** 主进程可落盘的外观配置：与平台无关的字段在跨平台时会被裁剪 */
export interface WindowAppearanceUpdate extends Partial<WindowAppearance> {}

export interface WindowAppearanceCapabilities {
  /** 是否支持半透明窗口（win32 需 frameless，darwin 恒支持，linux 依赖合成器） */
  supportsTransparent: boolean
  /**
   * 半透明的实现方式：css = 透明窗口（Windows 用 titleBarStyle:'hidden' 的窗口形态，
   * Chromium 合成 alpha）；vibrancy = macOS 原生磨砂；none = 平台不支持。
   * 主进程据此决定构造参数，避免在两个生命周期各写一份 process.platform 分支。
   */
  transparentMode: 'css' | 'vibrancy' | 'none'
  /** 是否支持系统背景材质（win32 22H2+） */
  supportsMaterial: boolean
  /** 可用材质清单（空数组表示该平台无系统材质） */
  materials: WindowMaterial[]
  /** 可用 vibrancy 清单（仅 darwin 非空） */
  vibrancies: MacVibrancy[]
  /** 当前平台默认材质 / vibrancy */
  defaultMaterial: WindowMaterial
  defaultVibrancy: MacVibrancy
}

export const DEFAULT_WINDOW_APPEARANCE: WindowAppearance = {
  enabled: false,
  material: 'none',
  vibrancy: 'none',
  testWallpaper: false,
}

/** Windows 11 22H2 及以上的 build 号（DwmSetWindowAttribute 系统背景材质的最低要求） */
export const WIN32_MATERIAL_MIN_BUILD = 22_120

/**
 * 平台能力表：主进程创建窗口时据此选择透明方案，渲染层据此禁用不可选项。
 * linux 的 transparent 依赖合成器（Wayland 下常不生效），故不声明支持、不走透明分支。
 */
export function resolveAppearanceCapabilities(
  platform: string,
  windowsBuild: number | null,
): WindowAppearanceCapabilities {
  if (platform === 'darwin') {
    return {
      supportsTransparent: true,
      transparentMode: 'vibrancy',
      supportsMaterial: false,
      materials: [],
      vibrancies: ['sidebar', 'hud', 'under-window', 'fullscreen-ui'],
      defaultMaterial: 'none',
      defaultVibrancy: 'sidebar',
    }
  }

  if (platform === 'win32') {
    const supported = windowsBuild !== null && windowsBuild >= WIN32_MATERIAL_MIN_BUILD
    return {
      // 透明窗口在 Windows 上依赖无系统标题栏的窗口形态（本项目经 titleBarStyle:'hidden'
      // + titleBarOverlay 实现），否则 Chromium 不会合成 alpha 通道
      supportsTransparent: true,
      transparentMode: 'css',
      supportsMaterial: supported,
      materials: supported ? ['mica', 'acrylic', 'tabbed'] : [],
      vibrancies: [],
      defaultMaterial: supported ? 'acrylic' : 'none',
      defaultVibrancy: 'none',
    }
  }

  return {
    supportsTransparent: false,
    transparentMode: 'none',
    supportsMaterial: false,
    materials: [],
    vibrancies: [],
    defaultMaterial: 'none',
    defaultVibrancy: 'none',
  }
}

/**
 * 窗口外观的「生效形态」：主进程构造窗口与运行期切换都消费这一份结论，
 * 平台分支只在这里做一次（构造期 / 运行期不再各自判断）。
 */
export interface WindowAppearancePlan {
  /** 是否处于半透明模式（sanitize 后的最终开关） */
  enabled: boolean
  /** 是否用透明窗口承载（Windows 无系统材质时） */
  transparent: boolean
  /** 系统背景材质；none = 不用材质 */
  material: WindowMaterial
  /** macOS vibrancy；none = 不用 */
  vibrancy: MacVibrancy
}

export function resolveWindowAppearance(
  appearance: WindowAppearance,
  capabilities: WindowAppearanceCapabilities,
): WindowAppearancePlan {
  const safe = sanitizeWindowAppearance(appearance, capabilities)
  if (!safe.enabled) return { enabled: false, transparent: false, material: 'none', vibrancy: 'none' }

  // macOS：vibrancy 是唯一的半透明实现（自带模糊背景，不能再叠 transparent）
  if (capabilities.transparentMode === 'vibrancy') {
    return { enabled: true, transparent: false, material: 'none', vibrancy: safe.vibrancy }
  }

  // Windows：有系统材质时由 DWM 画背景；无材质才走透明窗口让 CSS alpha 透出桌面
  if (capabilities.transparentMode === 'css') {
    if (safe.material !== 'none') {
      return { enabled: true, transparent: false, material: safe.material, vibrancy: 'none' }
    }
    return { enabled: true, transparent: true, material: 'none', vibrancy: 'none' }
  }

  // 其余平台（linux）：能力表声明不支持，保持不透明
  return { enabled: false, transparent: false, material: 'none', vibrancy: 'none' }
}

/**
 * 把用户设置收敛成当前平台真正能生效的形态：
 * - 平台不支持材质时 material 归 none（避免留下永远无法呈现的选择）；
 * - 关闭半透明时一并清空材质 / vibrancy（保持「关闭 = 完全不透明」的语义）；
 * - 测试壁纸是纯 CSS 的表现层开关，与平台能力 / 半透明状态无关，原样保留
 *   （不透明窗口下也能用它检查卡片底色在彩色背景上的观感）。
 */
export function sanitizeWindowAppearance(
  appearance: WindowAppearance,
  capabilities: WindowAppearanceCapabilities,
): WindowAppearance {
  const testWallpaper = appearance.testWallpaper === true

  if (!appearance.enabled || !capabilities.supportsTransparent) {
    return { enabled: false, material: 'none', vibrancy: 'none', testWallpaper }
  }

  const material = capabilities.materials.includes(appearance.material) ? appearance.material : 'none'
  const vibrancy = capabilities.vibrancies.includes(appearance.vibrancy) ? appearance.vibrancy : 'none'
  return { enabled: true, material, vibrancy, testWallpaper }
}

/**
 * Windows build 号解析（getSystemVersion() 返回 "10.0.26100" 这类形式）。
 * 取第三段；缺失或非数字时返回 null（视为不支持系统材质）。
 */
export function parseWindowsBuild(systemVersion: string): number | null {
  const match = /^\d+\.\d+\.(\d+)/.exec(systemVersion.trim())
  if (!match) return null
  const build = Number.parseInt(match[1], 10)
  return Number.isFinite(build) ? build : null
}
