// 窗口外观：**唯一形态——系统磨砂背景 + CSS 半透明表面**。
//
// 桌面模糊只能由系统提供：Windows 11 22H2+ 的 acrylic / macOS 的 vibrancy。
// CSS backdrop-filter 只糊页面内内容，糊不到窗口背后的桌面（Chromium 限制），
// 所以「毛玻璃」必须由窗口材质承担，CSS 只负责在上面叠白纸。
//
// 外观仍**不可切换、不落盘**：每个平台只有一种形态（macOS vibrancy / Windows acrylic，
// Win10 退回逐像素 alpha），渲染层不参与判定，也就没有第二份状态。

/** Windows 11 22H2 及以上的 build 号（DwmSetWindowAttribute 系统磨砂的最低要求） */
export const WIN32_BLUR_MIN_BUILD = 22_120

/** macOS 系统磨砂（与 BrowserWindow.setVibrancy 取值一致） */
export type MacVibrancy = 'none' | 'sidebar' | 'hud' | 'under-window' | 'fullscreen-ui'

/** Windows 系统背景材质（与 BrowserWindow.setBackgroundMaterial 取值一致） */
export type WindowMaterial = 'none' | 'mica' | 'acrylic' | 'tabbed'

/** 当前平台该用哪种磨砂承载窗口（三者至多一个生效） */
export interface WindowBlurPlan {
  /** macOS：vibrancy 自带桌面模糊 */
  vibrancy: MacVibrancy
  /** Windows 11 22H2+：acrylic 自带桌面模糊 */
  material: WindowMaterial
  /** 没有系统磨砂时退回 Chromium 逐像素 alpha：有透明、但没有壁纸模糊 */
  transparent: boolean
}

/**
 * 平台 → 磨砂方案。macOS 用 `under-window`（窗口背后的柔和模糊，最接近「毛玻璃」而不像侧栏）；
 * Windows 只有 22H2+ 才有 acrylic，低版本退回 `transparent: true`（仍半透明，只是不糊桌面）。
 * 其余平台（linux 等，不在发布矩阵）走不透明实底。
 */
export function resolveWindowBlur(platform: string, windowsBuild: number | null): WindowBlurPlan {
  if (platform === 'darwin') {
    return { vibrancy: 'fullscreen-ui', material: 'none', transparent: false }
  }
  if (platform === 'win32') {
    const acrylic = windowsBuild !== null && windowsBuild >= WIN32_BLUR_MIN_BUILD
    return acrylic
      ? { vibrancy: 'none', material: 'acrylic', transparent: false }
      : { vibrancy: 'none', material: 'none', transparent: true }
  }
  return { vibrancy: 'none', material: 'none', transparent: false }
}

/**
 * Windows build 号解析（`app.getSystemVersion()` 返回 "10.0.26100" 这类形式）。
 * 取第三段；缺失或非数字时返回 null（视为没有系统磨砂）。
 */
export function parseWindowsBuild(systemVersion: string): number | null {
  const match = /^\d+\.\d+\.(\d+)/.exec(systemVersion.trim())
  if (!match) return null
  const build = Number.parseInt(match[1], 10)
  return Number.isFinite(build) ? build : null
}

/** 平台既无系统磨砂也不支持透明窗口时的兜底实底（与 --color-app-bg 同值） */
export const OPAQUE_WINDOW_BG = '#edf3f8'

/** 透明底：磨砂窗口与逐像素 alpha 窗口都用它，任何不透明底色都会毁掉玻璃形态 */
export const TRANSPARENT_WINDOW_BG = '#00000000'
