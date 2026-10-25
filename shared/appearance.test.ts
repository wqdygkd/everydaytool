import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_APPEARANCE,
  parseWindowsBuild,
  resolveAppearanceCapabilities,
  sanitizeWindowAppearance,
} from './appearance'

describe('parseWindowsBuild', () => {
  it('取第三段 build 号（容忍首尾空白）', () => {
    expect(parseWindowsBuild('10.0.26100')).toBe(26100)
    expect(parseWindowsBuild(' 10.0.22621 ')).toBe(22621)
  })

  it('缺失 / 非数字返回 null（视为不支持系统材质）', () => {
    expect(parseWindowsBuild('10.0')).toBeNull()
    expect(parseWindowsBuild('')).toBeNull()
    expect(parseWindowsBuild('abc')).toBeNull()
  })
})

describe('resolveAppearanceCapabilities', () => {
  it('darwin 恒支持透明、无系统材质、vibrancy 可用', () => {
    const caps = resolveAppearanceCapabilities('darwin', null)
    expect(caps.supportsTransparent).toBe(true)
    expect(caps.supportsMaterial).toBe(false)
    expect(caps.materials).toEqual([])
    expect(caps.vibrancies).toContain('sidebar')
    expect(caps.defaultVibrancy).toBe('sidebar')
  })

  it('win32 22H2+（build ≥ 22120）支持系统材质', () => {
    const caps = resolveAppearanceCapabilities('win32', 26100)
    expect(caps.supportsTransparent).toBe(true)
    expect(caps.supportsMaterial).toBe(true)
    expect(caps.materials).toContain('acrylic')
    expect(caps.defaultMaterial).toBe('acrylic')
  })

  it('win32 旧版本不支持材质', () => {
    const caps = resolveAppearanceCapabilities('win32', 19045)
    expect(caps.supportsMaterial).toBe(false)
    expect(caps.materials).toEqual([])
    expect(caps.defaultMaterial).toBe('none')
  })

  it('linux 不声明透明（依赖合成器，Wayland 下不可靠）', () => {
    const caps = resolveAppearanceCapabilities('linux', null)
    expect(caps.supportsTransparent).toBe(false)
    expect(caps.supportsMaterial).toBe(false)
  })
})

describe('sanitizeWindowAppearance', () => {
  const winCaps = resolveAppearanceCapabilities('win32', 26100)
  const winLegacyCaps = resolveAppearanceCapabilities('win32', 19045)
  const darwinCaps = resolveAppearanceCapabilities('darwin', null)

  it('关闭总开关时清空材质 / vibrancy（关闭 = 完全不透明）', () => {
    const next = sanitizeWindowAppearance(
      { enabled: false, material: 'mica', vibrancy: 'hud', testWallpaper: false },
      winCaps,
    )
    expect(next.enabled).toBe(false)
    expect(next.material).toBe('none')
    expect(next.vibrancy).toBe('none')
  })

  it('平台不支持的材质归 none（不留永远无法呈现的选择）', () => {
    expect(
      sanitizeWindowAppearance(
        { enabled: true, material: 'mica', vibrancy: 'none', testWallpaper: false },
        winLegacyCaps,
      ).material,
    ).toBe('none')
    expect(
      sanitizeWindowAppearance(
        { enabled: true, material: 'mica', vibrancy: 'none', testWallpaper: false },
        darwinCaps,
      ).material,
    ).toBe('none')
  })

  it('vibrancy 仅在 darwin 支持清单内保留', () => {
    expect(
      sanitizeWindowAppearance(
        { enabled: true, material: 'none', vibrancy: 'hud', testWallpaper: false },
        darwinCaps,
      ).vibrancy,
    ).toBe('hud')
    expect(
      sanitizeWindowAppearance(
        { enabled: true, material: 'none', vibrancy: 'hud', testWallpaper: false },
        winCaps,
      ).vibrancy,
    ).toBe('none')
  })

  it('测试壁纸是纯 CSS 开关，与平台能力 / 半透明状态无关，原样保留', () => {
    const next = sanitizeWindowAppearance(
      { ...DEFAULT_WINDOW_APPEARANCE, enabled: false, testWallpaper: true },
      winCaps,
    )
    expect(next.testWallpaper).toBe(true)
  })
})
